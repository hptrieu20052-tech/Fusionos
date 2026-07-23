import { db, schema } from "@/lib/db";
import { beforeLaunch } from "@/lib/ingest-cutoff";
import { and, eq } from "drizzle-orm";
import { ignoredSet } from "@/lib/ignored-orders";
import { decodeEntities } from "@/lib/variant-display";

export type InItem = {
  title?: string; sku?: string; qty?: number; price?: number;
  variant?: string; personalization?: string; listingId?: string; productUrl?: string; imageUrl?: string;
  files?: { name: string; url: string }[]; // ảnh khách upload trên Etsy
};
export type InOrder = {
  externalId?: string; buyerFirst?: string; buyerLast?: string;
  addr1?: string; addr2?: string; city?: string; state?: string; zip?: string; country?: string;
  total?: number; fee?: number; orderedAt?: string; note?: string; platformStatus?: string; shippingType?: string;
  items?: InItem[];
};
export type IngestStore = { id: string; sellerId: string | null; fx: unknown; name: string };

// Decode HTML entity NGAY KHI LƯU (Etsy trả "3&quot;") → đơn mới sạch trong DB,
// và file đẩy sang nhà in cũng không dính chuỗi rác.
const s = (v: unknown) => (typeof v === "string" && v.trim() ? decodeEntities(v).trim() : null);
const num = (v: unknown) => { const n = Number(v); return isNaN(n) ? 0 : n; };

