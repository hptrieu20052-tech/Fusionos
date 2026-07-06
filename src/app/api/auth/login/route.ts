import { NextRequest, NextResponse } from "next/server";
import { login, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return NextResponse.json({ ok: false, error: "missing credentials" }, { status: 400 });
  }
  const r = await login(String(body.email).toLowerCase().trim(), String(body.password));
  if (!r.ok) return NextResponse.json({ ok: false, error: "invalid credentials" }, { status: 401 });

  const res = NextResponse.json({ ok: true, user: r.user });
  res.cookies.set(SESSION_COOKIE, r.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 3600,
    path: "/",
  });
  return res;
}
