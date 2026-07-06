import { getSession } from "@/lib/auth";
import { can, levelOf } from "@/lib/rbac";
import { ReviewsClient } from "./reviews-client";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const session = await getSession();
  if (!session || !(await can(session, "designs"))) {
    return <div className="panel empty">Bạn không có quyền xem module Chấm điểm.</div>;
  }
  return <ReviewsClient canReview={(await levelOf(session, "designs")) >= 2} />;
}
