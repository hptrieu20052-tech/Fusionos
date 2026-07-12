"use client";
import { usePathname } from "next/navigation";
import {
  IconDashboard, IconOrders, IconTruck, IconArtwork, IconEye,
  IconReport, IconDollar, IconStore, IconSettings, IconProducts,
} from "./icons";

export type NavFlags = {
  orders: boolean; fulfillment: boolean; designs: boolean; reviews: boolean;
  statsOrders: boolean; statsDesigners: boolean; finance: boolean;
  stores: boolean; settings: boolean; admin: boolean;
};

export default function Sidebar({ flags }: { flags: NavFlags }) {
  const path = usePathname();
  const Item = ({ href, label, Icon, show = true, exact = false }: {
    href: string; label: string; Icon: (p: { width?: number; height?: number }) => JSX.Element; show?: boolean; exact?: boolean;
  }) => {
    if (!show) return null;
    const active = exact ? path === href : path.startsWith(href);
    return (
      <a href={href} className={`nav-item${active ? " active" : ""}`}>
        <span className="nav-icon"><Icon /></span>
        <span>{label}</span>
      </a>
    );
  };

  return (
    <aside className="sidebar">
      <a href="/" className="brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/Logo-full.png" alt="Fusion — together we grow" className="brand-img" />
      </a>
      <div className="brand-sub">FUSION OS · v0.6</div>

      <div className="nav-section">
        <div className="nav-section-label">Operations</div>
        <Item href="/" label="Dashboard" Icon={IconDashboard} exact />
        <Item href="/orders" label="Orders" Icon={IconOrders} show={flags.orders} />
        <Item href="/fulfillment" label="Fulfillment" Icon={IconTruck} show={flags.fulfillment} />
      </div>
      <div className="nav-section">
        <div className="nav-section-label">Products</div>
        <Item href="/designs" label="Design Studio" Icon={IconArtwork} show={flags.designs} />
        <Item href="/reviews" label="KPI Review" Icon={IconEye} show={flags.reviews} />
      </div>
      <div className="nav-section">
        <div className="nav-section-label">Reports</div>
        <Item href="/stats/orders" label="Order Stats" Icon={IconReport} show={flags.statsOrders} />
        <Item href="/stats/designers" label="Designer Stats" Icon={IconReport} show={flags.statsDesigners} />
        <Item href="/finance" label="Finance" Icon={IconDollar} show={flags.finance} />
      </div>
      <div className="nav-section">
        <div className="nav-section-label">System</div>
        <Item href="/stores" label="Stores" Icon={IconStore} show={flags.stores} />
        <Item href="/settings" label="Settings" Icon={IconSettings} show={flags.settings} />
        <Item href="/admin" label="Admin" Icon={IconProducts} show={flags.admin} />
      </div>
    </aside>
  );
}
