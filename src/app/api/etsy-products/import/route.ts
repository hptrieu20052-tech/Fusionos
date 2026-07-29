import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/etsy-products/import — multipart { file: CSV export của Etsy, storeId }.
 * Format CSV Etsy (EtsyListingsDownload): TITLE, DESCRIPTION, PRICE, CURRENCY_CODE, QUANTITY,
 * TAGS, MATERIALS, IMAGE1..IMAGE10, VARIATION 1|2 TYPE/NAME/VALUES, SKU.
 * Dedupe theo (storeId, title): đã có → UPDATE đè (import lại file mới = cập nhật), chưa có → INSERT.
 * Seller chỉ import được vào store CỦA MÌNH (scope như Manage Tiktok).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file") as File | null;
  const storeId = String(form?.get("storeId") ?? "");
  if (!file || !/^[0-9a-f-]{36}$/i.test(storeId)) return NextResponse.json({ ok: false, error: "file + storeId required" }, { status: 400 });

  // Store phải là ETSY và thuộc phạm vi user
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!store || store.marketplace !== "etsy") return NextResponse.json({ ok: false, error: "store not found or not an Etsy store" }, { status: 400 });
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && (!store.sellerId || !scopeIds.includes(store.sellerId))) {
    return NextResponse.json({ ok: false, error: "forbidden: store is not yours" }, { status: 403 });
  }

  // Parse CSV bằng XLSX (đọc chuẩn quote/newline trong description)
  let rows: Record<string, unknown>[];
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
  } catch {
    return NextResponse.json({ ok: false, error: "Cannot parse CSV — export the file from Etsy (Listings → Download CSV) and upload as-is" }, { status: 400 });
  }
  if (!rows.length) return NextResponse.json({ ok: false, error: "CSV has no rows" }, { status: 400 });
  if (!("TITLE" in rows[0])) return NextResponse.json({ ok: false, error: "Not an Etsy listings CSV (missing TITLE column)" }, { status: 400 });

  const s = (v: unknown) => String(v ?? "").trim();
  const unesc = (v: string) => v.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'");
  let inserted = 0, updated = 0, skipped = 0;

  for (const r of rows.slice(0, 1000)) {
    const title = s(r.TITLE);
    if (!title) { skipped++; continue; }
    const images = Array.from({ length: 10 }, (_, i) => s(r[`IMAGE${i + 1}`])).filter(Boolean);
    const variations: { name: string; values: string[] }[] = [];
    for (const n of [1, 2]) {
      const name = s(r[`VARIATION ${n} NAME`]);
      const values = s(r[`VARIATION ${n} VALUES`]).split(",").map((x) => unesc(x.trim())).filter(Boolean);
      if (name && values.length) variations.push({ name, values });
    }
    const price = Number(r.PRICE);
    const vals = {
      description: s(r.DESCRIPTION) || null,
      price: Number.isFinite(price) && price > 0 ? price.toFixed(2) : null,
      currency: s(r.CURRENCY_CODE) || "USD",
      quantity: Number(r.QUANTITY) || null,
      tags: s(r.TAGS) || null,
      materials: s(r.MATERIALS) || null,
      images, variations,
      sku: s(r.SKU) || null,
      updatedAt: new Date(),
    };
    const [ex] = await db.select({ id: schema.etsyProducts.id }).from(schema.etsyProducts)
      .where(and(eq(schema.etsyProducts.storeId, storeId), eq(schema.etsyProducts.title, title))).limit(1);
    if (ex) { await db.update(schema.etsyProducts).set(vals).where(eq(schema.etsyProducts.id, ex.id)); updated++; }
    else { await db.insert(schema.etsyProducts).values({ storeId, title, ...vals }); inserted++; }
  }

  return NextResponse.json({ ok: true, inserted, updated, skipped, store: store.name });
}
