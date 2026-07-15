import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { getCompassupProduct, compassupSign, type CompassupCred } from "@/lib/compassup";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/fulfillers/compassup-test?link=<link sourcing>
 *
 * Kiểm tra kết nối + SIGN của Compassup mà KHÔNG cần đơn thật.
 * Trả ra chữ ký đã tính (cả 2 kiểu PHP/JS) + kết quả gọi /product/detail.
 * - success → sign ĐANG dùng là đúng.
 * - 401/sai sign → đổi env COMPASSUP_SIGN_JS_STYLE=1 rồi thử lại; endpoint này cho biết
 *   kiểu nào khớp để khỏi phải đoán.
 * Chỉ admin.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== "admin" && (await levelOf(session, "fulfillment")) < 2)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const link = (req.nextUrl.searchParams.get("link") ?? "").trim();
  if (!link) return NextResponse.json({ ok: false, error: "thiếu ?link=<link sản phẩm Compassup>" }, { status: 400 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.name, "Compassup")).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "chưa có fulfiller tên 'Compassup' — chạy MIGRATION_compassup.sql trước" }, { status: 404 });

  const cr = (ff.credentials ?? {}) as Record<string, string>;
  if (!cr.bearerToken || !cr.tenant || !cr.restKey) {
    return NextResponse.json({ ok: false, error: "credentials thiếu bearerToken / tenant / restKey" }, { status: 400 });
  }
  const cred: CompassupCred = {
    bearerToken: cr.bearerToken, tenant: cr.tenant, restKey: cr.restKey,
    endpoint: ff.apiEndpoint, username: cr.username,
  };

  const params = { link };
  const signPHP = compassupSign(params, cr.restKey, cr.tenant, true);
  const signJS = compassupSign(params, cr.restKey, cr.tenant, false);
  const usingStyle = process.env.COMPASSUP_SIGN_JS_STYLE ? "js" : "php";

  try {
    const product = await getCompassupProduct(cred, link);
    return NextResponse.json({
      ok: true,
      usingStyle,
      sign: { php: signPHP, js: signJS },
      matched: !!product,
      product: product ? {
        pid: product.pid, title: product.titleTrans, marketplace: product.marketplace,
        sellerId: product.sellerId, skuCount: product.skus.length,
        sampleSkus: product.skus.slice(0, 3),
      } : null,
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      usingStyle,
      sign: { php: signPHP, js: signJS },
      error: String((e as Error)?.message ?? e),
      hint: "Nếu lỗi liên quan sign/401: đặt env COMPASSUP_SIGN_JS_STYLE=1 (Vercel → Settings → Environment Variables) rồi redeploy và thử lại.",
    }, { status: 502 });
  }
}
