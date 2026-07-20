import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { scopeOwnerIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

// Book Studio hiện ADMIN-only (ổn định rồi mở quyền sau).
async function guard() {
  const s = await getSession();
  return (await can(s, "bookStudio")) ? s : null;
}

// GET /api/books — danh sách đầu sách.
// PHẠM VI theo cấu hình Permissions (resource "bookStudio"): View full = tất cả · View team's = book của
// người cùng team · Own only = book của mình. Admin luôn full.
export async function GET() {
  const s = await guard();
  if (!s) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const scopeIds = await scopeOwnerIds(s, "bookStudio");
  const own = !!scopeIds;
  const { eq, inArray } = await import("drizzle-orm");
  const rows = await db.select({
    id: schema.bookTitles.id, name: schema.bookTitles.name, occasion: schema.bookTitles.occasion,
    audience: schema.bookTitles.audience, status: schema.bookTitles.status, kind: schema.bookTitles.kind,
    sourceId: schema.bookTitles.sourceId, updatedAt: schema.bookTitles.updatedAt, createdAt: schema.bookTitles.createdAt,
    ownerId: schema.bookTitles.ownerId, ownerName: schema.users.fullName,
  }).from(schema.bookTitles)
    .leftJoin(schema.users, eq(schema.users.id, schema.bookTitles.ownerId))
    .where(scopeIds && scopeIds.length ? inArray(schema.bookTitles.ownerId, scopeIds) : undefined)
    .orderBy(desc(schema.bookTitles.updatedAt));
  // Danh sách owner (seller) cho filter — chỉ hữu ích với admin (own thì luôn là chính mình).
  const seen = new Set<string>();
  const owners: { id: string; name: string }[] = [];
  for (const r of rows) {
    if (r.ownerId && !seen.has(r.ownerId)) { seen.add(r.ownerId); owners.push({ id: r.ownerId, name: r.ownerName ?? "?" }); }
  }
  owners.sort((a, z) => a.name.localeCompare(z.name));
  return NextResponse.json({ ok: true, titles: rows, owners, scoped: own });
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
