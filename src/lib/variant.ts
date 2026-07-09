// Tách color/size từ trường variant tự do (vd "Navy / L", "L - Black", "Đen, XL").
// Dùng chung cho order-detail (seed) và endpoint tìm variant động.
const SIZE_RE = /^(one size|os|free|xxs|xs|s|m|l|xl|xxl|2xl|3xl|4xl|5xl|\d{1,2}xl|\d{2,3})$/i;

export function parseVariant(variant: string | null, productType: string | null) {
  const style = (productType || "").trim() || "—";
  if (!variant) return { style, color: "—", size: "—" };
  const parts = variant.split(/[\/,|·–—-]| x /i).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { style, color: "—", size: "—" };
  // Size = phần khớp regex; nếu không có → phần CUỐI. Phần còn lại = color (không nhân đôi giá trị).
  let sizeIdx = parts.findIndex((p) => SIZE_RE.test(p));
  if (sizeIdx === -1) sizeIdx = parts.length - 1;
  const size = parts[sizeIdx] || "—";
  const color = parts.filter((_, i) => i !== sizeIdx).join(" ") || "—";
  return { style, color, size };
}
