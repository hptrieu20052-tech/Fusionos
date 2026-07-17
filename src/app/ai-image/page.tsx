import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// AI Agent · Gen Image — placeholder (MVP‑2: mô phỏng/vẽ ảnh giữ nhân vật nhất quán qua OpenRouter).
export default async function GenImagePage() {
  const session = await getSession();
  if (session?.role !== "admin") {
    return <div className="panel empty">Tính năng đang thử nghiệm — chỉ Admin.</div>;
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
