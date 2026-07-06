import { getSession } from "@/lib/auth";
import { can, levelOf } from "@/lib/rbac";
import { SettingsClient } from "./settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session || !(await can(session, "settings"))) {
    return <div className="panel empty">Chỉ Admin (hoặc role được cấp quyền Cài đặt) truy cập được trang này.</div>;
  }
  return <SettingsClient canEdit={(await levelOf(session, "settings")) >= 2} ingestHint={process.env.INGEST_API_KEY ? "đã cấu hình trong .env" : "CHƯA cấu hình!"} />;
}
