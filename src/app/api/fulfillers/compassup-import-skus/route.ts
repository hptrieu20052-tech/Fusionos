import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { getCompassupProduct, type CompassupCred } from "@/lib/compassup";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function credOf(ff: { apiEndpoint: string | null; credentials: unknown }): CompassupCred | null {
  const c = (ff.credentials ?? {}) as Record<string, string>;
  const token = c.bearerToken || c.apiKey || c.accessToken;
  if (!token || !c.tenant || !c.restKey) return null;
  return { bearerToken: token, tenant: c.tenant, restKey: c.restKey, endpoint: ff.apiEndpoint, username: c.username };
}

/**
 * POST — 2 chế độ:
 *  A) { fulfillerId, link }              → FETCH: gọi /product/detail, trả variants để UI chọn.
 *  B) { fulfillerId, link, rows: [...] } → SAVE : tạo mapping cho các variant đã chọn.
 *       rows[] = { skuId, internalSku, baseCost, shipCost?, weight, attribute, image, productName }
 *
 * Mapping lưu field riêng Compassup vào extra_json:
 *   { link, sup_site, seller_id, weight, sku_id, product_id, product_name, image_link, declaration_title }
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.fulfillerId || !b?.link) return NextResponse.json({ ok: false, error: "missing fulfillerId / link" }, { status: 400 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller doesn't exist" }, { status: 404 });
  const cred = credOf(ff);
  if (!cred) return NextResponse.json({ ok: false, error: "Compassup credentials missing (bearerToken / tenant / restKey)" }, { status: 400 });

  let product;
  try {
    product = await getCompassupProduct(cred, String(b.link).trim());
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 502 });
  }
  if (!product) return NextResponse.json({ ok: false, error: "Compassup không trả sản phẩm cho link này (kiểm tra lại link)" }, { status: 404 });

  // ---- Chế độ A: chỉ FETCH variants ----
  if (!Array.isArray(b.rows)) {
    // đánh dấu variant đã có mapping để UI ẩn/hiện
    const existing = await db.select({ extra: schema.skuMappings.extraJson })
      .from(schema.skuMappings).where(eq(schema.skuMappings.fulfillerId, ff.id));
    const mappedSkuIds = new Set(existing.map((x) => (x.extra as Record<string, unknown> | null)?.sku_id).filter(Boolean) as string[]);
    return NextResponse.json({
      ok: true, mode: "fetch",
      product: {
        pid: product.pid, productId: product.productId, title: product.titleTrans,
        marketplace: product.marketplace, sellerId: product.sellerId, images: product.images.slice(0, 1),
        skus: product.skus.map((s) => ({ ...s, alreadyMapped: mappedSkuIds.has(s.sku_id) })),
      },
    });
  }

  // ---- Chế độ B: SAVE mappings ----
  const rows = b.rows as { skuId: string; internalSku: string; baseCost: number; shipCost?: number; weight?: number; attribute?: string; image?: string; productName?: string; custom?: boolean }[];
  let created = 0; const errors: string[] = [];
  for (const r of rows) {
    if (!r.internalSku?.trim() || !r.skuId) { errors.push(`${r.internalSku || r.skuId}: missing internalSku`); continue; }
    const sku = product.skus.find((s) => s.sku_id === r.skuId);
    const extra = {
      link: String(b.link).trim(),
      sup_site: product.marketplace || "b2b_cn",
      seller_id: product.sellerId,
      product_id: product.productId,
      sku_id: r.skuId,
      product_name: r.productName || product.titleTrans,
      declaration_title: r.productName || product.titleTrans,
      image_link: r.image || sku?.image || product.images[0] || "",
      attribute: r.attribute || sku?.attribute || "",
      weight: Number(r.weight ?? sku?.weight ?? 0) || 0,
      custom: !!r.custom, // SKU cần gửi file design (thêu tên) → đơn phải có DesignId
    };
    try {
      // upsert theo (internalSku, fulfillerId)
      await db.insert(schema.skuMappings).values({
        internalSku: r.internalSku.trim(), fulfillerId: ff.id,
        productType: extra.product_name,
        fulfillerSku: r.skuId, fulfillerProduct: extra.product_name, fulfillerProductId: product.productId,
        variant: extra.attribute, baseCost: Number(r.baseCost).toFixed(2), shipCost: Number(r.shipCost ?? 0).toFixed(2),
        extraJson: extra,
      }).onConflictDoUpdate({
        target: [schema.skuMappings.internalSku, schema.skuMappings.fulfillerId],
        set: {
          productType: extra.product_name,
          fulfillerSku: r.skuId, fulfillerProduct: extra.product_name, fulfillerProductId: product.productId,
          variant: extra.attribute, baseCost: Number(r.baseCost).toFixed(2), shipCost: Number(r.shipCost ?? 0).toFixed(2),
          extraJson: extra, active: true,
        },
      });
      created++;
    } catch (e) { errors.push(`${r.internalSku}: ${String((e as Error)?.message ?? e).slice(0, 80)}`); }
  }
  return NextResponse.json({ ok: errors.length === 0, created, errors });
}
