"use client";
import { useEffect, useMemo, useState } from "react";
import { useConfirm, usePrompt } from "@/components/confirm-provider";

type Store = { id: string; name: string; sellerId: string | null; sellerName: string | null };
type Seller = { id: string; name: string };
type Row = {
  id: string; storeId: string; storeName: string | null; sellerName: string | null;
  title: string; handle: string | null; status: string; dirty: boolean;
  variantCount: number; minPrice: number | null; maxPrice: number | null;
  mainImage: string | null; imageCount: number; onlineStoreUrl: string | null;
  totalInventory: number | null; optionsSummary: string;
};
type SelOpt = { name: string; value: string };
type Variant = { id: string; title: string; selectedOptions: SelOpt[]; price: string; compareAtPrice: string | null; sku: string; inventoryQty: number | null; barcode: string; inventoryItemId?: string | null };
type Img = { id: string; src: string; altText: string; position: number };
type Detail = {
  id: string; storeId: string; storeName: string | null; shopifyProductId: string; handle: string | null;
  title: string; bodyHtml: string | null; vendor: string | null; productType: string | null; tags: string | null;
  seoTitle: string | null; seoDescription: string | null;
  status: string; options: { name: string; position: number; values: string[] }[];
  variants: Variant[]; images: Img[]; onlineStoreUrl: string | null; totalInventory: number | null; dirty: boolean;
};

const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,.04)" };
const ctl: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 12, padding: "10px 13px", fontSize: 13.5, font: "inherit", background: "#fff", outline: "none" };
const pill = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 7, border: "none", background: bg, color: fg, borderRadius: 12, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" });
const ghost: React.CSSProperties = { ...pill("#fff", "var(--ink)"), border: "1px solid var(--line)" };
const lab: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 6 };
const linkBtn = (c: string): React.CSSProperties => ({ border: "none", background: "none", padding: 0, cursor: "pointer", color: c, fontWeight: 700, fontSize: 12.5 });
const money = (n: number | null) => n == null ? "—" : "$" + n.toFixed(2);
const SHOP_GREEN = "#5E8E3E";

type ActKey =
  | "apply_template"
  | "active" | "draft" | "archive" | "delete"
  | "tags_add" | "tags_remove"
  | "channels_include" | "channels_exclude"
  | "catalogs_include" | "catalogs_exclude"
  | "collection_add" | "collection_remove";
type ActionItem = { key: ActKey; label: string; danger?: boolean } | { sep: true; key: string };
const ACTIONS: ActionItem[] = [
  { key: "apply_template", label: "Apply template…" },
  { key: "sep0", sep: true },
  { key: "active", label: "Set as Active" },
  { key: "draft", label: "Unlist products (set to Draft)" },
  { key: "archive", label: "Archive products" },
  { key: "sep1", sep: true },
  { key: "tags_add", label: "Add tags…" },
  { key: "tags_remove", label: "Remove tags…" },
  { key: "sep2", sep: true },
  { key: "collection_add", label: "Add to collection…" },
  { key: "collection_remove", label: "Remove from collection…" },
  { key: "sep3", sep: true },
  { key: "channels_include", label: "Include in sales channels…" },
  { key: "channels_exclude", label: "Exclude from sales channels…" },
  { key: "catalogs_include", label: "Include in catalogs…" },
  { key: "catalogs_exclude", label: "Exclude from catalogs…" },
  { key: "sep4", sep: true },
  { key: "delete", label: "Delete products on Shopify", danger: true },
];

const statusBadge = (s: string) => {
  const up = (s || "").toUpperCase();
  const c = up === "ACTIVE" ? { bg: "#EAF7F0", fg: "#158A57" } : up === "ARCHIVED" ? { bg: "#F1F1F4", fg: "#66788E" } : { bg: "#FFF6E6", fg: "#B7791F" };
  return <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: c.bg, color: c.fg }}>{up || "DRAFT"}</span>;
};

