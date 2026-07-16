import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function TiktokTemplatesPage() {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 1) {
    return <div className="panel empty">You don&apos;t have permission to view this.</div>;
  }
  return (
    <div className="panel empty" style={{ padding: 40, textAlign: "center" }}>
      <h2 style={{ margin: "0 0 8px" }}>Manage Templates · TikTok</h2>
      <p style={{ color: "var(--muted)" }}>Coming soon.</p>
    </div>
  );
}
