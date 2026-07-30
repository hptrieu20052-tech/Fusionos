"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { MarketplaceLogo } from "@/components/marketplace-logo";

type Row = {
  id: string; storeId: string; title: string; price: string | null; quantity: number | null;
  tags: string | null; sku: string | null; status: string; importedAt: string | null;
  storeName: string | null; mainImageUrl: string | null; variationsSummary: string;
  shopifyTitle: string | null; sellerId: string | null; sellerName: string | null;
};
type Store = { id: string; name: string; sellerId: string | null; sellerName: string | null };
type Seller = { id: string; name: string };
type Detail = { id: string; title: string; price: string | null; tags: string | null; description: string | null; shopifyTitle: string | null; shopifyTags: string | null; shopifyDesc: string | null };

/* ---- style tokens (modern) ---- */
const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,.04)" };
const ctl: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 12, padding: "10px 13px", fontSize: 13.5, font: "inherit", background: "#fff", outline: "none" };
const pill = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 7, border: "none", background: bg, color: fg, borderRadius: 12, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "opacity .15s, transform .05s" });
const ghost: React.CSSProperties = { ...pill("#fff", "var(--ink)"), border: "1px solid var(--line)" };
const lab: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 6 };
const linkBtn = (c: string): React.CSSProperties => ({ border: "none", background: "none", padding: 0, cursor: "pointer", color: c, fontWeight: 700, fontSize: 12.5 });