// Ghi đơn Etsy đã chuẩn hoá vào DB. Dedup theo (platform=etsy, external_id).
// orderedAt = NGÀY KÉO ĐƠN (thời điểm ingest) để mọi thống kê tính theo ngày kéo.
export async function insertEtsyOrders(store: IngestStore, orders: InOrder[], source: "extension" | "api" = "api", platform: "etsy" | "tiktok" = "etsy") {
  const fx = Number(store.fx) > 0 ? Number(store.fx) : 1;
  let created = 0, skipped = 0;
  const createdIds: string[] = [];
  const errors: string[] = [];
  let updated = 0;

  // Đơn đã ship/hoàn tất/huỷ trên sàn → KHÔNG tạo mới (đơn cũ hệ thống trước); đơn đã có vẫn merge bình thường
  const SHIPPED_LIKE = /shipped|in_transit|delivered|completed|cancel/i;
  // HUỶ / HOÀN TIỀN TOÀN BỘ / void → không kéo về (bug cũ: chỉ bắt "cancel", để lọt "fully refunded").
  const CANCEL_LIKE = /cancel|refund|void|declined|chargeback/i;

  // Blocklist đơn hệ thống CŨ — hỏi DB 1 lần cho cả lô, không hỏi từng đơn
  const blocked = await ignoredSet(orders.map((o) => String(o.externalId ?? "")));

  for (const o of orders.slice(0, 500)) {
    const ext = s(o.externalId);
    if (!ext) { skipped++; continue; }
    if (blocked.has(ext)) { skipped++; continue; } // đơn đã xử lý ở hệ thống cũ → bỏ qua, tránh in đúp
    try {
      const [dup] = await db.select().from(schema.orders)
        .where(and(eq(schema.orders.platform, platform as never), eq(schema.orders.externalId, ext))).limit(1);
      if (dup) {
        // Đơn đã HUỶ / HOÀN TIỀN TOÀN BỘ trên sàn (dù trước đó kéo về lúc còn active) →
        // đánh dấu CANCEL để loại khỏi việc + hết cảnh báo "assign design", không merge/đẩy nữa.
        if (o.platformStatus && CANCEL_LIKE.test(String(o.platformStatus)) && !["cancel", "trash"].includes(dup.status)) {
          await db.update(schema.orders).set({ status: "cancel" as never, platformStatus: s(o.platformStatus), updatedAt: new Date() }).where(eq(schema.orders.id, dup.id));
          updated++; continue;
        }
        // MERGE: đơn đã có → chỉ điền field còn TRỐNG (đơn kéo lần đầu từ list thiếu địa chỉ,
        // mở chi tiết trên Etsy rồi Push lại là địa chỉ/total/note tự vào — không đè dữ liệu đã sửa tay).
        const patch: Record<string, unknown> = {};
        const fillIf = (col: string, cur: unknown, val: string | null) => { if (val && (!cur || String(cur).trim() === "")) patch[col] = val; };
        fillIf("buyerFirst", dup.buyerFirst, s(o.buyerFirst));
        fillIf("buyerLast", dup.buyerLast, s(o.buyerLast));
        fillIf("addr1", dup.addr1, s(o.addr1));
        fillIf("addr2", dup.addr2, s(o.addr2));
        fillIf("city", dup.city, s(o.city));
        fillIf("state", dup.state, s(o.state));
        fillIf("zip", dup.zip, s(o.zip));
        fillIf("buyerNote", dup.buyerNote, s(o.note)); // note KHÁCH vào cột riêng buyer_note
        if (s(o.country) && (!dup.country || dup.country === "United States")) {
          if (s(o.country) !== dup.country) patch.country = s(o.country);
        }
        const inTotal = num(o.total);
        if (inTotal > 0 && (!dup.total || Number(dup.total) === 0)) patch.total = (inTotal / fx).toFixed(2);
        // MERGE ITEM: điền blank title/variant/price/image/personalization cho item.
        // (đơn cũ import Excel/harvest thiếu → kéo lại từ API/extension là tự lành, KHÔNG đè dữ liệu đã có).
        let itemUpdated = false;
        const inItems = Array.isArray(o.items) ? o.items : [];
        if (inItems.length) {
          const exItems = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, dup.id));
          const blank = (v: unknown) => !v || String(v).trim() === "" || String(v).startsWith("Etsy order ");
          // MATCH ITEM 1-1, mỗi item DB chỉ được khớp MỘT LẦN.
          // BUG CŨ (nguy hiểm): đơn có 2+ item CÙNG listing → find() theo listingId trỏ cả 2 vào item đầu,
          // luật "dài hơn thì đè" biến 2 item khác size/tên cá nhân hoá thành GIỐNG HỆT NHAU → in sai cho khách.
          // Thứ tự ưu tiên: (1) listingId KHÔNG mơ hồ · (2) nhiều item cùng listing → theo VỊ TRÍ trong nhóm đó
          // · (3) index chỉ khi không mâu thuẫn listing · (4) item chưa gán listing. Tuyệt đối không "mượn" item listing khác.
          const used = new Set<string>();
          const guessedLid = new Set<string>(); // listing đã từng ghép ĐOÁN MÒ → slot còn lại của nó KHÔNG được tin
          const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();
          type ExItem = (typeof exItems)[number];
          // Đếm số item CÙNG listing ở DB và ở bản push. CHỈ suy luận "còn 1 slot → chắc chắn" khi
          // hai bên KHỚP SỐ LƯỢNG (nếu DB thiếu/thừa item của listing đó thì slot còn lại có thể là
          // của item KHÁC → cấm điền, tránh in nhầm — phát hiện qua mô phỏng 500k đơn).
          const dbLidCount = new Map<string, number>();
          for (const x of exItems) { const k = x.etsyListingId ?? "∅"; dbLidCount.set(k, (dbLidCount.get(k) ?? 0) + 1); }
          const inLidCount = new Map<string, number>();
          for (const it of inItems) { const k = s(it.listingId) ?? "∅"; inLidCount.set(k, (inLidCount.get(k) ?? 0) + 1); }
          const cleanGroup = (lid: string) => !guessedLid.has(lid) && (inLidCount.get(lid) ?? 0) === (dbLidCount.get(lid) ?? 0);
          // matchFor trả kèm cờ `confirmed`: TRUE = ghép chắc chắn bằng NỘI DUNG (listing riêng, hoặc
          // personalization/variant riêng biệt). FALSE = chỉ đoán theo VỊ TRÍ vì mơ hồ.
          // v87: khi confirmed=false thì TUYỆT ĐỐI không ghi personalization/variant — để tránh ca
          // "đơn nhiều item CÙNG listing, tên trống + Etsy đảo thứ tự" gán tên vào nhầm dòng.
          const matchFor = (inIt: InItem, i: number): { ex: ExItem | null; confirmed: boolean } => {
            const lid = s(inIt.listingId);
            if (lid) {
              const cands = exItems.filter((x) => !used.has(x.id) && x.etsyListingId === lid);
              // "chỉ còn 1 ứng viên" chỉ CHẮC CHẮN khi số item cùng listing KHỚP (không thiếu/thừa)
              // và listing chưa từng bị đoán mò.
              if (cands.length === 1) return { ex: cands[0], confirmed: cleanGroup(lid) };
              if (cands.length > 1) {
                // NHIỀU item cùng listing: Etsy KHÔNG cam kết thứ tự giữa 2 lần sync → khớp theo
                // NỘI DUNG trước (personalization rồi variant trùng). Trùng duy nhất = CHẮC CHẮN.
                const pz = lower(inIt.personalization);
                if (pz) {
                  const byPz = cands.filter((x) => lower(x.personalization) === pz);
                  if (byPz.length === 1) return { ex: byPz[0], confirmed: true };
                  if (byPz.length > 1) {
                    // trùng cả tên → dùng variant tách tiếp trong nhóm trùng tên
                    const vr = lower(inIt.variant);
                    const byVr = vr ? byPz.filter((x) => lower(x.variant) === vr) : [];
                    if (byVr.length === 1) return { ex: byVr[0], confirmed: true };
                    return { ex: byPz[i % byPz.length] && byPz.includes(exItems[i]) ? exItems[i] : byPz[0], confirmed: true }; // trùng hệt nhau → ghép sao cũng ra kết quả y hệt (vô hại)
                  }
                }
                // KHÔNG dùng variant/size để XÁC NHẬN điền tên: variant KHÔNG phải mã định danh —
                // khi slot đúng bị rớt variant, size lại trỏ trúng slot của item KHÁC cùng size → in nhầm
                // (mô phỏng 500k phát hiện). Chỉ tin đường loại trừ 1-1 (cands.length===1 + cleanGroup).
                // KHÔNG phân biệt được bằng tên → đoán theo vị trí NHƯNG đánh dấu chưa chắc.
                const byIdx = exItems.length === inItems.length ? exItems[i] : null;
                const guess = byIdx && cands.includes(byIdx) ? byIdx : cands[0];
                guessedLid.add(lid); // listing này đã phải đoán → slot còn lại của nó cũng không được tin
                return { ex: guess, confirmed: false };
              }
            }
            // Khớp theo VỊ TRÍ chỉ được nối 2 item CÙNG TÌNH TRẠNG LISTING (cùng mã, hoặc cùng không có).
            // Nếu để item không-listing "ăn" slot của item có-listing (hay ngược lại) sẽ làm LỆCH phép
            // đếm nhóm → suy luận loại trừ sai → in nhầm (mô phỏng 2 triệu đơn phát hiện, cực hiếm).
            const eqLid = (a: string | null, b: string | null) => (a ?? null) === (b ?? null);
            if (exItems.length === inItems.length && exItems[i] && !used.has(exItems[i].id) && eqLid(lid, exItems[i].etsyListingId)) {
              // chỉ CHẮC CHẮN khi đơn đúng 1 item (không thể mơ hồ); nhiều item khớp vị trí = phỏng đoán → không ghi tên.
              return { ex: exItems[i], confirmed: inItems.length === 1 };
            }
            const fb = exItems.find((x) => !used.has(x.id) && eqLid(lid, x.etsyListingId)) ?? null;
            return { ex: fb, confirmed: exItems.length === 1 && inItems.length === 1 };
          };
          for (let i = 0; i < inItems.length; i++) {
            const inIt = inItems[i];
            const { ex, confirmed } = matchFor(inIt, i);
            if (!ex) {
              // Đơn trong DB THIẾU item so với sàn (harvest cũ gộp/thiếu) → BỔ SUNG, không bỏ rơi item của khách.
              if (s(inIt.title) && exItems.length + 0 < inItems.length) {
                await db.insert(schema.orderItems).values({
                  orderId: dup.id,
                  productTitle: s(inIt.title)!,
                  internalSku: s(inIt.sku),
                  qty: num(inIt.qty) || 1,
                  unitPrice: (num(inIt.price) / fx).toFixed(2),
                  variant: s(inIt.variant),
                  personalization: s(inIt.personalization),
                  etsyListingId: s(inIt.listingId),
                  productUrl: s(inIt.productUrl),
                  imageUrl: s(inIt.imageUrl),
                  buyerFiles: Array.isArray(inIt.files) && inIt.files.length ? inIt.files : null,
                });
                itemUpdated = true;
              }
              continue;
            }
            used.add(ex.id);
            const ip: Record<string, unknown> = {};
            if (s(inIt.title) && blank(ex.productTitle)) ip.productTitle = s(inIt.title);
            // v87 — VARIANT/PERSONALIZATION: chỉ điền khi ô đang TRỐNG *và* ghép được XÁC NHẬN (confirmed).
            // Thực tế push lại luôn ra ĐỦ hoặc KHÔNG (không có bản cụt cần "nối dài") → đã có giá trị thì
            // KHÓA CỨNG, không bao giờ đè. Và không confirmed (đơn nhiều item cùng listing, không phân biệt
            // được bằng nội dung) thì KHÔNG đoán theo vị trí để điền → tránh gán tên vào nhầm dòng.
            const inVar = s(inIt.variant);
            if (confirmed && blank(ex.variant) && inVar) ip.variant = inVar;
            if (s(inIt.imageUrl) && blank(ex.imageUrl)) ip.imageUrl = s(inIt.imageUrl);
            const inPz = s(inIt.personalization);
            if (confirmed && blank(ex.personalization) && inPz) ip.personalization = inPz;
            if (s(inIt.listingId) && !ex.etsyListingId) ip.etsyListingId = s(inIt.listingId);
            // Ảnh khách upload: điền khi chưa có, hoặc khi bản mới có NHIỀU ảnh hơn.
            const inFiles = Array.isArray(inIt.files) ? inIt.files : [];
            const exFiles = Array.isArray(ex.buyerFiles) ? (ex.buyerFiles as unknown[]) : [];
            if (inFiles.length && inFiles.length >= exFiles.length) ip.buyerFiles = inFiles;
            const inPrice = num(inIt.price);
            if (inPrice > 0 && (!ex.unitPrice || Number(ex.unitPrice) === 0)) ip.unitPrice = (inPrice / fx).toFixed(2);
            if (Object.keys(ip).length) { await db.update(schema.orderItems).set(ip).where(eq(schema.orderItems.id, ex.id)); itemUpdated = true; }
          }
        }
        if (Object.keys(patch).length) {
          await db.update(schema.orders).set(patch).where(eq(schema.orders.id, dup.id));
          updated++;
        } else if (itemUpdated) { updated++; } else skipped++;
        continue;
      }

      if (o.platformStatus && SHIPPED_LIKE.test(String(o.platformStatus))) { skipped++; continue; }
      // MỐC LAUNCH: đơn đặt trước INGEST_SINCE → thuộc hệ thống cũ, bỏ qua (chống push đúp)
      if (beforeLaunch(o.orderedAt)) { skipped++; continue; }

      const items = Array.isArray(o.items) ? o.items : [];
      const subtotal = items.reduce((a, it) => a + num(it.price) * (num(it.qty) || 1), 0);
      const total = num(o.total) || subtotal;

      const [order] = await db.insert(schema.orders).values({
        externalId: ext, platform: platform as never,
        storeId: store.id, sellerId: store.sellerId, source: source as never, status: "new",
        platformStatus: s(o.platformStatus),
        shippingType: s(o.shippingType),
        buyerFirst: s(o.buyerFirst), buyerLast: s(o.buyerLast),
        addr1: s(o.addr1), addr2: s(o.addr2), city: s(o.city), state: s(o.state), zip: s(o.zip),
        country: s(o.country) ?? "United States",
        total: (total / fx).toFixed(2), platformFee: (num(o.fee) / fx).toFixed(2),
        buyerNote: s(o.note), // note KHÁCH → cột riêng (note nội bộ do staff tự ghi)
        orderedAt: new Date(),
      }).onConflictDoNothing().returning();
      if (!order) { skipped++; continue; } // request song song đã insert trước → coi như trùng

      const rows = items.length ? items : [{ title: `Etsy order ${ext}`, qty: 1, price: total } as InItem];
      for (const it of rows) {
        await db.insert(schema.orderItems).values({
          orderId: order.id,
          productTitle: s(it.title) ?? `Etsy order ${ext}`,
          internalSku: s(it.sku),
          qty: num(it.qty) || 1,
          unitPrice: (num(it.price) / fx).toFixed(2),
          variant: s(it.variant),
          personalization: s(it.personalization),
          etsyListingId: s(it.listingId),
          productUrl: s(it.productUrl),
          imageUrl: s(it.imageUrl),
          buyerFiles: Array.isArray(it.files) && it.files.length ? it.files : null,
        });
      }
      created++;
      if (order?.id) createdIds.push(order.id);
    } catch (e) {
      errors.push(`${ext}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    }
  }

  await db.update(schema.stores).set({ lastSyncAt: new Date() }).where(eq(schema.stores.id, store.id));
  // Thông báo SALE về Telegram theo team (lỗi Telegram không ảnh hưởng ingest)
  if (createdIds.length) {
    try { const { notifyNewSales } = await import("@/lib/telegram"); await notifyNewSales(createdIds); } catch { /* bỏ qua */ }
  }
  return { created, updated, skipped, errors: errors.slice(0, 20) };
}
