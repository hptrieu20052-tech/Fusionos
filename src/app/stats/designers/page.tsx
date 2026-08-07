import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { DesignerStats, DesignSales } from "./stats-client";

export const dynamic = "force-dynamic";

export default async function DesignerStatsPage() {
  const session = await getSession();
  if (!session) {
    return <div className="panel empty" style={{ padding: 40, textAlign: "center" }}><h2 style={{ margin: "0 0 8px" }}>Designer Stats</h2><p style={{ color: "var(--muted)" }}>Sign in required.</p></div>;
  }
  // Admin: dashboard KPI đầy đủ (đã kèm bảng Design sales ở cuối).
  if (session.role === "admin") return <DesignerStats />;
  // v175 · Designer / Creator Content: CHỈ bảng Design sales — xem design nào ra bao nhiêu sale,
  // dữ liệu tự giới hạn theo scope (design mình làm designer/creator/seller). KPI toàn team vẫn admin-only.
  if (session.role === "content" || (await levelOf(session, "designs")) >= 1) {
    return <DesignSales />;
  }
  return <div className="panel empty" style={{ padding: 40, textAlign: "center" }}><h2 style={{ margin: "0 0 8px" }}>Designer Stats</h2><p style={{ color: "var(--muted)" }}>You do not have access to this page.</p></div>;
}
