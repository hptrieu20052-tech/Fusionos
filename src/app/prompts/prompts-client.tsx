"use client";

import { useMemo, useState } from "react";
import { MarketplaceLogo } from "@/components/marketplace-logo";

type PromptRow = {
  id: string; group: string; label: string; desc: string;
  def: string; override: string | null; overridden: boolean; effective: string;
};

// Nhận diện kênh: màu viền + logo. Amazon/Shopify/Etsy dùng logo sàn thật; Book/Video icon inline.
const CH: Record<string, { color: string; mk?: string }> = {
  "Amazon": { color: "#FF9900", mk: "amazon" },
  "Shopify": { color: "#5E8E3E", mk: "shopify" },
  "Etsy": { color: "#F1641E", mk: "etsy" },
  "Book Studio": { color: "#7C5CFC" },
  "Video": { color: "#E0245E" },
};
const chColor = (g: string) => CH[g]?.color ?? "#66788E";

function ChannelLogo({ group, size = 20 }: { group: string; size?: number }) {
  const c = CH[group];
  if (c?.mk) return <MarketplaceLogo mk={c.mk} size={size} />;
  const col = chColor(group);
  if (group === "Book Studio")
    return (
      <svg viewBox="0 0 48 48" width={size} height={size} style={{ display: "block", flexShrink: 0 }}>
        <rect width="48" height="48" rx="11" fill={col} />
        <path d="M14 15h9c1.7 0 3 1.3 3 3v16c0-1.1-.9-2-2-2h-10z" fill="#fff" opacity=".95" />
        <path d="M34 15h-9c-1.7 0-3 1.3-3 3v16c0-1.1.9-2 2-2h10z" fill="#fff" opacity=".75" />
      </svg>
    );
  // Video
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} style={{ display: "block", flexShrink: 0 }}>
      <rect width="48" height="48" rx="11" fill={col} />
      <path d="M20 17l12 7-12 7z" fill="#fff" />
    </svg>
  );
}

