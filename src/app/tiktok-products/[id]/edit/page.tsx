import { getSession } from "@/lib/auth";
import { levelOf } from "@/lib/rbac";
import { resolveProduct } from "@/lib/tiktok-products";
import EditorClient from "./editor-client";

export const dynamic = "force-dynamic";

// Trang Edit/Clone product TikTok (layout tham khảo SimpleHub). mode=clone → tạo mới cùng shop.
export default async function EditProductPage({ params, searchParams }: { params: { id: string }; searchParams: { mode?: string } }) {
  const session = await getSession();
  if (!session || (await levelOf(session, "products")) < 2) {
    return <div className="panel empty">Bạn không có quyền chỉnh sửa Products.</div>;
  }
  const r = await resolveProduct(session, params.id);
  if (!r.ok) return <div className="panel empty">Không mở được: {r.error}</div>;
  const mode = searchParams?.mode === "clone" ? "clone" : "edit";
  return <EditorClient id={params.id} mode={mode} />;
}
