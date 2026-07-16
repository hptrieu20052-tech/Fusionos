import { getSession } from "@/lib/auth";
import { DesignerStats } from "./stats-client";

export const dynamic = "force-dynamic";

export default async function DesignerStatsPage() {
  const session = await getSession();
  // TẠM KHOÁ — chưa cần. Chỉ admin vào được (chặn staff qua link trực tiếp).
  if (!session || session.role !== "admin") {
    return <div className="panel empty" style={{ padding: 40, textAlign: "center" }}><h2 style={{ margin: "0 0 8px" }}>Designer Stats</h2><p style={{ color: "var(--muted)" }}>Coming soon.</p></div>;
  }
  return <DesignerStats />;
}
