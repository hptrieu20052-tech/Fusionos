"use client";
/**
 * MANAGE PRODUCTS WOOCOMMERCE (v497, redesign v499 theo khuôn ShopBase) — seller tự list
 * sản phẩm, tạo category, sửa sản phẩm TRỰC TIẾP từ FUSION. Đọc/ghi sống qua Woo REST
 * (không bảng sync riêng — không cần nút Sync).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { MarketplaceLogo } from "@/components/marketplace-logo";
import { buildTypeChips, chipOn, toggleChip, type TypeChip } from "@/lib/woo-type-chips";

type StoreOpt = { id: string; name: string; sellerId: string | null; sellerName: string | null };
type Cat = { id: number; name: string; parent: number; count: number; slug: string };
type Tpl = { id: string; name: string; title: string | null; description: string | null; price: string | null; salePrice: string | null; categoryIds: number[]; tags: string | null; status: string; thumb?: string | null; wcpStyles?: string[]; editable?: boolean; creator?: string };
type Prod = {
  id: number; name: string; sku: string; status: string; editable?: boolean; creator?: string; tplName?: string;
  price: string; regularPrice: string; salePrice: string;
  permalink: string; thumb: string;
  images: { id: number; src: string }[];
  categories: { id: number; name: string }[];
  description: string; tags: string[]; totalSales: number; dateCreated: string;
  wcpStyles?: string[]; // v505 · Product Types (meta _wcp_selected_styles) — [] = all styles
};

const inp: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13.5, background: "#fff" };
const btnPri: React.CSSProperties = { background: "var(--ink)", color: "#fff", border: 0, borderRadius: 12, padding: "10px 18px", fontWeight: 800, fontSize: 13, cursor: "pointer" };
const btnBlue: React.CSSProperties = { background: "var(--blue)", color: "#fff", border: 0, borderRadius: 12, padding: "10px 18px", fontWeight: 800, fontSize: 13, cursor: "pointer" };
const btnGhost: React.CSSProperties = { background: "#fff", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer" };

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: "block", marginBottom: 10 }}><div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>{label}</div>{children}</label>;
}

// Nén ảnh phía client trước khi upload (max cạnh 1600px, JPEG q0.85) — đủ nét cho Woo.
async function compressImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const max = 1600, ratio = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.round(img.width * ratio), h = Math.round(img.height * ratio);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return c.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.85);
  } finally { URL.revokeObjectURL(url); }
}

export default function WooProductsClient({ stores, sellers, canEdit }: { stores: StoreOpt[]; sellers: { id: string; name: string }[]; canEdit: boolean }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const store = stores.find((s) => s.id === storeId);
  const [products, setProducts] = useState<Prod[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [search, setSearch] = useState("");
  const [fStatus, setFStatus] = useState("");     // "" = all (lọc server-side)
  const [fCat, setFCat] = useState(0);            // 0 = all (lọc server-side)
  const [fSeller, setFSeller] = useState("");     // "" = all (lọc theo người tạo — bảng owners)
  const [fTpl, setFTpl] = useState("");           // "" = all (lọc theo template đã dùng)
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [tplNeedSql, setTplNeedSql] = useState(false);
  const [ptypes, setPtypes] = useState<TypeChip[]>([]); // v505/v522 · chip Product Type (đã gộp theo Group)
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 4000); };

  const loadCats = useCallback(async (sid: string) => {
    if (!sid) return;
    const j = await fetch(`/api/woo-products/categories?storeId=${sid}`).then((r) => r.json()).catch(() => ({ ok: false }));
    if (j.ok) setCats(j.categories ?? []);
    const t = await fetch(`/api/woo-products/templates?storeId=${sid}`).then((r) => r.json()).catch(() => ({ ok: false }));
    if (t.ok) { setTpls((t.templates ?? []).map((x: Tpl) => ({ ...x, categoryIds: Array.isArray(x.categoryIds) ? x.categoryIds : [], wcpStyles: Array.isArray(x.wcpStyles) ? x.wcpStyles : [] }))); setTplNeedSql(!!t.needMigration); }
    // v505 · Product Types từ plugin trên store — để chọn khi list (pajama/calendar/book…).
    const pt = await fetch(`/api/woo-product-types?storeId=${sid}`).then((r) => r.json()).catch(() => ({ ok: false }));
    setPtypes(pt.ok ? buildTypeChips(pt.styles ?? []) : []);
  }, []);

  const loadProducts = useCallback(async (sid: string, q: string, pg: number, status: string, cat: number, seller = "", tpl = "") => {
    if (!sid) return;
    setBusy(true);
    const j = await fetch(`/api/woo-products?storeId=${sid}&search=${encodeURIComponent(q)}&page=${pg}&status=${status}&category=${cat || ""}&seller=${seller}&template=${tpl}`).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setBusy(false);
    if (j.ok) { setProducts(j.products ?? []); setTotal(Number(j.total) || 0); setTotalPages(Math.max(1, Number(j.totalPages) || 1)); setSel(new Set()); }
    else flash("✗ " + (j.error ?? "Error"));
  }, []);

  useEffect(() => { if (storeId) { setPage(1); loadProducts(storeId, "", 1, "", 0); loadCats(storeId); } }, [storeId, loadProducts, loadCats]);

  const goto = (pg: number) => { const n = Math.min(Math.max(pg, 1), totalPages); setPage(n); loadProducts(storeId, search, n, fStatus, fCat, fSeller, fTpl); };
  const doSearch = () => { setPage(1); loadProducts(storeId, search, 1, fStatus, fCat, fSeller, fTpl); };
  const shown = products;

  // ── Bulk chọn nhiều + đổi status hàng loạt (Woo products/batch) ──
  const toggleSel = (id: number) => setSel((s0) => { const n = new Set(s0); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSel((s0) => (s0.size === shown.length ? new Set<number>() : new Set(shown.map((p) => p.id))));
  const bulkStatus = async (status: "publish" | "draft") => {
    if (!sel.size) return;
    setBusy(true);
    const j = await fetch("/api/woo-products", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, ids: Array.from(sel), status }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setBusy(false);
    if (j.ok) { flash(`✓ ${j.updated} products → ${status}`); loadProducts(storeId, search, page, fStatus, fCat, fSeller, fTpl); }
    else flash("✗ " + (j.error ?? "Error"));
  };
  // v508 · Bulk edit giá / description cho các dòng đã tick (để trống = giữ nguyên).
  const emptyBulk = { regularPrice: "", salePrice: "", description: "", descriptionMode: "replace", setTypes: false, wcpStyles: [] as string[] };
  const [bulk, setBulk] = useState<typeof emptyBulk | null>(null);
  const bulkApply = async () => {
    if (!bulk || !sel.size) return;
    if (!bulk.regularPrice.trim() && !bulk.salePrice.trim() && !bulk.description.trim() && !bulk.setTypes) { flash("✗ Fill at least one field (blank = keep current)"); return; }
    setSaving(true);
    const j = await fetch("/api/woo-products", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, ids: Array.from(sel), set: {
      regularPrice: bulk.regularPrice.trim(), salePrice: bulk.salePrice.trim(),
      description: bulk.description, descriptionMode: bulk.descriptionMode,
      ...(bulk.setTypes ? { wcpStyles: bulk.wcpStyles } : {}), // v512 · gán Product Types hàng loạt
    } }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setSaving(false);
    if (j.ok) { flash(`✓ ${j.updated} products updated`); setBulk(null); loadProducts(storeId, search, page, fStatus, fCat, fSeller, fTpl); }
    else flash("✗ " + (j.error ?? "Error"));
  };
  // Export CSV: dòng đã tick (không tick gì = cả trang đang hiện)
  const exportCsv = () => {
    const rows = (sel.size ? shown.filter((p) => sel.has(p.id)) : shown);
    const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = ["ID,Title,SKU,Price,Sale price,Status,Categories,Tags,Orders,Link",
      ...rows.map((p) => [p.id, esc(p.name), esc(p.sku), p.regularPrice || p.price, p.salePrice, p.status, esc(p.categories.map((c) => c.name).join(" | ")), esc(p.tags.join(" | ")), p.totalSales, esc(p.permalink)].join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `woo-products-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  // ── v518 · Copy link / Xoá product (vào Trash WP) / Quản lý category ──
  const copyLink = (url: string) => {
    navigator.clipboard?.writeText(url).then(() => flash("\u2713 Link copied")).catch(() => flash("\u2717 Copy failed"));
  };
  const delProducts = async (ids: number[]) => {
    if (!ids.length) return;
    if (!window.confirm(`Move ${Math.min(ids.length, 20)} product(s) to the store Trash?\nRestorable in WP admin \u2192 Products \u2192 Trash.`)) return;
    setBusy(true);
    const j = await fetch(`/api/woo-products?storeId=${storeId}&ids=${ids.slice(0, 20).join(",")}`, { method: "DELETE" }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setBusy(false);
    if (j.ok) { flash(`\u2713 ${j.deleted} product(s) moved to Trash${ids.length > 20 ? " (max 20 per click)" : ""}`); loadProducts(storeId, search, page, fStatus, fCat, fSeller, fTpl); }
    else flash("\u2717 " + (j.error ?? "Error"));
  };

  // ── New / Edit product modal ─────────────────────────────────────────────
  const empty = { id: 0, name: "", description: "", regularPrice: "", salePrice: "", sku: "", status: "publish", categoryIds: [] as number[], tags: "", images: [] as string[], tplId: "", wcpStyles: [] as string[] };
  const [form, setForm] = useState<typeof empty | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const openNew = () => setForm({ ...empty });
  const openEdit = async (p: Prod) => {
    setBusy(true);
    const j = await fetch(`/api/woo-products?storeId=${storeId}&productId=${p.id}`).then((r) => r.json()).catch(() => ({ ok: false }));
    setBusy(false);
    const d: Prod = j.ok ? j.product : p;
    setForm({
      id: d.id, name: d.name, description: d.description,
      regularPrice: d.regularPrice || d.price, salePrice: d.salePrice, sku: d.sku,
      status: d.status === "draft" ? "draft" : "publish",
      categoryIds: d.categories.map((c) => c.id),
      tags: d.tags.join(", "),
      images: d.images.map((i) => i.src),
      tplId: "",
      wcpStyles: Array.isArray(d.wcpStyles) ? [...d.wcpStyles] : [],
    });
  };
  // Dup: mở form NEW với data copy từ sản phẩm (id=0 → tạo mới), title thêm "(Copy)".
  const openDup = async (p: Prod) => {
    await openEdit(p);
    setForm((f) => (f ? { ...f, id: 0, sku: "", name: f.name + " (Copy)", status: "draft" } : f));
  };

  const addImages = async (files: FileList | null) => {
    if (!files?.length || !form) return;
    setSaving(true);
    const urls: string[] = [];
    for (const f of Array.from(files).slice(0, 12)) {
      try {
        const dataUrl = await compressImage(f);
        const j = await fetch("/api/woo-products/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl }) }).then((r) => r.json());
        if (j.ok && j.url) urls.push(j.url); else flash("✗ " + (j.error ?? "upload error"));
      } catch { flash("✗ upload error"); }
    }
    setSaving(false);
    setForm((f0) => (f0 ? { ...f0, images: [...f0.images, ...urls].slice(0, 12) } : f0));
  };

  const save = async () => {
    if (!form) return;
    if (!form.name.trim()) { flash("✗ Enter a product title"); return; }
    if (!form.regularPrice.trim()) { flash("✗ Enter a price"); return; }
    setSaving(true);
    const product = {
      name: form.name, description: form.description,
      regularPrice: form.regularPrice, salePrice: form.salePrice,
      sku: form.sku, status: form.status,
      categoryIds: form.categoryIds,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      images: form.images,
      wcpStyles: form.wcpStyles,
    };
    const j = form.id
      ? await fetch("/api/woo-products", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, productId: form.id, product }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }))
      : await fetch("/api/woo-products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, product, templateId: form.tplId || undefined }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setSaving(false);
    if (j.ok) { flash(form.id ? "✓ Product updated" : "✓ Product created on the store"); setForm(null); loadProducts(storeId, search, page, fStatus, fCat, fSeller, fTpl); loadCats(storeId); }
    else flash("✗ " + (j.error ?? "Error"));
  };

  // ── Templates (v502): khung listing — Apply vào form, Save form thành template, quản lý CRUD ──
  const [tplOpen, setTplOpen] = useState(false);
  const applyTpl = (id: string) => {
    const t = tpls.find((x) => x.id === id);
    if (!t || !form) return;
    setForm({
      ...form,
      name: t.title ?? form.name,
      description: t.description ?? form.description,
      regularPrice: t.price ?? form.regularPrice,
      salePrice: t.salePrice ?? "",
      status: t.status === "draft" ? "draft" : "publish",
      categoryIds: t.categoryIds.length ? [...t.categoryIds] : form.categoryIds,
      tags: t.tags ?? form.tags,
      tplId: t.id,
      wcpStyles: t.wcpStyles?.length ? [...t.wcpStyles] : form.wcpStyles, // v507 · template mang theo Product Types
    });
    flash("✓ Template applied — now set the title, images and design-specific bits");
  };
  const saveAsTpl = async () => {
    if (!form) return;
    const name = window.prompt("Template name:", form.name.slice(0, 60));
    if (!name?.trim()) return;
    setSaving(true);
    const j = await fetch("/api/woo-products/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, template: {
      name: name.trim(), title: form.name, description: form.description, price: form.regularPrice,
      salePrice: form.salePrice, categoryIds: form.categoryIds, tags: form.tags, status: form.status,
      thumb: form.images[0] ?? "", wcpStyles: form.wcpStyles, // v507 · mang cả mockup + Product Types vào template
    } }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setSaving(false);
    if (j.ok) { flash("✓ Saved as template"); loadCats(storeId); } else flash("✗ " + (j.error ?? "Error"));
  };
  const delTpl = async (id: string) => {
    if (!window.confirm("Delete this template?")) return;
    const j = await fetch(`/api/woo-products/templates?storeId=${storeId}&id=${id}`, { method: "DELETE" }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    if (j.ok) { flash("✓ Template deleted"); setTpls((l) => l.filter((t) => t.id !== id)); } else flash("✗ " + (j.error ?? "Error"));
  };


  const parents = cats.filter((c) => c.parent === 0);
  const catLabel = (c: Cat) => (c.parent ? `— ${c.name}` : c.name);
  const sortedCats = [...parents.map((p) => [p, ...cats.filter((c) => c.parent === p.id)]).flat()];

  const th: React.CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 800, color: "var(--muted)", letterSpacing: 0.5, textTransform: "uppercase", padding: "10px 12px", borderBottom: "1px solid var(--line)" };
  const td: React.CSSProperties = { padding: "12px", borderBottom: "1px solid var(--line)", verticalAlign: "middle", fontSize: 13 };

  if (!stores.length) {
    return <div className="panel empty">No WooCommerce store yet — create one in <b>Stores</b> (marketplace: WooCommerce), enter the REST API keys, then come back here.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 1440, margin: "0 auto", width: "100%" }}>
      {msg && <div style={{ position: "fixed", top: 70, right: 20, zIndex: 300, background: msg.startsWith("✓") ? "#1E7A3E" : "#B3261E", color: "#fff", padding: "10px 16px", borderRadius: 10, fontWeight: 700, fontSize: 13 }}>{msg}</div>}

      {/* ── Header (khuôn ShopBase) ── */}
      <div className="panel" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "14px 18px", background: "#F6F9FF", border: "1px solid #DFE8FA" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <MarketplaceLogo mk="woocommerce" size={34} />
          <b style={{ fontSize: 19 }}>Manage Products · <span style={{ color: "#7F54B3" }}>WooCommerce</span></b>
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {canEdit && <button onClick={openNew} style={btnPri}>+ New product</button>}
          <a href="/woo-categories" style={{ ...btnGhost, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>Categories</a>
          <button onClick={() => setTplOpen(true)} style={btnGhost}>Templates ({tpls.length})</button>
          <button onClick={exportCsv} style={btnGhost}>↓ Export CSV</button>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} style={{ ...inp, width: 190 }}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={() => { setPage(1); loadProducts(storeId, search, 1, fStatus, fCat, fSeller, fTpl); loadCats(storeId); }} style={btnBlue}>⟳ Refresh</button>
        </span>
      </div>

      {/* ── Search + filter (khuôn ShopBase) ── */}
      <div className="panel" style={{ padding: "14px 16px", display: "grid", gap: 10 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doSearch()} placeholder="Search title / SKU" style={inp} />
        <div className="m-stack-sm" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 10 }}>
          <select value={fStatus} onChange={(e) => { setFStatus(e.target.value); setPage(1); loadProducts(storeId, search, 1, e.target.value, fCat, fSeller, fTpl); }} style={inp}>
            <option value="">All status</option>
            <option value="publish">Publish</option>
            <option value="draft">Draft</option>
            <option value="pending">Pending</option>
          </select>
          <select value={fCat} onChange={(e) => { const v = Number(e.target.value); setFCat(v); setPage(1); loadProducts(storeId, search, 1, fStatus, v, fSeller, fTpl); }} style={inp}>
            <option value={0}>All categories</option>
            {sortedCats.map((c) => <option key={c.id} value={c.id}>{catLabel(c)} ({c.count})</option>)}
          </select>
          <select value={fSeller} onChange={(e) => { setFSeller(e.target.value); setPage(1); loadProducts(storeId, search, 1, fStatus, fCat, e.target.value, fTpl); }} style={inp}>
            <option value="">All sellers</option>
            {sellers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={fTpl} onChange={(e) => { setFTpl(e.target.value); setPage(1); loadProducts(storeId, search, 1, fStatus, fCat, fSeller, e.target.value); }} style={inp}>
            <option value="">All templates</option>
            {tpls.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button onClick={doSearch} style={btnGhost}>Search</button>
        </div>
      </div>

      {/* ── Table (khuôn ShopBase) ── */}
      <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
        <div style={{ padding: "12px 16px 0", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <b style={{ fontSize: 13 }}>{total} products</b>
          {sel.size > 0 && canEdit && (
            <span style={{ display: "inline-flex", gap: 8, alignItems: "center", background: "#EEF3FF", border: "1px solid #CBD9FF", borderRadius: 10, padding: "5px 10px" }}>
              <b style={{ fontSize: 12 }}>{sel.size} selected</b>
              <button onClick={() => bulkStatus("publish")} style={{ ...btnGhost, padding: "4px 12px", fontSize: 12 }}>Set Active</button>
              <button onClick={() => bulkStatus("draft")} style={{ ...btnGhost, padding: "4px 12px", fontSize: 12 }}>Set Draft</button>
              <button onClick={() => setBulk({ ...emptyBulk })} style={{ ...btnGhost, padding: "4px 12px", fontSize: 12, borderColor: "var(--blue)", color: "var(--blue)" }}>✎ Bulk edit</button>
              <button onClick={() => delProducts(Array.from(sel))} style={{ ...btnGhost, padding: "4px 12px", fontSize: 12, color: "var(--red)", borderColor: "#F3C2C0" }}>🗑 Delete</button>
              <button onClick={exportCsv} style={{ ...btnGhost, padding: "4px 12px", fontSize: 12 }}>Export</button>
            </span>
          )}
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>Page {page} / {totalPages}</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
          <thead><tr>
            <th style={{ ...th, width: 36 }}><input type="checkbox" checked={shown.length > 0 && sel.size === shown.length} onChange={toggleAll} /></th>
            <th style={{ ...th, width: 70 }}>Image</th>
            <th style={th}>Title</th>
            <th style={{ ...th, width: 170 }}>Store / Seller</th>
            <th style={{ ...th, width: 190 }}>Categories</th>
            <th style={{ ...th, width: 70 }}>Orders</th>
            <th style={{ ...th, width: 110 }}>Price</th>
            <th style={{ ...th, width: 90 }}>Status</th>
            <th style={{ ...th, width: 130 }}>Link</th>
          </tr></thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} style={sel.has(p.id) ? { background: "#F6F9FF" } : undefined}>
                <td style={td}><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggleSel(p.id)} /></td>
                <td style={td}>
                  <div style={{ width: 52, height: 52, borderRadius: 10, overflow: "hidden", background: "#F1F3F8" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.thumb ? <img src={p.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
                  </div>
                </td>
                <td style={td}>
                  <div onClick={() => canEdit && p.editable !== false && openEdit(p)} style={{ fontWeight: 700, color: "var(--blue)", cursor: canEdit && p.editable !== false ? "pointer" : "default", lineHeight: 1.4 }}>{p.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{p.images.length} images{p.sku ? ` · ${p.sku}` : ""}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>#{p.id}</div>
                </td>
                <td style={td}>
                  <div style={{ fontWeight: 700 }}>{store?.name ?? "—"}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{p.creator || store?.sellerName || "—"}</div>
                  {p.tplName ? <div style={{ fontSize: 11, color: "var(--muted)" }}>tpl: {p.tplName}</div> : null}
                </td>
                <td style={td}>
                  <div style={{ fontSize: 11.5, lineHeight: 1.5 }}>{p.categories.map((c) => c.name).join(", ") || "—"}</div>
                </td>
                <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{p.totalSales}</td>
                <td style={{ ...td, fontWeight: 800 }}>
                  {p.salePrice ? <><s style={{ color: "var(--muted)", fontWeight: 600 }}>${p.regularPrice}</s> ${p.salePrice}</> : `$${p.price || p.regularPrice || "—"}`}
                </td>
                <td style={td}>
                  <span style={{ fontSize: 10.5, fontWeight: 800, padding: "3px 10px", borderRadius: 99, background: p.status === "publish" ? "var(--green-soft)" : "#FFF3D6", color: p.status === "publish" ? "#2E7D46" : "#8A6D1A", textTransform: "uppercase" }}>{p.status === "publish" ? "Active" : p.status}</span>
                </td>
                <td style={td}>
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    {p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer" title="View on store" style={{ width: 32, height: 32, borderRadius: 99, border: "1px solid #CBD9FF", background: "#EEF6FF", color: "var(--blue)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, textDecoration: "none" }}>👁</a>}
                    {p.permalink && <button onClick={() => copyLink(p.permalink)} title="Copy product link" style={{ width: 32, height: 32, borderRadius: 99, border: "1px solid var(--line)", background: "#fff", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>⧉</button>}
                    {canEdit && p.editable !== false && <button onClick={() => openEdit(p)} title="Edit" style={{ width: 32, height: 32, borderRadius: 99, border: "1px solid var(--line)", background: "#fff", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>✎</button>}
                    {canEdit && <button onClick={() => openDup(p)} title="Duplicate as draft" style={{ ...btnGhost, padding: "6px 12px", fontSize: 12 }}>Dup</button>}
                    {canEdit && p.editable !== false && <button onClick={() => delProducts([p.id])} title="Move to Trash" style={{ width: 32, height: 32, borderRadius: 99, border: "1px solid #F3C2C0", background: "#fff", color: "var(--red)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>🗑</button>}
                  </span>
                </td>
              </tr>
            ))}
            {!shown.length && !busy && <tr><td colSpan={9} style={{ ...td, textAlign: "center", color: "var(--muted)", padding: 30 }}>No products</td></tr>}
          </tbody>
        </table>
        {busy && <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: 14 }}>Loading…</div>}
        {totalPages > 1 && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, padding: 14 }}>
            <button onClick={() => goto(page - 1)} disabled={page <= 1 || busy} style={{ ...btnGhost, opacity: page <= 1 ? 0.4 : 1 }}>‹ Prev</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).filter((n) => n === 1 || n === totalPages || Math.abs(n - page) <= 2).map((n, i, arr) => (
              <span key={n} style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                {i > 0 && arr[i - 1] !== n - 1 && <span style={{ color: "var(--muted)" }}>…</span>}
                <button onClick={() => goto(n)} disabled={busy} style={{ ...btnGhost, padding: "7px 13px", ...(n === page ? { background: "var(--blue)", color: "#fff", borderColor: "var(--blue)" } : {}) }}>{n}</button>
              </span>
            ))}
            <button onClick={() => goto(page + 1)} disabled={page >= totalPages || busy} style={{ ...btnGhost, opacity: page >= totalPages ? 0.4 : 1 }}>Next ›</button>
          </div>
        )}
      </div>

      {/* v508 · Bulk edit modal — giá / description cho các dòng đã tick */}
      {bulk && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,20,40,.55)", zIndex: 200, overflowY: "auto", padding: "36px 16px" }} onClick={() => !saving && setBulk(null)}>
          <div className="panel" style={{ width: 560, maxWidth: "100%", padding: 20, margin: "0 auto", background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 24px 70px rgba(15,20,40,.35)" }} onClick={(e) => e.stopPropagation()}>
            <b style={{ fontSize: 15 }}>Bulk edit · {sel.size} products</b>
            <div style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 12px", lineHeight: 1.5 }}>
              Blank field = keep the current value. Applies only to the ticked rows — sellers can only bulk-edit their own listings.
            </div>
            <div className="m-stack-sm" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
              <L label="Price ($ — blank = keep)"><input value={bulk.regularPrice} onChange={(e) => setBulk({ ...bulk, regularPrice: e.target.value })} placeholder="24.99" style={inp} /></L>
              <L label="Sale price ($ — blank = keep, 0 = remove sale)"><input value={bulk.salePrice} onChange={(e) => setBulk({ ...bulk, salePrice: e.target.value })} placeholder="" style={inp} /></L>
              <div style={{ gridColumn: "1 / -1" }}>
                <L label="Description (HTML allowed — blank = keep)">
                  <textarea value={bulk.description} onChange={(e) => setBulk({ ...bulk, description: e.target.value })} rows={7} style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} />
                </L>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <L label="Description mode">
                  <select value={bulk.descriptionMode} onChange={(e) => setBulk({ ...bulk, descriptionMode: e.target.value })} style={inp}>
                    <option value="replace">Replace — overwrite the whole description</option>
                    <option value="append">Append — add this to the END of each current description</option>
                  </select>
                </L>
              </div>
            </div>
            {ptypes.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                  <input type="checkbox" checked={bulk.setTypes} onChange={(e) => setBulk({ ...bulk, setTypes: e.target.checked })} />
                  Set product types for the selected products
                </label>
                {bulk.setTypes && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    {ptypes.map((t) => {
                      const on = chipOn(t, bulk.wcpStyles);
                      return (
                        <button key={t.label} type="button" title={t.grouped ? t.styles.join(" · ") : undefined}
                          onClick={() => setBulk({ ...bulk, wcpStyles: toggleChip(t, bulk.wcpStyles) })}
                          style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: 99, cursor: "pointer", border: on ? "1px solid #7F54B3" : "1px solid var(--line)", background: on ? "#7F54B3" : "#fff", color: on ? "#fff" : "var(--ink)" }}>
                          {t.label}{t.grouped ? ` (${t.styles.length})` : ""}
                        </button>
                      );
                    })}
                  </div>
                )}
                {bulk.setTypes && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>Ticked types REPLACE each product&apos;s current selection. None ticked = show ALL styles. Tip: tick the 9 apparel types on old listings so newly added types (Calendar, Pajama…) never leak into their pickers.</div>}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={() => setBulk(null)} disabled={saving} style={btnGhost}>Cancel</button>
              <button onClick={bulkApply} disabled={saving} style={btnBlue}>{saving ? "Applying…" : `Apply to ${sel.size} products`}</button>
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10, lineHeight: 1.5 }}>
              Note: the price shown on the storefront comes from <b>Product Types</b> (per-size prices) — change it there once to update every product of that type. This bulk edit sets the products&apos; own base price / description data.
            </div>
          </div>
        </div>
      )}

      {/* Templates modal (v502) */}
      {tplOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,20,40,.55)", zIndex: 200, overflowY: "auto", padding: "36px 16px" }} onClick={() => setTplOpen(false)}>
          <div className="panel" style={{ width: 640, maxWidth: "100%", padding: 18, margin: "0 auto", background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 24px 70px rgba(15,20,40,.35)" }} onClick={(e) => e.stopPropagation()}>
            <b style={{ fontSize: 15 }}>Templates · {store?.name}</b>
            {tplNeedSql && <div style={{ fontSize: 12, background: "#FFF3D6", border: "1px solid #EAD28A", borderRadius: 10, padding: "8px 12px", margin: "10px 0" }}>Run <b>MIGRATION_v502_woo_templates.sql</b> on Supabase first — the templates table doesn&apos;t exist yet.</div>}
            <div style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 12px", lineHeight: 1.5 }}>
              A template is a listing preset: title pattern, standard description, price, categories, tags, default status. Create one by opening any product (or a blank New product form), filling the fields, then <b>Save as template</b>. When listing, pick <b>Apply template…</b> and only change the title, images and design-specific bits.
            </div>
            {tpls.length ? (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {tpls.map((t) => (
                    <tr key={t.id}>
                      <td style={{ padding: "9px 6px", borderBottom: "1px solid var(--line)" }}>
                        <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          <span style={{ width: 40, height: 40, borderRadius: 8, overflow: "hidden", background: "#F1F3F8", display: "grid", placeItems: "center", color: "var(--muted)", fontSize: 15, flexShrink: 0 }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {t.thumb ? <img src={t.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "🖼"}
                          </span>
                          <span>
                            <b style={{ fontSize: 13 }}>{t.name}</b>
                            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                              {(t.title ?? "—").slice(0, 50)}{(t.title ?? "").length > 50 ? "…" : ""} · ${t.price ?? "—"} · {t.status} · {t.wcpStyles?.length ? t.wcpStyles.join(", ").slice(0, 40) : "All styles"}
                            </div>
                          </span>
                        </span>
                      </td>
                      <td style={{ padding: "9px 6px", borderBottom: "1px solid var(--line)", textAlign: "right", whiteSpace: "nowrap" }}>
                        {canEdit && <button onClick={() => { setTplOpen(false); setForm({ id: 0, name: t.title ?? "", description: t.description ?? "", regularPrice: t.price ?? "", salePrice: t.salePrice ?? "", sku: "", status: t.status === "draft" ? "draft" : "publish", categoryIds: [...t.categoryIds], tags: t.tags ?? "", images: [], tplId: t.id, wcpStyles: Array.isArray(t.wcpStyles) ? [...t.wcpStyles] : [] }); }} style={{ ...btnGhost, padding: "5px 12px", fontSize: 12 }}>New product</button>}
                        {canEdit && t.editable !== false && <button onClick={() => delTpl(t.id)} style={{ ...btnGhost, padding: "5px 12px", fontSize: 12, marginLeft: 6, color: "var(--red)" }}>Delete</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : !tplNeedSql && <div style={{ fontSize: 13, color: "var(--muted)" }}>No templates yet.</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button onClick={() => setTplOpen(false)} style={btnGhost}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* New / Edit product modal */}
      {form && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,20,40,.55)", zIndex: 200, overflowY: "auto", padding: "36px 16px" }} onClick={() => !saving && setForm(null)}>
          <div className="panel" style={{ width: 720, maxWidth: "100%", padding: 18, margin: "0 auto", background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 24px 70px rgba(15,20,40,.35)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <b style={{ fontSize: 15 }}>{form.id ? "Edit product" : "New product"}</b>
              {tpls.length > 0 && (
                <select defaultValue="" onChange={(e) => { if (e.target.value) applyTpl(e.target.value); e.target.value = ""; }} style={{ ...inp, width: 230, marginLeft: "auto" }}>
                  <option value="">Apply template…</option>
                  {tpls.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
              {canEdit && <button type="button" onClick={saveAsTpl} disabled={saving} style={{ ...btnGhost, padding: "7px 13px", fontSize: 12, ...(tpls.length ? {} : { marginLeft: "auto" }) }}>Save as template</button>}
            </div>
            <div className="m-stack-sm" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px", marginTop: 12 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <L label="Title"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Personalized Pumpkin Patch Crew Shirt…" style={inp} /></L>
              </div>
              <L label="Price ($)"><input value={form.regularPrice} onChange={(e) => setForm({ ...form, regularPrice: e.target.value })} placeholder="18.99" style={inp} /></L>
              <L label="Sale price ($ — optional, leave blank for none)"><input value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} placeholder="" style={inp} /></L>
              <L label="SKU (optional)"><input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="SKU-119" style={inp} /></L>
              <L label="Status">
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} style={inp}>
                  <option value="publish">Publish (live on store)</option>
                  <option value="draft">Draft (hidden)</option>
                </select>
              </L>
              <div style={{ gridColumn: "1 / -1" }}>
                <L label="Description (HTML allowed)">
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={6} style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} />
                </L>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <L label="Categories">
                  {!sortedCats.length && <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>No categories of your own yet — create one with <b>+ New category</b>. The store&apos;s public collections are managed by admin and applied automatically via templates.</div>}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {sortedCats.map((c) => {
                      const on = form.categoryIds.includes(c.id);
                      return (
                        <button key={c.id} type="button"
                          onClick={() => setForm({ ...form, categoryIds: on ? form.categoryIds.filter((x) => x !== c.id) : [...form.categoryIds, c.id] })}
                          style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: 99, cursor: "pointer", border: on ? "1px solid var(--blue)" : "1px solid var(--line)", background: on ? "var(--blue)" : "#fff", color: on ? "#fff" : "var(--ink)" }}>
                          {catLabel(c)}
                        </button>
                      );
                    })}
                  </div>
                </L>
              </div>
              {ptypes.length > 0 && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <L label="Product types this listing sells (none ticked = ALL styles show on the product page)">
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {ptypes.map((t) => {
                        const on = chipOn(t, form.wcpStyles);
                        return (
                          <button key={t.label} type="button" title={t.grouped ? t.styles.join(" · ") : undefined}
                            onClick={() => setForm({ ...form, wcpStyles: toggleChip(t, form.wcpStyles) })}
                            style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: 99, cursor: "pointer", border: on ? "1px solid #7F54B3" : "1px solid var(--line)", background: on ? "#7F54B3" : "#fff", color: on ? "#fff" : "var(--ink)" }}>
                            {t.label}{t.grouped ? ` (${t.styles.length})` : ""}
                          </button>
                        );
                      })}
                    </div>
                  </L>
                </div>
              )}
              <div style={{ gridColumn: "1 / -1" }}>
                <L label="Tags (comma separated — optional)"><input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="halloween, family matching" style={inp} /></L>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <L label={`Images (${form.images.length}/12 — first image = cover)`}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {form.images.map((src, i) => (
                      <div key={src + i} style={{ position: "relative", width: 86, height: 86, borderRadius: 10, overflow: "hidden", border: i === 0 ? "2px solid var(--blue)" : "1px solid var(--line)" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        <button type="button" onClick={() => setForm({ ...form, images: form.images.filter((_, x) => x !== i) })}
                          style={{ position: "absolute", top: 3, right: 3, width: 20, height: 20, borderRadius: 99, border: 0, background: "rgba(0,0,0,.6)", color: "#fff", fontSize: 12, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                      </div>
                    ))}
                    <button type="button" onClick={() => fileRef.current?.click()} disabled={saving}
                      style={{ width: 86, height: 86, borderRadius: 10, border: "1.5px dashed var(--line)", background: "#F8F9FC", color: "var(--muted)", fontSize: 24, cursor: "pointer" }}>+</button>
                    <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addImages(e.target.files); e.target.value = ""; }} />
                  </div>
                </L>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={() => setForm(null)} disabled={saving} style={btnGhost}>Cancel</button>
              <button onClick={save} disabled={saving} style={btnBlue}>{saving ? "Saving…" : form.id ? "Save changes" : "Create product"}</button>
            </div>
            {!form.id && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10, lineHeight: 1.5 }}>
                Products are created as <b>simple products</b> — on Sorawix the style / size / color picker and per-size pricing come from the Woo Custom Pro products.json, so a title + images + base price + category is all a listing needs.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
