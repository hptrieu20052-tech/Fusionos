// Logo sàn TMĐT (ảnh thật). Không khớp → icon shop chung.
const MK_LOGOS: { match: (m: string) => boolean; src: string }[] = [
  { match: (m) => m.includes("tiktok"), src: "/marketplaces/tiktok.png" },
  { match: (m) => m.includes("amazon"), src: "/marketplaces/amazon.png" },
  { match: (m) => m.includes("etsy"), src: "/marketplaces/etsy.png" },
  { match: (m) => m.includes("shopify"), src: "/marketplaces/shopify.png" }, // logo gốc Shopify
];

export function MarketplaceLogo({ mk, size = 22 }: { mk: string; size?: number }) {
  const m = (mk ?? "").toLowerCase();
  const hit = MK_LOGOS.find((l) => l.match(m));
  if (hit) return <img src={hit.src} alt={mk} width={size} height={size} style={{ width: size, height: size, objectFit: "contain", display: "block", flexShrink: 0, verticalAlign: "middle" }} />;
  // Shopify: túi mua sắm xanh Shopify + chữ "S" (vẽ inline, không cần file ảnh)
  if (m.includes("shopify")) {
    return (
      <svg viewBox="0 0 48 48" width={size} height={size} style={{ width: size, height: size, display: "block", flexShrink: 0, verticalAlign: "middle" }}>
        <rect width="48" height="48" rx="11" fill="#95BF47" />
        <path d="M27.4 27.9c0 2.4-1.5 3.9-3.7 3.9-2.5 0-3.8-1.6-3.8-1.6l.7-2.3s1.3 1.2 2.5 1.2c.7 0 1.1-.6 1.1-1.1 0-1.7-2.8-1.9-2.8-4.7 0-2.4 1.7-4.7 5.1-4.7 1.4 0 2 .4 2 .4l-1 3s-.9-.4-1.8-.4c-1.5 0-1.6 1-1.6 1.2 0 1.3 3.1 1.7 3.1 4.4z" fill="#fff" />
      </svg>
    );
  }
  // Fallback: icon shop chung cho "other"
  const s = { width: size, height: size, display: "block", flexShrink: 0 } as const;
  return (
    <svg viewBox="0 0 48 48" style={s}><rect width="48" height="48" rx="11" fill="#66788E"/><path d="M14 20h20l-2 14H16z" fill="none" stroke="#fff" strokeWidth="2"/><path d="M18 20a6 6 0 0 1 12 0" fill="none" stroke="#fff" strokeWidth="2"/></svg>
  );
}
