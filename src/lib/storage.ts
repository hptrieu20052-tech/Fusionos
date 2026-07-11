/**
 * Storage driver: Cloudflare R2 (production) hoặc local disk (dev).
 * Có đủ biến môi trường R2_* → dùng R2 với presigned URL (file bay thẳng browser → R2,
 * không qua server — đúng kiến trúc đã thiết kế). Không có → lưu local để dev.
 */
import fs from "fs/promises";
import path from "path";

const LOCAL_DIR = path.join(process.cwd(), ".uploads");

export const useR2 = !!(
  process.env.R2_ACCOUNT_ID &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_BUCKET
);

async function r2Client() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

/** Trả về URL để browser PUT file lên thẳng (presigned với R2, endpoint nội bộ với local). */
export async function getUploadTarget(key: string, contentType: string) {
  if (useR2) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const url = await getSignedUrl(
      await r2Client(),
      new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, ContentType: contentType }),
      { expiresIn: 600 }
    );
    return { mode: "r2" as const, url, method: "PUT" as const };
  }
  return { mode: "local" as const, url: `/api/uploads/local?key=${encodeURIComponent(key)}`, method: "PUT" as const };
}

export async function writeFile(key: string, buf: Buffer, contentType: string) {
  if (useR2) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await r2Client()).send(
      new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, Body: buf, ContentType: contentType })
    );
    return;
  }
  const p = path.join(LOCAL_DIR, key);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, buf);
}

export async function readFile(key: string): Promise<Buffer> {
  if (useR2) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const res = await (await r2Client()).send(
      new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key })
    );
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  return fs.readFile(path.join(LOCAL_DIR, key));
}

/** URL hiển thị file. Production: CDN public trước R2. Dev: serve qua API. */
export function fileUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  if (/^https?:\/\//i.test(key)) return key; // mockup import bằng link ngoài — lưu nguyên URL
  const pub = process.env.R2_PUBLIC_URL || process.env.R2_PUBLIC_BASE;
  if (pub) return `${pub.replace(/\/$/, "")}/${key}`;
  return `/api/files/${key}`;
}
