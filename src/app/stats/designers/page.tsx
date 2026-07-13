import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { DesignerStats } from "./stats-client";

export const dynamic = "force-dynamic";

export default async function DesignerStatsPage() {
  const session = await getSession();
  if (!session || !(await can(session, "statsDesigners"))) {
    return <div className="panel empty">You don't have permission to view designer statistics.</div>;
  }
  return <DesignerStats />;
}
