import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { GenVideoClient } from "./ai-video-client";

export const dynamic = "force-dynamic";

// AI Agent · Gen Video — image-to-video (fal.ai · Kling / Seedance).
// Quyền theo module "genVideo" (Permissions → AI Agent). Admin luôn full.
export default async function GenVideoPage() {
  const session = await getSession();
  if (!session || !(await can(session, "genVideo"))) {
    return <div className="panel empty">Bạn chưa có quyền dùng Gen Video. Liên hệ Admin để được cấp quyền.</div>;
  }
  return <GenVideoClient />;
}
