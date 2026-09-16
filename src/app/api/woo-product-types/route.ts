import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds, sharedStoreIds } from "@/lib/scope";
import { wooBridgeApi, wooConfigured, type WooCred } from "@/lib/woocommerce";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/woo-product-types — Product Types (styles) của Woo Custom Pro trên store (v505, quyền v512).
 * Đọc/ghi products.json trên store qua plugin cầu nối wcp-fusion-bridge (wc-fusion/v1).
 *
 * v512 · PHÂN QUYỀN "của ai người đó thấy" (bảng woo_type_owners, khớp theo TÊN style):
 *   - Style KHÔNG có dòng owner = của ADMIN → mọi seller THẤY + DÙNG, không sửa/xoá được.
 *   - Style có dòng owner = của seller đó → chỉ seller đó (và admin) thấy; seller toàn quyền.
 *   - Seller lưu (POST) → server MERGE: giữ nguyên style của seller khác, chặn mọi thay đổi
 *     lên style admin (so sánh nội dung), chỉ áp add/sửa/xoá lên style của chính seller.
 *   - Admin (không scope): toàn quyền cả danh sách + default shipping; dọn dòng owner mồ côi.
 */

type StoreRow = { id: string; cred: WooCred; scoped: boolean };

async function wooStore(session: NonNullable<Awaited<ReturnType<typeof getSession>>>, storeId: string): Promise<StoreRow | { error: string; status: number }> {
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) return { error: "missing storeId", status: 400 };
  const [s] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!s) return { error: "store not found", status: 404 };
  if (s.marketplace !== "woocommerce") return { error: "not a WooCommerce store", status: 400 };
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && !(s.sellerId && scopeIds.includes(s.sellerId))) {
    const shared = await sharedStoreIds(scopeIds);
    if (!shared.includes(s.id)) return { error: "forbidden", status: 403 };
  }
  const cred = (((s.apiCredentials ?? {}) as Record<string, unknown>).woocommerce ?? {}) as WooCred;
  if (!wooConfigured(cred)) return { error: "Store chưa cấu hình WooCommerce API — vào Stores nhập Store URL + Consumer key/secret.", status: 400 };
  return { id: s.id, cred, scoped: !!scopeIds };
}

const strv = (v: unknown) => (v == null ? "" : String(v)).trim();
const lower = (v: unknown) => strv(v).toLowerCase();

/** Style đúng cấu trúc products.json plugin đang đọc. */
type Style = { styles: string; image: string; sizes: string[]; colors: string[]; designs: string[]; shipping?: string; group?: string };
function cleanStyles(input: unknown): Style[] | { error: string } {
  if (!Array.isArray(input) || !input.length) return { error: "styles list is empty" };
  if (input.length > 200) return { error: "too many styles (max 200)" };
  const out: Style[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const s = (input[i] ?? {}) as Record<string, unknown>;
    const name = strv(s.styles).slice(0, 120);
    if (!name) return { error: `Style #${i + 1}: name is required` };
    if (seen.has(name.toLowerCase())) return { error: `Duplicate style name "${name}"` };
    seen.add(name.toLowerCase());
    const sizesRaw = (Array.isArray(s.sizes) ? s.sizes : []).map((x) => strv(x)).filter(Boolean).slice(0, 60);
    if (!sizesRaw.length) return { error: `Style "${name}": add at least one size` };
    const sizes: string[] = [];
    for (const sz of sizesRaw) {
      if (!/^.+-\d+(\.\d{1,2})?$/.test(sz)) return { error: `Style "${name}": size "${sz}" must be "Name-Price" like "M-18.99"` };
      const cut = sz.lastIndexOf("-");
      const price = Number(sz.slice(cut + 1));
      if (!(price > 0)) return { error: `Style "${name}": size "${sz}" price must be > 0` };
      // v514 · Plugin tách size theo dấu "-" ĐẦU TIÊN → tên size chứa "-" làm sai cả tên lẫn giá
      // (vd "0-3M-21.99" → tên "0", giá $3). Tự đổi "-" trong TÊN thành "–" (en-dash) cho an toàn.
      const szName = sz.slice(0, cut).replace(/-/g, "–").trim();
      if (!szName) return { error: `Style "${name}": size "${sz}" is missing a name` };
      sizes.push(`${szName}-${sz.slice(cut + 1)}`);
    }
    const colors = (Array.isArray(s.colors) ? s.colors : []).map((x) => strv(x)).filter(Boolean).slice(0, 60);
    let designs = (Array.isArray(s.designs) ? s.designs : []).map((x) => strv(x)).filter(Boolean).slice(0, 10);
    if (!designs.length) designs = ["front", "back"];
    const entry: Style = { styles: name, image: strv(s.image).slice(0, 500), sizes, colors, designs };
    const ship = String(s.shipping ?? "").trim().slice(0, 20000);
    if (ship) entry.shipping = ship;
    // v522 · group — gộp nhiều style thành 1 chip khi list (bridge 1.2 lưu vào products.json).
    const grp = strv(s.group).slice(0, 80);
    if (grp) entry.group = grp;
    out.push(entry);
  }
  return out;
}

