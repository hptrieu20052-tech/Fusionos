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

export const metadata: Metadata = {
  title: "FUSION OS",
  description: "Hệ thống quản lý ecommerce FUSION CO., LTD",
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
  const [orders, stores, designs, ff, finance, settings] = session
    ? await Promise.all([
        can(session, "orders"), can(session, "stores"), can(session, "designs"),
        can(session, "fulfillment"), can(session, "finance"), can(session, "settings"),
      ])
    : [false, false, false, false, false, false];

  const links: NavLink[] = session ? [
    { href: "/", label: "nav.dashboard", icon: "dashboard", section: "Vận hành" },
    ...(orders ? [{ href: "/orders", label: "nav.orders", icon: "orders", section: "Vận hành" }] : []),
    ...(designs ? [{ href: "/designs", label: "nav.designs", icon: "designs", section: "Vận hành" }] : []),
    // Tạm ẩn — bật lại sau khi lên plan:
    ...(ff ? [{ href: "/fulfillment", label: "nav.fulfillment", icon: "fulfillment", section: "Vận hành", more: true }] : []),
    ...(designs ? [{ href: "/reviews", label: "nav.reviews", icon: "reviews", section: "Vận hành", more: true }] : []),
    ...(orders ? [{ href: "/stats/orders", label: "nav.statsOrders", icon: "statsOrders", section: "Thống kê", more: true }] : []),
    ...(designs ? [{ href: "/stats/designers", label: "nav.statsDesigners", icon: "statsDesigners", section: "Thống kê", more: true }] : []),
    ...(finance ? [{ href: "/finance", label: "nav.finance", icon: "finance", section: "Thống kê", more: true }] : []),
    ...(orders ? [{ href: "/supplier-report", label: "nav.supplierReport", icon: "statsOrders", section: "Thống kê", more: true }] : []),
    ...(stores ? [{ href: "/stores", label: "nav.stores", icon: "stores", section: "Hệ thống" }] : []),
    ...(settings ? [{ href: "/settings", label: "nav.settings", icon: "settings", section: "Hệ thống" }] : []),
    ...(session.role === "admin" ? [{ href: "/admin", label: "nav.admin", icon: "admin", section: "Hệ thống" }] : []),
  ] : [];

  // "More" (các trang đang chờ lên plan) tạm thời chỉ admin thấy; seller/staff/designer đều ẩn.
  const showMore = session?.role === "admin";
  const navLinks = showMore ? links : links.filter((l) => !l.more);

  return (
    <html lang="vi">
      <body>
        <LangProvider initial={lang}>
          <ConfirmProvider>
          {session ? (
            <AppShell user={{ name: session.name, role: session.role, avatarUrl }} links={navLinks}>
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
