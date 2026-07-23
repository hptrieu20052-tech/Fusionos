import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { orGenerateImage, listModels } from "@/lib/ai/openrouter";
import { writeFile, fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/ai-image/generate — Gen Image (AI Agent). Quyền: module "genImage".
 * body { mode:"clone"|"bgremove"|"redesign", image:<dataURL|http>, prompt?, model?, aspectRatio?, autoFallback? }
 *
 * TÁCH TRỰC TIẾP (ưu tiên, GIỮ NGUYÊN NÉT — không AI vẽ lại):
 *   Clone (không prompt) & Tách nền trên ảnh có NỀN ĐỒNG ĐỀU → key màu nền thật khỏi pixel gốc.
 * AI (chroma → key): khi nền phức tạp (ảnh chụp áo…), hoặc Redesign, hoặc Clone có prompt.
 */
const CHROMA: Record<string, { hex: string; name: string }> = {
  green:   { hex: "#00E000", name: "bright chroma-key green" },
  magenta: { hex: "#FF00FF", name: "bright magenta" },
  blue:    { hex: "#0047FF", name: "bright chroma-key blue" },
};
const BG = (c: { hex: string; name: string }) =>
  `Place the result on a completely FLAT, UNIFORM solid ${c.name} background (hex ${c.hex}) — one perfectly even colour edge to edge, no gradient/shadow/texture. The background colour must NOT appear inside the artwork itself.`;
function buildPrompt(mode: string, c: { hex: string; name: string }, extra: string) {
  const tail = extra ? `\n\nAdditional request: ${extra}` : "";
  if (mode === "clone")
    return `Extract ONLY the printed graphic design from the attached image — ignore the garment, fabric texture, wrinkles, shadows, lighting and any photographic background. Reproduce it as a clean, sharp, flat, high-resolution artwork with IDENTICAL composition, colours, typography and layout. ${BG(c)}${tail}`;
  if (mode === "bgremove")
    return `Cut out the MAIN SUBJECT / printed design of the attached image, keeping it EXACTLY as-is (same colours, details, size, position, crisp edges). ${BG(c)}${tail}`;
  return `Redesign the printed design from the attached image according to these instructions:\n\n${extra}\n\nOutput a clean, flat, high-resolution, print-ready design. Ignore the garment / photographic background. ${BG(c)}`;
}

async function getSharp() { const s = (await import("sharp")).default; s.cache(false); return s; }

/** Lấy bytes ảnh gốc từ dataURL hoặc http URL. */
async function fetchOriginal(image: string): Promise<Buffer | null> {
  if (/^data:/i.test(image)) { const b64 = image.split(",")[1] || ""; return Buffer.from(b64, "base64"); }
  if (/^https?:/i.test(image)) { const r = await fetch(image, { signal: AbortSignal.timeout(20000) }); if (!r.ok) return null; return Buffer.from(await r.arrayBuffer()); }
  return null;
}

/** Dò màu nền + độ ĐỒNG ĐỀU của viền ảnh (4 góc + giữa cạnh). */
async function analyzeBorder(buf: Buffer): Promise<{ uniform: boolean; rgb: [number, number, number] }> {
  const sharp = await getSharp();
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const at = (x: number, y: number): [number, number, number] => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const samp: [number, number, number][] = [];
  for (let d = 1; d <= 12; d++) samp.push(at(d, d), at(w - 1 - d, d), at(d, h - 1 - d), at(w - 1 - d, h - 1 - d), at(w >> 1, d), at(w >> 1, h - 1 - d), at(d, h >> 1), at(w - 1 - d, h >> 1));
  const med = (idx: number) => { const s = samp.map((p) => p[idx]).sort((a, b) => a - b); return s[s.length >> 1]; };
  const kr = med(0), kg = med(1), kb = med(2);
  const avgDist = samp.reduce((a, p) => a + Math.hypot(p[0] - kr, p[1] - kg, p[2] - kb), 0) / samp.length;
  return { uniform: avgDist < 42, rgb: [kr, kg, kb] };
}

/** LÀM NÉT: upscale cạnh dài lên ~2000px (Lanczos) nếu nhỏ + unsharp mask. Giữ alpha. */
async function enhance(buf: Buffer): Promise<Buffer> {
  const sharp = await getSharp();
  try {
    const meta = await sharp(buf).metadata();
    const w = meta.width ?? 0, h = meta.height ?? 0, longest = Math.max(w, h);
    let pipe = sharp(buf);
    if (longest && longest < 2000) pipe = pipe.resize({ ...(w >= h ? { width: 2000 } : { height: 2000 }), kernel: "lanczos3" });
    return pipe.sharpen({ sigma: 1 }).png().toBuffer();
  } catch { return buf; }
}

/** Key 1 màu khỏi ảnh (GIỮ NGUYÊN pixel gốc, feather mềm viền) → PNG trong suốt. */
async function keyColor(buf: Buffer, [kr, kg, kb]: [number, number, number], hard = 55, soft = 120): Promise<Buffer> {
  const sharp = await getSharp();
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - kr, dg = data[i + 1] - kg, db = data[i + 2] - kb;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist <= hard) data[i + 3] = 0;
    else if (dist < soft) data[i + 3] = Math.round((data[i + 3] * (dist - hard)) / (soft - hard));
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
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

  const save = async (raw: Buffer, cost: number, usedModel: string, method: string) => {
    const buf = await enhance(raw); // LÀM NÉT mọi kết quả (upscale + unsharp)
    const key = `ai-image/${mode}-${session.sub}-${Date.now()}.png`;
    await writeFile(key, buf, "image/png");
    return NextResponse.json({ ok: true, url: fileUrl(key), dataUrl: `data:image/png;base64,${buf.toString("base64")}`, cost, usedModel, method });
  };

  // ---- 1) TÁCH TRỰC TIẾP trên ảnh gốc (giữ nguyên nét) khi nền đồng đều ----
  // Clone bật "AI vẽ lại" (redraw) → bỏ qua tách trực tiếp, cho AI vẽ lại toàn bộ.
  const redraw = b?.redraw === true;
  const wantsDirect = mode === "bgremove" || (mode === "clone" && !prompt && !redraw);
  if (wantsDirect) {
    try {
      const orig = await fetchOriginal(image);
      if (orig) {
        const bd = await analyzeBorder(orig);
        if (bd.uniform) {
          const out = await keyColor(orig, bd.rgb);
          return await save(out, 0, "direct-cut (no AI)", "direct");
        }
      }
    } catch { /* lỗi phân tích → rơi sang AI */ }
  }

  // ---- 2) AI (nền phức tạp / redesign / clone có prompt): chroma → key ----
  const chroma = CHROMA[String(b?.chroma ?? "magenta")] ?? CHROMA.magenta; // màu nền trung gian CHẠY ẨN
  const fullPrompt = buildPrompt(mode, chroma, prompt);
  const aspect = b?.aspectRatio && b.aspectRatio !== "auto" ? String(b.aspectRatio) : undefined;

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
    const bd = await analyzeBorder(buf).catch(() => ({ uniform: true, rgb: [255, 0, 255] as [number, number, number] }));
    try { buf = await keyColor(buf, bd.rgb, 62, 135); } catch { /* key lỗi → giữ ảnh AI */ }
    return await save(buf, img.cost, usedModel, "ai");
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 500 });
  }
}
