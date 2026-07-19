import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, asc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

async function guard() {
  const s = await getSession();
  return s?.role === "admin" ? s : null;
}

// GET /api/books/[id] — chi tiết đầu sách + các trang
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await guard())) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const [title] = await db.select().from(schema.bookTitles).where(eq(schema.bookTitles.id, params.id)).limit(1);
  if (!title) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const pages = await db.select({
    id: schema.bookPages.id, pageNo: schema.bookPages.pageNo,
    textTemplate: schema.bookPages.textTemplate, illustrationBrief: schema.bookPages.illustrationBrief,
    promptTemplate: schema.bookPages.promptTemplate,
  }).from(schema.bookPages).where(eq(schema.bookPages.titleId, params.id)).orderBy(asc(schema.bookPages.pageNo));
  const assetRows = await db.select({ pageNo: schema.bookAssets.pageNo, storageKey: schema.bookAssets.storageKey })
    .from(schema.bookAssets).where(eq(schema.bookAssets.titleId, params.id));
  const assets: Record<number, string | null> = {};
  for (const a of assetRows) assets[a.pageNo] = fileUrl(a.storageKey);
  // Biến ảnh: gắn URL hiển thị từ imageKey.
  const rawVars = Array.isArray(title.vars) ? (title.vars as { type?: string; imageKey?: string }[]) : [];
  const vars = rawVars.map((v) => (v && v.type === "image" && v.imageKey ? { ...v, imageUrl: fileUrl(v.imageKey) } : v));
  return NextResponse.json({ ok: true, title: { ...title, vars, characterRefUrl: fileUrl(title.characterRefKey) }, pages, assets });
}

// PATCH /api/books/[id] — sửa tên/trạng thái/concept; hoặc thay toàn bộ pages { pages:[{page_no,text,illustration}] }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await guard())) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim();
  if (typeof b.status === "string") patch.status = b.status;
  if (b.concept !== undefined) patch.concept = b.concept;
  if (b.personalization !== undefined) patch.personalization = b.personalization;
  if (typeof b.characterRefKey === "string") patch.characterRefKey = b.characterRefKey || null;
  if (typeof b.stylePrompt === "string") patch.stylePrompt = b.stylePrompt || null;
  if (b.bible !== undefined) patch.bible = b.bible;   // Style Bible (jsonb)
  if (b.cover !== undefined) patch.cover = b.cover;   // Bìa wraparound {text,brief,prompt} (jsonb)
  if (b.vars !== undefined) patch.vars = b.vars;      // biến cá nhân hoá (jsonb)
  await db.update(schema.bookTitles).set(patch).where(eq(schema.bookTitles.id, params.id));

  // Thay toàn bộ trang nếu client gửi mảng pages (giữ prompt chi tiết nếu client gửi kèm)
  if (Array.isArray(b.pages)) {
    await db.delete(schema.bookPages).where(eq(schema.bookPages.titleId, params.id));
    const rows = (b.pages as { page_no?: number; text?: string; illustration?: string; prompt?: string }[])
      .map((p, i) => ({ titleId: params.id, pageNo: Number(p.page_no) || i + 1, textTemplate: p.text ?? "", illustrationBrief: p.illustration ?? "", promptTemplate: typeof p.prompt === "string" ? p.prompt : null }));
    if (rows.length) await db.insert(schema.bookPages).values(rows);
  }
  return NextResponse.json({ ok: true });
}

// DELETE /api/books/[id]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await guard())) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  await db.delete(schema.bookTitles).where(eq(schema.bookTitles.id, params.id));
  return NextResponse.json({ ok: true });
}
