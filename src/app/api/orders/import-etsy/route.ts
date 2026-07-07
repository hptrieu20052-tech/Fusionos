import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/orders/import-etsy — tạo đơn Etsy từ file CSV/Excel export của Etsy.
 * multipart: file + storeId + sellerId (tùy chọn)
 * KHÔNG dùng API Etsy — chỉ đọc file seller tự tải từ Shop Manager.
 * Hỗ trợ cả "Orders" và "Order Items" CSV; gộp nhiều dòng cùng Order ID thành 1 đơn.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if ((await levelOf(session, "orders")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file") as File | null;
  const storeId = (form?.get("storeId") as string) || null;
  const sellerId = (form?.get("sellerId") as string) || null;
  if (!file) return NextResponse.json({ ok: false, error: "thiếu file" }, { status: 400 });

  const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  if (!rows.length) return NextResponse.json({ ok: false, error: "file trống" }, { status: 400 });

  const norm = (s: unknown) => String(s ?? "").trim();
  const key = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
  const pick = (r: Record<string, unknown>, names: string[]) => {
    for (const k of Object.keys(r)) if (names.includes(key(k))) { const v = norm(r[k]); if (v) return v; }
    return "";
  };
  const money = (v: string) => { const n = Number(String(v).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; };

  // Gộp theo Order ID
  type Line = { title: string; sku: string; qty: number; price: number };
  type Grp = { ext: string; first: string; last: string; addr1: string; addr2: string; city: string; state: string; zip: string; country: string; total: number; lines: Line[] };
  const groups = new Map<string, Grp>();

  for (const r of rows) {
    const ext = pick(r, ["orderid", "orderno", "receiptid"]);
    if (!ext) continue;
    let g = groups.get(ext);
    if (!g) {
      // Tên: ưu tiên First/Last, else tách Full Name / Ship Name
      let first = pick(r, ["firstname"]);
      let last = pick(r, ["lastname"]);
      if (!first && !last) {
        const full = pick(r, ["fullname", "shipname", "buyer", "buyername"]);
        if (full) { const p = full.split(/\s+/); last = p.length > 1 ? p.slice(1).join(" ") : ""; first = p[0]; }
      }
      g = {
        ext, first, last,
        addr1: pick(r, ["shipaddress1", "street1", "shipstreet1", "address1"]),
        addr2: pick(r, ["shipaddress2", "street2", "shipstreet2", "address2"]),
        city: pick(r, ["shipcity", "city"]),
        state: pick(r, ["shipstate", "state", "shipstateprovince"]),
        zip: pick(r, ["shipzipcode", "zipcode", "zip", "shipzip"]),
        country: pick(r, ["shipcountry", "country"]) || "United States",
        total: money(pick(r, ["ordertotal", "ordervalue", "adjustedordertotal", "grandtotal"])),
        lines: [],
      };
      groups.set(ext, g);
    }
    // Dòng sản phẩm (nếu là file Order Items)
    const title = pick(r, ["itemname", "title", "listingtitle", "productname"]);
    const variations = pick(r, ["variations", "variation"]);
    if (title) {
      g.lines.push({
        title: variations ? `${title} — ${variations}` : title,
        sku: pick(r, ["sku"]),
        qty: Number(pick(r, ["quantity", "qty"]) || 1) || 1,
        price: money(pick(r, ["price", "itemtotal"])),
      });
    }
  }

  if (!groups.size) return NextResponse.json({ ok: false, error: "Không nhận diện được cột Order ID — kiểm tra đúng file Etsy export chưa" }, { status: 400 });

  let created = 0, skipped = 0;
  const errors: string[] = [];

  for (const g of Array.from(groups.values())) {
    // Chống trùng: đã có đơn etsy cùng external_id thì bỏ qua
    const [dup] = await db.select({ id: schema.orders.id }).from(schema.orders)
      .where(and(eq(schema.orders.platform, "etsy" as never), eq(schema.orders.externalId, g.ext))).limit(1);
    if (dup) { skipped++; continue; }
    try {
      const total = g.total || g.lines.reduce((s: number, l: Line) => s + l.price * l.qty, 0);
      const [order] = await db.insert(schema.orders).values({
        externalId: g.ext, platform: "etsy" as never,
        storeId, sellerId, source: "excel",
        buyerFirst: g.first || null, buyerLast: g.last || null,
        addr1: g.addr1 || null, addr2: g.addr2 || null, city: g.city || null,
        state: g.state || null, zip: g.zip || null, country: g.country,
        total: total.toFixed(2), platformFee: "0.00",
        orderedAt: new Date(),
      }).returning();
      const lines = g.lines.length ? g.lines : [{ title: `Đơn Etsy ${g.ext}`, sku: "", qty: 1, price: total }];
      for (const l of lines) {
        await db.insert(schema.orderItems).values({
          orderId: order.id, productTitle: l.title, internalSku: l.sku || null,
          qty: l.qty, unitPrice: l.price.toFixed(2),
        });
      }
      created++;
    } catch (e) {
      errors.push(`Đơn ${g.ext}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    }
  }

  return NextResponse.json({ ok: true, orders: groups.size, created, skipped, errors: errors.slice(0, 30) });
}
