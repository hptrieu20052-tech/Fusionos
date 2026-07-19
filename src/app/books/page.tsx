import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import BooksClient from "./books-client";

export const dynamic = "force-dynamic";

// AI Agent · Book Studio — mở theo QUYỀN "bookStudio" (Admin bật cho từng seller dùng thử).
export default async function BooksPage() {
  const session = await getSession();
  if (!(await can(session, "bookStudio"))) {
    return <div className="panel empty">Book Studio (AI) đang thử nghiệm — liên hệ Admin để được cấp quyền dùng thử.</div>;
  }
  return <BooksClient />;
}
