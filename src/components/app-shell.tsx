"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  IconDashboard, IconOrders, IconTruck, IconArtwork, IconReport,
  IconWallet, IconStore, IconSettings, IconProducts, IconEye, IconGrid, IconBox, IconSupport, IconMarketing, IconBell, IconSparkle, IconBook,
} from "@/components/icons";
import { useLang } from "@/components/lang-provider";

type P = { width?: number; height?: number; style?: React.CSSProperties };
const ICONS: Record<string, (p: P) => JSX.Element> = {
  dashboard: IconDashboard, orders: IconOrders, fulfillment: IconTruck,
  designs: IconArtwork, reviews: IconEye, statsOrders: IconReport,
  statsDesigners: IconReport, finance: IconWallet, stores: IconStore,
  settings: IconSettings, admin: IconProducts, support: IconSupport,
  ai: IconSparkle,
};

export type NavLink = { href: string; label: string; icon: string; section: string; more?: boolean };

export default function AppShell({ user, links, children, canProducts = false, canSupport = false, canMarketing = false, canFinanceTiktok = false, canBookStudio = false }: {
  user: { name: string; role: string; avatarUrl?: string | null };
  links: NavLink[];
  children: React.ReactNode;
  canProducts?: boolean;
  canSupport?: boolean;
  canMarketing?: boolean;
  canFinanceTiktok?: boolean;
  canBookStudio?: boolean;
}) {
  const path = usePathname();
  const { t } = useLang();
  const isActive = (href: string) => href === "/" ? path === "/" : path.startsWith(href);

  // Trang /login KHÔNG BAO GIỜ khoác app chrome (nav/avatar) — kể cả khi session còn sống
  // (middleware đã redirect người đăng nhập khỏi /login; đây là lớp chặn thứ 2 chống flash UI).
  const isLogin = path === "/login";
  const initials = user.name.split(" ").map((w) => w[0]).slice(-2).join("").toUpperCase();
  const [moreOpen, setMoreOpen] = useState(false);
  const [prodOpen, setProdOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [mobileHub, setMobileHub] = useState(false); // nhóm Seller Hub trên mobile (thu gọn/mở)

  // Đóng drawer + mọi dropdown khi chuyển trang + khoá scroll nền khi drawer mở.
  // Tự mở nhóm Seller Hub nếu đang ở 1 trang thuộc nhóm.
  useEffect(() => {
    setMobileOpen(false); setUserOpen(false); setProdOpen(false); setMoreOpen(false); setAiOpen(false);
    const hubPaths = ["/tiktok-products", "/tiktok-templates", "/support", "/marketing", "/tiktok-finance"];
    setMobileHub(hubPaths.some((p) => path.startsWith(p)));
  }, [path]);
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);
  // Click ra ngoài dropdown (Products / More) thì đóng
  useEffect(() => {
    if (!prodOpen && !moreOpen && !aiOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest?.(".topnav-more")) { setProdOpen(false); setMoreOpen(false); setAiOpen(false); }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [prodOpen, moreOpen, aiOpen]);

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
    // TAB MỞ NGUYÊN không chuyển tab → không có sự kiện focus/visibility khi user quay lại máy.
    // Bắt cử động chuột/phím ĐẦU TIÊN sau ≥60s im lặng để hâm nóng ngay — tay chạm chuột
    // trước khi click thật 1–2s nên lambda + connection DB kịp ấm.
    let lastAct = Date.now();
    const onAct = () => {
      const now = Date.now();
      if (now - lastAct >= 60_000) warm();
      lastAct = now;
    };
    window.addEventListener("pointermove", onAct, { passive: true });
    window.addEventListener("keydown", onAct, { passive: true });
    return () => {
      document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", warm);
      window.removeEventListener("pointermove", onAct); window.removeEventListener("keydown", onAct);
    };
  }, []);

  if (isLogin) return <>{children}</>;

  // Dropdown "Seller Hub" (gộp Products + Templates + Support) — sau "Design Studio"; hiện khi có quyền products HOẶC support.
  const hasDesigns = links.some((l) => !l.more && l.href === "/designs");
  const hubActive = ["/tiktok-products", "/tiktok-templates", "/support", "/marketing", "/tiktok-finance"].some((h) => path.startsWith(h));
  // Dropdown "AI Agent" (admin-only, beta) — ngay sau Design Studio. Gen Book (Book Studio) + Gen Image.
  const aiActive = ["/books", "/ai-image"].some((h) => path.startsWith(h));
  const isAdminUser = user.role === "admin";
  const aiAgentDropdown = (canBookStudio || isAdminUser) ? (
    <div key="__aiagent" className="topnav-more">
      <button className={`topnav-item${aiActive ? " active" : ""}`} onClick={() => { setProdOpen(false); setMoreOpen(false); setAiOpen((v) => !v); }}>
        <span className="topnav-ic"><IconSparkle width={17} height={17} /></span>
        AI Agent <span style={{ fontSize: 10, marginLeft: 2 }}>▾</span>
      </button>
      {aiOpen && (
        <div className="topnav-more-menu" style={{ minWidth: 0, width: "max-content" }} onClick={() => setAiOpen(false)}>
          {canBookStudio && (
            <Link href="/books" prefetch className={`topnav-more-item${isActive("/books") ? " active" : ""}`}>
              <span className="topnav-ic"><IconBook width={16} height={16} /></span>
              Gen Book
            </Link>
          )}
          {isAdminUser && (
            <Link href="/ai-image" prefetch className={`topnav-more-item${isActive("/ai-image") ? " active" : ""}`}>
              <span className="topnav-ic"><IconArtwork width={16} height={16} /></span>
              Gen Image
            </Link>
          )}
        </div>
      )}
    </div>
  ) : null;

  const productsDropdown = (canProducts || canSupport || canMarketing || canFinanceTiktok) ? (
    <div key="__sellerhub" className="topnav-more">
      <button className={`topnav-item${hubActive ? " active" : ""}`} onClick={() => { setAiOpen(false); setMoreOpen(false); setProdOpen((v) => !v); }}>
        <span className="topnav-ic"><IconBox width={17} height={17} /></span>
        Seller Hub <span style={{ fontSize: 10, marginLeft: 2 }}>▾</span>
      </button>
      {prodOpen && (
        <div className="topnav-more-menu" onClick={() => setProdOpen(false)}>
          {canProducts && <Link href="/tiktok-products" prefetch className={`topnav-more-item${isActive("/tiktok-products") ? " active" : ""}`}>
            <span className="topnav-ic"><IconBox width={16} height={16} /></span>
            Manage Products Tiktok
          </Link>}
          {canProducts && <Link href="/tiktok-templates" prefetch className={`topnav-more-item${isActive("/tiktok-templates") ? " active" : ""}`}>
            <span className="topnav-ic"><IconGrid width={16} height={16} /></span>
            Manage Templates Tiktok
          </Link>}
          {canSupport && <Link href="/support" prefetch className={`topnav-more-item${isActive("/support") ? " active" : ""}`}>
            <span className="topnav-ic"><IconSupport width={16} height={16} /></span>
            Customer Messages Tiktok
          </Link>}
          {canMarketing && <Link href="/marketing" prefetch className={`topnav-more-item${isActive("/marketing") ? " active" : ""}`}>
            <span className="topnav-ic"><IconMarketing width={16} height={16} /></span>
            Marketing Tiktok
          </Link>}
          {canFinanceTiktok && <Link href="/tiktok-finance" prefetch className={`topnav-more-item${isActive("/tiktok-finance") ? " active" : ""}`}>
            <span className="topnav-ic"><IconWallet width={16} height={16} /></span>
            Finance Tiktok
          </Link>}
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="app">
      <header className="topnav">
        <div className="topnav-inner">
          {/* Hamburger — chỉ hiện trên mobile */}
          <button type="button" className="topnav-burger" aria-label="Menu" onClick={() => setMobileOpen((v) => !v)}>
            {mobileOpen
              ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>}
          </button>
          <Link href="/" className="topnav-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/Logo-full.png" alt="Fusion" />
          </Link>
          <nav className="topnav-menu">
            {links.filter((l) => !l.more).flatMap((l) => {
              const Icon = ICONS[l.icon] ?? IconDashboard;
              const el = (
                <Link key={l.href} href={l.href} prefetch className={`topnav-item${isActive(l.href) ? " active" : ""}`}>
                  <span className="topnav-ic"><Icon width={17} height={17} /></span>
                  {t(l.label)}
                </Link>
              );
              // AI Agent + Seller Hub dropdown nằm ngay sau "Design Studio"
              return l.href === "/designs" ? [el, aiAgentDropdown, productsDropdown].filter(Boolean) as JSX.Element[] : [el];
            })}
            {/* Fallback: nếu người này không thấy Design Studio thì vẫn hiện AI Agent / Products (nếu có quyền) */}
            {!hasDesigns && aiAgentDropdown}
            {!hasDesigns && productsDropdown}
            {links.some((l) => l.more) && (
              <div className="topnav-more">
                <button className={`topnav-item${links.some((l) => l.more && isActive(l.href)) ? " active" : ""}`} onClick={() => { setAiOpen(false); setProdOpen(false); setMoreOpen((v) => !v); }}>
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
          <NotificationBell />
          <div className="topnav-user" style={{ position: "relative" }}>
            <button type="button" className="topnav-avatar-btn" onClick={() => setUserOpen((v) => !v)} aria-label="Account menu">
              <div className="user-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit", display: "block" }} /> : initials}</div>
              <div className="tb-user-txt">
                <span className="tb-user-name">{user.name}</span>
                <span className="tb-role">{user.role}</span>
              </div>
              <svg className="tb-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {userOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 94 }} onClick={() => setUserOpen(false)} />
                <div className="topnav-more-menu" style={{ minWidth: 200 }} onClick={() => setUserOpen(false)}>
                  <div style={{ padding: "8px 12px 6px", borderBottom: "1px solid var(--line)", marginBottom: 4 }}>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>{user.name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700 }}>{user.role}</div>
                  </div>
                  <Link href="/account" prefetch className="topnav-more-item">
                    <span className="topnav-ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg></span>
                    Account settings
                  </Link>
                  <button type="button" className="topnav-more-item" style={{ width: "100%", background: "none", border: "none", cursor: "pointer", font: "inherit", textAlign: "left", color: "var(--red)" }}
                    onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); location.href = "/login"; }}>
                    <span className="topnav-ic" style={{ color: "var(--red)" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg></span>
                    Log out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Drawer menu mobile: danh sách phẳng, gọn như desktop */}
      {mobileOpen && (
        <div className="mobile-nav-overlay" onClick={() => setMobileOpen(false)}>
          <nav className="mobile-nav" onClick={(e) => e.stopPropagation()}>
            {links.flatMap((l) => {
              const Icon = ICONS[l.icon] ?? IconDashboard;
              const el = (
                <Link key={l.href} href={l.href} prefetch className={`mobile-nav-item${isActive(l.href) ? " active" : ""}`}>
                  <span className="topnav-ic"><Icon width={18} height={18} /></span>
                  {t(l.label)}
                </Link>
              );
              // Sau "Design Studio": chèn nhóm Seller Hub thu gọn (bấm để mở) — gom Products/Templates/Customer Messages/Marketing/Finance.
              if (l.href === "/designs" && (canProducts || canSupport || canMarketing || canFinanceTiktok)) {
                const hubItems = [
                  ...(canProducts ? [
                    { href: "/tiktok-products", icon: <IconBox width={18} height={18} />, label: "Manage Products Tiktok" },
                    { href: "/tiktok-templates", icon: <IconGrid width={18} height={18} />, label: "Manage Templates Tiktok" },
                  ] : []),
                  ...(canSupport ? [{ href: "/support", icon: <IconSupport width={18} height={18} />, label: "Customer Messages Tiktok" }] : []),
                  ...(canMarketing ? [{ href: "/marketing", icon: <IconMarketing width={18} height={18} />, label: "Marketing Tiktok" }] : []),
                  ...(canFinanceTiktok ? [{ href: "/tiktok-finance", icon: <IconWallet width={18} height={18} />, label: "Finance Tiktok" }] : []),
                ];
                const hubActive = hubItems.some((h) => isActive(h.href));
                return [el,
                  <div key="__hub">
                    <button type="button" onClick={() => setMobileHub((v) => !v)}
                      className={`mobile-nav-item${hubActive ? " active" : ""}`}
                      style={{ width: "100%", background: "none", border: 0, fontFamily: "inherit", cursor: "pointer", textAlign: "left" }}>
                      <span className="topnav-ic"><IconBox width={18} height={18} /></span>
                      Seller Hub
                      <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.7 }}>{mobileHub ? "▾" : "▸"}</span>
                    </button>
                    {mobileHub && hubItems.map((h) => (
                      <Link key={h.href} href={h.href} prefetch className={`mobile-nav-item${isActive(h.href) ? " active" : ""}`} style={{ paddingLeft: 34 }}>
                        <span className="topnav-ic">{h.icon}</span>
                        {h.label}
                      </Link>
                    ))}
                  </div>,
                ];
              }
              return [el];
            })}
            {!hasDesigns && canProducts && (
              <Link href="/tiktok-products" prefetch className={`mobile-nav-item${isActive("/tiktok-products") ? " active" : ""}`}>
                <span className="topnav-ic"><IconBox width={18} height={18} /></span>
                Manage Products Tiktok
              </Link>
            )}
            {!hasDesigns && canSupport && (
              <Link href="/support" prefetch className={`mobile-nav-item${isActive("/support") ? " active" : ""}`}>
                <span className="topnav-ic"><IconSupport width={18} height={18} /></span>
                Customer Messages Tiktok
              </Link>
            )}
            {!hasDesigns && canMarketing && (
              <Link href="/marketing" prefetch className={`mobile-nav-item${isActive("/marketing") ? " active" : ""}`}>
                <span className="topnav-ic"><IconMarketing width={18} height={18} /></span>
                Marketing Tiktok
              </Link>
            )}
          </nav>
        </div>
      )}

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

