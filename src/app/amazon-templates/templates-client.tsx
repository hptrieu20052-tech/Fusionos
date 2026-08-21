"use client";

/**
 * Manage Templates · Amazon (v286)
 *
 * Mỗi LOẠI sản phẩm 1 template customization Amazon. Template được tạo bằng cách upload
 * master .xlsx — chính là file "product customization template" generate từ Seller Central
 * (Custom Products → Product customization templates → download). FUSION parse và giữ nguyên
 * 3 dòng header (dòng 1 chứa ID template Amazon của account) + bộ giá trị mẫu; lúc Export
 * chỉ nhân bản dòng theo từng child SKU.
 */

import { useEffect, useRef, useState } from "react";

type Tpl = { id: string; name: string; productType: string | null; fields: number; cols: number; skuSuffixes: string[]; updatedAt: string | null };

const AMZ = "#B5661A";
const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,.04)" };
const ctl: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 12, padding: "10px 13px", fontSize: 13.5, font: "inherit", background: "#fff", outline: "none" };
const pill = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 7, border: "none", background: bg, color: fg, borderRadius: 12, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" });
const lab: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 4 };

export default function AmazonTemplatesClient({ canEdit }: { canEdit: boolean }) {
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [ptype, setPtype] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [editSfx, setEditSfx] = useState<Record<string, string>>({});

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

  const saveMeta = async (t: Tpl, patch: { productType?: string; skuSuffixes?: string[] }) => {
    setBusy(true);
    try {
      const j = await fetch("/api/amazon-templates", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id, ...patch }),
      }).then((r) => r.json());
      if (j.ok) { flash("✓ Saved"); load(); }
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

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "18px 16px" }}>
      <div style={{ ...card, padding: "16px 20px", marginBottom: 14 }}>
        <div style={{ fontSize: 20, fontWeight: 800, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 34, height: 34, borderRadius: 9, background: "#FF9900", color: "#111", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 900 }}>a</span>
          Manage Templates · Amazon
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>
          One customization template per product family. Create it once in Seller Central (build customizations on one ASIN → Generate template → download the .xlsx), then import it here — Export in Manage Products Amazon clones its rows per SKU.
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
              <th style={{ padding: 10 }}>FIELDS</th>
              <th style={{ padding: 10 }}>SKU SUFFIXES (child SKUs per product)</th>
              <th style={{ padding: 10 }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ padding: 28, textAlign: "center", color: "var(--muted)" }}>Loading…</td></tr>
            ) : tpls.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 28, textAlign: "center", color: "var(--muted)" }}>No templates yet — run MIGRATION_v286 (seeds “Custom Child Book”) or import a master .xlsx above.</td></tr>
            ) : tpls.map((t) => (
              <tr key={t.id} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: 10, fontWeight: 700 }}>{t.name}</td>
                <td style={{ padding: 10 }}>{t.productType ?? <span style={{ color: "var(--muted)" }}>manual assign only</span>}</td>
                <td style={{ padding: 10 }}>{t.fields} fields · {t.cols} cols</td>
                <td style={{ padding: 10 }}>
                  <input
                    value={editSfx[t.id] ?? t.skuSuffixes.join(", ")}
                    onChange={(e) => setEditSfx((p) => ({ ...p, [t.id]: e.target.value }))}
                    disabled={!canEdit}
                    title='Each product exports one row per suffix: SKU = {root}-{suffix}, e.g. TLW-0011-8X8-AMZ'
                    style={{ ...ctl, width: 260, fontFamily: "monospace", fontSize: 12 }} />
                  {canEdit && (editSfx[t.id] ?? null) !== null && editSfx[t.id] !== t.skuSuffixes.join(", ") && (
                    <button disabled={busy} onClick={() => saveMeta(t, { skuSuffixes: (editSfx[t.id] ?? "").split(",").map((s) => s.trim()).filter(Boolean) })} style={{ ...pill("#1F6F45", "#fff"), padding: "6px 12px", fontSize: 12, marginLeft: 6 }}>Save</button>
                  )}
                </td>
                <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                  {canEdit && <button disabled={busy} onClick={() => remove(t)} style={{ ...pill("#fff", "#B42318"), border: "1px solid #F3C9C9", padding: "6px 10px", fontSize: 12 }}>Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 12, lineHeight: 1.6 }}>
        <b>Flow:</b> Manage Products Shopify → 🅰 Push to Amazon → Manage Products Amazon (AI copy + edit) → Export customization file (picks this template) → upload at Amazon Custom Products → Upload Customizations. Listings must already be live on Amazon with inventory before the customization upload.
      </div>
    </div>
  );
}
