import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { readFile, writeFile } from "@/lib/storage";
import { getBookProduct, coverPanelW } from "@/lib/book-products";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/books/import-from-design { sku, productKey, name? }
// IMPORT DESIGN CÓ SẴN từ Design Studio (theo Design ID #SKU) → thành MASTER trong tab Custom books.
// Map file in theo kind: cover_front → 0 · back_cover → -1 · page_01..24 → 1..24 · book_cover (wraparound liền) → cắt đôi thành 0 + -1.
// Ảnh tham chiếu thẳng storage key của design (storage không bao giờ xoá file — an toàn).
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s || !(await can(s, "bookStudio"))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const sku = Number(b?.sku);
  if (!Number.isFinite(sku) || sku <= 0) return NextResponse.json({ ok: false, error: "Nhập Design ID (#SKU) hợp lệ" }, { status: 400 });
  const product = getBookProduct(b?.productKey ? String(b.productKey) : null);

  const [design] = await db.select().from(schema.designs).where(eq(schema.designs.skuCode, sku)).limit(1);
  if (!design) return NextResponse.json({ ok: false, error: `Không tìm thấy design #${sku} trong Design Studio` }, { status: 404 });

  const files = await db.select({
    kind: schema.designFiles.kind, storageKey: schema.designFiles.storageKey,
    width: schema.designFiles.width, height: schema.designFiles.height,
  }).from(schema.designFiles).where(eq(schema.designFiles.designId, design.id)).orderBy(desc(schema.designFiles.createdAt));

  // 1 file / slot — file mới nhất thắng (orderBy desc → gặp đầu tiên là mới nhất).
  const bySlot = new Map<number, string>();
  let bookCoverKey: string | null = null;
  for (const f of files) {
    const k = f.kind;
    if (k === "mockup" || k === "video") continue;
    if (k === "book_cover") { if (!bookCoverKey) bookCoverKey = f.storageKey; continue; }
    let slot: number | null = null;
    if (k === "cover_front") slot = 0;
    else if (k === "back_cover") slot = -1;
    else { const m = k.match(/^page_(\d{1,2})$/); if (m) { const n = parseInt(m[1], 10); if (n >= 1 && n <= product.pageCount) slot = n; } }
    if (slot !== null && !bySlot.has(slot)) bySlot.set(slot, f.storageKey);
  }
  if (!bySlot.size && !bookCoverKey) {
    return NextResponse.json({ ok: false, error: `Design #${sku} chưa có file in dạng cover_front / back_cover / page_01..${String(product.pageCount).padStart(2, "0")} (hoặc book_cover). Upload file theo các mặt đó trong Design Studio trước.` }, { status: 400 });
  }

  // book_cover = wraparound LIỀN → cắt đôi thành front (phải) + back (trái), chỉ khi chưa có cover_front/back riêng.
  const assetRows: { pageNo: number; storageKey: string }[] = [];
  if (bookCoverKey && (!bySlot.has(0) || !bySlot.has(-1))) {
    try {
      const sharp = (await import("sharp")).default;
      const buf = await readFile(bookCoverKey);
      const full = await sharp(buf).resize(product.coverW, product.coverH, { fit: "fill" }).png().toBuffer();
      const cw = coverPanelW(product);
      const back = await sharp(full).extract({ left: 0, top: 0, width: cw, height: product.coverH }).png().toBuffer();
      const front = await sharp(full).extract({ left: cw, top: 0, width: product.coverW - cw, height: product.coverH }).png().toBuffer();
      const stamp = Date.now();
      const fKey = `book-illustrations/import-${design.id}-front-${stamp}.png`;
      const bKey = `book-illustrations/import-${design.id}-back-${stamp}.png`;
      await writeFile(fKey, front, "image/png");
      await writeFile(bKey, back, "image/png");
      if (!bySlot.has(0)) assetRows.push({ pageNo: 0, storageKey: fKey });
      if (!bySlot.has(-1)) assetRows.push({ pageNo: -1, storageKey: bKey });
    } catch (e) {
      return NextResponse.json({ ok: false, error: "Cắt book_cover lỗi: " + String((e as Error)?.message ?? e).slice(0, 200) }, { status: 502 });
    }
  }
  bySlot.forEach((storageKey, pageNo) => assetRows.push({ pageNo, storageKey }));

  const name = String(b?.name ?? "").trim() || design.title || `Design #${sku}`;
  const [row] = await db.insert(schema.bookTitles).values({
    name,
    status: "ready",
    kind: "master",
    productKey: product.key,
    concept: { importedFromSku: sku, designId: design.id },
    // Biến mặc định — user sửa lại trong màn chi tiết: value = GIÁ TRỊ GỐC đang in trong design (VD "Sadie").
    vars: [{ key: "name", label: "Child's name", type: "text", value: "" }],
    ownerId: s.sub,
  }).returning({ id: schema.bookTitles.id });

  // Trang ruột rỗng (không có script — remake đi theo ảnh gốc, không theo prompt).
  await db.insert(schema.bookPages).values(
    Array.from({ length: product.pageCount }, (_, i) => ({ titleId: row.id, pageNo: i + 1, textTemplate: null, illustrationBrief: null, promptTemplate: null })),
  );
  if (assetRows.length) {
    await db.insert(schema.bookAssets).values(assetRows.map((a) => ({ titleId: row.id, pageNo: a.pageNo, storageKey: a.storageKey, model: "imported" })));
  }

  // Slot còn thiếu — báo để user biết block nào chưa customize được.
  const have = new Set(assetRows.map((a) => a.pageNo));
  const missing: string[] = [];
  if (!have.has(0)) missing.push("cover_front");
  if (!have.has(-1)) missing.push("back_cover");
  for (let i = 1; i <= product.pageCount; i++) if (!have.has(i)) missing.push(String(i));

  return NextResponse.json({ ok: true, id: row.id, mapped: assetRows.length, missing });
}
