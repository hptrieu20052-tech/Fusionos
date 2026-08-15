"use client";
import React, { useEffect, useState } from "react";

/**
 * CUSTOM OPTIONS — bộ ô cá nhân hoá của MỘT listing, dựng theo đúng màn "Custom options"
 * của Etsy seller (Add field → Field type / Field title / Instructions / Character limit /
 * This field is required, tối đa 5 field).
 *
 * Dùng chung ở 3 chỗ nên tách ra đây, không copy 3 bản:
 *   1. Manage Products · Shopify → action "Custom options…" (sửa hàng loạt)
 *   2. Manage Products · Shopify → Edit listing (xem + sửa ngay trong listing)
 *   3. Manage Products · Etsy    → Edit listing + Create Manual (seller tự làm)
 *
 * Component KHÔNG tự gọi API — cha giữ state và tự quyết lưu đi đâu.
 */

export type PQ = {
  type: "text" | "dropdown" | "upload";
  label: string;
  instructions: string;
  required: boolean;
  maxChars: number;
  options: string[];
  maxFiles: number;
};

export const NEW_PQ = (type: PQ["type"]): PQ => ({
  type, label: "", instructions: "", required: true,
  maxChars: type === "text" ? 100 : 0,
  options: type === "dropdown" ? [""] : [],
  maxFiles: type === "upload" ? 1 : 0,
});

export const PQ_TYPE: { k: PQ["type"]; t: string; d: string }[] = [
  { k: "text", t: "Text box", d: "Buyer types a name, a date or a short message." },
  { k: "dropdown", t: "List of options", d: "Buyer picks one of the choices you set." },
  { k: "upload", t: "Photo upload", d: "Buyer attaches photos. One upload field per listing." },
];

export const PQ_LABEL = (q: PQ) => PQ_TYPE.find((t) => t.k === q.type)?.t ?? "Text box";

/** Chuẩn hoá dữ liệu từ DB/API về đúng shape PQ để đổ vào editor (server có payloadOf riêng). */
export function toPQ(v: unknown): PQ[] {
  return (Array.isArray(v) ? v : []).map((x) => {
    const q = (x ?? {}) as Partial<PQ>;
    const type: PQ["type"] = q.type === "dropdown" ? "dropdown" : q.type === "upload" ? "upload" : "text";
    return {
      type,
      label: String(q.label ?? ""),
      instructions: String(q.instructions ?? ""),
      required: q.required !== false,
      maxChars: type === "text" ? Math.min(1024, Math.max(1, Number(q.maxChars) || 100)) : 0,
      options: (Array.isArray(q.options) ? q.options : []).map((s) => String(s)),
      maxFiles: type === "upload" ? Math.min(10, Math.max(1, Number(q.maxFiles) || 1)) : 0,
    };
  }).slice(0, 5);
}

/** Lỗi chặn lưu — trả chuỗi để cha flash lên, null = hợp lệ. */
export function pqProblem(fields: PQ[]): string | null {
  if (fields.some((q) => !q.label.trim())) return "Every field needs a title";
  if (fields.some((q) => q.type === "dropdown" && !q.options.filter((o) => o.trim()).length)) return "A list field needs at least one option";
  return null;
}

/** Tóm tắt 1 dòng để hiện ở chỗ chưa mở editor. */
export function pqSummary(fields: PQ[]): string {
  if (!fields.length) return "No custom options";
  return fields.map((q) => q.label.trim() || "(no title)").join(" · ");
}

const ctl: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 12, padding: "10px 13px", fontSize: 13.5, font: "inherit", background: "#fff", outline: "none" };
const lab: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 6 };
const pill = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 7, border: "none", background: bg, color: fg, borderRadius: 12, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" });
const ghost: React.CSSProperties = { ...pill("#fff", "var(--ink)"), border: "1px solid var(--line)" };
const linkBtn = (c: string): React.CSSProperties => ({ border: "none", background: "none", padding: 0, cursor: "pointer", color: c, fontWeight: 700, fontSize: 12.5 });

