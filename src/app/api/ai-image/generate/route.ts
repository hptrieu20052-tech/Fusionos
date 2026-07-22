import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { orGenerateImage, listModels } from "@/lib/ai/openrouter";
import { writeFile, fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/ai-image/generate — 3 chức năng Gen Image (AI Agent). Quyền: module "genImage".
 *  body {
 *    mode: "clone" | "bgremove" | "redesign",
 *    image: <dataURL | http(s) URL ảnh nguồn>,
 *    prompt?: yêu cầu thêm (redesign bắt buộc, clone/bgremove tuỳ chọn),
 *    model?, aspectRatio?, chroma?: "green" | "magenta" | "blue"  (chỉ bgremove)
 *  }
 * Tách nền = mẹo CHROMA: bảo AI đặt chủ thể lên nền MÀU PHẢN QUANG đồng đều → sharp key màu đó ra
 * → PNG trong suốt, viền sạch hơn nhiều so với yêu cầu AI tự xuất alpha.
 */
const CHROMA: Record<string, { hex: string; name: string; rgb: [number, number, number] }> = {
  green:   { hex: "#00FF00", name: "bright chroma-key green", rgb: [0, 255, 0] },
  magenta: { hex: "#FF00FF", name: "bright magenta", rgb: [255, 0, 255] },
  blue:    { hex: "#0047FF", name: "bright chroma-key blue", rgb: [0, 71, 255] },
};

function clonePrompt(extra: string) {
  return "Recreate the attached print/design image as an EXACT, clean, high-resolution copy. " +
    "Keep composition, subject(s), colours, art style, typography and layout IDENTICAL — do not add, remove, move or restyle anything. " +
    "Output a crisp, print-ready reproduction." + (extra ? `\n\nAdditional request: ${extra}` : "");
}
function bgPrompt(chroma: { hex: string; name: string }, extra: string) {
  return `Cut out the MAIN SUBJECT of the attached image and place it on a completely FLAT, UNIFORM solid ${chroma.name} background (hex ${chroma.hex}) — one perfectly even colour edge to edge, with NO gradient, shadow, reflection or texture. ` +
    `Keep the subject EXACTLY as in the original (same colours, details, size, position) with crisp clean anti-aliased edges. Do not recolour or restyle the subject.` +
    (extra ? `\n\nAdditional request: ${extra}` : "");
}
function redesignPrompt(extra: string) {
  return `Redesign the attached print artwork according to these instructions, keeping it a clean, high-resolution, print-ready design with good legibility:\n\n${extra}\n\nKeep anything not mentioned close to the original.`;
}

/** Key màu chroma khỏi ảnh → nền trong suốt (có feather mềm viền). */
async function chromaKey(pngBuf: Buffer, rgb: [number, number, number]): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  sharp.cache(false);
  const { data, info } = await sharp(pngBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const [kr, kg, kb] = rgb;
  const HARD = 110, SOFT = 175; // < HARD: trong suốt hẳn; HARD..SOFT: mờ dần (feather)
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - kr, dg = data[i + 1] - kg, db = data[i + 2] - kb;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist <= HARD) data[i + 3] = 0;
    else if (dist < SOFT) data[i + 3] = Math.round((data[i + 3] * (dist - HARD)) / (SOFT - HARD));
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
  const isData = /^data:image\/[a-z0-9.+-]+;base64,/i.test(image);
  const isUrl = /^https?:\/\/\S+$/i.test(image);
  if (!isData && !isUrl) return NextResponse.json({ ok: false, error: "Cần ảnh nguồn (tải lên hoặc dán link http)" }, { status: 400 });
  if (mode === "redesign" && !prompt) return NextResponse.json({ ok: false, error: "Redesign cần nhập yêu cầu thiết kế lại" }, { status: 400 });

  const chroma = CHROMA[String(b?.chroma ?? "green")] ?? CHROMA.green;
  const fullPrompt = mode === "clone" ? clonePrompt(prompt) : mode === "bgremove" ? bgPrompt(chroma, prompt) : redesignPrompt(prompt);
  const aspect = b?.aspectRatio && b.aspectRatio !== "auto" ? String(b.aspectRatio) : undefined;

  // THỨ TỰ THỬ MODEL: model đã chọn TRƯỚC → tự rơi sang các model ảnh khác nếu bị TỪ CHỐI
  // (mẫu bản quyền hay bị 1 số model chặn). autoFallback mặc định BẬT.
  const autoFb = b?.autoFallback !== false;
  const order: string[] = [];
  if (b?.model) order.push(String(b.model));
  if (autoFb) {
    try { for (const m of await listModels("image")) if (!order.includes(m.id)) order.push(m.id); } catch { /* offline model list → chỉ dùng model đã chọn */ }
  }
  if (!order.length) order.push("");            // "" = dùng model mặc định trong orGenerateImage
  const tryModels = order.slice(0, autoFb ? 5 : 1);

  let img: Awaited<ReturnType<typeof orGenerateImage>> | null = null;
  let usedModel = "";
  const errs: string[] = [];
  for (const m of tryModels) {
    try {
      img = await orGenerateImage(fullPrompt, [image], { outputFormat: "png", ...(m ? { model: m } : {}), ...(aspect ? { aspectRatio: aspect } : {}) });
      usedModel = m || "default";
      break;
    } catch (e) {
      errs.push(`${m || "default"}: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    }
  }
  if (!img) {
    return NextResponse.json({ ok: false, error: "Mọi model đều không tạo được (có thể bị chặn bản quyền). Thử ảnh khác hoặc chỉnh prompt. Chi tiết: " + errs.slice(0, 3).join(" · ") }, { status: 502 });
  }

  try {
    let buf: Buffer = Buffer.from(img.b64, "base64");
    // Tách nền: key màu chroma ra → trong suốt thật
    if (mode === "bgremove") { try { buf = await chromaKey(buf, chroma.rgb); } catch { /* lỗi key → trả ảnh AI gốc */ } }
    const key = `ai-image/${mode}-${session.sub}-${Date.now()}.png`;
    await writeFile(key, buf, "image/png");
    return NextResponse.json({ ok: true, url: fileUrl(key), dataUrl: `data:image/png;base64,${buf.toString("base64")}`, cost: img.cost, usedModel, tried: tryModels.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 400) }, { status: 500 });
  }
}
