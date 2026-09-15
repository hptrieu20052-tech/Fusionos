import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds, sharedStoreIds } from "@/lib/scope";
import { wooBridgeApi, wooConfigured, type WooCred } from "@/lib/woocommerce";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/woo-product-types — Product Types (styles) của Woo Custom Pro trên store (v505).
 * Đọc/ghi TRỰC TIẾP file data/products.json trên store qua plugin cầu nối wcp-fusion-bridge
 * (namespace wc-fusion/v1, auth = đúng cặp Consumer key/secret store đã nhập).
 *   GET  ?storeId=            — danh sách style { styles, image, sizes[], colors[], designs[] }
 *   POST { storeId, styles }  — ghi đè TOÀN BỘ danh sách (FUSION luôn gửi list đầy đủ)
 * Ghi (POST) chỉ cho admin/manager KHÔNG bị scope — seller được share store chỉ ĐỌC để chọn
 * Product Type khi list; sửa khung style là việc của chủ hệ thống.
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

/** Style đúng cấu trúc products.json plugin đang đọc. */
type Style = { styles: string; image: string; sizes: string[]; colors: string[]; designs: string[] };
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
    const sizes = (Array.isArray(s.sizes) ? s.sizes : []).map((x) => strv(x)).filter(Boolean).slice(0, 60);
    if (!sizes.length) return { error: `Style "${name}": add at least one size` };
    for (const sz of sizes) {
      if (!/^.+-\d+(\.\d{1,2})?$/.test(sz)) return { error: `Style "${name}": size "${sz}" must be "Name-Price" like "M-18.99"` };
      const price = Number(sz.slice(sz.lastIndexOf("-") + 1));
      if (!(price > 0)) return { error: `Style "${name}": size "${sz}" price must be > 0` };
    }
    const colors = (Array.isArray(s.colors) ? s.colors : []).map((x) => strv(x)).filter(Boolean).slice(0, 60);
    let designs = (Array.isArray(s.designs) ? s.designs : []).map((x) => strv(x)).filter(Boolean).slice(0, 10);
    if (!designs.length) designs = ["front", "back"];
    out.push({ styles: name, image: strv(s.image).slice(0, 500), sizes, colors, designs });
  }
  return out;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if ((await levelOf(session, "products")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const st = await wooStore(session, String(req.nextUrl.searchParams.get("storeId") ?? ""));
  if ("error" in st) return NextResponse.json({ ok: false, error: st.error }, { status: st.status });
  try {
    const j = (await wooBridgeApi(st.cred, "product-types")) as { styles?: unknown };
    const styles = Array.isArray(j?.styles) ? j.styles : [];
    return NextResponse.json({ ok: true, styles, canEditTypes: !st.scoped });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    // Chưa cài bridge → trả cờ riêng để UI hiện hướng dẫn cài (không phải lỗi đỏ).
    if (/Fusion Bridge/i.test(msg)) return NextResponse.json({ ok: true, styles: [], needBridge: true, canEditTypes: !st.scoped });
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
  // Seller trong scope (kể cả được share store): chỉ đọc — khung style do admin/manager quản.
  if (st.scoped) return NextResponse.json({ ok: false, error: "Only admins/managers can edit Product Types." }, { status: 403 });
  const styles = cleanStyles(b?.styles);
  if ("error" in styles) return NextResponse.json({ ok: false, error: styles.error }, { status: 400 });
  try {
    await wooBridgeApi(st.cred, "product-types", { method: "POST", body: JSON.stringify({ styles }) });
    return NextResponse.json({ ok: true, count: styles.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 200 });
  }
}
