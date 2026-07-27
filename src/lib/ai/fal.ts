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

// ============================================================================
//  VIDEO — image-to-video qua fal QUEUE (render lâu 1–4 phút → không chờ đồng bộ).
// ============================================================================

export type VideoModel = { id: string; name: string; note: string; aspect: boolean; audio: boolean; neg: boolean };
// Danh sách model image-to-video (curated). Kling 2.1 = chuyển động tốt nhất; Seedance 2.0 = cùng nhà Seedream.
// neg = model có tham số negative_prompt RIÊNG. Model không có (Seedance) → ghép vào cuối prompt: "Avoid: ...".
export const VIDEO_MODELS: VideoModel[] = [
  { id: "fal-ai/kling-video/v2.1/standard/image-to-video", name: "Kling 2.1 — best motion", note: "Chuyển động mượt, bám nhân vật tốt nhất. Tỷ lệ theo ảnh gốc.", aspect: false, audio: false, neg: true },
  { id: "fal-ai/kling-video/v2.1/pro/image-to-video", name: "Kling 2.1 Pro — highest quality", note: "Nét hơn, chuyển động sạch hơn bản standard (giá cao hơn). Tỷ lệ theo ảnh gốc.", aspect: false, audio: false, neg: true },
  { id: "bytedance/seedance-2.0/image-to-video", name: "Seedance 2.0 (ByteDance, +audio)", note: "Cùng nhà Seedream. Chọn tỷ lệ 9:16/1:1/16:9, có audio, hỗ trợ 1080p.", aspect: true, audio: true, neg: false },
  // MULTI-IMAGE: nhận nhiều ảnh tham chiếu (@Image1, @Image2… trong prompt) → video nhiều cảnh/chuyển cảnh.
  { id: "bytedance/seedance-2.0/reference-to-video", name: "Seedance 2.0 Multi-image — scenes", note: "2–4 ảnh → video nhiều cảnh. Prompt gọi ảnh bằng @Image1, @Image2…", aspect: true, audio: true, neg: false },
];
const VIDEO_IDS = new Set(VIDEO_MODELS.map((m) => m.id));
export function isVideoModel(id: string) { return VIDEO_IDS.has(id); }

// Negative prompt mặc định (giữ nét chữ/logo trên áo, tránh lỗi tay & watermark) — dùng khi user để trống.
export const DEFAULT_NEGATIVE = "blur, distortion, low quality, warped text, deformed logo, extra fingers, extra limbs, morphing face, flicker, watermark, subtitles";

// Build input theo từng model (schema khác nhau).
// LƯU Ý SCHEMA (fal, 2026-07):
//   • kling v2.1 standard i2v : duration = CHUỖI "5"|"10", có negative_prompt, cfg_scale.
//   • seedance-2.0 i2v        : duration = CHUỖI "auto"|"4".."15" (KHÔNG phải số),
//                               resolution/aspect_ratio/generate_audio; KHÔNG có negative_prompt.
function videoInput(modelId: string, o: { prompt: string; imageUrl: string; imageUrls?: string[]; duration: string; aspectRatio?: string; negativePrompt?: string; resolution?: string }): Record<string, unknown> {
  let prompt = o.prompt || "Animate this image with natural, smooth, cinematic motion. Keep the subject, colours and composition faithful to the original.";
  const neg = (o.negativePrompt ?? "").trim() || DEFAULT_NEGATIVE;
  const dur = o.duration === "10" ? "10" : "5";
  const resolution = o.resolution === "1080p" ? "1080p" : "720p";
  // MULTI-IMAGE (reference-to-video): field là image_urls (MẢNG, tối đa 9) — kiểm tra TRƯỚC vì id cũng chứa "seedance".
  if (modelId.includes("reference-to-video")) {
    const urls = (o.imageUrls ?? []).filter(Boolean).slice(0, 9);
    prompt = `${prompt}\nAvoid: ${neg}.`;
    return { prompt, image_urls: urls.length ? urls : [o.imageUrl], duration: dur, resolution, ...(o.aspectRatio && o.aspectRatio !== "auto" ? { aspect_ratio: o.aspectRatio } : {}) };
  }
  const base: Record<string, unknown> = { prompt, image_url: o.imageUrl };
  if (modelId.includes("kling")) return { ...base, duration: dur, cfg_scale: 0.5, negative_prompt: neg };
  if (modelId.includes("seedance")) {
    // Seedance không có trường negative_prompt → ghép thành câu "Avoid: ..." ở cuối prompt.
    prompt = `${prompt}\nAvoid: ${neg}.`;
    return { prompt, image_url: o.imageUrl, duration: dur, resolution, ...(o.aspectRatio && o.aspectRatio !== "auto" ? { aspect_ratio: o.aspectRatio } : {}) };
  }
  return { ...base, duration: dur };
}

