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
          const used = new Set<string>();
          const matchFor = (inIt: InItem, i: number) => {
            // Cùng số lượng item → khớp theo THỨ TỰ (ổn định giữa API/extension, phân biệt được 2 item cùng listing)
            if (exItems.length === inItems.length && exItems[i] && !used.has(exItems[i].id)) return exItems[i];
            const lid = s(inIt.listingId);
            if (lid) { const e = exItems.find((x) => !used.has(x.id) && x.etsyListingId === lid); if (e) return e; }
            return exItems.find((x) => !used.has(x.id)) ?? null;
          };
          for (let i = 0; i < inItems.length; i++) {
            const inIt = inItems[i];
            const ex = matchFor(inIt, i);
            if (!ex) continue;
            used.add(ex.id);
            const ip: Record<string, unknown> = {};
            if (s(inIt.title) && blank(ex.productTitle)) ip.productTitle = s(inIt.title);
            // Variant/Personalization: điền khi trống HOẶC khi bản mới ĐẦY ĐỦ hơn (dài hơn) → chữa đơn cũ bị cắt cụt khi re-sync.
            const inVar = s(inIt.variant);
            if (inVar && (blank(ex.variant) || inVar.length > (ex.variant?.length ?? 0))) ip.variant = inVar;
            if (s(inIt.imageUrl) && blank(ex.imageUrl)) ip.imageUrl = s(inIt.imageUrl);
            const inPz = s(inIt.personalization);
            if (inPz && (blank(ex.personalization) || inPz.length > (ex.personalization?.length ?? 0))) ip.personalization = inPz;
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
