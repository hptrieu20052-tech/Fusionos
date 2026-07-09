import { getSession } from "@/lib/auth";
import { can, levelOf } from "@/lib/rbac";
import DesignsClient from "./designs-client";

export const dynamic = "force-dynamic";

export default async function DesignsPage() {
  const session = await getSession();
  if (!session || !(await can(session, "designs"))) {
    return <div className="panel empty">Bạn không có quyền xem Design Studio.</div>;
  }
  const canUpload = (await levelOf(session, "designs")) >= 2;
  return <DesignsClient canEdit={canUpload} role={session.role} />;
}
