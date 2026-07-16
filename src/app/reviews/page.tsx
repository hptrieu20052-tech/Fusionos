import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { ReviewsClient } from "./reviews-client";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const session = await getSession();
  // TẠM KHOÁ — chưa cần. Chỉ admin vào được (chặn staff qua link trực tiếp).
  if (!session || session.role !== "admin") {
    return <div className="panel empty" style={{ padding: 40, textAlign: "center" }}><h2 style={{ margin: "0 0 8px" }}>Scoring</h2><p style={{ color: "var(--muted)" }}>Coming soon.</p></div>;
  }
  return <ReviewsClient canReview={(await levelOf(session, "reviews")) >= 2} />;
}
