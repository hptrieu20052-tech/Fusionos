import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { mergeWooCred } from "@/lib/woocommerce";

export const dynamic = "force-dynamic";

/**
 * POST /api/woocommerce/config { storeId, storeUrl, consumerKey, consumerSecret }
 * Lưu REST API key vào stores.api_credentials.woocommerce, đặt connect_method = 'api'.
 * consumerSecret để trống = giữ nguyên cũ (không ghi đè secret bằng chuỗi rỗng).
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
  if (s.marketplace !== "woocommerce") return NextResponse.json({ ok: false, error: "not a WooCommerce store" }, { status: 400 });
  if (session.role === "seller" && s.sellerId !== session.sub) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const storeUrl = String(b?.storeUrl ?? "").trim().replace(/\/+$/, "");
  const consumerKey = String(b?.consumerKey ?? "").trim();
  const consumerSecret = String(b?.consumerSecret ?? "").trim();

  await mergeWooCred(storeId, {
    storeUrl: storeUrl || undefined,
    consumerKey: consumerKey || undefined,
    consumerSecret: consumerSecret || undefined, // để trống = giữ nguyên secret cũ
  });
  await db.update(schema.stores).set({ connectMethod: "api" }).where(eq(schema.stores.id, storeId));

  return NextResponse.json({ ok: true });
}