// CHẶN SSRF: chỉ cho fetch URL trên *.fal.run (status/response do fal trả về).
const FAL_HOST = /(^|\.)fal\.run$/i;
function assertFalUrl(u: string): string {
  let url: URL;
  try { url = new URL(u); } catch { throw new Error("URL fal không hợp lệ"); }
  if (url.protocol !== "https:" || !FAL_HOST.test(url.hostname)) throw new Error("URL không thuộc fal.run");
  return url.toString();
}

// FILE KẾT QUẢ không nằm trên fal.run: Kling trả v3.fal.media, Seedance trả storage.googleapis.com.
// → whitelist riêng cho link media (vẫn chặn SSRF: chỉ https + đúng các host CDN của fal).
const MEDIA_HOST = /(^|\.)(fal\.run|fal\.media|fal\.ai|googleapis\.com|cloudflarestorage\.com|r2\.dev)$/i;
function assertMediaUrl(u: string): string {
  let url: URL;
  try { url = new URL(u); } catch { throw new Error("Link video trả về không hợp lệ"); }
  if (url.protocol !== "https:" || !MEDIA_HOST.test(url.hostname)) throw new Error(`Link video không thuộc CDN của fal: ${url.hostname}`);
  return url.toString();
}

/** Submit job image-to-video vào queue. Trả request_id + status_url + response_url (dùng để hỏi trạng thái). */
export async function falVideoSubmit(
  modelId: string,
  o: { prompt: string; imageUrl: string; imageUrls?: string[]; duration: string; aspectRatio?: string; negativePrompt?: string; resolution?: string },
): Promise<{ requestId: string; statusUrl: string; responseUrl: string }> {
  const key = FAL_KEY();
  if (!key) throw new Error("FAL_KEY chưa cấu hình (thêm trong Vercel → Settings → Environment Variables).");
  if (!isVideoModel(modelId)) throw new Error("Model video không hợp lệ.");
  const res = await fetch(`https://queue.fal.run/${modelId}`, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(videoInput(modelId, o)),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`fal video submit HTTP ${res.status}: ${text.slice(0, 300)}`);
  let d: { request_id?: string; status_url?: string; response_url?: string };
  try { d = JSON.parse(text); } catch { throw new Error("fal video: phản hồi submit không phải JSON"); }
  if (!d.request_id) throw new Error("fal video: không nhận được request_id");
  // Nếu fal không trả url (hiếm) → tự dựng theo app id (2 segment đầu).
  const app = modelId.split("/").slice(0, 2).join("/");
  const statusUrl = d.status_url || `https://queue.fal.run/${app}/requests/${d.request_id}/status`;
  const responseUrl = d.response_url || `https://queue.fal.run/${app}/requests/${d.request_id}`;
  return { requestId: d.request_id, statusUrl, responseUrl };
}

/** Hỏi trạng thái job. Khi COMPLETED → lấy URL video kết quả. */
export async function falVideoPoll(statusUrl: string, responseUrl: string): Promise<{ status: string; videoUrl?: string }> {
  const key = FAL_KEY();
  if (!key) throw new Error("FAL_KEY chưa cấu hình.");
  const sres = await fetch(assertFalUrl(statusUrl), { headers: { Authorization: `Key ${key}` }, signal: AbortSignal.timeout(20000) });
  const stext = await sres.text();
  if (!sres.ok) throw new Error(`fal video status HTTP ${sres.status}: ${stext.slice(0, 200)}`);
  let sd: { status?: string };
  try { sd = JSON.parse(stext); } catch { throw new Error("fal video: status không phải JSON"); }
  const status = sd.status ?? "UNKNOWN";
  // Job hỏng (FAILED/ERROR/CANCELLED) → báo lỗi NGAY thay vì để client quay vòng tới lúc timeout 7 phút.
  if (status !== "COMPLETED") {
    if (["IN_QUEUE", "IN_PROGRESS", "UNKNOWN"].includes(status)) return { status };
    throw new Error(`fal video: job ${status} — ${stext.slice(0, 200)}`);
  }
  const rres = await fetch(assertFalUrl(responseUrl), { headers: { Authorization: `Key ${key}` }, signal: AbortSignal.timeout(30000) });
  const rtext = await rres.text();
  if (!rres.ok) throw new Error(`fal video result HTTP ${rres.status}: ${rtext.slice(0, 200)}`);
  let rd: { video?: { url?: string }; videos?: { url?: string }[]; output?: { video?: { url?: string } } };
  try { rd = JSON.parse(rtext); } catch { throw new Error("fal video: result không phải JSON"); }
  const videoUrl = rd.video?.url || rd.videos?.[0]?.url || rd.output?.video?.url;
  if (!videoUrl) throw new Error(`fal video: không có video trả về — ${rtext.slice(0, 200)}`);
  // ĐÂY LÀ CHỖ TỪNG LÀM HỎNG: file kết quả nằm trên v3.fal.media / storage.googleapis.com,
  // KHÔNG phải fal.run → phải dùng assertMediaUrl, nếu dùng assertFalUrl sẽ luôn ném lỗi.
  return { status, videoUrl: assertMediaUrl(videoUrl) };
}
