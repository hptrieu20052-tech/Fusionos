"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConfirm } from "@/components/confirm-provider";
import { ShopbaseLogo } from "@/components/shopbase-logo";

/**
 * v405 · Manage Templates · ShopBase — bản rút gọn của Templates Shopify:
 * name/thumb/status/type/vendor + options (≤3) + variants (giá theo tổ hợp) + collections.
 * Dùng khi Push từ Etsy/TikTok sang ShopBase: bản nháp lấy options/variants/giá của template,
 * collections của template được áp lúc Push (POST collects).
 */
type Store = { id: string; name: string };
type Opt = { name: string; values: string[] };
type Vari = { options: Record<string, string>; price: string; compareAtPrice: string | null; sku: string };
type Col = { id: string; title: string };
type Draft = {
  id?: string; storeId: string; name: string; thumbUrl: string;
  options: Opt[]; variants: Vari[]; collections: Col[];
  status: string; productType: string; vendor: string;
};
type Tpl = Draft & { updatedAt?: string };

const SB_BLUE = "#2F6BFF";
const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,.04)" };
const ctl: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 10, padding: "9px 12px", fontSize: 13.5, font: "inherit", background: "#fff", outline: "none" };
const pill = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 7, border: "none", background: bg, color: fg, borderRadius: 11, padding: "9px 15px", fontSize: 13, fontWeight: 700, cursor: "pointer" });
const ghost: React.CSSProperties = { ...pill("#fff", "var(--ink)"), border: "1px solid var(--line)" };
const lab: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 6 };

const priceKey = (o: Record<string, string>) => Object.keys(o).sort().map((k) => `${k}=${o[k]}`).join("|");
function cartesian(options: Opt[]): Record<string, string>[] {
  const clean = options.filter((o) => o.name.trim() && o.values.length);
  if (!clean.length) return [];
  return clean.reduce<Record<string, string>[]>((acc, o) => acc.flatMap((c) => o.values.map((v) => ({ ...c, [o.name]: v }))), [{}]).slice(0, 100);
}
const emptyDraft = (storeId: string): Draft => ({ storeId, name: "", thumbUrl: "", options: [], variants: [], collections: [], status: "DRAFT", productType: "", vendor: "" });