/** v529 · chuẩn hoá size Y HỆT cleanStyles (en-dash + trim tên) — để bản thô trên store (còn "-"
 *  trong tên size, vd "0-3M") không bị so lệch với bản đã chuẩn hoá seller gửi lên → chặn oan. */
function canonSize(sz: string): string {
  const cut = sz.lastIndexOf("-");
  if (cut <= 0) return sz;
  const name = sz.slice(0, cut).replace(/-/g, "–").trim();
  return name ? `${name}-${sz.slice(cut + 1)}` : sz;
}
/** Chuẩn hoá 1 style (kể cả bản thô từ bridge) để SO SÁNH nội dung — chặn seller sửa lén đồ admin. */
function canon(s: Record<string, unknown>): string {
  const d = (Array.isArray(s.designs) ? s.designs : []).map(strv).filter(Boolean).slice(0, 10);
  return JSON.stringify({
    n: strv(s.styles).slice(0, 120),
    i: strv(s.image).slice(0, 500),
    sz: (Array.isArray(s.sizes) ? s.sizes : []).map(strv).filter(Boolean).slice(0, 60).map(canonSize),
    c: (Array.isArray(s.colors) ? s.colors : []).map(strv).filter(Boolean).slice(0, 60),
    d: d.length ? d : ["front", "back"], // khớp default của cleanStyles — tránh chặn oan
    sh: strv(s.shipping).slice(0, 20000),
    g: strv(s.group).slice(0, 80), // v522 · group cũng bất khả xâm phạm trên style admin
  });
}

