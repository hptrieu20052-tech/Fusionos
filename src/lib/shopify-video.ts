/**
 * v207 · Đẩy VIDEO lên Shopify làm product media.
 *
 * Ảnh thì chỉ cần đưa URL công khai cho Shopify tự tải (productCreateMedia + IMAGE).
 * VIDEO thì KHÔNG được: Shopify bắt đi qua "staged upload" — xin chỗ trước, POST bytes lên
 * chỗ đó, rồi mới gắn resourceUrl vào sản phẩm. Ba bước:
 *
 *   1) stagedUploadsCreate(resource: VIDEO)  → { url, parameters[], resourceUrl }
 *   2) POST multipart/form-data bytes lên url (kèm đúng parameters theo thứ tự, file ở CUỐI)
 *   3) productCreateMedia(originalSource: resourceUrl, mediaContentType: VIDEO)
 *
 * Video vẫn cần Shopify xử lý (transcode) sau bước 3 — media trả về status UPLOADED/PROCESSING,
 * vài phút sau mới READY. KHÔNG chờ ở đây (Vercel có 300s), chỉ trả mediaId để lần sau đọc lại.
 *
 * Link YouTube/Vimeo thì dùng đường EXTERNAL_VIDEO — nhẹ hơn nhiều, không tốn băng thông hàm.
 */
import { shopifyGraphQL, type ShopifyCred } from "@/lib/shopify";

const STAGED_CREATE = `mutation fusionStaged($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets { url resourceUrl parameters { name value } }
    userErrors { field message }
  }
}`;

const MEDIA_CREATE = `mutation fusionAddMedia($productId: ID!, $media: [CreateMediaInput!]!) {
  productCreateMedia(productId: $productId, media: $media) {
    media { ... on Video { id status } ... on ExternalVideo { id status } }
    mediaUserErrors { field message }
  }
}`;

const MEDIA_STATUS = `query fusionMediaStatus($id: ID!) {
  node(id: $id) {
    ... on Video { id status fileErrors { code details } }
    ... on ExternalVideo { id status }
  }
}`;

// v230 · Đưa media video lên VỊ TRÍ 2 (ngay sau ảnh chính). newPosition là index 0-based dạng chuỗi,
// nên "1" = ô thứ hai. productCreateMedia luôn append cuối; reorder xong video nổi ngay đầu gallery.
const MEDIA_REORDER = `mutation fusionReorderMedia($id: ID!, $moves: [MoveInput!]!) {
  productReorderMedia(id: $id, moves: $moves) {
    job { id }
    userErrors { field message }
  }
}`;

/** Đưa 1 media về vị trí thứ 2 (index "1"). Lỗi không chặn — video vẫn nằm cuối nếu reorder trượt. */
async function moveMediaToSecond(cred: ShopifyCred, productGid: string, mediaId: string): Promise<void> {
  try {
    await shopifyGraphQL(cred, MEDIA_REORDER, { id: productGid, moves: [{ id: mediaId, newPosition: "1" }] });
  } catch { /* reorder trượt (media đang xử lý…) — bỏ qua, không làm hỏng lần push */ }
}

type StagedTarget = { url: string; resourceUrl: string; parameters: { name: string; value: string }[] };

const errText = (errs: unknown): string => {
  const a = Array.isArray(errs) ? errs as { message?: string }[] : [];
  return a.map((e) => String(e?.message ?? "")).filter(Boolean).join("; ").slice(0, 200);
};

/** Giới hạn an toàn: bytes phải nằm gọn trong RAM của hàm serverless. */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200MB

/** YouTube / Vimeo → Shopify lưu dạng nhúng, không tốn dung lượng store. */
export function externalVideoHost(url: string): "YOUTUBE" | "VIMEO" | null {
  if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) return "YOUTUBE";
  if (/^https?:\/\/(www\.)?(vimeo\.com|player\.vimeo\.com)\//i.test(url)) return "VIMEO";
  return null;
}

/** Bước 1 — xin chỗ upload. fileSize phải là CHUỖI số byte, Shopify từ chối nếu lệch thật. */
async function createStagedTarget(
  cred: ShopifyCred, o: { filename: string; mimeType: string; fileSize: number },
): Promise<{ target?: StagedTarget; error?: string }> {
  const d = await shopifyGraphQL<{ stagedUploadsCreate?: { stagedTargets?: StagedTarget[]; userErrors?: unknown } }>(
    cred, STAGED_CREATE,
    { input: [{ resource: "VIDEO", filename: o.filename, mimeType: o.mimeType, fileSize: String(o.fileSize), httpMethod: "POST" }] },
  );
  const e = errText(d.stagedUploadsCreate?.userErrors);
  if (e) return { error: "stagedUploadsCreate: " + e };
  const t = (d.stagedUploadsCreate?.stagedTargets ?? [])[0];
  if (!t?.url || !t?.resourceUrl) return { error: "stagedUploadsCreate returned no target" };
  return { target: t };
}

