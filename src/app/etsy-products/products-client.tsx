"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { MarketplaceLogo } from "@/components/marketplace-logo";
import { useConfirm, usePrompt } from "@/components/confirm-provider";
import ThumbZoom from "@/components/thumb-zoom";
// v142: dùng chung editor Custom options với Manage Products · Shopify — 1 bản, không copy code.
import CustomOptions, { pqProblem, toPQ, type PQ } from "@/components/custom-options";

const ETSY_ORANGE = "#F1641E";

type Row = {
  id: string; storeId: string; title: string; price: string | null; quantity: number | null;
  tags: string | null; sku: string | null; status: string; importedAt: string | null;
  storeName: string | null; mainImageUrl: string | null; variationsSummary: string;
  shopifyTitle: string | null; sellerId: string | null; sellerName: string | null; pushed?: boolean;
  persCount?: number; // v142 · số ô Custom options của listing
};
type Store = { id: string; name: string; sellerId: string | null; sellerName: string | null };
type Seller = { id: string; name: string };
type Detail = {
  id: string; title: string; price: string | null; tags: string | null; description: string | null;
  shopifyTitle: string | null; shopifyTags: string | null; shopifyDesc: string | null;
  images: string[]; variations: { name?: string; values?: string[] }[]; quantity: number | null; sku: string | null;
  storeName: string | null; sellerName: string | null;
  personalization: PQ[]; // v142 · ô khách phải điền trước khi Add to cart (Push Shopify ghi metafield)
};

type NewListing = {
  sellerId: string; storeId: string; title: string; price: string; quantity: string; sku: string;
  tags: string; description: string; images: string[]; variations: { name: string; values: string }[];
  personalization: PQ[];
};
// Mặc định 2 biến thể giống hàng import từ Etsy (Size / Paper) — sửa hoặc xoá thoải mái.
const BLANK_NEW: NewListing = {
  sellerId: "", storeId: "", title: "", price: "", quantity: "999", sku: "",
  tags: "", description: "", images: [],
  variations: [{ name: "Size", values: "" }, { name: "Paper", values: "" }],
  personalization: [],
};

/* ---- style tokens (modern) ---- */
const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,.04)" };
const ctl: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 12, padding: "10px 13px", fontSize: 13.5, font: "inherit", background: "#fff", outline: "none" };
const pill = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 7, border: "none", background: bg, color: fg, borderRadius: 12, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "opacity .15s, transform .05s" });
const ghost: React.CSSProperties = { ...pill("#fff", "var(--ink)"), border: "1px solid var(--line)" };
const lab: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 6 };
const linkBtn = (c: string): React.CSSProperties => ({ border: "none", background: "none", padding: 0, cursor: "pointer", color: c, fontWeight: 700, fontSize: 12.5 });

