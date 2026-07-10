import { getSession } from "@/lib/auth";
import { can, levelOf } from "@/lib/rbac";
import { StoresClient } from "./stores-client";

export const dynamic = "force-dynamic";

export default async function StoresPage() {
  const session = await getSession();
  if (!session || !(await can(session, "stores"))) {
    return <div className="panel empty">You don't have permission to view the Stores module.</div>;
  }
  return <StoresClient canAdd={(await levelOf(session, "stores")) >= 2} role={session.role} />;
}
