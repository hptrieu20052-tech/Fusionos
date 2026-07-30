import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/**
 * POST /api/shopify/config  { storeId, shopDomain, clientId, clientSecret }
 * Lưu credentials app Dev Dashboard vào stores.api_credentials, đặt connect_method = 'api'.
 * KHÔNG cần chạy SQL tay nữa. clientSecret để trống = giữ nguyên cũ.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "stores")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const storeId = String(b?.storeId ?? "").trim();
  if (!storeId) return NextResponse.json({ ok: false, error: "missing storeId" }, { status: 400 });

  const [s] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!s) return NextResponse.json({ ok: false, error: "store not found" }, { status: 404 });
  if (s.marketplace !== "shopify") return NextResponse.json({ ok: false, error: "not a Shopify store" }, { status: 400 });

  // Seller chỉ sửa store của mình
  if (session.role === "seller" && s.sellerId !== session.sub) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // Chuẩn hoá shopDomain: bỏ https:// và dấu / cuối; nếu người dùng nhập nhầm custom domain (talewix.com) vẫn lưu, Check sẽ báo.
  const shopDomain = String(b?.shopDomain ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
  const clientId = String(b?.clientId ?? "").trim();
  const clientSecret = String(b?.clientSecret ?? "").trim();

  const cur = (s.apiCredentials ?? {}) as Record<string, string>;
  const merged = { ...cur };
  if (shopDomain) merged.shopDomain = shopDomain; else delete merged.shopDomain;
  if (clientId) merged.clientId = clientId; else delete merged.clientId;
  if (clientSecret) merged.clientSecret = clientSecret; // để trống = giữ nguyên secret cũ

  await db.update(schema.stores)
    .set({ apiCredentials: merged, connectMethod: "api" })
    .where(eq(schema.stores.id, storeId));

  return NextResponse.json({ ok: true });
}
