import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { createOnosWebhook, listOnosWebhooks } from "@/lib/onos";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * POST { fulfillerId, endpoint? } — đăng ký webhook ONOS topic 'order.updated' + 'shipment.events'
 * trỏ về /api/webhooks/onos. Sinh secret (lưu fulfillers.webhook_secret) nếu chưa có —
 * ONOS ký HMAC-SHA256 payload bằng secret này và gửi lại trong header.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "settings")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.fulfillerId) return NextResponse.json({ ok: false, error: "missing fulfillerId" }, { status: 400 });

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller doesn't exist" }, { status: 404 });
  const c = (ff.credentials ?? {}) as { apiKey?: string; accessToken?: string; apiToken?: string };
  const apiKey = c.apiKey || c.accessToken || c.apiToken;
  if (!apiKey) return NextResponse.json({ ok: false, error: "ONOS token not configured (Settings → API Key)" }, { status: 400 });

  let secret = ff.webhookSecret || "";
  if (!secret) {
    secret = crypto.randomBytes(24).toString("hex");
    await db.update(schema.fulfillers).set({ webhookSecret: secret }).where(eq(schema.fulfillers.id, ff.id));
  }

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const endpoint = (b.endpoint as string)?.trim() || (host ? `${proto}://${host}/api/webhooks/onos` : "");
  if (!endpoint) return NextResponse.json({ ok: false, error: "cannot resolve endpoint URL" }, { status: 400 });

  const cred = { apiKey, endpoint: ff.apiEndpoint };
  const results: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const topic of ["order.updated", "shipment.events"] as const) {
    try { results[topic] = await createOnosWebhook(cred, topic, endpoint, secret); }
    catch (e) { errors.push(String((e as Error)?.message ?? e).slice(0, 200)); }
  }
  let current: unknown = null;
  try { current = await listOnosWebhooks(cred); } catch { /* best-effort */ }

  if (errors.length === 2) return NextResponse.json({ ok: false, error: errors.join(" · "), current }, { status: 500 });
  return NextResponse.json({ ok: true, endpoint, results, errors: errors.length ? errors : undefined, current });
}
