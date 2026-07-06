import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { DesignerStats } from "./stats-client";

export const dynamic = "force-dynamic";

export default async function DesignerStatsPage() {
  const session = await getSession();
  if (!session || !(await can(session, "designs"))) {
    return <div className="panel empty">Bạn không có quyền xem thống kê designer.</div>;
  }
  return <DesignerStats />;
}
