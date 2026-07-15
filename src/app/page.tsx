import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import DashboardClient from "./dashboard-client";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const session = await getSession();
  if (!session) return null;
  const canDesigns = (await levelOf(session, "designs")) >= 1;
  const canOrders = (await levelOf(session, "orders")) >= 1;
  return <DashboardClient canDesigns={canDesigns} canOrders={canOrders} isAdmin={session.role === "admin"} />;
}
