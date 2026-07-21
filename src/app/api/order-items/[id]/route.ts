import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { sql, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { inScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

// "GIA ĐÌNH" đơn = đơn gốc + các bản Duplicate (-CLONE-n). Khi qty đổi (support tách đơn 2 supplier
// bằng cách dup rồi set qty 0), chia lại total/platform_fee theo TỶ TRỌNG GIÁ TRỊ item sống (qty>0)
// trên tổng của cả gia đình → tổng doanh thu luôn = đúng 1 lần, từng đơn mang đúng phần của nó.
async function rebalanceCloneFamily(orderId: string) {
  try {
    const [o] = (await db.execute(sql`SELECT id, external_id, platform FROM orders WHERE id = ${orderId}::uuid`)).rows as { id: string; external_id: string; platform: string }[];
    if (!o) return;
    const base = o.external_id.replace(/-CLONE-\d+$/, "");
    const fam = (await db.execute(sql`
      SELECT id, total, platform_fee FROM orders
      WHERE platform = ${o.platform}::marketplace AND (external_id = ${base} OR external_id LIKE ${base + "-CLONE-%"})
        AND status NOT IN ('cancel','trash')
      ORDER BY created_at NULLS FIRST, external_id
    `)).rows as { id: string; total: string; platform_fee: string }[];
    if (fam.length < 2) return; // không có bản clone → không đụng vào total

    const famTotal = fam.reduce((a, f) => a + Number(f.total), 0);
    const famFee = fam.reduce((a, f) => a + Number(f.platform_fee), 0);
    const vals: number[] = [];
    for (const f of fam) {
      const [v] = (await db.execute(sql`
        SELECT coalesce(sum(unit_price * qty), 0)::numeric v FROM order_items WHERE order_id = ${f.id}::uuid AND qty > 0
      `)).rows as { v: string }[];
      vals.push(Number(v?.v ?? 0));
    }
    const sumVal = vals.reduce((a, v) => a + v, 0);
    if (sumVal <= 0) return; // chưa chia item xong (mọi đơn đều 0) → giữ nguyên

    let accT = 0, accF = 0;
    for (let i = 0; i < fam.length; i++) {
      const last = i === fam.length - 1;
      const t = last ? famTotal - accT : Math.round((famTotal * vals[i] / sumVal) * 100) / 100; // đơn cuối nhận phần dư — khớp đến xu
      const fe = last ? famFee - accF : Math.round((famFee * vals[i] / sumVal) * 100) / 100;
      accT += t; accF += fe;
      if (Math.abs(t - Number(fam[i].total)) >= 0.005 || Math.abs(fe - Number(fam[i].platform_fee)) >= 0.005) {
        await db.execute(sql`UPDATE orders SET total = ${t.toFixed(2)}, platform_fee = ${fe.toFixed(2)}, updated_at = NOW() WHERE id = ${fam[i].id}::uuid`);
      }
    }
  } catch { /* best-effort — lỗi rebalance không chặn việc sửa qty */ }
}

// PATCH /api/order-items/[id] — body: { skuCode?: number|null, specialPrint?: boolean }
// skuCode = mã số tuần tự của design trong Design Studio; null = bỏ gán
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "orders")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const item = (await db.execute(sql`
    SELECT i.id, i.order_id, i.product_title, o.seller_id FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.id = ${params.id}::uuid
  `)).rows[0] as { id: string; order_id: string; product_title: string | null; seller_id: string | null } | undefined;
  if (!item) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (!(await inScope(session, "orders", item.seller_id))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });

  type D = { id: string; sku_code: number; title: string };
  let design: D | null = null;
  if ("skuCode" in b) {
    if (b.skuCode === null || b.skuCode === "") {
      await db.update(schema.orderItems).set({ designId: null }).where(eq(schema.orderItems.id, params.id));
    } else {
      const sku = Number(b.skuCode);
      if (!Number.isInteger(sku) || sku <= 0) return NextResponse.json({ ok: false, error: "Design ID must be a number" }, { status: 400 });
      design = (await db.execute(sql`SELECT id, sku_code, title FROM designs WHERE sku_code = ${sku}`)).rows[0] as unknown as D | undefined ?? null;
      if (!design) return NextResponse.json({ ok: false, error: `Không tìm thấy design #${sku}` }, { status: 404 });
      await db.update(schema.orderItems).set({ designId: design.id }).where(eq(schema.orderItems.id, params.id));
      // Dán ID design → lấy luôn title của card design = tên sản phẩm của order item này.
      const pt = (item.product_title ?? "").trim();
      if (pt && pt !== design.title) {
        await db.execute(sql`UPDATE designs SET title = ${pt} WHERE id = ${design.id}`);
        design = { ...design, title: pt };
      }
    }
  }
  if ("personalization" in b) {
    await db.update(schema.orderItems).set({ personalization: String(b.personalization ?? "").trim() || null }).where(eq(schema.orderItems.id, params.id));
  }
  if ("specialPrint" in b) {
    await db.update(schema.orderItems).set({ specialPrint: !!b.specialPrint }).where(eq(schema.orderItems.id, params.id));
  }
  // SỬA QTY (flow tách đơn 2 supplier bằng Duplicate): qty 0 = item không fulfill từ đơn này.
  // Sau khi đổi qty → TỰ CHIA LẠI total/fee giữa đơn gốc và các bản -CLONE-n theo giá trị item sống,
  // để doanh thu cả "gia đình" đơn luôn = đúng 1 lần tiền khách trả (không phồng đôi vì duplicate).
  if ("qty" in b) {
    const q = Number(b.qty);
    if (!Number.isInteger(q) || q < 0 || q > 999) return NextResponse.json({ ok: false, error: "qty must be an integer 0–999" }, { status: 400 });
    await db.update(schema.orderItems).set({ qty: q }).where(eq(schema.orderItems.id, params.id));
    await rebalanceCloneFamily(item.order_id);
  }
  if ("mockupKey" in b) {
    const key = (typeof b.mockupKey === "string" && b.mockupKey.trim()) ? b.mockupKey.trim() : null;
    await db.update(schema.orderItems).set({ mockupKey: key }).where(eq(schema.orderItems.id, params.id));
  }
  return NextResponse.json({ ok: true, design });
}
