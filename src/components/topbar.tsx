"use client";
import { usePathname } from "next/navigation";

const TITLES: [string, string][] = [
  ["/orders", "Đơn hàng"], ["/fulfillment", "Fulfillment"], ["/designs", "Design Studio"],
  ["/reviews", "Chấm điểm KPI"], ["/stats/orders", "Thống kê Đơn hàng"], ["/stats/designers", "Thống kê Designer"],
  ["/finance", "Tài chính"], ["/stores", "Cửa hàng"], ["/settings", "Cài đặt"], ["/admin", "Quản trị"],
];

export default function Topbar({ name, role }: { name: string; role: string }) {
  const path = usePathname();
  const title = TITLES.find(([p]) => path.startsWith(p))?.[1] ?? "Dashboard";
  return (
    <header className="topbar">
      <div className="topbar-title">{title}</div>
      <div className="topbar-right">
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{name}</span>
        <span className="chip" style={{ background: "var(--blue-soft)", color: "var(--blue)", fontWeight: 700 }}>{role}</span>
        <span className="tb-divider" />
        <button className="tb-icon-btn" title="Đăng xuất"
          onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); location.href = "/login"; }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </header>
  );
}
