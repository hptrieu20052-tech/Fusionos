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

/**
 * CHẶN CỨNG mã 100470 ("một từ xuất hiện quá 2 lần trong Title"). Rule mềm trong prompt AI không đủ
 * (model vẫn nhồi keyword mạnh như "Christmas") → cắt bằng code: mỗi TỪ ≥4 ký tự chỉ giữ tối đa 2 lần,
 * từ ở lần xuất hiện thứ 3+ bị bỏ (giữ 2 lần đầu). Từ ngắn (for/and/the…) bỏ qua — Amazon không tính.
 */
export function capRepeatedWords(t: string, max = 2): string {
  const seen = new Map<string, number>();
  const kept: string[] = [];
  for (const tok of String(t ?? "").split(/\s+/)) {
    const w = (tok.match(/[A-Za-z][A-Za-z'-]*/) || [""])[0];
    if (w.length >= 4) {
      const key = w.toLowerCase();
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      if (n > max) {
        const comma = /,/.test(tok) ? "," : "";      // bỏ TỪ, chỉ giữ dấu phẩy đi kèm để không dính 2 vế
        if (comma) kept.push(comma);
        continue;
      }
    }
    kept.push(tok);
  }
  return kept.join(" ")
    .replace(/\s+,/g, ",").replace(/,(\s*,)+/g, ",").replace(/\s{2,}/g, " ").replace(/^[\s,]+|[\s,]+$/g, "").trim();
}

/** Cắt cụm cấm + giới hạn từ lặp + dọn dấu phẩy/khoảng trắng thừa. Title an toàn để đẩy lên Amazon. */
export function sanitizeTitle(t: string): string {
  let s = String(t ?? "");
  for (const p of BANNED_TITLE_PHRASES) s = s.replace(new RegExp("\\b" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi"), "");
  s = s.replace(/\s*,(\s*,)+/g, ",").replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ")
       .replace(/\s+,/g, ",").replace(/,\s*,/g, ",").replace(/^[\s,]+|[\s,]+$/g, "").trim();
  s = capRepeatedWords(s, 2); // v361 · chặn cứng 100470
  return s;
}
