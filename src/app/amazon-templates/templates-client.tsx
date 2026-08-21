"use client";

/**
 * Manage Templates · Amazon (v286, mở rộng v288)
 *
 * Template = BẢN KHAI đầy đủ của 1 loại sản phẩm trên Amazon, gồm 3 phần:
 *   1. Variations + giá  → sinh child SKU ({root}-{suffix}) cho customization + flat file listing
 *   2. Listing constants → brand / item type keyword / amazon product type / color... (flat file)
 *   3. Customization     → cấu trúc từ master .xlsx Seller Central (cột GIỮ NGUYÊN — Amazon cấm
 *      thêm/bớt cột), nhưng NỘI DUNG từng ô (label, instructions, required...) sửa được ở đây.
 */

import { useEffect, useRef, useState } from "react";
import { AmazonLogo } from "@/components/amazon-logo";

type Variation = { suffix: string; label: string; price: string };
type Tpl = { id: string; name: string; productType: string | null; fields: number; cols: number; skuSuffixes: string[]; variations: Variation[]; constants: Record<string, string>; updatedAt: string | null };
type Col = { i: number; key: string; label: string; value: string };
type Detail = { id: string; name: string; productType: string | null; variations: Variation[]; constants: Record<string, string>; cols: Col[]; skuCol: number; previewImageCol: number };

const AMZ = "#B5661A";
const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,.04)" };
const ctl: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 12, padding: "10px 13px", fontSize: 13.5, font: "inherit", background: "#fff", outline: "none" };
const pill = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 7, border: "none", background: bg, color: fg, borderRadius: 12, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" });
const lab: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 4 };
const secTitle: React.CSSProperties = { fontSize: 13, fontWeight: 800, color: AMZ, margin: "16px 0 8px" };

// Nhãn tiếng người cho các hằng số listing (thứ tự hiển thị cố định).
const CONSTANT_FIELDS: { key: string; label: string; hint: string }[] = [
  { key: "brand", label: "Brand", hint: "Talewix" },
  { key: "manufacturer", label: "Manufacturer", hint: "Talewix" },
  { key: "amazonProductType", label: "Amazon Product Type", hint: "DISPLAY_ALBUM" },
  { key: "itemTypeKeyword", label: "Item Type Keyword", hint: "baby-memory-books" },
  { key: "color", label: "Color", hint: "Multicolor" },
  { key: "colorMap", label: "Color Map", hint: "Multicolor" },
  { key: "numberOfItems", label: "Number of Items", hint: "1" },
];

