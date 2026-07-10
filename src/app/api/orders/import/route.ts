import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { sql, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { hasAction } from "@/lib/actions";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

/**
 * POST /api/orders/import — nhận file Excel (multipart "file"), cập nhật hàng loạt:
 * Cột nhận diện đơn: "Order ID" (external_id) hoặc "Order Label".
 * Cột cập nhật (có cột nào xử lý cột đó):
 *  - "Tracking Number" (+ "Carrier"): lưu tracking, đơn → shipped
 *  - "Base Cost": điều chỉnh sổ để tổng base_cost của đơn = giá trị này (ghi bút toán chênh lệch)
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

  let trackingUpdated = 0, costUpdated = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const ext = pick(r, ["orderid", "externalid", "mãđơn", "madon"]);
    const label = pick(r, ["orderlabel", "label"]);
    if (!ext && !label) { errors.push(`Dòng ${i + 2}: thiếu Order ID / Order Label`); continue; }

    const [order] = (await db.execute(sql`
      SELECT id, store_id, seller_id, status FROM orders
      WHERE ${ext ? sql`external_id = ${ext}` : sql`order_label = ${label}`} LIMIT 1
    `)).rows as { id: string; store_id: string | null; seller_id: string | null; status: string }[];
    if (!order) { errors.push(`Dòng ${i + 2}: không tìm thấy đơn ${ext || label}`); continue; }

    // --- Tracking ---
    const trk = pick(r, ["trackingnumber", "tracking", "trackingno"]);
    const carrier = pick(r, ["carrier", "trackingcarrier", "hãngvậnchuyển"]);
    if (trk) {
      const [fo] = (await db.execute(sql`
        SELECT id FROM fulfillment_orders WHERE order_id = ${order.id}::uuid ORDER BY created_at DESC LIMIT 1
      `)).rows as { id: string }[];
      if (fo) {
        await db.execute(sql`
          UPDATE fulfillment_orders SET tracking_number=${trk}, tracking_carrier=${carrier || null},
            status='shipped', tracking_synced_at=NOW() WHERE id=${fo.id}::uuid`);
      } else {
        await db.execute(sql`
          INSERT INTO fulfillment_orders (order_id, fulfiller_id, status, tracking_number, tracking_carrier, tracking_synced_at)
          SELECT ${order.id}::uuid, id, 'shipped', ${trk}, ${carrier || null}, NOW() FROM fulfillers LIMIT 1`);
      }
      if (!["completed", "trash"].includes(order.status)) {
        await db.update(schema.orders).set({ status: "shipped", updatedAt: new Date() }).where(eq(schema.orders.id, order.id));
      }
      trackingUpdated++;
    }

    // --- Base cost: chỉnh tổng sổ = giá trị file ---
    const bcRaw = pick(r, ["basecost", "cost", "giávốn", "giavon"]);
    if (bcRaw !== "") {
      const target = Number(bcRaw);
      if (isNaN(target) || target < 0) { errors.push(`Dòng ${i + 2}: Base Cost không hợp lệ (${bcRaw})`); continue; }
      const cur = Number(((await db.execute(sql`
        SELECT coalesce(-sum(amount),0)::numeric s FROM transactions WHERE order_id=${order.id}::uuid AND type='base_cost'
      `)).rows[0] as { s: string }).s);
      const delta = target - cur; // cần trừ thêm delta (dương = tăng chi phí)
      if (Math.abs(delta) >= 0.01) {
        await db.insert(schema.transactions).values({
          type: "base_cost", amount: (-delta).toFixed(2),
          orderId: order.id, storeId: order.store_id, sellerId: order.seller_id,
          note: `Import Excel: base cost ${cur.toFixed(2)} → ${target.toFixed(2)}`,
          occurredAt: new Date().toISOString().slice(0, 10),
        });
        costUpdated++;
      }
    }
  }

  return NextResponse.json({ ok: true, rows: rows.length, trackingUpdated, costUpdated, errors: errors.slice(0, 30) });
}
