// Etsy trả variant/personalization dưới dạng HTML đã escape ("3&quot;", "11&quot;x8.5&quot;").
// Không decode thì hiện nguyên chuỗi rác trên UI, và lọt cả vào file gửi nhà in.
// (Khác src/lib/variant.ts — file đó tách color/size để map SKU nhà in.)

const ENTITIES: Record<string, string> = {
  quot: '"', apos: "'", amp: "&", lt: "<", gt: ">", nbsp: " ",
  ldquo: "\u201C", rdquo: "\u201D", lsquo: "\u2018", rsquo: "\u2019",
  hellip: "\u2026", mdash: "\u2014", ndash: "\u2013", middot: "\u00B7",
  deg: "\u00B0", times: "\u00D7", frac12: "\u00BD", frac14: "\u00BC", frac34: "\u00BE",
};

/** Decode entity dạng tên (&quot;) lẫn dạng số (&#34; / &#x22;). Chạy được cả server lẫn client. */
export function decodeEntities(s: string | null | undefined): string {
  if (!s) return "";
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (m, g: string) => {
    if (g[0] === "#") {
      const code = g[1].toLowerCase() === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[g.toLowerCase()] ?? m;
  });
}

export type VariantPart = { label: string; value: string };

/**
 * Tách chuỗi variant thành từng dòng, hiển thị giống Etsy:
 *   Size    8" x 8"
 *   Paper   Matte
 *
 * Cẩn thận: giá trị do KHÁCH nhập (lời chúc, tên…) có thể chứa chính dấu phân cách.
 * Nên đoạn nào KHÔNG có dạng "Nhãn:" thì nối tiếp vào giá trị phía trước — không tách dòng mới.
 * Nhờ vậy "Dedication Message: Happy Birthday · Weema and G-Pa" vẫn giữ nguyên một dòng.
 */
export function splitVariant(raw: string | null | undefined): VariantPart[] {
  const s = decodeEntities(raw).trim();
  if (!s) return [];

  // Extension nối bằng " · ". Excel/TikTok cũ nối bằng ",".
  const chunks = s.includes(" \u00B7 ") ? s.split(" \u00B7 ") : s.split(",");

  const out: VariantPart[] = [];
  for (const c of chunks) {
    const t = c.trim();
    if (!t) continue;
    const m = t.match(/^([^:]{1,60}?)\s*:\s*([\s\S]+)$/);
    if (m) out.push({ label: m[1].trim(), value: m[2].trim() });
    else if (out.length) out[out.length - 1].value += " \u00B7 " + t;
    else out.push({ label: "", value: t });
  }
  return out;
}
