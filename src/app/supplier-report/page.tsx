import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import SupplierReportClient from "./report-client";

export const dynamic = "force-dynamic";

export default async function SupplierReportPage() {
  const session = await getSession();
  if (!session || !(await can(session, "orders"))) {
    return <div className="panel empty">Access denied.</div>;
  }
  return <SupplierReportClient />;
}
