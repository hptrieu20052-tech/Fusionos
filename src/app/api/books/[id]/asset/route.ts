import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { readFile } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/books/[id]/asset?page=N — tải 1 ảnh với TÊN FILE CHUẨN FULFILL:
// page 0 → cover_front.jpg · page -1 → cover_back.jpg · page N → N.jpg (nén JPG ~93 để nhẹ, đúng format bộ design).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await getSession();
  if (!(await can(s, "bookStudio"))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const pageNo = Number(req.nextUrl.searchParams.get("page"));
  if (!Number.isFinite(pageNo)) return NextResponse.json({ ok: false, error: "page required" }, { status: 400 });

  const [asset] = await db.select().from(schema.bookAssets)
    .where(and(eq(schema.bookAssets.titleId, params.id), eq(schema.bookAssets.pageNo, pageNo))).limit(1);
  if (!asset) return NextResponse.json({ ok: false, error: "not drawn" }, { status: 404 });

  try {
    const buf = await readFile(asset.storageKey);
    let jpg = buf;
    try {
      const sharp = (await import("sharp")).default;
      jpg = await sharp(buf).jpeg({ quality: 93 }).toBuffer();
    } catch { /* nén lỗi → trả nguyên gốc */ }
    const name = pageNo === 0 ? "cover_front.jpg" : pageNo === -1 ? "cover_back.jpg" : `${pageNo}.jpg`;
    return new NextResponse(new Uint8Array(jpg), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 500 });
  }
}
