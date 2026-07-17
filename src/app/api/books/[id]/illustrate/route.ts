import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { orGenerateImage } from "@/lib/ai/openrouter";
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
    // Ảnh reference → base64 data URL (khỏi phụ thuộc URL công khai của R2)
    const refs: string[] = [];
    if (title.characterRefKey) {
      const buf = await readFile(title.characterRefKey);
      refs.push(`data:image/png;base64,${buf.toString("base64")}`);
    }
    const style = (title.stylePrompt ?? "").trim();
    const prompt = [
      page.illustrationBrief ?? "",
      style ? `Art style: ${style}.` : "Children's book illustration style.",
      refs.length ? "Keep the SAME main character (baby) design, face and style as the reference image, consistent across pages." : "",
      "Compose with the main character in the upper-center area and leave a calmer, less-busy space in the bottom third for a text caption to be overlaid later.",
      "No text, letters or words in the image.",
    ].filter(Boolean).join(" ");

    // Kích thước in: Page 3450×2550 (tỉ lệ 23:17). Cover 7470×3000 (~2.49:1) — làm ở khâu cover riêng.
    // Sinh đúng TỈ LỆ; số px chính xác resize ở khâu Export.
    const model = b?.model ? String(b.model) : undefined;
    const img = await orGenerateImage(prompt, refs, { model, outputFormat: "png", aspectRatio: "23:17", resolution: "2K" });

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
