import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { hasAction } from "@/lib/actions";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Parse CSV giữ mọi ô dạng string (không suy luận số) — cần cho Order ID 18-19 chữ số của TikTok.
function parseCsvToObjects(text: string): Record<string, string>[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // bỏ BOM
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\r") { /* skip */ }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some((c) => c.trim() !== "")).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => { o[h] = r[i] ?? ""; });
    return o;
  });
}

/**
 * POST /api/orders/import-tiktok — tạo đơn TikTok Shop từ file CSV "To Ship" (Order export).
 * multipart: file + storeId + sellerId (tùy chọn)
 * KHÔNG dùng API — chỉ đọc file seller tự tải từ TikTok Seller Center.
 * Gộp nhiều dòng cùng Order ID thành 1 đơn (mỗi SKU 1 dòng).
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
  if (!file) return NextResponse.json({ ok: false, error: "thiếu file" }, { status: 400 });

  let fxRate = 1;
  if (storeId) {
    const [st] = await db.select({ s: schema.stores.sellerId, fx: schema.stores.fxRate }).from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
    if (!sellerId) sellerId = st?.s ?? null;
    const r = Number(st?.fx ?? 1);
    if (r > 0) fxRate = r;
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const isCsv = /\.csv$/i.test(file.name) || file.type.includes("csv");

  // TikTok Order ID dài 18-19 số → nếu để XLSX suy luận kiểu số sẽ mất chính xác.
  // Với CSV: tự parse thành string thuần (giữ nguyên ID). Với Excel: đọc cell dạng text.
  let rows: Record<string, unknown>[];
  if (isCsv) {
    rows = parseCsvToObjects(new TextDecoder("utf-8").decode(buf));
  } else {
    const wb = XLSX.read(buf, { type: "buffer", cellText: true, raw: false });
    rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false });
  }
  if (!rows.length) return NextResponse.json({ ok: false, error: "file trống" }, { status: 400 });

  // TikTok chèn ký tự tab/khoảng trắng ẩn cuối ID để ép Excel hiểu là text → cần cắt sạch
  const norm = (s: unknown) => String(s ?? "").replace(/[\t\r\n]+/g, " ").trim();
  const key = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
  const pick = (r: Record<string, unknown>, names: string[]) => {
    for (const name of names) {
      for (const k of Object.keys(r)) if (key(k) === name) { const v = norm(r[k]); if (v) return v; }
    }
    return "";
  };
  const money = (v: string) => { const n = Number(String(v).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; };

  // Nhận diện đúng file TikTok (có cột Order ID + Product Name)
  const hdr = Object.keys(rows[0]).map(key);
  if (!hdr.includes("orderid") || !(hdr.includes("productname") || hdr.includes("sellersku"))) {
    return NextResponse.json({ ok: false, error: "Không nhận diện được file TikTok Shop — cần cột Order ID + Product Name" }, { status: 400 });
  }

  // Map trạng thái TikTok → trạng thái nội bộ
  const mapStatus = (s: string): "new" | "shipped" | "completed" | "trash" => {
    const x = s.toLowerCase();
    if (x.includes("cancel")) return "trash";
    if (x.includes("complet") || x.includes("deliver")) return "completed";
    if (x.includes("ship") && !x.includes("to ship")) return "shipped";
    if (x.includes("transit")) return "shipped";
    return "new"; // To ship / Awaiting shipment / mặc định
  };

  type Line = { title: string; sku: string; qty: number; price: number; variant: string };
  type Grp = {
    ext: string; first: string; last: string; phone: string;
    addr1: string; addr2: string; city: string; state: string; zip: string; country: string;
    total: number; status: string; note: string; lines: Line[];
  };
  const groups = new Map<string, Grp>();

  for (const r of rows) {
    const ext = pick(r, ["orderid", "orderno"]);
    if (!ext) continue;
    let g = groups.get(ext);
    if (!g) {
      const full = pick(r, ["recipient", "buyername", "shipname"]);
      let first = full, last = "";
      if (full) { const p = full.split(/\s+/); first = p[0]; last = p.length > 1 ? p.slice(1).join(" ") : ""; }
      const phone = pick(r, ["phone", "phonenumber"]);
      const msg = pick(r, ["buyermessage"]);
      const sellerNote = pick(r, ["sellernote"]);
      const noteParts = [phone && `SĐT: ${phone}`, msg && `Msg: ${msg}`, sellerNote && `Note: ${sellerNote}`].filter(Boolean);
      g = {
        ext, first, last, phone,
        addr1: pick(r, ["addressline1", "address1"]),
        addr2: pick(r, ["addressline2", "address2"]),
        city: pick(r, ["city"]),
        state: pick(r, ["state", "stateprovince"]),
        zip: pick(r, ["zipcode", "zip"]),
        country: pick(r, ["country"]) || "United States",
        total: money(pick(r, ["orderamount", "grandtotal"])),
        status: pick(r, ["orderstatus"]),
        note: noteParts.join(" · "),
        lines: [],
      };
      groups.set(ext, g);
    }
    const title = pick(r, ["productname", "itemname", "title"]);
    if (title) {
      const qty = Number(pick(r, ["quantity", "qty"]) || 1) || 1;
      // Giá 1 sp = subtotal sau giảm / qty (fallback: giá gốc)
      const sub = money(pick(r, ["skusubtotalafterdiscount", "skusubtotalbeforediscount"]));
      const unit = qty > 0 && sub > 0 ? sub / qty : money(pick(r, ["skuunitoriginalprice"]));
      g.lines.push({
        title,
        sku: pick(r, ["sellersku", "skuid"]),
        qty,
        price: unit,
        variant: pick(r, ["variation"]),
      });
    }
  }

  if (!groups.size) return NextResponse.json({ ok: false, error: "Không có đơn hợp lệ trong file" }, { status: 400 });

  let created = 0, skipped = 0;
  const errors: string[] = [];

  for (const g of Array.from(groups.values())) {
    const [dup] = await db.select({ id: schema.orders.id }).from(schema.orders)
      .where(and(eq(schema.orders.platform, "tiktok" as never), eq(schema.orders.externalId, g.ext))).limit(1);
    if (dup) { skipped++; continue; }
    try {
      const subtotal = g.lines.reduce((s, l) => s + l.price * l.qty, 0);
      const total = g.total || subtotal;
      const st = mapStatus(g.status);
      const [order] = await db.insert(schema.orders).values({
        externalId: g.ext, platform: "tiktok" as never,
        storeId, sellerId, source: "excel", status: st,
        platformStatus: g.status || null,
        buyerFirst: g.first || null, buyerLast: g.last || null,
        addr1: g.addr1 || null, addr2: g.addr2 || null, city: g.city || null,
        state: g.state || null, zip: g.zip || null, country: g.country,
        total: (total / fxRate).toFixed(2), platformFee: "0.00",
        note: g.note || null,
        orderedAt: new Date(),
      }).returning();
      const lines = g.lines.length ? g.lines : [{ title: `Đơn TikTok ${g.ext}`, sku: "", qty: 1, price: total, variant: "" }];
      for (const l of lines) {
        await db.insert(schema.orderItems).values({
          orderId: order.id, productTitle: l.title, internalSku: l.sku || null,
          qty: l.qty, unitPrice: (l.price / fxRate).toFixed(2),
          variant: l.variant || null,
        });
      }
      created++;
    } catch (e) {
      errors.push(`Đơn ${g.ext}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    }
  }

  return NextResponse.json({ ok: true, orders: groups.size, created, skipped, errors: errors.slice(0, 30) });
}
