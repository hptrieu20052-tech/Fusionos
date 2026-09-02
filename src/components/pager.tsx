"use client";
import React from "react";

// Pager dùng chung cho các trang Manage Products: nút số trang 1 2 3 … N + Prev/Next.
// Rút gọn bằng dấu … khi nhiều trang: 1 … 4 5 6 … 35.
function pageWindow(cur: number, total: number): (number | "…")[] {
  const set = new Set<number>([1, total, cur - 1, cur, cur + 1]);
  const sorted = Array.from(set).filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const res: (number | "…")[] = [];
  let prev = 0;
  for (const n of sorted) { if (n - prev > 1) res.push("…"); res.push(n); prev = n; }
  return res;
}

export function Pager({ page, totalPages, onPage, accent = "#2952B3" }: { page: number; totalPages: number; onPage: (p: number) => void; accent?: string }) {
  if (totalPages <= 1) return null;
  const nums = pageWindow(page, totalPages);
  const base: React.CSSProperties = { border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "6px 11px", fontSize: 13, cursor: "pointer", minWidth: 34, textAlign: "center", color: "inherit" };
  const nav = (disabled: boolean): React.CSSProperties => ({ ...base, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 });
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1} style={nav(page <= 1)}>‹ Prev</button>
      {nums.map((n, i) => n === "…"
        ? <span key={`e${i}`} style={{ padding: "6px 4px", color: "var(--muted)", fontSize: 13 }}>…</span>
        : <button key={n} onClick={() => onPage(n)} style={{ ...base, ...(n === page ? { background: accent, color: "#fff", borderColor: accent, fontWeight: 800 } : {}) }}>{n}</button>
      )}
      <button onClick={() => onPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} style={nav(page >= totalPages)}>Next ›</button>
    </div>
  );
}
