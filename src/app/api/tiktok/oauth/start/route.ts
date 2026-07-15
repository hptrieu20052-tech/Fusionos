import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { readTtCfg, wrapTtState } from "@/lib/tiktok-shop";

export const dynamic = "force-dynamic";

/**
 * GET /api/tiktok/oauth/start?storeId=...
 * Redirect sang trang authorize của TikTok Shop (services.tiktokshop.com).
 * Custom app: link authorize lấy từ Partner Center → app detail → "Authorization link",
 * dạng https://services.tiktokshop.com/open/authorize?service_id=xxxx — dán vào ô Auth link.
 * state = storeId để callback biết lưu token vào store nào.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  const storeId = req.nextUrl.searchParams.get("storeId") ?? "";
  const [st] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!st) return NextResponse.json({ ok: false, error: "store doesn't exist" }, { status: 404 });
  const cred = st.apiCredentials as Record<string, string> | null;
  const authLink = (cred?.tiktok_auth_link ?? "").trim();
  const cfg = readTtCfg(cred);
  if (!authLink && !cfg.appKey) return NextResponse.json({ ok: false, error: "Save App Key + Auth link first" }, { status: 400 });

  // state có tiền tố riêng của Fusion (mặc định "fso_") để theyourlist nhận diện & forward về
  //   os.fusiondn.com/api/tiktokshops/auth. Bên theyourlist phải whitelist đúng tiền tố này.
  const state = wrapTtState(storeId);
  // Ưu tiên Authorization link từ Partner Center (service_id); fallback dạng app_key
  const url = authLink
    ? `${authLink}${authLink.includes("?") ? "&" : "?"}state=${state}`
    : `https://services.tiktokshop.com/open/authorize?app_key=${encodeURIComponent(cfg.appKey)}&state=${state}`;
  return NextResponse.redirect(url);
}
