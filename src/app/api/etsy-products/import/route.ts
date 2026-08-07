import { NextRequest, NextResponse } from "next/server";
import { titleKey } from "@/lib/title-key";
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

  // ---- CHONG TRUNG (v118 -> v180 "tron ven") -----------------------------------------
  // Etsy CHO PHEP nhieu listing cung title, va CSV Etsy KHONG co listing_id, nen nhan dien theo:
  //   1. SKU duy nhat (ca trong file lan trong store)                    -> UPDATE
  //   2. titleKey + MA ANH IMAGE1 (il_xxx.<photoid> vinh vien theo anh
  //      da upload; listing khac nhau luon khac ma anh)                  -> UPDATE
  //      (bat duoc ca title mojibake: "Children<a-euro-tm>s" == "Children's")
  //   3. titleKey 1-doi-1 (store dung 1 ban, file dung 1 dong cung key)  -> UPDATE
  //      (seller doi anh chinh roi export lai — khong co gi de nham)
  //   4. Con lai (cung title nhung anh khac, hoac nhieu ban mo ho)       -> INSERT
  //      — phan chieu dung thuc te Etsy, KHONG gop bay 2 listing that.
  const norm = titleKey;
  const skuKey = (v: unknown) => s(v).toLowerCase();
  // Ma anh on dinh tu URL Etsy CDN: il_fullxfull.8384941631_55uu / il_570xN.8384941631 -> "8384941631"
  const imgKey = (u: unknown) => { const t = s(u); const m = /il_[^./]+\.(\d{6,})/i.exec(t); return m ? m[1] : t; };

  const data = rows.slice(0, 1000);
  // SKU / titleKey xuat hien may lan trong CHINH file nay (de biet truong hop mo ho)
  const fileSku = new Map<string, number>();
  const fileTitle = new Map<string, number>();
  for (const r of data) {
    const k = skuKey(r.SKU); if (k) fileSku.set(k, (fileSku.get(k) ?? 0) + 1);
    const t = norm(s(r.TITLE)); if (t) fileTitle.set(t, (fileTitle.get(t) ?? 0) + 1);
  }

  // Nap 1 lan toan bo listing cua store (kem IMAGE1) — 1 query.
  const existing = await db.select({ id: schema.etsyProducts.id, title: schema.etsyProducts.title, sku: schema.etsyProducts.sku, images: schema.etsyProducts.images })
    .from(schema.etsyProducts).where(eq(schema.etsyProducts.storeId, storeId));
  const byTitle = new Map<string, { id: string; img: string; title: string }[]>();
  const dbSkuCount = new Map<string, number>();
  for (const e of existing) {
    const t = norm(e.title);
    const img0 = imgKey(Array.isArray(e.images) ? (e.images as unknown[])[0] : "");
    if (t) { const a = byTitle.get(t) ?? []; a.push({ id: e.id, img: img0, title: e.title }); byTitle.set(t, a); }
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
    const sk = skuKey(r.SKU);
    const tk = norm(title);
    const img0 = imgKey(images[0] ?? "");
    const cands = byTitle.get(tk) ?? [];
    let hitId: string | undefined;
    // Khoa 1: SKU duy nhat
    if (sk && fileSku.get(sk) === 1) hitId = bySku.get(sk);
    // Khoa 2: titleKey + anh IMAGE1 trung ma
    if (!hitId && img0) { const m = cands.find((c) => c.img && c.img === img0); if (m) hitId = m.id; }
    // Khoa 3: 1-doi-1 khong mo ho (doi anh chinh)
    if (!hitId && cands.length === 1 && (fileTitle.get(tk) ?? 0) <= 1) hitId = cands[0].id;

    if (hitId) {
      // Ghi de ca title: mojibake/doi ten -> CAP NHAT ban cu, khong de dong moi.
      const c = cands.find((x) => x.id === hitId);
      if (c && c.title !== title) renamed++;
      await db.update(schema.etsyProducts).set({ ...vals, title }).where(eq(schema.etsyProducts.id, hitId));
      updated++;
      if (c) { c.img = img0; c.title = title; }
      else { cands.push({ id: hitId, img: img0, title }); byTitle.set(tk, cands); }
    } else {
      // Cung title nhung anh khac = listing THAT khac nhau tren Etsy -> giu rieng.
      const [ins] = await db.insert(schema.etsyProducts).values({ storeId, title, ...vals }).returning({ id: schema.etsyProducts.id });
      inserted++;
      if (ins?.id) {
        cands.push({ id: ins.id, img: img0, title }); byTitle.set(tk, cands);
        if (sk && fileSku.get(sk) === 1) bySku.set(sk, ins.id);
      }
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
