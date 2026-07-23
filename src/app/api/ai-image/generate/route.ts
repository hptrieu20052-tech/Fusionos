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
    return `Use the original image as a strict structural reference.
Recreate the design with the same layout, character positions, proportions, facial expressions, gesture direction, object placement and overall composition.

Preserve the original color palette and visual hierarchy as closely as possible.
Keep all main elements, message content and storytelling logic unchanged.

Redraw the artwork in a cleaner, sharper graphic tee illustration style with improved line quality, smoother curves, refined shapes and better spacing.

Enhance production quality by simplifying overly complex details, increasing contrast, improving silhouette readability and making the design more suitable for screen printing or POD.

Maintain the same scene density and decorative element placement but reinterpret textures, stroke behavior and micro-details to create a fresh redrawn version.

Typography (if present): keep wording and general style feeling but redraw letterforms with cleaner structure and better balance.

Finish: high-quality vector-like merch design, crisp edges, print-ready. ${BG(c)}${tail}`;
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

/**
 * LÀM NÉT — GIỮ NGUYÊN độ phân giải gốc (KHÔNG upscale, vì upscale ảnh raster chỉ làm MỜ, không thêm chi tiết).
 * Chỉ phóng to khi ảnh QUÁ NHỎ (< 900px) và tối đa 2× để còn dùng in. Unsharp mask MẠNH ở CẠNH (m2 cao),
 * nhẹ ở vùng phẳng (m1 thấp) → sắc nét mà không nhiễu. Giữ alpha (nền trong suốt).
 */
async function enhance(buf: Buffer, strong = false): Promise<Buffer> {
  const sharp = await getSharp();
  try {
    const meta = await sharp(buf).metadata();
    const w = meta.width ?? 0, h = meta.height ?? 0, longest = Math.max(w, h);
    let pipe = sharp(buf, { unlimited: true });
    // Clone (strong): bản AI vẽ lại thường ~1024px → phóng lên ~2000px cho đủ cỡ in POD.
    // Tách nền (nhẹ): giữ nguyên độ phân giải gốc, chỉ upscale nếu ảnh quá nhỏ.
    const upTo = strong ? 2000 : 1800, upIf = strong ? 2000 : 900;
    if (longest && longest < upIf) {
      const target = strong ? upTo : Math.min(longest * 2, upTo);
      pipe = pipe.resize({ ...(w >= h ? { width: target } : { height: target }), kernel: "lanczos3" });
    }
    // Clone (strong=true): LÀM NÉT MẠNH — unsharp gắt ở cạnh (m2 cao) để file nét hẳn.
    // Tách nền (strong=false): làm nét nhẹ, giữ nguyên nét gốc.
    const sh = strong ? { sigma: 1.4, m1: 0.2, m2: 3.8 } : { sigma: 0.8, m1: 0.5, m2: 1.6 };
    return pipe.sharpen(sh).png({ compressionLevel: 9 }).toBuffer();
  } catch { return buf; }
}

/** Key 1 màu khỏi ảnh (GIỮ NGUYÊN pixel gốc, feather mềm viền) → PNG trong suốt. Dùng cho nền chroma AI. */
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

/**
 * TÁCH NỀN CHUẨN cho design nền đồng đều: FLOOD-FILL từ viền ảnh.
 * Chỉ xoá vùng nền NỐI với mép ảnh → GIỮ NGUYÊN mọi pixel bên trong (viền đen, vùng tối của design
 * không bị đục thủng như khi key toàn ảnh). Feather mềm ở ranh giới cho cạnh mượt, không AI vẽ lại → nét gốc 100%.
 */
async function floodKey(buf: Buffer, [kr, kg, kb]: [number, number, number], hard = 40, soft = 78): Promise<Buffer> {
  const sharp = await getSharp();
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, n = w * h;
  const dist = (idx: number) => { const p = idx * 4; const dr = data[p] - kr, dg = data[p + 1] - kg, db = data[p + 2] - kb; return Math.sqrt(dr * dr + dg * dg + db * db); };
  const bg = new Uint8Array(n);                 // 1 = nền nối với viền
  const stack = new Int32Array(n);              // stack chỉ số pixel (cấp phát 1 lần)
  let sp = 0;
  const seed = (x: number, y: number) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const idx = y * w + x; if (bg[idx]) return; if (dist(idx) <= soft) { bg[idx] = 1; stack[sp++] = idx; } };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
  while (sp > 0) {
    const idx = stack[--sp], x = idx % w, y = (idx / w) | 0;
    seed(x + 1, y); seed(x - 1, y); seed(x, y + 1); seed(x, y - 1);
  }
  for (let idx = 0; idx < n; idx++) {
    if (!bg[idx]) continue;                     // pixel BÊN TRONG (không nối viền) → giữ nguyên
    const d = dist(idx), p = idx * 4;
    if (d <= hard) data[p + 3] = 0;
    else if (d < soft) data[p + 3] = Math.round((data[p + 3] * (d - hard)) / (soft - hard));
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
  if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(image) && !/^https?:\/\/\S+$/i.test(image)) return NextResponse.json({ ok: false, error: "Source image required (upload or paste an http link)" }, { status: 400 });
  if (mode === "redesign" && !prompt) return NextResponse.json({ ok: false, error: "Redesign requires a prompt" }, { status: 400 });

  const save = async (raw: Buffer, cost: number, usedModel: string, method: string, strong = false) => {
    const buf = await enhance(raw, strong); // LÀM NÉT (Clone = mạnh, Tách nền = nhẹ)
    const key = `ai-image/${mode}-${session.sub}-${Date.now()}.png`;
    await writeFile(key, buf, "image/png");
    return NextResponse.json({ ok: true, url: fileUrl(key), dataUrl: `data:image/png;base64,${buf.toString("base64")}`, cost, usedModel, method });
  };

  // ---- 1) TÁCH TRỰC TIẾP (flood-fill, GIỮ NGUYÊN PIXEL GỐC full-res) khi nền ĐỒNG ĐỀU ----
  //   • Tách nền: giữ nét gốc (làm nét nhẹ).
  //   • Clone (không prompt): giữ full-res gốc + LÀM NÉT MẠNH — KHÔNG cho AI vẽ lại (AI xuất ~1024px sẽ GIẢM nét).
  //   Chỉ Clone-có-prompt hoặc ảnh mockup nền phức tạp mới rơi xuống AI tái dựng.
  const wantsDirect = mode === "bgremove"; // Clone LUÔN dùng AI redraw (prompt vẽ lại vector) — không tách trực tiếp.
  if (wantsDirect) {
    try {
      const orig = await fetchOriginal(image);
      if (orig) {
        const bd = await analyzeBorder(orig);
        if (bd.uniform) {
          // Chỉ TÁCH NỀN vào đây → giữ nét gốc, làm nét nhẹ.
          const out = await floodKey(orig, bd.rgb);
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
  if (!img) return NextResponse.json({ ok: false, error: "All models failed (possibly copyright-blocked). Try another image or change the prompt. Details: " + errs.slice(0, 3).join(" · ") }, { status: 502 });

  try {
    let buf: Buffer = Buffer.from(img.b64, "base64");
    const bd = await analyzeBorder(buf).catch(() => ({ uniform: true, rgb: [255, 0, 255] as [number, number, number] }));
    try { buf = await keyColor(buf, bd.rgb, 62, 135); } catch { /* key lỗi → giữ ảnh AI */ }
    return await save(buf, img.cost, usedModel, "ai", mode === "clone");
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 500 });
  }
}
