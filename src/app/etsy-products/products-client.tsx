"use client";
import { useEffect, useMemo, useRef, useState } from "react";

type Row = {
  id: string; storeId: string; title: string; price: string | null; quantity: number | null;
  tags: string | null; sku: string | null; status: string; importedAt: string | null;
  storeName: string | null; mainImageUrl: string | null; variationsSummary: string;
  shopifyTitle: string | null;
};
type Store = { id: string; name: string };

/* ---- style tokens (modern) ---- */
const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,.04)" };
const ctl: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 12, padding: "10px 13px", fontSize: 13.5, font: "inherit", background: "#fff", outline: "none" };
const pill = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 7, border: "none", background: bg, color: fg, borderRadius: 12, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "opacity .15s, transform .05s" });
const ghost: React.CSSProperties = { ...pill("#fff", "var(--ink)"), border: "1px solid var(--line)" };

export default function EtsyProductsClient({ stores, canEdit }: { stores: Store[]; canEdit: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [kw, setKw] = useState("");
  const [storeFilter, setStoreFilter] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // Import drawer
  const [impOpen, setImpOpen] = useState(false);
  const [impStore, setImpStore] = useState(stores[0]?.id ?? "");
  const [impFile, setImpFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try { const j = await fetch("/api/etsy-products").then((r) => r.json()); if (j.ok) setRows(j.rows); } catch { /* noop */ }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const flash = (text: string, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 5000); };

  const filtered = useMemo(() => rows.filter((r) =>
    (!storeFilter || r.storeId === storeFilter) &&
    (!kw.trim() || (r.title + " " + (r.shopifyTitle ?? "") + " " + (r.sku ?? "") + " " + (r.tags ?? "")).toLowerCase().includes(kw.trim().toLowerCase()))
  ), [rows, kw, storeFilter]);

  const allChecked = filtered.length > 0 && filtered.every((r) => sel.has(r.id));
  const toggleAll = () => { const n = new Set(sel); if (allChecked) filtered.forEach((r) => n.delete(r.id)); else filtered.forEach((r) => n.add(r.id)); setSel(n); };
  const toggle = (id: string) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };
  const optimizedCount = useMemo(() => rows.filter((r) => r.shopifyTitle).length, [rows]);

  const pickFile = (f: File | null | undefined) => {
    if (!f) return;
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") { flash("✗ Chỉ nhận file .csv export từ Etsy", false); return; }
    setImpFile(f);
  };

  const doImport = async () => {
    if (!impFile || !impStore) { flash("✗ Chọn store và file CSV", false); return; }
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", impFile); fd.append("storeId", impStore);
      const res = await fetch("/api/etsy-products/import", { method: "POST", body: fd });
      const text = await res.text();
      let j: { ok?: boolean; error?: string; store?: string; inserted?: number; updated?: number; skipped?: number };
      try { j = JSON.parse(text); }
      catch { flash(`✗ HTTP ${res.status}: ${text.replace(/<[^>]+>/g, " ").trim().slice(0, 140) || "server error"}`, false); setBusy(false); return; }
      if (j.ok) { flash(`✓ ${j.store}: +${j.inserted} mới · ${j.updated} cập nhật${j.skipped ? ` · ${j.skipped} bỏ qua` : ""}`); setImpOpen(false); setImpFile(null); load(); }
      else flash("✗ " + (j.error ?? "Import lỗi"), false);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Lỗi mạng"), false); }
    setBusy(false);
  };

  const doOptimize = async () => {
    if (!sel.size) return flash("✗ Chọn listing trước", false);
    if (sel.size > 20) return flash("✗ AI Optimize tối đa 20 listing/lần", false);
    setBusy(true); flash("✦ AI đang tối ưu title & tag…");
    try {
      const j = await fetch("/api/etsy-products/ai-optimize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(sel) }) }).then((r) => r.json());
      if (j.ok) { flash(`✓ Đã tối ưu ${j.optimized}/${j.total}${j.errors ? " · lỗi: " + j.errors[0] : ""}`); load(); }
      else flash("✗ " + (j.error ?? "Optimize lỗi"), false);
    } catch { flash("✗ Lỗi mạng", false); }
    setBusy(false);
  };

  const doExport = async () => {
    if (!sel.size) return flash("✗ Chọn listing để export", false);
    setBusy(true); flash("⬇ Đang tạo file Shopify CSV…");
    try {
      const res = await fetch("/api/etsy-products/export-shopify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(sel) }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); flash("✗ " + (j.error ?? `HTTP ${res.status}`), false); setBusy(false); return; }
      const blob = await res.blob(); const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `shopify-import-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
      flash(`✓ Đã export ${sel.size} listing — Shopify → Products → Import (vào dạng DRAFT, kiểm giá trước khi publish)`);
    } catch { flash("✗ Lỗi mạng", false); }
    setBusy(false);
  };

  const doDelete = async () => {
    if (!sel.size) return;
    if (!confirm(`Xoá ${sel.size} listing khỏi FUSION? (KHÔNG ảnh hưởng shop Etsy)`)) return;
    setBusy(true);
    const j = await fetch("/api/etsy-products", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(sel) }) }).then((r) => r.json()).catch(() => ({ ok: false }));
    if (j.ok) { flash(`✓ Đã xoá ${j.deleted}`); setSel(new Set()); load(); } else flash("✗ " + (j.error ?? "Xoá lỗi"), false);
    setBusy(false);
  };

  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? "";

  return (
    <div style={{ padding: "20px 22px 60px", maxWidth: 1280, margin: "0 auto" }}>
      {/* HERO HEADER */}
      <div style={{ ...card, padding: "18px 22px", marginBottom: 16, background: "linear-gradient(135deg,#FFF8F3 0%,#FFFFFF 60%)", borderColor: "#FBE3D2" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: "#F1641E", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 20, flexShrink: 0 }}>E</div>
          <div>
            <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0 }}>Manage Products · Etsy</h1>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
              {rows.length} listing · {optimizedCount} đã tối ưu AI · Import từ CSV Etsy → tối ưu SEO → Export sang Shopify
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

      {/* ACTION BAR — hiện khi có chọn */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <div style={{ position: "relative", flex: 1, minWidth: 240, maxWidth: 440 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }}><IcSearch /></span>
          <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="Tìm title / SKU / tag" style={{ ...ctl, width: "100%", paddingLeft: 34 }} />
        </div>
        <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} style={ctl}>
          <option value="">Tất cả store</option>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>{sel.size ? `${sel.size} đã chọn` : `${filtered.length} listing`}</span>
      </div>

      {sel.size > 0 && (
        <div style={{ ...card, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", background: "#F8FAFF", borderColor: "#DCE6FB" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--blue)" }}>{sel.size} listing</span>
          <div style={{ flex: 1 }} />
          {canEdit && <button disabled={busy} style={{ ...pill("linear-gradient(135deg,#7C5CFF,#6D48C9)", "#fff"), opacity: busy ? .6 : 1 }} onClick={doOptimize} title="AI viết lại title + tag chuẩn SEO (tối đa 20)"><IcSpark /> AI Optimize</button>}
          <button disabled={busy} style={{ ...pill("linear-gradient(135deg,#22A06B,#158A57)", "#fff"), opacity: busy ? .6 : 1 }} onClick={doExport}><IcDownload /> Export Shopify</button>
          {canEdit && <button disabled={busy} style={{ ...ghost, color: "var(--red)", borderColor: "#F3C9C9" }} onClick={doDelete}><IcTrash /> Xoá</button>}
          <button style={{ ...ghost, padding: "9px 12px" }} onClick={() => setSel(new Set())}>Bỏ chọn</button>
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
              <th style={{ padding: "12px 6px" }}>Ảnh</th>
              <th style={{ padding: "12px 6px" }}>Title</th>
              <th style={{ padding: "12px 6px" }}>Store</th>
              <th style={{ padding: "12px 6px" }}>Biến thể</th>
              <th style={{ padding: "12px 6px", textAlign: "right" }}>Giá</th>
              <th style={{ padding: "12px 6px", textAlign: "right" }}>SL</th>
              <th style={{ padding: "12px 6px" }}>Import</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>Đang tải…</td></tr>}
            {!loading && !filtered.length && (
              <tr><td colSpan={8} style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Chưa có listing Etsy nào</div>
                Bấm <b style={{ color: "#F1641E" }}>Import Etsy CSV</b> — file lấy ở Etsy → Shop Manager → Settings → Options → Download Data
              </td></tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--line)", background: sel.has(r.id) ? "#F8FAFF" : "#fff" }}>
                <td style={{ padding: "10px 14px" }}><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td style={{ padding: "8px 6px" }}>
                  {r.mainImageUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={r.mainImageUrl} alt="" style={{ width: 46, height: 46, objectFit: "cover", borderRadius: 10 }} />
                    : <div style={{ width: 46, height: 46, borderRadius: 10, background: "var(--line)" }} />}
                </td>
                <td style={{ padding: "10px 6px", maxWidth: 440 }}>
                  {r.shopifyTitle
                    ? <>
                        <div style={{ fontWeight: 700 }}>{r.shopifyTitle} <span style={{ fontSize: 10, fontWeight: 800, color: "#6D48C9", background: "#EEE9FB", borderRadius: 6, padding: "1px 6px", marginLeft: 4 }}>AI</span></div>
                        <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Etsy: {r.title}</div>
                      </>
                    : <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{r.title}</div>}
                  {r.sku && <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "ui-monospace,monospace" }}>{r.sku}</div>}
                </td>
                <td style={{ padding: "10px 6px", whiteSpace: "nowrap" }}>{r.storeName ?? "—"}</td>
                <td style={{ padding: "10px 6px", fontSize: 12, color: "var(--muted)" }}>{r.variationsSummary || "—"}</td>
                <td style={{ padding: "10px 6px", textAlign: "right", fontWeight: 700 }}>{r.price ? `$${Number(r.price).toFixed(2)}` : "—"}</td>
                <td style={{ padding: "10px 6px", textAlign: "right" }}>{r.quantity ?? "—"}</td>
                <td style={{ padding: "10px 6px", whiteSpace: "nowrap", color: "var(--muted)" }}>{r.importedAt ? String(r.importedAt).slice(0, 10) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* IMPORT DRAWER (right-side modern panel) */}
      {impOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 60, display: "flex", justifyContent: "flex-end" }} onClick={() => !busy && setImpOpen(false)}>
          <div style={{ background: "#fff", width: 460, maxWidth: "94vw", height: "100%", padding: 24, overflowY: "auto", boxShadow: "-8px 0 24px rgba(16,24,40,.12)", animation: "slideIn .2s ease" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>Import Etsy CSV</div>
              <button onClick={() => setImpOpen(false)} style={{ border: "none", background: "#F3F4F6", borderRadius: 9, width: 30, height: 30, cursor: "pointer", fontSize: 16, color: "var(--muted)" }}>×</button>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 18, lineHeight: 1.5 }}>
              Etsy → Shop Manager → Settings → Options → <b>Download Data</b>. Import lại cùng file = cập nhật đè theo title.
            </div>

            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 6 }}>① Chọn store nhận listing</label>
            <select value={impStore} onChange={(e) => setImpStore(e.target.value)} style={{ ...ctl, width: "100%", marginBottom: 18 }}>
              {stores.length === 0 && <option value="">(Chưa có store Etsy)</option>}
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>

            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 6 }}>② Kéo thả file CSV</label>
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
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>{(impFile.size / 1024).toFixed(0)} KB · bấm để đổi file</div>
                </div>
              ) : (
                <div style={{ color: "var(--muted)" }}>
                  <div style={{ fontSize: 30, marginBottom: 6, color: drag ? "#F1641E" : "var(--muted)" }}>⬆</div>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--ink)" }}>Kéo file CSV vào đây</div>
                  <div style={{ fontSize: 12, marginTop: 3 }}>hoặc bấm để chọn · chỉ .csv</div>
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => pickFile(e.target.files?.[0])} />

            {impStore && impFile && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16, padding: "10px 12px", background: "#F8FAFF", borderRadius: 10, border: "1px solid #DCE6FB" }}>
                Sẽ import vào store <b style={{ color: "var(--ink)" }}>{storeName(impStore)}</b>.
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={ghost} disabled={busy} onClick={() => setImpOpen(false)}>Huỷ</button>
              <button style={{ ...pill("#F1641E", "#fff"), opacity: impFile && impStore && !busy ? 1 : .5 }} disabled={busy || !impFile || !impStore} onClick={doImport}>
                {busy ? "Đang import…" : "Import ngay"}
              </button>
            </div>
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
