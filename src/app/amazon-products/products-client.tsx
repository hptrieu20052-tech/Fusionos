"use client";

/**
 * Manage Products · Amazon (v286)
 *
 * Bản STAGE riêng của từng listing (như flow Etsy → Shopify): "Push to Amazon" bên
 * Manage Products Shopify tạo bản ghi ở đây; hoàn thiện copy Amazon (AI title 150-200 +
 * 5 bullets + description) rồi Export file customization. Không đụng gì Shopify.
 */

import { useEffect, useMemo, useState } from "react";
import { AmazonLogo } from "@/components/amazon-logo";

type Row = {
  id: string; shopifyProductId: string | null;
  title: string | null; bullets: string[] | null; description: string | null;
  aiAt: string | null; status: string; asin: string | null; exportedAt: string | null;
  amazonTemplateId: string | null;
  sourceTitle: string; productType: string; sourceStatus: string;
  image: string; imageCount: number; srcVariantCount: number; skuRoot: string; storeName: string | null;
};
type Tpl = { id: string; name: string; productType: string | null; fields: number; skuSuffixes: string[]; variations?: { suffix: string; label: string; price: string }[] };

const AMZ = "#B5661A";
const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,.04)" };
const ctl: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 12, padding: "10px 13px", fontSize: 13.5, font: "inherit", background: "#fff", outline: "none" };
const pill = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 7, border: "none", background: bg, color: fg, borderRadius: 12, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" });
const lab: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 4 };
const chip = (bg: string, fg: string): React.CSSProperties => ({ fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: bg, color: fg });

