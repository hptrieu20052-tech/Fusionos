import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { orGenerateImage, listModels } from "@/lib/ai/openrouter";
import { writeFile, fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/ai-image/generate — 3 chức năng Gen Image (AI Agent). Quyền: module "genImage".
 *  body { mode: "clone"|"bgremove"|"redesign", image: <dataURL|http URL>, prompt?, model?, aspectRatio?,
 *         chroma?: "green"|"magenta"|"blue", autoFallback? }
 * CẢ 3 MODE đều xuất PNG NỀN TRONG SUỐT:
 *   - Bước 1: bảo AI đặt kết quả lên NỀN MÀU PHẢN QUANG đồng đều (bước trung gian).
 *   - Bước 2: sharp TỰ DÒ màu nền thật (từ 4 góc ảnh) rồi key ra → alpha trong suốt, viền gọn.
 */
const CHROMA: Record<string, { hex: string; name: string }> = {
  green:   { hex: "#00E000", name: "bright chroma-key green" },
  magenta: { hex: "#FF00FF", name: "bright magenta" },
  blue:    { hex: "#0047FF", name: "bright chroma-key blue" },
};
const BG = (c: { hex: string; name: string }) =>
  `Place the result on a completely FLAT, UNIFORM solid ${c.name} background (hex ${c.hex}) — one perfectly even colour, edge to edge, with NO gradient, shadow, reflection or texture. The background colour must NOT appear anywhere inside the artwork itself.`;

function buildPrompt(mode: string, c: { hex: string; name: string }, extra: string) {
  const tail = extra ? `\n\nAdditional request: ${extra}` : "";
  if (mode === "clone")
    return `Extract ONLY the printed graphic design from the attached image — ignore the garment, fabric texture, wrinkles, shadows, lighting and any photographic background. Reproduce that design as a clean, sharp, flat, high-resolution artwork with IDENTICAL composition, colours, typography and layout. ${BG(c)}${tail}`;
  if (mode === "bgremove")
    return `Cut out the MAIN SUBJECT / printed design of the attached image, keeping it EXACTLY as-is (same colours, details, size, position, crisp edges). ${BG(c)}${tail}`;
  return `Redesign the printed design from the attached image according to these instructions:\n\n${extra}\n\nOutput a clean, flat, high-resolution, print-ready design. Ignore the garment / photographic background. ${BG(c)}`;
}

/** Tách nền TỰ ĐỘNG: dò màu nền thật từ viền/4 góc rồi key ra (feather mềm). */
async function autoChromaKey(pngBuf: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  sharp.cache(false);
  const { data, info } = await sharp(pngBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const at = (x: number, y: number) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]] as [number, number, number]; };
  // Mẫu màu nền: 4 góc + giữa 4 cạnh, mỗi chỗ vài pixel
  const samp: [number, number, number][] = [];
  for (let d = 1; d <= 10; d++) {
    samp.push(at(d, d), at(w - 1 - d, d), at(d, h - 1 - d), at(w - 1 - d, h - 1 - d));
    samp.push(at((w >> 1), d), at((w >> 1), h - 1 - d), at(d, (h >> 1)), at(w - 1 - d, (h >> 1)));
  }
  const med = (idx: number) => { const s = samp.map((p) => p[idx]).sort((a, b) => a - b); return s[s.length >> 1]; };
  const kr = med(0), kg = med(1), kb = med(2);
  const HARD = 62, SOFT = 135; // với màu nền dò ĐÚNG → ngưỡng nhỏ vẫn sạch
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - kr, dg = data[i + 1] - kg, db = data[i + 2] - kb;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist <= HARD) data[i + 3] = 0;
    else if (dist < SOFT) data[i + 3] = Math.round((data[i + 3] * (dist - HARD)) / (SOFT - HARD));
  }
  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  if (!(await can(session, "genImage"))) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const b = await req.json().catch(() => null);
  const mode = String(b?.mode ?? "");
  const image = String(b?.image ?? "").trim();
  const prompt = String(b?.prompt ?? "").trim();
  if (!["clone", "bgremove", "redesign"].includes(mode)) return NextResponse.json({ ok: false, error: "invalid mode" }, { status: 400 });
  if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(image) && !/^https?:\/\/\S+$/i.test(image)) return NextResponse.json({ ok: false, error: "Cần ảnh nguồn (tải lên hoặc dán link http)" }, { status: 400 });
  if (mode === "redesign" && !prompt) return NextResponse.json({ ok: false, error: "Redesign cần nhập yêu cầu thiết kế lại" }, { status: 400 });

  const chroma = CHROMA[String(b?.chroma ?? "green")] ?? CHROMA.green;
  const fullPrompt = buildPrompt(mode, chroma, prompt);
  const aspect = b?.aspectRatio && b.aspectRatio !== "auto" ? String(b.aspectRatio) : undefined;

  // Thứ tự thử model: model đã chọn → tự rơi sang model khác nếu bị TỪ CHỐI (bản quyền).
  const autoFb = b?.autoFallback !== false;
  const order: string[] = [];
  if (b?.model) order.push(String(b.model));
  if (autoFb) { try { for (const m of await listModels("image")) if (!order.includes(m.id)) order.push(m.id); } catch { /* offline */ } }
  if (!order.length) order.push("");
  const tryModels = order.slice(0, autoFb ? 5 : 1);

  let img: Awaited<ReturnType<typeof orGenerateImage>> | null = null;
  let usedModel = "";
  const errs: string[] = [];
  for (const m of tryModels) {
    try { img = await orGenerateImage(fullPrompt, [image], { outputFormat: "png", ...(m ? { model: m } : {}), ...(aspect ? { aspectRatio: aspect } : {}) }); usedModel = m || "default"; break; }
    catch (e) { errs.push(`${m || "default"}: ${String((e as Error)?.message ?? e).slice(0, 120)}`); }
  }
  if (!img) return NextResponse.json({ ok: false, error: "Mọi model đều không tạo được (có thể bị chặn bản quyền). Thử ảnh khác/đổi prompt. Chi tiết: " + errs.slice(0, 3).join(" · ") }, { status: 502 });

  try {
    let buf: Buffer = Buffer.from(img.b64, "base64");
    // CẢ 3 MODE: tách nền trung gian ra → PNG trong suốt
    try { buf = await autoChromaKey(buf); } catch { /* key lỗi → giữ ảnh AI */ }
    const key = `ai-image/${mode}-${session.sub}-${Date.now()}.png`;
    await writeFile(key, buf, "image/png");
    return NextResponse.json({ ok: true, url: fileUrl(key), dataUrl: `data:image/png;base64,${buf.toString("base64")}`, cost: img.cost, usedModel, tried: tryModels.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 500 });
  }
}
