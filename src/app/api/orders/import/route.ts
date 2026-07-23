import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { sql, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { hasAction } from "@/lib/actions";
import * as XLSX from "xlsx";
import { autoPushEtsyTracking } from "@/lib/etsy-tracking";
import { autoPushTiktokTracking } from "@/lib/tiktok-tracking";
import { markShippedOnTracking } from "@/lib/order-status";

export const dynamic = "force-dynamic";

/**
 * POST /api/orders/import — nhận file Excel/CSV (multipart "file"), cập nhật hàng loạt cho ĐƠN CÓ SẴN.
 * Cột nhận diện đơn: "Order ID" (external_id) hoặc "Order Label".
 * Cột cập nhật (có cột nào xử lý cột đó — đúng bộ trường của form nhập tay):
 *  - "Fulfilled By": tên nhà in (đúng tên trong Fulfillers) — gán/đổi supplier cho bản ghi fulfill
 *  - "Tracking Number" (+ "Carrier"): lưu tracking, đơn → shipped, tự đẩy Etsy/TikTok
 *  - "Tracking URL" · "Supplier Order Link"
 *  - "Base Cost" · "Ship Fee": lưu vào bản ghi fulfill (cost = base + ship) + điều chỉnh sổ base_cost
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "orders")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (!(await hasAction(session, "orders.import"))) return NextResponse.json({ ok: false, error: "forbidden: import" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file") as File | null;
  if (!file) return NextResponse.json({ ok: false, error: "missing file" }, { status: 400 });

  const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  if (!rows.length) return NextResponse.json({ ok: false, error: "empty file" }, { status: 400 });

  const norm = (s: unknown) => String(s ?? "").trim();
  const pick = (r: Record<string, unknown>, names: string[]) => {
    for (const k of Object.keys(r)) if (names.includes(k.toLowerCase().replace(/[_\s]+/g, ""))) return norm(r[k]);
    return "";
  };

  // Map TÊN nhà in → id cho cột "Fulfilled By"
  const ffRows = await db.select({ id: schema.fulfillers.id, name: schema.fulfillers.name }).from(schema.fulfillers);
  const ffByName = new Map(ffRows.map((f) => [f.name.trim().toLowerCase(), f.id]));

  let trackingUpdated = 0, costUpdated = 0, ffUpdated = 0;
  const errors: string[] = [];
  const createdFulfillers: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const ext = pick(r, ["orderid", "externalid", "mãđơn", "madon"]);
    const label = pick(r, ["orderlabel", "label", "orderlabelid"]);
    if (!ext && !label) { errors.push(`Dòng ${i + 2}: thiếu Order ID / Order Label`); continue; }

    // NHẬN DIỆN LINH HOẠT: support hay điền Order ID vào cột Order Label (và ngược lại) →
    // giá trị nào cũng thử cả 3 kiểu: external_id · order_label · phần SAU DẤU "-" cuối (label SHOP-123 → 123).
    const key = (ext || label).trim();
    const tail = key.includes("-") ? key.slice(key.lastIndexOf("-") + 1) : key;
    const [order] = (await db.execute(sql`
      SELECT id, store_id, seller_id, status, ordered_at FROM orders
      WHERE external_id = ${key} OR order_label = ${key} OR external_id = ${tail}
      ORDER BY ordered_at DESC LIMIT 1
    `)).rows as { id: string; store_id: string | null; seller_id: string | null; status: string; ordered_at: string | Date | null }[];
    if (!order) { errors.push(`Dòng ${i + 2}: không tìm thấy đơn ${key}`); continue; }

    // --- Các trường fulfill (đúng form nhập tay) ---
    const supName = pick(r, ["fulfilledby", "fulfiller", "supplier", "nhàin", "nhain"]);
    const trk = pick(r, ["trackingnumber", "tracking", "trackingno"]);
    const carrier = pick(r, ["carrier", "trackingcarrier", "hãngvậnchuyển"]);
    const turl = pick(r, ["trackingurl", "trackurl", "tracklink", "trackinglink", "track"]);
    const slink = pick(r, ["supplierorderlink", "supplierlink", "supplierorderurl", "orderlink"]);
    const bcRaw = pick(r, ["basecost", "cost", "giávốn", "giavon"]);
    const shipRaw = pick(r, ["shipfee", "shipcost", "shipping", "shippingfee", "phíship", "phiship"]);

    // CHẶN TRACKING BỊ EXCEL PHÁ: mã dài mở bằng Excel bị đổi thành 9.30012E+21 (MẤT chữ số cuối,
    // không cứu được) → từ chối kèm hướng dẫn, tuyệt đối không lưu mã rác rồi đẩy lên sàn.
    if (trk && (/\d\.\d+e\+?\d+/i.test(trk) || !/^[A-Za-z0-9\- ]{4,40}$/.test(trk))) {
      errors.push(`Dòng ${i + 2}: Tracking "${trk}" không hợp lệ — Excel đã đổi số dài thành dạng khoa học. Format cột Tracking thành TEXT (hoặc gõ ="mã..." ), nhập lại mã thật rồi import lại dòng này.`);
      continue;
    }
    let supId = supName ? ffByName.get(supName.toLowerCase()) : undefined;
    if (supName && !supId) {
      // Nhà in CHƯA CÓ trong hệ thống → TỰ TẠO (method "excel" — supplier không API, đúng ca fulfill tay).
      // Cẩn thận gõ đúng tên: sai chính tả sẽ sinh nhà in thừa (xoá trong Settings → Fulfillers).
      try {
        const [nf] = await db.insert(schema.fulfillers).values({ name: supName, method: "excel" }).onConflictDoNothing().returning({ id: schema.fulfillers.id });
        const id = nf?.id
          ?? ((await db.execute(sql`SELECT id FROM fulfillers WHERE lower(name) = ${supName.toLowerCase()} LIMIT 1`)).rows[0] as { id: string } | undefined)?.id;
        if (id) { supId = id; ffByName.set(supName.toLowerCase(), id); if (nf?.id) createdFulfillers.push(supName); }
      } catch { /* rơi xuống lỗi dưới */ }
      if (!supId) { errors.push(`Dòng ${i + 2}: không tạo được nhà in "${supName}"`); continue; }
    }
    const bc = bcRaw !== "" ? Number(bcRaw) : null;
    const sc = shipRaw !== "" ? Number(shipRaw) : null;
    if (bcRaw !== "" && (!Number.isFinite(bc!) || bc! < 0)) { errors.push(`Dòng ${i + 2}: Base Cost không hợp lệ (${bcRaw})`); continue; }
    if (shipRaw !== "" && (!Number.isFinite(sc!) || sc! < 0)) { errors.push(`Dòng ${i + 2}: Ship Fee không hợp lệ (${shipRaw})`); continue; }

    const hasFf = !!(supId || trk || carrier || turl || slink || bc != null || sc != null);
    if (hasFf) {
      const fos = (await db.execute(sql`
        SELECT id, fulfiller_id, base_cost, ship_cost FROM fulfillment_orders WHERE order_id = ${order.id}::uuid ORDER BY created_at DESC
      `)).rows as { id: string; fulfiller_id: string; base_cost: string | null; ship_cost: string | null }[];
      const fo = supId ? (fos.find((x) => x.fulfiller_id === supId) ?? fos[0]) : fos[0];

      if (fo) {
        const newBase = bc != null ? bc.toFixed(2) : fo.base_cost;
        const newShip = sc != null ? sc.toFixed(2) : fo.ship_cost;
        const newCost = bc != null || sc != null ? (Number(newBase ?? 0) + Number(newShip ?? 0)).toFixed(2) : null;
        await db.execute(sql`
          UPDATE fulfillment_orders SET
            fulfiller_id = COALESCE(${supId ?? null}::uuid, fulfiller_id),
            tracking_number = COALESCE(${trk || null}, tracking_number),
            tracking_carrier = COALESCE(${carrier || null}, tracking_carrier),
            tracking_url = COALESCE(${turl || null}, tracking_url),
            supplier_order_url = COALESCE(${slink || null}, supplier_order_url),
            base_cost = ${newBase}, ship_cost = ${newShip},
            cost = COALESCE(${newCost}, cost),
            status = CASE WHEN ${trk || null}::text IS NOT NULL THEN 'shipped' ELSE status END,
            tracking_synced_at = CASE WHEN ${trk || null}::text IS NOT NULL THEN NOW() ELSE tracking_synced_at END
          WHERE id = ${fo.id}::uuid`);
        ffUpdated++;
      } else {
        // Chưa có bản ghi fulfill → BẮT BUỘC cột "Fulfilled By" để biết tạo cho nhà in nào
        if (!supId) { errors.push(`Dòng ${i + 2}: đơn ${ext || label} chưa có bản ghi fulfill — thêm cột "Fulfilled By" (tên nhà in) để tạo mới`); continue; }
        await db.execute(sql`
          INSERT INTO fulfillment_orders (order_id, fulfiller_id, status, external_ff_id, tracking_number, tracking_carrier, tracking_url, supplier_order_url, base_cost, ship_cost, cost, pushed_at, tracking_synced_at)
          VALUES (${order.id}::uuid, ${supId}::uuid, ${trk ? "shipped" : "pushed"}, ${"MANUAL-" + Date.now() + "-" + i},
            ${trk || null}, ${carrier || null}, ${turl || null}, ${slink || null},
            ${bc != null ? bc.toFixed(2) : null}, ${sc != null ? sc.toFixed(2) : null},
            ${((bc ?? 0) + (sc ?? 0)).toFixed(2)}, NOW(), ${trk ? sql`NOW()` : sql`NULL`})`);
        ffUpdated++;
      }
    }

    // --- Tracking → đơn shipped (qua luật chung: đơn tách nhiều nhà chỉ Shipped khi ĐỦ tracking) + tự đẩy Etsy/TikTok ---
    if (trk) {
      if (!["delivered", "cancel", "trash"].includes(order.status)) {
        await markShippedOnTracking(order.id);
        await autoPushEtsyTracking(order.id);
        await autoPushTiktokTracking(order.id).catch(() => { /* đơn không phải TikTok → bỏ qua */ });
      }
      trackingUpdated++;
    }

    // --- Base cost: chỉnh tổng sổ = giá trị file (bcRaw đã đọc + validate ở trên) ---
    if (bcRaw !== "") {
      const target = Number(bcRaw);
      const cur = Number(((await db.execute(sql`
        SELECT coalesce(-sum(amount),0)::numeric s FROM transactions WHERE order_id=${order.id}::uuid AND type='base_cost'
      `)).rows[0] as { s: string }).s);
      const delta = target - cur; // cần trừ thêm delta (dương = tăng chi phí)
      if (Math.abs(delta) >= 0.01) {
        await db.insert(schema.transactions).values({
          type: "base_cost", amount: (-delta).toFixed(2),
          orderId: order.id, storeId: order.store_id, sellerId: order.seller_id,
          note: `Import Excel: base cost ${cur.toFixed(2)} → ${target.toFixed(2)}`,
          // Theo NGÀY KÉO ĐƠN VỀ (ordered_at) — trùng mốc doanh thu.
          occurredAt: (order.ordered_at ? new Date(order.ordered_at) : new Date()).toISOString().slice(0, 10),
        });
        costUpdated++;
      }
    }
  }

  return NextResponse.json({ ok: true, rows: rows.length, trackingUpdated, costUpdated, ffUpdated, createdFulfillers, errors: errors.slice(0, 30) });
}