/** Bước 2 — POST bytes. THỨ TỰ QUAN TRỌNG: mọi parameters trước, field "file" CUỐI CÙNG. */
async function uploadToStaged(target: StagedTarget, bytes: Uint8Array, filename: string, mimeType: string): Promise<string> {
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([bytes as unknown as BlobPart], { type: mimeType }), filename);
  const res = await fetch(target.url, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return `staged upload HTTP ${res.status} ${body.slice(0, 160)}`;
  }
  return "";
}

/** Bước 3 — gắn vào sản phẩm. */
async function attachMedia(
  cred: ShopifyCred, productGid: string, originalSource: string, mediaContentType: "VIDEO" | "EXTERNAL_VIDEO", alt?: string,
): Promise<{ mediaId?: string; error?: string }> {
  const d = await shopifyGraphQL<{ productCreateMedia?: { media?: { id?: string; status?: string }[]; mediaUserErrors?: unknown } }>(
    cred, MEDIA_CREATE,
    { productId: productGid, media: [{ originalSource, mediaContentType, ...(alt ? { alt: alt.slice(0, 512) } : {}) }] },
  );
  const e = errText(d.productCreateMedia?.mediaUserErrors);
  if (e) return { error: "productCreateMedia: " + e };
  const id = (d.productCreateMedia?.media ?? [])[0]?.id;
  if (!id) return { error: "productCreateMedia returned no media id" };
  return { mediaId: String(id) };
}

/**
 * Đẩy 1 video (đang nằm ở URL công khai — R2 của mình) lên sản phẩm Shopify.
 * Link YouTube/Vimeo được nhận diện tự động và đi đường EXTERNAL_VIDEO (không tải bytes).
 */
export async function pushVideoToShopify(
  cred: ShopifyCred,
  o: { productGid: string; videoUrl: string; filename?: string; mimeType?: string; alt?: string },
): Promise<{ ok: boolean; mediaId?: string; error?: string }> {
  const gid = String(o.productGid ?? "");
  if (!gid.startsWith("gid://")) return { ok: false, error: "product has no Shopify ID — push the product first" };
  if (!/^https:\/\//i.test(o.videoUrl)) return { ok: false, error: "video URL must be public https" };

  // Đường tắt: YouTube/Vimeo thì Shopify tự nhúng.
  if (externalVideoHost(o.videoUrl)) {
    const r = await attachMedia(cred, gid, o.videoUrl, "EXTERNAL_VIDEO", o.alt);
    if (r.error) return { ok: false, error: r.error };
    if (r.mediaId) await moveMediaToSecond(cred, gid, r.mediaId);
    return { ok: true, mediaId: r.mediaId };
  }

  // Tải bytes từ R2 về hàm rồi đẩy sang chỗ staged của Shopify.
  const res = await fetch(o.videoUrl);
  if (!res.ok) return { ok: false, error: `cannot fetch video (HTTP ${res.status}) — is the R2 bucket public?` };
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!buf.byteLength) return { ok: false, error: "video file is empty" };
  if (buf.byteLength > MAX_VIDEO_BYTES) {
    return { ok: false, error: `video is ${(buf.byteLength / 1048576).toFixed(0)}MB — over the ${MAX_VIDEO_BYTES / 1048576}MB limit. Compress it first.` };
  }

  const mimeType = o.mimeType || res.headers.get("content-type") || "video/mp4";
  const filename = (o.filename || o.videoUrl.split("/").pop() || "video.mp4").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);

  const st = await createStagedTarget(cred, { filename, mimeType, fileSize: buf.byteLength });
  if (!st.target) return { ok: false, error: st.error ?? "staged upload failed" };

  const upErr = await uploadToStaged(st.target, buf, filename, mimeType);
  if (upErr) return { ok: false, error: upErr };

  const r = await attachMedia(cred, gid, st.target.resourceUrl, "VIDEO", o.alt);
  if (r.error) return { ok: false, error: r.error };
  if (r.mediaId) await moveMediaToSecond(cred, gid, r.mediaId);
  return { ok: true, mediaId: r.mediaId };
}

/** Đọc trạng thái xử lý của media (UPLOADED → PROCESSING → READY / FAILED). */
export async function videoMediaStatus(cred: ShopifyCred, mediaId: string): Promise<{ status: string; error?: string }> {
  try {
    const d = await shopifyGraphQL<{ node?: { status?: string; fileErrors?: { code?: string; details?: string }[] } }>(
      cred, MEDIA_STATUS, { id: mediaId },
    );
    const fe = (d.node?.fileErrors ?? [])[0];
    return { status: String(d.node?.status ?? "UNKNOWN"), ...(fe ? { error: `${fe.code ?? ""} ${fe.details ?? ""}`.trim() } : {}) };
  } catch (e) {
    return { status: "UNKNOWN", error: String((e as Error)?.message ?? e).slice(0, 120) };
  }
}
