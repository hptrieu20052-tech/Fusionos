import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, asc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// POST /api/books/[id]/clone { customer? } — NHÂN BẢN từ SCALE DESIGN thành bản cho khách:
// giữ nguyên Bible/cover/script/prompt/product; XÓA giá trị biến + ảnh khách (điền của khách mới rồi Draw all).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await getSession();
  if (!s || !(await can(s, "bookStudio"))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const [src] = await db.select().from(schema.bookTitles).where(eq(schema.bookTitles.id, params.id)).limit(1);
  if (!src) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const customer = String(b?.customer ?? "").trim();
  const name = customer ? `${src.name} — ${customer}` : `${src.name} — Customer copy`;

  // Biến: giữ key/label/type, XÓA value + ảnh (khách mới điền/upload của họ).
  const vars = (Array.isArray(src.vars) ? (src.vars as { key: string; label?: string; type?: string }[]) : [])
    .map((v) => ({ key: v.key, label: v.label ?? "", type: v.type === "image" ? "image" : "text", value: "" }));

  const [row] = await db.insert(schema.bookTitles).values({
    name,
    occasion: src.occasion, audience: src.audience,
    status: "script",
    kind: null,                    // bản khách nằm ở khu Drafts/đang làm
    sourceId: src.id,              // nhớ master gốc → mở lại màn Customize + remake theo ảnh gốc
    productKey: src.productKey,
    concept: src.concept, brief: src.brief,
    bible: src.bible, cover: src.cover,
    vars,
    characterRefKey: null,         // ảnh nhân vật của khách mới
    stylePrompt: src.stylePrompt,
    ownerId: s.sub,
  }).returning({ id: schema.bookTitles.id });

  // Copy toàn bộ trang (text/brief/prompt đã ráp — còn nguyên placeholder {name}…).
  const pages = await db.select().from(schema.bookPages).where(eq(schema.bookPages.titleId, params.id)).orderBy(asc(schema.bookPages.pageNo));
  if (pages.length) {
    await db.insert(schema.bookPages).values(pages.map((p) => ({
      titleId: row.id, pageNo: p.pageNo, textTemplate: p.textTemplate, illustrationBrief: p.illustrationBrief, promptTemplate: p.promptTemplate,
    })));
  }
  return NextResponse.json({ ok: true, id: row.id });
}