export default function EtsyProductsClient({ stores, sellers, canEdit }: { stores: Store[]; sellers: Seller[]; canEdit: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [kw, setKw] = useState("");
  const [sellerFilter, setSellerFilter] = useState("");
  const [storeFilter, setStoreFilter] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20); // default 20 listings/page
  const showSellerFilter = sellers.length > 1; // only when managing multiple sellers (admin)
  // Import drawer
  const [impOpen, setImpOpen] = useState(false);
  const [impSeller, setImpSeller] = useState("");
  const [impStore, setImpStore] = useState(stores[0]?.id ?? "");
  const [impFile, setImpFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const impStores = useMemo(() => impSeller ? stores.filter((s) => s.sellerId === impSeller) : stores, [stores, impSeller]);
  // Edit drawer
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Detail | null>(null);
  const [editLoading, setEditLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { const j = await fetch("/api/etsy-products").then((r) => r.json()); if (j.ok) setRows(j.rows); } catch { /* noop */ }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const flash = (text: string, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 5000); };

  const filtered = useMemo(() => rows.filter((r) =>
    (!sellerFilter || r.sellerId === sellerFilter) &&
    (!storeFilter || r.storeId === storeFilter) &&
    (!kw.trim() || (r.title + " " + (r.shopifyTitle ?? "") + " " + (r.sku ?? "") + " " + (r.tags ?? "")).toLowerCase().includes(kw.trim().toLowerCase()))
  ), [rows, kw, sellerFilter, storeFilter]);
  const storesForFilter = useMemo(() => sellerFilter ? stores.filter((s) => s.sellerId === sellerFilter) : stores, [stores, sellerFilter]);

  // Phân trang (mặc định 20/trang). Reset về trang 1 khi filter đổi.
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => { setPage(1); }, [kw, sellerFilter, storeFilter, pageSize]);
  const pageClamped = Math.min(page, totalPages);
  const paged = useMemo(() => filtered.slice((pageClamped - 1) * pageSize, pageClamped * pageSize), [filtered, pageClamped, pageSize]);

  const allChecked = paged.length > 0 && paged.every((r) => sel.has(r.id));
  const toggleAll = () => { const n = new Set(sel); if (allChecked) paged.forEach((r) => n.delete(r.id)); else paged.forEach((r) => n.add(r.id)); setSel(n); };
  const toggle = (id: string) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };
  const optimizedCount = useMemo(() => rows.filter((r) => r.shopifyTitle).length, [rows]);

  const pickFile = (f: File | null | undefined) => {
    if (!f) return;
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") { flash("✗ Only .csv files exported from Etsy", false); return; }
    setImpFile(f);
  };

  const doImport = async () => {
    if (!impFile || !impStore) { flash("✗ Pick a store and a CSV file", false); return; }
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", impFile); fd.append("storeId", impStore);
      const res = await fetch("/api/etsy-products/import", { method: "POST", body: fd });
      const text = await res.text();
      let j: { ok?: boolean; error?: string; store?: string; inserted?: number; updated?: number; skipped?: number };
      try { j = JSON.parse(text); }
      catch { flash(`✗ HTTP ${res.status}: ${text.replace(/<[^>]+>/g, " ").trim().slice(0, 140) || "server error"}`, false); setBusy(false); return; }
      if (j.ok) { flash(`✓ ${j.store}: +${j.inserted} new · ${j.updated} updated${j.skipped ? ` · ${j.skipped} skipped` : ""}`); setImpOpen(false); setImpFile(null); load(); }
      else flash("✗ " + (j.error ?? "Import failed"), false);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
    setBusy(false);
  };

  const doOptimize = async () => {
    if (!sel.size) return flash("✗ Select listings first", false);
    setBusy(true);
    // Auto-batch 10/run (server maxDuration 60s) — no hard 20 cap, any count works.
    const all = Array.from(sel);
    const CHUNK = 10;
    let done = 0; const errs: string[] = [];
    try {
      for (let i = 0; i < all.length; i += CHUNK) {
        flash(`✦ AI optimizing… ${done}/${all.length}`);
        const batch = all.slice(i, i + CHUNK);
        const res = await fetch("/api/etsy-products/ai-optimize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: batch }) });
        const text = await res.text();
        let j: { ok?: boolean; optimized?: number; error?: string; errors?: string[] };
        try { j = JSON.parse(text); } catch { errs.push(`HTTP ${res.status}`); continue; }
        if (j.ok) { done += Number(j.optimized ?? 0); if (j.errors) errs.push(...j.errors); }
        else errs.push(j.error ?? "batch failed");
      }
      flash(`✓ Optimized ${done}/${all.length}${errs.length ? " · some failed: " + errs[0] : ""}`, errs.length === 0 || done > 0);
      load();
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
    setBusy(false);
  };

  const doExport = async () => {
    if (!sel.size) return flash("✗ Select listings to export", false);
    setBusy(true); flash("⬇ Building Shopify CSV…");
    try {
      const res = await fetch("/api/etsy-products/export-shopify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(sel) }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); flash("✗ " + (j.error ?? `HTTP ${res.status}`), false); setBusy(false); return; }
      const blob = await res.blob(); const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `shopify-import-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
      flash(`✓ Exported ${sel.size} listings — Shopify → Products → Import (products land as DRAFT, review prices before publishing)`);
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };

  const doDelete = async () => {
    if (!sel.size) return;
    if (!confirm(`Delete ${sel.size} listing(s) from FUSION? (Your Etsy shop is NOT affected)`)) return;
    setBusy(true);
    const j = await fetch("/api/etsy-products", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(sel) }) }).then((r) => r.json()).catch(() => ({ ok: false }));
    if (j.ok) { flash(`✓ Deleted ${j.deleted}`); setSel(new Set()); load(); } else flash("✗ " + (j.error ?? "Delete failed"), false);
    setBusy(false);
  };

  const doDuplicate = async (id: string) => {
    setBusy(true);
    const j = await fetch("/api/etsy-products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "duplicate", id }) }).then((r) => r.json()).catch(() => ({ ok: false }));
    if (j.ok) { flash("✓ Duplicated"); load(); } else flash("✗ " + (j.error ?? "Duplicate failed"), false);
    setBusy(false);
  };

  const doDeleteOne = async (id: string, title: string) => {
    if (!confirm(`Delete "${title.slice(0, 60)}" from FUSION? (Your Etsy shop is NOT affected)`)) return;
    setBusy(true);
    const j = await fetch("/api/etsy-products", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [id] }) }).then((r) => r.json()).catch(() => ({ ok: false }));
    if (j.ok) { flash("✓ Deleted"); const n = new Set(sel); n.delete(id); setSel(n); load(); } else flash("✗ " + (j.error ?? "Delete failed"), false);
    setBusy(false);
  };

  const openEdit = async (id: string) => {
    setEditId(id); setEdit(null); setEditLoading(true);
    try {
      const j = await fetch(`/api/etsy-products?id=${id}`).then((r) => r.json());
      if (j.ok) setEdit({
        id: j.item.id, title: j.item.title, price: j.item.price, tags: j.item.tags, description: j.item.description,
        shopifyTitle: j.item.shopifyTitle, shopifyTags: j.item.shopifyTags, shopifyDesc: j.item.shopifyDesc,
      });
      else { flash("✗ " + (j.error ?? "Load failed"), false); setEditId(null); }
    } catch { flash("✗ Network error", false); setEditId(null); }
    setEditLoading(false);
  };

  const saveEdit = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      const res = await fetch("/api/etsy-products", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: edit.id, title: edit.shopifyTitle ?? "", tags: edit.shopifyTags ?? "", description: edit.shopifyDesc ?? "", price: edit.price ?? "" }),
      });
      const j = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      if (j.ok) { flash("✓ Saved"); setEditId(null); setEdit(null); load(); }
      else flash("✗ " + (j.error ?? "Save failed"), false);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
    setBusy(false);
  };

  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? "";

  return (
    <div style={{ padding: "20px 22px 60px", maxWidth: 1280, margin: "0 auto" }}>
      {/* HERO HEADER */}
      <div style={{ ...card, padding: "18px 22px", marginBottom: 16, background: "linear-gradient(135deg,#FFF8F3 0%,#FFFFFF 60%)", borderColor: "#FBE3D2" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: "#fff", border: "1px solid #FBE3D2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <MarketplaceLogo mk="etsy" size={26} />
          </div>
          <div>
            <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0 }}>Manage Products · Etsy</h1>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
              {rows.length} listings · {optimizedCount} AI-optimized · Import Etsy CSV → optimize SEO → export to Shopify
            </div>
          </div>
          <div style={{ flex: 1 }} />
          {canEdit && (
            <button style={pill("#F1641E", "#fff")} onClick={() => setImpOpen(true)}
              onMouseDown={(e) => (e.currentTarget.style.transform = "scale(.97)")} onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}>
              <IcUpload /> Import Etsy CSV
            </button>
          )}
        </div>
      </div>

      {/* FILTER BAR */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <div style={{ position: "relative", flex: 1, minWidth: 240, maxWidth: 440 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }}><IcSearch /></span>
          <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="Search title / SKU / tag" style={{ ...ctl, width: "100%", paddingLeft: 34 }} />
        </div>
        {showSellerFilter && (
          <select value={sellerFilter} onChange={(e) => { setSellerFilter(e.target.value); setStoreFilter(""); }} style={ctl}>
            <option value="">All sellers</option>
            {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} style={ctl}>
          <option value="">All stores</option>
          {storesForFilter.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>{sel.size ? `${sel.size} selected` : `${filtered.length} listings`}</span>
      </div>

      {sel.size > 0 && (
        <div style={{ ...card, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", background: "#F8FAFF", borderColor: "#DCE6FB" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--blue)" }}>{sel.size} selected</span>
          <div style={{ flex: 1 }} />
          {canEdit && <button disabled={busy} style={{ ...pill("linear-gradient(135deg,#7C5CFF,#6D48C9)", "#fff"), opacity: busy ? .6 : 1 }} onClick={doOptimize} title="AI rewrites title + tags for Shopify/Google SEO (auto-batches, any count)"><IcSpark /> AI Optimize</button>}
          <button disabled={busy} style={{ ...pill("linear-gradient(135deg,#22A06B,#158A57)", "#fff"), opacity: busy ? .6 : 1 }} onClick={doExport}><IcDownload /> Export Shopify</button>
          {canEdit && <button disabled={busy} style={{ ...ghost, color: "var(--red)", borderColor: "#F3C9C9" }} onClick={doDelete}><IcTrash /> Delete</button>}
          <button style={{ ...ghost, padding: "9px 12px" }} onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      {msg && (
        <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 12, background: msg.ok ? "#EAF7F0" : "#FDECEC", color: msg.ok ? "#158A57" : "#C0392B", border: `1px solid ${msg.ok ? "#C7EAD8" : "#F5CFCF"}` }}>{msg.text}</div>
      )}

      {/* TABLE */}
      <div style={{ ...card, overflow: "hidden", padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: .3, textAlign: "left", background: "#FAFBFD" }}>
              <th style={{ padding: "12px 14px" }}><input type="checkbox" checked={allChecked} onChange={toggleAll} /></th>
              <th style={{ padding: "12px 6px" }}>Image</th>
              <th style={{ padding: "12px 6px" }}>Title</th>
              <th style={{ padding: "12px 6px" }}>Store / Seller</th>
              <th style={{ padding: "12px 6px" }}>Variations</th>
              <th style={{ padding: "12px 6px", textAlign: "right" }}>Price</th>
              <th style={{ padding: "12px 6px", textAlign: "right" }}>Qty</th>
              <th style={{ padding: "12px 6px" }}>Imported</th>
              <th style={{ padding: "12px 10px", textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>Loading…</td></tr>}
            {!loading && !filtered.length && (
              <tr><td colSpan={9} style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>No Etsy listings yet</div>
                Click <b style={{ color: "#F1641E" }}>Import Etsy CSV</b> — file from Etsy → Shop Manager → Settings → Options → Download Data
              </td></tr>
            )}
            {paged.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--line)", background: sel.has(r.id) ? "#F8FAFF" : "#fff" }}>
                <td style={{ padding: "10px 14px" }}><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td style={{ padding: "8px 6px" }}>
                  {r.mainImageUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={r.mainImageUrl} alt="" style={{ width: 46, height: 46, objectFit: "cover", borderRadius: 10 }} />
                    : <div style={{ width: 46, height: 46, borderRadius: 10, background: "var(--line)" }} />}
                </td>
                <td style={{ padding: "10px 6px", maxWidth: 420 }}>
                  {r.shopifyTitle
                    ? <>
                        <div style={{ fontWeight: 700 }}>{r.shopifyTitle} <span style={{ fontSize: 10, fontWeight: 800, color: "#6D48C9", background: "#EEE9FB", borderRadius: 6, padding: "1px 6px", marginLeft: 4 }}>AI</span></div>
                        <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Etsy: {r.title}</div>
                      </>
                    : <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{r.title}</div>}
                  {r.sku && <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "ui-monospace,monospace" }}>{r.sku}</div>}
                </td>
                <td style={{ padding: "10px 6px", whiteSpace: "nowrap" }}>
                  <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                    <MarketplaceLogo mk="etsy" size={15} />{r.storeName ?? "—"}
                  </div>
                  {r.sellerName && <div style={{ fontSize: 11, color: "var(--muted)", marginLeft: 21 }}>{r.sellerName}</div>}
                </td>
                <td style={{ padding: "10px 6px", fontSize: 12, color: "var(--muted)" }}>{r.variationsSummary || "—"}</td>
                <td style={{ padding: "10px 6px", textAlign: "right", fontWeight: 700 }}>{r.price ? `$${Number(r.price).toFixed(2)}` : "—"}</td>
                <td style={{ padding: "10px 6px", textAlign: "right" }}>{r.quantity ?? "—"}</td>
                <td style={{ padding: "10px 6px", whiteSpace: "nowrap", color: "var(--muted)" }}>{r.importedAt ? String(r.importedAt).slice(0, 10) : "—"}</td>
                <td style={{ padding: "10px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                  {canEdit && (
                    <div style={{ display: "inline-flex", gap: 12, alignItems: "center", fontSize: 12.5, fontWeight: 700 }}>
                      <button onClick={() => openEdit(r.id)} style={linkBtn("var(--blue)")}>Edit</button>
                      <button disabled={busy} onClick={() => doDuplicate(r.id)} style={linkBtn("#158A57")}>Duplicate</button>
                      <button disabled={busy} onClick={() => doDeleteOne(r.id, r.shopifyTitle || r.title)} style={linkBtn("var(--red)")}>Delete</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* PAGINATION */}
      {filtered.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
            {(pageClamped - 1) * pageSize + 1}–{Math.min(pageClamped * pageSize, filtered.length)} of {filtered.length}
          </span>
          <div style={{ flex: 1 }} />
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} style={{ ...ctl, padding: "7px 10px" }}>
            {[20, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button disabled={pageClamped <= 1} onClick={() => setPage(pageClamped - 1)} style={{ ...ghost, padding: "7px 12px", opacity: pageClamped <= 1 ? .4 : 1 }}>‹ Prev</button>
            <span style={{ fontSize: 12.5, fontWeight: 700, minWidth: 70, textAlign: "center" }}>Page {pageClamped}/{totalPages}</span>
            <button disabled={pageClamped >= totalPages} onClick={() => setPage(pageClamped + 1)} style={{ ...ghost, padding: "7px 12px", opacity: pageClamped >= totalPages ? .4 : 1 }}>Next ›</button>
          </div>
        </div>
      )}

      {/* IMPORT DRAWER */}
      {impOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 60, display: "flex", justifyContent: "flex-end" }} onClick={() => !busy && setImpOpen(false)}>
          <div style={{ background: "#fff", width: 460, maxWidth: "94vw", height: "100%", padding: 24, overflowY: "auto", boxShadow: "-8px 0 24px rgba(16,24,40,.12)", animation: "slideIn .2s ease" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>Import Etsy CSV</div>
              <button onClick={() => setImpOpen(false)} style={{ border: "none", background: "#F3F4F6", borderRadius: 9, width: 30, height: 30, cursor: "pointer", fontSize: 16, color: "var(--muted)" }}>×</button>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 18, lineHeight: 1.5 }}>
              Etsy → Shop Manager → Settings → Options → <b>Download Data</b>. Re-importing the same file updates by title.
            </div>

            {showSellerFilter && (
              <>
                <label style={lab}>① Select seller</label>
                <select value={impSeller} onChange={(e) => { setImpSeller(e.target.value); const first = stores.find((s) => s.sellerId === e.target.value); setImpStore(first?.id ?? ""); }} style={{ ...ctl, width: "100%", marginBottom: 14 }}>
                  <option value="">All sellers</option>
                  {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </>
            )}
            <label style={lab}>{showSellerFilter ? "②" : "①"} Select destination store</label>
            <select value={impStore} onChange={(e) => setImpStore(e.target.value)} style={{ ...ctl, width: "100%", marginBottom: 18 }}>
              {impStores.length === 0 && <option value="">(No Etsy store)</option>}
              {impStores.map((s) => <option key={s.id} value={s.id}>{s.name}{s.sellerName ? ` · ${s.sellerName}` : ""}</option>)}
            </select>

            <label style={lab}>{showSellerFilter ? "③" : "②"} Drop CSV file</label>
            <div
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); pickFile(e.dataTransfer.files?.[0]); }}
              onClick={() => fileRef.current?.click()}
              style={{ border: `2px dashed ${drag ? "#F1641E" : "var(--line)"}`, borderRadius: 14, padding: "30px 18px", textAlign: "center", cursor: "pointer", background: drag ? "#FFF5EE" : "#FAFBFD", transition: "all .15s", marginBottom: 18 }}>
              {impFile ? (
                <div>
                  <div style={{ fontSize: 30, marginBottom: 6 }}>📄</div>
                  <div style={{ fontWeight: 700, fontSize: 13.5, wordBreak: "break-all" }}>{impFile.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>{(impFile.size / 1024).toFixed(0)} KB · click to change file</div>
                </div>
              ) : (
                <div style={{ color: "var(--muted)" }}>
                  <div style={{ fontSize: 30, marginBottom: 6, color: drag ? "#F1641E" : "var(--muted)" }}>⬆</div>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--ink)" }}>Drag a CSV file here</div>
                  <div style={{ fontSize: 12, marginTop: 3 }}>or click to browse · .csv only</div>
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => pickFile(e.target.files?.[0])} />

            {impStore && impFile && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16, padding: "10px 12px", background: "#F8FAFF", borderRadius: 10, border: "1px solid #DCE6FB" }}>
                Will import into store <b style={{ color: "var(--ink)" }}>{storeName(impStore)}</b>.
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={ghost} disabled={busy} onClick={() => setImpOpen(false)}>Cancel</button>
              <button style={{ ...pill("#F1641E", "#fff"), opacity: impFile && impStore && !busy ? 1 : .5 }} disabled={busy || !impFile || !impStore} onClick={doImport}>
                {busy ? "Importing…" : "Import now"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT DRAWER */}
      {editId && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 60, display: "flex", justifyContent: "flex-end" }} onClick={() => !busy && setEditId(null)}>
          <div style={{ background: "#fff", width: 540, maxWidth: "96vw", height: "100%", padding: 24, overflowY: "auto", boxShadow: "-8px 0 24px rgba(16,24,40,.12)", animation: "slideIn .2s ease" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>Edit listing (for Shopify)</div>
              <button onClick={() => setEditId(null)} style={{ border: "none", background: "#F3F4F6", borderRadius: 9, width: 30, height: 30, cursor: "pointer", fontSize: 16, color: "var(--muted)" }}>×</button>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 18, lineHeight: 1.5 }}>
              These edits are used when exporting to Shopify. The original Etsy data is kept intact.
            </div>
            {editLoading || !edit ? (
              <div style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>Loading…</div>
            ) : (
              <>
                <label style={lab}>Shopify title <span style={{ fontWeight: 500 }}>({(edit.shopifyTitle ?? "").length}/140 · keep it short)</span></label>
                <input value={edit.shopifyTitle ?? ""} maxLength={140} onChange={(e) => setEdit({ ...edit, shopifyTitle: e.target.value })}
                  placeholder={edit.title} style={{ ...ctl, width: "100%", marginBottom: 6 }} />
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 16 }}>Etsy original: {edit.title}</div>

                <label style={lab}>Price (USD)</label>
                <input value={edit.price ?? ""} inputMode="decimal" onChange={(e) => setEdit({ ...edit, price: e.target.value.replace(/[^0-9.]/g, "") })}
                  placeholder="0.00" style={{ ...ctl, width: 160, marginBottom: 16 }} />

                <label style={lab}>Tags <span style={{ fontWeight: 500 }}>(comma-separated)</span></label>
                <textarea value={edit.shopifyTags ?? ""} onChange={(e) => setEdit({ ...edit, shopifyTags: e.target.value })} rows={2}
                  placeholder={(edit.tags ?? "").replace(/_/g, " ")} style={{ ...ctl, width: "100%", resize: "vertical", marginBottom: 16 }} />

                <label style={lab}>Description</label>
                <textarea value={edit.shopifyDesc ?? ""} onChange={(e) => setEdit({ ...edit, shopifyDesc: e.target.value })} rows={7}
                  placeholder={(edit.description ?? "").slice(0, 400)} style={{ ...ctl, width: "100%", resize: "vertical", marginBottom: 20 }} />

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button style={ghost} disabled={busy} onClick={() => setEditId(null)}>Cancel</button>
                  <button style={{ ...pill("var(--blue)", "#fff"), opacity: busy ? .6 : 1 }} disabled={busy} onClick={saveEdit}>{busy ? "Saving…" : "Save"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      <style>{`@keyframes slideIn{from{transform:translateX(30px);opacity:.4}to{transform:translateX(0);opacity:1}}`}</style>
    </div>
  );
}

/* ---- inline icons (stroke) ---- */
const IcUpload = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>;
const IcDownload = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>;
const IcSpark = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6L12 2z" /></svg>;
const IcTrash = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>;
const IcSearch = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>;
const IcEdit = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>;
