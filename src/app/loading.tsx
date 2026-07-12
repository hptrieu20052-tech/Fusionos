/**
 * Loading UI toàn cục cho App Router: hiện NGAY khi bấm chuyển trang trong lúc
 * server render (đặc biệt lúc lambda cold start) — thay cảm giác "đơ" bằng spinner.
 */
export default function Loading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "55vh", gap: 12 }}>
      <div className="mini-spinner" />
      <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>Loading…</div>
    </div>
  );
}
