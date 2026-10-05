import { getSession } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import AdsCenterClient from "./ads-client";

export const dynamic = "force-dynamic";

// v449 · Meta Ads Center — số liệu ads đồng bộ nền + AI phân tích.
// v631 · Admin = toàn quyền. SELLER được vào XEM — chỉ thấy ads của CHÍNH MÌNH (ads gắn listing
// mình sở hữu — chuỗi v623), mọi nút thao tác (bật/tắt, budget, dup, publish, AI…) ẩn và server chặn.
export default async function MetaAdsPage() {
  const session = await getSession();
  if (!session || (session.role !== "admin" && session.role !== "seller")) {
    return <div className="panel empty">You don&apos;t have permission to view Meta Ads Center.</div>;
  }
  const isAdmin = session.role === "admin";
  let myName = "";
  if (!isAdmin) {
    const [u] = await db.select({ name: schema.users.fullName }).from(schema.users).where(eq(schema.users.id, session.sub)).limit(1);
    myName = (u?.name ?? "").trim();
  }
  return <AdsCenterClient isAdmin={isAdmin} myName={myName} />;
}
