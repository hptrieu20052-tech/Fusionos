/**
 * Amazon crawler hay TIMEOUT khi tải ảnh qua img.fusiondn.com (R2 sau Cloudflare — code 20000).
 * Đổi sang R2 Public Development URL (pub-...r2.dev) để crawler tải THẲNG từ R2, bỏ qua Cloudflare.
 * Chỉ đổi domain, giữ nguyên đường dẫn (/amazon-images/...). Dùng cho cả ⬆ Push (API) và ↓ flat file.
 */
const R2_PUBLIC = "https://pub-f99fd77e3abc4522ac03019d45ee9012.r2.dev";

export function amzImageUrl(url: string): string {
  return String(url ?? "").replace(/^https?:\/\/img\.fusiondn\.com/i, R2_PUBLIC);
}
