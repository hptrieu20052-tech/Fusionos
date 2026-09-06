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
  // v406 · description chuẩn + estimated delivery (ShopBase không chạy AI Optimize)
  description: string;
  shipProcMin: number | null; shipProcMax: number | null;
  shipUsMin: number | null; shipUsMax: number | null;
  shipIntlMin: number | null; shipIntlMax: number | null;
  shipCutoffHour: number | null;
  shipCountries: Record<string, [number | null, number | null]>;
  // v407 · Customize (buyer inputs) — Color/tên khắc... khách tự chọn, KHÔNG ăn variants
  personalization: PQ[];
  // v410 · nội dung 2 tab accordion trên trang sản phẩm (widget đổ vào)
  shippingInfo: string;
  returnWarranty: string;
};
type PQ = { type: "text" | "dropdown"; label: string; required: boolean; options: string[]; maxChars: number };
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
  return clean.reduce<Record<string, string>[]>((acc, o) => acc.flatMap((c) => o.values.map((v) => ({ ...c, [o.name]: v }))), [{}]).slice(0, 500);   // ShopBase cho tối đa 500 variants/sản phẩm
}
// Số ngày mặc định cho template mới — theo facts supplier: xử lý 1-3, US 4-8, quốc tế 10-30.
const DEFAULT_SHIP = {
  shipProcMin: 1, shipProcMax: 3, shipUsMin: 4, shipUsMax: 8, shipIntlMin: 10, shipIntlMax: 30, shipCutoffHour: 14,
  shipCountries: { ca: [6, 12], gb: [7, 14], au: [8, 16], de: [7, 14] } as Record<string, [number | null, number | null]>,
};
const SHIP_COUNTRIES: { cc: string; label: string; ph: [string, string] }[] = [
  { cc: "ca", label: "Canada", ph: ["6", "12"] },
  { cc: "gb", label: "United Kingdom", ph: ["7", "14"] },
  { cc: "au", label: "Australia", ph: ["8", "16"] },
  { cc: "de", label: "Germany", ph: ["7", "14"] },
];
const numOrNull = (v: string): number | null => { const n = parseInt(v, 10); return isFinite(n) && n >= 0 ? n : null; };
const normPQ = (v: unknown): PQ[] => (Array.isArray(v) ? v : []).map((x) => {
  const q = x as Partial<PQ>;
  return { type: q?.type === "dropdown" ? "dropdown" as const : "text" as const, label: String(q?.label ?? ""), required: !!q?.required, options: Array.isArray(q?.options) ? q!.options!.map(String) : [], maxChars: Number(q?.maxChars) || 100 };
}).slice(0, 5);
const emptyDraft = (storeId: string): Draft => ({ storeId, name: "", thumbUrl: "", options: [], variants: [], collections: [], status: "DRAFT", productType: "", vendor: "", description: "", personalization: [], shippingInfo: "", returnWarranty: "", ...DEFAULT_SHIP });

