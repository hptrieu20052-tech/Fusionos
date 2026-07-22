import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { GenImageClient } from "./ai-image-client";

export const dynamic = "force-dynamic";

// AI Agent · Gen Image — 3 chức năng: Clone / Tách nền / Redesign (OpenRouter · Gemini Flash Image).
// Quyền theo module "genImage" (Permissions → AI Agent). Admin luôn full.
export default async function GenImagePage() {
  const session = await getSession();
  if (!session || !(await can(session, "genImage"))) {
    return <div className="panel empty">Bạn chưa có quyền dùng Gen Image. Liên hệ Admin để được cấp quyền.</div>;
  }
  return <GenImageClient />;
}
