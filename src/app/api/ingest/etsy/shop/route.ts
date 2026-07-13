import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const json = (b: unknown, s = 200) =>
  NextResponse.json(b, { status: s, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" } });

export async function OPTIONS() {
  return json({ ok: true });
}

/**
 * Shop health — số liệu công khai của shop Etsy, do EXTENSION đọc hộ.
 *
 * Vì sao không fetch từ server: đa số store dùng connect_method = "extension" (không xin được API Etsy),
 * nên mọi cách dựa vào token API đều không phủ hết. Trang shop public thì shop nào cũng có.
 * Nhưng fetch từ Vercel (IP datacenter) gần như chắc chắn bị Etsy chặn.
 * Extension chạy trong AdsPower, đi đúng proxy của shop → Etsy nhìn như người dùng thật, không bị chặn.
 *
 * GET  + Bearer <store ingest_token>  → trả URL shop cần đọc (server quyết định, extension khỏi đoán)
 * POST + Bearer <store ingest_token>  → nhận kết quả, lưu vào stores.health
 */

async function storeFromToken(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const [st] = await db
    .select({ id: schema.stores.id, name: schema.stores.name, marketplace: schema.stores.marketplace, storeUrl: schema.stores.storeUrl, health: schema.stores.health })
    .from(schema.stores)
    .where(eq(schema.stores.ingestToken, token))
    .limit(1);
  return st ?? null;
}

/** Dựng URL shop public: ưu tiên store_url đã điền, không có thì suy từ tên store. Luôn cắt query string. */
function shopUrlOf(st: { name: string; storeUrl: string | null }): string | null {
  const raw = (st.storeUrl ?? "").trim();
  if (raw) {
    const m = raw.match(/etsy\.com\/shop\/([^/?#]+)/i);
    if (m) return `https://www.etsy.com/shop/${m[1]}`;
  }
  // Fallback: tên store thường trùng tên shop Etsy (VD "ImpressedYet")
  const guess = st.name.trim().replace(/\s+/g, "");
  return /^[A-Za-z0-9_-]{3,}$/.test(guess) ? `https://www.etsy.com/shop/${guess}` : null;
}

export async function GET(req: NextRequest) {
  const st = await storeFromToken(req);
  if (!st) return json({ ok: false, error: "invalid token" }, 401);
  if (st.marketplace !== "etsy") return json({ ok: true, shopUrl: null }); // chỉ Etsy

  const h = (st.health ?? {}) as Record<string, unknown>;
  const last = typeof h.shopCheckedAt === "string" ? Date.parse(h.shopCheckedAt) : 0;
  // 1 lần/ngày là đủ — số sale không đổi theo giờ, và nhẹ nhất cho Etsy
  const due = !last || Date.now() - last > 20 * 3600 * 1000;

  return json({ ok: true, shopUrl: due ? shopUrlOf(st) : null });
}

export async function POST(req: NextRequest) {
  const st = await storeFromToken(req);
  if (!st) return json({ ok: false, error: "invalid token" }, 401);

  const b = await req.json().catch(() => null);
  if (!b) return json({ ok: false, error: "bad body" }, 400);

  // BUG CŨ: Number(null) = 0 và isFinite(0) = true → null biến thành 0,
  // nên lần check hỏng lại hiện ra "0 (0) · 0 sales" thay vì ẩn đi.
  const num = (v: unknown) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const prev = (st.health as Record<string, unknown>) ?? {};
  const ok = b.ok === true;     // extension đọc được số liệu thật (không phải trang chặn/captcha)
  const gone = b.gone === true; // xác định chắc chắn shop đã đóng (404 / "shop not available")
  const status = typeof b.status === "number" ? b.status : null;

  // Chặn bot (403/429) hay lỗi mạng KHÔNG PHẢI là suspend. Trước đây gộp chung → báo suspend oan.
  // Không đọc được gì thì giữ nguyên trạng thái cũ, chỉ ghi nhận lần check thất bại.
  if (!ok && !gone) {
    const health = {
      ...prev,
      shopCheckedAt: new Date().toISOString(),
      shopCheckFailed: true,
      shopStatus: status,
    };
    await db.update(schema.stores).set({ health }).where(eq(schema.stores.id, st.id));
    return json({ ok: true, note: "check failed — previous state kept" });
  }

  const shop: Record<string, unknown> = {
    shopLive: !gone,
    shopStatus: status,
    shopCheckedAt: new Date().toISOString(),
    shopCheckFailed: false,
  };
  // Chỉ ghi đè số liệu khi đọc được thật — không xoá số cũ bằng null
  if (!gone) {
    const fields: [string, unknown][] = [
      ["shopSales", num(b.sales)], ["shopRating", num(b.rating)],
      ["shopReviews", num(b.reviews)], ["shopListings", num(b.listings)],
      ["shopAge", typeof b.age === "string" && b.age ? b.age.slice(0, 40) : null],
    ];
    for (const [k, v] of fields) if (v != null) shop[k] = v;
  }

  const health = { ...prev, ...shop };
  await db.update(schema.stores).set({ health }).where(eq(schema.stores.id, st.id));
  return json({ ok: true });
}
