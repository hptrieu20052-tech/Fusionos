import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
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
 * Dedupe (v118): SKU duy nhất → khớp theo SKU; còn lại khớp theo title ĐÃ CHUẨN HOÁ.
 * Đã có → UPDATE đè (import lại file mới = cập nhật), chưa có → INSERT.
 * Seller chỉ import được vào store CỦA MÌNH (scope như Manage Tiktok).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  try {
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

  // Parse CSV — ÉP UTF-8 để không lỗi mã hoá (✨/emoji/dấu → "â‰¡" mojibake).
  // CSV Etsy là UTF-8; đọc thành string bằng TextDecoder utf-8 rồi mới cho XLSX parse (type:"string").
  let rows: Record<string, unknown>[];
  try {
    const text = new TextDecoder("utf-8").decode(new Uint8Array(await file.arrayBuffer()));
    const wb = XLSX.read(text, { type: "string", codepage: 65001, raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
  } catch {
    return NextResponse.json({ ok: false, error: "Cannot parse CSV — export the file from Etsy (Listings → Download CSV) and upload as-is" }, { status: 400 });
  }
  if (!rows.length) return NextResponse.json({ ok: false, error: "CSV has no rows" }, { status: 400 });
  if (!("TITLE" in rows[0])) return NextResponse.json({ ok: false, error: "Not an Etsy listings CSV (missing TITLE column)" }, { status: 400 });

  const s = (v: unknown) => String(v ?? "").trim();
  const unesc = (v: string) => v.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'");
  let inserted = 0, updated = 0, skipped = 0, renamed = 0;

  // ---- CHỐNG TRÙNG (v118) ----------------------------------------------------------------
  // Cũ: so title KHỚP TỪNG KÝ TỰ ⇒ lệch 1 ký tự là ra listing mới. Ba đường sinh trùng:
  //   1. Sửa title trên Etsy rồi export lại  2. Bản import trước lúc ép UTF-8 bị mojibake
  //   3. Dấu nháy cong ' / space không ngắt / hai space liền / ký tự zero-width.
  // Mới: khoá theo SKU trước (bền khi đổi title), không có SKU thì title ĐÃ CHUẨN HOÁ.
  // SKU chỉ được dùng làm khoá khi nó DUY NHẤT — cả trong file CSV lẫn trong store. POD hay
  // dùng chung một SKU cho nhiều listing, khoá theo SKU trùng là gộp nhầm hai sản phẩm khác nhau.
  const norm = (v: string) => v
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")   // zero-width, BOM, soft hyphen
    .replace(/[\u2018\u2019\u02BC]/g, "'")          // nháy đơn cong → thẳng
    .replace(/[\u201C\u201D]/g, '"')                // nháy kép cong → thẳng
    .replace(/[\u2010-\u2015]/g, "-")               // các loại gạch ngang → -
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const skuKey = (v: unknown) => s(v).toLowerCase();

  const data = rows.slice(0, 1000);
  // SKU xuất hiện mấy lần trong chính file CSV này
  const fileSku = new Map<string, number>();
  for (const r of data) { const k = skuKey(r.SKU); if (k) fileSku.set(k, (fileSku.get(k) ?? 0) + 1); }

  // Nạp 1 lần toàn bộ listing của store — 1 query thay vì 1 query/dòng như bản cũ.
  const existing = await db.select({ id: schema.etsyProducts.id, title: schema.etsyProducts.title, sku: schema.etsyProducts.sku })
    .from(schema.etsyProducts).where(eq(schema.etsyProducts.storeId, storeId));
  const byTitle = new Map<string, string>();
  const dbSkuCount = new Map<string, number>();
  for (const e of existing) {
    const t = norm(e.title);
    if (t && !byTitle.has(t)) byTitle.set(t, e.id);
    const k = skuKey(e.sku); if (k) dbSkuCount.set(k, (dbSkuCount.get(k) ?? 0) + 1);
  }
  const bySku = new Map<string, string>();
  for (const e of existing) { const k = skuKey(e.sku); if (k && dbSkuCount.get(k) === 1) bySku.set(k, e.id); }

  for (const r of data) {
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
    // Khoá 1: SKU — chỉ khi SKU đó DUY NHẤT cả trong file lẫn trong store (xem chú thích trên).
    const sk = skuKey(r.SKU);
    const tk = norm(title);
    let hitId: string | undefined;
    if (sk && fileSku.get(sk) === 1) hitId = bySku.get(sk);
    // Khoá 2: title đã chuẩn hoá — bắt được nháy cong / space thừa / zero-width.
    if (!hitId) hitId = byTitle.get(tk);

    if (hitId) {
      // Ghi đè cả title: listing đổi tên trên Etsy thì CẬP NHẬT, không đẻ dòng mới.
      await db.update(schema.etsyProducts).set({ ...vals, title }).where(eq(schema.etsyProducts.id, hitId));
      updated++;
      if (!byTitle.has(tk)) { byTitle.set(tk, hitId); renamed++; }
    } else {
      const [ins] = await db.insert(schema.etsyProducts).values({ storeId, title, ...vals }).returning({ id: schema.etsyProducts.id });
      inserted++;
      // Đăng ký ngay vào map: file CSV có 2 dòng cùng title thì dòng thứ 2 UPDATE, không INSERT tiếp.
      if (ins?.id) { byTitle.set(tk, ins.id); if (sk && fileSku.get(sk) === 1) bySku.set(sk, ins.id); }
    }
  }

  return NextResponse.json({ ok: true, inserted, updated, skipped, renamed, store: store.name });
  } catch (e) {
    // Lỗi thường gặp nhất: chưa chạy MIGRATION_etsy_products.sql → bảng etsy_products chưa tồn tại.
    const m = String((e as Error)?.message ?? e);
    const hint = /etsy_products|relation|does not exist|column/i.test(m)
      ? " — Bảng chưa được tạo. Chạy MIGRATION_etsy_products.sql trong Supabase SQL Editor trước."
      : "";
    return NextResponse.json({ ok: false, error: "server: " + m.slice(0, 240) + hint }, { status: 500 });
  }
}
