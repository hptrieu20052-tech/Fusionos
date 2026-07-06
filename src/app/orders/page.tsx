import { getSession } from "@/lib/auth";
import { can, levelOf, hasRestriction } from "@/lib/rbac";
import OrderHub from "./order-hub";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const session = await getSession();
  if (!session || !(await can(session, "orders"))) {
    return <div className="panel empty">Bạn không có quyền xem module Đơn hàng. Liên hệ Admin nếu cần cấp quyền.</div>;
  }
  const [lvl, ownOnly, ffLvl] = await Promise.all([
    levelOf(session, "orders"),
    hasRestriction(session.sub, "own_orders_only"),
    levelOf(session, "fulfillment"),
  ]);
  return <OrderHub canEdit={lvl >= 2} canPushFf={ffLvl >= 2} ownOnly={ownOnly} />;
}
