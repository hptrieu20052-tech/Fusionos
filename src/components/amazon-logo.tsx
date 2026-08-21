// Logo Amazon (chữ "a" + mũi tên cười cam) — vẽ SVG inline để không cần file ảnh.
// Dùng ở nav (16-18px) và header trang Manage Products/Templates Amazon (40-48px).
export const AmazonLogo = ({ size = 16, color = "#131921" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" style={{ display: "block", flexShrink: 0 }} aria-label="Amazon">
    <text x="16" y="21" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="bold" fontSize="23" fill={color}>a</text>
    <path d="M5.5 23.2c6 4.4 15.5 4.4 21-0.4" stroke="#FF9900" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    <path d="M25.2 20.6l2.6 1.2-1.5 2.6z" fill="#FF9900" />
  </svg>
);
export default AmazonLogo;