/** Đọc bảng owner của store. null = bảng chưa migrate. */
async function typeOwners(storeId: string): Promise<{ styleName: string; createdBy: string | null }[] | null> {
  try {
    return await db.select({ styleName: schema.wooTypeOwners.styleName, createdBy: schema.wooTypeOwners.createdBy })
      .from(schema.wooTypeOwners).where(eq(schema.wooTypeOwners.storeId, storeId));
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ((await levelOf(session, "products")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const st = await wooStore(session, String(req.nextUrl.searchParams.get("storeId") ?? ""));
  if ("error" in st) return NextResponse.json({ ok: false, error: st.error }, { status: st.status });
  try {
    const j = (await wooBridgeApi(st.cred, "product-types")) as { styles?: unknown; default_shipping?: unknown; bridge_version?: unknown };
    let styles = (Array.isArray(j?.styles) ? j.styles : []) as Record<string, unknown>[];

    // v512 · quyền theo người tạo. Bảng chưa migrate → mọi style coi như của admin (đọc-only cho seller).
    const owners = await typeOwners(st.id);
    const ownerMap = new Map((owners ?? []).map((o) => [o.styleName.toLowerCase(), o.createdBy]));
    if (st.scoped) {
      styles = styles.filter((s) => {
        const o = ownerMap.get(lower(s.styles));
        return o == null || o === session.sub;   // của admin hoặc của chính mình
      });
    }
    // Tên người tạo (hiện "by …" — admin để trống).
    const uids = Array.from(new Set((owners ?? []).map((o) => o.createdBy).filter((x): x is string => !!x)));
    const names = uids.length
      ? new Map((await db.select({ id: schema.users.id, name: schema.users.fullName }).from(schema.users).where(inArray(schema.users.id, uids))).map((u) => [u.id, u.name ?? ""]))
      : new Map<string, string>();
    const out = styles.map((s) => {
      const o = ownerMap.get(lower(s.styles)) ?? null;
      return { ...s, mine: !st.scoped || o === session.sub, ownerName: o ? (names.get(o) || "seller") : null };
    });

    return NextResponse.json({
      ok: true, styles: out,
      canEditTypes: !st.scoped,                       // admin: default shipping + toàn quyền
      canCreate: !st.scoped || owners !== null,       // seller tạo type riêng khi đã migrate v512
      typesNeedSql: st.scoped && owners === null,
      defaultShipping: typeof j?.default_shipping === "string" ? j.default_shipping : null,
      bridgeVersion: typeof j?.bridge_version === "string" ? j.bridge_version : "1.0.0",
    });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/Fusion Bridge/i.test(msg)) return NextResponse.json({ ok: true, styles: [], needBridge: true, canEditTypes: !st.scoped, canCreate: false });
    return NextResponse.json({ ok: false, error: msg.slice(0, 300) }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ((await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const st = await wooStore(session, String(b?.storeId ?? ""));
  if ("error" in st) return NextResponse.json({ ok: false, error: st.error }, { status: st.status });
  const submitted = cleanStyles(b?.styles);
  if ("error" in submitted) return NextResponse.json({ ok: false, error: submitted.error }, { status: 400 });

  try {
    if (!st.scoped) {
      // ── ADMIN: ghi đè cả danh sách + default shipping, rồi dọn dòng owner của style đã mất ──
      const payload: Record<string, unknown> = { styles: submitted };
      if (typeof b?.defaultShipping === "string") payload.default_shipping = String(b.defaultShipping).slice(0, 20000);
      await wooBridgeApi(st.cred, "product-types", { method: "POST", body: JSON.stringify(payload) });
      try {
        const keep = new Set(submitted.map((s) => s.styles.toLowerCase()));
        const rows = await db.select({ styleName: schema.wooTypeOwners.styleName }).from(schema.wooTypeOwners).where(eq(schema.wooTypeOwners.storeId, st.id));
        for (const r of rows) {
          if (!keep.has(r.styleName.toLowerCase())) {
            await db.delete(schema.wooTypeOwners).where(and(eq(schema.wooTypeOwners.storeId, st.id), eq(schema.wooTypeOwners.styleName, r.styleName)));
          }
        }
      } catch { /* bảng chưa migrate → bỏ qua */ }
      return NextResponse.json({ ok: true, count: submitted.length });
    }

    // ── SELLER (scoped): MERGE an toàn — không đụng được style admin / seller khác ──
    const owners = await typeOwners(st.id);
    if (owners === null) return NextResponse.json({ ok: false, error: "Run MIGRATION_v512_woo_type_owners.sql on Supabase first — seller-owned product types need it." }, { status: 400 });
    const ownerMap = new Map(owners.map((o) => [o.styleName.toLowerCase(), o]));

    const cur = (await wooBridgeApi(st.cred, "product-types")) as { styles?: unknown };
    const current = (Array.isArray(cur?.styles) ? cur.styles : []) as Record<string, unknown>[];
    const curByName = new Map(current.map((s) => [lower(s.styles), s]));
    const subByName = new Map(submitted.map((s) => [s.styles.toLowerCase(), s]));
    const ownerOf = (name: string) => ownerMap.get(name.toLowerCase())?.createdBy ?? null;

    // 1) Style gửi lên: tên trùng đồ seller khác → chặn; đồ admin → nội dung phải Y NGUYÊN.
    for (const s of submitted) {
      const o = ownerOf(s.styles);
      if (o != null && o !== session.sub) return NextResponse.json({ ok: false, error: `Style name "${s.styles}" belongs to another seller — pick a different name.` }, { status: 403 });
      const curS = curByName.get(s.styles.toLowerCase());
      if (curS && o == null && canon(curS) !== canon(s as unknown as Record<string, unknown>)) {
        return NextResponse.json({ ok: false, error: `"${s.styles}" is an admin product type — only admins can edit it.` }, { status: 403 });
      }
    }
    // 2) Xoá: style admin bắt buộc còn nguyên trong danh sách gửi lên.
    // (Array.from vì tsconfig target thấp — for..of trực tiếp trên Map không build được trên Vercel)
    for (const [key, curS] of Array.from(curByName.entries())) {
      if (ownerOf(key) == null && !subByName.has(key)) {
        return NextResponse.json({ ok: false, error: `"${strv(curS.styles)}" is an admin product type — only admins can delete it.` }, { status: 403 });
      }
    }
    // 3) Ghép danh sách cuối: giữ thứ tự cũ; đồ seller khác giữ nguyên; đồ mình theo bản gửi; thêm mới vào cuối.
    const merged: unknown[] = [];
    const used = new Set<string>();
    for (const curS of current) {
      const key = lower(curS.styles);
      const o = ownerOf(key);
      if (o != null && o !== session.sub) { merged.push(curS); continue; }        // của seller khác — không đụng
      const sub = subByName.get(key);
      if (o == null) { merged.push(sub ?? curS); if (sub) used.add(key); }        // của admin — đã kiểm tra y nguyên
      else if (sub) { merged.push(sub); used.add(key); }                          // của mình — bản mới (thiếu = xoá)
    }
    for (const s of submitted) if (!used.has(s.styles.toLowerCase())) merged.push(s); // type mới của seller
    if (!merged.length) return NextResponse.json({ ok: false, error: "the store needs at least one product type" }, { status: 400 });

    await wooBridgeApi(st.cred, "product-types", { method: "POST", body: JSON.stringify({ styles: merged }) }); // seller KHÔNG đổi default shipping

    // 4) Cập nhật bảng owner: thêm dòng cho type mới của seller, xoá dòng type mình đã bỏ.
    for (const s of submitted) {
      if (!curByName.has(s.styles.toLowerCase())) {
        try { await db.insert(schema.wooTypeOwners).values({ storeId: st.id, styleName: s.styles, createdBy: session.sub }).onConflictDoNothing(); } catch { /* ignore */ }
      }
    }
    for (const o of owners) {
      if (o.createdBy === session.sub && curByName.has(o.styleName.toLowerCase()) && !subByName.has(o.styleName.toLowerCase())) {
        try { await db.delete(schema.wooTypeOwners).where(and(eq(schema.wooTypeOwners.storeId, st.id), eq(schema.wooTypeOwners.styleName, o.styleName))); } catch { /* ignore */ }
      }
    }
    return NextResponse.json({ ok: true, count: merged.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 200 });
  }
}
