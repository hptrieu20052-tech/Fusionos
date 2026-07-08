// Logo sàn TMĐT (ảnh thật). Không khớp → icon shop chung.
const MK_LOGOS: { match: (m: string) => boolean; src: string }[] = [
  { match: (m) => m.includes("tiktok"), src: "/marketplaces/tiktok.png" },
  { match: (m) => m.includes("amazon"), src: "/marketplaces/amazon.png" },
  { match: (m) => m.includes("etsy"), src: "/marketplaces/etsy.png" },
];

export function MarketplaceLogo({ mk, size = 22 }: { mk: string; size?: number }) {
  const m = (mk ?? "").toLowerCase();
  const hit = MK_LOGOS.find((l) => l.match(m));
  if (hit) return <img src={hit.src} alt={mk} width={size} height={size} style={{ width: size, height: size, objectFit: "contain", display: "block", flexShrink: 0, verticalAlign: "middle" }} />;
  // Fallback: icon shop chung cho "other"
  const s = { width: size, height: size, display: "block", flexShrink: 0 } as const;
  return (
    <svg viewBox="0 0 48 48" style={s}><rect width="48" height="48" rx="11" fill="#66788E"/><path d="M14 20h20l-2 14H16z" fill="none" stroke="#fff" strokeWidth="2"/><path d="M18 20a6 6 0 0 1 12 0" fill="none" stroke="#fff" strokeWidth="2"/></svg>
  );
}
