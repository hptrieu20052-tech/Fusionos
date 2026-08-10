import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { getSession, type Session } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

/**
 * v207 · Thư viện video.
 *   GET    /api/videos?status=&storeId=&productId=&mine=1   → danh sách
 *   POST   /api/videos                                       → tạo bản ghi SAU khi file đã lên R2
 *   PATCH  /api/videos                                       → sửa / duyệt / đánh dấu đã đăng
 *   DELETE /api/videos?id=                                   → xoá bản ghi
 *
 * Quyền: xem/upload cần products≥1 HOẶC designs≥1 (creator thường chỉ có designs).
 *        DUYỆT (approved/rejected) chỉ admin — đây là cửa chặn nội dung ra ngoài.
 *        Người upload sửa/xoá được video CỦA MÌNH khi còn pending; admin toàn quyền.
 */
type Sess = Session;
const canView = async (s: Sess) => (await levelOf(s, "products")) >= 1 || (await levelOf(s, "designs")) >= 1;
const isAdmin = (s: Sess) => s.role === "admin";

const VALID_STATUS = new Set(["pending", "approved", "rejected"]);
const uuidOk = (x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x));

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!(await canView(session))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const q = req.nextUrl.searchParams;
  const conds = [];
  const status = String(q.get("status") ?? "");
  if (VALID_STATUS.has(status)) conds.push(eq(schema.productVideos.status, status));
  const storeId = q.get("storeId");
  if (uuidOk(storeId)) conds.push(eq(schema.productVideos.storeId, String(storeId)));
  const productId = q.get("productId");
  if (uuidOk(productId)) conds.push(eq(schema.productVideos.productId, String(productId)));
  if (q.get("mine") === "1") conds.push(eq(schema.productVideos.uploadedBy, session.sub));

  // Seller chỉ thấy video thuộc store của mình. Video CHƯA gắn store thì chỉ người upload thấy —
  // không để video của người này lọt sang mắt seller khác chỉ vì còn trống store.
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds) {
    const myStores = await db.select({ id: schema.stores.id }).from(schema.stores)
      .where(and(eq(schema.stores.marketplace, "shopify"), inArray(schema.stores.sellerId, scopeIds)));
    const ids = myStores.map((s) => s.id);
    const mineOnly = eq(schema.productVideos.uploadedBy, session.sub);
    conds.push(ids.length
      ? or(inArray(schema.productVideos.storeId, ids), mineOnly)!
      : mineOnly);
  }

  const rows = await db.select({
    v: schema.productVideos,
    productTitle: schema.shopifyProducts.title,
    productGid: schema.shopifyProducts.shopifyProductId,
    storeName: schema.stores.name,
    uploader: schema.users.fullName,
  }).from(schema.productVideos)
    .leftJoin(schema.shopifyProducts, eq(schema.shopifyProducts.id, schema.productVideos.productId))
    .leftJoin(schema.stores, eq(schema.stores.id, schema.productVideos.storeId))
    .leftJoin(schema.users, eq(schema.users.id, schema.productVideos.uploadedBy))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.productVideos.createdAt))
    .limit(300);

  return NextResponse.json({
    ok: true,
    isAdmin: isAdmin(session),
    rows: rows.map((r) => ({
      ...r.v,
      productTitle: r.productTitle ?? null,
      productGid: r.productGid ?? null,
      storeName: r.storeName ?? null,
      uploader: r.uploader ?? null,
      canEdit: isAdmin(session) || (r.v.uploadedBy === session.sub && r.v.status === "pending"),
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!(await canView(session))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const storageKey = String(b?.storageKey ?? "").trim();
  const publicUrl = String(b?.publicUrl ?? "").trim();
  const title = String(b?.title ?? "").trim().slice(0, 200);
  if (!storageKey || !publicUrl) return NextResponse.json({ ok: false, error: "storageKey and publicUrl are required" }, { status: 400 });
  if (!title) return NextResponse.json({ ok: false, error: "title is required" }, { status: 400 });

  const num = (x: unknown, max: number) => {
    const n = Number(x);
    return isFinite(n) && n > 0 && n <= max ? n : null;
  };
  const w = num(b?.width, 20000), h = num(b?.height, 20000);
  // Tỷ lệ quyết định kênh dùng được: 9:16 cho Reels/Shorts/TikTok, 1:1 và 16:9 thì phải cắt lại.
  const aspect = (() => {
    if (!w || !h) return null;
    const r = w / h;
    if (Math.abs(r - 9 / 16) < 0.06) return "9:16";
    if (Math.abs(r - 1) < 0.06) return "1:1";
    if (Math.abs(r - 16 / 9) < 0.08) return "16:9";
    return "other";
  })();

  const [row] = await db.insert(schema.productVideos).values({
    storeId: uuidOk(b?.storeId) ? String(b.storeId) : null,
    productId: uuidOk(b?.productId) ? String(b.productId) : null,
    title,
    note: b?.note ? String(b.note).slice(0, 1000) : null,
    storageKey, publicUrl,
    thumbKey: b?.thumbKey ? String(b.thumbKey) : null,
    thumbUrl: b?.thumbUrl ? String(b.thumbUrl) : null,
    contentType: b?.contentType ? String(b.contentType).slice(0, 100) : null,
    sizeBytes: num(b?.sizeBytes, 5_000_000_000),
    durationSec: b?.durationSec != null && isFinite(Number(b.durationSec)) ? String(Number(b.durationSec).toFixed(2)) : null,
    width: w, height: h, aspect,
    // Admin tự upload thì duyệt luôn — không bắt mình duyệt bài của chính mình.
    status: isAdmin(session) ? "approved" : "pending",
    ...(isAdmin(session) ? { reviewedBy: session.sub, reviewedAt: new Date() } : {}),
    uploadedBy: session.sub,
  }).returning();

  return NextResponse.json({ ok: true, id: row.id, status: row.status });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!(await canView(session))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!uuidOk(b?.id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const [cur] = await db.select().from(schema.productVideos).where(eq(schema.productVideos.id, String(b.id))).limit(1);
  if (!cur) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const admin = isAdmin(session);
  const owner = cur.uploadedBy === session.sub;
  if (!admin && !(owner && cur.status === "pending")) {
    return NextResponse.json({ ok: false, error: "forbidden — approved videos can only be changed by an admin" }, { status: 403 });
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof b.title === "string" && b.title.trim()) patch.title = b.title.trim().slice(0, 200);
  if (typeof b.note === "string") patch.note = b.note.slice(0, 1000);
  if ("productId" in b) patch.productId = uuidOk(b.productId) ? String(b.productId) : null;
  if ("storeId" in b) patch.storeId = uuidOk(b.storeId) ? String(b.storeId) : null;

  // DUYỆT — chỉ admin. Đây là cửa chặn: video approved mới được đẩy Shopify / lấy caption.
  if (typeof b.status === "string" && VALID_STATUS.has(b.status)) {
    if (!admin) return NextResponse.json({ ok: false, error: "only an admin can approve or reject" }, { status: 403 });
    patch.status = b.status;
    patch.reviewedBy = session.sub;
    patch.reviewedAt = new Date();
    if (typeof b.reviewNote === "string") patch.reviewNote = b.reviewNote.slice(0, 500);
  }

  // Đánh dấu đã đăng tay ở một kênh: { markPosted: "tiktok" } · bỏ đánh dấu: { unmarkPosted: "tiktok" }
  const CH = new Set(["tiktok", "reels", "shorts", "facebook", "pinterest"]);
  if (typeof b.markPosted === "string" && CH.has(b.markPosted)) {
    patch.postedTo = { ...(cur.postedTo as Record<string, string> ?? {}), [b.markPosted]: new Date().toISOString() };
  } else if (typeof b.unmarkPosted === "string" && CH.has(b.unmarkPosted)) {
    const p = { ...(cur.postedTo as Record<string, string> ?? {}) };
    delete p[b.unmarkPosted];
    patch.postedTo = p;
  }

  await db.update(schema.productVideos).set(patch).where(eq(schema.productVideos.id, String(b.id)));
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!(await canView(session))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!uuidOk(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const [cur] = await db.select().from(schema.productVideos).where(eq(schema.productVideos.id, String(id))).limit(1);
  if (!cur) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (!isAdmin(session) && !(cur.uploadedBy === session.sub && cur.status === "pending")) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // Chỉ xoá bản ghi. File trên R2 giữ lại — rẻ, và lỡ xoá nhầm còn dò lại được bằng storage_key.
  await db.delete(schema.productVideos).where(eq(schema.productVideos.id, String(id)));
  return NextResponse.json({ ok: true });
}
