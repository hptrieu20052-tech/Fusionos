import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import VideosClient from "./videos-client";

export const dynamic = "force-dynamic";

// v208 · Video Library là MODULE RIÊNG ("videos"), ngang hàng Design Studio.
// Luồng giống Design Studio: seller và creator tự làm việc với nhau, sửa clip rồi update. Không có bước duyệt.
//   level 1 = xem thư viện · level 2 = upload, sửa, gán listing, đẩy Shopify · admin luôn full.
export default async function VideosPage() {
  const session = await getSession();
  if (!session) return <div className="panel empty">You don&apos;t have permission to view Video Library.</div>;

  const lvl = await levelOf(session, "videos");
  if (lvl < 1) return <div className="panel empty">You don&apos;t have permission to view Video Library.</div>;

  return <VideosClient isAdmin={session.role === "admin"} canManage={lvl >= 2} />;
}
