"use client";
import { usePathname } from "next/navigation";
import {
  IconDashboard, IconOrders, IconTruck, IconArtwork, IconReport,
  IconWallet, IconStore, IconSettings, IconProducts, IconEye,
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

export type NavLink = { href: string; label: string; icon: string; section: string };

export default function AppShell({ user, links, children }: {
  user: { name: string; role: string };
  links: NavLink[];
  children: React.ReactNode;
}) {
  const path = usePathname();
  const { t, lang, toggle } = useLang();
  const isActive = (href: string) => href === "/" ? path === "/" : path.startsWith(href);
  const initials = user.name.split(" ").map((w) => w[0]).slice(-2).join("").toUpperCase();

  return (
    <div className="app">
      <header className="topnav">
        <div className="topnav-inner">
          <a href="/" className="topnav-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-full.png" alt="Fusion" />
          </a>
          <nav className="topnav-menu">
            {links.map((l) => {
              const Icon = ICONS[l.icon] ?? IconDashboard;
              return (
                <a key={l.href} href={l.href} className={`topnav-item${isActive(l.href) ? " active" : ""}`}>
                  <span className="topnav-ic"><Icon width={17} height={17} /></span>
                  {t(l.label)}
                </a>
              );
            })}
          </nav>
          <button onClick={toggle} className="lang-toggle" title="Chuyển ngôn ngữ / Switch language">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lang === "vi" ? "/flags/vn.png" : "/flags/en.png"} alt={lang === "vi" ? "VN" : "EN"} className="lang-flag" />
            <span>{lang === "vi" ? "VI" : "EN"}</span>
          </button>
          <div className="topnav-user">
            <div className="user-avatar">{initials}</div>
            <div className="tb-user-txt">
              <span className="tb-user-name">{user.name}</span>
              <span className="tb-role">{user.role}</span>
            </div>
            <span className="tb-divider" />
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="app-content">{children}</main>
    </div>
  );
}
