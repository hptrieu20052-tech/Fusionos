"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConfirm } from "@/components/confirm-provider";

type Store = { id: string; name: string };
type Opt = { name: string; values: string[] };
type Vari = { options: Record<string, string>; price: string; compareAtPrice: string | null; sku: string };
type Meta = { namespace: string; key: string; type: string; value: string };
type Cat = { id: string; name: string } | null;
type Draft = {
  id?: string; storeId: string; name: string;
  options: Opt[]; variants: Vari[];
  collectionIds: string[]; publicationIds: string[];
  status: string; productType: string; vendor: string; themeTemplate: string;
  category: Cat; categoryMetafields: Meta[];
};
type Tpl = Draft & { updatedAt?: string };
type NamedItem = { id: string; label: string };

const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,.04)" };
const ctl: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 10, padding: "9px 12px", fontSize: 13.5, font: "inherit", background: "#fff", outline: "none" };
const pill = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 7, border: "none", background: bg, color: fg, borderRadius: 11, padding: "9px 15px", fontSize: 13, fontWeight: 700, cursor: "pointer" });
const ghost: React.CSSProperties = { ...pill("#fff", "var(--ink)"), border: "1px solid var(--line)" };
const lab: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 6 };
const SHOP_GREEN = "#5E8E3E";

const priceKey = (o: Record<string, string>) => Object.keys(o).sort().map((k) => `${k}=${o[k]}`).join("|");
function cartesian(options: Opt[]): Record<string, string>[] {
  const clean = options.filter((o) => o.name.trim() && o.values.length);
  if (!clean.length) return [];
  return clean.reduce<Record<string, string>[]>((acc, o) => acc.flatMap((c) => o.values.map((v) => ({ ...c, [o.name]: v }))), [{}]).slice(0, 100);
}
const emptyDraft = (storeId: string): Draft => ({ storeId, name: "", options: [], variants: [], collectionIds: [], publicationIds: [], status: "DRAFT", productType: "", vendor: "", themeTemplate: "", category: null, categoryMetafields: [] });

