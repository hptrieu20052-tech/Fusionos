import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import AmazonTemplatesClient from "./templates-client";

export const dynamic = "force-dynamic";

export default async function AmazonTemplatesPage() {
  const session = await getSession();
  if (!session) return <div className="panel empty">You don&apos;t have permission to view Templates.</div>;
  const lvl = await levelOf(session, "products");
  if (lvl < 1) return <div className="panel empty">You don&apos;t have permission to view Templates.</div>;
  return <AmazonTemplatesClient canEdit={lvl >= 2} />;
}
