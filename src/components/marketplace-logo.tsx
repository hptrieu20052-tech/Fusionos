// SVG logo đơn giản cho từng sàn (đơn sắc theo brand màu sàn)
export function MarketplaceLogo({ mk, size = 22 }: { mk: string; size?: number }) {
  const s = { width: size, height: size, display: "block" } as const;
  if (mk === "tiktok") return (
    <svg viewBox="0 0 48 48" style={s}><rect width="48" height="48" rx="11" fill="#010101"/><path d="M33 15.5c-2.3-.3-4-1.6-4.9-3.5h-3.6v18.3c0 2.1-1.7 3.8-3.8 3.8s-3.8-1.7-3.8-3.8 1.7-3.8 3.8-3.8c.4 0 .8.1 1.1.2v-3.7c-.4 0-.7-.1-1.1-.1-4.1 0-7.5 3.4-7.5 7.5s3.4 7.5 7.5 7.5 7.5-3.4 7.5-7.5v-9.1c1.4 1 3.2 1.6 5 1.6v-3.7c-.2 0-.5 0-.7-.1z" fill="#25F4EE"/><path d="M34 16.2c-2.3-.3-4-1.6-4.9-3.5h-2.6v18.3c0 2.1-1.7 3.8-3.8 3.8-.6 0-1.2-.1-1.7-.4.6 1.3 2 2.3 3.6 2.3 2.1 0 3.8-1.7 3.8-3.8v-9.1c1.4 1 3.2 1.6 5 1.6v-3.7c-.5 0-.9-.1-1.4-.2z" fill="#FE2C55"/><path d="M33.3 15.8c-2.3-.3-4-1.6-4.9-3.5h-1.9v18.3c0 2.1-1.7 3.8-3.8 3.8-1.2 0-2.3-.6-3-1.5-1.2-.7-2-2-2-3.5 0-2.3 1.9-4.2 4.2-4.2.4 0 .8.1 1.1.2v-3.7c-.4-.1-.7-.1-1.1-.1-4.1 0-7.5 3.4-7.5 7.5 0 2.5 1.2 4.7 3.1 6-1.3-1.4-2.1-3.2-2.1-5.3 0-4.1 3.4-7.5 7.5-7.5.4 0 .7 0 1.1.1v3.7c-.3-.1-.7-.2-1.1-.2-2.3 0-4.2 1.9-4.2 4.2 0 1.5.8 2.8 2 3.5-.7-.7-1.1-1.6-1.1-2.7 0-2.1 1.7-3.8 3.8-3.8s3.8 1.7 3.8 3.8V12.3h3.6c.9 1.9 2.6 3.2 4.9 3.5z" fill="#fff" opacity=".9"/></svg>
  );
  if (mk === "amazon") return (
    <svg viewBox="0 0 48 48" style={s}><rect width="48" height="48" rx="11" fill="#232F3E"/><path d="M30.5 30.8c-3.8 2.8-9.3 4.3-14 4.3-6.6 0-12.6-2.4-17.1-6.5-.4-.3 0-.8.4-.5 4.9 2.8 10.9 4.5 17.1 4.5 4.2 0 8.8-.9 13-2.7.6-.3 1.2.4.6.9z" fill="#FF9900" transform="translate(6 2)"/><path d="M32.1 29c-.5-.6-3.2-.3-4.4-.2-.4 0-.4-.3-.1-.5 2.2-1.5 5.7-1.1 6.1-.6.4.5-.1 4-2.2 5.7-.3.3-.6.1-.5-.2.5-1.2 1.5-3.8 1.1-4.2z" fill="#FF9900" transform="translate(6 2)"/><text x="24" y="26" fontSize="15" fontWeight="700" fill="#fff" textAnchor="middle" fontFamily="Arial">a</text></svg>
  );
  if (mk === "etsy") return (
    <svg viewBox="0 0 48 48" style={s}><rect width="48" height="48" rx="11" fill="#F1641E"/><text x="24" y="32" fontSize="22" fontWeight="700" fill="#fff" textAnchor="middle" fontFamily="Georgia, serif">E</text></svg>
  );
  return (
    <svg viewBox="0 0 48 48" style={s}><rect width="48" height="48" rx="11" fill="#66788E"/><path d="M14 20h20l-2 14H16z" fill="none" stroke="#fff" strokeWidth="2"/><path d="M18 20a6 6 0 0 1 12 0" fill="none" stroke="#fff" strokeWidth="2"/></svg>
  );
}