export default function ShopifyProductsClient({ stores, sellers, canEdit }: { stores: Store[]; sellers: Seller[]; canEdit: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [kw, setKw] = useState(""); const [sellerFilter, setSellerFilter] = useState(""); const [storeFilter, setStoreFilter] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(20);
  const [syncStore, setSyncStore] = useState(stores[0]?.id ?? "");
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Detail | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  // AI model
  const [aiModels, setAiModels] = useState<{ id: string; name: string }[]>([]);
  const [aiModel, setAiModel] = useState("");
  // Bulk price
  const [bpOpen, setBpOpen] = useState(false);
  const [bpValues, setBpValues] = useState<{ name: string; value: string; count: number; current: string }[]>([]);
  const [bpPrices, setBpPrices] = useState<Record<string, string>>({});
  const [bpLoading, setBpLoading] = useState(false);
  // Bulk actions ("More actions")
  const [actionsOpen, setActionsOpen] = useState(false);
  const [act, setAct] = useState<null | { key: ActKey; title: string; kind: "tags" | "collection" | "publication" | "template"; storeId: string; loading: boolean; items: { id: string; label: string }[] }>(null);
  const [tagInput, setTagInput] = useState("");
  const [pickOne, setPickOne] = useState("");
  const [pickMany, setPickMany] = useState<Set<string>>(new Set());
  const confirm = useConfirm();
  const askPrompt = usePrompt();

  const flash = (text: string, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 5000); };
  const load = async () => { setLoading(true); try { const j = await fetch("/api/shopify-products").then((r) => r.json()); if (j.ok) setRows(j.rows); } catch { /* noop */ } setLoading(false); };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    try { const s = window.localStorage.getItem("shopifyAiModel"); if (s) setAiModel(s); } catch { /* ignore */ }
    fetch("/api/books/models?type=text").then((r) => r.json()).then((j) => { if (Array.isArray(j?.models)) setAiModels(j.models); }).catch(() => { /* offline */ });
  }, []);
  const chooseModel = (m: string) => { setAiModel(m); try { window.localStorage.setItem("shopifyAiModel", m); } catch { /* ignore */ } };

  const showSellerFilter = sellers.length > 1;
  const storesForFilter = useMemo(() => sellerFilter ? stores.filter((s) => s.sellerId === sellerFilter) : stores, [stores, sellerFilter]);
  const filtered = useMemo(() => rows.filter((r) =>
    (!sellerFilter || stores.find((s) => s.id === r.storeId)?.sellerId === sellerFilter) &&
    (!storeFilter || r.storeId === storeFilter) &&
    (!kw.trim() || (r.title + " " + (r.handle ?? "")).toLowerCase().includes(kw.trim().toLowerCase()))
  ), [rows, kw, sellerFilter, storeFilter, stores]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => { setPage(1); }, [kw, sellerFilter, storeFilter, pageSize]);
  const pageC = Math.min(page, totalPages);
  const paged = useMemo(() => filtered.slice((pageC - 1) * pageSize, pageC * pageSize), [filtered, pageC, pageSize]);
  const allChecked = paged.length > 0 && paged.every((r) => sel.has(r.id));
  const toggleAll = () => { const n = new Set(sel); if (allChecked) paged.forEach((r) => n.delete(r.id)); else paged.forEach((r) => n.add(r.id)); setSel(n); };
  const toggle = (id: string) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };

  const doSync = async () => {
    if (!syncStore) return flash("✗ Chưa có store Shopify — thêm store + cấu hình API trong Stores trước", false);
    setBusy(true);
    try {
      const j = await fetch("/api/shopify-products/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId: syncStore }) }).then((r) => r.json());
      if (j.ok) { flash(`✓ Synced ${j.store}: ${j.total} products (+${j.created} new · ${j.updated} updated${j.skippedDirty ? ` · ${j.skippedDirty} kept local edits` : ""})`); load(); }
      else flash("✗ " + (j.error ?? "Sync failed") + (/read_products|scope/i.test(j.error ?? "") ? "" : ""), false);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
    setBusy(false);
  };
  const openEdit = async (id: string) => {
    setEditId(id); setEdit(null); setEditLoading(true);
    try { const j = await fetch(`/api/shopify-products?id=${id}`).then((r) => r.json()); if (j.ok) setEdit(j.product); else { flash("✗ " + (j.error ?? "Load failed"), false); setEditId(null); } }
    catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); setEditId(null); }
    setEditLoading(false);
  };
  // Save = tự đẩy lên Shopify luôn (không còn bước Push riêng).
  const saveEdit = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      const p = await fetch("/api/shopify-products", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        id: edit.id, title: edit.title, bodyHtml: edit.bodyHtml, tags: edit.tags, status: edit.status,
        vendor: edit.vendor, productType: edit.productType, variants: edit.variants, images: edit.images,
        seoTitle: edit.seoTitle, seoDescription: edit.seoDescription,
      }) }).then((r) => r.json());
      if (!p.ok) { flash("✗ " + (p.error ?? "Save failed"), false); setBusy(false); return; }
      const j = await fetch("/api/shopify-products/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [edit.id] }) }).then((r) => r.json());
      if (j.ok || j.pushed) { flash("✓ Saved & updated on Shopify"); setEditId(null); load(); }
      else { const err = (j.results ?? [])[0]?.error ?? j.error ?? "push failed"; flash("✗ Saved locally but Shopify update failed: " + err + (/write_products|scope|access/i.test(String(err)) ? " — add scope write_products + reinstall app" : ""), false); setEditId(null); load(); }
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
    setBusy(false);
  };
  const doPush = async (ids: string[]) => {
    if (!ids.length) return flash("✗ Select products first", false);
    setBusy(true);
    try {
      const j = await fetch("/api/shopify-products/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }).then((r) => r.json());
      if (j.ok || j.pushed) {
        const fail = (j.results ?? []).filter((r: { ok: boolean }) => !r.ok);
        flash(`✓ Pushed ${j.pushed}/${(j.results ?? []).length}${j.failed ? ` · ${j.failed} failed: ${fail[0]?.error ?? ""}` : ""}`, j.failed === 0); load();
      } else flash("✗ " + (j.error ?? (j.results ?? [])[0]?.error ?? "Push failed") + (/write_products|scope|access/i.test(JSON.stringify(j)) ? " — thêm scope write_products + Install lại app" : ""), false);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
    setBusy(false);
  };
  const doAiOptimize = async () => {
    if (!sel.size) return flash("✗ Select products first", false);
    setBusy(true);
    const idsAll = Array.from(sel); let done = 0; const errs: string[] = [];
    for (let i = 0; i < idsAll.length; i += 20) {
      const batch = idsAll.slice(i, i + 20);
      try {
        const j = await fetch("/api/shopify-products/ai-optimize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: batch, model: aiModel || undefined }) }).then((r) => r.json());
        if (j.ok) { done += j.optimized ?? 0; if (j.errors) errs.push(...j.errors); } else errs.push(j.error ?? "failed");
      } catch (e) { errs.push(String((e as Error)?.message ?? "network")); }
    }
    if (done > 0) {
      const push = await fetch("/api/shopify-products/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: idsAll }) }).then((r) => r.json()).catch(() => ({}));
      flash(`✓ AI optimized ${done}/${idsAll.length} — updated ${push.pushed ?? 0} on Shopify`, (push.failed ?? 0) === 0);
    } else flash(`✗ AI Optimize failed: ${errs[0] ?? "unknown"}`, false);
    load();
    setBusy(false);
  };
  const doDelete = async () => {
    if (!sel.size) return;
    if (!(await confirm({ message: `Remove ${sel.size} product(s) from the FUSION list?\nThis does NOT delete them on Shopify — only removes them from this table.`, confirmText: "Remove", danger: true }))) return;
    setBusy(true);
    try { const j = await fetch("/api/shopify-products", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(sel) }) }).then((r) => r.json());
      if (j.ok) { flash(`✓ Removed ${j.deleted}`); setSel(new Set()); load(); } else flash("✗ " + (j.error ?? "Delete failed"), false);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
    setBusy(false);
  };
  const openBulkPrice = async () => {
    if (!sel.size) return flash("✗ Select products first", false);
    setBpOpen(true); setBpLoading(true); setBpValues([]); setBpPrices({});
    try {
      const j = await fetch("/api/shopify-products/bulk-price", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(sel) }) }).then((r) => r.json());
      if (j.ok) { setBpValues(j.values ?? []); const init: Record<string, string> = {}; (j.values ?? []).forEach((v: { value: string; current: string }) => { init[v.value] = ""; }); setBpPrices(init); }
      else { flash("✗ " + (j.error ?? "Failed"), false); setBpOpen(false); }
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); setBpOpen(false); }
    setBpLoading(false);
  };
  const applyBulkPrice = async () => {
    setBusy(true);
    try { const j = await fetch("/api/shopify-products/bulk-price", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(sel), prices: bpPrices }) }).then((r) => r.json());
      if (j.ok) {
        setBpOpen(false);
        const push = await fetch("/api/shopify-products/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(sel) }) }).then((r) => r.json());
        flash(`✓ Priced ${j.sizes} size(s) · ${j.variantsSet} variants across ${j.updated} product(s) — updated ${push.pushed ?? 0} on Shopify`, (push.failed ?? 0) === 0);
        load();
      } else flash("✗ " + (j.error ?? "Failed"), false);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
    setBusy(false);
  };

  // ---- bulk actions ("More actions") ----
  const selStoreIds = () => Array.from(new Set(rows.filter((r) => sel.has(r.id)).map((r) => r.storeId)));
  const postAction = async (payload: Record<string, unknown>, okMsg: (r: { done: number; failed: number; skipped: number; results?: { ok: boolean; error?: string }[] }) => string) => {
    setBusy(true);
    try {
      const j = await fetch("/api/shopify-products/bulk-action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(sel), ...payload }) }).then((r) => r.json());
      if (j.ok || j.done) { flash(okMsg(j), (j.failed ?? 0) === 0); setSel(new Set()); load(); }
      else { const err = j.error ?? (j.results ?? []).find((r: { ok: boolean }) => !r.ok)?.error ?? "Action failed"; flash("✗ " + err + (/write_products|scope|access|publications/i.test(String(err)) ? " — add scope write_products/write_publications + reinstall app" : ""), false); }
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
    setBusy(false);
  };
  const runAction = async (key: ActKey) => {
    setActionsOpen(false);
    if (!sel.size) return flash("✗ Select products first", false);
    // Lifecycle nhanh (có confirm)
    if (key === "active" || key === "draft" || key === "archive") {
      const word = key === "active" ? "set ACTIVE" : key === "draft" ? "Unlist (set DRAFT)" : "Archive";
      if (!(await confirm({ message: `${word} ${sel.size} product(s) on Shopify?`, confirmText: "Apply", tone: "green" }))) return;
      return postAction({ action: key }, (r) => `✓ ${word}: ${r.done} done${r.failed ? ` · ${r.failed} failed` : ""}`);
    }
    if (key === "delete") {
      if (!(await confirm({ title: "Delete on Shopify", message: `Permanently DELETE ${sel.size} product(s) on Shopify?\nThis cannot be undone.`, danger: true, confirmText: "Delete" }))) return;
      if (!(await confirm({ title: "Confirm delete", message: `Confirm again: permanently delete ${sel.size} product(s) on Shopify AND remove them from this list?`, danger: true, confirmText: "Delete permanently" }))) return;
      return postAction({ action: "delete" }, (r) => `✓ Deleted ${r.done} on Shopify${r.failed ? ` · ${r.failed} failed` : ""}`);
    }
    // Tags → mở modal nhập
    if (key === "tags_add" || key === "tags_remove") {
      setTagInput(""); setAct({ key, title: key === "tags_add" ? "Add tags" : "Remove tags", kind: "tags", storeId: "", loading: false, items: [] });
      return;
    }
    // Picker actions (template / collection / channels / catalogs) — cần đúng 1 store
    const sids = selStoreIds();
    if (sids.length !== 1) return flash("✗ These actions need products from ONE store — filter by store first (template/channel/collection IDs are per store).", false);
    const storeId = sids[0];
    // Apply template — nạp danh sách template của store
    if (key === "apply_template") {
      setPickOne("");
      setAct({ key, title: "Apply template", kind: "template", storeId, loading: true, items: [] });
      try {
        const j = await fetch(`/api/shopify-templates?storeId=${storeId}`).then((r) => r.json());
        if (!j.ok) { flash("✗ " + (j.error ?? "Load failed"), false); setAct(null); return; }
        const items = (j.templates ?? []).map((t: { id: string; name: string }) => ({ id: t.id, label: t.name }));
        if (!items.length) flash("✗ No templates for this store — create one in Manage Templates · Shopify", false);
        setAct((a) => a ? { ...a, loading: false, items } : a);
      } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); setAct(null); }
      return;
    }
    const kind: "collection" | "publication" = (key === "collection_add" || key === "collection_remove") ? "collection" : "publication";
    const catalogMode = key === "catalogs_include" || key === "catalogs_exclude";
    const titleMap: Record<string, string> = {
      collection_add: "Add to collection", collection_remove: "Remove from collection",
      channels_include: "Include in sales channels", channels_exclude: "Exclude from sales channels",
      catalogs_include: "Include in catalogs", catalogs_exclude: "Exclude from catalogs",
    };
    setPickOne(""); setPickMany(new Set());
    setAct({ key, title: titleMap[key], kind, storeId, loading: true, items: [] });
    try {
      const j = await fetch(`/api/shopify-products/channels?storeId=${storeId}`).then((r) => r.json());
      if (!j.ok) { flash("✗ " + (j.error ?? "Load failed"), false); setAct(null); return; }
      const items: { id: string; label: string }[] = kind === "collection"
        ? (j.collections ?? []).map((c: { id: string; title: string }) => ({ id: c.id, label: c.title }))
        : catalogMode
          ? (j.catalogs ?? []).map((c: { publicationId: string; name: string }) => ({ id: c.publicationId, label: c.name }))
          : (j.publications ?? []).map((p: { id: string; name: string }) => ({ id: p.id, label: p.name }));
      setAct((a) => a ? { ...a, loading: false, items } : a);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); setAct(null); }
  };
  const submitAct = async () => {
    if (!act) return;
    if (act.kind === "template") {
      if (!pickOne) return flash("✗ Pick a template", false);
      const templateId = pickOne;
      setAct(null); setBusy(true);
      try {
        const j = await fetch("/api/shopify-products/apply-template", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(sel), templateId }) }).then((r) => r.json());
        if (j.ok || j.done) { flash(`✓ Applied template to ${j.done} product(s)${j.failed ? ` · ${j.failed} failed` : ""}${j.skipped ? ` · ${j.skipped} skipped (other store)` : ""}`, (j.failed ?? 0) === 0); setSel(new Set()); load(); }
        else { const err = j.error ?? (j.results ?? []).find((r: { ok: boolean }) => !r.ok)?.error ?? "Apply failed"; flash("✗ " + err, false); }
      } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
      setBusy(false);
      return;
    }
    if (act.kind === "tags") {
      const tags = tagInput.split(",").map((t) => t.trim()).filter(Boolean);
      if (!tags.length) return flash("✗ Enter at least one tag", false);
      setAct(null);
      return postAction({ action: act.key, tags: tags.join(",") }, (r) => `✓ ${act.key === "tags_add" ? "Added" : "Removed"} tags on ${r.done} product(s)${r.failed ? ` · ${r.failed} failed` : ""}`);
    }
    if (act.kind === "collection") {
      if (!pickOne) return flash("✗ Pick a collection", false);
      const payload = { action: act.key, storeId: act.storeId, collectionId: pickOne };
      setAct(null);
      return postAction(payload, (r) => `✓ ${act.key === "collection_add" ? "Added to" : "Removed from"} collection: ${r.done}${r.failed ? ` · ${r.failed} failed` : ""}${r.skipped ? ` · ${r.skipped} skipped (other store)` : ""}`);
    }
    // publication (channels/catalogs)
    if (!pickMany.size) return flash("✗ Pick at least one", false);
    const payload = { action: act.key, storeId: act.storeId, publicationIds: Array.from(pickMany) };
    const verb = act.key.endsWith("_include") ? "Included" : "Excluded";
    setAct(null);
    return postAction(payload, (r) => `✓ ${verb} ${r.done} product(s)${r.failed ? ` · ${r.failed} failed` : ""}${r.skipped ? ` · ${r.skipped} skipped (other store)` : ""}`);
  };

  // ---- edit modal helpers ----
  const setV = (i: number, k: keyof Variant, val: string) => { if (!edit) return; const vs = edit.variants.slice(); (vs[i] as Record<string, unknown>)[k] = val; setEdit({ ...edit, variants: vs }); };
  const delImg = (i: number) => { if (!edit) return; setEdit({ ...edit, images: edit.images.filter((_, k) => k !== i) }); };
  const moveImg = (i: number, dir: -1 | 1) => { if (!edit) return; const j = i + dir; if (j < 0 || j >= edit.images.length) return; const a = edit.images.slice(); [a[i], a[j]] = [a[j], a[i]]; setEdit({ ...edit, images: a }); };
  const addImg = async () => { if (!edit) return; const url = await askPrompt({ title: "Add image by URL", message: "Paste an image URL (https://...)", input: { placeholder: "https://…" } }); if (!url || !/^https?:\/\//i.test(url)) return; setEdit((e) => e ? { ...e, images: [...e.images, { id: "", src: url.trim(), altText: "", position: e.images.length + 1 }] } : e); };
  const uploadImg = async (file: File | null | undefined) => {
    if (!edit || !file) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const j = await fetch("/api/product-image/upload", { method: "POST", body: fd }).then((r) => r.json());
      if (j.ok && j.url) setEdit((e) => e ? { ...e, images: [...e.images, { id: "", src: j.url, altText: "", position: e.images.length + 1 }] } : e);
      else flash("✗ " + (j.error ?? "Upload failed"), false);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
    setBusy(false);
  };

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 4px" }}>
      {/* Hero */}
      <div style={{ ...card, padding: "18px 22px", marginBottom: 14, display: "flex", alignItems: "center", gap: 14, background: "linear-gradient(90deg,#F3FBF6,#fff)" }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: SHOP_GREEN, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 22 }}>S</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 19, fontWeight: 800 }}>Manage Products · Shopify</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{rows.length} products · Sync from Shopify → edit price/variants/images → Push back (two-way, no CSV)</div>
        </div>
        {canEdit && (
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <select value={syncStore} onChange={(e) => setSyncStore(e.target.value)} style={{ ...ctl, maxWidth: 170 }}>
              {stores.length === 0 && <option value="">No Shopify store</option>}
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button disabled={busy} onClick={doSync} style={{ ...pill(SHOP_GREEN, "#fff"), opacity: busy ? .6 : 1 }}>⟳ Sync from Shopify</button>
          </span>
        )}
      </div>

      {/* Filters */}
      <div style={{ ...card, padding: "12px 16px", marginBottom: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="Search title / handle" style={{ ...ctl, flex: 1, minWidth: 200 }} />
        {showSellerFilter && (
          <select value={sellerFilter} onChange={(e) => { setSellerFilter(e.target.value); setStoreFilter(""); }} style={ctl}>
            <option value="">All sellers</option>{sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} style={ctl}>
          <option value="">All stores</option>{storesForFilter.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>{sel.size ? `${sel.size} selected` : `${filtered.length} products`}</span>
      </div>

      {/* Selection bar */}
      {sel.size > 0 && (
        <div style={{ ...card, padding: "10px 14px", marginBottom: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", background: "#F3FBF6", borderColor: "#CDEFD8" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: SHOP_GREEN }}>{sel.size} selected</span>
          <div style={{ flex: 1 }} />
          {canEdit && (
            <select value={aiModel} onChange={(e) => chooseModel(e.target.value)} title="AI model for Optimize" style={{ ...ctl, padding: "8px 10px", fontSize: 12.5, maxWidth: 200 }}>
              <option value="">AI model: Default</option>{aiModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
          {canEdit && <button disabled={busy} onClick={doAiOptimize} style={{ ...pill("linear-gradient(135deg,#7C5CFF,#6D48C9)", "#fff"), opacity: busy ? .6 : 1 }}>✦ AI Optimize</button>}
          {canEdit && <button disabled={busy} onClick={openBulkPrice} style={{ ...pill("linear-gradient(135deg,#F59E0B,#D97706)", "#fff"), opacity: busy ? .6 : 1 }}>◫ Bulk Price</button>}
          {canEdit && (
            <div style={{ position: "relative" }}>
              <button disabled={busy} onClick={() => setActionsOpen((v) => !v)} style={{ ...ghost, padding: "9px 12px" }}>More actions ▾</button>
              {actionsOpen && (
                <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 30, minWidth: 230, background: "#fff", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,.12)", padding: 6 }} onMouseLeave={() => setActionsOpen(false)}>
                  {ACTIONS.map((a) => "sep" in a ? (
                    <div key={a.key} style={{ height: 1, background: "var(--line)", margin: "5px 4px" }} />
                  ) : (
                    <button key={a.key} disabled={busy} onClick={() => runAction(a.key)} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", fontSize: 13, border: "none", background: "none", borderRadius: 8, cursor: "pointer", color: a.danger ? "var(--red)" : "var(--ink)" }} onMouseEnter={(e) => (e.currentTarget.style.background = "#F3F5F8")} onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>{a.label}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {canEdit && <button disabled={busy} onClick={doDelete} style={{ ...ghost, color: "var(--red)", borderColor: "#F3C9C9" }}>🗑 Remove local</button>}
          <button onClick={() => setSel(new Set())} style={{ ...ghost, padding: "9px 12px" }}>Clear</button>
        </div>
      )}

      {msg && <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 12, background: msg.ok ? "#EAF7F0" : "#FDECEC", color: msg.ok ? "#158A57" : "#C0392B", border: `1px solid ${msg.ok ? "#C7EAD8" : "#F5CFCF"}` }}>{msg.text}</div>}

      {/* Table */}
      <div style={{ ...card, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#FAFBFC", color: "var(--muted)", fontSize: 11.5, textTransform: "uppercase" }}>
              <th style={{ padding: "10px 12px", textAlign: "left", width: 34 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} /></th>
              <th style={{ padding: "10px 6px", textAlign: "left" }}>Image</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Title</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Store / Seller</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Options</th>
              <th style={{ padding: "10px 8px", textAlign: "right" }}>Price</th>
              <th style={{ padding: "10px 8px", textAlign: "center" }}>Status</th>
              <th style={{ padding: "10px 12px", textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>Loading…</td></tr>}
            {!loading && paged.length === 0 && <tr><td colSpan={8} style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>No products. Chọn store rồi bấm <b>Sync from Shopify</b>.</td></tr>}
            {paged.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: "10px 12px" }}><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td style={{ padding: "8px 6px" }}>{r.mainImage ? <img src={r.mainImage} alt="" width={42} height={42} style={{ width: 42, height: 42, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} /> : <div style={{ width: 42, height: 42, borderRadius: 8, background: "#F1F1F4" }} />}</td>
                <td style={{ padding: "8px" }}>
                  <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>{r.title.slice(0, 70)}{r.dirty && <span title="Có chỉnh sửa chưa Push" style={{ fontSize: 10, fontWeight: 800, color: "#B7791F", background: "#FFF6E6", padding: "1px 6px", borderRadius: 999 }}>EDITED</span>}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.variantCount} variants · {r.imageCount} images{r.totalInventory != null ? ` · inv ${r.totalInventory}` : ""}</div>
                </td>
                <td style={{ padding: "8px", fontSize: 12 }}>{r.storeName ?? "—"}<div style={{ color: "var(--muted)" }}>{r.sellerName ?? "—"}</div></td>
                <td style={{ padding: "8px", fontSize: 12, color: "var(--muted)" }}>{r.optionsSummary || "—"}</td>
                <td style={{ padding: "8px", textAlign: "right", whiteSpace: "nowrap" }}>{r.minPrice != null && r.maxPrice != null && r.minPrice !== r.maxPrice ? `${money(r.minPrice)}–${money(r.maxPrice)}` : money(r.minPrice)}</td>
                <td style={{ padding: "8px", textAlign: "center" }}>{statusBadge(r.status)}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                  {canEdit && <button onClick={() => openEdit(r.id)} style={{ ...linkBtn("var(--blue)"), marginRight: 10 }}>Edit</button>}
                  {r.onlineStoreUrl && <a href={r.onlineStoreUrl} target="_blank" rel="noreferrer" style={{ ...linkBtn(SHOP_GREEN), textDecoration: "none", marginRight: 10 }}>Open</a>}
                  {canEdit && r.dirty && <button onClick={() => doPush([r.id])} style={linkBtn("#B7791F")}>Push</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {filtered.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, fontSize: 13, color: "var(--muted)" }}>
          <span>Page {pageC}/{totalPages} · {filtered.length} products</span>
          <div style={{ flex: 1 }} />
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} style={{ ...ctl, padding: "6px 8px" }}>{[20, 50, 100].map((n) => <option key={n} value={n}>{n}/page</option>)}</select>
          <button disabled={pageC <= 1} onClick={() => setPage(pageC - 1)} style={{ ...ghost, opacity: pageC <= 1 ? .5 : 1 }}>Prev</button>
          <button disabled={pageC >= totalPages} onClick={() => setPage(pageC + 1)} style={{ ...ghost, opacity: pageC >= totalPages ? .5 : 1 }}>Next</button>
        </div>
      )}

      {/* EDIT MODAL */}
      {editId && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !busy && setEditId(null)}>
          <div style={{ ...card, width: 900, maxWidth: "97vw", maxHeight: "92vh", overflowY: "auto", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            {editLoading || !edit ? <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Loading…</div> : (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <b style={{ fontSize: 16 }}>Edit Shopify product {edit.dirty && <span style={{ fontSize: 11, color: "#B7791F" }}>· unsaved edits</span>}</b>
                  <button onClick={() => setEditId(null)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--muted)" }}>✕</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20 }} className="m-stack-sm">
                  {/* LEFT: images + status */}
                  <div>
                    <label style={lab}>Status</label>
                    <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })} style={{ ...ctl, width: "100%", marginBottom: 14 }}>
                      {["ACTIVE", "DRAFT", "ARCHIVED"].map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <label style={lab}>Images ({edit.images.length}) — kéo xóa/đổi thứ tự, ảnh đầu là ảnh chính</label>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                      {edit.images.map((im, i) => (
                        <div key={i} style={{ position: "relative", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
                          <img src={im.src} alt="" style={{ width: "100%", height: 78, objectFit: "cover", display: "block" }} />
                          {i === 0 && <span style={{ position: "absolute", top: 3, left: 3, fontSize: 9, fontWeight: 800, background: SHOP_GREEN, color: "#fff", padding: "1px 5px", borderRadius: 6 }}>MAIN</span>}
                          {!im.id && <span style={{ position: "absolute", top: 3, left: 3, fontSize: 9, fontWeight: 800, background: "#B7791F", color: "#fff", padding: "1px 5px", borderRadius: 6 }}>NEW</span>}
                          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, display: "flex", justifyContent: "space-between", background: "rgba(0,0,0,.45)", padding: "2px 4px" }}>
                            <button onClick={() => moveImg(i, -1)} style={{ ...linkBtn("#fff"), fontSize: 13 }}>◀</button>
                            <button onClick={() => delImg(i)} style={{ ...linkBtn("#FCA5A5"), fontSize: 12 }}>✕</button>
                            <button onClick={() => moveImg(i, 1)} style={{ ...linkBtn("#fff"), fontSize: 13 }}>▶</button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <label style={{ ...ghost, fontSize: 12.5, flex: 1, textAlign: "center", cursor: busy ? "default" : "pointer", opacity: busy ? .6 : 1 }}>
                        {busy ? "Uploading…" : "⬆ Upload image"}
                        <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => { uploadImg(e.target.files?.[0]); e.currentTarget.value = ""; }} />
                      </label>
                      <button onClick={addImg} style={{ ...ghost, fontSize: 12.5, flex: 1 }}>+ Add by URL</button>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>Store: {edit.storeName} · handle: {edit.handle}</div>
                  </div>
                  {/* RIGHT: fields + variants */}
                  <div>
                    <label style={lab}>Title</label>
                    <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} style={{ ...ctl, width: "100%", marginBottom: 12 }} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                      <div><label style={lab}>Vendor</label><input value={edit.vendor ?? ""} onChange={(e) => setEdit({ ...edit, vendor: e.target.value })} style={{ ...ctl, width: "100%" }} /></div>
                      <div><label style={lab}>Type</label><input value={edit.productType ?? ""} onChange={(e) => setEdit({ ...edit, productType: e.target.value })} style={{ ...ctl, width: "100%" }} /></div>
                    </div>
                    <label style={lab}>Tags (comma-separated)</label>
                    <input value={edit.tags ?? ""} onChange={(e) => setEdit({ ...edit, tags: e.target.value })} style={{ ...ctl, width: "100%", marginBottom: 12 }} />
                    <label style={lab}>Description (HTML)</label>
                    <textarea value={edit.bodyHtml ?? ""} onChange={(e) => setEdit({ ...edit, bodyHtml: e.target.value })} rows={4} style={{ ...ctl, width: "100%", resize: "vertical", marginBottom: 14 }} />
                    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px", marginBottom: 14, background: "#FAFBFD" }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: "#334155", marginBottom: 8 }}>Search engine listing (Google)</div>
                      <label style={lab}>Page title <span style={{ fontWeight: 500 }}>({(edit.seoTitle ?? "").length}/60)</span></label>
                      <input value={edit.seoTitle ?? ""} onChange={(e) => setEdit({ ...edit, seoTitle: e.target.value })} maxLength={70} placeholder="Shown as the blue link on Google" style={{ ...ctl, width: "100%", marginBottom: 10 }} />
                      <label style={lab}>Meta description <span style={{ fontWeight: 500 }}>({(edit.seoDescription ?? "").length}/155)</span></label>
                      <textarea value={edit.seoDescription ?? ""} onChange={(e) => setEdit({ ...edit, seoDescription: e.target.value })} maxLength={320} rows={2} placeholder="Shown under the link on Google" style={{ ...ctl, width: "100%", resize: "vertical" }} />
                    </div>
                    <label style={lab}>Variants ({edit.variants.length}) — giá / compare-at / SKU</label>
                    <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                        <thead><tr style={{ background: "#FAFBFC", color: "var(--muted)", fontSize: 11 }}>
                          <th style={{ padding: "6px 8px", textAlign: "left" }}>Variant</th>
                          <th style={{ padding: "6px 8px", textAlign: "right" }}>Price</th>
                          <th style={{ padding: "6px 8px", textAlign: "right" }}>Compare-at</th>
                          <th style={{ padding: "6px 8px", textAlign: "left" }}>SKU</th>
                          <th style={{ padding: "6px 8px", textAlign: "right" }}>Inv</th>
                        </tr></thead>
                        <tbody>
                          {edit.variants.map((v, i) => (
                            <tr key={v.id || i} style={{ borderTop: "1px solid var(--line)" }}>
                              <td style={{ padding: "6px 8px" }}>{(v.selectedOptions ?? []).map((o) => o.value).join(" / ") || v.title || "Default"}</td>
                              <td style={{ padding: "4px 8px", textAlign: "right" }}><input type="number" step="0.01" min="0" value={v.price} onChange={(e) => setV(i, "price", e.target.value)} style={{ ...ctl, width: 82, padding: "6px 8px", textAlign: "right" }} /></td>
                              <td style={{ padding: "4px 8px", textAlign: "right" }}><input type="number" step="0.01" min="0" value={v.compareAtPrice ?? ""} onChange={(e) => setV(i, "compareAtPrice", e.target.value)} placeholder="—" style={{ ...ctl, width: 82, padding: "6px 8px", textAlign: "right" }} /></td>
                              <td style={{ padding: "4px 8px" }}><input value={v.sku} onChange={(e) => setV(i, "sku", e.target.value)} style={{ ...ctl, width: 120, padding: "6px 8px" }} /></td>
                              <td style={{ padding: "6px 8px", textAlign: "right", color: "var(--muted)" }}>{v.inventoryQty ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
                      <button onClick={() => setEditId(null)} style={ghost}>Cancel</button>
                      <button disabled={busy} onClick={saveEdit} style={{ ...pill(SHOP_GREEN, "#fff"), opacity: busy ? .6 : 1 }}>{busy ? "Saving…" : "Save (auto-updates Shopify)"}</button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* BULK PRICE MODAL */}
      {bpOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !busy && setBpOpen(false)}>
          <div style={{ ...card, width: 480, maxWidth: "96vw", maxHeight: "90vh", overflowY: "auto", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <b style={{ fontSize: 16 }}>◫ Bulk Price by Size</b>
              <button onClick={() => setBpOpen(false)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--muted)" }}>✕</button>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14, lineHeight: 1.5 }}>Đặt giá theo giá trị option (size…) cho <b>{sel.size}</b> sản phẩm đã chọn. Để trống = giữ nguyên. Lưu vào bản local (dirty) → bấm <b>Push</b> để áp lên Shopify.</div>
            {bpLoading ? <div style={{ padding: "24px 0", textAlign: "center", color: "var(--muted)" }}>Loading…</div>
              : bpValues.length === 0 ? <div style={{ padding: "24px 0", textAlign: "center", color: "var(--muted)" }}>No option values.</div>
              : <div style={{ display: "grid", gap: 8 }}>
                  {bpValues.map((v) => (
                    <div key={v.value} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }} title={v.value}>{v.value}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{v.name || "Option"} · {v.count} variants · now {v.current ? "$" + v.current : "—"}</div>
                      </div>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <span style={{ color: "var(--muted)", fontSize: 13 }}>$</span>
                        <input type="number" step="0.01" min="0" value={bpPrices[v.value] ?? ""} placeholder="—" onChange={(e) => setBpPrices((p) => ({ ...p, [v.value]: e.target.value }))} style={{ ...ctl, width: 100, padding: "8px 10px", textAlign: "right" }} />
                      </div>
                    </div>
                  ))}
                </div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
              <button onClick={() => setBpOpen(false)} style={ghost}>Cancel</button>
              <button disabled={busy || bpLoading} onClick={applyBulkPrice} style={{ ...pill("linear-gradient(135deg,#F59E0B,#D97706)", "#fff"), opacity: (busy || bpLoading) ? .6 : 1 }}>Apply prices</button>
            </div>
          </div>
        </div>
      )}

      {/* BULK ACTION MODAL (tags / collection / channels / catalogs) */}
      {act && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !busy && setAct(null)}>
          <div style={{ ...card, width: 440, maxWidth: "96vw", maxHeight: "90vh", overflowY: "auto", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <b style={{ fontSize: 16 }}>{act.title}</b>
              <button onClick={() => setAct(null)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--muted)" }}>✕</button>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14 }}>Applies to <b>{sel.size}</b> selected product(s) — runs on Shopify.</div>

            {act.kind === "tags" && (
              <div>
                <label style={lab}>Tags (comma-separated)</label>
                <input autoFocus value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="e.g. summer, sale, tshirt" style={{ ...ctl, width: "100%" }} />
              </div>
            )}

            {act.kind !== "tags" && (
              act.loading ? <div style={{ padding: "24px 0", textAlign: "center", color: "var(--muted)" }}>Loading…</div>
              : act.items.length === 0 ? <div style={{ padding: "20px 0", textAlign: "center", color: "var(--muted)" }}>{act.kind === "collection" ? "No manual collections on this store." : act.kind === "template" ? "No templates for this store — create one in Manage Templates · Shopify." : "None available on this store."}</div>
              : <div style={{ display: "grid", gap: 4, maxHeight: 320, overflowY: "auto" }}>
                  {act.items.map((it) => (act.kind === "collection" || act.kind === "template") ? (
                    <label key={it.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, cursor: "pointer", background: pickOne === it.id ? "#F3FBF6" : "transparent" }}>
                      <input type="radio" name="pickCol" checked={pickOne === it.id} onChange={() => setPickOne(it.id)} />
                      <span style={{ fontSize: 13.5 }}>{it.label}</span>
                    </label>
                  ) : (
                    <label key={it.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, cursor: "pointer", background: pickMany.has(it.id) ? "#F3FBF6" : "transparent" }}>
                      <input type="checkbox" checked={pickMany.has(it.id)} onChange={() => setPickMany((s) => { const n = new Set(s); n.has(it.id) ? n.delete(it.id) : n.add(it.id); return n; })} />
                      <span style={{ fontSize: 13.5 }}>{it.label}</span>
                    </label>
                  ))}
                </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
              <button onClick={() => setAct(null)} style={ghost}>Cancel</button>
              <button disabled={busy || act.loading} onClick={submitAct} style={{ ...pill(SHOP_GREEN, "#fff"), opacity: (busy || act.loading) ? .6 : 1 }}>{busy ? "Working…" : "Apply"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
