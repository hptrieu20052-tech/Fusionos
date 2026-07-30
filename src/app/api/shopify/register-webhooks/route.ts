import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { shopifyApi, shopHost, type ShopifyCred } from "@/lib/shopify";

export const dynamic = "force-dynamic";

/**
 * POST /api/shopify/register-webhooks  { storeId? , baseUrl? }
 * Tự đăng ký webhook orders/create + orders/cancelled cho store Shopify (1 store nếu có storeId,
 * hoặc MỌI store nếu không), trỏ về {origin}/api/webhooks/shopify.
 * Đỡ phải cấu hình webhook thủ công trong Dev Dashboard.
 * Chạy lại nhiều lần an toàn: bỏ qua topic đã có đúng address.
 */
const TOPICS = ["orders/create", "orders/cancelled"];

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "stores")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  const origin = String(b?.baseUrl ?? "").trim().replace(/\/+$/, "") || req.nextUrl.origin;
  const address = `${origin}/api/webhooks/shopify`;
  const storeId = String(b?.storeId ?? "").trim();

  const where = storeId
    ? and(eq(schema.stores.marketplace, "shopify"), eq(schema.stores.id, storeId))
    : eq(schema.stores.marketplace, "shopify");
  const stores = await db.select().from(schema.stores).where(where);
  if (!stores.length) return NextResponse.json({ ok: false, error: "Chưa có store Shopify nào" }, { status: 400 });

  const out: Record<string, unknown>[] = [];
  for (const store of stores) {
    const cred = (store.apiCredentials ?? {}) as ShopifyCred;
    const host = shopHost(cred);
    if (!host || !(cred.adminToken || (cred.clientId && cred.clientSecret))) {
      out.push({ store: store.name, ok: false, error: "thiếu shopDomain/clientId/clientSecret" });
      continue;
    }
    try {
      const existing = (await shopifyApi(cred, "webhooks.json?limit=250")).webhooks as Record<string, unknown>[] | undefined;
      const have = new Map((existing ?? []).map((w) => [String(w.topic), w]));
      const done: string[] = [];
      for (const topic of TOPICS) {
        const cur = have.get(topic);
        if (cur && String(cur.address) === address) { done.push(`${topic} (đã có)`); continue; }
        if (cur) await shopifyApi(cred, `webhooks/${cur.id}.json`, { method: "DELETE" }).catch(() => {}); // địa chỉ cũ → xoá tạo lại
        await shopifyApi(cred, "webhooks.json", { method: "POST", body: JSON.stringify({ webhook: { topic, address, format: "json" } }) });
        done.push(`${topic} ✓`);
      }
      out.push({ store: store.name, ok: true, address, topics: done });
    } catch (e) {
      out.push({ store: store.name, ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }
  return NextResponse.json({ ok: out.every((r) => r.ok), address, results: out });
}
