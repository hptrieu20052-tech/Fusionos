import { getSession } from "@/lib/auth";
import { can, levelOf } from "@/lib/rbac";
import { FinanceClient } from "./finance-client";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const session = await getSession();
  if (!session || (!(await can(session, "finance")) && session.role !== "seller")) { // seller được vào — API tự giới hạn số liệu của riêng họ
    return <div className="panel empty">You don't have permission to view the Finance module.</div>;
  }
  return <FinanceClient canAdd={(await levelOf(session, "finance")) >= 2} />;
}
