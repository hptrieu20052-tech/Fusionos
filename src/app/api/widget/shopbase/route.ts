import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, desc, eq, ne } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * v409 · PUBLIC widget config — storefront ShopBase gọi về đây lấy cấu hình
 * Estimated delivery + Customize theo TỪNG sản phẩm (ShopBase sanitize mô tả nên
 * không nhúng data-attribute được; widget fetch endpoint này thay thế).
 *
 * GET /api/widget/shopbase?handle=<product-handle>
 * → { ok, delivery: { proc, us, intl, cutoff, countries } | null, customize: PQ[] }
 *
 * KHÔNG cần đăng nhập — chỉ trả dữ liệu công khai (số ngày giao + nhãn option),
 * không lộ giá vốn/credential. CORS mở * để storefront domain nào cũng gọi được.
 * Tra theo handle (unique trong store; chống trùng mẫu xuyên store đã có ở stage).
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=60, s-maxage=300",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const handle = String(req.nextUrl.searchParams.get("handle") ?? "").trim().toLowerCase().slice(0, 300);
  if (!handle) return NextResponse.json({ ok: false, error: "handle required" }, { status: 400, headers: CORS });

  const [row] = await db.select({
    templateId: schema.shopbaseProducts.templateId,
  }).from(schema.shopbaseProducts)
    .where(and(eq(schema.shopbaseProducts.handle, handle), ne(schema.shopbaseProducts.shopbaseProductId, "")))
    .orderBy(desc(schema.shopbaseProducts.updatedAt)).limit(1);

  if (!row?.templateId) return NextResponse.json({ ok: true, delivery: null, customize: [] }, { headers: CORS });

  const [tpl] = await db.select().from(schema.shopbaseTemplates).where(eq(schema.shopbaseTemplates.id, row.templateId)).limit(1);
  if (!tpl) return NextResponse.json({ ok: true, delivery: null, customize: [] }, { headers: CORS });

  const pair = (a: number | null, b: number | null): [number, number] | null =>
    a == null && b == null ? null : [a ?? (b as number), b ?? (a as number)];
  const proc = pair(tpl.shipProcMin, tpl.shipProcMax);
  const us = pair(tpl.shipUsMin, tpl.shipUsMax);
  const intl = pair(tpl.shipIntlMin, tpl.shipIntlMax);
  const countries = (tpl.shipCountries && typeof tpl.shipCountries === "object" ? tpl.shipCountries : {}) as Record<string, [number, number]>;

  const delivery = (proc || us || intl) ? {
    ...(proc ? { proc } : {}),
    ...(us ? { us } : {}),
    ...(intl ? { intl } : {}),
    ...(tpl.shipCutoffHour != null ? { cutoff: tpl.shipCutoffHour } : {}),
    ...(Object.keys(countries).length ? { countries } : {}),
  } : null;

  const customize = ((Array.isArray(tpl.personalization) ? tpl.personalization : []) as { type?: string; label?: string; required?: boolean; options?: string[]; maxChars?: number }[])
    .map((q) => ({
      type: q?.type === "dropdown" ? "dropdown" : "text",
      label: String(q?.label ?? "").trim().slice(0, 45),
      required: !!q?.required,
      options: (Array.isArray(q?.options) ? q.options : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 50),
      maxChars: Math.min(Math.max(Math.round(Number(q?.maxChars) || 0) || 100, 1), 1024),
    }))
    .filter((q) => q.label && (q.type === "text" || q.options.length))
    .slice(0, 5);

  return NextResponse.json({ ok: true, delivery, customize }, { headers: CORS });
}
