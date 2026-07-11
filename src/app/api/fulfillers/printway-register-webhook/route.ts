import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { registerPrintwayWebhook, getPrintwayWebhooks, type PwWebhookType } from "@/lib/printway-api";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * POST { fulfillerId, endpoint? } — đăng ký webhook Printway type=order + type=tracking
 * trỏ về /api/webhooks/printway. Sinh secret (lưu vào fulfillers.webhook_secret) nếu chưa có;
 * Printway sẽ gọi kèm header "x-fusion-webhook: <secret>".
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.fulfillerId) return NextResponse.json({ ok: false, error: "missing fulfillerId" }, { status: 400 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller doesn't exist" }, { status: 404 });
  const c = (ff.credentials ?? {}) as { apiKey?: string; accessToken?: string; apiToken?: string };
  const accessToken = c.apiKey || c.accessToken || c.apiToken;
  if (!accessToken) return NextResponse.json({ ok: false, error: "Printway Access Token not configured (Settings → API Key)" }, { status: 400 });

  // Secret: dùng webhook_secret hiện có, else sinh mới (hex → hợp lệ với ràng buộc ký tự của Printway)
  let secret = ff.webhookSecret || "";
  if (!secret) {
    secret = crypto.randomBytes(24).toString("hex");
    await db.update(schema.fulfillers).set({ webhookSecret: secret }).where(eq(schema.fulfillers.id, ff.id));
  }

  // Endpoint: cho override qua body; mặc định suy từ request (đi qua Cloudflare → x-forwarded-*)
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const endpoint = (b.endpoint as string)?.trim() || (host ? `${proto}://${host}/api/webhooks/printway` : "");
  if (!endpoint) return NextResponse.json({ ok: false, error: "cannot resolve endpoint URL" }, { status: 400 });

  const cred = { accessToken, endpoint: ff.apiEndpoint };
  const results: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const type of ["order", "tracking"] as PwWebhookType[]) {
    try {
      results[type] = await registerPrintwayWebhook(cred, type, { accessKey: "x-fusion-webhook", accessToken: secret, endpoint });
    } catch (e) {
      errors.push(String((e as Error)?.message ?? e).slice(0, 200));
    }
  }
  // Đọc lại danh sách webhook đã đăng ký để hiển thị xác nhận
  const registered = { order: await getPrintwayWebhooks(cred, "order"), tracking: await getPrintwayWebhooks(cred, "tracking") };

  return NextResponse.json({ ok: errors.length === 0, endpoint, results, registered, errors });
}
