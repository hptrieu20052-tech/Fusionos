/**
 * v179 · POLICY AUDIT — kiểu dữ liệu dùng chung cho AI policy check (route policy-ai).
 *
 * Tầng blacklist chữ (v177) đã BỎ theo yêu cầu: AI phân tích TOÀN BỘ listing (title, description,
 * tags, SEO title, SEO meta, Google feed copy, artwork) rồi trả cảnh báo + CÁCH SỬA cụ thể.
 * Kết quả lưu ở shopify_products.policy_risk / policy_hits; HIGH bị chặn ở nút Push cho tới khi
 * sửa xong và chạy lại AI policy check ra sạch.
 */

export type PolicyHit = {
  term: string;                 // vấn đề phát hiện được (ngắn gọn)
  field: "title" | "description" | "tags" | "seo_title" | "seo_description" | "feed_title" | "feed_description" | "image" | "other";
  severity: "high" | "medium";
  fix?: string;                 // AI đề xuất sửa thế nào
  src?: "ai";
};

// Tóm tắt hit thành chuỗi ngắn cho UI / thông báo chặn Push.
export function hitsSummary(hits: PolicyHit[], max = 4): string {
  return hits.slice(0, max).map((h) => `${h.term} (${h.field})`).join("; ") + (hits.length > max ? ` +${hits.length - max} more` : "");
}
