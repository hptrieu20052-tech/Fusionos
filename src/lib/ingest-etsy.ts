import { db, schema } from "@/lib/db";
import { beforeLaunch } from "@/lib/ingest-cutoff";
import { and, eq } from "drizzle-orm";

export type InItem = {
  title?: string; sku?: string; qty?: number; price?: number;
  variant?: string; personalization?: string; listingId?: string; productUrl?: string; imageUrl?: string;
};
export type InOrder = {
  externalId?: string; buyerFirst?: string; buyerLast?: string;
  addr1?: string; addr2?: string; city?: string; state?: string; zip?: string; country?: string;
  total?: number; fee?: number; orderedAt?: string; note?: string; platformStatus?: string;
  items?: InItem[];
};
export type IngestStore = { id: string; sellerId: string | null; fx: unknown; name: string };

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => { const n = Number(v); return isNaN(n) ? 0 : n; };

// Ghi đơn Etsy đã chuẩn hoá vào DB. Dedup theo (platform=etsy, external_id).
// orderedAt = NGÀY KÉO ĐƠN (thời điểm ingest) để mọi thống kê tính theo ngày kéo.
export async function insertEtsyOrders(store: IngestStore, orders: InOrder[], source: "extension" | "api" = "api", platform: "etsy" | "tiktok" = "etsy") {
  const fx = Number(store.fx) > 0 ? Number(store.fx) : 1;
  let created = 0, skipped = 0;
  const errors: string[] = [];
  let updated = 0;

  // Đơn đã ship/hoàn tất/huỷ trên sàn → KHÔNG tạo mới (đơn cũ hệ thống trước); đơn đã có vẫn merge bình thường
  const SHIPPED_LIKE = /shipped|in_transit|delivered|completed|cancel/i;

  for (const o of orders.slice(0, 500)) {
    const ext = s(o.externalId);
    if (!ext) { skipped++; continue; }
    try {
      const [dup] = await db.select().from(schema.orders)
        .where(and(eq(schema.orders.platform, platform as never), eq(schema.orders.externalId, ext))).limit(1);
      if (dup) {
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
        fillIf("note", dup.note, s(o.note));
        if (s(o.country) && (!dup.country || dup.country === "United States")) {
          if (s(o.country) !== dup.country) patch.country = s(o.country);
        }
        const inTotal = num(o.total);
        if (inTotal > 0 && (!dup.total || Number(dup.total) === 0)) patch.total = (inTotal / fx).toFixed(2);
        if (Object.keys(patch).length) {
          await db.update(schema.orders).set(patch).where(eq(schema.orders.id, dup.id));
          updated++;
        } else skipped++;
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
        buyerFirst: s(o.buyerFirst), buyerLast: s(o.buyerLast),
        addr1: s(o.addr1), addr2: s(o.addr2), city: s(o.city), state: s(o.state), zip: s(o.zip),
        country: s(o.country) ?? "United States",
        total: (total / fx).toFixed(2), platformFee: (num(o.fee) / fx).toFixed(2),
        note: s(o.note),
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
        });
      }
      created++;
    } catch (e) {
      errors.push(`${ext}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    }
  }

  await db.update(schema.stores).set({ lastSyncAt: new Date() }).where(eq(schema.stores.id, store.id));
  return { created, updated, skipped, errors: errors.slice(0, 20) };
}
