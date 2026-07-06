import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { OrderStats } from "./stats-client";

export const dynamic = "force-dynamic";

export default async function OrderStatsPage() {
  const session = await getSession();
  if (!session || !(await can(session, "orders"))) {
    return <div className="panel empty">Bạn không có quyền xem thống kê đơn hàng.</div>;
  }
  return <OrderStats />;
}
