import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import VideosClient from "./videos-client";

export const dynamic = "force-dynamic";

// v207 · Video library — creator upload, admin duyệt, đẩy Shopify + lấy caption cho social.
// Quyền xem/upload: products≥1 HOẶC designs≥1 (creator thường chỉ có designs).
// Duyệt: admin. Đẩy Shopify / caption AI: products≥2.
export default async function VideosPage() {
  const session = await getSession();
  if (!session) return <div className="panel empty">You don&apos;t have permission to view Videos.</div>;

  const prod = await levelOf(session, "products");
  const des = await levelOf(session, "designs");
  if (prod < 1 && des < 1) return <div className="panel empty">You don&apos;t have permission to view Videos.</div>;

  return <VideosClient isAdmin={session.role === "admin"} canPush={prod >= 2} />;
}