export default function ShopbaseTemplatesClient({ stores }: { stores: Store[] }) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<Tpl[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [storeFilter, setStoreFilter] = useState(stores[0]?.id ?? "");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [optTexts, setOptTexts] = useState<string[]>([]); // text thô ô values — không nuốt dấu phẩy khi gõ
  const [pqTexts, setPqTexts] = useState<string[]>([]);   // text thô ô options của câu Customize
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

  const openEditor = async (d: Draft) => { setDraft(d); setOptTexts(d.options.map((o) => o.values.join(", "))); setPqTexts(d.personalization.map((q) => q.options.join(", "))); loadCols(d.storeId); };
  const newBlank = () => { if (!storeFilter) return flash("✗ Pick a store first", false); openEditor(emptyDraft(storeFilter)); };
  const editTpl = (t: Tpl) => openEditor({
    ...t, thumbUrl: t.thumbUrl ?? "",
    options: t.options ?? [], variants: (t.variants ?? []).map((v) => ({ ...v, compareAtPrice: v.compareAtPrice ?? null, sku: v.sku ?? "" })),
    collections: t.collections ?? [], productType: t.productType ?? "", vendor: t.vendor ?? "",
    description: t.description ?? "",
    shipProcMin: t.shipProcMin ?? null, shipProcMax: t.shipProcMax ?? null,
    shipUsMin: t.shipUsMin ?? null, shipUsMax: t.shipUsMax ?? null,
    shipIntlMin: t.shipIntlMin ?? null, shipIntlMax: t.shipIntlMax ?? null,
    shipCutoffHour: t.shipCutoffHour ?? null,
    shipCountries: (t.shipCountries && typeof t.shipCountries === "object") ? t.shipCountries : {},
    personalization: normPQ(t.personalization),
    shippingInfo: t.shippingInfo ?? "",
    returnWarranty: t.returnWarranty ?? "",
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
        description: typeof p.description === "string" ? p.description : "",
        personalization: [], shippingInfo: "", returnWarranty: "",
        ...DEFAULT_SHIP,
      };
      setDraft(d); setOptTexts(d.options.map((o) => o.values.join(", ")));
      loadCols(p.storeId);
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };

  // ---- editor helpers (cùng luật với Templates Shopify) ----
  const setD = (patch: Partial<Draft>) => setDraft((d) => d ? { ...d, ...patch } : d);
  // Ô số ngày theo nước — xoá cả 2 ô ⇒ bỏ nước đó ⇒ widget cho nước đó chạy theo Rest of world.
  const cGet = (cc: string, i: 0 | 1): number | "" => {
    const v = draft?.shipCountries?.[cc];
    return Array.isArray(v) && v[i] != null ? v[i] : "";
  };
  const cSet = (cc: string, i: 0 | 1, val: number | null) => setDraft((d) => {
    if (!d) return d;
    const cur = d.shipCountries?.[cc];
    const next: [number | null, number | null] = Array.isArray(cur) ? [cur[0], cur[1]] : [null, null];
    next[i] = val;
    const map: Record<string, [number | null, number | null]> = { ...(d.shipCountries ?? {}) };
    if (next[0] == null && next[1] == null) delete map[cc];
    else map[cc] = next;
    return { ...d, shipCountries: map };
  });
  // v407 · Customize helpers — pqTexts giữ text thô ô options để gõ dấu phẩy không bị nuốt.
  const setPQ = (i: number, patch: Partial<PQ>) => setDraft((d) => d ? { ...d, personalization: d.personalization.map((q, k) => k === i ? { ...q, ...patch } : q) } : d);
  const addPQ = (type: PQ["type"]) => {
    setDraft((d) => (d && d.personalization.length < 5) ? { ...d, personalization: [...d.personalization, { type, label: "", required: type === "dropdown", options: [], maxChars: 100 }] } : d);
    setPqTexts((ts) => ts.length < 5 ? [...ts, ""] : ts);
  };
  const removePQ = (i: number) => {
    setDraft((d) => d ? { ...d, personalization: d.personalization.filter((_, k) => k !== i) } : d);
    setPqTexts((ts) => ts.filter((_, k) => k !== i));
  };
  const setPQOptionsText = (i: number, text: string) => {
    setPqTexts((ts) => { const n = [...ts]; n[i] = text; return n; });
    setPQ(i, { options: text.split(",").map((x) => x.trim()).filter(Boolean) });
  };
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
    const badPQ = draft.personalization.findIndex((q) => !q.label.trim() || (q.type === "dropdown" && !q.options.length));
    if (badPQ >= 0) return flash(`✗ Customize #${badPQ + 1}: label${draft.personalization[badPQ].type === "dropdown" ? " and choices are" : " is"} required`, false);
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

            {/* v406 · DESCRIPTION — ShopBase không chạy AI Optimize: mô tả chuẩn của loại sản phẩm.
                Có nội dung ⇒ lúc Push từ Etsy/TikTok, bản nháp dùng mô tả NÀY thay mô tả nguồn. */}
            <div style={{ border: "1px solid #DCE9F5", background: "#F7FBFF", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Description</div>
              <textarea value={draft.description} onChange={(e) => setD({ description: e.target.value })}
                placeholder={"Standard description for this product type (HTML or plain text).\nIf filled, staged drafts use THIS instead of the source listing's description."}
                style={{ ...ctl, width: "100%", minHeight: 130, resize: "vertical", fontFamily: "inherit" }} />
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>Leave empty to keep the source listing&apos;s description when pushing from Etsy/TikTok.</div>
            </div>

            {/* v410 · INFO TABS — nội dung 2 tab accordion trên trang sản phẩm (SHIPPING /
                RETURN & WARRANTY). Widget tìm đúng heading trên theme và đổ nội dung này vào.
                Để trống = giữ nội dung mặc định của theme. */}
            <div style={{ border: "1px solid #DCE9F5", background: "#F7FBFF", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Info tabs · product page accordions</div>
              <label style={lab}>Shipping</label>
              <textarea value={draft.shippingInfo} onChange={(e) => setD({ shippingInfo: e.target.value })}
                placeholder={"Processing time: 2-4 business days.\nUS shipping: 4-8 business days with tracking.\nFree shipping on all US orders."}
                style={{ ...ctl, width: "100%", minHeight: 90, resize: "vertical", fontFamily: "inherit" }} />
              <label style={{ ...lab, marginTop: 10 }}>Return &amp; Warranty</label>
              <textarea value={draft.returnWarranty} onChange={(e) => setD({ returnWarranty: e.target.value })}
                placeholder={"If you're not 100% satisfied, let us know and we'll make it right.\nReturns accepted within 30 days of delivery for non-personalized items…"}
                style={{ ...ctl, width: "100%", minHeight: 90, resize: "vertical", fontFamily: "inherit" }} />
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>Leave empty to keep the theme&apos;s default tab content.</div>
            </div>

            {/* v406 · ESTIMATED DELIVERY — dữ liệu nhúng ẩn vào cuối mô tả lúc stage; widget trên
                theme ShopBase (file shopbase-delivery-widget.html) đọc ra và vẽ timeline động. */}
            <div style={{ border: "1px solid #E3DCF5", background: "#FAF8FF", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>🚚 Estimated delivery · business days</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                <div>
                  <label style={lab}>Processing</label>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="number" min={0} max={180} value={draft.shipProcMin ?? ""} onChange={(e) => setD({ shipProcMin: numOrNull(e.target.value) })} placeholder="1" style={{ ...ctl, width: "100%", padding: "8px 10px" }} />
                    <span style={{ color: "var(--muted)" }}>–</span>
                    <input type="number" min={0} max={180} value={draft.shipProcMax ?? ""} onChange={(e) => setD({ shipProcMax: numOrNull(e.target.value) })} placeholder="3" style={{ ...ctl, width: "100%", padding: "8px 10px" }} />
                  </div>
                </div>
                <div>
                  <label style={lab}>United States</label>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="number" min={0} max={180} value={draft.shipUsMin ?? ""} onChange={(e) => setD({ shipUsMin: numOrNull(e.target.value) })} placeholder="4" style={{ ...ctl, width: "100%", padding: "8px 10px" }} />
                    <span style={{ color: "var(--muted)" }}>–</span>
                    <input type="number" min={0} max={180} value={draft.shipUsMax ?? ""} onChange={(e) => setD({ shipUsMax: numOrNull(e.target.value) })} placeholder="8" style={{ ...ctl, width: "100%", padding: "8px 10px" }} />
                  </div>
                </div>
                {SHIP_COUNTRIES.map((c) => (
                  <div key={c.cc}>
                    <label style={lab}>{c.label}</label>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="number" min={0} max={180} value={cGet(c.cc, 0)} onChange={(e) => cSet(c.cc, 0, numOrNull(e.target.value))} placeholder={c.ph[0]} style={{ ...ctl, width: "100%", padding: "8px 10px" }} />
                      <span style={{ color: "var(--muted)" }}>–</span>
                      <input type="number" min={0} max={180} value={cGet(c.cc, 1)} onChange={(e) => cSet(c.cc, 1, numOrNull(e.target.value))} placeholder={c.ph[1]} style={{ ...ctl, width: "100%", padding: "8px 10px" }} />
                    </div>
                  </div>
                ))}
                <div>
                  <label style={lab}>Rest of world</label>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="number" min={0} max={180} value={draft.shipIntlMin ?? ""} onChange={(e) => setD({ shipIntlMin: numOrNull(e.target.value) })} placeholder="10" style={{ ...ctl, width: "100%", padding: "8px 10px" }} />
                    <span style={{ color: "var(--muted)" }}>–</span>
                    <input type="number" min={0} max={180} value={draft.shipIntlMax ?? ""} onChange={(e) => setD({ shipIntlMax: numOrNull(e.target.value) })} placeholder="30" style={{ ...ctl, width: "100%", padding: "8px 10px" }} />
                  </div>
                </div>
                <div>
                  <label style={lab}>Cut-off hour</label>
                  <input type="number" min={0} max={23} value={draft.shipCutoffHour ?? ""} onChange={(e) => setD({ shipCutoffHour: numOrNull(e.target.value) })} placeholder="14" style={{ ...ctl, width: "100%", padding: "8px 10px" }} />
                </div>
              </div>
              <div style={{ marginTop: 10, fontSize: 12.5, color: "#4C3A87", background: "#fff", border: "1px solid #E3DCF5", borderRadius: 9, padding: "8px 12px" }}>
                {(() => {
                  const bd = (from: Date, n: number) => { const d = new Date(from); let left = n; while (left > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) left--; } return d; };
                  const f = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
                  const pMin = draft.shipProcMin ?? 1, pMax = draft.shipProcMax ?? 3, uMin = draft.shipUsMin ?? 4, uMax = draft.shipUsMax ?? 8;
                  const now = new Date();
                  const start = (draft.shipCutoffHour != null && now.getHours() >= draft.shipCutoffHour) ? bd(now, 1) : now;
                  return <>US · ships <b>{f(bd(start, pMin))} – {f(bd(start, pMax))}</b> · arrives <b>{f(bd(start, pMin + uMin))} – {f(bd(start, pMax + uMax))}</b> · widget on the ShopBase theme reads these numbers per product</>;
                })()}
              </div>
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

            {/* v407 · CUSTOMIZE — ô khách tự điền/chọn trên trang sản phẩm (Color, tên khắc...).
                KHÔNG ăn variants → đưa Color vào đây để thoát trần 500 variants của ShopBase.
                Cần dán shopbase-customize-widget.html vào theme (1 lần) để ô hiện trên storefront. */}
            <div style={{ border: "1px solid #F0DCC6", background: "#FFFBF5", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>✏️ Customize · buyer inputs</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{draft.personalization.length}/5</div>
              </div>
              {draft.personalization.map((q, i) => (
                <div key={i} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select value={q.type} onChange={(e) => { setPQ(i, { type: e.target.value as PQ["type"], options: [] }); setPqTexts((ts) => { const n = [...ts]; n[i] = ""; return n; }); }} style={{ ...ctl, width: 130, padding: "8px 10px" }}>
                      <option value="dropdown">Dropdown</option>
                      <option value="text">Text box</option>
                    </select>
                    <input value={q.label} maxLength={45} onChange={(e) => setPQ(i, { label: e.target.value })} placeholder="Label shown to the buyer (e.g. Color)" style={{ ...ctl, flex: 1, padding: "8px 10px" }} />
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, whiteSpace: "nowrap", cursor: "pointer" }}>
                      <input type="checkbox" checked={q.required} onChange={(e) => setPQ(i, { required: e.target.checked })} />Required
                    </label>
                    <button onClick={() => removePQ(i)} style={{ ...ghost, color: "var(--red)", padding: "7px 10px" }}>×</button>
                  </div>
                  {q.type === "dropdown" && (
                    <input value={pqTexts[i] ?? q.options.join(", ")} onChange={(e) => setPQOptionsText(i, e.target.value)} placeholder="Choices, comma-separated (e.g. Black, White, Navy, Sport Grey…)" style={{ ...ctl, width: "100%", padding: "8px 10px", marginTop: 8 }} />
                  )}
                  {q.type === "text" && (
                    <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                      <input type="number" min={1} max={1024} value={q.maxChars} onChange={(e) => setPQ(i, { maxChars: Math.min(Math.max(parseInt(e.target.value, 10) || 1, 1), 1024) })} style={{ ...ctl, width: 100, padding: "8px 10px" }} />
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>max characters</span>
                    </div>
                  )}
                </div>
              ))}
              {draft.personalization.length < 5 && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => addPQ("dropdown")} style={{ ...ghost, fontSize: 12.5 }}>+ Dropdown</button>
                  <button onClick={() => addPQ("text")} style={{ ...ghost, fontSize: 12.5 }}>+ Text box</button>
                </div>
              )}
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>Shown above Add to cart by the FUSION customize widget on your ShopBase theme. Buyer&apos;s choices land in the order as line item properties.</div>
            </div>

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
