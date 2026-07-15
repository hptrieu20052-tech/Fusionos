import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

// Yêu cầu: ≥12 ký tự, ≥1 chữ hoa, ≥1 số, ≥1 ký tự đặc biệt
function validatePassword(pw: string): string | null {
  if (typeof pw !== "string" || pw.length < 12) return "Password must be at least 12 characters";
  if (!/[A-Z]/.test(pw)) return "Requires at least 1 uppercase letter";
  if (!/[0-9]/.test(pw)) return "Requires at least 1 digit";
  if (!/[^A-Za-z0-9]/.test(pw)) return "Requires at least 1 special character";
  return null;
}

// POST /api/account/password { current, next }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  const b = await req.json().catch(() => null);
  if (!b?.current || !b?.next) return NextResponse.json({ ok: false, error: "Missing information" }, { status: 400 });

  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, session.sub)).limit(1);
  if (!u) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const ok = await bcrypt.compare(String(b.current), u.passwordHash);
  if (!ok) return NextResponse.json({ ok: false, error: "Current password is incorrect" }, { status: 400 });

  const err = validatePassword(String(b.next));
  if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 });

  if (await bcrypt.compare(String(b.next), u.passwordHash)) {
    return NextResponse.json({ ok: false, error: "New password must differ from the old one" }, { status: 400 });
  }

  const hash = await bcrypt.hash(String(b.next), 10);
  await db.update(schema.users).set({ passwordHash: hash }).where(eq(schema.users.id, session.sub));
  return NextResponse.json({ ok: true });
}
