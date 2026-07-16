import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// Marketing (TikTok) — placeholder cho kế hoạch tiếp theo.
export default async function MarketingPage() {
  const session = await getSession();
  if (!session || (await levelOf(session, "marketing")) < 1) {
    return <div className="panel empty">You don&apos;t have permission to view Marketing.</div>;
  }
  return (
    <div className="panel empty" style={{ padding: 40, textAlign: "center" }}>
      <h2 style={{ margin: "0 0 8px" }}>Marketing · TikTok</h2>
      <p style={{ color: "var(--muted)" }}>Coming soon.</p>
    </div>
  );
}
