import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { getValidCfg, readEtsyCfg, fetchReceipts, normalizeReceipt } from "@/lib/etsy";
import { insertEtsyOrders } from "@/lib/ingest-etsy";
import { readTtCfg, ttGetValidCfg, ttSearchOrders, ttNormalizeOrder } from "@/lib/tiktok-shop";
import { syncPrintway } from "@/lib/printway-sync";
import { syncOnosWem } from "@/lib/onos-wem-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET|POST /api/cron/tick — nhịp tim tự động của FUSION, gọi định kỳ (khuyên 10–15 phút):
 *  1. Kéo đơn Etsy mới qua Open API cho MỌI store đã Connect (không cần ai bấm gì).
 *  2. Poll trạng thái/tracking Printway (backup cho webhook, tự throttle 10 phút).
 *
 * Xác thực (1 trong 3):
 *  - Header "Authorization: Bearer <CRON_SECRET>" — Vercel Cron tự gửi khi env CRON_SECRET tồn tại
 *  - Query   ?key=<CRON_SECRET>                    — cho cron-job.org / Cloudflare Worker
 *  - Header  "x-vercel-cron"                       — request nội bộ từ Vercel Cron
 * ⚠️ Cloudflare Access cần BYPASS path /api/cron/* (giống /api/webhooks/*) thì cron ngoài mới gọi được.
 */
async function tick(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const key = req.nextUrl.searchParams.get("key") ?? "";
  const isVercelCron = !!req.headers.get("x-vercel-cron");
  const ok = isVercelCron || (secret && (auth === `Bearer ${secret}` || key === secret));
  if (!ok) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const started = Date.now();
  const deadline = started + 50000; // chừa 10s an toàn trước maxDuration

  // ---- 1. Etsy: kéo đơn mới cho mọi store đã connect ----
  const stores = await db.select({
    id: schema.stores.id, sellerId: schema.stores.sellerId, fx: schema.stores.fxRate,
    name: schema.stores.name, c: schema.stores.apiCredentials,
  }).from(schema.stores);

  const etsy: { store: string; ok: boolean; received?: number; created?: number; skipped?: number; error?: string }[] = [];
  for (const st of stores) {
    if (Date.now() > deadline) { etsy.push({ store: st.name, ok: false, error: "skipped (time budget)" }); continue; }
    const cred = st.c as Record<string, string> | null;
    if (!readEtsyCfg(cred).refreshToken) continue; // store chưa connect Etsy → bỏ qua êm
    try {
      const cfg = await getValidCfg(st.id, cred);
      if (!cfg.shopId) { etsy.push({ store: st.name, ok: false, error: "no shop_id — reconnect" }); continue; }
      // Cron chạy dày → chỉ cần 60 receipt gần nhất mỗi vòng; dedupe DB lo phần còn lại
      const receipts = await fetchReceipts(cfg, 60);
      const orders = receipts.map(normalizeReceipt).filter((o) => o.externalId);
      const r = await insertEtsyOrders({ id: st.id, sellerId: st.sellerId, fx: st.fx, name: st.name }, orders, "api");
      etsy.push({ store: st.name, ok: true, received: orders.length, ...r });
    } catch (e) {
      etsy.push({ store: st.name, ok: false, error: String((e as Error)?.message ?? e).slice(0, 160) });
    }
  }

  // ---- 1b. TikTok: kéo đơn mới cho mọi store đã connect ----
  const tiktok: { store: string; ok: boolean; received?: number; created?: number; updated?: number; skipped?: number; error?: string }[] = [];
  for (const st of stores) {
    if (Date.now() > deadline) { tiktok.push({ store: st.name, ok: false, error: "skipped (time budget)" }); continue; }
    const cred = st.c as Record<string, string> | null;
    if (!readTtCfg(cred).refreshToken) continue;
    try {
      const cfg = await ttGetValidCfg(st.id, cred);
      const raw = await ttSearchOrders(cfg, { pageSize: 50 });
      const orders = raw.map(ttNormalizeOrder).filter((o) => o.externalId);
      const r = await insertEtsyOrders({ id: st.id, sellerId: st.sellerId, fx: st.fx, name: st.name }, orders, "api", "tiktok");
      tiktok.push({ store: st.name, ok: true, received: orders.length, ...r });
    } catch (e) {
      tiktok.push({ store: st.name, ok: false, error: String((e as Error)?.message ?? e).slice(0, 160) });
    }
  }

  // ---- 2. Printway poll backup (throttle 10' nội bộ — gọi dày cũng không spam API) ----
  let printway: unknown = null;
  if (Date.now() < deadline) {
    try { printway = await syncPrintway({ force: false }); }
    catch (e) { printway = { ok: false, error: String((e as Error)?.message ?? e).slice(0, 160) }; }
  }

  // ---- 3. ONOS + Wembroidery poll backup (webhook 2 nhà này là kênh chính, poll chống lỡ) ----
  let onosWem: unknown = null;
  if (Date.now() < deadline) {
    try { onosWem = await syncOnosWem({ force: false }); }
    catch (e) { onosWem = { ok: false, error: String((e as Error)?.message ?? e).slice(0, 160) }; }
  }

  const summary = { ok: true, ms: Date.now() - started, etsy, tiktok, printway, onosWem };
  console.log("[cron/tick]", JSON.stringify({ ms: summary.ms, stores: etsy.length }));
  return NextResponse.json(summary);
}

export async function GET(req: NextRequest) { return tick(req); }
export async function POST(req: NextRequest) { return tick(req); }
