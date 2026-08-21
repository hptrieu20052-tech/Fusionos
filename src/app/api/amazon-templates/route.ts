import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

/**
 * Amazon Templates — mỗi LOẠI sản phẩm 1 "bản khai" Amazon đầy đủ (v286, mở rộng v288).
 *
 * config gồm 3 phần:
 *   1. CUSTOMIZATION (từ master .xlsx Seller Central): headerRows (3 dòng, GIỮ NGUYÊN cột) +
 *      defaults (giá trị từng cột — v288: SỬA ĐƯỢC label/instructions/required qua UI).
 *   2. VARIATIONS + GIÁ (v288): [{ suffix:"8X8-AMZ", label:"8\"x8\"", price:"28.95" }] —
 *      nguồn sinh child SKU cho cả file customization lẫn flat file listing sau này.
 *   3. LISTING CONSTANTS (v288): brand/manufacturer/itemTypeKeyword/amazonProductType/color... —
 *      hằng số điền vào flat file listing.
 *
 * GET            → danh sách (kèm variations + constants)
 * GET ?id=       → chi tiết để EDIT: defaults + nhãn cột (row3) + key cột (row2)
 * POST   { name, productType?, xlsxBase64 } → tạo từ master .xlsx
 * PATCH  { id, name?, productType?, skuSuffixes?, variations?, constants?, defaults? }
 * DELETE ?id=    → xoá template
 */

type Variation = { suffix: string; label: string; price: string };
type Cfg = {
  headerRows: string[][]; defaults: string[]; skuCol: number; previewImageCol: number;
  skuSuffixes: string[]; sheetName: string;
  variations?: Variation[]; constants?: Record<string, string>;
};

// Hằng số listing mặc định khi tạo template mới (sửa được trong UI).
const DEFAULT_CONSTANTS: Record<string, string> = {
  brand: "Talewix", manufacturer: "Talewix",
  amazonProductType: "DISPLAY_ALBUM", itemTypeKeyword: "baby-memory-books",
  color: "Multicolor", colorMap: "Multicolor", numberOfItems: "1",
};
const DEFAULT_VARIATIONS: Variation[] = [
  { suffix: "8X8-AMZ", label: '8"x8"', price: "28.95" },
  { suffix: "11X-AMZ", label: '11"x8.5"', price: "29.95" },
];

function summarize(cfg: Cfg) {
  // Đếm field từ dòng header 2 (r2): mỗi cụm "label" mở 1 field (trừ cột SKU/surface đầu).
  const labels = (cfg.headerRows?.[1] ?? []).filter((c) => c === "label").length;
  return { fields: labels, cols: (cfg.headerRows?.[0] ?? []).length, skuSuffixes: cfg.skuSuffixes ?? [] };
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 1) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    // Chi tiết để EDIT: từng cột default kèm nhãn người đọc (row3) + key máy (row2).
    const [r] = await db.select().from(schema.amazonTemplates).where(eq(schema.amazonTemplates.id, id)).limit(1);
    if (!r) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    const cfg = r.config as Cfg;
    // h1 = dòng header 1 (tên component: "Surface 1:", "Option Dropdown 2:", "Data (Text...) 1:",
    // "Image 1:", "option:", "TextInputComponent:"...) — client dùng để GOM CỘT THEO FIELD.
    const cols = (cfg.headerRows?.[2] ?? []).map((label3, i) => ({
      i, key: cfg.headerRows?.[1]?.[i] ?? "", label: label3,
      h1: cfg.headerRows?.[0]?.[i] ?? "", value: cfg.defaults?.[i] ?? "",
    }));
    return NextResponse.json({
      ok: true,
      template: {
        id: r.id, name: r.name, productType: r.productType,
        variations: cfg.variations ?? DEFAULT_VARIATIONS,
        constants: cfg.constants ?? DEFAULT_CONSTANTS,
        cols, skuCol: cfg.skuCol ?? 0, previewImageCol: cfg.previewImageCol ?? -1,
      },
    });
  }

  const rows = await db.select().from(schema.amazonTemplates);
  return NextResponse.json({
    ok: true,
    templates: rows.map((r) => {
      const cfg = r.config as Cfg;
      const thumb = String(cfg.defaults?.[cfg.previewImageCol ?? -1] ?? "");
      return {
        id: r.id, name: r.name, productType: r.productType, ...summarize(cfg),
        variations: cfg.variations ?? DEFAULT_VARIATIONS,
        constants: cfg.constants ?? DEFAULT_CONSTANTS,
        thumbUrl: /^https:\/\//i.test(thumb) ? thumb : null,
        updatedAt: r.updatedAt,
      };
    }),
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
    cfg = {
      headerRows, defaults, skuCol, previewImageCol,
      skuSuffixes: DEFAULT_VARIATIONS.map((v) => v.suffix), sheetName: "Template",
      variations: DEFAULT_VARIATIONS, constants: DEFAULT_CONSTANTS,
    };
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

  let cfg = row.config as Cfg;
  let cfgTouched = false;
  // v288 · Variations + giá — nguồn sinh child SKU. skuSuffixes giữ đồng bộ để chỗ khác không hỏng.
  if (Array.isArray(b?.variations)) {
    const vars: Variation[] = b.variations
      .map((v: { suffix?: unknown; label?: unknown; price?: unknown }) => ({
        suffix: String(v?.suffix ?? "").trim().toUpperCase().replace(/\s+/g, ""),
        label: String(v?.label ?? "").trim().slice(0, 40),
        price: String(v?.price ?? "").trim().replace(/[^0-9.]/g, ""),
      }))
      .filter((v: Variation) => v.suffix).slice(0, 10);
    if (vars.length) { cfg = { ...cfg, variations: vars, skuSuffixes: vars.map((v) => v.suffix) }; cfgTouched = true; }
  } else if (Array.isArray(b?.skuSuffixes)) {
    const sfx = b.skuSuffixes.map((x: unknown) => String(x ?? "").trim()).filter(Boolean).slice(0, 10);
    if (sfx.length) { cfg = { ...cfg, skuSuffixes: sfx }; cfgTouched = true; }
  }
  // v288 · Hằng số listing (brand, item type keyword, amazon product type, color...).
  if (b?.constants && typeof b.constants === "object" && !Array.isArray(b.constants)) {
    const cst: Record<string, string> = {};
    for (const [k, v] of Object.entries(b.constants as Record<string, unknown>).slice(0, 40)) {
      const key = String(k).trim().slice(0, 60); if (!key) continue;
      cst[key] = String(v ?? "").trim().slice(0, 200);
    }
    cfg = { ...cfg, constants: cst }; cfgTouched = true;
  }
  // v288 · Sửa nội dung customization (label/instructions/required...) — nhận cả mảng defaults
  // đủ độ dài. KHÔNG cho đổi số cột (Amazon cấm thêm/bớt cột).
  if (Array.isArray(b?.defaults)) {
    const width = (cfg.headerRows?.[0] ?? []).length;
    if (b.defaults.length === width) {
      cfg = { ...cfg, defaults: b.defaults.map((x: unknown) => String(x ?? "")) }; cfgTouched = true;
    } else {
      return NextResponse.json({ ok: false, error: `defaults phải đúng ${width} cột (nhận ${b.defaults.length})` }, { status: 400 });
    }
  }
  if (cfgTouched) set.config = cfg;

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
