"use client";
import { useCallback, useEffect, useState } from "react";

/**
 * v404 · Feed Labels — map COLLECTION → custom_label_0 cho feed phụ GMC.
 * Chọn collection (vd "Halloween"), đặt nhãn (vd "halloween") → mọi sản phẩm trong
 * collection đó mang custom_label_0 = nhãn ở lần fetch feed kế tiếp. Google Ads dùng
 * nhãn này để chia Product groups cho camp mùa vụ. Sửa/xoá tại đây, Save là xong.
 */

type Store = { id: string; name: string };
type Rule = { collectionTitle: string; label: string };

const inp: React.CSSProperties = { padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "#fff", fontSize: 13, width: "100%", boxSizing: "border-box" };
const slugLabel = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export default function LabelsClient({ stores, canEdit }: { stores: Store[]; canEdit: boolean }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [rules, setRules] = useState<Rule[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async (sid: string) => {
    if (!sid) return;
    setLoading(true); setMsg("");
    try {
      const j = await fetch(`/api/shopify-products/feed-labels?store=${sid}`).then((r) => r.json());
      if (j.ok) { setRules(j.rules.map((r: Rule) => ({ collectionTitle: r.collectionTitle, label: r.label }))); setCollections(j.collections ?? []); }
      else setMsg("✗ " + (j.error || "Failed to load"));
    } catch (e) { setMsg("✗ " + String((e as Error)?.message ?? e)); }
    setLoading(false);
  }, []);
  useEffect(() => { load(storeId); }, [storeId, load]);

  const save = async () => {
    setSaving(true); setMsg("");
    try {
      const j = await fetch("/api/shopify-products/feed-labels", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, rules }),
      }).then((r) => r.json());
      if (j.ok) { setMsg(`✓ Saved ${j.count} rule(s) — labels apply on the next feed fetch (GMC Fetch now to apply immediately)`); load(storeId); }
      else setMsg("✗ " + (j.error || "Save failed"));
    } catch (e) { setMsg("✗ " + String((e as Error)?.message ?? e)); }
    setSaving(false);
  };

  const set = (i: number, patch: Partial<Rule>) => setRules((prev) => prev.map((r, x) => (x === i ? { ...r, ...patch } : r)));
  const usedCollections = new Set(rules.map((r) => r.collectionTitle));

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 4px" }}>
      {/* Hero — đồng bộ layout Manage Products */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, background: "linear-gradient(90deg, #EDF9F0, #F2FBFF)", border: "1px solid #C9E7D2", borderRadius: 16, padding: "16px 20px", marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ width: 38, height: 38, borderRadius: 11, background: "#1E8E4E", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3.24H4a1 1 0 0 0-1 1v5.59c0 .53.21 1.04.59 1.41l9.58 9.59a2 2 0 0 0 2.83 0l4.59-4.59a2 2 0 0 0 0-2.83Z" /><circle cx="7.5" cy="7.5" r="1" /></svg>
        </span>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#14213D" }}>Feed <span style={{ color: "#1E8E4E" }}>Labels</span></div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>Collection → custom_label_0 · dùng để chia Product groups trong Google Ads</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          {stores.length > 1 && (
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} style={{ ...inp, width: "auto" }}>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {canEdit && (
            <button onClick={save} disabled={saving || loading} style={{ background: "#1E8E4E", color: "#fff", border: 0, borderRadius: 11, padding: "10px 20px", fontWeight: 800, fontSize: 13.5, cursor: "pointer", opacity: saving ? 0.6 : 1 }}>
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>

      {msg && <div style={{ fontSize: 13, padding: "9px 13px", borderRadius: 10, marginBottom: 12, background: msg.startsWith("✗") ? "var(--red-soft)" : "#EDF9F0", color: msg.startsWith("✗") ? "var(--red)" : "#1F6F45", fontWeight: 600 }}>{msg}</div>}

      <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 14, padding: 16 }}>
        {loading ? (
          <div style={{ color: "var(--muted)", fontSize: 13, padding: 12 }}>Loading…</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 220px 40px", gap: 10, fontSize: 11.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".4px", padding: "0 2px 8px" }}>
              <span>Collection</span><span>Custom label 0</span><span />
            </div>
            {rules.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13, padding: "8px 2px 14px" }}>No rules yet — add one below.</div>}
            {rules.map((r, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 220px 40px", gap: 10, marginBottom: 8, alignItems: "center" }}>
                <select value={r.collectionTitle} onChange={(e) => set(i, { collectionTitle: e.target.value, label: r.label || slugLabel(e.target.value) })} disabled={!canEdit} style={inp}>
                  <option value="">— select collection —</option>
                  {r.collectionTitle && !collections.includes(r.collectionTitle) && <option value={r.collectionTitle}>{r.collectionTitle}</option>}
                  {collections.map((c) => <option key={c} value={c} disabled={usedCollections.has(c) && c !== r.collectionTitle}>{c}</option>)}
                </select>
                <input value={r.label} onChange={(e) => set(i, { label: slugLabel(e.target.value) })} disabled={!canEdit} placeholder="halloween" style={inp} />
                {canEdit && (
                  <button onClick={() => setRules((prev) => prev.filter((_, x) => x !== i))} title="Remove rule" style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 9, height: 38, cursor: "pointer", color: "var(--red)", fontSize: 15 }}>✕</button>
                )}
              </div>
            ))}
            {canEdit && (
              <button onClick={() => setRules((prev) => [...prev, { collectionTitle: "", label: "" }])} style={{ marginTop: 4, background: "none", border: "1px dashed var(--line)", borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 700, color: "#1E8E4E", cursor: "pointer" }}>
                + Add rule
              </button>
            )}
          </>
        )}
      </div>

      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10, lineHeight: 1.6 }}>
        Labels apply when Google fetches the supplemental feed (nightly, or Merchant Center → Data sources → Fetch now).
        In Google Ads, subdivide Product groups by <b>Custom label 0</b> and pick the label to run a seasonal campaign on exactly these products.
      </div>
    </div>
  );
}
