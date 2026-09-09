import { getSession } from "@/lib/auth";
import AdsCenterClient from "./ads-client";

export const dynamic = "force-dynamic";

// v449 · Meta Ads Center — số liệu ads đồng bộ nền + AI phân tích. Admin only.
export default async function MetaAdsPage() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return <div className="panel empty">You don&apos;t have permission to view Meta Ads Center.</div>;
  }
  return <AdsCenterClient />;
}
