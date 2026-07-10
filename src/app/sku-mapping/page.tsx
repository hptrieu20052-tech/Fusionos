import { getSession } from "@/lib/auth";
import { can, levelOf } from "@/lib/rbac";
import { SkuMappingClient } from "./sku-mapping-client";

export const dynamic = "force-dynamic";

export default async function SkuMappingPage() {
  const session = await getSession();
  if (!session || !(await can(session, "settings"))) {
    return <div className="panel empty">Only Admin (or a role granted Settings access) can access this page.</div>;
  }
  return <SkuMappingClient canEdit={(await levelOf(session, "settings")) >= 2} />;
}
