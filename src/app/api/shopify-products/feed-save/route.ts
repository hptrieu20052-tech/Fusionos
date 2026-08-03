import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { storeOwnerScopeIds } from "@/lib/scope";

export const dynamic = "force-dynamic";

/**
 * POST /api/shopify-products/feed-save { id, feedTitle, feedDescription }
 *
 * Sửa TAY 2 field feed sau khi AI viết. Cố tình KHÔNG dùng PATCH /api/shopify-products:
 * route đó luôn set dirty = true và màn Edit bấm Save là Push thẳng lên Shopify — trong khi
 * feed_title/feed_description KHÔNG BAO GIỜ lên Shopify, chúng chỉ đi ra qua feed phụ của
 * Merchant Center. Đi chung đường sẽ đánh dấu sản phẩm "chưa push" và đẩy vô ích 1 lần.
 *
 * Xoá trắng cả 2 field được phép (feed-export sẽ bỏ qua dòng đó, không xuất dòng rỗng).
 */

// Feed không nhận HTML/tab/xuống dòng — dọn ngay lúc lưu để lúc Export khỏi phải xử lý lại.
const plain = (s: unknown) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const id = String(b?.id ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const [r] = await db.select({ storeSeller: schema.stores.sellerId })
    .from(schema.shopifyProducts).leftJoin(schema.stores, eq(schema.stores.id, schema.shopifyProducts.storeId))
    .where(eq(schema.shopifyProducts.id, id)).limit(1);
  if (!r) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const scopeIds = await storeOwnerScopeIds(session);
  if (scopeIds && (!r.storeSeller || !scopeIds.includes(r.storeSeller))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const ft = plain(b?.feedTitle).slice(0, 150);
  const fd = plain(b?.feedDescription).slice(0, 5000);

  // Cảnh báo chứ không chặn: đây là sửa tay, người sửa tự chịu trách nhiệm. Nhưng phải nói rõ
  // dòng nào sẽ bị Export bỏ qua, không thì tưởng đã lưu xong mà feed vẫn thiếu sản phẩm đó.
  let warn = "";
  if (!ft || !fd) warn = "one field is empty — Export supplemental feed will skip this product";
  else if (fd.length < 600) warn = `description is only ${fd.length} chars (600+ recommended)`;

  await db.update(schema.shopifyProducts)
    .set({ feedTitle: ft || null, feedDescription: fd || null, feedAt: ft || fd ? new Date() : null, updatedAt: new Date() })
    .where(eq(schema.shopifyProducts.id, id));

  return NextResponse.json({ ok: true, titleChars: ft.length, descChars: fd.length, ...(warn ? { warn } : {}) });
}
