import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { listLenfulProducts, getLenfulProduct, type LenfulCred } from "@/lib/lenful";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { fulfillerId } — kéo catalog Lenful → UPSERT skuMappings. 2 PHA (resumable, bấm lại để chạy tiếp):
 * 1) List /api/product (variant MẶC ĐỊNH mỗi sản phẩm) → phủ nhanh toàn bộ ~700 sản phẩm.
 * 2) Với sản phẩm CHƯA mở rộng (mới có ≤1 dòng mapping), GET /api/product/:id lấy MẢNG variants đầy đủ
 *    (mỗi màu/size 1 SKU riêng vd LFCF28MEU38/US3.5) — chạy trong ngân sách ~35s, còn thiếu thì bấm nút lần nữa.
 * Giá base = base_cost (nếu >0) else price; KHÔNG đè giá đã sửa tay (chỉ set khi insert).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.fulfillerId) return NextResponse.json({ ok: false, error: "missing fulfillerId" }, { status: 400 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller doesn't exist" }, { status: 404 });
  const c = (ff.credentials ?? {}) as Record<string, string>;
  const userName = c.userName || c.user_name || c.identifier || "";
  const password = c.password || c.apiKey || "";
  if (!userName || !password) return NextResponse.json({ ok: false, error: "Lenful cần Identifier (user_name) + API Key (password) trong Settings" }, { status: 400 });
  const cred: LenfulCred = { endpoint: ff.apiEndpoint, userName, password };

  const start = Date.now();
  const cost = (v?: { base_cost?: number; price?: number }) => {
    const bc = Number(v?.base_cost) || 0; const p = Number(v?.price) || 0;
    return (bc > 0 ? bc : p).toFixed(2);
  };

  try {
    // ---- Pha 1: list toàn bộ sản phẩm (variant mặc định) ----
    const products: { id: string; name: string; vd?: { sku?: string; name?: string; full_name?: string; price?: number; base_cost?: number } }[] = [];
    let totalPage = 1;
    for (let page = 1; page <= Math.min(totalPage, 8); page++) {
      const r = await listLenfulProducts(cred, page, 250);
      totalPage = r.totalPage;
      for (const p of r.data) products.push({ id: p.id, name: p.name, vd: p.variant_default });
      if (Date.now() - start > 20000) break;
    }

    const existing = await db.select({ sku: schema.skuMappings.internalSku, pid: schema.skuMappings.fulfillerProductId })
      .from(schema.skuMappings).where(eq(schema.skuMappings.fulfillerId, ff.id));
    const haveSku = new Set(existing.map((x) => x.sku));
    const countByPid = new Map<string, number>();
    for (const x of existing) if (x.pid) countByPid.set(x.pid, (countByPid.get(x.pid) ?? 0) + 1);

    let created = 0;
    const insert = async (rows: (typeof schema.skuMappings.$inferInsert)[]) => {
      for (let i = 0; i < rows.length; i += 500) {
        const r = await db.insert(schema.skuMappings).values(rows.slice(i, i + 500)).onConflictDoNothing().returning({ id: schema.skuMappings.id });
        created += r.length;
      }
    };

    const phase1: (typeof schema.skuMappings.$inferInsert)[] = [];
    for (const p of products) {
      const sku = (p.vd?.sku ?? "").trim();
      if (!sku || haveSku.has(sku)) continue;
      haveSku.add(sku);
      phase1.push({
        internalSku: sku, fulfillerId: ff.id, fulfillerSku: sku,
        productType: p.name?.slice(0, 120) || null, fulfillerProduct: p.name?.slice(0, 200) || null,
        variant: (p.vd?.full_name || p.vd?.name || "")?.slice(0, 120) || null,
        fulfillerProductId: p.id, baseCost: cost(p.vd), shipCost: "0",
      });
      countByPid.set(p.id, (countByPid.get(p.id) ?? 0) + 1);
    }
    await insert(phase1);

    // ---- Pha 2: mở rộng variants đầy đủ cho sản phẩm mới có ≤1 dòng (ngân sách thời gian, 4 luồng) ----
    const need = products.filter((p) => (countByPid.get(p.id) ?? 0) <= 1);
    let expanded = 0;
    const queue = [...need];
    const worker = async () => {
      while (queue.length && Date.now() - start < 38000) {
        const p = queue.shift(); if (!p) return;
        try {
          const d = await getLenfulProduct(cred, p.id);
          const rows: (typeof schema.skuMappings.$inferInsert)[] = [];
          for (const v of d.variants) {
            const sku = (v.sku ?? "").trim();
            if (!sku || haveSku.has(sku)) continue;
            haveSku.add(sku);
            rows.push({
              internalSku: sku, fulfillerId: ff.id, fulfillerSku: sku,
              productType: d.name?.slice(0, 120) || null, fulfillerProduct: d.name?.slice(0, 200) || null,
              variant: (v.full_name || v.name || "")?.slice(0, 120) || null,
              fulfillerProductId: p.id, baseCost: cost(v), shipCost: "0",
            });
          }
          if (rows.length) await insert(rows);
          expanded++;
        } catch { /* sản phẩm lỗi → bỏ qua, lần sau thử lại */ }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);

    const remaining = Math.max(0, need.length - expanded);
    return NextResponse.json({
      ok: true, created, found: products.length, skipped: 0,
      expanded, remaining,
      note: remaining > 0 ? `Đã mở rộng ${expanded}/${need.length} sản phẩm — bấm Update SKU lần nữa để kéo tiếp ${remaining} sản phẩm còn lại.` : "Đã kéo đủ toàn bộ variants.",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 500 });
  }
}
