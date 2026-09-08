import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { inArray, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * v445 · Meta Marketing API — đẩy ads TRỰC TIẾP từ Meta Ads Kit, thay cho bulk import file.
 *
 * GET  /api/meta-ads/push        → test cấu hình: đọc tên ad account + page + pixel bằng token.
 * POST /api/meta-ads/push        → tạo 1 campaign (PAUSED, Sales, ABO) + mỗi item 1 ad set ($X/ngày,
 *   US/tuổi theo kit, tối ưu Purchase trên pixel) + upload ảnh + creative + ad (tất cả PAUSED).
 *   Kiểm soát được cả những thứ bulk import bó tay: KHÔNG catalog, TẮT Advantage+ enhancements,
 *   TẮT multi-advertiser (2 cái sau best-effort — API cũ/mới khác field, lỗi thì bỏ qua opt-out).
 *
 * Env (Vercel): META_SYSTEM_TOKEN, META_AD_ACCOUNT_ID (act_...), META_PAGE_ID, META_PIXEL_ID.
 * Token là System User Never-expire — TUYỆT ĐỐI không log ra ngoài.
 */
const V = "v23.0";
const G = `https://graph.facebook.com/${V}`;

type Item = { id: string; adName: string; primary: string; headline: string; imageUrl?: string };

function cfg() {
  const token = process.env.META_SYSTEM_TOKEN ?? "";
  const account = process.env.META_AD_ACCOUNT_ID ?? "";
  const pageId = process.env.META_PAGE_ID ?? "";
  const pixelId = process.env.META_PIXEL_ID ?? "";
  if (!token || !account || !pageId || !pixelId) return null;
  return { token, account: account.startsWith("act_") ? account : `act_${account}`, pageId, pixelId };
}

async function fb(path: string, token: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${G}/${path}`, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, access_token: token }), signal: AbortSignal.timeout(60000) }
    : { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) {
    const e = j.error ?? {};
    throw new Error(`${e.message ?? res.status}${e.error_user_msg ? " — " + e.error_user_msg : ""}`.slice(0, 300));
  }
  return j as Record<string, unknown>;
}

// GET — kiểm tra token/cấu hình: trả tên account, page, pixel (admin bấm từ UI hoặc mở URL).
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const c = cfg();
  if (!c) return NextResponse.json({ ok: false, error: "Missing env: META_SYSTEM_TOKEN / META_AD_ACCOUNT_ID / META_PAGE_ID / META_PIXEL_ID (set in Vercel, then redeploy)" }, { status: 400 });
  try {
    const acc = await fb(`${c.account}?fields=name,currency,timezone_name,timezone_offset_hours_utc`, c.token);
    // Đọc tên page/pixel chỉ để hiển thị — thiếu quyền đọc KHÔNG chặn việc tạo ads, nên lỗi thì ghi chú thôi.
    const page = await fb(`${c.pageId}?fields=name`, c.token).catch((e) => ({ name: `(cannot read page name: ${String((e as Error).message).slice(0, 120)})` }));
    const pixel = await fb(`${c.pixelId}?fields=name`, c.token).catch(() => ({ name: "(no pixel read access — ads vẫn tạo được)" }));
    return NextResponse.json({ ok: true, account: { id: c.account, name: acc.name, currency: acc.currency, timezone: acc.timezone_name, utcOffset: acc.timezone_offset_hours_utc }, page: { id: c.pageId, name: (page as { name?: string }).name }, pixel: { id: c.pixelId, name: (pixel as { name?: string }).name } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error).message) }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const c = cfg();
  if (!c) return NextResponse.json({ ok: false, error: "Meta API not configured — set env vars in Vercel first" }, { status: 400 });

  const body = await req.json().catch(() => null) as {
    campaign?: string; adsetPrefix?: string; budget?: number; ageMin?: number; ageMax?: number;
    countries?: string; startTime?: string; items?: Item[];
  } | null;
  const campaign = (body?.campaign ?? "").trim();
  const adsetPrefix = (body?.adsetPrefix ?? "").trim() || campaign;
  const budget = Math.max(1, Math.min(1000, Number(body?.budget) || 5));
  const ageMin = Math.min(65, Math.max(13, Number(body?.ageMin) || 18));
  const ageMax = Math.min(65, Math.max(13, Number(body?.ageMax) || 65));
  const countries = String(body?.countries ?? "US").toUpperCase().split(",").map((s) => s.trim()).filter((s) => /^[A-Z]{2}$/.test(s));
  const items = (body?.items ?? []).filter((i) => i && i.id && i.adName).slice(0, 20);
  if (!campaign || !items.length) return NextResponse.json({ ok: false, error: "campaign and items are required" }, { status: 400 });

  // start_time: kit gửi "YYYY-MM-DDTHH:mm" THEO MÚI GIỜ AD ACCOUNT → hỏi offset của account để ra UTC.
  let startIso = "";
  const sm = String(body?.startTime ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (sm) {
    const acc = await fb(`${c.account}?fields=timezone_offset_hours_utc`, c.token).catch(() => ({ timezone_offset_hours_utc: 0 }));
    const off = Number((acc as { timezone_offset_hours_utc?: number }).timezone_offset_hours_utc ?? 0);
    const utcMs = Date.UTC(+sm[1], +sm[2] - 1, +sm[3], +sm[4], +sm[5]) - off * 3600000;
    startIso = new Date(utcMs).toISOString().replace(/\.\d{3}Z$/, "+0000");
  }

  // Link + ảnh lấy từ DB (ảnh do user chọn trong kit được ưu tiên).
  const prods = await db.select({ id: schema.shopifyProducts.id, images: schema.shopifyProducts.images, onlineStoreUrl: schema.shopifyProducts.onlineStoreUrl })
    .from(schema.shopifyProducts).where(inArray(schema.shopifyProducts.id, items.map((i) => i.id)));
  const byId = new Map(prods.map((p) => [p.id, p]));

  const results: { adName: string; ok: boolean; error?: string }[] = [];
  let campaignId = "";
  try {
    const camp = await fb(`${c.account}/campaigns`, c.token, {
      name: campaign, objective: "OUTCOME_SALES", status: "PAUSED", buying_type: "AUCTION", special_ad_categories: [],
      // ABO thuần: không campaign budget, KHÔNG cho ad set chia sẻ budget (test phải sạch, mỗi mẫu đúng $X của nó).
      is_adset_budget_sharing_enabled: false,
    });
    campaignId = String(camp.id);
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Create campaign failed: " + String((e as Error).message) }, { status: 400 });
  }

  let idx = 0;
  const okIds: string[] = [];
  for (const it of items) {
    idx++;
    try {
      const p = byId.get(it.id);
      const link = (p?.onlineStoreUrl ?? "").trim();
      if (!link) throw new Error("no storefront link");
      const imgs = (Array.isArray(p?.images) ? p!.images as { src: string; position?: number }[] : []).slice().sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
      const src = (it.imageUrl ?? "").trim() || (imgs[0]?.src ?? "");
      if (!src) throw new Error("no image");

      // 1) upload ảnh → image_hash
      const imgRes = await fetch(src, { signal: AbortSignal.timeout(30000) });
      if (!imgRes.ok) throw new Error("image download failed");
      const b64 = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
      const up = await fb(`${c.account}/adimages`, c.token, { bytes: b64 });
      const images = up.images as Record<string, { hash: string }>;
      const hash = Object.values(images ?? {})[0]?.hash;
      if (!hash) throw new Error("no image hash returned");

      // 2) ad set — $X/ngày, Purchase trên pixel, broad, PAUSED (+ start_time nếu có)
      const adset = await fb(`${c.account}/adsets`, c.token, {
        name: `${adsetPrefix}-${String(idx).padStart(2, "0")}`,
        campaign_id: campaignId, status: "PAUSED",
        daily_budget: Math.round(budget * 100),
        billing_event: "IMPRESSIONS", optimization_goal: "OFFSITE_CONVERSIONS",
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        promoted_object: { pixel_id: c.pixelId, custom_event_type: "PURCHASE" },
        targeting: { geo_locations: { countries }, age_min: ageMin, age_max: ageMax },
        ...(startIso ? { start_time: startIso } : {}),
      });

      // 3) creative — tắt enhancements + multi-advertiser (best-effort: API version cũ/mới khác field)
      const story = {
        page_id: c.pageId,
        link_data: {
          message: it.primary, link, name: it.headline,
          description: "✓ Printed in the USA  ✓ Free US shipping  ✓ 30-day guarantee",
          call_to_action: { type: "SHOP_NOW", value: { link } },
          image_hash: hash,
        },
      };
      let creative: Record<string, unknown>;
      try {
        creative = await fb(`${c.account}/adcreatives`, c.token, {
          name: it.adName, object_story_spec: story,
          contextual_multi_ads: { enroll_status: "OPT_OUT" },
          degrees_of_freedom_spec: { creative_features_spec: { standard_enhancements: { enroll_status: "OPT_OUT" } } },
        });
      } catch {
        creative = await fb(`${c.account}/adcreatives`, c.token, { name: it.adName, object_story_spec: story });
      }

      // 4) ad — PAUSED, bật tay sau khi liếc preview
      await fb(`${c.account}/ads`, c.token, {
        name: it.adName, adset_id: String(adset.id), creative: { creative_id: String(creative.id) }, status: "PAUSED",
      });
      okIds.push(it.id);
      results.push({ adName: it.adName, ok: true });
    } catch (e) {
      results.push({ adName: it.adName, ok: false, error: String((e as Error).message).slice(0, 200) });
    }
  }

  if (okIds.length) await db.update(schema.shopifyProducts).set({ adsAt: sql`now()` }).where(inArray(schema.shopifyProducts.id, okIds));
  return NextResponse.json({ ok: true, campaignId, created: okIds.length, total: items.length, results });
}