// ===== Chuông thông báo — hiện tại chỉ báo khi có bản EXTENSION mới (admin publish) =====
function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [ver, setVer] = useState<{ version: string; notes?: string } | null>(null);
  const [seen, setSeen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    try { setSeen(localStorage.getItem("fusion_seen_ext_ver")); } catch { /* ignore */ }
    fetch("/api/extension/version", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (alive && j?.version) setVer({ version: String(j.version), notes: j.notes }); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Có bản mới nếu version tải về khác với version user đã xem lần cuối.
  const hasNew = !!(ver && ver.version && ver.version !== seen);
  const markSeen = () => { if (ver?.version) { try { localStorage.setItem("fusion_seen_ext_ver", ver.version); } catch { /* ignore */ } setSeen(ver.version); } };

  return (
    <div style={{ position: "relative", marginRight: 6 }}>
      <button type="button" aria-label="Notifications" onClick={() => { setOpen((v) => !v); if (!open) markSeen(); }}
        style={{ position: "relative", width: 38, height: 38, borderRadius: 10, border: "1px solid var(--line)", background: "var(--card)", cursor: "pointer", display: "grid", placeItems: "center", color: "var(--muted)" }}>
        <IconBell width={18} height={18} />
        {hasNew && <span style={{ position: "absolute", top: 7, right: 8, width: 8, height: 8, borderRadius: "50%", background: "#E5484D", border: "2px solid var(--card)" }} />}
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 94 }} onClick={() => setOpen(false)} />
          <div className="topnav-more-menu" style={{ minWidth: 288, right: 0, zIndex: 95 }}>
            <div style={{ padding: "9px 13px 7px", borderBottom: "1px solid var(--line)", fontWeight: 800, fontSize: 13 }}>Notifications</div>
            {ver ? (
              <a href="/extension/" target="_blank" rel="noreferrer" className="topnav-more-item" style={{ alignItems: "flex-start", gap: 9, whiteSpace: "normal", padding: "10px 13px" }}>
                <span className="topnav-ic" style={{ marginTop: 1 }}><IconBox width={17} height={17} /></span>
                <span>
                  <span style={{ fontWeight: 700, fontSize: 12.5 }}>Fusion Etsy Extension v{ver.version}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                    {hasNew ? "New version available — click to download & update ↗" : (ver.notes && ver.notes !== "bundled" ? ver.notes : "You're on the latest version.")}
                  </span>
                </span>
              </a>
            ) : (
              <div style={{ padding: "14px 13px", fontSize: 12.5, color: "var(--muted)" }}>No new notifications.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
