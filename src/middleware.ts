import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// /api/ping: chỉ SELECT 1 để hâm nóng — an toàn public. /api/cron: tự xác thực bằng CRON_SECRET trong route.
// /journey: ảnh tĩnh trang LOGIN (chưa đăng nhập) — không whitelist thì middleware 307 ảnh về /login → carousel trống.
// /api/tiktokshops/auth + /api/tiktok/oauth/callback: điểm nhận OAuth từ TikTok/theyourlist,
// KHÔNG có session cookie → phải public (state=storeId tự xác định store, an toàn).
// /api/feed: Googlebot của Merchant Center KHÔNG có cookie session → middleware trả 401 →
// Merchant Center hiện đúng chữ "Authentication failed". Route tự chặn bằng FEED_FETCH_KEY
// (thiếu/sai khoá là 404), nên mở public ở tầng middleware là an toàn.
const PUBLIC = ["/login", "/api/auth/login", "/api/ingest", "/api/webhooks", "/api/ping", "/api/cron", "/journey/", "/api/tiktokshops/auth", "/api/tiktok/oauth/callback", "/api/feed/"];

// Domain chính thức của app. Đặt env CANONICAL_HOST để đổi mà không sửa code.
const CANONICAL_HOST = process.env.CANONICAL_HOST || "os.fusiondn.com";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // v266 · TẮT link Vercel cho người dùng: bản PRODUCTION mở qua *.vercel.app → ép về domain chính.
  // Seller lỡ vào link vercel sẽ bị bật về os.fusiondn.com → upload R2 (CORS theo origin) hết lỗi.
  //  · Chỉ chặn khi VERCEL_ENV === "production" ⇒ preview deploy (test tay) KHÔNG bị đụng.
  //  · Bỏ qua /api/ ⇒ webhook / cron / OAuth callback nếu đang trỏ vào domain vercel vẫn chạy.
  if (process.env.VERCEL_ENV === "production" && !pathname.startsWith("/api/")) {
    const host = req.headers.get("host") || "";
    if (host.endsWith(".vercel.app")) {
      const url = req.nextUrl.clone();
      url.protocol = "https:";
      url.host = CANONICAL_HOST;
      url.port = "";
      return NextResponse.redirect(url, 307);
    }
  }

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
