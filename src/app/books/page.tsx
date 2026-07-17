import { getSession } from "@/lib/auth";
import BooksClient from "./books-client";

export const dynamic = "force-dynamic";

// AI Agent · Book Studio — hiện ADMIN-only (thử nghiệm), ổn định rồi mở quyền sau.
export default async function BooksPage() {
  const session = await getSession();
  if (session?.role !== "admin") {
    return <div className="panel empty">Book Studio (AI) đang thử nghiệm — chỉ Admin truy cập.</div>;
  }
  return <BooksClient />;
}
