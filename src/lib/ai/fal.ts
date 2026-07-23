// fal.ai — ByteDance Seedream v4 Edit (image-to-image redraw, chất lượng cao cho merch/vector).
// Key: đặt biến môi trường FAL_KEY trong Vercel (KHÔNG commit vào code).
const FAL_KEY = () => (process.env.FAL_KEY ?? "").trim();
export function hasFal() { return !!FAL_KEY(); }
export const SEEDREAM_ID = "fal-ai/bytedance/seedream/v4/edit";

/**
 * Gọi Seedream v4 Edit: vẽ lại/biến đổi ảnh theo prompt, dựa trên ảnh tham chiếu.
 * imageUrls: URL http HOẶC data URI (base64) — fal chấp nhận cả hai.
 * Trả về { b64, mediaType, cost } giống orGenerateImage để dùng chung pipeline.
 */
export async function seedreamEdit(
  prompt: string,
  imageUrls: string[],
  opts?: { imageSize?: { width: number; height: number } },
): Promise<{ b64: string; mediaType: string; cost: number }> {
  const key = FAL_KEY();
  if (!key) throw new Error("FAL_KEY chưa cấu hình (thêm trong Vercel → Settings → Environment Variables).");
  const body: Record<string, unknown> = {
    prompt,
    image_urls: imageUrls.filter(Boolean).slice(0, 10),
    num_images: 1,
    enable_safety_checker: false, // tránh bị chặn với mẫu bản quyền
  };
  if (opts?.imageSize) body.image_size = opts.imageSize;

  const res = await fetch("https://fal.run/fal-ai/bytedance/seedream/v4/edit", {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(100000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`fal Seedream HTTP ${res.status}: ${text.slice(0, 300)}`);
  let data: { images?: { url?: string }[] };
  try { data = JSON.parse(text); } catch { throw new Error("Seedream: phản hồi không phải JSON"); }
  const url = data?.images?.[0]?.url;
  if (!url) throw new Error("Seedream: không có ảnh trả về");

  let b64: string;
  if (/^data:/i.test(url)) b64 = url.split(",")[1] || "";
  else {
    const r = await fetch(url, { signal: AbortSignal.timeout(40000) });
    if (!r.ok) throw new Error("Seedream: tải ảnh kết quả lỗi");
    b64 = Buffer.from(await r.arrayBuffer()).toString("base64");
  }
  if (!b64) throw new Error("Seedream: ảnh rỗng");
  return { b64, mediaType: "image/png", cost: 0.03 };
}
