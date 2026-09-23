import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * v457 · GET /api/meta-ads/entities — trạng thái CẤU HÌNH (status) + daily budget THẬT từ Meta,
 * cho toggle bật/tắt và ô sửa budget ở Ads Center. Đọc trực tiếp Graph API (không cache DB —
 * đây là dữ liệu điều khiển, phải là số thật tại thời điểm bấm).
 * Trả: { camp: {id: status}, adsets: {id: {status, budget(USD)}}, ads: {id: {status, thumb, img}} }
 * v462 · ads kèm THUMBNAIL creative (thumb 512px để zoom xem mẫu nào; img = ảnh gốc nếu là ảnh tĩnh).
 */
const V = "v23.0";
const G = `https://graph.facebook.com/${V}`;

async function fbList(url: string, token: string, maxPages = 5): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let next = url;
  for (let p = 0; p < maxPages && next; p++) {
    const res = await fetch(next, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(String(j.error?.message ?? res.status).slice(0, 250));
    out.push(...((j.data ?? []) as Record<string, unknown>[]));
    next = j.paging?.next ?? "";
  }
  return out;
}

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const token = process.env.META_SYSTEM_TOKEN ?? "";
  const acctRaw = process.env.META_AD_ACCOUNT_ID ?? "";
  if (!token || !acctRaw) return NextResponse.json({ ok: false, error: "META_SYSTEM_TOKEN / META_AD_ACCOUNT_ID missing" }, { status: 400 });
  const act = acctRaw.startsWith("act_") ? acctRaw : `act_${acctRaw}`;

  try {
    // v532 · kèm name + campaign_id/adset_id — để UI dựng CẤU TRÚC ad set/ads cho campaign mới chưa chi tiêu.
    const [camps, adsets, ads] = await Promise.all([
      fbList(`${G}/${act}/campaigns?fields=id,name,status,daily_budget&limit=200`, token),
      fbList(`${G}/${act}/adsets?fields=id,name,campaign_id,status,effective_status,daily_budget&limit=200`, token),
      fbList(`${G}/${act}/ads?fields=id,name,adset_id,campaign_id,status,effective_status,creative.thumbnail_width(512).thumbnail_height(512){thumbnail_url,image_url,object_story_spec,effective_object_story_id}&limit=300`, token),
    ]);
    // v573 · SELLER từng ad = CHỦ LISTING Shopify mà creative trỏ tới (shopify_products.created_by
    // — v567). plink → handle → created_by → tên user. Ad video: link nằm trong video_data.call_to_action.
    type Spec = { link_data?: { link?: string }; video_data?: { call_to_action?: { value?: { link?: string } } } };
    const plinkOf = (cr: { object_story_spec?: Spec }): string | null =>
      cr.object_story_spec?.link_data?.link ?? cr.object_story_spec?.video_data?.call_to_action?.value?.link ?? null;
    const handleOf = (l: string | null): string => {
      const m = String(l ?? "").match(/\/products\/([^/?#]+)/);
      try { return m ? decodeURIComponent(m[1]).toLowerCase() : ""; } catch { return m ? m[1].toLowerCase() : ""; }
    };
    // v593 · Ad dup "GIỮ POST" (v582) có creative chỉ trỏ object_story_id — KHÔNG có object_story_spec
    // → plink null → camp MAIN mất nút ⬆ SHOPIFY + seller (spend rơi vào unassigned). Bù 2 bước:
    //  (1) mượn plink từ ad khác CÙNG post — bản gốc bên TEST vẫn còn spec đầy đủ;
    //  (2) post nào vẫn thiếu (gốc đã xoá) → đọc attachments của CHÍNH post đó (best-effort, theo lô).
    const unshim = (u: string): string => {
      const m = u.match(/[?&]u=([^&]+)/);
      if (/l(m)?\.facebook\.com/.test(u) && m) { try { return decodeURIComponent(m[1]); } catch { return u; } }
      return u;
    };
    const rawOf = new Map<string, { plink: string | null; post: string | null }>();
    for (const a of ads) {
      const cr = (a.creative ?? {}) as { object_story_spec?: Spec; effective_object_story_id?: string };
      rawOf.set(String(a.id), { plink: plinkOf(cr), post: cr.effective_object_story_id ?? null });
    }
    const byPost = new Map<string, string>();
    for (const r of rawOf.values()) if (r.post && r.plink && !byPost.has(r.post)) byPost.set(r.post, r.plink);
    const missing = Array.from(new Set(Array.from(rawOf.values()).filter((r) => r.post && !r.plink && !byPost.has(r.post)).map((r) => r.post as string))).slice(0, 50);
    if (missing.length) {
      try {
        for (let i = 0; i < missing.length; i += 25) {
          const chunk = missing.slice(i, i + 25);
          const res = await fetch(`${G}/?ids=${chunk.join(",")}&fields=attachments{unshimmed_url,url}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
          const j = await res.json().catch(() => ({})) as Record<string, { attachments?: { data?: { unshimmed_url?: string; url?: string }[] } }> & { error?: unknown };
          if (!res.ok || j.error) break;
          for (const pid of chunk) {
            const att = j[pid]?.attachments?.data ?? [];
            const link = att.map((x) => unshim(x.unshimmed_url ?? x.url ?? "")).find((u) => /\/products\//.test(u));
            if (link) byPost.set(pid, link);
          }
        }
      } catch { /* attachments là phụ — thiếu quyền đọc post thì thôi */ }
    }
    const finalPlink = (id: string): string | null => {
      const r = rawOf.get(id);
      if (!r) return null;
      return r.plink ?? (r.post ? byPost.get(r.post) ?? null : null);
    };
    const sellerByHandle = new Map<string, string>();
    try {
      const handles = Array.from(new Set(ads.map((a) => handleOf(finalPlink(String(a.id)))).filter(Boolean)));
      if (handles.length) {
        const prods = await db.select({ handle: schema.shopifyProducts.handle, createdBy: schema.shopifyProducts.createdBy })
          .from(schema.shopifyProducts).where(inArray(schema.shopifyProducts.handle, handles));
        const uids = Array.from(new Set(prods.map((p) => p.createdBy).filter(Boolean))) as string[];
        const users = uids.length
          ? await db.select({ id: schema.users.id, name: schema.users.fullName }).from(schema.users).where(inArray(schema.users.id, uids))
          : [];
        const nameOf = new Map<string, string | null>(users.map((u) => [u.id, u.name]));
        for (const p of prods) {
          const h = (p.handle ?? "").toLowerCase();
          if (h && p.createdBy && !sellerByHandle.has(h)) {
            const n = nameOf.get(p.createdBy);
            if (n) sellerByHandle.set(h, n);
          }
        }
      }
    } catch { /* seller là phụ — lỗi DB không chặn bảng điều khiển */ }

    return NextResponse.json({
      ok: true,
      camp: Object.fromEntries(camps.map((c) => [String(c.id), String(c.status ?? "")])),
      // v541 · tên campaign — cho dropdown chọn campaign/ad set trong Meta Ads Kit.
      campNames: Object.fromEntries(camps.map((c) => [String(c.id), String(c.name ?? "")])),
      // v588 · budget CẤP CAMPAIGN (CBO, USD/ngày) — 0 = camp không CBO (budget nằm ở ad set).
      campBudget: Object.fromEntries(camps.map((c) => [String(c.id), (Number(c.daily_budget) || 0) / 100])),
      adsets: Object.fromEntries(adsets.map((s) => [String(s.id), { status: String(s.status ?? ""), eff: String(s.effective_status ?? ""), budget: (Number(s.daily_budget) || 0) / 100, name: String(s.name ?? ""), campId: String(s.campaign_id ?? "") }])),
      ads: Object.fromEntries(ads.map((a) => {
        const cr = (a.creative ?? {}) as { thumbnail_url?: string; image_url?: string; object_story_spec?: Spec; effective_object_story_id?: string };
        // eff = trạng thái HIỆU LỰC (ADSET_PAUSED/CAMPAIGN_PAUSED khi tầng cha tắt) — UI dựng nhãn "tắt theo set".
        // v537 · plink = link đích của creative (talewix.com/products/<handle>) — UI dẫn về Manage Products để sửa listing.
        // v581 · post = effective_object_story_id — 2 ads cùng post là cùng social proof (dup giữ post);
        // khác post = creative khác (kit push tạo post mới). UI hiện đuôi mã để soi ngay trên bảng.
        const plink = finalPlink(String(a.id));
        return [String(a.id), { status: String(a.status ?? ""), eff: String(a.effective_status ?? ""), thumb: cr.thumbnail_url ?? null, img: cr.image_url ?? cr.thumbnail_url ?? null, name: String(a.name ?? ""), adsetId: String(a.adset_id ?? ""), campId: String(a.campaign_id ?? ""), plink, seller: sellerByHandle.get(handleOf(plink)) ?? null, post: cr.effective_object_story_id ?? null }];
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error).message) }, { status: 400 });
  }
}
