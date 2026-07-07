import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { readFile, writeFile } from "@/lib/storage";

export const MAX_ATTEMPTS = 3;

export type ProcessResult =
  | { ok: true; already?: boolean; skipped?: string; thumbKey?: string; previewKey?: string }
  | { ok: false; error: string; attempts: number; giveUp: boolean };

/**
 * Sinh thumbnail 300px + preview 1200px WebP cho 1 file, an toàn cho file nặng:
 * - Xử lý TUẦN TỰ (thumb xong mới tới preview) để giảm đỉnh RAM (tránh OOM với ảnh lớn).
 * - Có đếm số lần thử + lưu lỗi; quá MAX_ATTEMPTS thì dừng, không lặp vô hạn.
 */
export async function processFile(fileId: string): Promise<ProcessResult> {
  const [f] = await db.select().from(schema.designFiles).where(eq(schema.designFiles.id, fileId)).limit(1);
  if (!f) return { ok: false, error: "not found", attempts: 0, giveUp: true };
  if (f.processingStatus === "ready") return { ok: true, already: true };
  if (f.kind === "video") {
    await db.update(schema.designFiles).set({ processingStatus: "ready" }).where(eq(schema.designFiles.id, f.id));
    return { ok: true, skipped: "video" };
  }

  await db.update(schema.designFiles).set({ processingStatus: "processing" }).where(eq(schema.designFiles.id, f.id));
  try {
    const sharp = (await import("sharp")).default;
    // Giới hạn dùng RAM của libvips để không OOM với ảnh siêu lớn
    sharp.cache(false);
    sharp.concurrency(1);

    const src = await readFile(f.storageKey);
    const meta = await sharp(src, { limitInputPixels: 1_000_000_000 }).metadata();

    const base = f.storageKey.replace(/(\.[a-zA-Z0-9]+)?$/, "");
    const thumbKey = base + ".thumb.webp";
    const previewKey = base + ".preview.webp";

    // TUẦN TỰ: giảm một nửa đỉnh bộ nhớ so với chạy song song
    const thumb = await sharp(src, { limitInputPixels: 1_000_000_000 })
      .rotate().resize(300, 300, { fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    await writeFile(thumbKey, thumb, "image/webp");

    const preview = await sharp(src, { limitInputPixels: 1_000_000_000 })
      .rotate().resize(1200, 1200, { fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    await writeFile(previewKey, preview, "image/webp");

    await db.update(schema.designFiles).set({
      thumbKey, previewKey, width: meta.width, height: meta.height,
      processingStatus: "ready", processError: null,
    }).where(eq(schema.designFiles.id, f.id));

    return { ok: true, thumbKey, previewKey };
  } catch (e) {
    const attempts = (f.processAttempts ?? 0) + 1;
    const giveUp = attempts >= MAX_ATTEMPTS;
    await db.update(schema.designFiles).set({
      processingStatus: "failed",
      processAttempts: attempts,
      processError: String((e as Error)?.message ?? e).slice(0, 500),
    }).where(eq(schema.designFiles.id, f.id));
    return { ok: false, error: String(e), attempts, giveUp };
  }
}
