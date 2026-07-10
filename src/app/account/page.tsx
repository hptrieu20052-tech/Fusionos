import { getSession } from "@/lib/auth";
import AccountClient from "./account-client";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await getSession();
  if (!session) return <div className="panel empty">You must sign in to view this page.</div>;
  return <AccountClient />;
}
