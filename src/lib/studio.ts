/**
 * STUDIO "Create Your Own" (v484) — helpers dùng chung cho các route /api/studio/*.
 *
 * Kiến trúc: wizard chạy trên talewix.com (page Shopify, JS thuần) gọi các route PUBLIC
 * bên FUSION (CORS mở đúng cho origin cấu hình). Model gen ảnh do ADMIN chọn trong
 * Settings (bảng studio_settings) — không hardcode, đổi model không cần deploy.
 */
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export type StudioSettings = {
  enabled: boolean;
  model: string;              // slug OpenRouter hoặc fal-ai/... (Seedream)
  aspectRatio: string;        // "1:1" | "4:5" | "3:4" | "2:3" | "16:9" | "9:16"
  dailyLimitIp: number;       // số lượt gen tối đa / IP / 24h
  dailyLimitGlobal: number;   // trần toàn hệ / 24h (chặn cháy ví)
  watermark: string;          // chữ đóng lên preview ("" = không đóng)
  origins: string[];          // origin được phép gọi API public
  prompt: string;             // prompt chung (placeholder {name}); promptExtra của template nối vào sau
};

export const STUDIO_DEFAULT_PROMPT = `You are given TWO reference images.
IMAGE 1 is the original cover artwork of a personalized children's book. Treat it as the EXACT base template: keep its composition, art style, colours, background, decorative elements and title lettering style.
IMAGE 2 is a photo of a real child.
Redraw the cover so the MAIN CHARACTER has this child's face — clearly recognizable (same face shape, hair colour, hairstyle, skin tone), but REDRAWN in the SAME art style, colours and lighting as the template. It must look painted into the artwork, never like a pasted photo.
Replace the personalized name in the title with "{name}", matching the original font style, size, colour and placement exactly. All words correctly spelled.
Keep everything else identical to the template. Output the flat cover artwork only, full-bleed — no book mockup, no hands, no watermark, no extra text.`;

// v492 · Prompt gen BÌA SAU (template bật genBack): giữ nguyên art, thay mặt nhân vật nếu có, KHÔNG thêm chữ.
export const STUDIO_BACK_PROMPT = `You are given TWO reference images.
IMAGE 1 is the original BACK cover artwork of a personalized children's book. Treat it as the EXACT base template: keep its composition, art style, colours, background and every decorative element.
IMAGE 2 is a photo of a real child.
If the main character appears in this back cover, redraw them with this child's face — clearly recognizable, in the SAME art style and lighting (painted into the artwork, never a pasted photo). If no character appears, reproduce the artwork faithfully.
Do NOT add any names, text or elements that are not already in the template. All existing text must stay identical and correctly spelled.
Output the flat back-cover artwork only, full-bleed — no book mockup, no hands, no watermark.`;

export function defaultStudioSettings(): StudioSettings {
  return {
    enabled: false,
    model: "google/gemini-2.5-flash-image",
    aspectRatio: "1:1",
    dailyLimitIp: 5,
    dailyLimitGlobal: 300,
    watermark: "PREVIEW · TALEWIX",
    origins: ["https://talewix.com", "https://www.talewix.com"],
    prompt: STUDIO_DEFAULT_PROMPT,
  };
}

/** Đọc settings (merge với default để field mới thêm sau này không undefined). */
export async function getStudioSettings(): Promise<StudioSettings> {
  const d = defaultStudioSettings();
  try {
    const [row] = await db.select().from(schema.studioSettings).where(eq(schema.studioSettings.id, "default")).limit(1);
    const v = (row?.value ?? {}) as Partial<StudioSettings>;
    return {
      enabled: typeof v.enabled === "boolean" ? v.enabled : d.enabled,
      model: typeof v.model === "string" && v.model.trim() ? v.model.trim() : d.model,
      aspectRatio: typeof v.aspectRatio === "string" && v.aspectRatio ? v.aspectRatio : d.aspectRatio,
      dailyLimitIp: Number(v.dailyLimitIp) > 0 ? Number(v.dailyLimitIp) : d.dailyLimitIp,
      dailyLimitGlobal: Number(v.dailyLimitGlobal) > 0 ? Number(v.dailyLimitGlobal) : d.dailyLimitGlobal,
      watermark: typeof v.watermark === "string" ? v.watermark : d.watermark,
      origins: Array.isArray(v.origins) && v.origins.length ? v.origins.map(String) : d.origins,
      prompt: typeof v.prompt === "string" && v.prompt.trim() ? v.prompt : d.prompt,
    };
  } catch { return d; } // bảng chưa migrate → default (enabled=false, an toàn)
}

export async function saveStudioSettings(patch: Partial<StudioSettings>): Promise<StudioSettings> {
  const cur = await getStudioSettings();
  const next: StudioSettings = { ...cur, ...patch };
  await db.insert(schema.studioSettings)
    .values({ id: "default", value: next, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.studioSettings.id, set: { value: next, updatedAt: new Date() } });
  return next;
}

// ── CORS cho route public (wizard chạy trên talewix.com gọi sang os.fusiondn.com) ──────────────
export function corsHeaders(req: NextRequest, origins: string[]): Record<string, string> {
  const origin = String(req.headers.get("origin") ?? "");
  const ok = origins.some((o) => o.replace(/\/$/, "").toLowerCase() === origin.replace(/\/$/, "").toLowerCase());
  return {
    "Access-Control-Allow-Origin": ok ? origin : origins[0] ?? "",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
export function corsJson(req: NextRequest, origins: string[], body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders(req, origins) });
}
export function clientIp(req: NextRequest): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/** Đóng watermark chéo mờ lên preview (chống dùng chùa ảnh gen). text rỗng → giữ nguyên. */
export async function watermarkImage(buf: Buffer, text: string): Promise<Buffer> {
  if (!text.trim()) return buf;
  try {
    const sharp = (await import("sharp")).default;
    sharp.cache(false);
    const meta = await sharp(buf).metadata();
    const w = meta.width ?? 1024, h = meta.height ?? 1024;
    const fs = Math.round(Math.max(w, h) / 18);
    const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const svg = Buffer.from(
      `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
        <text x="50%" y="52%" text-anchor="middle" transform="rotate(-24 ${w / 2} ${h / 2})"
          font-family="Arial, sans-serif" font-weight="bold" font-size="${fs}"
          fill="#ffffff" fill-opacity="0.32" stroke="#000000" stroke-opacity="0.12" stroke-width="2">${esc}</text>
      </svg>`,
    );
    return await sharp(buf).composite([{ input: svg }]).png().toBuffer();
  } catch { return buf; } // watermark lỗi → trả ảnh gốc, không chặn flow
}
