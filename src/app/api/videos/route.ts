import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { getSession, type Session } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

/**
 * v207 · Thư viện video.
 *   GET    /api/videos?q=&sellerId=&creatorId=&from=&to=&page=  → danh sách (phân trang)
 *   POST   /api/videos                                       → tạo bản ghi SAU khi file đã lên R2
 *   PATCH  /api/videos                                       → sửa / duyệt / đánh dấu đã đăng
 *   DELETE /api/videos?id=                                   → xoá bản ghi
 *
 * v209b · Không có bước duyệt. Giống Design Studio: seller và creator tự làm việc với nhau,
 * sửa video rồi update lại — hệ thống chỉ giữ file + thông tin, không gác cổng.
 *   level 1 = xem thư viện · level 2 = upload / sửa / xoá / gán listing / đẩy Shopify.
 */
type Sess = Session;
const canView = async (s: Sess) => (await levelOf(s, "videos")) >= 1;
const canManage = async (s: Sess) => (await levelOf(s, "videos")) >= 2;
const isAdmin = (s: Sess) => s.role === "admin";

const uuidOk = (x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x));

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!(await canView(session))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const q = req.nextUrl.searchParams;
  const conds = [];

  // Tìm theo TÊN hoặc ID ngắn (#102 / 102) — giống ô search bên Design Studio.
  const text = String(q.get("q") ?? "").trim().slice(0, 80);
  if (text) {
    const asCode = Number(text.replace(/^#*[vV]?-?/, ""));
    conds.push(Number.isInteger(asCode) && asCode > 0
      ? or(ilike(schema.productVideos.title, `%${text}%`), eq(schema.productVideos.videoCode, asCode))!
      : ilike(schema.productVideos.title, `%${text}%`));
  }
  const sellerId = q.get("sellerId");
  if (uuidOk(sellerId)) conds.push(eq(schema.productVideos.sellerId, String(sellerId)));
  const creatorId = q.get("creatorId");
  if (uuidOk(creatorId)) conds.push(eq(schema.productVideos.uploadedBy, String(creatorId)));
  const kind = String(q.get("kind") ?? "").trim().slice(0, 40);
  if (kind) conds.push(eq(schema.productVideos.kind, kind));
  const dOk = (x: string | null) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
  const from = dOk(q.get("from")), to = dOk(q.get("to"));
  if (from) conds.push(gte(schema.productVideos.createdAt, new Date(from + "T00:00:00Z")));
  if (to) conds.push(lte(schema.productVideos.createdAt, new Date(to + "T23:59:59Z")));

  // Seller chỉ thấy video thuộc store mình, video mình đặt, hoặc video mình tự upload.
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds) {
    const myStores = await db.select({ id: schema.stores.id }).from(schema.stores)
      .where(and(eq(schema.stores.marketplace, "shopify"), inArray(schema.stores.sellerId, scopeIds)));
    const ids = myStores.map((s) => s.id);
    const own = [
      eq(schema.productVideos.uploadedBy, session.sub),
      inArray(schema.productVideos.sellerId, scopeIds),
      ...(ids.length ? [inArray(schema.productVideos.storeId, ids)] : []),
    ];
    conds.push(or(...own)!);
  }

  const where = conds.length ? and(...conds) : undefined;
  const LIMIT = Math.min(Math.max(Number(q.get("limit") ?? 24) || 24, 1), 60);
  const page = Math.max(Number(q.get("page") ?? 1) || 1, 1);

  const [{ n: total }] = await db.select({ n: sql<number>`count(*)::int` })
    .from(schema.productVideos).where(where);

  const rows = await db.select({
    v: schema.productVideos,
    productTitle: schema.shopifyProducts.title,
    storeName: schema.stores.name,
    uploader: schema.users.fullName,
  }).from(schema.productVideos)
    .leftJoin(schema.shopifyProducts, eq(schema.shopifyProducts.id, schema.productVideos.productId))
    .leftJoin(schema.stores, eq(schema.stores.id, schema.productVideos.storeId))
    .leftJoin(schema.users, eq(schema.users.id, schema.productVideos.uploadedBy))
    .where(where)
    .orderBy(desc(schema.productVideos.createdAt))
    .limit(LIMIT).offset((page - 1) * LIMIT);

  // Số listing đang dùng từng video — cột "đang chạy ở đâu", tính một lượt cho cả trang.
  const vids = rows.map((r) => r.v.id);
  const useRows = vids.length
    ? await db.select({ videoId: schema.shopifyProducts.videoId, n: sql<number>`count(*)::int`, pushed: sql<number>`count(${schema.shopifyProducts.videoPushedAt})::int` })
        .from(schema.shopifyProducts)
        .where(inArray(schema.shopifyProducts.videoId, vids))
        .groupBy(schema.shopifyProducts.videoId)
    : [];
  const useMap = new Map(useRows.map((u) => [String(u.videoId), u]));

  // Danh sách cho 2 ô lọc — lấy từ chính dữ liệu video đang có, không liệt kê cả công ty.
  const sellerRows = await db.selectDistinct({ id: schema.users.id, name: schema.users.fullName })
    .from(schema.productVideos).innerJoin(schema.users, eq(schema.users.id, schema.productVideos.sellerId));
  const creatorRows = await db.selectDistinct({ id: schema.users.id, name: schema.users.fullName })
    .from(schema.productVideos).innerJoin(schema.users, eq(schema.users.id, schema.productVideos.uploadedBy));

  const manager = await canManage(session);
  return NextResponse.json({
    ok: true, total, page, limit: LIMIT,
    isAdmin: isAdmin(session), canManage: manager,
    filters: { sellers: sellerRows, creators: creatorRows },
    rows: rows.map((r) => ({
      ...r.v,
      productTitle: r.productTitle ?? null,
      storeName: r.storeName ?? null,
      uploader: r.uploader ?? null,
      usedBy: useMap.get(r.v.id)?.n ?? 0,
      usedPushed: useMap.get(r.v.id)?.pushed ?? 0,
      canEdit: manager || r.v.uploadedBy === session.sub,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!(await canManage(session))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

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
    sellerId: uuidOk(b?.sellerId) ? String(b.sellerId) : null,
    kind: typeof b?.kind === "string" && b.kind ? String(b.kind).slice(0, 40) : null,
    language: typeof b?.language === "string" && b.language ? String(b.language).slice(0, 10) : null,
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

  // Seller ↔ creator tự làm việc với nhau: ai có quyền đầy đủ, hoặc chính người upload, đều sửa được.
  const manager = await canManage(session);
  if (!manager && cur.uploadedBy !== session.sub) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof b.title === "string" && b.title.trim()) patch.title = b.title.trim().slice(0, 200);
  if (typeof b.note === "string") patch.note = b.note.slice(0, 1000);
  if ("productId" in b) patch.productId = uuidOk(b.productId) ? String(b.productId) : null;
  if ("storeId" in b) patch.storeId = uuidOk(b.storeId) ? String(b.storeId) : null;

  if ("sellerId" in b) patch.sellerId = uuidOk(b.sellerId) ? String(b.sellerId) : null;
  // v209b · metadata để sau còn lọc & tái sử dụng clip
  if ("kind" in b) patch.kind = typeof b.kind === "string" && b.kind ? String(b.kind).slice(0, 40) : null;
  if ("language" in b) patch.language = typeof b.language === "string" && b.language ? String(b.language).slice(0, 10) : null;
  if ("sourceName" in b) patch.sourceName = typeof b.sourceName === "string" && b.sourceName ? String(b.sourceName).slice(0, 120) : null;
  if ("shotAt" in b) patch.shotAt = typeof b.shotAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.shotAt) ? b.shotAt : null;
  if ("flags" in b && b.flags && typeof b.flags === "object") {
    const f = b.flags as Record<string, unknown>;
    patch.flags = { voice: !!f.voice, text: !!f.text, music: !!f.music };
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
  if (!(await canManage(session)) && cur.uploadedBy !== session.sub) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // Chỉ xoá bản ghi. File trên R2 giữ lại — rẻ, và lỡ xoá nhầm còn dò lại được bằng storage_key.
  await db.delete(schema.productVideos).where(eq(schema.productVideos.id, String(id)));
  return NextResponse.json({ ok: true });
}
