"use client";

/**
 * Manage Templates · Amazon (v286 → v290: style đồng bộ Manage Templates Shopify)
 *
 * Template = BẢN KHAI đầy đủ của 1 loại sản phẩm trên Amazon:
 *   1. Variations + giá  → sinh child SKU ({root}-{suffix})
 *   2. Listing constants → brand / item type keyword / amazon product type... (flat file)
 *   3. Customization     → cột GIỮ NGUYÊN theo file Amazon (cấm thêm/bớt cột), nội dung
 *      (label / instructions / required / options) sửa được — GOM THEO FIELD như Custom options.
 */

import { useEffect, useRef, useState } from "react";
import { AmazonLogo } from "@/components/amazon-logo";

type Variation = { suffix: string; label: string; price: string };
type Tpl = { id: string; name: string; productType: string | null; fields: number; cols: number; skuSuffixes: string[]; variations: Variation[]; constants: Record<string, string>; thumbUrl: string | null; updatedAt: string | null };
type Col = { i: number; key: string; label: string; h1: string; value: string };
type Detail = { id: string; name: string; productType: string | null; variations: Variation[]; constants: Record<string, string>; cols: Col[]; skuCol: number; previewImageCol: number; aiBrief: string };

// ── Gom cột theo FIELD (dựa dòng header 1 của file Amazon) ────────────────────
// "Surface 1:" / "Option Dropdown 2:" / "Data (Text...) 1:" / "Image 1:" = MỞ field mới;
// "option:" / "TextInputComponent:" / "ImageInputComponent:" = cột con của field đang mở.
type FieldGroup = { name: string; type: "surface" | "dropdown" | "text" | "image" | "other"; cols: Col[] };
function groupCols(cols: Col[], skuCol: number): FieldGroup[] {
  const groups: FieldGroup[] = [];
  let cur: FieldGroup | null = null;
  for (const c of cols) {
    if (c.i === skuCol) continue; // Seller Sku — điền tự động lúc export
    const h = c.h1 ?? "";
    const isStart = h && !/^(option:|TextInputComponent|ImageInputComponent)/i.test(h) && !/:en_US$/i.test(h);
    if (isStart) {
      const name = h.split(":")[0].trim();
      const type: FieldGroup["type"] = /^surface/i.test(name) ? "surface" : /dropdown/i.test(name) ? "dropdown" : /^image/i.test(name) ? "image" : /^(data|text)/i.test(name) ? "text" : "other";
      cur = { name, type, cols: [] };
      groups.push(cur);
    }
    if (!cur) { cur = { name: "Other", type: "other", cols: [] }; groups.push(cur); }
    if (c.label) cur.cols.push(c); // chỉ hiện cột có nhãn người đọc
  }
  return groups.filter((g) => g.cols.length);
}
const TYPE_META: Record<FieldGroup["type"], { label: string; color: string; bg: string }> = {
  surface: { label: "Surface", color: "#0E7490", bg: "#F0FAFB" },
  dropdown: { label: "Dropdown", color: "#7C3AED", bg: "#F7F4FF" },
  text: { label: "Text box", color: "#2563EB", bg: "#F4F8FF" },
  image: { label: "Photo upload", color: "#059669", bg: "#F2FBF7" },
  other: { label: "Other", color: "#6B7280", bg: "#F8F9FA" },
};
// Tên field hiển thị = giá trị ô "label" đầu tiên trong nhóm (vd "Book Cover", "Paper Finish").
const groupTitle = (g: FieldGroup) => g.cols.find((c) => c.key === "label")?.value || g.name;

const AMZ = "#B5661A";
const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,.04)" };
const ctl: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 12, padding: "10px 13px", fontSize: 13.5, font: "inherit", background: "#fff", outline: "none" };
const pill = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 7, border: "none", background: bg, color: fg, borderRadius: 12, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" });
const ghostRed: React.CSSProperties = { ...pill("#fff", "#E5484D"), border: "1px solid #F3C9C9" };
const ghostGray: React.CSSProperties = { ...pill("#fff", "#333"), border: "1px solid var(--line)" };
const lab: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 700, color: "#1F2733", marginBottom: 6 };

