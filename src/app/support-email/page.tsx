import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { supportMailReady } from "@/lib/support-mail";
import InboxClient from "./inbox-client";

export const dynamic = "force-dynamic";

// v392/v393 · Customer Emails — các hộp thư support trong FUSION.
// CHỈ role admin + role support thấy trang này (yêu cầu chủ shop); trong đó
// mức trả lời/đóng thread vẫn theo module "support" (1 = đọc, 2 = full). Admin quản lý Mailboxes.
export default async function SupportEmailPage() {
  const session = await getSession();
  const roleOk = session?.role === "admin" || session?.role === "support";
  const level = session && roleOk ? await levelOf(session, "support") : 0; // admin luôn = 2 (rbac)
  if (!session || !roleOk || level < 1) {
    return <div className="panel empty">You don&apos;t have permission to view Customer Emails.</div>;
  }
  return <InboxClient level={level} isAdmin={session.role === "admin"} configured={await supportMailReady()} />;
}
