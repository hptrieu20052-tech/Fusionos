import { getSession } from "@/lib/auth";
import AccountClient from "./account-client";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await getSession();
  if (!session) return <div className="panel empty">Cần đăng nhập để xem trang này.</div>;
  return <AccountClient />;
}
