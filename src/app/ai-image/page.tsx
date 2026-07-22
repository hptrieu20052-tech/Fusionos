import { getSession } from "@/lib/auth";
import { can } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// AI Agent · Gen Image — placeholder (MVP‑2: mô phỏng/vẽ ảnh giữ nhân vật nhất quán qua OpenRouter).
// Quyền theo module "genImage" (Permissions → AI Agent). Admin luôn full.
export default async function GenImagePage() {
  const session = await getSession();
  if (!session || !(await can(session, "genImage"))) {
    return <div className="panel empty">Bạn chưa có quyền dùng Gen Image. Liên hệ Admin để được cấp quyền.</div>;
  }
  return (
    <div style={{ padding: "40px 20px", maxWidth: 700, margin: "0 auto", textAlign: "center" }}>
      <div style={{ fontSize: 40, marginBottom: 8 }}>🎨</div>
      <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Gen Image</h2>
      <div style={{ color: "var(--muted)", marginTop: 8, fontSize: 13.5, lineHeight: 1.6 }}>
        Khâu <b>Mô phỏng</b> — sinh minh hoạ giữ nhân vật nhất quán (Gemini nano‑banana) và <b>Mockup</b> sản phẩm.
        <br />Đang phát triển (MVP‑2). Hiện dùng <b>Gen Book</b> để tạo Ý tưởng → Kịch bản trước.
      </div>
    </div>
  );
}
