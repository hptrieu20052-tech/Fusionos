import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { ProductSalesClient } from "./products-client";

export const dynamic = "force-dynamic";

// Sale theo LISTING/PRODUCT (gộp đơn customized) — để ưu tiên mẫu chạy ads.
export default async function ProductSalesPage() {
  const session = await getSession();
  if (!session) return <div className="panel empty" style={{ padding: 40, textAlign: "center" }}>Sign in required.</div>;
  const ok = session.role === "admin" || (await levelOf(session, "products")) >= 1 || (await levelOf(session, "orders")) >= 1;
  if (!ok) return <div className="panel empty" style={{ padding: 40, textAlign: "center" }}>You do not have access to this page.</div>;
  return <ProductSalesClient />;
}
