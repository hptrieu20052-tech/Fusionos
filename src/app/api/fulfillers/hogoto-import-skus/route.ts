import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { listHogotoProducts } from "@/lib/hogoto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { fulfillerId } — kéo catalog Hogoto POD (GET /v1/product) → thêm SKU mapping mới.
 * Mỗi variation = 1 dòng:
 *   internalSku      = SKU variation (vd "EBDGHPIL_12 X 16 INCH")
 *   fulfillerSku     = Product Code (vd "P201")  ← adapter dùng làm productCode
 *   variant          = Size (vd "12 x 16 inch")
 *   extraJson        = { productType, positionCode, colorCode: "AS_DESIGN", size }
 * Trả kèm rawSample để chỉnh field nếu Hogoto trả cấu trúc khác.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.fulfillerId) return NextResponse.json({ ok: false, error: "missing fulfillerId" }, { status: 400 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller doesn't exist" }, { status: 404 });
  const c = (ff.credentials ?? {}) as { apiKey?: string; tenant?: string };
  if (!c.apiKey) return NextResponse.json({ ok: false, error: "Hogoto API Key chưa cấu hình (Settings → Fulfillers → API token / key)" }, { status: 400 });

  let out;
  try {
    out = await listHogotoProducts({ endpoint: ff.apiEndpoint ?? "https://seller.hogotopod.com/api", apiKey: c.apiKey, tenant: c.tenant || "fulfillment" });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 500 });
  }

  const existing = await db.select({ sku: schema.skuMappings.internalSku }).from(schema.skuMappings).where(eq(schema.skuMappings.fulfillerId, ff.id));
  const have = new Set(existing.map((x) => x.sku));

  let created = 0, skipped = 0;
  const seen = new Set<string>();
  const toInsert: (typeof schema.skuMappings.$inferInsert)[] = [];
  for (const r of out.rows) {
    if (!r.sku || have.has(r.sku) || seen.has(r.sku)) { skipped++; continue; }
    seen.add(r.sku);
    toInsert.push({
      internalSku: r.sku,
      fulfillerId: ff.id,
      fulfillerSku: r.productCode,                    // adapter → productCode
      fulfillerProduct: r.name?.slice(0, 200) || null,
      productType: r.productType?.slice(0, 120) || null,
      variant: r.size?.slice(0, 120) || null,
      baseCost: (r.baseCost ?? 0).toFixed(2),
      shipCost: (r.shipCost ?? 0).toFixed(2),
      extraJson: { productType: r.productType || null, positionCode: r.positionCode || "CENTER", colorCode: "AS_DESIGN", size: r.size || null },
    });
  }

  // GHI THEO LÔ. Bản cũ insert từng dòng một: catalog vài trăm variant = vài trăm lượt đi/về
  // Supabase → vượt maxDuration, Vercel trả 504 (trang HTML) và UI chỉ hiện "network".
  // Lô hỏng thì hạ xuống ghi từng dòng CỦA LÔ ĐÓ để 1 dòng lỗi không giết cả lô.
  for (let i = 0; i < toInsert.length; i += 200) {
    const chunk = toInsert.slice(i, i + 200);
    try {
      await db.insert(schema.skuMappings).values(chunk);
      created += chunk.length;
    } catch {
      for (const v of chunk) {
        try { await db.insert(schema.skuMappings).values(v); created++; } catch { skipped++; }
      }
    }
  }

  // Không parse được sản phẩm nào → nhiều khả năng field JSON khác → trả mẫu để chỉnh.
  const note = out.count === 0 || out.rows.length === 0
    ? `Không đọc được product từ Hogoto (count=${out.count}). Cấu trúc JSON có thể khác — gửi admin mẫu này: ${JSON.stringify(out.sample).slice(0, 800)}`
    : undefined;

  return NextResponse.json({ ok: true, found: out.rows.length, created, skipped, products: out.count, note });
}
