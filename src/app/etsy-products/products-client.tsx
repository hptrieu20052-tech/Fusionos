"use client";
import { useEffect, useMemo, useRef, useState } from "react";

type Row = {
  id: string; storeId: string; title: string; price: string | null; quantity: number | null;
  tags: string | null; sku: string | null; status: string; importedAt: string | null;
  storeName: string | null; mainImageUrl: string | null; variationsSummary: string;
  shopifyTitle: string | null;
};
type Store = { id: string; name: string };

const btn: React.CSSProperties = { border: "1px solid var(--line)", background: "#fff", borderRadius: 10, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", color: "var(--ink)" };
const btnPri: React.CSSProperties = { ...btn, background: "var(--blue)", borderColor: "var(--blue)", color: "#fff" };
const ctl: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 10, padding: "8px 11px", fontSize: 13, font: "inherit", background: "#fff" };

export default function EtsyProductsClient({ stores, canEdit }: { stores: Store[]; canEdit: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [kw, setKw] = useState("");
  const [storeFilter, setStoreFilter] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  // Import modal
  const [impOpen, setImpOpen] = useState(false);
  const [impStore, setImpStore] = useState(stores[0]?.id ?? "");
  const [impFile, setImpFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const j = await fetch("/api/etsy-products").then((r) => r.json());
      if (j.ok) setRows(j.rows);
    } catch { /* noop */ }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 4000); };

  const filtered = useMemo(() => rows.filter((r) =>
    (!storeFilter || r.storeId === storeFilter) &&
    (!kw.trim() || (r.title + " " + (r.sku ?? "") + " " + (r.tags ?? "")).toLowerCase().includes(kw.trim().toLowerCase()))
  ), [rows, kw, storeFilter]);

  const allChecked = filtered.length > 0 && filtered.every((r) => sel.has(r.id));
  const toggleAll = () => {
    const n = new Set(sel);
    if (allChecked) filtered.forEach((r) => n.delete(r.id));
    else filtered.forEach((r) => n.add(r.id));
    setSel(n);
  };
  const toggle = (id: string) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); };

  const doImport = async () => {
    if (!impFile || !impStore) { flash("✗ Pick a store and a CSV file"); return; }
    setBusy(true); setMsg("Importing…");
    try {
      const fd = new FormData();
      fd.append("file", impFile); fd.append("storeId", impStore);
      const j = await fetch("/api/etsy-products/import", { method: "POST", body: fd }).then((r) => r.json());
      if (j.ok) { flash(`✓ ${j.store}: ${j.inserted} new · ${j.updated} updated${j.skipped ? ` · ${j.skipped} skipped` : ""}`); setImpOpen(false); setImpFile(null); load(); }
      else flash("✗ " + (j.error ?? "Import failed"));
    } catch { flash("✗ Network error"); }
    setBusy(false);
  };

  const doExport = async () => {
    if (!sel.size) { flash("✗ Select listings to export first"); return; }
    setBusy(true); setMsg("Building Shopify CSV…");
    try {
      const res = await fetch("/api/etsy-products/export-shopify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(sel) }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); flash("✗ " + (j.error ?? `HTTP ${res.status}`)); setBusy(false); return; }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `shopify-import-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click(); URL.revokeObjectURL(a.href);
      flash(`✓ Exported ${sel.size} listings — import the file in Shopify → Products → Import (products land as DRAFT; review PRICES before publishing)`);
    } catch { flash("✗ Network error"); }
    setBusy(false);
  };

  const doOptimize = async () => {
    if (!sel.size) { flash("✗ Select listings first"); return; }
    if (sel.size > 20) { flash("✗ AI Optimize: max 20 listings per run"); return; }
    setBusy(true); setMsg("AI optimizing titles & tags…");
    try {
      const j = await fetch("/api/etsy-products/ai-optimize", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(sel) }),
      }).then((r) => r.json());
      if (j.ok) { flash(`✓ Optimized ${j.optimized}/${j.total}${j.errors ? " · some failed: " + j.errors[0] : ""}`); load(); }
      else flash("✗ " + (j.error ?? "Optimize failed"));
    } catch { flash("✗ Network error"); }
    setBusy(false);
  };

  const doDelete = async () => {
    if (!sel.size) return;
    if (!confirm(`Delete ${sel.size} listing(s) from FUSION? (Etsy itself is NOT affected)`)) return;
    setBusy(true);
    const j = await fetch("/api/etsy-products", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(sel) }) }).then((r) => r.json()).catch(() => ({ ok: false }));
    if (j.ok) { flash(`✓ Deleted ${j.deleted}`); setSel(new Set()); load(); } else flash("✗ " + (j.error ?? "Delete failed"));
    setBusy(false);
  };

  return (
    <div style={{ padding: "18px 20px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Manage Products · Etsy <span style={{ color: "var(--muted)", fontWeight: 600 }}>({filtered.length})</span></h1>
        <div style={{ flex: 1 }} />
        {canEdit && <button style={btnPri} onClick={() => setImpOpen(true)}>⬆ Import Etsy CSV</button>}
        {canEdit && <button style={{ ...btn, background: "#6D48C9", borderColor: "#6D48C9", color: "#fff", opacity: sel.size ? 1 : 0.5 }} disabled={!sel.size || busy} onClick={doOptimize} title="AI rewrites title + tags for Shopify/Google SEO (max 20)">✦ AI Optimize ({sel.size})</button>}
        <button style={{ ...btn, opacity: sel.size ? 1 : 0.5 }} disabled={!sel.size || busy} onClick={doExport}>⬇ Export Shopify ({sel.size})</button>
        {canEdit && <button style={{ ...btn, color: "var(--red)", opacity: sel.size ? 1 : 0.5 }} disabled={!sel.size || busy} onClick={doDelete}>Delete ({sel.size})</button>}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="Keyword (title / sku / tag)" style={{ ...ctl, minWidth: 260, flex: 1, maxWidth: 420 }} />
        <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} style={ctl}>
          <option value="">All stores</option>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {msg && <div style={{ marginBottom: 10, fontSize: 13, color: msg.startsWith("✗") ? "var(--red)" : "var(--green)" }}>{msg}</div>}

      <div className="panel" style={{ overflowX: "auto", padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: "var(--muted)", fontSize: 11.5, textAlign: "left" }}>
              <th style={{ padding: "10px 12px" }}><input type="checkbox" checked={allChecked} onChange={toggleAll} /></th>
              <th style={{ padding: "10px 6px" }}>IMAGE</th>
              <th style={{ padding: "10px 6px" }}>TITLE</th>
              <th style={{ padding: "10px 6px" }}>STORE</th>
              <th style={{ padding: "10px 6px" }}>VARIATIONS</th>
              <th style={{ padding: "10px 6px", textAlign: "right" }}>PRICE</th>
              <th style={{ padding: "10px 6px", textAlign: "right" }}>QTY</th>
              <th style={{ padding: "10px 6px" }}>IMPORTED</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Loading…</td></tr>}
            {!loading && !filtered.length && <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
              No Etsy listings yet — press <b>Import Etsy CSV</b> (Etsy → Shop Manager → Listings → Download as CSV).
            </td></tr>}
            {filtered.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: "8px 12px" }}><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td style={{ padding: "6px" }}>
                  {r.mainImageUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={r.mainImageUrl} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8 }} />
                    : <div style={{ width: 44, height: 44, borderRadius: 8, background: "var(--line)" }} />}
                </td>
                <td style={{ padding: "8px 6px", maxWidth: 440 }}>
                  {r.shopifyTitle
                    ? <>
                        <div style={{ fontWeight: 700 }}>{r.shopifyTitle} <span style={{ fontSize: 10, fontWeight: 800, color: "#6D48C9", background: "#EEE9FB", borderRadius: 6, padding: "1px 6px", marginLeft: 4 }}>AI</span></div>
                        <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Etsy: {r.title}</div>
                      </>
                    : <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{r.title}</div>}
                  {r.sku && <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "ui-monospace,monospace" }}>{r.sku}</div>}
                </td>
                <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>{r.storeName ?? "—"}</td>
                <td style={{ padding: "8px 6px", fontSize: 12, color: "var(--muted)" }}>{r.variationsSummary || "—"}</td>
                <td style={{ padding: "8px 6px", textAlign: "right", fontWeight: 700 }}>{r.price ? `$${Number(r.price).toFixed(2)}` : "—"}</td>
                <td style={{ padding: "8px 6px", textAlign: "right" }}>{r.quantity ?? "—"}</td>
                <td style={{ padding: "8px 6px", whiteSpace: "nowrap", color: "var(--muted)" }}>{r.importedAt ? String(r.importedAt).slice(0, 10) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {impOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => !busy && setImpOpen(false)}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 22, width: 440, maxWidth: "92vw" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Import Etsy CSV</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>
              Etsy → Shop Manager → Settings → Options → Download Data (hoặc Listings → Download CSV). Import lại cùng file = cập nhật đè theo title.
            </div>
            <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 5 }}>1. Store (bắt buộc chọn trước)</label>
            <select value={impStore} onChange={(e) => setImpStore(e.target.value)} style={{ ...ctl, width: "100%", marginBottom: 12 }}>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 5 }}>2. File CSV</label>
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => setImpFile(e.target.files?.[0] ?? null)} style={{ marginBottom: 16, fontSize: 13 }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={btn} disabled={busy} onClick={() => setImpOpen(false)}>Cancel</button>
              <button style={{ ...btnPri, opacity: impFile && impStore ? 1 : 0.5 }} disabled={busy || !impFile || !impStore} onClick={doImport}>{busy ? "Importing…" : "Import"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
