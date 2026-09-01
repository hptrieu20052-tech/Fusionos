/**
 * Personalization — "Custom options" của listing (mô hình Etsy đang dùng cho seller).
 *
 * Một listing có tối đa 5 field. Mỗi field là 1 câu hỏi khách phải điền trước khi Add to cart,
 * ra tới đơn hàng dưới dạng line item property.
 *
 * Kiểu field (đúng 3 kiểu Etsy cho seller chọn):
 *   text      = Text box        — có Character limit 1..1024
 *   dropdown  = List of options — 1..30 lựa chọn, KHÔNG có instructions (Etsy cấm)
 *   upload    = Photo upload    — 1..10 file, hoặc đặt nhãn cho từng file (labeled upload)
 *
 * Cùng một mảng này được dùng ở 3 chỗ:
 *   - shopify_templates.personalization  → bộ mặc định của cả nhóm sản phẩm
 *   - shopify_products.personalization   → bộ RIÊNG của 1 listing (null = dùng của template)
 *   - metafield fusion.options trên Shopify → snippet Liquid đọc ra để render ô nhập
 */
export type PQ = {
  type: "text" | "dropdown" | "upload";
  label: string;
  instructions: string;
  required: boolean;
  maxChars: number;
  options: string[];
  maxFiles: number;
};

/**
 * Chuẩn hoá lần cuối trước khi lưu / ghi lên Shopify. Field thiếu nhãn hoặc dropdown rỗng bị loại —
 * ô không nhãn ra tới storefront là đơn về không biết khách điền gì.
 * Giới hạn giữ nguyên của Etsy: ≤5 field, ≤1 field upload, nhãn ≤45, instructions ≤120,
 * character limit 1..1024, ≤30 lựa chọn, 1..10 file.
 */
export function payloadOf(v: unknown): PQ[] {
  const src = Array.isArray(v) ? v : [];
  const out: PQ[] = [];
  let uploadUsed = false;
  for (const x of src) {
    const q = x as Partial<PQ>;
    const type: PQ["type"] = q?.type === "dropdown" ? "dropdown" : q?.type === "upload" ? "upload" : "text";
    if (type === "upload") { if (uploadUsed) continue; uploadUsed = true; }
    const label = String(q?.label ?? "").trim().slice(0, 45);
    if (!label) continue;
    const options = (Array.isArray(q?.options) ? q!.options! : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 30);
    if (type === "dropdown" && !options.length) continue;
    out.push({
      type, label,
      instructions: type === "dropdown" ? "" : String(q?.instructions ?? "").trim().slice(0, 120),
      required: !!q?.required,
      maxChars: type === "text" ? Math.min(Math.max(Math.round(Number(q?.maxChars) || 100), 1), 1024) : 0,
      options,
      maxFiles: type === "upload" ? (options.length ? options.length : Math.min(Math.max(Math.round(Number(q?.maxFiles) || 1), 1), 10)) : 0,
    });
    if (out.length >= 10) break;   // v383 · trần 10 field (đích Shopify/Amazon); Etsy thật vốn chỉ nhận ≤5.
  }
  return out;
}