const ago = (iso: string | null) => {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

async function postJSON(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

const titleOk = (t: string | null) => !!t && t.length >= 140 && t.length <= 200;
const bulletsOk = (b: string[] | null) => Array.isArray(b) && b.filter(Boolean).length === 5;
const descOk = (d: string | null) => !!d && d.length >= 600;
const readyOk = (r: Row) => titleOk(r.title) && bulletsOk(r.bullets) && descOk(r.description);

export default function AmazonProductsClient({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [prog, setProg] = useState("");
  const [edit, setEdit] = useState<Row | null>(null);
  const [aiModel, setAiModel] = useState("");
  const [aiModels, setAiModels] = useState<{ id: string; name: string }[]>([]);
  const [tplPick, setTplPick] = useState("");
  const [zoom, setZoom] = useState(""); // v291 · lightbox ảnh thumbnail
  const [confirmDel, setConfirmDel] = useState(""); // v294 · id đang chờ xác nhận xóa

  // Template khớp cho 1 sản phẩm: gán tay → khớp Product type → template duy nhất.
  const tplFor = (r: Row): Tpl | null => {
    if (r.amazonTemplateId) { const t = tpls.find((x) => x.id === r.amazonTemplateId); if (t) return t; }
    const pt = r.productType.trim().toLowerCase();
    if (pt) { const t = tpls.find((x) => (x.productType ?? "").trim().toLowerCase() === pt); if (t) return t; }
    return tpls.length === 1 ? tpls[0] : null;
  };
  const priceOf = (t: Tpl | null): string => {
    const ps = (t?.variations ?? []).map((v) => Number(v.price)).filter((n) => !isNaN(n) && n > 0);
    if (!ps.length) return "—";
    const lo = Math.min(...ps), hi = Math.max(...ps);
    return lo === hi ? `$${lo.toFixed(2)}` : `$${lo.toFixed(2)}–$${hi.toFixed(2)}`;
  };

  const load = async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        fetch("/api/amazon-products").then((r) => r.json()),
        fetch("/api/amazon-templates").then((r) => r.json()),
      ]);
      if (a.ok) setRows(a.rows);
      if (b.ok) { setTpls(b.templates); if (!tplPick && b.templates[0]) setTplPick(b.templates[0].id); }
    } catch { /* offline */ }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => {
    fetch("/api/books/models?type=text").then((r) => r.json()).then((j) => { if (Array.isArray(j?.models)) setAiModels(j.models); }).catch(() => { /* offline */ });
  }, []);

  const flash = (m: string) => { setNote(m); setTimeout(() => setNote(""), 6000); };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => (r.sourceTitle + " " + (r.title ?? "") + " " + r.skuRoot + " " + r.productType).toLowerCase().includes(s));
  }, [rows, q]);

  const toggleAll = () => setSel((p) => p.size === filtered.length ? new Set() : new Set(filtered.map((r) => r.id)));
  const toggle = (id: string) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // AI theo LÔ 6 — client tự chia, hiện tiến độ, gom con fail.
  const runAI = async (ids: string[]) => {
    if (!ids.length) return;
    setBusy(true);
    const failed: string[] = [];
    let done = 0;
    for (let i = 0; i < ids.length; i += 6) {
      const chunk = ids.slice(i, i + 6);
      setProg(`AI Amazon copy — ${done}/${ids.length}…`);
      try {
        const j = await postJSON("/api/amazon-products/ai", { ids: chunk, model: aiModel || undefined });
        for (const res of j?.results ?? []) if (!res.ok) failed.push(res.error ?? res.id);
      } catch { failed.push(...chunk); }
      done += chunk.length;
    }
    setProg("");
    setBusy(false);
    await load();
    flash(failed.length ? `✓ Done with ${failed.length} failed — first error: ${String(failed[0]).slice(0, 120)}` : `✓ AI copy written for ${ids.length} product(s)`);
  };

  const doExport = async () => {
    const ids = Array.from(sel);
    if (!ids.length || !tplPick) return;
    setBusy(true);
    try {
      const res = await fetch("/api/amazon-export/custom-file", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: tplPick, ids }),
      });
      if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.error ?? `HTTP ${res.status}`); }
      const n = res.headers.get("X-Rows") ?? "?";
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `amazon-customizations-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click(); URL.revokeObjectURL(a.href);
      flash(`✓ Exported ${n} SKU rows — upload it at Amazon → Custom Products → Upload Customizations (listings must be LIVE first)`);
      load();
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e)); }
    setBusy(false);
  };

  // v292 · FILE 1 — flat file listing (Add Products via Upload). Tạo Parent + Child theo template.
  const doExportListing = async () => {
    const ids = Array.from(sel);
    if (!ids.length) return;
    setBusy(true);
    try {
      const res = await fetch("/api/amazon-export/listing-file", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.error ?? `HTTP ${res.status}`); }
      const n = res.headers.get("X-Rows") ?? "?";
      const sk = Number(res.headers.get("X-Skipped") ?? 0);
      const skFirst = decodeURIComponent(res.headers.get("X-Skipped-First") ?? "");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `amazon-listings-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click(); URL.revokeObjectURL(a.href);
      flash(`✓ Listing file: ${n} rows (parent+child) — upload at Catalog → Add Products via Upload${sk ? ` · ${sk} skipped: ${skFirst}` : ""}`);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e)); }
    setBusy(false);
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/amazon-products?id=${id}`, { method: "DELETE" }).then((x) => x.json());
      if (r.ok) { setRows((p) => p.filter((x) => x.id !== id)); setSel((p) => { const n = new Set(p); n.delete(id); return n; }); }
      else flash("✗ " + (r.error ?? "Delete failed"));
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e)); }
    setBusy(false);
  };

  const saveEdit = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      const r = await fetch("/api/amazon-products", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: edit.id, title: edit.title ?? "", bullets: (edit.bullets ?? []).filter(Boolean), description: edit.description ?? "", asin: edit.asin ?? "" }),
      }).then((x) => x.json());
      if (r.ok) { flash("✓ Saved"); setEdit(null); load(); }
      else flash("✗ " + (r.error ?? "Save failed"));
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e)); }
    setBusy(false);
  };

  const aiOne = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      const j = await postJSON("/api/amazon-products/ai", { ids: [edit.id], model: aiModel || undefined });
      const r = j?.results?.[0];
      if (j.ok && r?.ok) {
        setEdit((p) => p ? { ...p, title: r.title ?? p.title, bullets: r.bullets ?? p.bullets, description: r.description ?? p.description, aiAt: new Date().toISOString() } : p);
        setRows((prev) => prev.map((x) => x.id === edit.id ? { ...x, title: r.title ?? x.title, bullets: r.bullets ?? x.bullets, description: r.description ?? x.description, aiAt: new Date().toISOString() } : x));
        flash("✓ AI copy generated & saved");
      } else flash("✗ " + (r?.error ?? j.error ?? "AI failed"));
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e)); }
    setBusy(false);
  };

  const stats = useMemo(() => ({
    total: rows.length,
    ready: rows.filter(readyOk).length,
    exported: rows.filter((r) => r.status === "EXPORTED" || r.status === "LIVE").length,
  }), [rows]);

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "18px 16px" }}>
      {/* Header */}
      <div style={{ ...card, padding: "16px 20px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <AmazonLogo size={46} />
          <div>
            <div style={{ fontSize: 21, fontWeight: 800 }}>Manage Products · Amazon</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>
              {stats.total} staged · {stats.ready} copy-ready · {stats.exported} exported · Push from Shopify → AI copy → Export customization
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button disabled={busy} onClick={load} style={{ ...pill("#EEF1F5", "#333"), padding: "8px 12px" }}>↻ Reload</button>
        </div>
      </div>

      {note && <div style={{ ...card, padding: "10px 16px", marginBottom: 12, fontSize: 13, fontWeight: 600, color: note.startsWith("✓") ? "#1F6F45" : "#B42318" }}>{note}</div>}
      {prog && <div style={{ ...card, padding: "10px 16px", marginBottom: 12, fontSize: 13, fontWeight: 600, color: AMZ }}>{prog}</div>}

      {/* Toolbar — 2 hàng: (1) tìm & chọn · (2) hành động theo nhóm AI | EXPORT */}
      <div style={{ ...card, padding: "12px 16px", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title / SKU / type" style={{ ...ctl, flex: "1 1 260px" }} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: sel.size ? "#1F6F45" : "var(--muted)", whiteSpace: "nowrap" }}>{sel.size} selected</span>
          <button onClick={toggleAll} style={{ ...pill("#EEF1F5", "#333"), padding: "8px 12px" }}>{sel.size === filtered.length && filtered.length ? "Clear" : `Select all ${filtered.length}`}</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
          {/* Nhóm AI */}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .6, color: "var(--muted)" }}>AI</span>
            <select value={aiModel} onChange={(e) => setAiModel(e.target.value)} title="AI model for Amazon copy" style={{ ...ctl, padding: "8px 10px", fontSize: 12.5, maxWidth: 170 }}>
              <option value="">Model: Default</option>
              {aiModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {canEdit && (
              <button disabled={busy || !sel.size} onClick={() => runAI(Array.from(sel))} style={{ ...pill("#5B3FBF", "#fff"), opacity: busy || !sel.size ? .45 : 1 }}>✦ AI Amazon copy{sel.size ? ` (${sel.size})` : ""}</button>
            )}
          </span>
          <span style={{ width: 1, alignSelf: "stretch", background: "var(--line)" }} />
          {/* Nhóm Export — File 1 trước (tạo listing), File 2 sau (khi listing LIVE) */}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .6, color: "var(--muted)" }}>EXPORT</span>
            <select value={tplPick} onChange={(e) => setTplPick(e.target.value)} title="Amazon customization template (Manage Templates Amazon)" style={{ ...ctl, padding: "8px 10px", fontSize: 12.5, maxWidth: 200 }}>
              {tpls.length === 0 && <option value="">No template — create one first</option>}
              {tpls.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button disabled={busy || !sel.size} onClick={doExportListing} title="STEP 1 — Generate the listing flat file (parent + child rows with title, bullets, images, prices from the template). Upload at Catalog → Add Products via Upload. Products missing copy/images/prices are skipped." style={{ ...pill("#1F6F45", "#fff"), opacity: busy || !sel.size ? .45 : 1 }}>⬇ 1 · Listing file{sel.size ? ` (${sel.size})` : ""}</button>
            <button disabled={busy || !sel.size || !tplPick} onClick={doExport} title="STEP 2 — Generate the customization .xlsx. Upload at Custom Products → Upload Customizations. Listings must be LIVE with inventory first." style={{ ...pill("#FF9900", "#111"), opacity: busy || !sel.size || !tplPick ? .45 : 1 }}>⬇ 2 · Customization{sel.size ? ` (${sel.size})` : ""}</button>
          </span>
        </div>
      </div>

      {/* Table */}
      <div style={{ ...card, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line)", textAlign: "left", color: "var(--muted)", fontSize: 11.5 }}>
              <th style={{ padding: 10 }}><input type="checkbox" checked={!!filtered.length && sel.size === filtered.length} onChange={toggleAll} /></th>
              <th style={{ padding: 10 }}>IMAGE</th>
              <th style={{ padding: 10 }}>TITLE</th>
              <th style={{ padding: 10 }}>AMAZON COPY</th>
              <th style={{ padding: 10 }}>SKU ROOT</th>
              <th style={{ padding: 10 }}>TYPE</th>
              <th style={{ padding: 10 }}>TEMPLATE</th>
              <th style={{ padding: 10 }}>PRICE</th>
              <th style={{ padding: 10 }}>STATUS</th>
              <th style={{ padding: 10 }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ padding: 28, textAlign: "center", color: "var(--muted)" }}>Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={10} style={{ padding: 28, textAlign: "center", color: "var(--muted)" }}>
                Nothing staged yet — open <b>Manage Products Shopify</b>, select listings and hit <b>🅰 Push to Amazon</b>.
              </td></tr>
            ) : filtered.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: 10 }}><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td style={{ padding: 10 }}>
                  {/* v291 · click ảnh → phóng to (lightbox) */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {r.image ? <img src={r.image + (r.image.includes("?") ? "&" : "?") + "width=96"} alt="" onClick={() => setZoom(r.image)} style={{ width: 46, height: 46, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)", cursor: "zoom-in" }} /> : <span style={{ color: "var(--muted)" }}>—</span>}
                </td>
                <td style={{ padding: 10, maxWidth: 340 }}>
                  {/* v291 · click title → mở detail (modal edit) */}
                  <div onClick={() => setEdit({ ...r, bullets: r.bullets ? [...r.bullets] : null })} title="Open Amazon listing detail"
                    style={{ fontWeight: 700, color: "#1D4ED8", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                    {r.title || r.sourceTitle}
                  </div>
                  {/* v294 · dòng info như bên Shopify: variants nguồn · ảnh · variations Amazon */}
                  {(() => { const t = tplFor(r); const vs = t?.variations ?? []; return (
                    <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>
                      {r.srcVariantCount} variants · {r.imageCount} images{vs.length ? <> · Amazon: {vs.length} sizes ({vs.map((v) => v.label || v.suffix).join(", ")})</> : null}
                    </div>
                  ); })()}
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{r.storeName ?? ""}{r.sourceStatus ? ` · ${r.sourceStatus}` : ""}{r.title ? " · source: " + r.sourceTitle.slice(0, 40) + (r.sourceTitle.length > 40 ? "…" : "") : ""}</div>
                </td>
                <td style={{ padding: 10 }}>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    <span title={r.title ? `${r.title.length} chars` : "No Amazon title yet"} style={chip(titleOk(r.title) ? "#E9F7EF" : "#F1F1F4", titleOk(r.title) ? "#1F6F45" : "#8794A5")}>title {r.title ? r.title.length : "—"}</span>
                    <span title="5 bullet points" style={chip(bulletsOk(r.bullets) ? "#E9F7EF" : "#F1F1F4", bulletsOk(r.bullets) ? "#1F6F45" : "#8794A5")}>bullets {(r.bullets ?? []).filter(Boolean).length}/5</span>
                    <span title={r.description ? `${r.description.length} chars` : "No description yet"} style={chip(descOk(r.description) ? "#E9F7EF" : "#F1F1F4", descOk(r.description) ? "#1F6F45" : "#8794A5")}>desc {r.description ? r.description.length : "—"}</span>
                  </div>
                  {r.aiAt && <div style={{ fontSize: 10.5, color: "#5B3FBF", fontWeight: 700, marginTop: 3 }}>✦ {ago(r.aiAt)}</div>}
                </td>
                <td style={{ padding: 10, fontFamily: "monospace", fontSize: 12 }}>{r.skuRoot || <span style={{ color: "#B42318" }}>no SKU</span>}</td>
                <td style={{ padding: 10, fontSize: 12 }}>{r.productType || "—"}</td>
                {/* v291 · template khớp + giá lấy từ variations của template */}
                <td style={{ padding: 10, fontSize: 12 }}>
                  {(() => { const t = tplFor(r); return t
                    ? <span title={`${(t.variations ?? []).length} variations`} style={chip("#FFF0DB", "#B5661A")}>📌 {t.name.length > 18 ? t.name.slice(0, 18) + "…" : t.name}</span>
                    : <span title="No template matches this Product type — assign one in Manage Templates Amazon" style={{ color: "#B42318", fontSize: 11.5, fontWeight: 700 }}>none</span>; })()}
                </td>
                <td style={{ padding: 10, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}>{priceOf(tplFor(r))}</td>
                <td style={{ padding: 10 }}>
                  <span style={chip(r.status === "LIVE" ? "#E9F7EF" : r.status === "EXPORTED" ? "#FFF0DB" : "#F1F1F4", r.status === "LIVE" ? "#1F6F45" : r.status === "EXPORTED" ? "#B5661A" : "#8794A5")}>{r.status}</span>
                  {r.asin && <div style={{ fontSize: 10.5, fontFamily: "monospace", marginTop: 2 }}>{r.asin}</div>}
                </td>
                <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                  {/* v294 · Edit = click title. Delete = icon thùng rác + BƯỚC XÁC NHẬN inline. */}
                  {canEdit && (confirmDel === r.id ? (
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <button disabled={busy} onClick={() => { setConfirmDel(""); remove(r.id); }} style={{ ...pill("#B42318", "#fff"), padding: "6px 12px", fontSize: 12 }}>Delete?</button>
                      <button disabled={busy} onClick={() => setConfirmDel("")} style={{ ...pill("#EEF1F5", "#333"), padding: "6px 10px", fontSize: 12 }}>Cancel</button>
                    </span>
                  ) : (
                    <button disabled={busy} onClick={() => setConfirmDel(r.id)} title="Remove from Manage Products Amazon (Shopify is untouched)" style={{ ...pill("#fff", "#B42318"), border: "1px solid #F3C9C9", padding: "6px 10px", fontSize: 13 }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* v291 · Lightbox ảnh */}
      {zoom && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.75)", zIndex: 3100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, cursor: "zoom-out" }} onClick={() => setZoom("")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom + (zoom.includes("?") ? "&" : "?") + "width=1200"} alt="" style={{ maxWidth: "92vw", maxHeight: "92vh", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,.4)" }} />
        </div>
      )}

      {/* Edit modal */}
      {edit && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,.5)", zIndex: 3000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "4vh 16px", overflow: "auto" }} onClick={() => !busy && setEdit(null)}>
          <div style={{ ...card, width: "min(860px, 100%)", padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
              <b style={{ fontSize: 18, display: "flex", alignItems: "center", gap: 10 }}><AmazonLogo size={24} /> Amazon listing copy</b>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{edit.aiAt ? `AI written ${ago(edit.aiAt)}` : "never generated"}</div>
            </div>
            {/* Ngữ cảnh listing nguồn: ảnh + title + SKU — nhìn phát biết đang viết cho cuốn nào */}
            <div style={{ display: "flex", gap: 12, alignItems: "center", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", marginBottom: 14, background: "#FAFBFC" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {edit.image && <img src={edit.image + (edit.image.includes("?") ? "&" : "?") + "width=120"} alt="" style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} />}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{edit.sourceTitle}</div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}><code>{edit.skuRoot || "no SKU"}</code> · {edit.productType || "—"} · {edit.status}</div>
              </div>
            </div>

            <label style={lab}>Amazon title <span style={{ fontWeight: 700, color: (edit.title ?? "").length > 0 && !titleOk(edit.title) ? "var(--red)" : "var(--muted)" }}>({(edit.title ?? "").length}/200 · target 150-200)</span></label>
            <textarea value={edit.title ?? ""} onChange={(e) => setEdit({ ...edit, title: e.target.value })} maxLength={250} rows={2} placeholder="Personalized <what>, Custom Name <type>, <occasion keywords>, Keepsake Gift — no size, no emojis" style={{ ...ctl, width: "100%", resize: "vertical", marginBottom: 10 }} />

            <label style={lab}>Bullet points (5 · About this item)</label>
            {Array.from({ length: 5 }, (_, i) => (
              <textarea key={i} value={(edit.bullets ?? [])[i] ?? ""}
                onChange={(e) => { const b = [...(edit.bullets ?? ["", "", "", "", ""])]; while (b.length < 5) b.push(""); b[i] = e.target.value; setEdit({ ...edit, bullets: b }); }}
                maxLength={300} rows={2} placeholder={`Bullet ${i + 1} — ALL-CAPS HOOK — then the benefit (150-230 chars)`}
                style={{ ...ctl, width: "100%", resize: "vertical", marginBottom: 6, fontSize: 12.5 }} />
            ))}

            <label style={{ ...lab, marginTop: 6 }}>Amazon description <span style={{ fontWeight: 700, color: (edit.description ?? "").length > 0 && ((edit.description ?? "").length < 900 || (edit.description ?? "").length > 1500) ? "var(--red)" : "var(--muted)" }}>({(edit.description ?? "").length} chars · target 900-1500)</span></label>
            <textarea value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} rows={7} placeholder="Plain text, 3-4 paragraphs separated by a blank line — Amazon does not render HTML" style={{ ...ctl, width: "100%", resize: "vertical", marginBottom: 10 }} />

            <label style={lab}>ASIN (once live on Amazon)</label>
            <input value={edit.asin ?? ""} onChange={(e) => setEdit({ ...edit, asin: e.target.value })} placeholder="B0XXXXXXXX" style={{ ...ctl, width: 220, marginBottom: 14, fontFamily: "monospace" }} />

            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {canEdit && <button disabled={busy} onClick={aiOne} style={pill("#5B3FBF", "#fff")}>{busy ? "Working…" : "✦ AI Amazon copy"}</button>}
              {canEdit && <button disabled={busy} onClick={saveEdit} style={pill(AMZ, "#fff")}>Save</button>}
              <button disabled={busy} onClick={() => setEdit(null)} style={pill("#EEF1F5", "#333")}>Close</button>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>Amazon only — nothing here is ever sent to Shopify.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
