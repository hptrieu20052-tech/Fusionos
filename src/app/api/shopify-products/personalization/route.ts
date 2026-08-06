import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import { payloadOf, type PQ } from "@/lib/personalization";

export const dynamic = "force-dynamic";

/**
 * POST /api/shopify-products/personalization
 *
 *   { action:"read",  ids:[uuid] }            → bộ field ĐANG áp cho listing đầu tiên trong ids
 *   { action:"save",  ids:[uuid], fields:[] } → ghi bộ field RIÊNG cho từng listing trong ids
 *   { action:"clear", ids:[uuid] }            → xoá bộ riêng ⇒ listing quay về dùng của template
 *
 * Route này CHỈ ghi vào FUSION OS, không đụng Shopify. Đẩy lên Shopify là bước sau
 * (push-personalization) để dùng chung thanh tiến độ + danh sách lỗi với các lệnh khác.
 *
 * Vì sao có bộ riêng theo listing: mỗi listing hỏi khách một kiểu khác nhau (tên bé, số tuổi,
 * ảnh mặt trước…), template chỉ hợp để làm bộ khởi điểm. NULL = chưa đặt riêng, mảng = đã đặt.
 */
const MAX_IDS = 250;
type Tpl = typeof schema.shopifyTemplates.$inferSelect;

// Cùng luật khớp template với AI Optimize / push-delivery / push-personalization.
function tplFor(tpls: Tpl[], storeId: string, productType: string | null, pinnedId: string | null): Tpl | null {
  if (pinnedId) { const p = tpls.find((t) => t.id === pinnedId); if (p) return p; }
  const list = tpls.filter((t) => t.storeId === storeId);
  const pt = (productType ?? "").trim().toLowerCase();
  if (pt) { const m = list.find((t) => (t.productType ?? "").trim().toLowerCase() === pt); if (m) return m; }
  const active = list.filter((t) => t.status === "ACTIVE");
  if (active.length === 1) return active[0];
  if (list.length === 1) return list[0];
  return null;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const lvl = await levelOf(session, "products");
  if (lvl < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const action = String(b?.action ?? "read");
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x))).slice(0, MAX_IDS);
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });
  // Sửa là ghi ⇒ cần level 2, đọc thì level 1 là đủ.
  if (action !== "read" && lvl < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const rows = await db.select({
    id: schema.shopifyProducts.id, title: schema.shopifyProducts.title, storeId: schema.shopifyProducts.storeId,
    productType: schema.shopifyProducts.productType, templateId: schema.shopifyProducts.templateId,
    pers: schema.shopifyProducts.personalization, seller: schema.stores.sellerId,
    gid: schema.shopifyProducts.shopifyProductId,
  }).from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));
  if (!rows.length) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  if (action === "read") {
    // Mở modal lên là thấy đúng cái listing ĐANG dùng, để sửa tiếp chứ không phải gõ lại từ đầu.
    const first = rows.find((r) => r.id === ids[0]) ?? rows[0];
    let own = Array.isArray(first.pers);
    let fields: PQ[] = own ? payloadOf(first.pers) : [];
    let source: "product" | "template" | "none" = own ? "product" : "none";
    let templateName = "";
    // v171 · NULL nhưng sản phẩm được đẩy sang từ Etsy và listing gốc đã khai ô → bộ của seller
    // là bộ đang chạy thật trên Shopify (push-shopify đã ghi metafield). Nhận làm bộ RIÊNG luôn
    // (ghi vào shopify_products) để modal, push-personalization và template nhìn cùng một sự thật.
    if (!own && first.gid) {
      const [src] = await db.select({ pers: schema.etsyProducts.personalization })
        .from(schema.etsyProducts).where(eq(schema.etsyProducts.shopifyProductId, first.gid)).limit(1);
      const f = src ? payloadOf(src.pers) : [];
      if (f.length) {
        await db.update(schema.shopifyProducts)
          .set({ personalization: f, updatedAt: new Date() })
          .where(eq(schema.shopifyProducts.id, first.id));
        own = true; fields = f; source = "product";
      }
    }
    if (!own) {
      const tpls = await db.select().from(schema.shopifyTemplates);
      const t = tplFor(tpls, first.storeId, first.productType, first.templateId);
      if (t) {
        templateName = t.name;
        fields = payloadOf(t.personalization);
        if (fields.length) source = "template";
      }
    }
    // Bao nhiêu listing trong lô đã có bộ riêng — để cảnh báo trước khi ghi đè cả lô.
    const withOwn = rows.filter((r) => Array.isArray(r.pers)).length;
    return NextResponse.json({ ok: true, fields, source, templateName, title: first.title, count: rows.length, withOwn });
  }

  if (action === "clear") {
    await db.update(schema.shopifyProducts)
      .set({ personalization: null, updatedAt: new Date() })
      .where(inArray(schema.shopifyProducts.id, ids));
    return NextResponse.json({ ok: true, done: ids.length, cleared: true });
  }

  // save
  const fields = payloadOf(b?.fields);
  const bad = (Array.isArray(b?.fields) ? b.fields.length : 0) - fields.length;
  await db.update(schema.shopifyProducts)
    .set({ personalization: fields, updatedAt: new Date() })
    .where(inArray(schema.shopifyProducts.id, ids));
  // dropped = field bị loại vì thiếu nhãn / dropdown rỗng / quá 5 field / quá 1 ô upload.
  return NextResponse.json({ ok: true, done: rows.length, fields, dropped: bad > 0 ? bad : 0 });
}
