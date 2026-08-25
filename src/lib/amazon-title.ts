/**
 * Lọc cụm từ Amazon CẤM trong Title (code 100473 INVALID_ATTRIBUTE) — Amazon suppress/chặn listing
 * nếu title chứa các cụm quảng cáo/giá/hối thúc/bảo đảm/eco. Dùng chung cho ⬆ Push (API) và ↓ flat file.
 * Nguồn: chính sách Amazon Product Title 2025/2026.
 */
export const BANNED_TITLE_PHRASES = [
  // gift phrases (Amazon chặn "Gift" quảng cáo trong title)
  "baby shower gift", "shower gift", "best gift", "perfect gift", "great gift", "ideal gift", "amazing gift", "unique gift",
  // promotional / price
  "free shipping", "best seller", "bestseller", "best price", "lowest price", "on sale", "flash sale", "hot sale", "for sale",
  // urgency
  "limited time", "while supplies last", "today only", "last chance", "buy now",
  // guarantee / claims
  "money back", "money-back", "lifetime guarantee", "100% guaranteed", "100% satisfaction", "risk free", "risk-free",
  "award-winning", "award winning", "fda approved", "doctor approved", "clinically proven",
  // eco / safety
  "eco-friendly", "eco friendly", "non-toxic", "non toxic", "chemical free", "100% safe", "child-safe",
];

/** Cắt cụm cấm khỏi title + dọn dấu phẩy/khoảng trắng thừa. Trả về title an toàn để đẩy lên Amazon. */
export function sanitizeTitle(t: string): string {
  let s = String(t ?? "");
  for (const p of BANNED_TITLE_PHRASES) s = s.replace(new RegExp("\\b" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi"), "");
  s = s.replace(/\s*,(\s*,)+/g, ",").replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ")
       .replace(/\s+,/g, ",").replace(/,\s*,/g, ",").replace(/^[\s,]+|[\s,]+$/g, "").trim();
  return s;
}
