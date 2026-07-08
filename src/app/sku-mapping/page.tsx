import { getSession } from "@/lib/auth";
import { can, levelOf } from "@/lib/rbac";
import { SkuMappingClient } from "./sku-mapping-client";

export const dynamic = "force-dynamic";

export default async function SkuMappingPage() {
  const session = await getSession();
  if (!session || !(await can(session, "settings"))) {
    return <div className="panel empty">Chỉ Admin (hoặc role được cấp quyền Cài đặt) truy cập được trang này.</div>;
  }
  return <SkuMappingClient canEdit={(await levelOf(session, "settings")) >= 2} />;
}
