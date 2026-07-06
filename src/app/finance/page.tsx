import { getSession } from "@/lib/auth";
import { can, levelOf } from "@/lib/rbac";
import { FinanceClient } from "./finance-client";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const session = await getSession();
  if (!session || !(await can(session, "finance"))) {
    return <div className="panel empty">Bạn không có quyền xem module Tài chính.</div>;
  }
  return <FinanceClient canAdd={(await levelOf(session, "finance")) >= 2} />;
}
