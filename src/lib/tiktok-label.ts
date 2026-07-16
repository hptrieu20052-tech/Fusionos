import { db, schema } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { ttGetValidCfg, ttGetPackageIdsForOrder, ttGetShippingDocument, ttCreatePackage, ttGetShippingServices } from "@/lib/tiktok-shop";
import { writeFile, fileUrl } from "@/lib/storage";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type TtLabel = { packageId: string; trackingNumber?: string; key: string; url: string | null; fetchedAt: string };
export type LabelResult = { ok: boolean; labels: TtLabel[]; reason?: string; error?: string };

/**
 * Lấy label TikTok Shipping của 1 đơn (đã Arrange) → tải PDF → lưu R2 → link bền cho supplier.
 * CHỈ áp dụng đơn shipping_type = TIKTOK. Đơn chưa Arrange (chưa có package) → reason để UI báo.
 * best-effort: không ném lỗi làm hỏng luồng gọi.
 */
export async function fetchAndStoreTiktokLabels(orderInternalId: string, opts?: { autoArrange?: boolean }): Promise<LabelResult> {
  const [order] = await db.select({
    id: schema.orders.id, platform: schema.orders.platform, externalId: schema.orders.externalId,
    storeId: schema.orders.storeId, shippingType: schema.orders.shippingType,
  }).from(schema.orders).where(eq(schema.orders.id, orderInternalId)).limit(1);
  if (!order) return { ok: false, labels: [], reason: "order not found" };
  if (order.platform !== "tiktok") return { ok: false, labels: [], reason: "not a TikTok order" };
  if (order.shippingType !== "TIKTOK") return { ok: false, labels: [], reason: "not a TikTok-shipping order (Seller Shipping doesn't use TikTok label)" };
  if (!order.storeId) return { ok: false, labels: [], reason: "order has no store" };

  const [store] = await db.select({ c: schema.stores.apiCredentials }).from(schema.stores).where(eq(schema.stores.id, order.storeId)).limit(1);
  const cred = (store?.c ?? null) as Record<string, string> | null;

  try {
    const cfg = await ttGetValidCfg(order.storeId, cred);
    let pkgs = await ttGetPackageIdsForOrder(cfg, order.externalId);

    // AUTO-ARRANGE: chưa có package + được phép → tạo package = MUA NHÃN ($3.95). Idempotent qua tiktok_arranged_at.
    if (!pkgs.length && opts?.autoArrange) {
      const locked = await db.execute(sql`UPDATE orders SET tiktok_arranged_at = now() WHERE id = ${order.id} AND tiktok_arranged_at IS NULL RETURNING id`);
      if (!locked.rows.length) {
        // tiến trình khác đang/đã arrange → đọc lại package
        pkgs = await ttGetPackageIdsForOrder(cfg, order.externalId);
        if (!pkgs.length) return { ok: false, labels: [], reason: "arrange đang chạy ở tiến trình khác — thử lại sau chốc lát" };
      } else {
        try {
          const svc = await ttGetShippingServices(cfg, order.externalId).catch(() => ({ serviceId: null }));
          const cp = await ttCreatePackage(cfg, order.externalId, svc.serviceId);
          if (!cp.packageId) throw new Error("Create Package: không trả về package id");
          pkgs = await ttGetPackageIdsForOrder(cfg, order.externalId);
          if (!pkgs.length) pkgs = [{ id: cp.packageId }];
        } catch (e) {
          await db.update(schema.orders).set({ tiktokArrangedAt: null }).where(eq(schema.orders.id, order.id)); // mở khoá để retry
          return { ok: false, labels: [], error: "arrange failed: " + String((e as Error)?.message ?? e).slice(0, 250) };
        }
      }
    }

    if (!pkgs.length) return { ok: false, labels: [], reason: "No package yet — arrange shipment on TikTok Seller Center first, then fetch." };

    const labels: TtLabel[] = [];
    for (const pkg of pkgs) {
      // nhãn có thể chưa sẵn ngay sau khi arrange → thử lại vài lần
      let doc: { doc_url?: string } & Record<string, unknown> = {};
      for (let i = 0; i < 3; i++) {
        doc = await ttGetShippingDocument(cfg, pkg.id);
        if (doc?.doc_url) break;
        if (i < 2) await sleep(2500);
      }
      const docUrl = String(doc?.doc_url ?? "");
      if (!docUrl) continue;
      // Tải PDF (link TikTok hết hạn ~24h) → lưu R2 để link bền cho supplier.
      const res = await fetch(docUrl, { signal: AbortSignal.timeout(25000) });
      if (!res.ok) throw new Error(`download label failed: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const key = `tiktok-labels/${order.externalId}-${pkg.id}.pdf`;
      await writeFile(key, buf, "application/pdf");
      labels.push({
        packageId: pkg.id,
        trackingNumber: pkg.trackingNumber ?? (doc?.tracking_number ? String(doc.tracking_number) : undefined),
        key, url: fileUrl(key), fetchedAt: new Date().toISOString(),
      });
    }
    if (!labels.length) return { ok: false, labels: [], reason: "package đã tạo nhưng nhãn chưa sẵn — cron sẽ lấy lại" };

    await db.update(schema.orders).set({ tiktokLabels: labels }).where(eq(schema.orders.id, order.id));
    return { ok: true, labels };
  } catch (e) {
    return { ok: false, labels: [], error: String((e as Error)?.message ?? e).slice(0, 300) };
  }
}
