import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// /api/ping: chỉ SELECT 1 để hâm nóng — an toàn public. /api/cron: tự xác thực bằng CRON_SECRET trong route.
// /journey: ảnh tĩnh trang LOGIN (chưa đăng nhập) — không whitelist thì middleware 307 ảnh về /login → carousel trống.
const PUBLIC = ["/login", "/api/auth/login", "/api/ingest", "/api/webhooks", "/api/ping", "/api/cron", "/journey/"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Đã đăng nhập mà vào /login → đưa về Dashboard (tránh trang login khoác app chrome gây hiểu nhầm bảo mật)
  if (pathname === "/login") {
    const token = req.cookies.get("fusion_session")?.value;
    if (token) {
      try {
        await jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret-change-me"));
        const url = req.nextUrl.clone();
        url.pathname = "/";
        url.search = "";
        return NextResponse.redirect(url);
      } catch { /* token hỏng → cho vào login bình thường */ }
    }
  }

  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const token = req.cookies.get("fusion_session")?.value;
  if (token) {
    try {
      await jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret-change-me"));
      return NextResponse.next();
    } catch {}
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|logo-full.png|Logo-full.png|logomark.png).*)"],
};
