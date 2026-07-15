import { getSession } from "@/lib/auth";
import { can, levelOf } from "@/lib/rbac";
import { SettingsClient } from "./settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session || !(await can(session, "settings"))) {
    return <div className="panel empty">Only Admin (or a role granted Settings access) can access this page.</div>;
  }
  return <SettingsClient canEdit={(await levelOf(session, "settings")) >= 2} isAdmin={session.role === "admin"} />;
}
