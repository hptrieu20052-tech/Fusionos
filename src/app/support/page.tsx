import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Placeholder — chuẩn bị cho kế hoạch Support (sẽ làm sau).
export default async function SupportPage() {
  const session = await getSession();
  if (!session) return <div className="panel empty">Unauthorized.</div>;
  return (
    <div className="panel empty" style={{ padding: 40, textAlign: "center" }}>
      <h2 style={{ margin: "0 0 8px" }}>Support</h2>
      <p style={{ color: "var(--muted)" }}>Coming soon.</p>
    </div>
  );
}