export default function AmazonTemplatesClient({ canEdit }: { canEdit: boolean }) {
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [ptype, setPtype] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [edit, setEdit] = useState<Detail | null>(null);
  const [showAllCols, setShowAllCols] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const j = await fetch("/api/amazon-templates").then((r) => r.json());
      if (j.ok) setTpls(j.templates);
    } catch { /* offline */ }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  const flash = (m: string) => { setNote(m); setTimeout(() => setNote(""), 6000); };

  const upload = async () => {
    const f = fileRef.current?.files?.[0];
    if (!f) return flash("✗ Choose the master .xlsx first");
    if (!name.trim()) return flash("✗ Enter a template name");
    setBusy(true);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)) as number[]);
      const j = await fetch("/api/amazon-templates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), productType: ptype.trim(), xlsxBase64: btoa(bin) }),
      }).then((r) => r.json());
      if (j.ok) { flash(`✓ Imported — ${j.fields} customization field(s), ${j.cols} columns`); setName(""); setPtype(""); if (fileRef.current) fileRef.current.value = ""; load(); }
      else flash("✗ " + (j.error ?? "Import failed"));
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e)); }
    setBusy(false);
  };

  const openEdit = async (t: Tpl) => {
    setBusy(true);
    try {
      const j = await fetch(`/api/amazon-templates?id=${t.id}`).then((r) => r.json());
      if (j.ok) { setShowAllCols(false); setEdit(j.template); }
      else flash("✗ " + (j.error ?? "Load failed"));
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e)); }
    setBusy(false);
  };

  const saveEdit = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      // defaults dựng lại từ cols (đủ độ dài, đúng thứ tự cột)
      const width = edit.cols.length;
      const defaults = Array.from({ length: width }, (_, i) => edit.cols[i]?.value ?? "");
      const j = await fetch("/api/amazon-templates", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: edit.id, name: edit.name, productType: edit.productType ?? "",
          variations: edit.variations, constants: edit.constants, defaults,
        }),
      }).then((r) => r.json());
      if (j.ok) { flash("✓ Template saved"); setEdit(null); load(); }
      else flash("✗ " + (j.error ?? "Save failed"));
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e)); }
    setBusy(false);
  };

  const remove = async (t: Tpl) => {
    setBusy(true);
    try {
      const j = await fetch(`/api/amazon-templates?id=${t.id}`, { method: "DELETE" }).then((r) => r.json());
      if (j.ok) load(); else flash("✗ " + (j.error ?? "Delete failed"));
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e)); }
    setBusy(false);
  };

  // Các cột đáng sửa nhất: label / instructions / required. Còn lại ẩn sau "Show all".
  const isMainCol = (c: Col) => ["label", "instructions", "isRequired"].includes(c.key);

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "18px 16px" }}>
      <div style={{ ...card, padding: "16px 20px", marginBottom: 14, display: "flex", alignItems: "center", gap: 14 }}>
        <AmazonLogo size={46} />
        <div>
          <div style={{ fontSize: 21, fontWeight: 800 }}>Manage Templates · Amazon</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>
            One template per product family: variations + prices, listing constants, and the customization file. Edit everything here — Export in Manage Products Amazon uses it.
          </div>
        </div>
      </div>

      {note && <div style={{ ...card, padding: "10px 16px", marginBottom: 12, fontSize: 13, fontWeight: 600, color: note.startsWith("✓") ? "#1F6F45" : "#B42318" }}>{note}</div>}

      {canEdit && (
        <div style={{ ...card, padding: "14px 18px", marginBottom: 14 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: AMZ, marginBottom: 10 }}>Import master template (.xlsx from Seller Central)</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 200px" }}>
              <label style={lab}>Template name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Custom Pet Book" style={{ ...ctl, width: "100%" }} />
            </div>
            <div style={{ flex: "1 1 200px" }}>
              <label style={lab}>Match Product type (auto-assign, optional)</label>
              <input value={ptype} onChange={(e) => setPtype(e.target.value)} placeholder="e.g. Hardcover Photo Book" style={{ ...ctl, width: "100%" }} />
            </div>
            <div>
              <label style={lab}>Master .xlsx</label>
              <input ref={fileRef} type="file" accept=".xlsx" style={{ fontSize: 12.5 }} />
            </div>
            <button disabled={busy} onClick={upload} style={pill(AMZ, "#fff")}>{busy ? "Importing…" : "Import"}</button>
          </div>
        </div>
      )}

      <div style={{ ...card, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line)", textAlign: "left", color: "var(--muted)", fontSize: 11.5 }}>
              <th style={{ padding: 10 }}>NAME</th>
              <th style={{ padding: 10 }}>MATCH PRODUCT TYPE</th>
              <th style={{ padding: 10 }}>VARIATIONS · PRICE</th>
              <th style={{ padding: 10 }}>CONSTANTS</th>
              <th style={{ padding: 10 }}>CUSTOM FIELDS</th>
              <th style={{ padding: 10 }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 28, textAlign: "center", color: "var(--muted)" }}>Loading…</td></tr>
            ) : tpls.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 28, textAlign: "center", color: "var(--muted)" }}>No templates yet — run MIGRATION_v286 (seeds “Custom Child Book”) or import a master .xlsx above.</td></tr>
            ) : tpls.map((t) => (
              <tr key={t.id} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: 10, fontWeight: 700 }}>{t.name}</td>
                <td style={{ padding: 10 }}>{t.productType ?? <span style={{ color: "var(--muted)" }}>manual only</span>}</td>
                <td style={{ padding: 10, fontSize: 12 }}>
                  {(t.variations ?? []).map((v) => (
                    <div key={v.suffix} style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                      <code style={{ color: "#2563eb" }}>{v.suffix}</code>
                      <span style={{ color: "var(--muted)" }}>{v.label}</span>
                      <b>{v.price ? `$${v.price}` : "—"}</b>
                    </div>
                  ))}
                </td>
                <td style={{ padding: 10, fontSize: 11.5, color: "var(--muted)", maxWidth: 220 }}>
                  {t.constants?.brand ?? "—"} · {t.constants?.amazonProductType ?? "—"} · {t.constants?.itemTypeKeyword ?? "—"}
                </td>
                <td style={{ padding: 10 }}>{t.fields} fields · {t.cols} cols</td>
                <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                  <button disabled={busy} onClick={() => openEdit(t)} style={{ ...pill("#EEF1F5", "#333"), padding: "6px 14px", fontSize: 12 }}>Edit</button>{" "}
                  {canEdit && <button disabled={busy} onClick={() => remove(t)} style={{ ...pill("#fff", "#B42318"), border: "1px solid #F3C9C9", padding: "6px 10px", fontSize: 12 }}>Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 12, lineHeight: 1.6 }}>
        <b>Flow:</b> Manage Products Shopify → 🅰 Push to Amazon → Manage Products Amazon (AI copy + edit) → Export customization file (uses this template) → upload at Amazon Custom Products → Upload Customizations. Listings must be live with inventory first.
      </div>

      {/* ══ EDIT MODAL — Info · Variations+giá · Constants · Customization fields ══ */}
      {edit && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.5)", zIndex: 60, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "4vh 16px", overflow: "auto" }} onClick={() => !busy && setEdit(null)}>
          <div style={{ ...card, width: "min(880px, 100%)", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <b style={{ fontSize: 16, color: AMZ, display: "flex", alignItems: "center", gap: 8 }}><AmazonLogo size={22} /> Edit Amazon template</b>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
              <div><label style={lab}>Template name</label>
                <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} style={{ ...ctl, width: "100%" }} /></div>
              <div><label style={lab}>Match Product type (auto-assign)</label>
                <input value={edit.productType ?? ""} onChange={(e) => setEdit({ ...edit, productType: e.target.value })} placeholder="empty = manual assign only" style={{ ...ctl, width: "100%" }} /></div>
            </div>

            <div style={secTitle}>Variations & prices — one child SKU per row: {"{root}-{suffix}"}</div>
            {edit.variations.map((v, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "160px 1fr 120px 40px", gap: 8, marginBottom: 6 }}>
                <input value={v.suffix} onChange={(e) => { const a = [...edit.variations]; a[i] = { ...a[i], suffix: e.target.value }; setEdit({ ...edit, variations: a }); }} placeholder="8X8-AMZ" style={{ ...ctl, fontFamily: "monospace", fontSize: 12.5 }} />
                <input value={v.label} onChange={(e) => { const a = [...edit.variations]; a[i] = { ...a[i], label: e.target.value }; setEdit({ ...edit, variations: a }); }} placeholder={'Size label, e.g. 8"x8"'} style={ctl} />
                <input value={v.price} onChange={(e) => { const a = [...edit.variations]; a[i] = { ...a[i], price: e.target.value }; setEdit({ ...edit, variations: a }); }} placeholder="28.95" style={{ ...ctl, textAlign: "right" }} />
                <button onClick={() => setEdit({ ...edit, variations: edit.variations.filter((_, x) => x !== i) })} title="Remove variation" style={{ ...pill("#fff", "#B42318"), border: "1px solid #F3C9C9", padding: "6px 0", justifyContent: "center" }}>✕</button>
              </div>
            ))}
            <button onClick={() => setEdit({ ...edit, variations: [...edit.variations, { suffix: "", label: "", price: "" }] })} style={{ ...pill("#EEF1F5", "#333"), padding: "6px 12px", fontSize: 12 }}>+ Add variation</button>

            <div style={secTitle}>Listing constants — filled into the Amazon listing flat file</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              {CONSTANT_FIELDS.map((f) => (
                <div key={f.key}>
                  <label style={lab}>{f.label}</label>
                  <input value={edit.constants[f.key] ?? ""} onChange={(e) => setEdit({ ...edit, constants: { ...edit.constants, [f.key]: e.target.value } })} placeholder={f.hint} style={{ ...ctl, width: "100%" }} />
                </div>
              ))}
            </div>

            <div style={secTitle}>
              Customization fields — labels & instructions buyers see (columns are fixed by Amazon)
              <button onClick={() => setShowAllCols((v) => !v)} style={{ ...pill("#EEF1F5", "#333"), padding: "4px 10px", fontSize: 11, marginLeft: 10 }}>{showAllCols ? "Show main only" : "Show all columns"}</button>
            </div>
            <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid var(--line)", borderRadius: 10, padding: 10 }}>
              {edit.cols.filter((c) => c.i !== edit.skuCol && (showAllCols ? c.label : isMainCol(c) && c.label)).map((c) => (
                <div key={c.i} style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 11.5, color: "var(--muted)" }} title={c.key}>{c.label || c.key} <span style={{ opacity: .5 }}>#{c.i}</span></span>
                  <input value={c.value} onChange={(e) => { const cols = [...edit.cols]; cols[c.i] = { ...cols[c.i], value: e.target.value }; setEdit({ ...edit, cols }); }} style={{ ...ctl, width: "100%", fontSize: 12.5, padding: "7px 10px" }} />
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
              Seller Sku (#{edit.skuCol}) & Preview image (#{edit.previewImageCol}) are filled per product at export — no need to edit here.
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <button disabled={busy} onClick={() => setEdit(null)} style={pill("#EEF1F5", "#333")}>Cancel</button>
              {canEdit && <button disabled={busy} onClick={saveEdit} style={pill(AMZ, "#fff")}>{busy ? "Saving…" : "Save template"}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