export default function EtsyProductsClient({ stores, sellers, shopifyStores = [], canEdit }: { stores: Store[]; sellers: Seller[]; shopifyStores?: { id: string; name: string; sellerId: string | null }[]; canEdit: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [kw, setKw] = useState("");
  const [sellerFilter, setSellerFilter] = useState("");
  const [storeFilter, setStoreFilter] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20); // default 20 listings/page
  const [pushFilter, setPushFilter] = useState(""); // "" | "pushed" | "not"
  const confirm = useConfirm();
  const askPrompt = usePrompt();
  const showSellerFilter = sellers.length > 1; // only when managing multiple sellers (admin)
  // Import drawer
  const [impOpen, setImpOpen] = useState(false);
  const [impSeller, setImpSeller] = useState("");
  const [impStore, setImpStore] = useState(stores[0]?.id ?? "");
  const [impFile, setImpFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const impStores = useMemo(() => impSeller ? stores.filter((s) => s.sellerId === impSeller) : stores, [stores, impSeller]);
  // Create Manual — dòng listing tự gõ, không cần CSV Etsy (ý tưởng mới chưa có trên Etsy).
  // Vẫn nằm chung bảng etsy_products nên Push Shopify / AI Optimize dùng được ngay như listing import.
  const [newOpen, setNewOpen] = useState(false);
  const [nw, setNw] = useState<NewListing>(BLANK_NEW);
  const newFileRef = useRef<HTMLInputElement>(null);
  const newStores = useMemo(() => nw.sellerId ? stores.filter((s) => s.sellerId === nw.sellerId) : stores, [stores, nw.sellerId]);
  // Edit drawer
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Detail | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  // v142: đang mở 1 field Custom options ra sửa ⇒ chặn Save để không lưu nửa chừng.
  const [persEditing, setPersEditing] = useState(false);
  const [newPersEditing, setNewPersEditing] = useState(false);
  const load = async () => {
    setLoading(true);
    try { const j = await fetch("/api/etsy-products").then((r) => r.json()); if (j.ok) setRows(j.rows); } catch { /* noop */ }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const flash = (text: string, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 5000); };

  // Push to Shopify qua API (không cần CSV). Chọn store Shopify đích → tạo/cập nhật sản phẩm.
  const [pushOpen, setPushOpen] = useState(false);
  const [pushStore, setPushStore] = useState(shopifyStores[0]?.id ?? "");
  const [pushTemplate, setPushTemplate] = useState("");
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!pushStore) { setTemplates([]); return; }
    fetch(`/api/shopify-templates?storeId=${pushStore}`).then((r) => r.json())
      .then((j) => { const t = j.ok ? j.templates : []; setTemplates(t); setPushTemplate((cur) => t.some((x: { id: string }) => x.id === cur) ? cur : ""); })
      .catch(() => setTemplates([]));
  }, [pushStore]);
  const doPushShopify = async () => {
    if (!sel.size) return flash("✗ Select listings first", false);
    if (!pushStore) return flash("✗ Chưa có store Shopify — thêm store Shopify + cấu hình API trong Stores trước", false);
    if (!pushTemplate) return flash("✗ Select a template before pushing", false);
    setPushOpen(false);
    setBusy(true);
    try {
      const j = await fetch("/api/etsy-products/push-shopify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(sel), storeId: pushStore, templateId: pushTemplate }) }).then((r) => r.json());
      if (j.ok || j.created) {
        const fail = (j.results ?? []).filter((r: { ok: boolean }) => !r.ok);
        flash(`✓ Pushed ${j.created}/${(j.results ?? []).length} to ${j.store}${j.failed ? ` · ${j.failed} failed: ${fail[0]?.error ?? ""}` : ""}`, j.failed === 0);
        load();
      } else {
        const first = (j.results ?? [])[0];
        flash("✗ " + (j.error ?? first?.error ?? "Push failed") + (/read_products|write_products|access|scope|Not Found|401|403/i.test(j.error ?? first?.error ?? "") ? " — thêm scope read_products/write_products + Install lại app" : ""), false);
      }
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
    setBusy(false);
  };

  const filtered = useMemo(() => rows.filter((r) =>
    (!sellerFilter || r.sellerId === sellerFilter) &&
    (!storeFilter || r.storeId === storeFilter) &&
    (pushFilter === "" || (pushFilter === "pushed" ? r.pushed : !r.pushed)) &&
    (!kw.trim() || (r.title + " " + (r.shopifyTitle ?? "") + " " + (r.sku ?? "") + " " + (r.tags ?? "")).toLowerCase().includes(kw.trim().toLowerCase()))
  ), [rows, kw, sellerFilter, storeFilter, pushFilter]);
  const pushedCount = useMemo(() => rows.filter((r) => r.pushed).length, [rows]);
  const storesForFilter = useMemo(() => sellerFilter ? stores.filter((s) => s.sellerId === sellerFilter) : stores, [stores, sellerFilter]);

  // Phân trang (mặc định 20/trang). Reset về trang 1 khi filter đổi.
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => { setPage(1); }, [kw, sellerFilter, storeFilter, pageSize, pushFilter]);
  const pageClamped = Math.min(page, totalPages);
  const paged = useMemo(() => filtered.slice((pageClamped - 1) * pageSize, pageClamped * pageSize), [filtered, pageClamped, pageSize]);

  const allChecked = paged.length > 0 && paged.every((r) => sel.has(r.id));
  const toggleAll = () => { const n = new Set(sel); if (allChecked) paged.forEach((r) => n.delete(r.id)); else paged.forEach((r) => n.add(r.id)); setSel(n); };
  const toggle = (id: string) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };

  const pickFile = (f: File | null | undefined) => {
    if (!f) return;
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") { flash("✗ Only .csv files exported from Etsy", false); return; }
    setImpFile(f);
  };

  const doImport = async () => {
    if (!impFile || !impStore) { flash("✗ Pick a store and a CSV file", false); return; }
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", impFile); fd.append("storeId", impStore);
      const res = await fetch("/api/etsy-products/import", { method: "POST", body: fd });
      const text = await res.text();
      let j: { ok?: boolean; error?: string; store?: string; inserted?: number; updated?: number; skipped?: number };
      try { j = JSON.parse(text); }
      catch { flash(`✗ HTTP ${res.status}: ${text.replace(/<[^>]+>/g, " ").trim().slice(0, 140) || "server error"}`, false); setBusy(false); return; }
      if (j.ok) { flash(`✓ ${j.store}: +${j.inserted} new · ${j.updated} updated${j.skipped ? ` · ${j.skipped} skipped` : ""}`); setImpOpen(false); setImpFile(null); load(); }
      else flash("✗ " + (j.error ?? "Import failed"), false);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
    setBusy(false);
  };

  const doDelete = async () => {
    if (!sel.size) return;
    if (!(await confirm({ message: `Delete ${sel.size} listing(s) from FUSION?\nYour Etsy shop is NOT affected.`, danger: true }))) return;
    setBusy(true);
    const j = await fetch("/api/etsy-products", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(sel) }) }).then((r) => r.json()).catch(() => ({ ok: false }));
    if (j.ok) { flash(`✓ Deleted ${j.deleted}`); setSel(new Set()); load(); } else flash("✗ " + (j.error ?? "Delete failed"), false);
    setBusy(false);
  };

  const doDuplicate = async (id: string) => {
    setBusy(true);
    const j = await fetch("/api/etsy-products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "duplicate", id }) }).then((r) => r.json()).catch(() => ({ ok: false }));
    if (j.ok) { flash("✓ Duplicated"); load(); } else flash("✗ " + (j.error ?? "Duplicate failed"), false);
    setBusy(false);
  };

  const doDeleteOne = async (id: string, title: string) => {
    if (!(await confirm({ message: `Delete "${title.slice(0, 60)}" from FUSION?\nYour Etsy shop is NOT affected.`, danger: true }))) return;
    setBusy(true);
    const j = await fetch("/api/etsy-products", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [id] }) }).then((r) => r.json()).catch(() => ({ ok: false }));
    if (j.ok) { flash("✓ Deleted"); const n = new Set(sel); n.delete(id); setSel(n); load(); } else flash("✗ " + (j.error ?? "Delete failed"), false);
    setBusy(false);
  };

  // ---- Create Manual ----
  const openCreate = () => { setNw({ ...BLANK_NEW, storeId: stores[0]?.id ?? "", sellerId: "" }); setNewOpen(true); };
  const setNwField = <K extends keyof NewListing>(k: K, v: NewListing[K]) => setNw((s) => ({ ...s, [k]: v }));
  const newAddImgUrl = async () => {
    const url = await askPrompt({ title: "Add image by URL", message: "Paste an image URL (https://...)", input: { placeholder: "https://…" } });
    if (!url || !/^https?:\/\//i.test(url)) return;
    setNw((s) => ({ ...s, images: [...s.images, url.trim()] }));
  };
  const newUploadImg = async (file: File | null | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const j = await fetch("/api/product-image/upload", { method: "POST", body: fd }).then((r) => r.json());
      if (j.ok && j.url) setNw((s) => ({ ...s, images: [...s.images, j.url] }));
      else flash("✗ " + (j.error ?? "Upload failed"), false);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
    setBusy(false);
  };
  const doCreate = async () => {
    if (!nw.storeId) return flash("✗ Select a store first", false);
    if (!nw.title.trim()) return flash("✗ Title is required", false);
    const problem = pqProblem(nw.personalization);
    if (problem) return flash("✗ " + problem, false);
    setBusy(true);
    try {
      const res = await fetch("/api/etsy-products", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create", storeId: nw.storeId, title: nw.title, price: nw.price, quantity: nw.quantity,
          sku: nw.sku, tags: nw.tags, description: nw.description, images: nw.images,
          variations: nw.variations.map((v) => ({ name: v.name, values: v.values.split(",").map((x) => x.trim()).filter(Boolean) })),
          personalization: nw.personalization,
        }),
      });
      const j = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      if (j.ok) { flash("✓ Listing created — select it and Push to Shopify when ready"); setNewOpen(false); setNw(BLANK_NEW); load(); }
      else flash("✗ " + (j.error ?? "Create failed"), false);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
    setBusy(false);
  };

  const openEdit = async (id: string) => {
    setEditId(id); setEdit(null); setEditLoading(true);
    try {
      const j = await fetch(`/api/etsy-products?id=${id}`).then((r) => r.json());
      if (j.ok) setEdit({
        id: j.item.id, title: j.item.title, price: j.item.price, tags: j.item.tags, description: j.item.description,
        // Etsy title/tags/desc GIỮ NGUYÊN (read-only). Ô Shopify là bản RIÊNG do AI Optimize/sửa tay điền
        // (rỗng nếu chưa tối ưu). Export Shopify lấy bản Shopify; rỗng thì fallback bản Etsy.
        shopifyTitle: j.item.shopifyTitle ?? "",
        shopifyTags: j.item.shopifyTags ?? "",
        shopifyDesc: j.item.shopifyDesc ?? "",
        images: Array.isArray(j.item.images) ? j.item.images : [],
        variations: Array.isArray(j.item.variations) ? j.item.variations : [],
        quantity: j.item.quantity, sku: j.item.sku, storeName: j.item.storeName, sellerName: j.item.sellerName,
        personalization: toPQ(j.item.personalization),
      });
      else { flash("✗ " + (j.error ?? "Load failed"), false); setEditId(null); }
    } catch { flash("✗ Network error", false); setEditId(null); }
    setEditLoading(false);
  };

  const saveEdit = async () => {
    if (!edit) return;
    const problem = pqProblem(edit.personalization);
    if (problem) return flash("✗ " + problem, false);
    setBusy(true);
    try {
      const res = await fetch("/api/etsy-products", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: edit.id, title: edit.shopifyTitle ?? "", tags: edit.shopifyTags ?? "", description: edit.shopifyDesc ?? "", price: edit.price ?? "", images: edit.images, variations: edit.variations, personalization: edit.personalization }),
      });
      const j = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      if (j.ok) { flash("✓ Saved"); setEditId(null); setEdit(null); load(); }
      else flash("✗ " + (j.error ?? "Save failed"), false);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
    setBusy(false);
  };

  // Thêm ảnh vào listing (Etsy edit modal): upload từ máy (R2) hoặc dán URL.
  const addImgUrl = async () => { if (!edit) return; const url = await askPrompt({ title: "Add image by URL", message: "Paste an image URL (https://...)", input: { placeholder: "https://…" } }); if (!url || !/^https?:\/\//i.test(url)) return; setEdit((e) => e ? { ...e, images: [...e.images, url.trim()] } : e); };
  const uploadImg = async (file: File | null | undefined) => {
    if (!edit || !file) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const j = await fetch("/api/product-image/upload", { method: "POST", body: fd }).then((r) => r.json());
      if (j.ok && j.url) setEdit((e) => e ? { ...e, images: [...e.images, j.url] } : e);
      else flash("✗ " + (j.error ?? "Upload failed"), false);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
    setBusy(false);
  };

  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? "";

  return (
    <div style={{ padding: "20px 22px 60px", maxWidth: 1280, margin: "0 auto" }}>
      {/* HERO HEADER */}
      <div style={{ ...card, padding: "18px 22px", marginBottom: 16, background: "linear-gradient(135deg,#FFF8F3 0%,#FFFFFF 60%)", borderColor: "#FBE3D2" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: "#fff", border: "1px solid #FBE3D2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <MarketplaceLogo mk="etsy" size={26} />
          </div>
          <div>
            <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0 }}>Manage Products · Etsy</h1>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
              {rows.length} listings · {pushedCount} pushed to Shopify · exactly as exported from Etsy
            </div>
          </div>
          <div style={{ flex: 1 }} />
          {canEdit && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button style={{ ...ghost, borderColor: "#FBE3D2" }} onClick={openCreate}
                onMouseDown={(e) => (e.currentTarget.style.transform = "scale(.97)")} onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}>
                <IcPlus /> Create Manual
              </button>
              <button style={pill("#F1641E", "#fff")} onClick={() => setImpOpen(true)}
                onMouseDown={(e) => (e.currentTarget.style.transform = "scale(.97)")} onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}>
                <IcUpload /> Import Etsy CSV
              </button>
            </div>
          )}
        </div>
      </div>

      {/* FILTER BAR */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <div style={{ position: "relative", flex: 1, minWidth: 240, maxWidth: 440 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }}><IcSearch /></span>
          <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="Search title / SKU / tag" style={{ ...ctl, width: "100%", paddingLeft: 34 }} />
        </div>
        {showSellerFilter && (
          <select value={sellerFilter} onChange={(e) => { setSellerFilter(e.target.value); setStoreFilter(""); }} style={ctl}>
            <option value="">All sellers</option>
            {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} style={ctl}>
          <option value="">All stores</option>
          {storesForFilter.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={pushFilter} onChange={(e) => setPushFilter(e.target.value)} style={ctl} title="Lọc theo trạng thái push Shopify">
          <option value="">All ({pushedCount} pushed)</option>
          <option value="not">Not pushed</option>
          <option value="pushed">Pushed to Shopify</option>
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>{sel.size ? `${sel.size} selected` : `${filtered.length} listings`}</span>
      </div>

      {sel.size > 0 && (
        <div style={{ ...card, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", background: "#F8FAFF", borderColor: "#DCE6FB" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--blue)" }}>{sel.size} selected</span>
          <div style={{ flex: 1 }} />
          {canEdit && shopifyStores.length > 0 && (
            <button disabled={busy} style={{ ...pill("linear-gradient(135deg,#5E8E3E,#4A7230)", "#fff"), opacity: busy ? .6 : 1 }} onClick={() => setPushOpen(true)} title="Create the selected listings directly on Shopify via API"><IcShop /> Push to Shopify</button>
          )}
          {canEdit && <button disabled={busy} style={{ ...ghost, color: "var(--red)", borderColor: "#F3C9C9" }} onClick={doDelete}><IcTrash /> Delete</button>}
          <button style={{ ...ghost, padding: "9px 12px" }} onClick={() => setSel(new Set())}>Clear</button>
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
              <th style={{ padding: "12px 6px" }}>Image</th>
              <th style={{ padding: "12px 6px" }}>Title</th>
              <th style={{ padding: "12px 6px" }}>Store / Seller</th>
              <th style={{ padding: "12px 6px" }}>Variations</th>
              <th style={{ padding: "12px 6px", textAlign: "right" }}>Price</th>
              <th style={{ padding: "12px 6px", textAlign: "right" }}>Qty</th>
              <th style={{ padding: "12px 6px" }}>Imported</th>
              <th style={{ padding: "12px 10px", textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>Loading…</td></tr>}
            {!loading && !filtered.length && (
              <tr><td colSpan={9} style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>No Etsy listings yet</div>
                Click <b style={{ color: "#F1641E" }}>Import Etsy CSV</b> — file from Etsy → Shop Manager → Settings → Options → Download Data
              </td></tr>
            )}
            {paged.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--line)", background: sel.has(r.id) ? "#F8FAFF" : "#fff" }}>
                <td style={{ padding: "10px 14px" }}><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td style={{ padding: "8px 6px" }}>
                  <ThumbZoom src={r.mainImageUrl} alt={r.title} size={46} radius={10} />
                </td>
                <td style={{ padding: "10px 6px", maxWidth: 420 }}>
                  {/* v118: LUÔN hiện title gốc từ CSV Etsy. Bỏ nhánh hiện shopify_title + badge AI —
                      bảng này là bản gốc Etsy, việc tối ưu chữ làm ở Optimize Products · Shopify. */}
                  <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{r.title}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                    {r.sku && <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "ui-monospace,monospace" }}>{r.sku}</span>}
                    {r.pushed && <span title="Đã push qua Shopify — push lại sẽ CẬP NHẬT, không tạo trùng" style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: "#5E8E3E", borderRadius: 6, padding: "1px 7px" }}>↑ SHOPIFY</span>}
                  </div>
                </td>
                <td style={{ padding: "10px 6px", whiteSpace: "nowrap" }}>
                  <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                    <MarketplaceLogo mk="etsy" size={15} />{r.storeName ?? "—"}
                  </div>
                  {r.sellerName && <div style={{ fontSize: 11, color: "var(--muted)", marginLeft: 21 }}>{r.sellerName}</div>}
                </td>
                <td style={{ padding: "10px 6px", fontSize: 12, color: "var(--muted)" }}>{r.variationsSummary || "—"}</td>
                <td style={{ padding: "10px 6px", textAlign: "right", fontWeight: 700 }}>{r.price ? `$${Number(r.price).toFixed(2)}` : "—"}</td>
                <td style={{ padding: "10px 6px", textAlign: "right" }}>{r.quantity ?? "—"}</td>
                <td style={{ padding: "10px 6px", whiteSpace: "nowrap", color: "var(--muted)" }}>{r.importedAt ? String(r.importedAt).slice(0, 10) : "—"}</td>
                <td style={{ padding: "10px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                  {canEdit && (
                    <div style={{ display: "inline-flex", gap: 12, alignItems: "center", fontSize: 12.5, fontWeight: 700 }}>
                      <button onClick={() => openEdit(r.id)} style={linkBtn("var(--blue)")}>Edit</button>
                      <button disabled={busy} onClick={() => doDuplicate(r.id)} style={linkBtn("#158A57")}>Duplicate</button>
                      <button disabled={busy} onClick={() => doDeleteOne(r.id, r.title)} style={linkBtn("var(--red)")}>Delete</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* PAGINATION */}
      {filtered.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
            {(pageClamped - 1) * pageSize + 1}–{Math.min(pageClamped * pageSize, filtered.length)} of {filtered.length}
          </span>
          <div style={{ flex: 1 }} />
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} style={{ ...ctl, padding: "7px 10px" }}>
            {[20, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button disabled={pageClamped <= 1} onClick={() => setPage(pageClamped - 1)} style={{ ...ghost, padding: "7px 12px", opacity: pageClamped <= 1 ? .4 : 1 }}>‹ Prev</button>
            <span style={{ fontSize: 12.5, fontWeight: 700, minWidth: 70, textAlign: "center" }}>Page {pageClamped}/{totalPages}</span>
            <button disabled={pageClamped >= totalPages} onClick={() => setPage(pageClamped + 1)} style={{ ...ghost, padding: "7px 12px", opacity: pageClamped >= totalPages ? .4 : 1 }}>Next ›</button>
          </div>
        </div>
      )}

      {/* PUSH TO SHOPIFY MODAL (centered) — chọn store + template ngay tại bước push */}
      {pushOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !busy && setPushOpen(false)}>
          <div style={{ background: "#fff", width: 440, maxWidth: "94vw", maxHeight: "90vh", borderRadius: 18, padding: 24, overflowY: "auto", boxShadow: "0 24px 60px rgba(16,24,40,.24)", animation: "popIn .18s ease" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>Push {sel.size} listing{sel.size === 1 ? "" : "s"} to Shopify</div>
              <button onClick={() => setPushOpen(false)} style={{ border: "none", background: "#F3F4F6", borderRadius: 9, width: 30, height: 30, cursor: "pointer", fontSize: 16, color: "var(--muted)" }}>×</button>
            </div>

            <label style={lab}>① Destination store</label>
            <select value={pushStore} onChange={(e) => setPushStore(e.target.value)} style={{ ...ctl, width: "100%", marginBottom: 14 }}>
              {shopifyStores.length === 0 && <option value="">(No Shopify store)</option>}
              {shopifyStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>

            <label style={lab}>② Template</label>
            <select value={pushTemplate} onChange={(e) => setPushTemplate(e.target.value)} style={{ ...ctl, width: "100%", marginBottom: templates.length ? 18 : 8 }}>
              <option value="" disabled>— Select a template —</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {pushStore && templates.length === 0 && (
              <div style={{ fontSize: 12, color: "#B42318", marginBottom: 16, padding: "10px 12px", background: "#FEF3F2", borderRadius: 10, border: "1px solid #FDA29B" }}>
                This store has no template yet. Create one in <b>Templates</b> first.
              </div>
            )}

            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16, padding: "10px 12px", background: "#F8FAFF", borderRadius: 10, border: "1px solid #DCE6FB" }}>
              New products are created as <b style={{ color: "var(--ink)" }}>DRAFT</b>.
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={ghost} disabled={busy} onClick={() => setPushOpen(false)}>Cancel</button>
              <button style={{ ...pill("linear-gradient(135deg,#5E8E3E,#4A7230)", "#fff"), opacity: pushStore && pushTemplate && !busy ? 1 : .5 }} disabled={busy || !pushStore || !pushTemplate} onClick={doPushShopify}>
                {busy ? "Pushing…" : "Push now"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE MANUAL MODAL */}
      {newOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !busy && setNewOpen(false)}>
          <div style={{ background: "#fff", width: 820, maxWidth: "96vw", maxHeight: "92vh", borderRadius: 18, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(16,24,40,.24)", animation: "popIn .18s ease" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", borderBottom: "1px solid var(--line)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <MarketplaceLogo mk="etsy" size={20} />
                <div style={{ fontWeight: 800, fontSize: 17 }}>Create listing manually</div>
              </div>
              <button onClick={() => setNewOpen(false)} style={{ border: "none", background: "#F3F4F6", borderRadius: 9, width: 30, height: 30, cursor: "pointer", fontSize: 16, color: "var(--muted)" }}>×</button>
            </div>

            <div style={{ padding: "18px 22px", overflowY: "auto", display: "grid", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: showSellerFilter ? "1fr 1fr" : "1fr", gap: 12 }}>
                {showSellerFilter && (
                  <div>
                    <label style={lab}>Seller</label>
                    <select value={nw.sellerId} onChange={(e) => setNw((s) => ({ ...s, sellerId: e.target.value, storeId: stores.find((x) => x.sellerId === e.target.value)?.id ?? "" }))} style={{ ...ctl, width: "100%" }}>
                      <option value="">All sellers</option>
                      {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label style={lab}>Store *</label>
                  <select value={nw.storeId} onChange={(e) => setNwField("storeId", e.target.value)} style={{ ...ctl, width: "100%" }}>
                    <option value="">(Select store)</option>
                    {newStores.map((s) => <option key={s.id} value={s.id}>{s.name}{s.sellerName ? ` · ${s.sellerName}` : ""}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label style={lab}>Title * <span style={{ fontWeight: 500 }}>({nw.title.length}/200)</span></label>
                <textarea value={nw.title} onChange={(e) => setNwField("title", e.target.value)} rows={2}
                  placeholder="Personalized Bedtime Story Book, Custom Name Children's Book, Dragon Unicorn Fairy Adventure, Baby Shower Birthday Gift"
                  style={{ ...ctl, width: "100%", resize: "vertical", lineHeight: 1.45 }} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div>
                  <label style={lab}>Price (USD)</label>
                  <input value={nw.price} onChange={(e) => setNwField("price", e.target.value)} placeholder="16.65" inputMode="decimal" style={{ ...ctl, width: "100%" }} />
                </div>
                <div>
                  <label style={lab}>Quantity</label>
                  <input value={nw.quantity} onChange={(e) => setNwField("quantity", e.target.value)} inputMode="numeric" style={{ ...ctl, width: "100%" }} />
                </div>
                <div>
                  <label style={lab}>SKU</label>
                  <input value={nw.sku} onChange={(e) => setNwField("sku", e.target.value)} style={{ ...ctl, width: "100%" }} />
                </div>
              </div>

              <div>
                <label style={lab}>Tags <span style={{ fontWeight: 500 }}>(comma separated)</span></label>
                <input value={nw.tags} onChange={(e) => setNwField("tags", e.target.value)} placeholder="personalized book, custom name book, baby shower gift" style={{ ...ctl, width: "100%" }} />
              </div>

              <div>
                <label style={lab}>Description</label>
                <textarea value={nw.description} onChange={(e) => setNwField("description", e.target.value)} rows={5} style={{ ...ctl, width: "100%", resize: "vertical", lineHeight: 1.5 }} />
              </div>

              <div>
                <label style={lab}>Variations</label>
                <div style={{ display: "grid", gap: 8 }}>
                  {nw.variations.map((v, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "150px 1fr 34px", gap: 8, alignItems: "center" }}>
                      <input value={v.name} onChange={(e) => setNw((s) => ({ ...s, variations: s.variations.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))} placeholder="Size" style={{ ...ctl, width: "100%" }} />
                      <input value={v.values} onChange={(e) => setNw((s) => ({ ...s, variations: s.variations.map((x, j) => j === i ? { ...x, values: e.target.value } : x) }))} placeholder='8"x8", 11"x8.5"' style={{ ...ctl, width: "100%" }} />
                      <button onClick={() => setNw((s) => ({ ...s, variations: s.variations.filter((_, j) => j !== i) }))} style={{ ...ghost, padding: "8px 0", justifyContent: "center", color: "var(--danger, #D92D20)" }}>×</button>
                    </div>
                  ))}
                </div>
                {nw.variations.length < 6 && (
                  <button onClick={() => setNw((s) => ({ ...s, variations: [...s.variations, { name: "", values: "" }] }))} style={{ ...ghost, marginTop: 8, fontSize: 12.5 }}>+ Add variation</button>
                )}
              </div>

              {/* v142 · Custom options — seller tự đặt ô khách phải điền, y như màn Etsy thật.
                  Push Shopify sẽ ghi bộ này vào metafield fusion.options để snippet Liquid render. */}
              <div>
                <label style={lab}>Custom options ({nw.personalization.length}/5)</label>
                <CustomOptions fields={nw.personalization} onChange={(f) => setNwField("personalization", f)} accent={ETSY_ORANGE} onEditingChange={setNewPersEditing} />
              </div>

              <div>
                <label style={lab}>Images</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  {nw.images.map((u, i) => (
                    <div key={i} style={{ position: "relative", width: 76, height: 76, borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)" }}>
                      <ThumbZoom src={u} size={76} />
                      <button onClick={() => setNw((s) => ({ ...s, images: s.images.filter((_, j) => j !== i) }))}
                        style={{ position: "absolute", top: 2, right: 2, border: "none", background: "rgba(16,24,40,.72)", color: "#fff", borderRadius: 6, width: 20, height: 20, cursor: "pointer", fontSize: 12, lineHeight: 1 }}>×</button>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={{ ...ghost, fontSize: 12.5 }} disabled={busy} onClick={() => newFileRef.current?.click()}>Upload image</button>
                  <button style={{ ...ghost, fontSize: 12.5 }} disabled={busy} onClick={newAddImgUrl}>Add by URL</button>
                  <input ref={newFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { newUploadImg(e.target.files?.[0]); e.target.value = ""; }} />
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", padding: "14px 22px", borderTop: "1px solid var(--line)" }}>
              <button style={ghost} disabled={busy} onClick={() => setNewOpen(false)}>Cancel</button>
              <button style={{ ...pill(ETSY_ORANGE, "#fff"), opacity: busy || newPersEditing || !nw.storeId || !nw.title.trim() ? .5 : 1 }} disabled={busy || newPersEditing || !nw.storeId || !nw.title.trim()} onClick={doCreate}>
                {busy ? "Creating…" : "Create listing"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* IMPORT MODAL (centered) */}
      {impOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !busy && setImpOpen(false)}>
          <div style={{ background: "#fff", width: 480, maxWidth: "94vw", maxHeight: "90vh", borderRadius: 18, padding: 24, overflowY: "auto", boxShadow: "0 24px 60px rgba(16,24,40,.24)", animation: "popIn .18s ease" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>Import Etsy CSV</div>
              <button onClick={() => setImpOpen(false)} style={{ border: "none", background: "#F3F4F6", borderRadius: 9, width: 30, height: 30, cursor: "pointer", fontSize: 16, color: "var(--muted)" }}>×</button>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 18, lineHeight: 1.5 }}>
              Etsy → Shop Manager → Settings → Options → <b>Download Data</b>. Re-importing the same file updates by title.
            </div>

            {showSellerFilter && (
              <>
                <label style={lab}>① Select seller</label>
                <select value={impSeller} onChange={(e) => { setImpSeller(e.target.value); const first = stores.find((s) => s.sellerId === e.target.value); setImpStore(first?.id ?? ""); }} style={{ ...ctl, width: "100%", marginBottom: 14 }}>
                  <option value="">All sellers</option>
                  {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </>
            )}
            <label style={lab}>{showSellerFilter ? "②" : "①"} Select destination store</label>
            <select value={impStore} onChange={(e) => setImpStore(e.target.value)} style={{ ...ctl, width: "100%", marginBottom: 18 }}>
              {impStores.length === 0 && <option value="">(No Etsy store)</option>}
              {impStores.map((s) => <option key={s.id} value={s.id}>{s.name}{s.sellerName ? ` · ${s.sellerName}` : ""}</option>)}
            </select>

            <label style={lab}>{showSellerFilter ? "③" : "②"} Drop CSV file</label>
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
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>{(impFile.size / 1024).toFixed(0)} KB · click to change file</div>
                </div>
              ) : (
                <div style={{ color: "var(--muted)" }}>
                  <div style={{ fontSize: 30, marginBottom: 6, color: drag ? "#F1641E" : "var(--muted)" }}>⬆</div>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--ink)" }}>Drag a CSV file here</div>
                  <div style={{ fontSize: 12, marginTop: 3 }}>or click to browse · .csv only</div>
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => pickFile(e.target.files?.[0])} />

            {impStore && impFile && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16, padding: "10px 12px", background: "#F8FAFF", borderRadius: 10, border: "1px solid #DCE6FB" }}>
                Will import into store <b style={{ color: "var(--ink)" }}>{storeName(impStore)}</b>.
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={ghost} disabled={busy} onClick={() => setImpOpen(false)}>Cancel</button>
              <button style={{ ...pill("#F1641E", "#fff"), opacity: impFile && impStore && !busy ? 1 : .5 }} disabled={busy || !impFile || !impStore} onClick={doImport}>
                {busy ? "Importing…" : "Import now"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT MODAL (centered, full detail) */}
      {editId && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !busy && setEditId(null)}>
          <div style={{ background: "#fff", width: 860, maxWidth: "96vw", maxHeight: "92vh", borderRadius: 18, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(16,24,40,.24)", animation: "popIn .18s ease" }} onClick={(e) => e.stopPropagation()}>
            {/* header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", borderBottom: "1px solid var(--line)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <MarketplaceLogo mk="etsy" size={20} />
                <div style={{ fontWeight: 800, fontSize: 17 }}>Edit listing</div>
                <span style={{ fontSize: 11.5, color: "var(--muted)" }}>· exported to Shopify (Etsy original kept intact)</span>
              </div>
              <button onClick={() => setEditId(null)} style={{ border: "none", background: "#F3F4F6", borderRadius: 9, width: 30, height: 30, cursor: "pointer", fontSize: 16, color: "var(--muted)" }}>×</button>
            </div>

            {editLoading || !edit ? (
              <div style={{ padding: 50, textAlign: "center", color: "var(--muted)" }}>Loading…</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 0, overflow: "hidden", flex: 1 }}>
                {/* LEFT — images (deletable) + variations (editable) + read-only info */}
                <div style={{ borderRight: "1px solid var(--line)", padding: 18, overflowY: "auto", background: "#FAFBFD" }}>
                  <div style={{ ...lab, marginBottom: 6 }}>Images <span style={{ fontWeight: 500 }}>({edit.images.length}) · hover to remove</span></div>
                  {edit.images.length === 0
                    ? <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>No images.</div>
                    : (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: 14 }}>
                        {edit.images.map((u, i) => (
                          <div key={i} style={{ position: "relative", aspectRatio: "1", borderRadius: 8, overflow: "hidden" }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                            {i === 0 && <span style={{ position: "absolute", left: 3, bottom: 3, fontSize: 9, fontWeight: 800, background: "rgba(0,0,0,.6)", color: "#fff", borderRadius: 5, padding: "1px 5px" }}>MAIN</span>}
                            <button title="Remove image" onClick={() => setEdit({ ...edit, images: edit.images.filter((_, k) => k !== i) })}
                              style={{ position: "absolute", top: 3, right: 3, border: "none", background: "rgba(0,0,0,.6)", color: "#fff", borderRadius: 6, width: 20, height: 20, fontSize: 12, lineHeight: "20px", padding: 0, cursor: "pointer" }}>×</button>
                          </div>
                        ))}
                      </div>
                    )}
                  <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                    <label style={{ ...linkBtn("var(--blue)"), fontSize: 12, cursor: busy ? "default" : "pointer", opacity: busy ? .5 : 1 }}>
                      {busy ? "Uploading…" : "↑ Upload image"}
                      <input type="file" accept="image/*" disabled={busy} onChange={(e) => { uploadImg(e.target.files?.[0]); e.target.value = ""; }} style={{ display: "none" }} />
                    </label>
                    <button onClick={addImgUrl} disabled={busy} style={{ ...linkBtn("var(--blue)"), fontSize: 12 }}>+ Add by URL</button>
                  </div>

                  <div style={{ fontSize: 12, lineHeight: 1.9, marginBottom: 12 }}>
                    <div><span style={{ color: "var(--muted)" }}>Store: </span><b>{edit.storeName ?? "—"}</b></div>
                    {edit.sellerName && <div><span style={{ color: "var(--muted)" }}>Seller: </span><b>{edit.sellerName}</b></div>}
                    {edit.sku && <div><span style={{ color: "var(--muted)" }}>SKU: </span><b style={{ fontFamily: "ui-monospace,monospace" }}>{edit.sku}</b></div>}
                    <div><span style={{ color: "var(--muted)" }}>Qty: </span><b>{edit.quantity ?? "—"}</b></div>
                  </div>

                  {/* Variations — editable: name + comma-separated values, remove/add */}
                  <div style={{ ...lab, marginBottom: 6 }}>Variations</div>
                  {edit.variations.map((v, i) => (
                    <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 8, marginBottom: 8, background: "#fff" }}>
                      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                        <input value={v.name ?? ""} placeholder="Name (e.g. Size)" onChange={(e) => { const n = [...edit.variations]; n[i] = { ...n[i], name: e.target.value }; setEdit({ ...edit, variations: n }); }}
                          style={{ ...ctl, padding: "6px 9px", fontSize: 12, flex: 1 }} />
                        <button title="Remove variation" onClick={() => setEdit({ ...edit, variations: edit.variations.filter((_, k) => k !== i) })}
                          style={{ ...linkBtn("var(--red)"), fontSize: 16 }}>×</button>
                      </div>
                      <input value={(v.values ?? []).join(", ")} placeholder="Values, comma-separated"
                        onChange={(e) => { const n = [...edit.variations]; n[i] = { ...n[i], values: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) }; setEdit({ ...edit, variations: n }); }}
                        style={{ ...ctl, padding: "6px 9px", fontSize: 12, width: "100%" }} />
                    </div>
                  ))}
                  <button onClick={() => setEdit({ ...edit, variations: [...edit.variations, { name: "", values: [] }] })}
                    style={{ ...linkBtn("var(--blue)"), fontSize: 12 }}>+ Add variation</button>
                </div>

                {/* RIGHT — Shopify fields (separate from Etsy original). Export uses these; empty = fallback to Etsy. */}
                <div style={{ padding: 20, overflowY: "auto" }}>
                  <label style={lab}>
                    Shopify title <span style={{ fontWeight: 500, color: (edit.shopifyTitle ?? "").length > 140 ? "var(--red)" : "var(--muted)" }}>({(edit.shopifyTitle ?? "").length}/140)</span>
                    <button onClick={() => setEdit({ ...edit, shopifyTitle: edit.title })} style={{ ...linkBtn("var(--blue)"), float: "right", fontSize: 11 }}>Use Etsy title</button>
                  </label>
                  <textarea value={edit.shopifyTitle ?? ""} onChange={(e) => setEdit({ ...edit, shopifyTitle: e.target.value })}
                    rows={2} placeholder="Filled by AI Optimize, or type a short Shopify title…" style={{ ...ctl, width: "100%", marginBottom: 5, resize: "vertical" }} />
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 16, lineHeight: 1.4 }}><b>Etsy original:</b> {edit.title}</div>

                  <label style={lab}>Price (USD)</label>
                  <input value={edit.price ?? ""} inputMode="decimal" onChange={(e) => setEdit({ ...edit, price: e.target.value.replace(/[^0-9.]/g, "") })}
                    placeholder="0.00" style={{ ...ctl, width: 160, marginBottom: 16 }} />

                  <label style={lab}>
                    Shopify tags <span style={{ fontWeight: 500 }}>(comma-separated)</span>
                    <button onClick={() => setEdit({ ...edit, shopifyTags: (edit.tags ?? "").replace(/_/g, " ") })} style={{ ...linkBtn("var(--blue)"), float: "right", fontSize: 11 }}>Use Etsy tags</button>
                  </label>
                  <textarea value={edit.shopifyTags ?? ""} onChange={(e) => setEdit({ ...edit, shopifyTags: e.target.value })} rows={3}
                    placeholder="Filled by AI Optimize, or type your own…" style={{ ...ctl, width: "100%", resize: "vertical", marginBottom: 16 }} />

                  <label style={lab}>
                    Shopify description
                    <button onClick={() => setEdit({ ...edit, shopifyDesc: edit.description ?? "" })} style={{ ...linkBtn("var(--blue)"), float: "right", fontSize: 11 }}>Use Etsy description</button>
                  </label>
                  <textarea value={edit.shopifyDesc ?? ""} onChange={(e) => setEdit({ ...edit, shopifyDesc: e.target.value })} rows={8}
                    placeholder="Filled by AI Optimize, or type your own…" style={{ ...ctl, width: "100%", resize: "vertical" }} />

                  {/* v142 · Custom options — seller tự đặt ô khách phải điền trước khi Add to cart.
                      Lưu cùng nút Save; Push to Shopify ghi tiếp vào metafield fusion.options. */}
                  <div style={{ border: `1px solid ${ETSY_ORANGE}44`, borderRadius: 12, padding: "12px 14px", marginTop: 18, background: "#FFF9F5" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: ETSY_ORANGE }}>Custom options ({edit.personalization.length}/5)</div>
                    </div>
                    <CustomOptions fields={edit.personalization} onChange={(f) => setEdit({ ...edit, personalization: f })} accent={ETSY_ORANGE} onEditingChange={setPersEditing} />
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>Saved with this listing. Push to Shopify writes them onto the product so buyers see the fields on the storefront.</div>
                  </div>
                </div>
              </div>
            )}

            {/* footer */}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", padding: "14px 22px", borderTop: "1px solid var(--line)" }}>
              <button style={ghost} disabled={busy} onClick={() => setEditId(null)}>Cancel</button>
              <button style={{ ...pill("var(--blue)", "#fff"), opacity: busy || persEditing || !edit ? .6 : 1 }} disabled={busy || persEditing || !edit} onClick={saveEdit}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
      <style>{`@keyframes popIn{from{transform:scale(.96);opacity:.4}to{transform:scale(1);opacity:1}}`}</style>
    </div>
  );
}

/* ---- inline icons (stroke) ---- */
const IcUpload = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>;
const IcPlus = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>;
const IcTrash = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>;
const IcSearch = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>;
const IcShop = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l1-5h16l1 5M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9M3 9h18M9 20v-6h6v6" /></svg>;
const IcEdit = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>;