const CONSTANT_FIELDS: { key: string; label: string; hint: string }[] = [
  { key: "brand", label: "Brand", hint: "Talewix" },
  { key: "manufacturer", label: "Manufacturer", hint: "Talewix" },
  { key: "amazonProductType", label: "Amazon Product Type", hint: "DISPLAY_ALBUM" },
  { key: "itemTypeKeyword", label: "Item Type Keyword", hint: "baby-memory-books" },
  { key: "color", label: "Color", hint: "Multicolor" },
  { key: "colorMap", label: "Color Map", hint: "Multicolor" },
  { key: "numberOfItems", label: "Number of Items", hint: "1" },
  // v292 · dùng cho flat file listing (File 1)
  { key: "quantity", label: "Inventory Quantity", hint: "100" },
  { key: "leadTimeDays", label: "Handling Time (days)", hint: "4" },
  // v329 · tên Shipping Template trên Seller Central → đẩy merchant_shipping_group khi Push
  { key: "shippingTemplate", label: "Shipping Template (Seller Central)", hint: "Talewix Books US" },
  { key: "countryOfOrigin", label: "Country of Origin", hint: "United States" },
  // v301 · field bắt buộc DISPLAY_ALBUM
  { key: "includedComponents", label: "Included Components", hint: "1 personalized hardcover book" },
  { key: "numberOfBoxes", label: "Number of Boxes", hint: "1" },
  { key: "cpsiaWarning", label: "CPSIA Warning", hint: "NoWarningApplicable" },
];

