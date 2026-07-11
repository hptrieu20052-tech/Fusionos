import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// Mã hoá đối xứng AES-256-GCM cho các giá trị nhạy cảm (OAuth token, shared secret).
// Khoá lấy từ AUTH_SECRET (băm SHA-256 → 32 byte). Giá trị mã hoá có tiền tố "enc:".
const KEY = createHash("sha256").update(process.env.AUTH_SECRET || "fusion-dev-secret").digest();
const PREFIX = "enc:";

export function encryptSecret(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!stored.startsWith(PREFIX)) return stored; // giá trị cũ chưa mã hoá → trả nguyên
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}
