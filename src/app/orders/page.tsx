import { getSession } from "@/lib/auth";
import { can, levelOf, hasRestriction } from "@/lib/rbac";
import OrderHub from "./order-hub";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const session = await getSession();
  if (!session || !(await can(session, "orders"))) {
    return <div className="panel empty">You don't have permission to view the Orders module. Contact Admin if you need access.</div>;
  }
  const [lvl, ownOnly, ffLvl] = await Promise.all([
    levelOf(session, "orders"),
    hasRestriction(session, "own_orders_only"),
    levelOf(session, "fulfillment"),
  ]);
  return <OrderHub canEdit={lvl >= 2} canPushFf={ffLvl >= 2} ownOnly={ownOnly} isAdmin={session.role === "admin"} canChangeStatus={session.role === "admin" || session.role === "support"} canDuplicate={session.role === "admin" || session.role === "support"} />;
}
