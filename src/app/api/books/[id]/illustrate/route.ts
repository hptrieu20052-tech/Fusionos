import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { orGenerateImage, buildMasterPrompt, resolveVars, BookBible } from "@/lib/ai/openrouter";
import { readFile, writeFile, fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/books/[id]/illustrate { pageNo, model } — vẽ 1 trang bằng brief + ảnh reference nhân vật.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const pageNo = Number(b?.pageNo);
  if (!pageNo) return NextResponse.json({ ok: false, error: "pageNo required" }, { status: 400 });

  const [title] = await db.select().from(schema.bookTitles).where(eq(schema.bookTitles.id, params.id)).limit(1);
  if (!title) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const [page] = await db.select().from(schema.bookPages)
    .where(and(eq(schema.bookPages.titleId, params.id), eq(schema.bookPages.pageNo, pageNo))).limit(1);
  if (!page) return NextResponse.json({ ok: false, error: "page not found" }, { status: 404 });

  try {
    // Ảnh reference: gộp ảnh nhân vật (legacy) + ẢNH của các BIẾN kiểu image (bé/bố/mẹ…). Tối đa 4, thu nhỏ 768px.
    const refKeys: string[] = [];
    if (title.characterRefKey) refKeys.push(title.characterRefKey);
    for (const v of (Array.isArray(title.vars) ? (title.vars as { type?: string; imageKey?: string }[]) : [])) {
      if (v && v.type === "image" && v.imageKey && !refKeys.includes(v.imageKey)) refKeys.push(v.imageKey);
    }
    const refs: string[] = [];
    for (const key of refKeys.slice(0, 4)) {
      try {
        const buf = await readFile(key);
        let refBuf = buf;
        try {
          const sharp = (await import("sharp")).default;
          refBuf = await sharp(buf).rotate().resize(768, 768, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
        } catch { /* resize lỗi → dùng ảnh gốc */ }
        refs.push(`data:image/jpeg;base64,${refBuf.toString("base64")}`);
      } catch { /* đọc ảnh lỗi → bỏ qua ref này */ }
    }
    // PROMPT CHI TIẾT: dùng prompt_template đã ráp (Bước 2) nếu có; nếu chưa thì ráp tại chỗ từ Bible + brief + text.
    const baked = b?.baked !== false;
    const rawPrompt = (page.promptTemplate ?? "").trim() || buildMasterPrompt({
      bookName: title.name,
      bible: (title.bible ?? null) as BookBible | null,
      brief: page.illustrationBrief ?? "",
      text: page.textTemplate ?? "",
      hasRef: refs.length > 0,
      baked,
    });
    // THAY BIẾN: title.vars + override từ request (vd previewName → {name}) → prompt cuối cùng gửi model.
    type Var = { key: string; value?: string };
    const titleVars = Array.isArray(title.vars) ? (title.vars as Var[]) : [];
    const reqVars = Array.isArray(b?.vars) ? (b.vars as Var[]) : [];
    const mergedVars = [...titleVars.filter((v) => !reqVars.some((r) => r.key === v.key)), ...reqVars];
    const prompt = resolveVars(rawPrompt, mergedVars);

    // Kích thước in: Page 3450×2550 (tỉ lệ 23:17). Cover 7470×3000 (~2.49:1) — làm ở khâu cover riêng.
    // Sinh đúng TỈ LỆ; số px chính xác resize ở khâu Export.
    // KHÔNG ép 2K để tránh vượt ~100s gateway timeout (502). Sinh đúng TỈ LỆ ở size mặc định model → nhanh hơn;
    // số px in chính xác (3450×2550) sẽ upscale ở khâu Export.
    const model = b?.model ? String(b.model) : undefined;
    // Dùng tỉ lệ CHUẨN 4:3 (gần 23:17, mọi model nhận) để tránh model treo với tỉ lệ lạ; crop đúng 3450×2550 ở Export.
    const img = await orGenerateImage(prompt, refs, { model, outputFormat: "png", aspectRatio: "4:3" });

    const key = `book-illustrations/${params.id}-p${pageNo}-${Date.now()}.png`;
    await writeFile(key, Buffer.from(img.b64, "base64"), img.mediaType || "image/png");

    // 1 ảnh/trang: xoá cũ, chèn mới
    await db.delete(schema.bookAssets).where(and(eq(schema.bookAssets.titleId, params.id), eq(schema.bookAssets.pageNo, pageNo)));
    await db.insert(schema.bookAssets).values({ titleId: params.id, pageNo, storageKey: key, model: model ?? null });
    if (title.status === "script") await db.update(schema.bookTitles).set({ status: "simulation", updatedAt: new Date() }).where(eq(schema.bookTitles.id, params.id));

    return NextResponse.json({ ok: true, pageNo, url: fileUrl(key), cost: img.cost });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 502 });
  }
}
