import type { Metadata } from "next";
import "./globals.css";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { fileUrl } from "@/lib/storage";
import AppShell, { NavLink } from "@/components/app-shell";
import { LangProvider } from "@/components/lang-provider";
import { ConfirmProvider } from "@/components/confirm-provider";
import { cookies } from "next/headers";
import { Lang } from "@/lib/i18n";

export const viewport = { width: "device-width", initialScale: 1 };

export const metadata: Metadata = {
  title: "FUSION OS",
  description: "FUSION CO., LTD e-commerce management system",
};
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = ((await cookies()).get("fusion_lang")?.value === "en" ? "en" : "vi") as Lang;
  const session = await getSession();
  let avatarUrl: string | null = null;
  if (session) {
    const [u] = await db.select({ k: schema.users.avatarKey }).from(schema.users).where(eq(schema.users.id, session.sub)).limit(1);
    avatarUrl = fileUrl(u?.k ?? null);
  }
  const [orders, stores, designs, ff, finance, settings, reviews, statsDesigners, products, support, marketing, financeTiktok, bookStudio, genImage] = session
    ? await Promise.all([
        can(session, "orders"), can(session, "stores"), can(session, "designs"),
        can(session, "fulfillment"), can(session, "finance"), can(session, "settings"),
        can(session, "reviews"), can(session, "statsDesigners"), can(session, "products"), can(session, "support"), can(session, "marketing"), can(session, "financeTiktok"),
        can(session, "bookStudio"), can(session, "genImage"),
      ])
    : [false, false, false, false, false, false, false, false, false, false, false, false, false, false];

  const isAdmin = session?.role === "admin";
  const links: NavLink[] = session ? [
    { href: "/", label: "nav.dashboard", icon: "dashboard", section: "Operations" },
    ...(orders ? [{ href: "/orders", label: "nav.orders", icon: "orders", section: "Operations" }] : []),
    ...(designs ? [{ href: "/designs", label: "nav.designs", icon: "designs", section: "Operations" }] : []),
    // Đã bỏ khỏi menu (route vẫn sống, vào bằng URL trực tiếp nếu cần): /fulfillment, /stats/orders, /supplier-report
    // Scoring + Designer Stats: TẠM ẨN với admin (chưa dùng đến). Non-admin có quyền vẫn thấy. Route vẫn sống qua URL.
    ...(reviews && !isAdmin ? [{ href: "/reviews", label: "nav.reviews", icon: "reviews", section: "Operations" }] : []),
    ...(statsDesigners && !isAdmin ? [{ href: "/stats/designers", label: "nav.statsDesigners", icon: "statsDesigners", section: "Reports" }] : []),
    // Finance: hiện theo QUYỀN admin set (không hardcode role) — khớp đúng guard của /finance.
    // Seller vẫn luôn thấy: API tự giới hạn số liệu về phần của riêng họ.
    ...(finance || session.role === "seller" ? [{ href: "/finance", label: "nav.finance", icon: "finance", section: "Reports" }] : []),
    ...(stores ? [{ href: "/stores", label: "nav.stores", icon: "stores", section: "System" }] : []),
    // Support nằm trong dropdown "Seller Hub" (cùng Products) — xem canSupport truyền xuống AppShell.
    ...(settings ? [{ href: "/settings", label: "nav.settings", icon: "settings", section: "System" }] : []),
    ...(isAdmin ? [{ href: "/admin", label: "nav.admin", icon: "admin", section: "System" }] : []),
  ] : [];

  const navLinks = links;

  return (
    <html lang="vi">
      <body>
        <LangProvider initial={lang}>
          <ConfirmProvider>
          {session ? (
            <AppShell user={{ name: session.name, role: session.role, avatarUrl }} links={navLinks} canProducts={products} canSupport={support} canMarketing={marketing} canFinanceTiktok={financeTiktok} canBookStudio={bookStudio} canGenImage={genImage}>
              {children}
            </AppShell>
          ) : (
            <div className="wrap">{children}</div>
          )}
          </ConfirmProvider>
        </LangProvider>
      </body>
    </html>
  );
}
