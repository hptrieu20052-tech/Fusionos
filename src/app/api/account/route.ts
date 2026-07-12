import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

// GET /api/account — hồ sơ người dùng đang đăng nhập
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, session.sub)).limit(1);
  if (!u) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  return NextResponse.json({
    ok: true,
    user: {
      fullName: u.fullName, email: u.email, role: u.role, team: u.team,
      phone: u.phone ?? "", gender: u.gender ?? "", dateOfBirth: u.dateOfBirth ?? "",
      avatarUrl: fileUrl(u.avatarKey),
    },
  });
}

// PATCH /api/account — cập nhật hồ sơ (không đụng email/role)
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  // fullName KHOÁ CỨNG: chỉ admin đổi được qua trang /admin — staff tự đổi tên gây loạn báo cáo/scope
  if (typeof b.phone === "string") patch.phone = b.phone.trim().slice(0, 30) || null;
  if (typeof b.gender === "string") patch.gender = ["male", "female", "other", ""].includes(b.gender) ? (b.gender || null) : undefined;
  if (typeof b.dateOfBirth === "string") patch.dateOfBirth = b.dateOfBirth || null;
  if (typeof b.avatarKey === "string" && b.avatarKey) patch.avatarKey = b.avatarKey;
  // loại bỏ khoá undefined
  Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);
  if (!Object.keys(patch).length) return NextResponse.json({ ok: false, error: "no changes" }, { status: 400 });

  await db.update(schema.users).set(patch).where(eq(schema.users.id, session.sub));
  return NextResponse.json({ ok: true });
}
