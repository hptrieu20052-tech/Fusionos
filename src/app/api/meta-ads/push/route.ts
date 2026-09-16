import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { inArray, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * v445 · Meta Marketing API — đẩy ads TRỰC TIẾP từ Meta Ads Kit, thay cho bulk import file.
 * v525 · CẤU TRÚC LINH HOẠT cho playbook MAIN/TEST:
 *   - campaignId: đẩy vào campaign ĐANG CÓ (trống = tạo mới như cũ).
 *   - mode "per_ad"   (mặc định, như cũ): mỗi ad 1 ad set mới × $budget.
 *   - mode "single"   : 1 ad set MỚI (tên = adsetPrefix, $budget) chứa toàn bộ ads.
 *   - mode "custom"   : adsets[{name,budget}] — mỗi ad gán vào 1 ad set qua item.adset
 *                       (TEST: Halloween $25 × 3 ads + First Birthday $25 × 3 ads trong 1 lần push).
 *   - mode "existing_adset": adsetId — tạo ads THẲNG vào ad set đang chạy (thả biến thể vào winner).
 *
 * GET  /api/meta-ads/push → test cấu hình. POST → tạo (tất cả PAUSED, bật tay sau khi duyệt).
 * Env (Vercel): META_SYSTEM_TOKEN, META_AD_ACCOUNT_ID (act_...), META_PAGE_ID, META_PIXEL_ID.
 * Token là System User Never-expire — TUYỆT ĐỐI không log ra ngoài.
 */
const V = "v23.0";
const G = `https://graph.facebook.com/${V}`;

type Item = { id: string; adName: string; primary: string; headline: string; imageUrl?: string; adset?: string };
type AdsetDef = { name: string; budget: number };

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
    campaign?: string; campaignId?: string; adsetPrefix?: string; budget?: number; ageMin?: number; ageMax?: number;
    countries?: string; startTime?: string; items?: Item[];
    mode?: string; adsets?: AdsetDef[]; adsetId?: string;
  } | null;
  const campaign = (body?.campaign ?? "").trim();
  const campaignIdIn = String(body?.campaignId ?? "").replace(/\D/g, "");
  const mode = ["per_ad", "single", "custom", "existing_adset"].includes(String(body?.mode)) ? String(body?.mode) : "per_ad";
  const adsetPrefix = (body?.adsetPrefix ?? "").trim() || campaign;
  const budget = Math.max(1, Math.min(1000, Number(body?.budget) || 5));
  const ageMin = Math.min(65, Math.max(13, Number(body?.ageMin) || 18));
  const ageMax = Math.min(65, Math.max(13, Number(body?.ageMax) || 65));
  const countries = String(body?.countries ?? "US").toUpperCase().split(",").map((s) => s.trim()).filter((s) => /^[A-Z]{2}$/.test(s));
  const items = (body?.items ?? []).filter((i) => i && i.id && i.adName).slice(0, 20);
  const adsetDefs = (Array.isArray(body?.adsets) ? body!.adsets! : [])
    .map((a) => ({ name: String(a?.name ?? "").trim().slice(0, 100), budget: Math.max(1, Math.min(1000, Number(a?.budget) || 5)) }))
    .filter((a) => a.name).slice(0, 10);
  const targetAdsetId = String(body?.adsetId ?? "").replace(/\D/g, "");
  if (!items.length) return NextResponse.json({ ok: false, error: "items are required" }, { status: 400 });
  if (mode === "existing_adset" && !targetAdsetId) return NextResponse.json({ ok: false, error: "adsetId is required for existing-adset mode" }, { status: 400 });
  if (mode !== "existing_adset" && !campaign && !campaignIdIn) return NextResponse.json({ ok: false, error: "campaign (or campaignId) is required" }, { status: 400 });
  if (mode === "custom" && !adsetDefs.length) return NextResponse.json({ ok: false, error: "custom mode needs at least one ad set (name + budget)" }, { status: 400 });

  // start_time: kit gửi "YYYY-MM-DDTHH:mm" THEO MÚI GIỜ AD ACCOUNT → hỏi offset của account để ra UTC.
  let startIso = "";
  const sm = String(body?.startTime ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (sm) {
    const acc = await fb(`${c.account}?fields=timezone_offset_hours_utc`, c.token).catch(() => ({ timezone_offset_hours_utc: 0 }));
    const off = Number((acc as { timezone_offset_hours_utc?: number }).timezone_offset_hours_utc ?? 0);
    const utcMs = Date.UTC(+sm[1], +sm[2] - 1, +sm[3], +sm[4], +sm[5]) - off * 3600000;
    startIso = new Date(utcMs).toISOString().replace(/\.\d{3}Z$/, "+0000");
  }

  // Link + ảnh lấy từ DB (ảnh do user chọn trong kit — kể cả ảnh angle tự upload — được ưu tiên).
  const prods = await db.select({ id: schema.shopifyProducts.id, images: schema.shopifyProducts.images, onlineStoreUrl: schema.shopifyProducts.onlineStoreUrl })
    .from(schema.shopifyProducts).where(inArray(schema.shopifyProducts.id, items.map((i) => i.id)));
  const byId = new Map(prods.map((p) => [p.id, p]));

  const results: { adName: string; ok: boolean; error?: string; opts?: string }[] = [];
  let lifecycleAll = true;   // v447 · existing_customer_budget_percentage được nhận cho mọi ad set?

  // ── Campaign: dùng ID có sẵn, hoặc tạo mới (PAUSED, Sales, ABO) ──
  let campaignId = campaignIdIn;
  if (mode !== "existing_adset" && !campaignId) {
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
  }

  // ── Ad set dùng CHUNG (mode single/custom) — tạo TRƯỚC vòng lặp ads ──
  const adsetBase = (name: string, dailyBudget: number) => ({
    name, campaign_id: campaignId, status: "PAUSED",
    daily_budget: Math.round(dailyBudget * 100),
    billing_event: "IMPRESSIONS", optimization_goal: "OFFSITE_CONVERSIONS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    promoted_object: { pixel_id: c.pixelId, custom_event_type: "PURCHASE" },
    targeting: { geo_locations: { countries }, age_min: ageMin, age_max: ageMax },
    ...(startIso ? { start_time: startIso } : {}),
  });
  const makeAdset = async (name: string, dailyBudget: number): Promise<string> => {
    // v447 · lifecycle "Get conversions from all audiences": không giới hạn ngân sách khách cũ (100%).
    try {
      const a = await fb(`${c.account}/adsets`, c.token, { ...adsetBase(name, dailyBudget), existing_customer_budget_percentage: 100 });
      return String(a.id);
    } catch {
      lifecycleAll = false;
      const a = await fb(`${c.account}/adsets`, c.token, adsetBase(name, dailyBudget));
      return String(a.id);
    }
  };

  const sharedAdsets = new Map<string, string>(); // lower(name) → adset id
  try {
    if (mode === "single") {
      sharedAdsets.set("__single__", await makeAdset(adsetPrefix || campaign || "Ad set", budget));
    } else if (mode === "custom") {
      for (const d of adsetDefs) sharedAdsets.set(d.name.toLowerCase(), await makeAdset(d.name, d.budget));
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Create ad set failed: " + String((e as Error).message), campaignId }, { status: 400 });
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

      // 2) ad set đích theo mode
      let adsetId: string;
      if (mode === "existing_adset") adsetId = targetAdsetId;
      else if (mode === "single") adsetId = sharedAdsets.get("__single__") as string;
      else if (mode === "custom") {
        const want = String(it.adset ?? "").trim().toLowerCase() || adsetDefs[0].name.toLowerCase();
        const found = sharedAdsets.get(want);
        if (!found) throw new Error(`unknown ad set "${it.adset}"`);
        adsetId = found;
      } else {
        adsetId = await makeAdset(`${adsetPrefix}-${String(idx).padStart(2, "0")}`, budget);
      }

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
      const variants: { label: string; extra: Record<string, unknown> }[] = [
        { label: "multiOff+enhOff", extra: { contextual_multi_ads: { enroll_status: "OPT_OUT" }, degrees_of_freedom_spec: { creative_features_spec: { standard_enhancements: { enroll_status: "OPT_OUT" } } } } },
        { label: "multiOff", extra: { contextual_multi_ads: { enroll_status: "OPT_OUT" } } },
        { label: "enhOff", extra: { degrees_of_freedom_spec: { creative_features_spec: { standard_enhancements: { enroll_status: "OPT_OUT" } } } } },
        { label: "default", extra: {} },
      ];
      let creative: Record<string, unknown> | null = null;
      let applied = "default";
      let lastErr: unknown = null;
      for (const v of variants) {
        try { creative = await fb(`${c.account}/adcreatives`, c.token, { name: it.adName, object_story_spec: story, ...v.extra }); applied = v.label; break; }
        catch (e) { lastErr = e; }
      }
      if (!creative) throw lastErr;

      // 4) ad — PAUSED, bật tay sau khi liếc preview
      await fb(`${c.account}/ads`, c.token, {
        name: it.adName, adset_id: adsetId, creative: { creative_id: String(creative.id) }, status: "PAUSED",
      });
      okIds.push(it.id);
      results.push({ adName: it.adName, ok: true, opts: applied });
    } catch (e) {
      results.push({ adName: it.adName, ok: false, error: String((e as Error).message).slice(0, 200) });
    }
  }

  if (okIds.length) await db.update(schema.shopifyProducts).set({ adsAt: sql`now()` }).where(inArray(schema.shopifyProducts.id, okIds));

  // v447 · liệt kê TRUNG THỰC những gì API không đặt được — client hiện trong toast.
  const manual: string[] = [];
  const okResults = results.filter((r) => r.ok);
  if (okResults.some((r) => !String(r.opts ?? "").includes("multiOff"))) manual.push("untick Multi-advertiser ads (per ad)");
  if (okResults.some((r) => !String(r.opts ?? "").includes("enhOff"))) manual.push("check Advantage+ enhancements = Off (per ad)");
  if (mode !== "existing_adset" && !lifecycleAll) manual.push("set Lifecycle = all audiences (per ad set)");
  manual.push("Personalized destinations: turn Shop off (per ad — Meta has no API switch)");
  return NextResponse.json({ ok: true, campaignId: campaignId || null, created: okIds.length, total: items.length, results, manual });
}
