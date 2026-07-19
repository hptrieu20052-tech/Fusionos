import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { generateBookScript } from "@/lib/ai/openrouter";
import { getBookProduct, genBlocks } from "@/lib/book-products";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/books/[id]/script { pages?, vars? } — AI sinh kịch bản từ concept của title, ghi đè book_pages.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await getSession();
  if (!(await can(s, "bookStudio"))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const [title] = await db.select().from(schema.bookTitles).where(eq(schema.bookTitles.id, params.id)).limit(1);
  if (!title) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const concept = (title.concept ?? {}) as { angle?: string; outline?: string[] };
  const briefObj = (title.brief ?? {}) as { pages?: number };
  // Tổng số trang CHUẨN theo SẢN PHẨM (Hardcover = 24). request > product > brief > 12.
  const product = getBookProduct(title.productKey);
  const total = Number(b?.pages) || product.pageCount || Number(briefObj.pages) || 12;
  // SINH THEO LÔ: client gọi nhiều lần với {from,to} để không timeout khi sách nhiều trang.
  const from = Math.max(1, Number(b?.from) || 1);
  const to = Math.min(total, Number(b?.to) || total);
  const replace = b?.replace !== false && from <= 1; // lô đầu (from=1) mới xoá kịch bản cũ
  // Cặp SPREAD theo sản phẩm (2+3, 4+5…): AI dồn text về 1 trang/cặp, chủ thể chính nằm nửa không chữ.
  const spreadPairs = genBlocks(product).filter((x) => x.type === "spread").map((x) => (x as { pages: [number, number] }).pages)
    .filter(([a, bb]) => bb >= from && a <= to);
  try {
    const pages = await generateBookScript(
      { name: title.name, angle: concept.angle, outline: concept.outline },
      { pages: total, from, to, vars: Array.isArray(b?.vars) ? b.vars : undefined, model: b?.model ? String(b.model) : undefined, spreadPairs },
    );
    if (replace) await db.delete(schema.bookPages).where(eq(schema.bookPages.titleId, params.id));
    if (pages.length) {
      await db.insert(schema.bookPages).values(pages.map((p) => ({
        titleId: params.id, pageNo: p.page_no, textTemplate: p.text, illustrationBrief: p.illustration,
      })));
    }
    await db.update(schema.bookTitles).set({ status: "script", updatedAt: new Date() }).where(eq(schema.bookTitles.id, params.id));
    return NextResponse.json({ ok: true, pages, total });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 502 });
  }
}
