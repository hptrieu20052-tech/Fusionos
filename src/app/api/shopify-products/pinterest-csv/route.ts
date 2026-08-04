import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

/**
 * POST /api/shopify-products/pinterest-csv { ids, perProduct?, perFile? }
 *   → { files: [{ name, content }] }  — file nạp thẳng vào Pinterest: Settings → Import content.
 *
 * KHÔNG đụng Shopify, KHÔNG gọi AI, KHÔNG lưu ảnh ở đâu cả: ảnh Shopify vốn đã là link CDN công khai
 * nên nhét thẳng vào cột "Media URL" là Pinterest tự tải về được.
 *
 * Thứ tự cột do Pinterest quy định — KHÔNG đổi tên, KHÔNG đổi chỗ, KHÔNG bỏ cột trống:
 *   Title, Media URL, Pinterest board, Thumbnail, Description, Link, Publish date, Keywords
 * Thumbnail chỉ dùng cho video ⇒ để trống. Publish date để trống ⇒ đăng ngay.
 * Pinterest chỉ nhận tối đa 200 dòng / 1 lần upload ⇒ cắt thành nhiều file.
 * Board không tồn tại thì Pinterest tự tạo.
 */

const MAX_ROWS = 200;
const TITLE_MAX = 100;
const DESC_MAX = 500;

type Img = { src?: string; position?: number };
type Coll = { id?: string; title?: string };

/** Bỏ tag HTML + gom khoảng trắng. Mô tả Shopify là HTML, nhét thẳng vào CSV là ra đầy <p>. */
const plain = (s: unknown) =>
  String(s ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();

/** Cắt theo từ, không cắt giữa chữ. */
function clamp(s: string, max: number) {
  const t = plain(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-–—]+$/, "");
}

const qq = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
const PIN_HEAD = ["Title", "Media URL", "Pinterest board", "Thumbnail", "Description", "Link", "Publish date", "Keywords"];

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 1) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const b = await req.json().catch(() => null);
  const ids: string[] = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => /^[0-9a-f-]{36}$/i.test(String(x)));
  if (!ids.length) return NextResponse.json({ ok: false, error: "ids required" }, { status: 400 });
  const perProduct = Math.min(Math.max(Number(b?.perProduct ?? 1) || 1, 1), 5);
  const perFile = Math.min(Math.max(Number(b?.perFile ?? MAX_ROWS) || MAX_ROWS, 1), MAX_ROWS);
  const tail = typeof b?.tail === "string" ? plain(b.tail).slice(0, 200) : "";

  const rows = await db.select({
    id: schema.shopifyProducts.id,
    title: schema.shopifyProducts.title,
    handle: schema.shopifyProducts.handle,
    tags: schema.shopifyProducts.tags,
    productType: schema.shopifyProducts.productType,
    seo: schema.shopifyProducts.seoDescription,
    feedDesc: schema.shopifyProducts.feedDescription,
    body: schema.shopifyProducts.bodyHtml,
    images: schema.shopifyProducts.images,
    collections: schema.shopifyProducts.collections,
    url: schema.shopifyProducts.onlineStoreUrl,
    storeUrl: schema.stores.storeUrl,
    storeName: schema.stores.name,
    seller: schema.stores.sellerId,
  }).from(schema.shopifyProducts)
    .leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(inArray(schema.shopifyProducts.id, ids));

  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && rows.some((r) => !r.seller || !scopeIds.includes(r.seller))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // Giữ đúng thứ tự người dùng đang thấy trên bảng.
  const order = new Map(ids.map((id, i) => [id, i]));
  rows.sort((a, b2) => (order.get(a.id) ?? 0) - (order.get(b2.id) ?? 0));

  const out: string[][] = [];
  let noImage = 0, noLink = 0, noBoard = 0;

  for (const r of rows) {
    const arr = Array.isArray(r.images) ? (r.images as Img[]) : [];
    const imgs = [...arr].sort((a, b2) => (a.position ?? 99) - (b2.position ?? 99))
      .map((i) => String(i.src ?? "").trim())
      .filter((s) => /^https:\/\//i.test(s))
      .slice(0, perProduct);
    if (!imgs.length) { noImage++; continue; }

    // Link sản phẩm: ưu tiên URL Shopify trả về, không có thì ghép từ domain store.
    const base = String(r.storeUrl ?? "").trim().replace(/\/+$/, "");
    const link = String(r.url ?? "").trim()
      || (base && r.handle ? `${/^https?:\/\//i.test(base) ? base : `https://${base}`}/products/${r.handle}` : "");
    if (!link) { noLink++; continue; }

    // Board = tên collection (đúng yêu cầu). Sản phẩm chưa gắn collection thì lấy Product type,
    // vì Pinterest BẮT BUỘC có board — bỏ trống là hỏng cả file.
    const colls = Array.isArray(r.collections) ? (r.collections as Coll[]) : [];
    const collTitle = colls.map((c) => String(c?.title ?? "").trim()).filter(Boolean)[0] ?? "";
    if (!collTitle) noBoard++;
    const board = clamp(collTitle || String(r.productType ?? "").trim() || "Personalized Gifts", 50);

    const title = clamp(r.title, TITLE_MAX);
    const src = plain(r.feedDesc) || plain(r.seo) || plain(r.body) || title;
    const desc = tail ? `${clamp(src, DESC_MAX - tail.length - 1)} ${tail}` : clamp(src, DESC_MAX);
    const keywords = String(r.tags ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10).join(", ");

    for (const src2 of imgs) out.push([title, src2, board, "", desc, link, "", keywords]);
  }

  if (!out.length) {
    return NextResponse.json({ ok: false, error: "Nothing to export — the selected products have no public image or no product URL." }, { status: 400 });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const files: { name: string; content: string }[] = [];
  for (let i = 0; i < out.length; i += perFile) {
    const part = out.slice(i, i + perFile);
    const body = part.map((c) => c.map(qq).join(",")).join("\r\n");
    files.push({
      name: `pinterest-${stamp}-${String(files.length + 1).padStart(2, "0")}.csv`,
      // BOM để Excel mở không vỡ dấu; CRLF theo chuẩn CSV.
      content: `﻿${PIN_HEAD.join(",")}\r\n${body}\r\n`,
    });
  }

  return NextResponse.json({ ok: true, files, rows: out.length, noImage, noLink, noBoard });
}
