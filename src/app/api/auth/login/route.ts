import { NextRequest, NextResponse } from "next/server";
import { login, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

// RATE LIMIT chống brute-force: 5 lần sai / 10 phút theo (IP + email) → khoá 10 phút.
// In-memory per lambda instance (không hoàn hảo trên serverless nhưng chặn được dò mật khẩu tuần tự;
// lớp chắc chắn hơn là Cloudflare Rate Limiting rule cho /api/auth/login — xem hướng dẫn security).
const attempts = new Map<string, { fails: number; until: number }>();
const WINDOW_MS = 10 * 60_000, MAX_FAILS = 5;
function limited(key: string): boolean {
  const a = attempts.get(key);
  return !!a && a.fails >= MAX_FAILS && a.until > Date.now();
}
function recordFail(key: string) {
  const a = attempts.get(key);
  if (a && a.until > Date.now()) { a.fails++; a.until = Date.now() + WINDOW_MS; }
  else attempts.set(key, { fails: 1, until: Date.now() + WINDOW_MS });
  if (attempts.size > 5000) attempts.clear(); // chặn phình bộ nhớ
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return NextResponse.json({ ok: false, error: "missing credentials" }, { status: 400 });
  }
  const email = String(body.email).toLowerCase().trim();
  const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const key = `${ip}|${email}`;
  if (limited(key)) {
    return NextResponse.json({ ok: false, error: "too many attempts — try again in 10 minutes" }, { status: 429 });
  }
  const r = await login(email, String(body.password));
  if (!r.ok) { recordFail(key); return NextResponse.json({ ok: false, error: "invalid credentials" }, { status: 401 }); }
  attempts.delete(key);

  const remember = body.remember !== false; // mặc định ghi nhớ
  const res = NextResponse.json({ ok: true, user: r.user });
  res.cookies.set(SESSION_COOKIE, r.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    ...(remember ? { maxAge: 30 * 24 * 3600 } : {}), // ghi nhớ: 30 ngày; không: hết phiên
    path: "/",
  });
  return res;
}
