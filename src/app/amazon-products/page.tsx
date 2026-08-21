import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import AmazonProductsClient from "./products-client";

export const dynamic = "force-dynamic";

export default async function AmazonProductsPage() {
  const session = await getSession();
  if (!session) return <div className="panel empty">You don&apos;t have permission to view Products.</div>;
  const lvl = await levelOf(session, "products");
  if (lvl < 1) return <div className="panel empty">You don&apos;t have permission to view Products.</div>;
  return <AmazonProductsClient canEdit={lvl >= 2} />;
}