export default function ShopifyTemplatesClient({ stores }: { stores: Store[] }) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<Tpl[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [storeFilter, setStoreFilter] = useState(stores[0]?.id ?? "");
  const [draft, setDraft] = useState<Draft | null>(null);
  // picker data theo store trong editor
  const [colls, setColls] = useState<NamedItem[]>([]);
  const [pubs, setPubs] = useState<NamedItem[]>([]);
  const [catQ, setCatQ] = useState(""); const [catHits, setCatHits] = useState<NamedItem[]>([]);
  // "new from product"
  const [prodPick, setProdPick] = useState<{ storeId: string; list: { id: string; title: string }[] } | null>(null);

  const flash = (text: string, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 5000); };
  const load = useCallback(async () => { setLoading(true); try { const j = await fetch("/api/shopify-templates").then((r) => r.json()); if (j.ok) setRows(j.templates); } catch { /* noop */ } setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);

  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? "—";
  const filtered = useMemo(() => rows.filter((r) => !storeFilter || r.storeId === storeFilter), [rows, storeFilter]);

  // Nạp collections + sales channels của store (cho picker trong editor)
  const loadPickers = useCallback(async (storeId: string) => {
    setColls([]); setPubs([]);
    try {
      const j = await fetch(`/api/shopify-products/channels?storeId=${storeId}`).then((r) => r.json());
      if (j.ok) {
        setColls((j.collections ?? []).map((c: { id: string; title: string }) => ({ id: c.id, label: c.title })));
        setPubs((j.publications ?? []).map((p: { id: string; name: string }) => ({ id: p.id, label: p.name })));
      }
    } catch { /* offline */ }
  }, []);

  const openEditor = async (d: Draft) => { setDraft(d); setCatQ(""); setCatHits([]); await loadPickers(d.storeId); };
  const newBlank = () => { if (!storeFilter) return flash("✗ Pick a store first", false); openEditor(emptyDraft(storeFilter)); };
  const editTpl = (t: Tpl) => openEditor({ ...t, category: t.category ?? null });

  // New from product: nạp danh sách listing của store rồi chọn
  const startFromProduct = async () => {
    if (!storeFilter) return flash("✗ Pick a store first", false);
    setBusy(true);
    try {
      const j = await fetch("/api/shopify-products").then((r) => r.json());
      const list = (j.rows ?? []).filter((r: { storeId: string }) => r.storeId === storeFilter).map((r: { id: string; title: string }) => ({ id: r.id, title: r.title }));
      if (!list.length) flash("✗ No synced Shopify products for this store — Sync in Manage Products first", false);
      else setProdPick({ storeId: storeFilter, list });
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };
  const pickProduct = async (productId: string) => {
    setBusy(true);
    try {
      const j = await fetch(`/api/shopify-templates/from-product?productId=${productId}`).then((r) => r.json());
      if (!j.ok) { flash("✗ " + (j.error ?? "Fetch failed"), false); setBusy(false); return; }
      const p = j.prefill;
      setProdPick(null);
      if (j.note) flash("⚠ Copied — " + j.note, true);
      setColls((p.collections ?? []).map((c: { id: string; title: string }) => ({ id: c.id, label: c.title })));
      setPubs((p.publications ?? []).map((c: { id: string; name: string }) => ({ id: c.id, label: c.name })));
      const d: Draft = {
        storeId: p.storeId, name: (p.sourceTitle ? p.sourceTitle + " — template" : "New template").slice(0, 100),
        options: p.options ?? [], variants: p.variants ?? [],
        collectionIds: p.collectionIds ?? [], publicationIds: p.publicationIds ?? [],
        status: "DRAFT", productType: p.productType ?? "", vendor: p.vendor ?? "", themeTemplate: p.themeTemplate ?? "",
        category: p.category ?? null, categoryMetafields: p.categoryMetafields ?? [],
      };
      setDraft(d); setCatQ(""); setCatHits([]);
      // đảm bảo picker có tên collection/kênh từ product kể cả khi chưa nạp full store
      loadPickers(p.storeId);
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };

  // ---- editor helpers ----
  const setD = (patch: Partial<Draft>) => setDraft((d) => d ? { ...d, ...patch } : d);
  // Khi đổi options → dựng lại combos, giữ giá combo còn tồn tại
  const regenVariants = (options: Opt[], prev: Vari[]) => {
    const map = new Map(prev.map((v) => [priceKey(v.options), v]));
    return cartesian(options).map((o) => map.get(priceKey(o)) ?? { options: o, price: "0.00", compareAtPrice: null, sku: "" });
  };
  const setOption = (i: number, patch: Partial<Opt>) => setDraft((d) => {
    if (!d) return d;
    const options = d.options.map((o, k) => k === i ? { ...o, ...patch } : o);
    return { ...d, options, variants: regenVariants(options, d.variants) };
  });
  const addOption = () => setDraft((d) => d ? { ...d, options: [...d.options, { name: "", values: [] }] } : d);
  const removeOption = (i: number) => setDraft((d) => {
    if (!d) return d;
    const options = d.options.filter((_, k) => k !== i);
    return { ...d, options, variants: regenVariants(options, d.variants) };
  });
  const setVariant = (i: number, patch: Partial<Vari>) => setDraft((d) => d ? { ...d, variants: d.variants.map((v, k) => k === i ? { ...v, ...patch } : v) } : d);
  const toggleId = (field: "collectionIds" | "publicationIds", id: string) => setDraft((d) => {
    if (!d) return d;
    const set = new Set(d[field]); set.has(id) ? set.delete(id) : set.add(id);
    return { ...d, [field]: Array.from(set) };
  });

  const searchCat = async () => {
    if (!draft || !catQ.trim()) return;
    setBusy(true);
    try { const j = await fetch(`/api/shopify-products/taxonomy?storeId=${draft.storeId}&q=${encodeURIComponent(catQ.trim())}`).then((r) => r.json());
      if (j.ok) setCatHits((j.categories ?? []).map((c: { id: string; name: string }) => ({ id: c.id, label: c.name })));
      else flash("✗ " + (j.error ?? "Search failed"), false);
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) return flash("✗ Template name required", false);
    setBusy(true);
    try {
      const method = draft.id ? "PATCH" : "POST";
      const j = await fetch("/api/shopify-templates", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) }).then((r) => r.json());
      if (j.ok) { flash("✓ Saved"); setDraft(null); load(); } else flash("✗ " + (j.error ?? "Save failed"), false);
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };
  const del = async (t: Tpl) => {
    if (!t.id || !(await confirm({ message: `Delete template "${t.name}"?`, danger: true }))) return;
    setBusy(true);
    try { const j = await fetch("/api/shopify-templates", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [t.id] }) }).then((r) => r.json());
      if (j.ok) { flash("✓ Deleted"); load(); } else flash("✗ " + (j.error ?? "Delete failed"), false);
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "0 4px" }}>
      <div style={{ ...card, padding: "18px 22px", marginBottom: 14, display: "flex", alignItems: "center", gap: 14, background: "linear-gradient(90deg,#F3FBF6,#fff)" }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: SHOP_GREEN, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 20 }}>T</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 19, fontWeight: 800 }}>Manage Templates · Shopify</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{rows.length} templates · Full preset (variants + price + collections + channels + category) applied on Push & bulk-edit</div>
        </div>
        <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} style={{ ...ctl }}>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button disabled={busy} onClick={startFromProduct} style={pill(SHOP_GREEN, "#fff")}>+ From Shopify product</button>
        <button disabled={busy} onClick={newBlank} style={ghost}>+ Blank</button>
      </div>

      {msg && <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 12, background: msg.ok ? "#EAF7F0" : "#FDECEC", color: msg.ok ? "#158A57" : "#C0392B", border: `1px solid ${msg.ok ? "#C7EAD8" : "#F5CFCF"}` }}>{msg.text}</div>}

      {loading ? <div style={{ ...card, padding: 40, textAlign: "center", color: "var(--muted)" }}>Loading…</div>
        : filtered.length === 0 ? <div style={{ ...card, padding: 40, textAlign: "center", color: "var(--muted)" }}>No templates yet. Create one from an existing Shopify product for the fastest setup.</div>
        : <div style={{ display: "grid", gap: 10 }}>
            {filtered.map((t) => (
              <div key={t.id} style={{ ...card, padding: "14px 18px", display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                    {storeName(t.storeId)} · {t.options.map((o) => `${o.name} (${o.values.length})`).join(" × ") || "no options"} · {t.variants.length} variants · {t.collectionIds.length} collections · {t.publicationIds.length} channels · {t.status}
                  </div>
                </div>
                <button onClick={() => editTpl(t)} style={ghost}>Edit</button>
                <button onClick={() => del(t)} style={{ ...ghost, color: "var(--red)", borderColor: "#F3C9C9" }}>Delete</button>
              </div>
            ))}
          </div>}

      {/* PRODUCT PICKER */}
      {prodPick && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 2900, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !busy && setProdPick(null)}>
          <div style={{ ...card, width: 520, maxWidth: "96vw", maxHeight: "86vh", overflowY: "auto", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <b style={{ fontSize: 16 }}>Pick a Shopify listing to copy from</b>
            <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 14px" }}>Its options, prices, category, metafields, collections & channels become the template.</div>
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
          <div style={{ ...card, width: 760, maxWidth: "98vw", padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <b style={{ fontSize: 17 }}>{draft.id ? "Edit template" : "New template"}</b>
              <button onClick={() => setDraft(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--muted)" }}>✕</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
              <div><label style={lab}>Template name</label><input value={draft.name} onChange={(e) => setD({ name: e.target.value })} style={{ ...ctl, width: "100%" }} /></div>
              <div><label style={lab}>Store</label><input value={storeName(draft.storeId)} disabled style={{ ...ctl, width: "100%", background: "#F5F6F8" }} /></div>
              <div><label style={lab}>Status</label><select value={draft.status} onChange={(e) => setD({ status: e.target.value })} style={{ ...ctl, width: "100%" }}><option value="DRAFT">Draft</option><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option></select></div>
              <div><label style={lab}>Type</label><input value={draft.productType} onChange={(e) => setD({ productType: e.target.value })} placeholder="Personalized" style={{ ...ctl, width: "100%" }} /></div>
              <div><label style={lab}>Vendor</label><input value={draft.vendor} onChange={(e) => setD({ vendor: e.target.value })} style={{ ...ctl, width: "100%" }} /></div>
              <div><label style={lab}>Theme template (suffix)</label><input value={draft.themeTemplate} onChange={(e) => setD({ themeTemplate: e.target.value })} placeholder="(Default product)" style={{ ...ctl, width: "100%" }} /></div>
            </div>

            {/* OPTIONS */}
            <div style={{ ...lab, fontSize: 13, color: "var(--ink)", marginBottom: 8 }}>Options (max 3)</div>
            {draft.options.map((o, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <input value={o.name} onChange={(e) => setOption(i, { name: e.target.value })} placeholder="Option name (e.g. Size)" style={{ ...ctl, width: 180 }} />
                <input value={o.values.join(", ")} onChange={(e) => setOption(i, { values: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="Values, comma-separated" style={{ ...ctl, flex: 1 }} />
                <button onClick={() => removeOption(i)} style={{ ...ghost, color: "var(--red)", padding: "8px 12px" }}>×</button>
              </div>
            ))}
            {draft.options.length < 3 && <button onClick={addOption} style={{ ...ghost, fontSize: 12.5, marginBottom: 14 }}>+ Add option</button>}

            {/* VARIANTS GRID */}
            {draft.variants.length > 0 && (
              <div style={{ marginTop: 10, marginBottom: 16 }}>
                <div style={{ ...lab, fontSize: 13, color: "var(--ink)", marginBottom: 8 }}>Variants · price per combination ({draft.variants.length})</div>
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

            {/* CATEGORY */}
            <div style={{ ...lab, fontSize: 13, color: "var(--ink)", marginBottom: 8 }}>Category</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <div style={{ flex: 1, fontSize: 13.5, padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 10, background: draft.category ? "#F3FBF6" : "#fff" }}>{draft.category?.name || "— none —"}</div>
              {draft.category && <button onClick={() => setD({ category: null })} style={{ ...ghost, padding: "8px 12px" }}>Clear</button>}
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <input value={catQ} onChange={(e) => setCatQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); searchCat(); } }} placeholder="Search category (e.g. book)…" style={{ ...ctl, flex: 1 }} />
              <button disabled={busy} onClick={searchCat} style={ghost}>Search</button>
            </div>
            {catHits.length > 0 && (
              <div style={{ display: "grid", gap: 3, marginBottom: 12, maxHeight: 160, overflowY: "auto" }}>
                {catHits.map((c) => <button key={c.id} onClick={() => { setD({ category: { id: c.id, name: c.label } }); setCatHits([]); setCatQ(""); }} style={{ textAlign: "left", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 12.5 }}>{c.label}</button>)}
              </div>
            )}

            {/* CATEGORY METAFIELDS (copied from source product) */}
            {draft.categoryMetafields.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ ...lab, fontSize: 13, color: "var(--ink)", marginBottom: 8 }}>Category metafields (copied from source listing)</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {draft.categoryMetafields.map((m, i) => (
                    <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, background: "#F1F5F9", borderRadius: 999, padding: "4px 10px" }}>
                      <b>{m.key}</b>: {m.value.length > 30 ? m.value.slice(0, 30) + "…" : m.value}
                      <button onClick={() => setD({ categoryMetafields: draft.categoryMetafields.filter((_, k) => k !== i) })} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--muted)", fontSize: 13 }}>×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* COLLECTIONS + CHANNELS */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 18 }}>
              <div>
                <div style={{ ...lab, fontSize: 13, color: "var(--ink)" }}>Collections</div>
                {colls.length === 0 ? <div style={{ fontSize: 12, color: "var(--muted)" }}>No manual collections.</div>
                  : <div style={{ display: "grid", gap: 3, maxHeight: 160, overflowY: "auto" }}>{colls.map((c) => (
                      <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "5px 6px", cursor: "pointer" }}>
                        <input type="checkbox" checked={draft.collectionIds.includes(c.id)} onChange={() => toggleId("collectionIds", c.id)} />{c.label}</label>
                    ))}</div>}
              </div>
              <div>
                <div style={{ ...lab, fontSize: 13, color: "var(--ink)" }}>Sales channels</div>
                {pubs.length === 0 ? <div style={{ fontSize: 12, color: "var(--muted)" }}>None available.</div>
                  : <div style={{ display: "grid", gap: 3, maxHeight: 160, overflowY: "auto" }}>{pubs.map((c) => (
                      <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "5px 6px", cursor: "pointer" }}>
                        <input type="checkbox" checked={draft.publicationIds.includes(c.id)} onChange={() => toggleId("publicationIds", c.id)} />{c.label}</label>
                    ))}</div>}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setDraft(null)} style={ghost}>Cancel</button>
              <button disabled={busy} onClick={save} style={{ ...pill(SHOP_GREEN, "#fff"), opacity: busy ? .6 : 1 }}>{busy ? "Saving…" : "Save template"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
