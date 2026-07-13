import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { hasAction } from "@/lib/actions";
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
  if (!(await hasAction(session, "orders.import"))) return NextResponse.json({ ok: false, error: "forbidden: import" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file") as File | null;
  const storeId = (form?.get("storeId") as string) || null;
  let sellerId = (form?.get("sellerId") as string) || null;
  if (!file) return NextResponse.json({ ok: false, error: "missing file" }, { status: 400 });

  // Không chọn seller → lấy seller mặc định của store (đồng bộ với cấu hình store)
  let fxRate = 1;
  if (storeId) {
    const [st] = await db.select({ s: schema.stores.sellerId, fx: schema.stores.fxRate }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
    if (!sellerId) sellerId = st?.s ?? null;
    const r = Number(st?.fx ?? 1);
    if (r > 0) fxRate = r; // tiền shop → USD: chia cho tỉ giá
  }

  const buf = Buffer.from(await file.arrayBuffer());
  // Ép đọc UTF-8 (tránh ký tự lỗi kiểu â≣≣); CSV đọc dạng string, Excel đọc dạng buffer
  const isCsv = /\.csv$/i.test(file.name) || file.type.includes("csv");
  const wb = isCsv
    ? XLSX.read(new TextDecoder("utf-8").decode(buf), { type: "string" })
    : XLSX.read(buf, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  if (!rows.length) return NextResponse.json({ ok: false, error: "empty file" }, { status: 400 });

  const norm = (s: unknown) => String(s ?? "").trim();
  const key = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Ưu tiên theo THỨ TỰ tên truyền vào (không phải theo thứ tự cột trong file)
  const pick = (r: Record<string, unknown>, names: string[]) => {
    for (const name of names) {
      for (const k of Object.keys(r)) if (key(k) === name) { const v = norm(r[k]); if (v) return v; }
    }
    return "";
  };
  const money = (v: string) => { const n = Number(String(v).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; };

  // ===== NHẬN DIỆN FILE PAYMENTS (Gross/Fees/Net) → cập nhật phí sàn, KHÔNG tạo đơn =====
  const hdr = Object.keys(rows[0]).map(key);
  const isPayments = hdr.includes("netamount") || (hdr.includes("fees") && hdr.includes("grossamount"));
  if (isPayments) {
    let updated = 0, notFound = 0;
    const errs: string[] = [];
    for (const r of rows) {
      const ext = pick(r, ["orderid", "orderno", "receiptid"]);
      const gross = money(pick(r, ["grossamount", "postedgross", "adjustedgross"]));
      const fees = money(pick(r, ["fees", "postedfees", "adjustedfees"]));
      if (!ext || gross <= 0) continue;
      const feeRate = fees / gross; // tỉ lệ phí (không phụ thuộc tiền tệ)
      const [ord] = await db.select().from(schema.orders)
        .where(and(eq(schema.orders.platform, "etsy" as never), eq(schema.orders.externalId, ext))).limit(1);
      if (!ord) { notFound++; continue; }
      try {
        const fee = (Number(ord.total) * feeRate).toFixed(2);
        await db.update(schema.orders).set({ platformFee: fee, updatedAt: new Date() }).where(eq(schema.orders.id, ord.id));
        updated++;
      } catch (e) { errs.push(`${ext}: ${String((e as Error)?.message ?? e).slice(0, 80)}`); }
    }
    return NextResponse.json({ ok: true, mode: "payments", rows: rows.length, updated, notFound, errors: errs.slice(0, 30) });
  }

  // Gộp theo Order ID
  type Line = { title: string; sku: string; qty: number; price: number; personalization: string; variant: string; listingId: string };
  type Grp = { ext: string; first: string; last: string; addr1: string; addr2: string; city: string; state: string; zip: string; country: string; total: number; discount: number; shipping: number; tax: number; lines: Line[] };
  const groups = new Map<string, Grp>();

  for (const r of rows) {
    const ext = pick(r, ["orderid", "orderno", "receiptid"]);
    if (!ext) continue;
    let g = groups.get(ext);
    if (!g) {
      // Tên: ưu tiên First/Last, else tách Full Name / Ship Name
      const stripId = (v: string) => v.replace(/\s*\([^)]*\)\s*$/, "").trim();
      let first = stripId(pick(r, ["firstname"]));
      let last = stripId(pick(r, ["lastname"]));
      if (!first && !last) {
        const full = stripId(pick(r, ["shipname", "fullname", "buyer", "buyername"]));
        if (full) { const p = full.split(/\s+/); last = p.length > 1 ? p.slice(1).join(" ") : ""; first = p[0]; }
      }
      // Chốt lại: cắt user ID Etsy (dạng "(xxxx)") khỏi cả first & last nếu còn sót
      first = stripId(first);
      last = stripId(last);
      g = {
        ext, first, last,
        addr1: pick(r, ["shipaddress1", "street1", "shipstreet1", "address1"]),
        addr2: pick(r, ["shipaddress2", "street2", "shipstreet2", "address2"]),
        city: pick(r, ["shipcity", "city"]),
        state: pick(r, ["shipstate", "state", "shipstateprovince"]),
        zip: pick(r, ["shipzipcode", "zipcode", "zip", "shipzip"]),
        country: pick(r, ["shipcountry", "country"]) || "United States",
        // Sold Orders có "Order Total" trực tiếp; Sold Order Items thì tính từ các cột dưới
        total: money(pick(r, ["ordertotal", "adjustedordertotal", "grandtotal"])),
        discount: money(pick(r, ["discountamount"])),
        shipping: money(pick(r, ["ordershipping", "shipping"])),
        tax: money(pick(r, ["ordersalestax", "salestax"])),
        lines: [],
      };
      groups.set(ext, g);
    }
    // Dòng sản phẩm (nếu là file Order Items)
    const title = pick(r, ["itemname", "title", "listingtitle", "productname"]);
    const variations = pick(r, ["variations", "variation"]);
    if (title) {
      // Tách "Personalization:..." khỏi Variations (lấy hết phần sau Personalization: kể cả có dấu phẩy)
      let personalization = "";
      let variant = variations;
      const pIdx = variations.search(/personaliz\w*\s*:/i);
      if (pIdx >= 0) {
        const after = variations.slice(pIdx);
        const colon = after.indexOf(":");
        personalization = after.slice(colon + 1).trim();
        variant = variations.slice(0, pIdx).replace(/[,;\s]+$/, "").trim();
      }
      g.lines.push({
        title,
        sku: pick(r, ["sku"]),
        qty: Number(pick(r, ["quantity", "qty"]) || 1) || 1,
        price: money(pick(r, ["price", "itemtotal"])),
        personalization,
        variant,
        listingId: pick(r, ["listingid", "listing"]),
      });
    }
  }

  if (!groups.size) return NextResponse.json({ ok: false, error: "Could not detect the Order ID column — check that this is a valid Etsy export file" }, { status: 400 });

  let created = 0, skipped = 0;
  const errors: string[] = [];

  for (const g of Array.from(groups.values())) {
    // Chống trùng: đã có đơn etsy cùng external_id thì bỏ qua
    const [dup] = await db.select({ id: schema.orders.id }).from(schema.orders)
      .where(and(eq(schema.orders.platform, "etsy" as never), eq(schema.orders.externalId, g.ext))).limit(1);
    if (dup) { skipped++; continue; }
    try {
      const subtotal = g.lines.reduce((s: number, l: Line) => s + l.price * l.qty, 0);
      // Sold Orders: dùng Order Total trực tiếp. Sold Order Items: subtotal − giảm giá + ship + thuế.
      const total = g.total || Math.max(0, subtotal - g.discount + g.shipping + g.tax);
      const [order] = await db.insert(schema.orders).values({
        externalId: g.ext, platform: "etsy" as never,
        storeId, sellerId, source: "excel",
        buyerFirst: g.first || null, buyerLast: g.last || null,
        addr1: g.addr1 || null, addr2: g.addr2 || null, city: g.city || null,
        state: g.state || null, zip: g.zip || null, country: g.country,
        total: (total / fxRate).toFixed(2), platformFee: "0.00",
        orderedAt: new Date(),
      }).onConflictDoNothing().returning();
      if (!order) { skipped++; continue; } // request song song đã insert trước → coi như trùng
      const lines = g.lines.length ? g.lines : [{ title: `Đơn Etsy ${g.ext}`, sku: "", qty: 1, price: total, personalization: "", variant: "", listingId: "" }];
      for (const l of lines) {
        await db.insert(schema.orderItems).values({
          orderId: order.id, productTitle: l.title, internalSku: l.sku || null,
          qty: l.qty, unitPrice: (l.price / fxRate).toFixed(2),
          personalization: l.personalization || null,
          variant: l.variant || null,
          // Không auto-gán design: đơn custom cần file riêng cho từng khách,
          // gán tự động là in nhầm tên. Order Hub sẽ gợi ý để seller tự chọn.
          etsyListingId: l.listingId || null,
          productUrl: l.listingId ? `https://www.etsy.com/listing/${l.listingId}` : null,
        });
      }
      created++;
    } catch (e) {
      errors.push(`Đơn ${g.ext}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    }
  }

  return NextResponse.json({ ok: true, orders: groups.size, created, skipped, errors: errors.slice(0, 30) });
}
