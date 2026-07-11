import { db, schema } from "@/lib/db";
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
export async function insertEtsyOrders(store: IngestStore, orders: InOrder[], source: "extension" | "api" = "api") {
  const fx = Number(store.fx) > 0 ? Number(store.fx) : 1;
  let created = 0, skipped = 0;
  const errors: string[] = [];

  for (const o of orders.slice(0, 500)) {
    const ext = s(o.externalId);
    if (!ext) { skipped++; continue; }
    try {
      const [dup] = await db.select({ id: schema.orders.id }).from(schema.orders)
        .where(and(eq(schema.orders.platform, "etsy" as never), eq(schema.orders.externalId, ext))).limit(1);
      if (dup) { skipped++; continue; }

      const items = Array.isArray(o.items) ? o.items : [];
      const subtotal = items.reduce((a, it) => a + num(it.price) * (num(it.qty) || 1), 0);
      const total = num(o.total) || subtotal;

      const [order] = await db.insert(schema.orders).values({
        externalId: ext, platform: "etsy" as never,
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
  return { created, skipped, errors: errors.slice(0, 20) };
}
