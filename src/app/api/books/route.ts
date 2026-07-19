import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// Book Studio hiện ADMIN-only (ổn định rồi mở quyền sau).
async function guard() {
  const s = await getSession();
  return (await can(s, "bookStudio")) ? s : null;
}

// GET /api/books — danh sách đầu sách
export async function GET() {
  if (!(await guard())) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const rows = await db.select({
    id: schema.bookTitles.id, name: schema.bookTitles.name, occasion: schema.bookTitles.occasion,
    audience: schema.bookTitles.audience, status: schema.bookTitles.status, updatedAt: schema.bookTitles.updatedAt,
  }).from(schema.bookTitles).orderBy(desc(schema.bookTitles.updatedAt));
  return NextResponse.json({ ok: true, titles: rows });
}

// POST /api/books — tạo đầu sách từ concept đã chọn
export async function POST(req: NextRequest) {
  const s = await guard();
  if (!s) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const name = String(b?.name ?? "").trim();
  if (!name) return NextResponse.json({ ok: false, error: "Thiếu tên sách" }, { status: 400 });
  const [row] = await db.insert(schema.bookTitles).values({
    name,
    occasion: b.occasion ? String(b.occasion) : null,
    audience: b.audience ? String(b.audience) : null,
    status: "idea",
    concept: b.concept ?? null,
    brief: b.brief ?? null,
    productKey: b.productKey ? String(b.productKey) : null,
    ownerId: s.sub,
  }).returning({ id: schema.bookTitles.id });
  return NextResponse.json({ ok: true, id: row.id });
}
