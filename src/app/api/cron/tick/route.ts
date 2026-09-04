import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getValidCfg, readEtsyCfg, fetchReceipts, normalizeReceipt } from "@/lib/etsy";
import { insertEtsyOrders } from "@/lib/ingest-etsy";
import { readTtCfg, ttGetValidCfg, ttSearchOrders, ttNormalizeOrder } from "@/lib/tiktok-shop";
import { fetchAndStoreTiktokLabels } from "@/lib/tiktok-label";
import { pushTiktokTrackingForOrder } from "@/lib/tiktok-tracking";
import { pushShopifyTrackingForOrder } from "@/lib/shopify";
import { syncPrintway } from "@/lib/printway-sync";
import { syncPrintify } from "@/lib/printify-sync";
import { syncOnosWem } from "@/lib/onos-wem-sync";
import { syncSupportMail } from "@/lib/support-mail";

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

  // ---- 1c. TikTok Shipping: tự lấy label cho đơn ĐÃ Arrange (có package) mà chưa có label ----
  // Idempotent: đơn có tiktok_labels rồi thì bỏ qua. Đơn chưa Arrange → chưa có package → thử lại vòng sau.
  let ttLabelSweep: { tried: number; got: number; error?: string } = { tried: 0, got: 0 };
  if (Date.now() < deadline) {
    try {
      const rows = (await db.execute(sql`
        SELECT id FROM orders
        WHERE platform='tiktok' AND shipping_type='TIKTOK' AND tiktok_labels IS NULL
          AND status NOT IN ('shipped','delivered','completed','cancel','trash')
          AND ordered_at > now() - interval '10 days'
        ORDER BY ordered_at DESC LIMIT 10
      `)).rows as { id: string }[];
      for (const r of rows) {
        if (Date.now() > deadline) break;
        ttLabelSweep.tried++;
        try { const res = await fetchAndStoreTiktokLabels(r.id); if (res.ok) ttLabelSweep.got++; } catch { /* skip */ }
      }
    } catch (e) { ttLabelSweep = { tried: 0, got: 0, error: String((e as Error)?.message ?? e).slice(0, 160) }; }
  }

  // ---- 1d. TikTok Seller Shipping: tự đẩy tracking (supplier trả về) lên TikTok. Idempotent qua tiktok_tracking_pushed_at. ----
  // BUG CŨ 1: lọc `shipping_type='SELLER'` nên đơn lưu NULL (do bug đọc shipping_type rỗng) KHÔNG
  //           BAO GIỜ được quét → shop nào TikTok trả field rỗng là chết im. Giờ quét cả NULL/lạ,
  //           chỉ loại thẳng 'TIKTOK'; hàm push tự hỏi lại TikTok rồi ghi đúng loại vào DB.
  // BUG CŨ 2: `catch {}` nuốt sạch lỗi, summary chỉ có tried/pushed → không đời nào biết vì sao trượt.
  // BUG CŨ 3 (head-of-line): không có backoff → đơn hỏng vĩnh viễn được thử lại MỖI vòng, ăn hết
  //           ngân sách 50s, đơn mới có tracking không bao giờ tới lượt. Giờ lọc theo
  //           tiktok_push_next_at và ưu tiên đơn ít lần thử nhất + mới nhất (cần MIGRATION v163).
  let ttTrackSweep: { tried: number; pushed: number; failed?: number; reasons?: string[]; error?: string } = { tried: 0, pushed: 0 };
  if (Date.now() < deadline) {
    try {
      const rows = (await db.execute(sql`
        SELECT o.id FROM orders o
        JOIN fulfillment_orders fo ON fo.order_id = o.id
        WHERE o.platform='tiktok' AND (o.shipping_type IS DISTINCT FROM 'TIKTOK')
          AND fo.tracking_number IS NOT NULL AND fo.tiktok_tracking_pushed_at IS NULL
          AND (fo.tiktok_push_next_at IS NULL OR fo.tiktok_push_next_at < now())
          AND o.status NOT IN ('cancel','trash')
          AND o.ordered_at > now() - interval '60 days'
        GROUP BY o.id, o.ordered_at
        ORDER BY min(fo.tiktok_push_attempts) ASC, o.ordered_at DESC
        LIMIT 200
      `)).rows as { id: string }[];
      const reasons: string[] = [];
      let failed = 0;
      for (const r of rows) {
        if (Date.now() > deadline) break;
        ttTrackSweep.tried++;
        try {
          const res = await pushTiktokTrackingForOrder(r.id);
          ttTrackSweep.pushed += res.pushed;
          if (!res.pushed) {
            failed++;
            const why = res.errors?.[0] ?? res.reason ?? "unknown";
            if (why !== "no new tracking to push" && reasons.length < 8) reasons.push(`${r.id.slice(0, 8)}: ${why.slice(0, 140)}`);
          }
        } catch (e) { failed++; if (reasons.length < 8) reasons.push(`${r.id.slice(0, 8)}: ${String((e as Error)?.message ?? e).slice(0, 140)}`); }
      }
      ttTrackSweep.failed = failed;
      if (reasons.length) ttTrackSweep.reasons = reasons;
    } catch (e) { ttTrackSweep = { tried: 0, pushed: 0, error: String((e as Error)?.message ?? e).slice(0, 160) }; }
  }

  // ---- 1b. Shopify: đẩy tracking NGƯỢC lên Shopify cho đơn đã có tracking mà chưa đẩy ----
  // Cùng khuôn với sweep TikTok: lọc theo shopify_push_next_at (backoff) + ưu tiên ít lần thử nhất,
  // để 1 đơn hỏng (vd thiếu scope write_merchant_managed_fulfillment_orders) không ăn hết ngân sách.
  let shTrackSweep: { tried: number; pushed: number; failed?: number; reasons?: string[]; error?: string } = { tried: 0, pushed: 0 };
  if (Date.now() < deadline) {
    try {
      const rows = (await db.execute(sql`
        SELECT o.id FROM orders o
        JOIN fulfillment_orders fo ON fo.order_id = o.id
        WHERE o.platform='shopify'
          AND fo.tracking_number IS NOT NULL AND fo.shopify_tracking_pushed_at IS NULL
          AND (fo.shopify_push_next_at IS NULL OR fo.shopify_push_next_at < now())
          AND o.status NOT IN ('cancel','trash')
          AND o.ordered_at > now() - interval '60 days'
        GROUP BY o.id, o.ordered_at
        ORDER BY min(fo.shopify_push_attempts) ASC, o.ordered_at DESC
        LIMIT 200
      `)).rows as { id: string }[];
      const reasons: string[] = [];
      let failed = 0;
      for (const r of rows) {
        if (Date.now() > deadline) break;
        shTrackSweep.tried++;
        try {
          const res = await pushShopifyTrackingForOrder(r.id);
          shTrackSweep.pushed += res.pushed;
          if (!res.pushed) {
            failed++;
            const why = res.errors?.[0] ?? res.reason ?? "unknown";
            if (why !== "no new tracking to push" && reasons.length < 8) reasons.push(`${r.id.slice(0, 8)}: ${why.slice(0, 140)}`);
          }
        } catch (e) { failed++; if (reasons.length < 8) reasons.push(`${r.id.slice(0, 8)}: ${String((e as Error)?.message ?? e).slice(0, 140)}`); }
      }
      shTrackSweep.failed = failed;
      if (reasons.length) shTrackSweep.reasons = reasons;
    } catch (e) { shTrackSweep = { tried: 0, pushed: 0, error: String((e as Error)?.message ?? e).slice(0, 160) }; }
  }

  // ---- 2/2b/3. Ba poll backup: Printway · Printify · ONOS+WEM ----
  // BUG CŨ: chạy CỐ ĐỊNH theo thứ tự printway → printify → onosWem. Hết 50s ở giữa chừng thì
  // onosWem BỊ BỎ mà summary vẫn để `null` — nhìn log không phân biệt được "không có gì để làm"
  // với "hết giờ, không chạy". ONOS/Compassup/Lenful nằm trong onosWem nên nó luôn là thằng đói.
  // Sửa: (a) đánh dấu rõ `skipped (time budget)`, (b) XOAY vòng thứ tự theo phút để không nhà nào
  // vĩnh viễn đứng cuối hàng.
  const results: Record<string, unknown> = { printway: null, printify: null, onosWem: null, supportMail: null };
  const jobs: Array<{ key: string; run: () => Promise<unknown> }> = [
    { key: "printway", run: () => syncPrintway({ force: false }) },
    { key: "printify", run: () => syncPrintify({ force: false }) },
    { key: "onosWem", run: () => syncOnosWem({ force: false }) },
    // v392/v393: kéo mail các hộp thư support (IMAP) về /support-email — tự bỏ qua nếu chưa cấu hình.
    { key: "supportMail", run: () => syncSupportMail({ force: false }) },
  ];
  const rot = Math.floor(started / 600_000) % jobs.length; // đổi thứ tự mỗi 10 phút
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[(i + rot) % jobs.length];
    if (Date.now() >= deadline) { results[job.key] = { ok: false, error: "skipped (time budget)" }; continue; }
    try { results[job.key] = await job.run(); }
    catch (e) { results[job.key] = { ok: false, error: String((e as Error)?.message ?? e).slice(0, 160) }; }
  }
  const { printway, printify, onosWem, supportMail } = results;

  const summary = { ok: true, ms: Date.now() - started, etsy, tiktok, ttLabelSweep, ttTrackSweep, shTrackSweep, printway, printify, onosWem, supportMail };
  console.log("[cron/tick]", JSON.stringify({ ms: summary.ms, stores: etsy.length }));
  return NextResponse.json(summary);
}

export async function GET(req: NextRequest) { return tick(req); }
export async function POST(req: NextRequest) { return tick(req); }
