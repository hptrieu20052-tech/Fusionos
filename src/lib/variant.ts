// Tách color/size từ trường variant tự do (vd "Navy / L", "L - Black", "Đen, XL").
// Dùng chung cho order-detail (seed) và endpoint tìm variant động.
const SIZE_RE = /^(one size|os|free|xxs|xs|s|m|l|xl|xxl|2xl|3xl|4xl|5xl|\d{1,2}xl|\d{2,3})$/i;

export function parseVariant(variant: string | null, productType: string | null) {
  const style = (productType || "").trim() || "—";
  if (!variant) return { style, color: "—", size: "—" };
  const parts = variant.split(/[\/,|·–—-]| x /i).map((p) => p.trim()).filter(Boolean);
  let size = "", color = "";
  for (const p of parts) { if (!size && SIZE_RE.test(p)) size = p; else color = color ? `${color} ${p}` : p; }
  if (!size && parts.length) size = parts[parts.length - 1];
  if (!color) color = parts.length > 1 ? parts.slice(0, -1).join(" ") : "—";
  return { style, color: color || "—", size: size || "—" };
}