// Manager Prompts (admin): xem/sửa/khôi phục mọi system prompt AI. Ghi đè lưu DB, ăn ngay không cần deploy.
export function PromptsClient({ initial }: { initial: PromptRow[] }) {
  const [rows, setRows] = useState<PromptRow[]>(initial);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.map((r) => [r.id, r.effective])));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ id: string; text: string; bad?: boolean } | null>(null);
  const [q, setQ] = useState("");
  const [chan, setChan] = useState<string | null>(null); // null = tất cả
  const [showDef, setShowDef] = useState<Record<string, boolean>>({});

  // Danh sách kênh (giữ thứ tự xuất hiện) + số lượng để hiện trên chip lọc.
  const channels = useMemo(() => {
    const order: string[] = [];
    const count: Record<string, number> = {};
    for (const r of rows) { if (!(r.group in count)) order.push(r.group); count[r.group] = (count[r.group] ?? 0) + 1; }
    return order.map((g) => ({ group: g, count: count[g] }));
  }, [rows]);

  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const filt = rows.filter((r) =>
      (!chan || r.group === chan) &&
      (!ql || `${r.label} ${r.id} ${r.group} ${r.desc}`.toLowerCase().includes(ql)));
    const by: Record<string, PromptRow[]> = {};
    for (const r of filt) (by[r.group] ??= []).push(r);
    return Object.entries(by);
  }, [rows, q, chan]);

  const dirty = (r: PromptRow) => (draft[r.id] ?? "") !== r.effective;
  const overriddenCount = rows.filter((r) => r.overridden).length;

  async function patch(body: Record<string, unknown>, id: string, okText: string) {
    setBusy(id); setMsg(null);
    try {
      const res = await fetch("/api/prompts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || "lỗi");
      const next: PromptRow[] = j.prompts;
      setRows(next);
      const nr = next.find((x) => x.id === id);
      if (nr) setDraft((d) => ({ ...d, [id]: nr.effective }));
      setMsg({ id, text: okText });
    } catch (e) {
      setMsg({ id, text: String((e as Error)?.message ?? e), bad: true });
    } finally { setBusy(null); }
  }

  const save = (r: PromptRow) => patch({ id: r.id, value: draft[r.id] ?? "" }, r.id, "Đã lưu — áp dụng ngay cho lần gen tới.");
  const reset = (r: PromptRow) => { if (confirm(`Khôi phục "${r.label}" về prompt mặc định? Bản sửa của bạn sẽ mất.`)) patch({ id: r.id, reset: true }, r.id, "Đã khôi phục mặc định."); };

  const chipBase: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "1px solid var(--line, #ddd)", background: "var(--panel, #fff)", color: "inherit", whiteSpace: "nowrap" };

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "0 4px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", margin: "4px 0 12px" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Manager Prompts</h1>
        <span style={{ fontSize: 13, color: "var(--muted, #888)" }}>
          {rows.length} prompt · {overriddenCount} đang ghi đè
        </span>
      </div>

      {/* Bộ lọc theo kênh */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={() => setChan(null)}
          style={{ ...chipBase, ...(chan === null ? { background: "#1f2937", color: "#fff", borderColor: "#1f2937" } : {}) }}>
          Tất cả <span style={{ opacity: .7 }}>{rows.length}</span>
        </button>
        {channels.map((c) => {
          const on = chan === c.group;
          return (
            <button key={c.group} onClick={() => setChan(on ? null : c.group)}
              style={{ ...chipBase, ...(on ? { background: c.group in CH ? chColor(c.group) : "#333", color: "#fff", borderColor: chColor(c.group) } : { borderColor: chColor(c.group) }) }}>
              <ChannelLogo group={c.group} size={16} />
              {c.group} <span style={{ opacity: .7 }}>{c.count}</span>
            </button>
          );
        })}
      </div>

      <input className="field" placeholder="Tìm prompt (tên, nhóm, id)…" value={q} onChange={(e) => setQ(e.target.value)}
        style={{ width: "100%", marginBottom: 18, padding: "9px 12px", fontSize: 14 }} />

      {groups.map(([group, list]) => {
        const col = chColor(group);
        return (
          <div key={group} style={{ marginBottom: 26 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 10px" }}>
              <ChannelLogo group={group} size={20} />
              <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".04em", color: col }}>{group}</span>
              <span style={{ fontSize: 12, color: "var(--muted, #999)" }}>· {list.length}</span>
            </div>

            {list.map((r) => {
              const d = dirty(r);
              const val = draft[r.id] ?? "";
              const rowMsg = msg && msg.id === r.id ? msg : null;
              return (
                <div key={r.id} className="panel" style={{ padding: 16, marginBottom: 14, borderRadius: 12, borderLeft: `4px solid ${col}` }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                    <ChannelLogo group={group} size={22} />
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>
                        {r.label}
                        {r.overridden && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: "#b5661a", background: "rgba(181,102,26,.12)", padding: "2px 8px", borderRadius: 999 }}>ĐÃ GHI ĐÈ</span>}
                        {d && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: "#1f7a6b", background: "rgba(31,122,107,.12)", padding: "2px 8px", borderRadius: 999 }}>chưa lưu</span>}
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--muted, #888)", marginTop: 2 }}>{r.desc}</div>
                      <code style={{ fontSize: 11, color: "var(--muted, #999)" }}>{r.id}</code>
                    </div>
                  </div>

                  <textarea
                    value={val}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    spellCheck={false}
                    style={{ width: "100%", minHeight: 120, maxHeight: 420, resize: "vertical", padding: "10px 12px",
                      fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12.5, lineHeight: 1.5,
                      border: "1px solid var(--line, #ddd)", borderRadius: 8, background: "var(--panel, #fff)", color: "inherit" }}
                  />

                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                    <button className="btn btn-primary" disabled={!d || busy === r.id} onClick={() => save(r)}>
                      {busy === r.id ? "Đang lưu…" : "Lưu"}
                    </button>
                    <button className="btn" disabled={!d || busy === r.id} onClick={() => setDraft((prev) => ({ ...prev, [r.id]: r.effective }))}>
                      Hoàn tác
                    </button>
                    <button className="btn" disabled={!r.overridden || busy === r.id} onClick={() => reset(r)} title="Xoá bản ghi đè, về prompt gốc trong code">
                      Khôi phục mặc định
                    </button>
                    <button className="btn" onClick={() => setShowDef((s) => ({ ...s, [r.id]: !s[r.id] }))}>
                      {showDef[r.id] ? "Ẩn bản gốc" : "Xem bản gốc"}
                    </button>
                    <span style={{ fontSize: 12, color: "var(--muted, #999)" }}>{val.length.toLocaleString()} ký tự</span>
                    {rowMsg && <span style={{ fontSize: 12.5, color: rowMsg.bad ? "#b4321f" : "#2e7d46", fontWeight: 600 }}>{rowMsg.text}</span>}
                  </div>

                  {showDef[r.id] && (
                    <pre style={{ marginTop: 10, padding: "10px 12px", background: "var(--ground, #f6f5f2)", border: "1px dashed var(--line, #ddd)",
                      borderRadius: 8, fontSize: 11.5, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 260, overflow: "auto" }}>
                      {r.def}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {groups.length === 0 && <div className="panel empty">Không có prompt khớp bộ lọc.</div>}
    </div>
  );
}