export default function ShopbaseTemplatesClient({ stores }: { stores: Store[] }) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<Tpl[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [storeFilter, setStoreFilter] = useState(stores[0]?.id ?? "");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [optTexts, setOptTexts] = useState<string[]>([]); // text thô ô values — không nuốt dấu phẩy khi gõ
  const [storeCols, setStoreCols] = useState<Col[]>([]);  // collections live của store cho picker
  const [prodPick, setProdPick] = useState<{ list: { id: string; title: string }[] } | null>(null);

  const flash = (text: string, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 5000); };
  const load = useCallback(async () => { setLoading(true); try { const j = await fetch("/api/shopbase-templates").then((r) => r.json()); if (j.ok) setRows(j.templates); } catch { /* noop */ } setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);

  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? "—";
  const filtered = useMemo(() => rows.filter((r) => !storeFilter || r.storeId === storeFilter), [rows, storeFilter]);

  // Collections live của store — cho picker trong editor (custom + smart).
  const loadCols = useCallback(async (storeId: string) => {
    setStoreCols([]);
    try {
      const j = await fetch(`/api/shopbase-collections?store=${storeId}`).then((r) => r.json());
      if (j.ok) setStoreCols((j.collections ?? []).map((c: { id: string; title: string }) => ({ id: c.id, title: c.title })));
    } catch { /* store chưa cấu hình API → picker trống, vẫn sửa được phần khác */ }
  }, []);

  const openEditor = async (d: Draft) => { setDraft(d); setOptTexts(d.options.map((o) => o.values.join(", "))); loadCols(d.storeId); };
  const newBlank = () => { if (!storeFilter) return flash("✗ Pick a store first", false); openEditor(emptyDraft(storeFilter)); };
  const editTpl = (t: Tpl) => openEditor({
    ...t, thumbUrl: t.thumbUrl ?? "",
    options: t.options ?? [], variants: (t.variants ?? []).map((v) => ({ ...v, compareAtPrice: v.compareAtPrice ?? null, sku: v.sku ?? "" })),
    collections: t.collections ?? [], productType: t.productType ?? "", vendor: t.vendor ?? "",
  });

  // From ShopBase product — copy options/variants/giá từ 1 sản phẩm đã sync.
  const startFromProduct = async () => {
    if (!storeFilter) return flash("✗ Pick a store first", false);
    setBusy(true);
    try {
      const j = await fetch("/api/shopbase-products").then((r) => r.json());
      const list = (j.rows ?? []).filter((r: { storeId: string; shopbaseProductId: string }) => r.storeId === storeFilter && r.shopbaseProductId)
        .map((r: { id: string; title: string }) => ({ id: r.id, title: r.title }));
      if (!list.length) flash("✗ No synced ShopBase products for this store — Sync in Manage Products first", false);
      else setProdPick({ list });
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };
  const pickProduct = async (productId: string) => {
    setBusy(true);
    try {
      const j = await fetch(`/api/shopbase-templates/from-product?productId=${productId}`).then((r) => r.json());
      if (!j.ok) { flash("✗ " + (j.error ?? "Fetch failed"), false); setBusy(false); return; }
      const p = j.prefill;
      setProdPick(null);
      const d: Draft = {
        storeId: p.storeId, name: (p.sourceTitle ? p.sourceTitle + " — template" : "New template").slice(0, 100),
        thumbUrl: typeof p.thumbUrl === "string" ? p.thumbUrl : "",
        options: p.options ?? [],
        variants: (p.variants ?? []).map((v: Vari) => ({ ...v, compareAtPrice: v.compareAtPrice ?? null, sku: v.sku ?? "" })),
        collections: p.collections ?? [],
        status: "DRAFT", productType: p.productType ?? "", vendor: p.vendor ?? "",
      };
      setDraft(d); setOptTexts(d.options.map((o) => o.values.join(", ")));
      loadCols(p.storeId);
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };

  // ---- editor helpers (cùng luật với Templates Shopify) ----
  const setD = (patch: Partial<Draft>) => setDraft((d) => d ? { ...d, ...patch } : d);
  const regenVariants = (options: Opt[], prev: Vari[]) => {
    const map = new Map(prev.map((v) => [priceKey(v.options), v]));
    return cartesian(options).map((o) => map.get(priceKey(o)) ?? { options: o, price: "0.00", compareAtPrice: null, sku: "" });
  };
  const setOption = (i: number, patch: Partial<Opt>) => setDraft((d) => {
    if (!d) return d;
    const options = d.options.map((o, k) => k === i ? { ...o, ...patch } : o);
    return { ...d, options, variants: regenVariants(options, d.variants) };
  });
  const setOptionValuesText = (i: number, text: string) => {
    setOptTexts((ts) => { const n = [...ts]; n[i] = text; return n; });
    setOption(i, { values: text.split(",").map((x) => x.trim()).filter(Boolean) });
  };
  const addOption = () => { setDraft((d) => d ? { ...d, options: [...d.options, { name: "", values: [] }] } : d); setOptTexts((ts) => [...ts, ""]); };
  const removeOption = (i: number) => {
    setDraft((d) => {
      if (!d) return d;
      const options = d.options.filter((_, k) => k !== i);
      return { ...d, options, variants: regenVariants(options, d.variants) };
    });
    setOptTexts((ts) => ts.filter((_, k) => k !== i));
  };
  const setVariant = (i: number, patch: Partial<Vari>) => setDraft((d) => d ? { ...d, variants: d.variants.map((v, k) => k === i ? { ...v, ...patch } : v) } : d);
  const toggleCol = (c: Col) => setDraft((d) => {
    if (!d) return d;
    const has = d.collections.some((x) => x.id === c.id);
    return { ...d, collections: has ? d.collections.filter((x) => x.id !== c.id) : [...d.collections, c] };
  });

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) return flash("✗ Template name required", false);
    setBusy(true);
    try {
      const method = draft.id ? "PATCH" : "POST";
      const j = await fetch("/api/shopbase-templates", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) }).then((r) => r.json());
      if (j.ok) { flash("✓ Saved"); setDraft(null); load(); } else flash("✗ " + (j.error ?? "Save failed"), false);
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };
  const del = async (t: Tpl) => {
    if (!t.id || !(await confirm({ message: `Delete template "${t.name}"?`, danger: true }))) return;
    setBusy(true);
    try { const j = await fetch("/api/shopbase-templates", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [t.id] }) }).then((r) => r.json());
      if (j.ok) { flash("✓ Deleted"); load(); } else flash("✗ " + (j.error ?? "Delete failed"), false);
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };

  // Picker hiển thị: collections của store + collections đã lưu trong template mà list live không có
  // (store đổi API / collection bị xoá) — vẫn thấy để bỏ chọn.
  const pickerCols = useMemo(() => {
    const seen = new Set(storeCols.map((c) => c.id));
    const extra = (draft?.collections ?? []).filter((c) => !seen.has(c.id));
    return [...storeCols, ...extra];
  }, [storeCols, draft]);

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "0 4px" }}>
      <div style={{ ...card, padding: "18px 22px", marginBottom: 14, display: "flex", alignItems: "center", gap: 14, background: "linear-gradient(90deg,#EEF3FF,#fff)", borderColor: "#CBD9FF" }}>
        <ShopbaseLogo s={40} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 19, fontWeight: 800 }}>Manage Templates · <span style={{ color: SB_BLUE }}>ShopBase</span></div>
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{rows.length} templates</div>
        </div>
        <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} style={{ ...ctl }}>
          {stores.length === 0 && <option value="">No ShopBase store</option>}
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button disabled={busy} onClick={startFromProduct} style={pill(SB_BLUE, "#fff")}>+ From ShopBase product</button>
        <button disabled={busy} onClick={newBlank} style={ghost}>+ Blank</button>
      </div>

      {msg && <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 12, background: msg.ok ? "#EAF7F0" : "#FDECEC", color: msg.ok ? "#158A57" : "#C0392B", border: `1px solid ${msg.ok ? "#C7EAD8" : "#F5CFCF"}` }}>{msg.text}</div>}

      {loading ? <div style={{ ...card, padding: 40, textAlign: "center", color: "var(--muted)" }}>Loading…</div>
        : filtered.length === 0 ? <div style={{ ...card, padding: 40, textAlign: "center", color: "var(--muted)" }}>No templates yet — create one to use when pushing Etsy/TikTok listings to ShopBase.</div>
        : <div style={{ display: "grid", gap: 10 }}>
            {filtered.map((t) => (
              <div key={t.id} style={{ ...card, padding: "14px 18px", display: "flex", alignItems: "center", gap: 14 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {t.thumbUrl ? <img src={t.thumbUrl} alt="" width={52} height={52} style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 10, border: "1px solid var(--line)", flexShrink: 0, background: "#F5F6F8" }} />
                  : <div style={{ width: 52, height: 52, borderRadius: 10, border: "1px dashed var(--line)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "var(--muted)", flexShrink: 0, background: "#FAFBFC" }}>🖼️</div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div onClick={() => editTpl(t)} title="Edit template" style={{ fontWeight: 700, fontSize: 14.5, color: SB_BLUE, cursor: "pointer", display: "inline-block" }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                    {storeName(t.storeId)} · {(t.options ?? []).map((o) => `${o.name} (${o.values.length})`).join(" × ") || "no options"} · {(t.variants ?? []).length} variants · {(t.collections ?? []).length} collections · {t.status}
                  </div>
                </div>
                <button onClick={() => del(t)} style={{ ...ghost, color: "var(--red)", borderColor: "#F3C9C9" }}>Delete</button>
              </div>
            ))}
          </div>}

      {/* PRODUCT PICKER */}
      {prodPick && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 2900, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !busy && setProdPick(null)}>
          <div style={{ ...card, width: 520, maxWidth: "96vw", maxHeight: "86vh", overflowY: "auto", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <b style={{ fontSize: 16 }}>Pick a ShopBase listing to copy from</b>
            <div style={{ height: 14 }} />
            <div style={{ display: "grid", gap: 4, maxHeight: 420, overflowY: "auto" }}>
              {prodPick.list.map((p) => (
                <button key={p.id} disabled={busy} onClick={() => pickProduct(p.id)} style={{ textAlign: "left", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 10, background: "#fff", cursor: "pointer", fontSize: 13.5 }}>{p.title}</button>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}><button onClick={() => setProdPick(null)} style={ghost}>Cancel</button></div>
          </div>
        </div>
      )}

      {/* EDITOR */}
      {draft && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.5)", zIndex: 3000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "26px 16px", overflowY: "auto" }} onClick={() => !busy && setDraft(null)}>
          <div style={{ ...card, width: 720, maxWidth: "98vw", padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <b style={{ fontSize: 17 }}>{draft.id ? "Edit template" : "New template"}</b>
              <button onClick={() => setDraft(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--muted)" }}>✕</button>
            </div>

            {/* Thumbnail */}
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 16 }}>
              <div style={{ flexShrink: 0 }}>
                <label style={lab}>Thumbnail</label>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {draft.thumbUrl ? <img src={draft.thumbUrl} alt="" width={72} height={72} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 10, border: "1px solid var(--line)", display: "block", background: "#F5F6F8" }} />
                  : <div style={{ width: 72, height: 72, borderRadius: 10, border: "1px dashed var(--line)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: "var(--muted)", background: "#FAFBFC" }}>🖼️</div>}
              </div>
              <div style={{ flex: 1 }}>
                <label style={lab}>Thumbnail image URL</label>
                <input value={draft.thumbUrl} onChange={(e) => setD({ thumbUrl: e.target.value })} placeholder="https://…  (paste a sample image link)" style={{ ...ctl, width: "100%" }} />
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 5 }}>Created from &quot;+ From ShopBase product&quot; auto-fills the listing image. Blank templates: paste an image URL here.</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
              <div><label style={lab}>Template name</label><input value={draft.name} onChange={(e) => setD({ name: e.target.value })} style={{ ...ctl, width: "100%" }} /></div>
              <div><label style={lab}>Store</label><input value={storeName(draft.storeId)} disabled style={{ ...ctl, width: "100%", background: "#F5F6F8" }} /></div>
              <div><label style={lab}>Status</label><select value={draft.status} onChange={(e) => setD({ status: e.target.value })} style={{ ...ctl, width: "100%" }}><option value="DRAFT">Draft</option><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option></select></div>
              <div><label style={lab}>Type</label><input value={draft.productType} onChange={(e) => setD({ productType: e.target.value })} placeholder="Personalized" style={{ ...ctl, width: "100%" }} /></div>
              <div><label style={lab}>Vendor</label><input value={draft.vendor} onChange={(e) => setD({ vendor: e.target.value })} style={{ ...ctl, width: "100%" }} /></div>
            </div>

            {/* OPTIONS */}
            <div style={{ ...lab, fontSize: 13, color: "var(--ink)", marginBottom: 8 }}>Options</div>
            {draft.options.map((o, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <input value={o.name} onChange={(e) => setOption(i, { name: e.target.value })} placeholder="Option name (e.g. Size)" style={{ ...ctl, width: 180 }} />
                <input value={optTexts[i] ?? o.values.join(", ")} onChange={(e) => setOptionValuesText(i, e.target.value)} placeholder="Values, comma-separated (e.g. 8x8, 10x10, 12x12)" style={{ ...ctl, flex: 1 }} />
                <button onClick={() => removeOption(i)} style={{ ...ghost, color: "var(--red)", padding: "8px 12px" }}>×</button>
              </div>
            ))}
            {draft.options.length < 3 && <button onClick={addOption} style={{ ...ghost, fontSize: 12.5, marginBottom: 14 }}>+ Add option</button>}

            {/* VARIANTS GRID */}
            {draft.variants.length > 0 && (
              <div style={{ marginTop: 10, marginBottom: 16 }}>
                <div style={{ ...lab, fontSize: 13, color: "var(--ink)", marginBottom: 8 }}>Variants ({draft.variants.length})</div>
                <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden", maxHeight: 320, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                    <thead><tr style={{ background: "#F7F8FA", textAlign: "left" }}>
                      {draft.options.filter((o) => o.name).map((o) => <th key={o.name} style={{ padding: "8px 10px" }}>{o.name}</th>)}
                      <th style={{ padding: "8px 10px", width: 100 }}>Price</th><th style={{ padding: "8px 10px", width: 110 }}>Compare-at</th><th style={{ padding: "8px 10px", width: 130 }}>SKU</th>
                    </tr></thead>
                    <tbody>
                      {draft.variants.map((v, i) => (
                        <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                          {draft.options.filter((o) => o.name).map((o) => <td key={o.name} style={{ padding: "6px 10px" }}>{v.options[o.name] ?? "—"}</td>)}
                          <td style={{ padding: "4px 8px" }}><input type="number" step="0.01" min="0" value={v.price} onChange={(e) => setVariant(i, { price: e.target.value })} style={{ ...ctl, width: 84, padding: "6px 8px", textAlign: "right" }} /></td>
                          <td style={{ padding: "4px 8px" }}><input type="number" step="0.01" min="0" value={v.compareAtPrice ?? ""} onChange={(e) => setVariant(i, { compareAtPrice: e.target.value || null })} placeholder="—" style={{ ...ctl, width: 94, padding: "6px 8px", textAlign: "right" }} /></td>
                          <td style={{ padding: "4px 8px" }}><input value={v.sku} onChange={(e) => setVariant(i, { sku: e.target.value })} style={{ ...ctl, width: 120, padding: "6px 8px" }} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* COLLECTIONS */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ ...lab, fontSize: 13, color: "var(--ink)" }}>Collections <span style={{ fontWeight: 500, color: "var(--muted)" }}>— applied when the draft is pushed to ShopBase</span></div>
              {pickerCols.length === 0 ? <div style={{ fontSize: 12, color: "var(--muted)" }}>No collections found — create them in Manage Collections · ShopBase (or check the store API config).</div>
                : <div style={{ display: "grid", gap: 3, maxHeight: 160, overflowY: "auto" }}>{pickerCols.map((c) => (
                    <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "5px 6px", cursor: "pointer" }}>
                      <input type="checkbox" checked={draft.collections.some((x) => x.id === c.id)} onChange={() => toggleCol(c)} />{c.title}</label>
                  ))}</div>}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setDraft(null)} style={ghost}>Cancel</button>
              <button disabled={busy} onClick={save} style={{ ...pill(SB_BLUE, "#fff"), opacity: busy ? .6 : 1 }}>{busy ? "Saving…" : "Save template"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