export default function CustomOptions({
  fields, onChange, accent = "#4A7230", onEditingChange, disabled = false,
}: {
  fields: PQ[];
  onChange: (next: PQ[]) => void;
  accent?: string;
  onEditingChange?: (editing: boolean) => void;
  disabled?: boolean;
}) {
  // index field đang mở ra sửa; null = chỉ xem danh sách.
  const [edit, setEdit] = useState<number | null>(null);
  useEffect(() => { onEditingChange?.(edit !== null); }, [edit, onEditingChange]);

  const set = (i: number, patch: Partial<PQ>) => onChange(fields.map((q, k) => (k === i ? { ...q, ...patch } : q)));
  const del = (i: number) => { onChange(fields.filter((_, k) => k !== i)); setEdit(null); };
  // v269 · sắp xếp lại thứ tự field bằng nút ▲▼ (trước đây không kéo/di chuyển được).
  const move = (i: number, dir: -1 | 1) => { const j = i + dir; if (j < 0 || j >= fields.length) return; const a = fields.slice(); [a[i], a[j]] = [a[j], a[i]]; onChange(a); };

  return (
    <div style={{ opacity: disabled ? .55 : 1, pointerEvents: disabled ? "none" : "auto" }}>
      <div style={{ display: "grid", gap: 8 }}>
        {fields.map((q, i) => edit === i ? (
          <div key={i} style={{ border: `1px solid ${accent}55`, background: `${accent}0D`, borderRadius: 12, padding: 14, display: "grid", gap: 12 }}>
            <div>
              <label style={lab}>Field type</label>
              <select value={q.type}
                onChange={(e) => { const t = e.target.value as PQ["type"]; set(i, { ...NEW_PQ(t), label: q.label, instructions: t === "dropdown" ? "" : q.instructions, required: q.required }); }}
                style={{ ...ctl, width: "100%" }}>
                {PQ_TYPE.map((t) => <option key={t.k} value={t.k} disabled={t.k === "upload" && fields.some((x, k) => k !== i && x.type === "upload")}>{t.t}</option>)}
              </select>
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 5 }}>{PQ_TYPE.find((t) => t.k === q.type)?.d}</div>
            </div>
            <div>
              <label style={lab}>Field title ({q.label.length}/45)</label>
              <input autoFocus maxLength={45} value={q.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="e.g. Child's name" style={{ ...ctl, width: "100%" }} />
            </div>
            {q.type !== "dropdown" && (
              <div>
                <label style={lab}>Instructions for buyers ({q.instructions.length}/120)</label>
                <input maxLength={120} value={q.instructions} onChange={(e) => set(i, { instructions: e.target.value })} placeholder="e.g. Exactly as it should be printed" style={{ ...ctl, width: "100%" }} />
              </div>
            )}
            {q.type === "text" && (
              <div>
                <label style={lab}>Character limit (1–1024)</label>
                <input type="number" min={1} max={1024} value={q.maxChars} onChange={(e) => set(i, { maxChars: Math.min(1024, Math.max(1, Number(e.target.value) || 1)) })} style={{ ...ctl, width: 140 }} />
              </div>
            )}
            {q.type === "dropdown" && (
              <div>
                <label style={lab}>Options ({q.options.length}/30)</label>
                <div style={{ display: "grid", gap: 6 }}>
                  {q.options.map((o, k) => (
                    <div key={k} style={{ display: "flex", gap: 8 }}>
                      <input maxLength={20} value={o} onChange={(e) => set(i, { options: q.options.map((x, j) => (j === k ? e.target.value : x)) })} placeholder={`Option ${k + 1}`} style={{ ...ctl, flex: 1 }} />
                      <button onClick={() => set(i, { options: q.options.filter((_, j) => j !== k) })} style={{ ...ghost, padding: "8px 12px" }}>✕</button>
                    </div>
                  ))}
                </div>
                {q.options.length < 30 && <button onClick={() => set(i, { options: [...q.options, ""] })} style={{ ...linkBtn(accent), marginTop: 8 }}>+ Add option</button>}
              </div>
            )}
            {q.type === "upload" && (
              <div style={{ display: "grid", gap: 12 }}>
                <div>
                  <label style={lab}>Number of photos (1–10)</label>
                  <input type="number" min={1} max={10} disabled={q.options.length > 0} value={q.options.length || q.maxFiles}
                    onChange={(e) => set(i, { maxFiles: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })}
                    style={{ ...ctl, width: 140, opacity: q.options.length ? .5 : 1 }} />
                </div>
                <div>
                  <label style={lab}>Label each photo (optional — one upload box per label)</label>
                  <div style={{ display: "grid", gap: 6 }}>
                    {q.options.map((o, k) => (
                      <div key={k} style={{ display: "flex", gap: 8 }}>
                        <input maxLength={45} value={o} onChange={(e) => set(i, { options: q.options.map((x, j) => (j === k ? e.target.value : x)) })} placeholder={`Photo ${k + 1} — e.g. Front cover`} style={{ ...ctl, flex: 1 }} />
                        <button onClick={() => set(i, { options: q.options.filter((_, j) => j !== k) })} style={{ ...ghost, padding: "8px 12px" }}>✕</button>
                      </div>
                    ))}
                  </div>
                  {q.options.length < 10 && <button onClick={() => set(i, { options: [...q.options, ""] })} style={{ ...linkBtn(accent), marginTop: 8 }}>+ Add label</button>}
                </div>
              </div>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, cursor: "pointer" }}>
              <input type="checkbox" checked={q.required} onChange={(e) => set(i, { required: e.target.checked })} /> This field is required
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => del(i)} style={{ ...ghost, color: "#D14343" }}>Delete</button>
              <button disabled={!q.label.trim()} onClick={() => setEdit(null)} style={{ ...pill(accent, "#fff"), opacity: q.label.trim() ? 1 : .5 }}>Done</button>
            </div>
          </div>
        ) : (
          <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "11px 14px", display: "flex", alignItems: "center", gap: 12 }}>
            {/* v269 · ▲▼ đổi thứ tự field */}
            <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: "0 0 auto" }}>
              <button onClick={() => move(i, -1)} disabled={i === 0} title="Move up"
                style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 6, width: 22, height: 18, lineHeight: "16px", fontSize: 11, cursor: i === 0 ? "default" : "pointer", color: "var(--muted)", opacity: i === 0 ? .35 : 1, padding: 0 }}>▲</button>
              <button onClick={() => move(i, 1)} disabled={i === fields.length - 1} title="Move down"
                style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 6, width: 22, height: 18, lineHeight: "16px", fontSize: 11, cursor: i === fields.length - 1 ? "default" : "pointer", color: "var(--muted)", opacity: i === fields.length - 1 ? .35 : 1, padding: 0 }}>▼</button>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {q.label || <span style={{ color: "#D14343" }}>(no title)</span>}
                {q.required && <span style={{ color: "#D14343" }}> *</span>}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                {PQ_LABEL(q)}
                {q.type === "text" ? ` · ${q.maxChars} characters` : q.type === "dropdown" ? ` · ${q.options.length} option(s)` : ` · ${q.options.length || q.maxFiles} photo(s)`}
              </div>
            </div>
            <button onClick={() => setEdit(i)} style={linkBtn(accent)}>Edit</button>
            <button onClick={() => del(i)} style={linkBtn("#D14343")}>Delete</button>
          </div>
        ))}
      </div>

      {fields.length < 5 && edit === null && (
        <button onClick={() => { onChange([...fields, NEW_PQ("text")]); setEdit(fields.length); }}
          style={{ ...ghost, width: "100%", justifyContent: "center", marginTop: fields.length ? 10 : 0 }}>+ Add field</button>
      )}
      {fields.length >= 5 && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>5 of 5 fields — the maximum for one listing.</div>}
    </div>
  );
}
