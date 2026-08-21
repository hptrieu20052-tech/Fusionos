import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

/**
 * Amazon Templates — mỗi LOẠI sản phẩm 1 template customization Amazon (v286).
 *
 * GET    → danh sách template (id, name, productType, số field, suffixes)
 * POST   { name, productType?, xlsxBase64 } → parse master .xlsx (file generate từ Seller Central)
 *          bằng SheetJS: giữ nguyên 3 dòng header (dòng 1 chứa ID template Amazon) + dòng giá trị mẫu.
 * PATCH  { id, name?, productType?, skuSuffixes? } → sửa meta, không đụng cấu trúc file
 * DELETE ?id= → xoá template
 */

type Cfg = { headerRows: string[][]; defaults: string[]; skuCol: number; previewImageCol: number; skuSuffixes: string[]; sheetName: string };

function summarize(cfg: Cfg) {
  // Đếm field từ dòng header 2 (r2): mỗi cụm "label" mở 1 field (trừ cột SKU/surface đầu).
  const labels = (cfg.headerRows?.[1] ?? []).filter((c) => c === "label").length;
  return { fields: labels, cols: (cfg.headerRows?.[0] ?? []).length, skuSuffixes: cfg.skuSuffixes ?? [] };
}

export async function GET() {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const rows = await db.select().from(schema.amazonTemplates);
  return NextResponse.json({
    ok: true,
    templates: rows.map((r) => ({ id: r.id, name: r.name, productType: r.productType, ...summarize(r.config as Cfg), updatedAt: r.updatedAt })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const name = String(b?.name ?? "").trim().slice(0, 120);
  if (!name) return NextResponse.json({ ok: false, error: "name required" }, { status: 400 });
  const productType = String(b?.productType ?? "").trim().slice(0, 120) || null;
  const b64 = String(b?.xlsxBase64 ?? "");
  if (!b64) return NextResponse.json({ ok: false, error: "xlsxBase64 required" }, { status: 400 });

  let cfg: Cfg;
  try {
    const wb = XLSX.read(Buffer.from(b64, "base64"), { type: "buffer" });
    const sheetName = wb.SheetNames.includes("Template") ? "Template" : wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" }) as string[][];
    if (aoa.length < 4) throw new Error("file phải có 3 dòng header + ít nhất 1 dòng giá trị mẫu");
    const width = Math.max(...aoa.slice(0, 4).map((r) => r.length));
    const pad = (r: string[]) => { const o = r.map((v) => String(v ?? "")); while (o.length < width) o.push(""); return o.slice(0, width); };
    const headerRows = [pad(aoa[0]), pad(aoa[1]), pad(aoa[2])];
    const defaults = pad(aoa[3]);
    const skuCol = Math.max(0, headerRows[1].indexOf("Seller Sku"));
    const previewImageCol = headerRows[1].indexOf("baseImage.imageUrl");
    cfg = { headerRows, defaults, skuCol, previewImageCol, skuSuffixes: ["8X8-AMZ", "11X-AMZ"], sheetName: "Template" };
  } catch (e) {
    return NextResponse.json({ ok: false, error: "Parse .xlsx thất bại: " + String((e as Error)?.message ?? e) }, { status: 400 });
  }

  const [row] = await db.insert(schema.amazonTemplates).values({ name, productType, config: cfg }).returning({ id: schema.amazonTemplates.id });
  return NextResponse.json({ ok: true, id: row.id, ...summarize(cfg) });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const b = await req.json().catch(() => null);
  const id = String(b?.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const [row] = await db.select().from(schema.amazonTemplates).where(eq(schema.amazonTemplates.id, id)).limit(1);
  if (!row) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const set: Partial<{ name: string; productType: string | null; config: Cfg; updatedAt: Date }> = { updatedAt: new Date() };
  if (typeof b?.name === "string" && b.name.trim()) set.name = b.name.trim().slice(0, 120);
  if (typeof b?.productType === "string") set.productType = b.productType.trim().slice(0, 120) || null;
  if (Array.isArray(b?.skuSuffixes)) {
    const sfx = b.skuSuffixes.map((x: unknown) => String(x ?? "").trim()).filter(Boolean).slice(0, 10);
    if (sfx.length) set.config = { ...(row.config as Cfg), skuSuffixes: sfx };
  }
  await db.update(schema.amazonTemplates).set(set).where(eq(schema.amazonTemplates.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  await db.delete(schema.amazonTemplates).where(eq(schema.amazonTemplates.id, id));
  return NextResponse.json({ ok: true });
}
