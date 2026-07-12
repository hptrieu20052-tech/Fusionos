"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  IconDashboard, IconOrders, IconTruck, IconArtwork, IconReport,
  IconWallet, IconStore, IconSettings, IconProducts, IconEye, IconGrid,
} from "@/components/icons";
import { LogoutButton } from "@/app/logout-button";
import { useLang } from "@/components/lang-provider";

type P = { width?: number; height?: number; style?: React.CSSProperties };
const ICONS: Record<string, (p: P) => JSX.Element> = {
  dashboard: IconDashboard, orders: IconOrders, fulfillment: IconTruck,
  designs: IconArtwork, reviews: IconEye, statsOrders: IconReport,
  statsDesigners: IconReport, finance: IconWallet, stores: IconStore,
  settings: IconSettings, admin: IconProducts,
};

export type NavLink = { href: string; label: string; icon: string; section: string; more?: boolean };

export default function AppShell({ user, links, children }: {
  user: { name: string; role: string; avatarUrl?: string | null };
  links: NavLink[];
  children: React.ReactNode;
}) {
  const path = usePathname();
  const { t } = useLang();
  const isActive = (href: string) => href === "/" ? path === "/" : path.startsWith(href);
  const initials = user.name.split(" ").map((w) => w[0]).slice(-2).join("").toUpperCase();
  const [moreOpen, setMoreOpen] = useState(false);

  // HÂM NÓNG sau idle: Vercel Hobby cho lambda ngủ sau vài phút không có request →
  // click đầu tiên khi quay lại bị cold start 2–5s. Khi tab visible trở lại (hoặc window focus),
  // bắn 1 GET /api/ping chạy nền để dựng function + mở lại connection Supabase TRƯỚC khi user kịp click.
  // Throttle 60s để không spam.
  useEffect(() => {
    let last = 0;
    const warm = () => {
      const now = Date.now();
      if (now - last < 60_000) return;
      last = now;
      fetch("/api/ping", { cache: "no-store", keepalive: true }).catch(() => {});
    };
    const onVisible = () => { if (document.visibilityState === "visible") warm(); };
    warm(); // lần load đầu cũng hâm luôn
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", warm);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", warm); };
  }, []);

  return (
    <div className="app">
      <header className="topnav">
        <div className="topnav-inner">
          <Link href="/" className="topnav-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/Logo-full.png" alt="Fusion" />
          </Link>
          <nav className="topnav-menu">
            {links.filter((l) => !l.more).map((l) => {
              const Icon = ICONS[l.icon] ?? IconDashboard;
              return (
                <Link key={l.href} href={l.href} prefetch className={`topnav-item${isActive(l.href) ? " active" : ""}`}>
                  <span className="topnav-ic"><Icon width={17} height={17} /></span>
                  {t(l.label)}
                </Link>
              );
            })}
            {links.some((l) => l.more) && (
              <div className="topnav-more" onMouseLeave={() => setMoreOpen(false)}>
                <button className={`topnav-item${links.some((l) => l.more && isActive(l.href)) ? " active" : ""}`} onClick={() => setMoreOpen((v) => !v)}>
                  <span className="topnav-ic"><IconGrid width={17} height={17} /></span>
                  {t("nav.more")} <span style={{ fontSize: 10, marginLeft: 2 }}>▾</span>
                </button>
                {moreOpen && (
                  <div className="topnav-more-menu" onClick={() => setMoreOpen(false)}>
                    {links.filter((l) => l.more).map((l) => {
                      const Icon = ICONS[l.icon] ?? IconDashboard;
                      return (
                        <Link key={l.href} href={l.href} prefetch className={`topnav-more-item${isActive(l.href) ? " active" : ""}`}>
                          <span className="topnav-ic"><Icon width={16} height={16} /></span>
                          {t(l.label)}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </nav>
          <div className="topnav-user">
            <Link href="/account" className="topnav-user-link" title="My account" prefetch>
              <div className="user-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit", display: "block" }} /> : initials}</div>
              <div className="tb-user-txt">
                <span className="tb-user-name">{user.name}</span>
                <span className="tb-role">{user.role}</span>
              </div>
            </Link>
            <span className="tb-divider" />
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="app-content">{children}</main>
      <BackToTop />
    </div>
  );
}

// Nút kéo lên đầu trang — hiện khi cuộn xuống >400px (Design Studio / Orders dài lướt mỏi tay)
function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (!show) return null;
  return (
    <button type="button" aria-label="Back to top" title="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      style={{
        position: "fixed", right: 22, bottom: 24, zIndex: 90,
        width: 44, height: 44, borderRadius: "50%", border: "none", cursor: "pointer",
        background: "var(--blue)", color: "#fff", boxShadow: "0 4px 14px rgba(0,0,0,.22)",
        display: "grid", placeItems: "center",
      }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 14l6-6 6 6" />
      </svg>
    </button>
  );
}
