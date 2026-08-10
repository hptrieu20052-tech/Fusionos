import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import CreatorStats from "./creators-client";

export const dynamic = "force-dynamic";

// v209 · Creator Stats — bản song sinh của Designer Stats, đếm video thay vì design.
// Quyền theo module "videos": level 2 / admin xem toàn đội · level 1 chỉ xem của mình (API tự lọc).
export default async function CreatorStatsPage() {
  const session = await getSession();
  if (!session) {
    return <div className="panel empty" style={{ padding: 40, textAlign: "center" }}><h2 style={{ margin: "0 0 8px" }}>Creator Stats</h2><p style={{ color: "var(--muted)" }}>Sign in required.</p></div>;
  }
  if ((await levelOf(session, "videos")) < 1) {
    return <div className="panel empty" style={{ padding: 40, textAlign: "center" }}><h2 style={{ margin: "0 0 8px" }}>Creator Stats</h2><p style={{ color: "var(--muted)" }}>You do not have access to this page.</p></div>;
  }
  return <CreatorStats />;
}
