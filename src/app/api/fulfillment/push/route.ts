import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { getAdapter, type PushLine } from "@/lib/fulfillers";
import { ensureWebhooks } from "@/lib/printify";
import { fileUrl } from "@/lib/storage";
import { fetchAndStoreTiktokLabels } from "@/lib/tiktok-label";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Fluid Compute cho Hobby tới 300s; push chủ yếu I/O nên không tốn Active CPU

/**
 * POST { orderId, fulfillerId } — đẩy đơn sang fulfiller.
 * Có credentials thật → gọi API thật (adapter theo từng hãng).
 * Chưa có credentials (dev) → simulate, vẫn ghi sổ đầy đủ.
 * Ghi: fulfillment_orders (pushed) + transaction base_cost (âm) + order → created.
 */
export async function POST(req: NextRequest) {
  try {
    return await handlePush(req);
  } catch (e) {
    console.error("[fulfillment/push] crashed:", e);
    return NextResponse.json({ ok: false, error: "push crashed: " + String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}

async function handlePush(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "fulfillment")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b?.orderId || !b?.fulfillerId) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });

  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, b.orderId)).limit(1);
  if (!order) return NextResponse.json({ ok: false, error: "order not found" }, { status: 404 });
  // Đơn TÁCH NHIỀU NHÀ IN: cho push tiếp khi status "created" nếu vẫn còn item CHƯA đẩy (kiểm ở dưới).
  if (!["new", "has_issues", "created"].includes(order.status)) {
    return NextResponse.json({ ok: false, error: `order is in ${order.status} status — cannot push` }, { status: 409 });
  }
  if (!order.addr1 || !order.buyerLast) {
    return NextResponse.json({ ok: false, error: "missing recipient address — edit Shipping Info first" }, { status: 400 });
  }

  const [ff] = await db.select().from(schema.fulfillers).where(eq(schema.fulfillers.id, b.fulfillerId)).limit(1);
  if (!ff) return NextResponse.json({ ok: false, error: "fulfiller not found" }, { status: 404 });

  const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id));

  // Map design URL (front/back/sleeve/hood) theo designId — cho adapter cần artwork (Merchize...)
  const designIds = Array.from(new Set(items.map((i) => i.designId).filter(Boolean))) as string[];
  type SideMap = {
    front?: string; back?: string; frontW?: number; frontH?: number; backW?: number; backH?: number;
    sides: { kind: string; url: string; w?: number; h?: number }[];
  };
  const sideUrls = new Map<string, SideMap>();
  if (designIds.length) {
    const files = await db.select().from(schema.designFiles).where(inArray(schema.designFiles.designId, designIds));
    for (const f of files) {
      if (f.kind === "mockup" || f.kind === "video") continue; // chỉ lấy MẶT IN
      const cur: SideMap = sideUrls.get(f.designId) ?? { sides: [] };
      const url = fileUrl(f.storageKey) ?? undefined;
      if (!url) { sideUrls.set(f.designId, cur); continue; }
      // Mọi mặt in (design_front/back, book_cover, page_xx, month_xx, grid_xx...) → adapter tự map theo nhà in
      cur.sides.push({ kind: f.kind, url, w: f.width ?? undefined, h: f.height ?? undefined });
      if (f.kind === "design_front") { cur.front = url; cur.frontW = f.width ?? undefined; cur.frontH = f.height ?? undefined; }
      else if (f.kind === "design_back") { cur.back = url; cur.backW = f.width ?? undefined; cur.backH = f.height ?? undefined; }
      sideUrls.set(f.designId, cur);
    }
  }
  const enrich = (it: typeof items[number], m: typeof schema.skuMappings.$inferSelect) => {
    const s: SideMap = (it.designId ? sideUrls.get(it.designId) : undefined) ?? { sides: [] };
    return {
      internalSku: m.internalSku, productId: m.fulfillerProductId ?? null,
      variant: m.variant ?? null, fulfillerProduct: m.fulfillerProduct ?? m.productType ?? null,
      price: Number(it.unitPrice) || undefined, currency: "USD",
      // Merchize image = mockup của ĐƠN (upload theo order), KHÔNG lấy từ card design.
      image: fileUrl(it.mockupKey) ?? it.imageUrl ?? null, // mockup gửi nhà in = đúng ảnh hiển thị trên đơn (mockup tay/link → ảnh listing Etsy)
      designFront: s.front ?? null, designBack: s.back ?? null,
      designFrontW: s.frontW, designFrontH: s.frontH, designBackW: s.backW, designBackH: s.backH,
      designSides: s.sides,
      pfBlueprintId: m.pfBlueprintId ?? null, pfProviderId: m.pfProviderId ?? null, pfVariantId: m.pfVariantId ?? null,
      extra: (m.extraJson ?? null) as Record<string, unknown> | null,
      personalization: it.personalization ?? null,
    };
  };

  // Chế độ mới: client gửi lines [{itemId, mappingId, qty}] — variant do người fulfill chọn tay
  let cost = 0;
  let baseSum = 0;
  let shipSum = 0;
  let lineNote = "";
  const pushLines: PushLine[] = [];
  // Lưu kèm itemId + mappingId để card đơn ĐÃ ĐẨY dựng lại được panel review (chỉ đọc)
  const pushedLines: { itemId: string; mappingId: string; product: string; variant: string | null; sku: string; qty: number }[] = [];
  // Item đã nằm trong bản ghi fulfill trước đó (đơn tách nhiều nhà in) — cấm đẩy ĐÚP.
  const priorFf = await db.select({ id: schema.fulfillmentOrders.id, lines: schema.fulfillmentOrders.lines })
    .from(schema.fulfillmentOrders).where(eq(schema.fulfillmentOrders.orderId, order.id));
  const alreadyPushed = new Set(
    priorFf.flatMap((p) => Array.isArray(p.lines) ? (p.lines as { itemId?: string }[]).map((l) => l.itemId).filter(Boolean) as string[] : []),
  );

  if (Array.isArray(b.lines) && b.lines.length) {
    // PUSH TỪNG PHẦN: không bắt đủ mọi item — đơn 2 item có thể đẩy 2 nhà in khác nhau, mỗi đợt một phần.
    if (b.lines.length > items.length) {
      return NextResponse.json({ ok: false, error: "more lines than order items" }, { status: 400 });
    }
    const mapIds = b.lines.map((l: { mappingId: string }) => l.mappingId).filter(Boolean);
    if (mapIds.length !== b.lines.length) {
      return NextResponse.json({ ok: false, error: "each selected item must have style/size/color selected (fulfiller SKU)" }, { status: 400 });
    }
    // Đơn đã "created" (đã push 1 phần) → CHỈ được đẩy item chưa push; đẩy lại phải xoá bản ghi cũ trước.
    for (const l of b.lines as { itemId: string }[]) {
      if (alreadyPushed.has(l.itemId)) {
        const it = items.find((x) => x.id === l.itemId);
        return NextResponse.json({ ok: false, error: `item "${(it?.productTitle ?? l.itemId).slice(0, 60)}" was already pushed in another fulfillment record — delete that record (✕) first if you want to re-push it` }, { status: 409 });
      }
    }
    const chosen = await db.select().from(schema.skuMappings)
      .where(and(eq(schema.skuMappings.fulfillerId, ff.id), inArray(schema.skuMappings.id, mapIds)));
    const parts: string[] = [];
    for (const l of b.lines as { itemId: string; mappingId: string; qty: number }[]) {
      const it = items.find((x) => x.id === l.itemId);
      const m = chosen.find((x) => x.id === l.mappingId);
      const qty = Number(l.qty);
      if (!it) return NextResponse.json({ ok: false, error: "item doesn't belong to this order" }, { status: 400 });
      // Item qty 0 = ĐÃ TÁCH sang đơn khác (Duplicate/Split) — cấm đẩy từ đơn này.
      if ((it.qty ?? 0) < 1) return NextResponse.json({ ok: false, error: `item "${it.productTitle.slice(0, 60)}" has qty 0 (split to another order) — cannot push it from this order` }, { status: 400 });
      if (!m) return NextResponse.json({ ok: false, error: "variant doesn't belong to the selected fulfiller" }, { status: 400 });
      if (!Number.isInteger(qty) || qty < 1) return NextResponse.json({ ok: false, error: "qty must be ≥ 1" }, { status: 400 });
      baseSum += Number(m.baseCost) * qty;
      shipSum += Number(m.shipCost) * qty;
      cost += (Number(m.baseCost) + Number(m.shipCost)) * qty;
      parts.push(`${m.fulfillerSku}×${qty}`);
      pushLines.push({ fulfillerSku: m.fulfillerSku, qty, ...enrich(it, m) });
      pushedLines.push({ itemId: it.id, mappingId: m.id, product: it.productTitle, variant: m.variant ?? null, sku: m.fulfillerSku, qty });
    }
    lineNote = " · " + parts.join(", ");
  } else {
    // Chế độ cũ: tự khớp theo internal_sku — đẩy TẤT CẢ item, nên cấm dùng khi đơn đã push 1 phần.
    if (alreadyPushed.size) {
      return NextResponse.json({ ok: false, error: "this order already has a fulfillment record — select the remaining items (with variants) to push the rest" }, { status: 409 });
    }
    // Item qty 0 (đã tách sang đơn khác) → bỏ qua, không đẩy.
    const liveItems = items.filter((i) => (i.qty ?? 0) >= 1);
    if (!liveItems.length) return NextResponse.json({ ok: false, error: "all items have qty 0 (split away) — nothing to push from this order" }, { status: 400 });
    const skus = liveItems.map((i) => i.internalSku).filter(Boolean) as string[];
    const maps = skus.length
      ? await db.select().from(schema.skuMappings).where(and(eq(schema.skuMappings.fulfillerId, ff.id), inArray(schema.skuMappings.internalSku, skus)))
      : [];
    const missing = liveItems.filter((i) => !i.internalSku || !maps.find((m) => m.internalSku === i.internalSku));
    if (missing.length) {
      return NextResponse.json({
        ok: false,
        error: `SKU chưa mapping với ${ff.name}: ${missing.map((m) => m.internalSku ?? m.productTitle).join(", ")}`,
      }, { status: 400 });
    }
    for (const i of liveItems) {
      const m = maps.find((x) => x.internalSku === i.internalSku)!;
      baseSum += Number(m.baseCost) * i.qty;
      shipSum += Number(m.shipCost) * i.qty;
      pushLines.push({ fulfillerSku: m.fulfillerSku, qty: i.qty, ...enrich(i, m) });
      pushedLines.push({ itemId: i.id, mappingId: m.id, product: i.productTitle, variant: m.variant ?? null, sku: m.fulfillerSku, qty: i.qty });
    }
    cost = baseSum + shipSum;
  }

  // CHẶN ĐẨY: SKU đánh dấu "custom" (thêu tên) BẮT BUỘC có file design để gửi attachments.
  // Compassup là non-POD nên không bị chặn design ở tầng UI → phải kiểm ở đây.
  const customNoDesign = pushLines.filter((l) => {
    const isCustom = (l.extra as Record<string, unknown> | null)?.custom === true;
    const hasDesign = (l.designSides && l.designSides.length > 0) || !!l.designFront;
    return isCustom && !hasDesign;
  });
  if (customNoDesign.length) {
    return NextResponse.json({
      ok: false,
      error: `Custom SKU requires a design before pushing: ${customNoDesign.map((l) => l.fulfillerSku).join(", ")}. Assign a DesignId to the item first.`,
    }, { status: 400 });
  }

  // Đảm bảo số đơn gửi nhà in = TênStore-IDĐơn (nếu chưa set orderLabel thì tự dựng)
  let orderLabel = (order.orderLabel ?? "").trim();
  if (!orderLabel) {
    const [st] = order.storeId ? await db.select({ name: schema.stores.name }).from(schema.stores).where(eq(schema.stores.id, order.storeId)).limit(1) : [];
    const shop = (st?.name ?? "SHOP").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    orderLabel = `${shop}-${order.externalId}`;
  }

  // --- CHỈ đơn Ship-by-TikTok: BẮT BUỘC có nhãn TikTok mới cho đẩy (không có → chặn, tránh supplier ship thiếu nhãn). ---
  let ttLabelUrl: string | undefined, ttTracking: string | undefined;
  if (order.shippingType === "TIKTOK") {
    const existing = (order.tiktokLabels as { url?: string | null; trackingNumber?: string }[] | null) ?? [];
    let lbl = existing.find((l) => l?.url);
    if (!lbl) {
      const r = await fetchAndStoreTiktokLabels(order.id, { autoArrange: true }); // tự Arrange (mua nhãn) nếu chưa có package
      if (r.ok) lbl = r.labels.find((l) => l.url);
    }
    if (lbl) { ttLabelUrl = lbl.url ?? undefined; ttTracking = lbl.trackingNumber; }
    else return NextResponse.json({
      ok: false,
      error: "TikTok Shipping order has no shipping label yet — arrange shipment on TikTok first, then push.",
    }, { status: 400 });
  }

  // --- Gọi API fulfiller qua adapter theo từng nhà ---
  // Google Sheet (Hướng B): tab chọn lúc đẩy → ghi đè credentials.tab
  const ffCreds = ((ff.credentials as { kind?: string } | null)?.kind === "gsheet" && b.gsheetTab)
    ? { ...(ff.credentials as Record<string, unknown>), tab: String(b.gsheetTab) }
    : ff.credentials;
  const adapter = getAdapter(ff.name, ffCreds);
  let pushRes;
  console.log(`[push] ${ff.name} order=${order.externalId} adapter start`);
  const t0 = Date.now();
  try {
    pushRes = await adapter.push({
      fulfiller: { id: ff.id, name: ff.name, apiEndpoint: ff.apiEndpoint, credentials: ffCreds },
      order: {
        externalId: order.externalId, orderLabel,
        buyerFirst: order.buyerFirst, buyerLast: order.buyerLast,
        addr1: order.addr1, addr2: order.addr2, city: order.city,
        state: order.state, zip: order.zip, country: order.country,
        platform: order.platform,
        labelUrl: ttLabelUrl, shippingTracking: ttTracking,
        shippingType: order.shippingType,
      },
      lines: pushLines,
    });
  } catch (e) {
    console.error(`[push] ${ff.name} adapter FAILED after ${Date.now() - t0}ms:`, e);
    return NextResponse.json({ ok: false, error: `Push to ${ff.name} failed: ${String((e as Error)?.message ?? e).slice(0, 400)}` }, { status: 500 });
  }
  console.log(`[push] ${ff.name} adapter OK in ${Date.now() - t0}ms → ${pushRes.externalFfId}`);
  const externalFfId = pushRes.externalFfId;

  // Chi phí: ưu tiên giá THẬT nhà in trả về (Printify); else giá vốn từ SKU mapping
  const finalBase = pushRes.baseCost != null ? pushRes.baseCost : baseSum;
  const finalShip = pushRes.shipCost != null ? pushRes.shipCost : shipSum;
  const finalTax = pushRes.tax ?? 0;
  const finalCost = finalBase + finalShip + finalTax;

  const [ffo] = await db.insert(schema.fulfillmentOrders).values({
    orderId: order.id, fulfillerId: ff.id, externalFfId,
    status: "pushed", cost: finalCost.toFixed(2), baseCost: finalBase.toFixed(2), shipCost: finalShip.toFixed(2), extraFee: finalTax.toFixed(2), pushedAt: new Date(),
    lines: pushedLines,
  }).returning();

  await db.update(schema.orders).set({ status: "created", updatedAt: new Date() }).where(eq(schema.orders.id, order.id));

  // Tự đăng ký webhook Printify LẦN ĐẦU (idempotent) — khỏi terminal/curl. Cờ lưu trong credentials.
  if (!pushRes.simulated && ff.name.toLowerCase().includes("printify")) {
    const cr = (ff.credentials ?? {}) as Record<string, unknown>;
    // Cờ phải gắn với SHOP ID: trước đây chỉ có printifyWebhooksAt → đổi token/shop id thì
    // shop mới KHÔNG được đăng ký webhook → đơn đứng $0 và không bao giờ có tracking.
    const token = (cr.apiKey || cr.apiToken) as string | undefined;
    const shopId = cr.shopId as string | number | undefined;
    if (token && shopId && String(cr.printifyWebhookShop ?? "") !== String(shopId)) {
      try {
        await ensureWebhooks(token, shopId, `${req.nextUrl.origin}/api/webhooks/printify`);
        await db.update(schema.fulfillers).set({
          credentials: { ...cr, printifyWebhookShop: String(shopId), printifyWebhooksAt: new Date().toISOString() },
        }).where(eq(schema.fulfillers.id, ff.id));
      } catch { /* không chặn đẩy đơn */ }
    }
  }

  // Ghi chi phí vào sổ (âm) — trang Tài chính SUM là ra
  await db.insert(schema.transactions).values({
    type: "base_cost", amount: (-finalCost).toFixed(2),
    orderId: order.id, storeId: order.storeId, sellerId: order.sellerId,
    note: `${ff.name} · ${externalFfId}${lineNote}`,
    // Chi phí ghi theo NGÀY KÉO ĐƠN VỀ (ordered_at) — trùng mốc doanh thu.
    occurredAt: (order.orderedAt ? new Date(order.orderedAt) : new Date()).toISOString().slice(0, 10),
  });

  return NextResponse.json({ ok: true, ffOrderId: ffo.id, externalFfId, cost: finalCost, simulated: pushRes.simulated, reason: pushRes.reason });
}