export default function AmazonTemplatesClient({ canEdit }: { canEdit: boolean }) {
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [name, setName] = useState("");
  const [ptype, setPtype] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [edit, setEdit] = useState<Detail | null>(null);

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
      if (j.ok) { flash(`✓ Imported — ${j.fields} customization field(s)`); setName(""); setPtype(""); if (fileRef.current) fileRef.current.value = ""; setImportOpen(false); load(); }
      else flash("✗ " + (j.error ?? "Import failed"));
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e)); }
    setBusy(false);
  };

  const openEdit = async (t: Tpl) => {
    setBusy(true);
    try {
      const j = await fetch(`/api/amazon-templates?id=${t.id}`).then((r) => r.json());
      if (j.ok) setEdit(j.template);
      else flash("✗ " + (j.error ?? "Load failed"));
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e)); }
    setBusy(false);
  };

  const saveEdit = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      const j = await fetch("/api/amazon-templates", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: edit.id, name: edit.name, productType: edit.productType ?? "", variations: edit.variations, constants: edit.constants, aiBrief: edit.aiBrief ?? "" }),
      }).then((r) => r.json());
      if (j.ok) { flash("✓ Template saved"); setEdit(null); load(); }
      else flash("✗ " + (j.error ?? "Save failed"));
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e)); }
    setBusy(false);
  };

  // v291 · Update master file — upload .xlsx generate lại từ Seller Central, thay phần customization.
  const masterRef = useRef<HTMLInputElement>(null);
  const [showCust, setShowCust] = useState(false); // v302 · mở rộng chi tiết field customization
  const [custFileName, setCustFileName] = useState(""); // tên file đã chọn để update
  const updateMaster = async () => {
    const f = masterRef.current?.files?.[0];
    if (!edit || !f) return flash("✗ Choose the new .xlsx first");
    setBusy(true);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)) as number[]);
      const j = await fetch("/api/amazon-templates", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: edit.id, xlsxBase64: btoa(bin) }),
      }).then((r) => r.json());
      if (j.ok) {
        flash("✓ Master file updated");
        // nạp lại chi tiết để hiện bộ field mới
        const d = await fetch(`/api/amazon-templates?id=${edit.id}`).then((r) => r.json());
        if (d.ok) setEdit(d.template);
        if (masterRef.current) masterRef.current.value = "";
        load();
      } else flash("✗ " + (j.error ?? "Update failed"));
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

  const groups = edit ? groupCols(edit.cols, edit.skuCol) : [];

  return (
    <div style={{ maxWidth: 1160, margin: "0 auto", padding: "18px 16px" }}>
      {/* Header — đồng bộ Manage Templates Shopify */}
      <div style={{ ...card, padding: "16px 22px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <AmazonLogo size={46} />
          <div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>Manage Templates · Amazon</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{tpls.length} template{tpls.length !== 1 ? "s" : ""}</div>
          </div>
        </div>
        {canEdit && (
          <button onClick={() => setImportOpen(true)} style={pill(AMZ, "#fff")}>+ From Seller Central (.xlsx)</button>
        )}
      </div>

      {note && <div style={{ ...card, padding: "10px 16px", marginBottom: 12, fontSize: 13, fontWeight: 600, color: note.startsWith("✓") ? "#1F6F45" : "#B42318" }}>{note}</div>}

      {/* Danh sách — card từng template như Shopify Templates */}
      {loading ? (
        <div style={{ ...card, padding: 28, textAlign: "center", color: "var(--muted)" }}>Loading…</div>
      ) : tpls.length === 0 ? (
        <div style={{ ...card, padding: 28, textAlign: "center", color: "var(--muted)" }}>No templates yet — run MIGRATION_v286 (seeds “Custom Child Book”) or import a master .xlsx.</div>
      ) : tpls.map((t) => (
        <div key={t.id} style={{ ...card, padding: "14px 18px", marginBottom: 12, display: "flex", alignItems: "center", gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {t.thumbUrl
            ? <img src={t.thumbUrl} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 10, border: "1px solid var(--line)", flexShrink: 0 }} />
            : <span style={{ width: 64, height: 64, borderRadius: 10, border: "1px solid var(--line)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><AmazonLogo size={34} /></span>}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* v293 · click title = mở Edit (đồng bộ với Shopify Templates) */}
            <div onClick={() => openEdit(t)} title="Edit template" style={{ fontSize: 16.5, fontWeight: 800, color: "#1D4ED8", cursor: "pointer", display: "inline-block" }}>{t.name}</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 3 }}>
              {t.productType ?? "manual assign"} · {t.variations.length} variation{t.variations.length !== 1 ? "s" : ""} ({t.variations.map((v) => v.label || v.suffix).join(", ")}) · {t.fields} custom fields
              {t.variations.some((v) => v.price) && <> · ${t.variations.map((v) => v.price).filter(Boolean).join(" / $")}</>}
              {" · "}{t.constants?.brand ?? "—"} · {t.constants?.amazonProductType ?? "—"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            {canEdit && <button disabled={busy} onClick={() => remove(t)} style={ghostRed}>Delete</button>}
          </div>
        </div>
      ))}

      {/* ══ IMPORT MODAL ══ */}
      {importOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !busy && setImportOpen(false)}>
          <div style={{ ...card, width: "min(520px, 100%)", padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <b style={{ fontSize: 18 }}>Import master template</b>
              <button onClick={() => setImportOpen(false)} style={{ border: 0, background: "none", fontSize: 20, cursor: "pointer", color: "var(--muted)" }}>✕</button>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 16 }}>
              File .xlsx generate từ Seller Central: build customization trên 1 ASIN → Generate template → download.
            </div>
            <label style={lab}>Template name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Custom Pet Book" style={{ ...ctl, width: "100%", marginBottom: 12 }} />
            <label style={lab}>Match Product type (auto-assign, optional)</label>
            <input value={ptype} onChange={(e) => setPtype(e.target.value)} placeholder="e.g. Hardcover Photo Book" style={{ ...ctl, width: "100%", marginBottom: 12 }} />
            <label style={lab}>Master .xlsx</label>
            <input ref={fileRef} type="file" accept=".xlsx" style={{ fontSize: 13, marginBottom: 18 }} />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button disabled={busy} onClick={() => setImportOpen(false)} style={ghostGray}>Cancel</button>
              <button disabled={busy} onClick={upload} style={pill(AMZ, "#fff")}>{busy ? "Importing…" : "Import"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ EDIT MODAL — bố cục như Edit template Shopify ══ */}
      {edit && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.5)", zIndex: 3000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "3vh 16px", overflow: "auto" }} onClick={() => !busy && setEdit(null)}>
          <div style={{ ...card, width: "min(940px, 100%)", padding: 26 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <b style={{ fontSize: 20, display: "flex", alignItems: "center", gap: 10 }}><AmazonLogo size={26} /> Edit template</b>
              <button onClick={() => setEdit(null)} style={{ border: 0, background: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)" }}>✕</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>
              <div><label style={lab}>Template name</label>
                <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} style={{ ...ctl, width: "100%" }} /></div>
              <div><label style={lab}>Match Product type (auto-assign)</label>
                <input value={edit.productType ?? ""} onChange={(e) => setEdit({ ...edit, productType: e.target.value })} placeholder="(manual assign only)" style={{ ...ctl, width: "100%" }} /></div>
            </div>

            {/* Variations — bảng như Variants của Shopify */}
            <label style={lab}>Variations ({edit.variations.length}) — child SKU = {"{root}-{suffix}"}</label>
            <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden", marginBottom: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#F8F9FB", color: "var(--muted)", fontSize: 11.5, textAlign: "left" }}>
                    <th style={{ padding: "9px 12px" }}>SKU SUFFIX</th>
                    <th style={{ padding: "9px 12px" }}>SIZE / LABEL</th>
                    <th style={{ padding: "9px 12px", width: 130 }}>PRICE ($)</th>
                    <th style={{ width: 50 }} />
                  </tr>
                </thead>
                <tbody>
                  {edit.variations.map((v, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                      <td style={{ padding: 7 }}><input value={v.suffix} onChange={(e) => { const a = [...edit.variations]; a[i] = { ...a[i], suffix: e.target.value }; setEdit({ ...edit, variations: a }); }} placeholder="8X8-AMZ" style={{ ...ctl, width: "100%", fontFamily: "monospace", fontSize: 12.5, padding: "8px 10px" }} /></td>
                      <td style={{ padding: 7 }}><input value={v.label} onChange={(e) => { const a = [...edit.variations]; a[i] = { ...a[i], label: e.target.value }; setEdit({ ...edit, variations: a }); }} placeholder={'8"x8"'} style={{ ...ctl, width: "100%", padding: "8px 10px" }} /></td>
                      <td style={{ padding: 7 }}><input value={v.price} onChange={(e) => { const a = [...edit.variations]; a[i] = { ...a[i], price: e.target.value }; setEdit({ ...edit, variations: a }); }} placeholder="28.95" style={{ ...ctl, width: "100%", textAlign: "right", padding: "8px 10px" }} /></td>
                      <td style={{ textAlign: "center" }}><button onClick={() => setEdit({ ...edit, variations: edit.variations.filter((_, x) => x !== i) })} title="Remove" style={{ border: 0, background: "none", color: "#E5484D", fontSize: 15, cursor: "pointer" }}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={() => setEdit({ ...edit, variations: [...edit.variations, { suffix: "", label: "", price: "" }] })} style={{ ...ghostGray, padding: "7px 14px", fontSize: 12.5, marginBottom: 18 }}>+ Add variation</button>

            {/* v359 · AI product brief — mô tả sản phẩm cho AI viết đúng loại */}
            <label style={lab}>AI product brief — what this product actually IS (guides the AI so it doesn&apos;t guess from Shopify tags)</label>
            <textarea value={edit.aiBrief ?? ""} onChange={(e) => setEdit({ ...edit, aiBrief: e.target.value })} rows={6}
              placeholder={"e.g. A finished PERSONALIZED ILLUSTRATED STORYBOOK to be READ. NOT a blank photo album, NOT a coloring/activity book, NOT a toy. Hardcover, 24+ full-color illustrated pages, premium 100lb paper. Sizes 8x8 and 11x8.5 (never in the title). Emphasize the story, the child as the hero, the name on the cover, keepsake quality."}
              style={{ ...ctl, width: "100%", resize: "vertical", fontSize: 12.5, lineHeight: 1.5, marginBottom: 4 }} />
            <div style={{ fontSize: 10.5, color: "var(--muted)", marginBottom: 18 }}>Áp cho MỌI listing dùng template này. AI coi đây là sự thật sản phẩm, ưu tiên hơn tag Shopify — giảm sai loại &amp; bị Amazon đổi sang BLANK_BOOK.</div>

            {/* Listing constants */}
            <label style={lab}>Listing constants — filled into the Amazon flat file</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 18 }}>
              {CONSTANT_FIELDS.map((f) => (
                <div key={f.key}>
                  <label style={{ ...lab, fontSize: 11.5, color: "var(--muted)" }}>{f.label}</label>
                  <input value={edit.constants[f.key] ?? ""} onChange={(e) => setEdit({ ...edit, constants: { ...edit.constants, [f.key]: e.target.value } })} placeholder={f.hint} style={{ ...ctl, width: "100%" }} />
                  {f.key === "shippingTemplate" && <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 3 }}>Exact template NAME from Seller Central (e.g. Talewix Books US) — not an ID.</div>}
                </div>
              ))}
            </div>

            {/* v302 · Customization — GỌN: 1 dòng tóm tắt + chip tên field, bấm để bung chi tiết.
                Nguồn chuẩn là template Seller Central → chỉ đọc, đổi bằng "Update file". */}
            <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "14px 16px", marginBottom: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                <b style={{ fontSize: 13.5 }}>Customization <span style={{ fontWeight: 600, color: "var(--muted)", fontSize: 12 }}>· {groups.length} fields from Seller Central · read-only</span></b>
                <button onClick={() => setShowCust((v) => !v)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "#1D4ED8", padding: 0 }}>{showCust ? "Hide details" : "Show details"}</button>
              </div>

              {/* Chip tóm tắt các field */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: showCust ? 12 : 4 }}>
                {groups.map((g, gi) => {
                  const meta = TYPE_META[g.type];
                  const req = g.cols.find((c) => /required/i.test(c.key));
                  const isReq = req && /^true$/i.test(req.value);
                  return (
                    <span key={gi} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999, background: meta.bg, color: meta.color }}>
                      {groupTitle(g)}{isReq ? <span style={{ color: "#B42318", fontSize: 10, fontWeight: 800 }}>*</span> : null}
                    </span>
                  );
                })}
              </div>

              {/* Chi tiết đầy đủ — chỉ hiện khi bung */}
              {showCust && groups.map((g, gi) => {
                const meta = TYPE_META[g.type];
                const req = g.cols.find((c) => /required/i.test(c.key));
                const opts = g.type === "dropdown" ? g.cols.filter((c) => c.key === "label").slice(1).map((c) => c.value).filter(Boolean) : [];
                const instr = g.cols.find((c) => c.key === "instructions")?.value ?? "";
                return (
                  <div key={gi} style={{ background: "#FAFBFC", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 14px", marginBottom: 6, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 9px", borderRadius: 999, background: meta.bg, color: meta.color, flexShrink: 0 }}>{meta.label}</span>
                    <b style={{ fontSize: 13 }}>{groupTitle(g)}</b>
                    {req && <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 8px", borderRadius: 999, background: /^true$/i.test(req.value) ? "#FEF0F0" : "#F1F1F4", color: /^true$/i.test(req.value) ? "#B42318" : "#8794A5" }}>{/^true$/i.test(req.value) ? "required" : "optional"}</span>}
                    {opts.length > 0 && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>· {opts.join(" / ")}</span>}
                    {instr && <span style={{ fontSize: 11.5, color: "var(--muted)", flexBasis: "100%", paddingLeft: 2 }}>{instr.slice(0, 110)}{instr.length > 110 ? "…" : ""}</span>}
                  </div>
                );
              })}

              {/* Update file — dropzone hiện đại */}
              <div
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f && masterRef.current) { const dt = new DataTransfer(); dt.items.add(f); masterRef.current.files = dt.files; setCustFileName(f.name); } }}
                onClick={() => masterRef.current?.click()}
                style={{ marginTop: 10, border: "1.5px dashed var(--line)", borderRadius: 12, padding: "14px 16px", background: "#FAFBFC", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 38, height: 38, borderRadius: 10, background: "#FFF0DB", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={AMZ} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="M7 8l5-5 5 5" /><path d="M5 21h14" /></svg>
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{custFileName || "Update customization file"}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{custFileName ? "Ready — click Update to apply" : "Drop or click to choose the .xlsx regenerated on Seller Central"}</div>
                </div>
                <input ref={masterRef} type="file" accept=".xlsx" style={{ display: "none" }} onChange={(e) => setCustFileName(e.target.files?.[0]?.name ?? "")} />
                <button disabled={busy || !custFileName} onClick={(e) => { e.stopPropagation(); updateMaster().then(() => setCustFileName("")); }}
                  style={{ ...pill(AMZ, "#fff"), padding: "8px 16px", opacity: busy || !custFileName ? .45 : 1, flexShrink: 0 }}>Update</button>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button disabled={busy} onClick={() => setEdit(null)} style={ghostGray}>Cancel</button>
              {canEdit && <button disabled={busy} onClick={saveEdit} style={pill(AMZ, "#fff")}>{busy ? "Saving…" : "Save template"}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
