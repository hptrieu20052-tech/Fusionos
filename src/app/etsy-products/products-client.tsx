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
  sellerId: string | null; sellerName: string | null; pushed?: boolean; staged?: boolean;
  shopifyListing?: { id: string; title: string } | null; // v183: chỉ có khi người xem có quyền trên store Shopify đích
  persCount?: number; // v142 · số ô Custom options của listing
};
type Store = { id: string; name: string; sellerId: string | null; sellerName: string | null };
type Seller = { id: string; name: string };
type Detail = {
  id: string; title: string; price: string | null; tags: string | null; description: string | null;
  images: string[]; variations: { name?: string; values?: string[] }[]; quantity: number | null; sku: string | null;
  storeName: string | null; sellerName: string | null;
  // v159 · giá theo từng giá trị biến thể (Size "8x8" = 16.65…). Trước đây chỉ sửa được ở màn Bulk Price.
  variantPrices: Record<string, string>;
  personalization: PQ[]; // v142 · ô khách phải điền trước khi Add to cart (Push Shopify ghi metafield)
};

type NewListing = {
  sellerId: string; storeId: string; title: string; price: string; quantity: string; sku: string;
  tags: string; description: string; images: string[];
  // v160 · mỗi giá trị một dòng riêng (giống form Edit) — bỏ chuỗi dấu phẩy dễ gõ sai.
  variations: { name: string; values: string[] }[];
  variantPrices: Record<string, string>;
  personalization: PQ[];
};
// Mặc định 2 biến thể giống hàng import từ Etsy (Size / Paper) — sửa hoặc xoá thoải mái.
const BLANK_NEW: NewListing = {
  sellerId: "", storeId: "", title: "", price: "", quantity: "999", sku: "",
  tags: "", description: "", images: [],
  variations: [{ name: "Size", values: [""] }, { name: "Paper", values: [""] }],
  variantPrices: {},
  personalization: [],
};

/* ---- style tokens (modern) ---- */
const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,.04)" };
const ctl: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 12, padding: "10px 13px", fontSize: 13.5, font: "inherit", background: "#fff", outline: "none" };
const pill = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 7, border: "none", background: bg, color: fg, borderRadius: 12, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "opacity .15s, transform .05s" });
const ghost: React.CSSProperties = { ...pill("#fff", "var(--ink)"), border: "1px solid var(--line)" };
const lab: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 6 };
const linkBtn = (c: string): React.CSSProperties => ({ border: "none", background: "none", padding: 0, cursor: "pointer", color: c, fontWeight: 700, fontSize: 12.5 });
/* v159 · khối section kiểu form Etsy: card trắng xếp dọc trên nền xám, tiêu đề ở đầu mỗi khối */
const sec: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 14, padding: "15px 17px", marginBottom: 13 };
const secTitle: React.CSSProperties = { fontWeight: 800, fontSize: 14.5, marginBottom: 12 };
const secSub: React.CSSProperties = { fontWeight: 500, fontSize: 11.5, color: "var(--muted)" };
const ro: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 10, padding: "9px 12px", fontSize: 13, background: "#F7F8FA", color: "var(--ink)", lineHeight: 1.5, marginBottom: 14, boxSizing: "border-box" };

export default function EtsyProductsClient({ stores, sellers, shopifyStores = [], canEdit, isAdmin = false }: { stores: Store[]; sellers: Seller[]; shopifyStores?: { id: string; name: string; sellerId: string | null }[]; canEdit: boolean; isAdmin?: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  // v181: nhận ?q= từ URL — nút "Etsy" bên Manage Products · Shopify nhảy thẳng về listing gốc ở đây.
  const [kw, setKw] = useState(() => {
    if (typeof window === "undefined") return "";
    try { return new URLSearchParams(window.location.search).get("q") ?? ""; } catch { return ""; }
  });
  // v184: ?pid= — nút "Etsy" bên Manage Products · Shopify nhảy về ĐÚNG listing theo id (khớp 100%,
  // không sợ 2 listing trùng title hay title đã bị đổi).
  const [pidFilter, setPidFilter] = useState(() => {
    if (typeof window === "undefined") return "";
    try { return new URLSearchParams(window.location.search).get("pid") ?? ""; } catch { return ""; }
  });
  const [sellerFilter, setSellerFilter] = useState("");
  const [storeFilter, setStoreFilter] = useState("");
  // v197b · lọc theo Custom options — tìm nhanh listing CHƯA có field để bulk-áp
  const [persFilter, setPersFilter] = useState<"" | "has" | "none">("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20); // default 20 listings/page
  const [pushFilter, setPushFilter] = useState(""); // "" | "pushed" | "not"
  // Banner "Seller lưu ý" gập/mở — nhớ lựa chọn (localStorage) để khỏi chiếm màn hình mỗi lần vào.
  const [notesOpen, setNotesOpen] = useState(true);
  useEffect(() => { if (typeof window !== "undefined" && localStorage.getItem("etsy_seller_notes_open") === "0") setNotesOpen(false); }, []);
  const toggleNotes = () => setNotesOpen((v) => { const nv = !v; try { localStorage.setItem("etsy_seller_notes_open", nv ? "1" : "0"); } catch { /* ignore */ } return nv; });
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
  // v197 · BULK Custom options: soạn 1 bộ field rồi áp cho tất cả listing đã chọn.
  const [bulkPersOpen, setBulkPersOpen] = useState(false);
  const [bulkPers, setBulkPers] = useState<PQ[]>([]);
  const [bulkPersEditing, setBulkPersEditing] = useState(false);
  // v159 · kéo thả sắp lại ảnh + tick "Prices vary" cho từng variation
  const [dragImg, setDragImg] = useState<number | null>(null);
  const [vary, setVary] = useState<boolean[]>([]);
  // v160 · form Create Manual dùng đúng bộ điều khiển đó (state riêng để 2 modal không đè nhau)
  const [newDragImg, setNewDragImg] = useState<number | null>(null);
  const [newVary, setNewVary] = useState<boolean[]>([false, false]);
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
        flash(`✓ Staged ${j.created}/${(j.results ?? []).length} for ${j.store} — finish them in Manage Products · Shopify, then Push${j.failed ? ` · ${j.failed} failed: ${fail[0]?.error ?? ""}` : ""}`, j.failed === 0);
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
    (persFilter === "" || (persFilter === "has" ? (r.persCount ?? 0) > 0 : (r.persCount ?? 0) === 0)) &&
    (!pidFilter || r.id === pidFilter) &&
    (!kw.trim() || (r.title + " " + (r.sku ?? "") + " " + (r.tags ?? "")).toLowerCase().includes(kw.trim().toLowerCase()))
  ), [rows, kw, sellerFilter, storeFilter, pushFilter, persFilter, pidFilter]);
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
    if (j.ok) { flash(`✓ Deleted ${j.deleted}${j.blocked ? ` · ${j.blocked} locked (already on Shopify — admin only)` : ""}`); setSel(new Set()); load(); } else flash("✗ " + (j.error ?? "Delete failed"), false);
    setBusy(false);
  };

  // v197 · Áp (hoặc xoá) cùng một bộ Custom options cho mọi listing đã chọn.
  const doBulkPers = async (fields: PQ[] | null) => {
    const n = sel.size;
    if (!n) return;
    const msg = fields === null
      ? `Remove ALL custom option fields from ${n} listing(s)?`
      : `Apply this ${fields.length}-field set to ${n} listing(s)?\nExisting custom options on those listings will be REPLACED.`;
    if (!(await confirm({ message: msg, danger: fields === null }))) return;
    setBusy(true);
    const j = await fetch("/api/etsy-products", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_personalization", ids: Array.from(sel), fields }),
    }).then((r) => r.json()).catch(() => ({ ok: false }));
    if (j.ok) { flash(`✓ Custom options ${fields === null ? "removed from" : "applied to"} ${j.updated} listing(s)`); setBulkPersOpen(false); load(); }
    else flash("✗ " + (j.error ?? "Apply failed"), false);
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
  const openCreate = () => { setNw({ ...BLANK_NEW, variations: BLANK_NEW.variations.map((v) => ({ ...v, values: [...v.values] })), variantPrices: {}, storeId: stores[0]?.id ?? "", sellerId: "" }); setNewVary(BLANK_NEW.variations.map(() => false)); setNewDragImg(null); setNewOpen(true); };
  const setNwField = <K extends keyof NewListing>(k: K, v: NewListing[K]) => setNw((s) => ({ ...s, [k]: v }));
  const newAddImgUrl = async () => {
    const url = await askPrompt({ title: "Add image by URL", message: "Paste an image URL (https://...)", input: { placeholder: "https://…" } });
    if (!url || !/^https?:\/\//i.test(url)) return;
    setNw((s) => ({ ...s, images: [...s.images, url.trim()] }));
  };
  // v205 · nhận NHIỀU file 1 lần cho form Create Manual
  const newUploadImg = async (files: FileList | File[] | null | undefined) => {
    const list = (files ? Array.from(files) : []).filter((f) => f && f.type.startsWith("image/"));
    if (!list.length) return;
    setBusy(true);
    let ok = 0, fail = 0;
    for (const file of list) {
      try {
        const fd = new FormData(); fd.append("file", file);
        const j = await fetch("/api/product-image/upload", { method: "POST", body: fd }).then((r) => r.json());
        if (j.ok && j.url) { setNw((s) => ({ ...s, images: [...s.images, j.url] })); ok++; }
        else fail++;
      } catch { fail++; }
    }
    if (list.length > 1) flash(fail ? `✓ Uploaded ${ok}/${list.length} — ${fail} failed` : `✓ Uploaded ${ok} images`, fail === 0);
    else if (fail) flash("✗ Upload failed", false);
    setBusy(false);
  };
  /* ---------- v160 · editor biến thể + kéo thả ảnh cho form Create Manual (đối xứng với form Edit) ---------- */
  const nMoveImg = (from: number, to: number) => setNw((s) => { const n = [...s.images]; const [x] = n.splice(from, 1); n.splice(to, 0, x); return { ...s, images: n }; });
  const nSetVarName = (i: number, name: string) => setNw((s) => ({ ...s, variations: s.variations.map((v, k) => k === i ? { ...v, name } : v) }));
  const nAddVar = () => { setNw((s) => ({ ...s, variations: [...s.variations, { name: "", values: [""] }] })); setNewVary((s) => [...s, false]); };
  const nRemoveVar = (i: number) => { setNw((s) => ({ ...s, variations: s.variations.filter((_, k) => k !== i) })); setNewVary((s) => s.filter((_, k) => k !== i)); };
  const nAddVal = (i: number, at: number) => setNw((s) => ({ ...s, variations: s.variations.map((v, k) => { if (k !== i) return v; const vals = [...v.values]; vals.splice(at, 0, ""); return { ...v, values: vals }; }) }));
  const nRemoveVal = (i: number, j: number) => setNw((s) => ({ ...s, variations: s.variations.map((v, k) => k === i ? { ...v, values: v.values.filter((_, x) => x !== j) } : v) }));
  // Dán chuỗi cũ kiểu '8"x8", 11"x8.5"' vào một ô ⇒ tự tách thành nhiều dòng.
  const nSetVal = (i: number, j: number, text: string) => setNw((s) => {
    const old = s.variations[i].values[j] ?? "";
    const parts = text.split(/[\n,]+/).map((x) => x.trim());
    const vals = [...s.variations[i].values];
    if (parts.length > 1) vals.splice(j, 1, ...parts.filter(Boolean));
    else vals[j] = text;
    const vp = { ...s.variantPrices };
    if (parts.length === 1 && old && old !== text && vp[old] != null) { vp[text] = vp[old]; delete vp[old]; }
    return { ...s, variations: s.variations.map((v, k) => k === i ? { ...v, values: vals } : v), variantPrices: vp };
  });
  const nSetVP = (val: string, price: string) => setNw((s) => ({ ...s, variantPrices: { ...s.variantPrices, [val]: price } }));
  const nToggleVary = (i: number, on: boolean) => {
    setNewVary((s) => s.map((x, k) => k === i ? on : x));
    if (!on) setNw((s) => { const vp = { ...s.variantPrices }; for (const v of s.variations[i].values) delete vp[v]; return { ...s, variantPrices: vp }; });
  };
  // Cảnh báo trần Shopify: tối đa 3 option/sản phẩm và 100 variant.
  const nvVars = nw.variations.filter((v) => v.name.trim() && v.values.filter(Boolean).length);
  const nvCombos = nvVars.reduce((a, v) => a * v.values.filter(Boolean).length, 1);
  const nvWarn = nvVars.length > 3
    ? "Shopify allows 3 options per product — only the first 3 variations will be pushed."
    : nvCombos > 100 ? "Shopify allows 100 variants per product — only the first 100 combinations will be created." : "";

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
          // v160: values đã là mảng — không còn split(",") nên tên có dấu phẩy vẫn nguyên vẹn.
          variations: nw.variations.map((v) => ({ name: v.name.trim(), values: v.values.map((x) => x.trim()).filter(Boolean) })),
          variantPrices: nw.variantPrices,
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
      if (j.ok) {
      const vars0: { name?: string; values?: string[] }[] = Array.isArray(j.item.variations) ? j.item.variations : [];
      const vp0: Record<string, string> = j.item.variantPrices && typeof j.item.variantPrices === "object" ? j.item.variantPrices : {};
      // Ô "Prices vary" tick sẵn nếu biến thể đó đã có giá riêng trong DB.
      setVary(vars0.map((v) => (v.values ?? []).some((x) => vp0[x] != null && String(vp0[x]).trim() !== "")));
      setEdit({
        id: j.item.id, title: j.item.title, price: j.item.price, tags: j.item.tags, description: j.item.description,
        // v144: bỏ 3 ô ghi đè Shopify (title/tags/desc) — sửa nội dung Shopify bên Manage Products · Shopify.
        // Ở đây chỉ còn thông tin gốc Etsy, hiển thị read-only; Push Shopify dùng luôn bản Etsy.
        images: Array.isArray(j.item.images) ? j.item.images : [],
        variations: vars0,
        variantPrices: vp0,
        quantity: j.item.quantity, sku: j.item.sku, storeName: j.item.storeName, sellerName: j.item.sellerName,
        personalization: toPQ(j.item.personalization),
      });
      }
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
        // v144: KHÔNG gửi title/tags/description nữa ⇒ API bỏ qua, 3 cột shopify_* trong DB giữ nguyên,
        // listing đã push trước đây không bị đổi nội dung. Chỉ lưu giá / ảnh / biến thể / Custom options.
        // v159: gửi thêm variantPrices — giá theo size set ngay trong form này, khỏi vòng qua Bulk Price.
        body: JSON.stringify({ id: edit.id, price: edit.price ?? "", images: edit.images, variations: edit.variations, variantPrices: edit.variantPrices, personalization: edit.personalization }),
      });
      const j = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      if (j.ok) { flash("✓ Saved"); setEditId(null); setEdit(null); load(); }
      else flash("✗ " + (j.error ?? "Save failed"), false);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
    setBusy(false);
  };

  // Thêm ảnh vào listing (Etsy edit modal): upload từ máy (R2) hoặc dán URL.
  const addImgUrl = async () => { if (!edit) return; const url = await askPrompt({ title: "Add image by URL", message: "Paste an image URL (https://...)", input: { placeholder: "https://…" } }); if (!url || !/^https?:\/\//i.test(url)) return; setEdit((e) => e ? { ...e, images: [...e.images, url.trim()] } : e); };
  // v205 · nhận NHIỀU file 1 lần cho form Edit listing
  const uploadImg = async (files: FileList | File[] | null | undefined) => {
    if (!edit) return;
    const list = (files ? Array.from(files) : []).filter((f) => f && f.type.startsWith("image/"));
    if (!list.length) return;
    setBusy(true);
    let ok = 0, fail = 0;
    for (const file of list) {
      try {
        const fd = new FormData(); fd.append("file", file);
        const j = await fetch("/api/product-image/upload", { method: "POST", body: fd }).then((r) => r.json());
        if (j.ok && j.url) { setEdit((e) => e ? { ...e, images: [...e.images, j.url] } : e); ok++; }
        else fail++;
      } catch { fail++; }
    }
    if (list.length > 1) flash(fail ? `✓ Uploaded ${ok}/${list.length} — ${fail} failed` : `✓ Uploaded ${ok} images`, fail === 0);
    else if (fail) flash("✗ Upload failed", false);
    setBusy(false);
  };

  /* ---------- v159 · editor biến thể kiểu Etsy + kéo thả ảnh ---------- */
  const moveImg = (from: number, to: number) => setEdit((e) => { if (!e) return e; const n = [...e.images]; const [x] = n.splice(from, 1); n.splice(to, 0, x); return { ...e, images: n }; });
  const setVarName = (i: number, name: string) => setEdit((e) => e ? { ...e, variations: e.variations.map((v, k) => k === i ? { ...v, name } : v) } : e);
  const addVar = () => { setEdit((e) => e ? { ...e, variations: [...e.variations, { name: "", values: [""] }] } : e); setVary((s) => [...s, false]); };
  const removeVar = (i: number) => { setEdit((e) => e ? { ...e, variations: e.variations.filter((_, k) => k !== i) } : e); setVary((s) => s.filter((_, k) => k !== i)); };
  const addVal = (i: number, at: number) => setEdit((e) => e ? { ...e, variations: e.variations.map((v, k) => { if (k !== i) return v; const vals = [...(v.values ?? [])]; vals.splice(at, 0, ""); return { ...v, values: vals }; }) } : e);
  const removeVal = (i: number, j: number) => setEdit((e) => e ? { ...e, variations: e.variations.map((v, k) => k === i ? { ...v, values: (v.values ?? []).filter((_, x) => x !== j) } : v) } : e);
  // Gõ/dán: nếu chuỗi có dấu phẩy hoặc xuống dòng ⇒ tự tách thành nhiều dòng
  // (dán nguyên chuỗi kiểu cũ "8x8, 11x8.5" vào vẫn ra đúng, khỏi nhập lại 134 listing).
  const setVal = (i: number, j: number, text: string) => setEdit((e) => {
    if (!e) return e;
    const old = (e.variations[i].values ?? [])[j] ?? "";
    const parts = text.split(/[\n,]+/).map((s) => s.trim());
    const vals = [...(e.variations[i].values ?? [])];
    if (parts.length > 1) vals.splice(j, 1, ...parts.filter(Boolean));
    else vals[j] = text;
    // Đổi tên một giá trị ⇒ mang theo giá của nó (variantPrices khoá theo giá trị).
    const vp = { ...e.variantPrices };
    if (parts.length === 1 && old && old !== text && vp[old] != null) { vp[text] = vp[old]; delete vp[old]; }
    return { ...e, variations: e.variations.map((v, k) => k === i ? { ...v, values: vals } : v), variantPrices: vp };
  });
  const setVP = (val: string, price: string) => setEdit((e) => e ? { ...e, variantPrices: { ...e.variantPrices, [val]: price } } : e);
  const toggleVary = (i: number, on: boolean) => {
    setVary((s) => s.map((x, k) => k === i ? on : x));
    // Bỏ tick ⇒ xoá hẳn giá riêng, mọi giá trị quay về giá gốc của listing.
    if (!on) setEdit((e) => { if (!e) return e; const vp = { ...e.variantPrices }; for (const v of e.variations[i].values ?? []) delete vp[v]; return { ...e, variantPrices: vp }; });
  };
  // Chuyển 1 variation → ô Custom (Personalization) dropdown: bê nguyên label + options xuống, khỏi gõ lại,
  // rồi bỏ variation đó khỏi Variants. Dùng cho Girl/Boy, kiểu nhân vật… (giá không đổi, không nên là variant).
  const moveVarToCustom = (i: number) => {
    if (!edit) return;
    const v = edit.variations[i];
    const opts = (v.values ?? []).map((x) => String(x).trim()).filter(Boolean);
    if (!opts.length) return flash("✗ Variation này chưa có option nào để chuyển", false);
    if (edit.personalization.length >= 5) return flash("✗ Đã đủ 5 ô Custom — xoá bớt trước khi chuyển", false);
    const pq: PQ = { type: "dropdown", label: String(v.name ?? "").trim() || "Choose", instructions: "", required: true, maxChars: 0, options: opts, maxFiles: 0 };
    setVary((s) => s.filter((_, k) => k !== i));
    setEdit((e) => e ? { ...e, variations: e.variations.filter((_, k) => k !== i), personalization: [...e.personalization, pq] } : e);
    flash(`✓ Đã chuyển "${pq.label}" xuống Custom`);
  };

  // Cảnh báo trần Shopify: tối đa 3 option/sản phẩm và 100 variant — trước đây code cắt âm thầm.
  const evVars = edit ? edit.variations.filter((v) => String(v.name ?? "").trim() && (v.values ?? []).filter(Boolean).length) : [];
  const evCombos = evVars.reduce((a, v) => a * (v.values ?? []).filter(Boolean).length, 1);
  const evWarn = evVars.length > 3
    ? "Shopify allows 3 options per product — only the first 3 variations will be pushed."
    : evCombos > 100 ? "Shopify allows 100 variants per product — only the first 100 combinations will be created." : "";

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

      {/* SELLER CHECKLIST — cảnh báo, gập/mở được. Gập vẫn hiện tiêu đề "Seller lưu ý". */}
      <div style={{ ...card, padding: notesOpen ? "12px 18px" : "9px 18px", marginBottom: 16, background: "#FFFBF2", borderColor: "#F0D897" }}>
        <button onClick={toggleNotes} style={{ all: "unset", cursor: "pointer", width: "100%", boxSizing: "border-box", display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 800, color: "#8A5A00" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <rect x="8" y="3" width="8" height="4" rx="1" /><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><path d="M9 12h6M9 16h4" />
          </svg>
          Seller lưu ý
          {!notesOpen && <span style={{ fontWeight: 500, fontSize: 11.5, color: "#B08B3E" }}>· bấm để xem</span>}
          <span style={{ flex: 1 }} />
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: notesOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }}><path d="M6 9l6 6 6-6" /></svg>
        </button>
        {notesOpen && (
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 5, fontSize: 12.8, color: "#5C4A2A", lineHeight: 1.5 }}>
            <li><b>Kiểm tra bản quyền (Trademark)</b></li>
            <li>
              <b>Variants</b> = thứ <b>ĐỔI GIÁ</b> (Size, bìa Hardcover/Softcover, giấy Matte/Glossy). &nbsp;
              <b>Girl/Boy, kiểu nhân vật (Girl 1, Boy 3…), tên, lời nhắn</b> = <b>Custom (Personalization)</b> — KHÔNG để ở Variants.
              <span style={{ color: "#8A5A00" }}> Lỡ để nhầm ở Variants thì mở Edit listing, bấm nút <b>“↓ Move to Custom”</b> trên variation đó để chuyển nhanh (khỏi gõ lại).</span>
            </li>
            <li><b>Thêm Custom cho listing cần cá nhân hoá</b></li>
            <li><b>Một sản phẩm list ở 2 shop Etsy → tự lọc trùng, giữ 1 listing, xóa bớt cái còn lại.</b></li>
            <li><b>Listing đã Push sẽ bị khóa không xóa được (chỉ admin xóa được).</b></li>
            <li><b>Mockup / ảnh sản phẩm không chèn logo, watermark hay chữ ký.</b></li>
          </ul>
        )}
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
        {/* v197b · lọc theo Custom options — chọn "No custom fields" rồi bulk-áp một phát là xong */}
        <select value={persFilter} onChange={(e) => setPersFilter(e.target.value as "" | "has" | "none")}
          style={{ ...ctl, ...(persFilter ? { borderColor: "#F0D897", background: "#FFFDF3", fontWeight: 700 } : {}) }}
          title="Filter by personalization fields — pick 'No custom fields' then use bulk Custom options">
          <option value="">Fields: all</option>
          <option value="none">No custom fields</option>
          <option value="has">Has custom fields</option>
        </select>
        {/* v184: đang xem đúng 1 listing nhảy từ Manage Products · Shopify qua — bấm × để xem lại tất cả */}
        {pidFilter && (
          <button onClick={() => setPidFilter("")} title="Showing only the listing linked from Manage Products · Shopify — click to show all"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid #DCE6FB", background: "#F8FAFF", color: "var(--blue)", borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>🔗 Linked listing ×</button>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>{sel.size ? `${sel.size} selected` : `${filtered.length} listings`}</span>
      </div>

      {sel.size > 0 && (
        <div style={{ ...card, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", background: "#F8FAFF", borderColor: "#DCE6FB" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--blue)" }}>{sel.size} selected</span>
          <div style={{ flex: 1 }} />
          {/* v197 · Bulk Custom options — soạn 1 bộ field, áp cho cả lô đã chọn */}
          {canEdit && (
            <button disabled={busy} style={{ ...ghost }} onClick={() => { setBulkPers([]); setBulkPersEditing(false); setBulkPersOpen(true); }}
              title="Build ONE set of personalization fields and apply it to every selected listing">Custom options</button>
          )}
          {canEdit && shopifyStores.length > 0 && (
            <button disabled={busy} style={{ ...pill("linear-gradient(135deg,#5E8E3E,#4A7230)", "#fff"), opacity: busy ? .6 : 1 }} onClick={() => setPushOpen(true)} title="Send the selected listings to Manage Products · Shopify as drafts — finish them there, then Push to create on Shopify"><IcShop /> Push to Shopify</button>
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
              <th style={{ padding: "12px 6px", textAlign: "center" }} title="Personalization fields (Custom options) — buyers fill these on the product page">Custom</th>
              <th style={{ padding: "12px 6px", textAlign: "right" }}>Price</th>
              <th style={{ padding: "12px 6px", textAlign: "right" }}>Qty</th>
              <th style={{ padding: "12px 6px" }}>Imported</th>
              <th style={{ padding: "12px 10px", textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10} style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>Loading…</td></tr>}
            {!loading && !filtered.length && (
              <tr><td colSpan={10} style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
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
                  {/* v204 · click title để mở Edit (giống Shopify admin), bỏ nút Edit riêng */}
                  <div onClick={() => canEdit && openEdit(r.id)} title={canEdit ? "Click to edit" : undefined}
                    style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", cursor: canEdit ? "pointer" : "default", color: canEdit ? "var(--blue)" : "inherit" }}>{r.title}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                    {r.sku && <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "ui-monospace,monospace" }}>{r.sku}</span>}
                    {/* v204 · badge ↑SHOPIFY giờ là LINK sang bản Shopify (khi có quyền); thay nút Shopify ở Actions */}
                    {r.pushed && (r.shopifyListing
                      ? <a href={`/shopify-products?pid=${encodeURIComponent(r.shopifyListing.id)}`} target="_blank" rel="noreferrer"
                          title={`View in Manage Products · Shopify: ${r.shopifyListing.title}`}
                          style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: "#5E8E3E", borderRadius: 6, padding: "1px 7px", textDecoration: "none", cursor: "pointer" }}>↑ SHOPIFY</a>
                      : <span title="Đã tạo thật trên Shopify — push lại sẽ CẬP NHẬT, không tạo trùng" style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: "#5E8E3E", borderRadius: 6, padding: "1px 7px" }}>↑ SHOPIFY</span>)}
                    {r.staged && !r.pushed && <span title="Đã tạo bản nháp trong Manage Products · Shopify — hoàn thiện rồi bấm Push bên đó để tạo trên Shopify" style={{ fontSize: 10, fontWeight: 800, color: "#8A5A00", background: "#FCEFCB", border: "1px solid #F0D897", borderRadius: 6, padding: "1px 7px" }}>◷ STAGED</span>}
                  </div>
                </td>
                <td style={{ padding: "10px 6px", whiteSpace: "nowrap" }}>
                  <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                    <MarketplaceLogo mk="etsy" size={15} />{r.storeName ?? "—"}
                  </div>
                  {r.sellerName && <div style={{ fontSize: 11, color: "var(--muted)", marginLeft: 21 }}>{r.sellerName}</div>}
                </td>
                <td style={{ padding: "10px 6px", fontSize: 12, color: "var(--muted)" }}>{r.variationsSummary || "—"}</td>
                {/* v197b · chip Custom options: xanh = đã có field, xám "none" = CHƯA có (cần bulk-áp trước khi Push) */}
                <td style={{ padding: "10px 6px", textAlign: "center" }}>
                  {(r.persCount ?? 0) > 0
                    ? <span title={`${r.persCount} personalization field(s) set`} style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 999, background: "#E9F7EF", color: "#1F6F45" }}>⚙ {r.persCount}</span>
                    : <span title="No personalization fields yet — select the listing and use bulk Custom options" style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 999, background: "#F1F1F4", color: "#8794A5" }}>none</span>}
                </td>
                <td style={{ padding: "10px 6px", textAlign: "right", fontWeight: 700 }}>{r.price ? `$${Number(r.price).toFixed(2)}` : "—"}</td>
                <td style={{ padding: "10px 6px", textAlign: "right" }}>{r.quantity ?? "—"}</td>
                <td style={{ padding: "10px 6px", whiteSpace: "nowrap", color: "var(--muted)" }}>{r.importedAt ? String(r.importedAt).slice(0, 10) : "—"}</td>
                {/* v204 · Actions gọn: Duplicate/Delete thành icon line. Edit → click title · Shopify → click badge ↑SHOPIFY */}
                <td style={{ padding: "10px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                  {canEdit && (
                    <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <button title="Duplicate listing" disabled={busy} onClick={() => doDuplicate(r.id)} style={iconBtn("#158A57")}><IcCopy /></button>
                      {(r.pushed || r.staged) && !isAdmin ? (
                        <span title="Locked — already staged/pushed to Shopify. Only an admin can delete it." style={{ ...iconBtn("#B8C0CC"), cursor: "not-allowed" }}>🔒</span>
                      ) : (
                        <button title="Delete listing" disabled={busy} onClick={() => doDeleteOne(r.id, r.title)} style={iconBtn("var(--red)")}><IcTrash /></button>
                      )}
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
      {/* v197 · BULK CUSTOM OPTIONS MODAL — 1 bộ field áp cho mọi listing đã chọn */}
      {bulkPersOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !busy && setBulkPersOpen(false)}>
          <div style={{ ...card, width: 760, maxWidth: "96vw", maxHeight: "90vh", overflowY: "auto", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <div style={{ fontWeight: 800, fontSize: 17 }}>Custom options — {sel.size} selected listing(s)</div>
              <div style={{ flex: 1 }} />
              <button onClick={() => setBulkPersOpen(false)} style={{ ...ghost, padding: "6px 11px", fontSize: 12.5 }}>✕</button>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14, lineHeight: 1.5 }}>
              Build ONE set of personalization fields below, then apply it to every selected listing.
              <b style={{ color: "var(--ink)" }}> Existing custom options on those listings will be replaced.</b> Listings staged/pushed to Shopify pick the new set up on the next Push.
            </div>
            <CustomOptions fields={bulkPers} onChange={setBulkPers} accent={ETSY_ORANGE} onEditingChange={setBulkPersEditing} />
            <div style={{ display: "flex", gap: 10, marginTop: 18, alignItems: "center" }}>
              <button disabled={busy} onClick={() => doBulkPers(null)} style={{ ...ghost, color: "var(--red)", borderColor: "#F3C9C9", fontSize: 12.5 }}
                title="Delete every custom option field from the selected listings">Remove all from selected</button>
              <div style={{ flex: 1 }} />
              <button disabled={busy} onClick={() => setBulkPersOpen(false)} style={{ ...ghost }}>Cancel</button>
              <button
                disabled={busy || bulkPersEditing || !bulkPers.length || !!pqProblem(bulkPers)}
                title={bulkPersEditing ? "Finish editing the open field first" : pqProblem(bulkPers) ?? (!bulkPers.length ? "Add at least one field" : "")}
                onClick={() => { const p = pqProblem(bulkPers); if (p) { flash("✗ " + p, false); return; } doBulkPers(bulkPers); }}
                style={{ ...pill(ETSY_ORANGE, "#fff"), opacity: busy || bulkPersEditing || !bulkPers.length || pqProblem(bulkPers) ? .5 : 1 }}>
                Apply to {sel.size} listing(s)
              </button>
            </div>
          </div>
        </div>
      )}

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
              Nothing is sent to Shopify yet. Listings are staged as <b style={{ color: "var(--ink)" }}>DRAFT</b> in <b style={{ color: "var(--ink)" }}>Manage Products · Shopify</b> — finish them there, then hit <b style={{ color: "var(--ink)" }}>Push to Shopify</b> to create them live.
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
          <div style={{ background: "#fff", width: 940, maxWidth: "96vw", maxHeight: "92vh", borderRadius: 18, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(16,24,40,.24)", animation: "popIn .18s ease" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", borderBottom: "1px solid var(--line)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <MarketplaceLogo mk="etsy" size={20} />
                <div style={{ fontWeight: 800, fontSize: 17 }}>Create listing manually</div>
              </div>
              <button onClick={() => setNewOpen(false)} style={{ border: "none", background: "#F3F4F6", borderRadius: 9, width: 30, height: 30, cursor: "pointer", fontSize: 16, color: "var(--muted)" }}>×</button>
            </div>

            <div style={{ padding: "16px 18px 20px", overflowY: "auto", flex: 1, background: "#F5F6F8" }}>

              {/* 0 · STORE — listing tạo tay vẫn phải thuộc về 1 shop Etsy trong hệ thống */}
              <div style={sec}>
                <div style={secTitle}>Store</div>
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
              </div>

              {/* 1 · PHOTOS — tile lớn, kéo thả đổi thứ tự, ô đầu là Thumbnail */}
              <div style={sec}>
                <div style={secTitle}>Photos <span style={secSub}>({nw.images.length}/20) · drag to reorder · the first photo is the thumbnail</span></div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {nw.images.map((u, i) => (
                    <div key={i} draggable
                      onDragStart={() => setNewDragImg(i)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => { if (newDragImg !== null && newDragImg !== i) nMoveImg(newDragImg, i); setNewDragImg(null); }}
                      onDragEnd={() => setNewDragImg(null)}
                      style={{ position: "relative", width: 94, height: 94, borderRadius: 10, overflow: "hidden", background: "#fff", cursor: "grab", opacity: newDragImg === i ? .45 : 1, border: newDragImg === i ? `2px dashed ${ETSY_ORANGE}` : "1px solid var(--line)" }}>
                      <ThumbZoom src={u} size={94} />
                      {i === 0 && <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, fontSize: 9.5, fontWeight: 800, background: "rgba(0,0,0,.62)", color: "#fff", padding: "2px 0", textAlign: "center", letterSpacing: .2 }}>Thumbnail</span>}
                      <button title="Remove photo" onClick={() => setNw((s) => ({ ...s, images: s.images.filter((_, k) => k !== i) }))}
                        style={{ position: "absolute", top: 3, right: 3, border: "none", background: "rgba(0,0,0,.6)", color: "#fff", borderRadius: 6, width: 20, height: 20, fontSize: 12, lineHeight: "20px", padding: 0, cursor: "pointer" }}>×</button>
                    </div>
                  ))}
                  <button disabled={busy} onClick={() => newFileRef.current?.click()}
                    style={{ width: 94, height: 94, borderRadius: 10, border: `1.5px dashed ${ETSY_ORANGE}88`, background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, color: ETSY_ORANGE, fontSize: 11, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? .5 : 1 }}>
                    <span style={{ fontSize: 21, lineHeight: 1 }}>+</span>{busy ? "Uploading…" : "Add photos"}
                  </button>
                  <input ref={newFileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { newUploadImg(e.target.files); e.target.value = ""; }} />
                </div>
                <button onClick={newAddImgUrl} disabled={busy} style={{ ...linkBtn("var(--blue)"), fontSize: 12, marginTop: 10 }}>+ Add by URL</button>
              </div>

              {/* 2 · LISTING DETAILS — form này TẠO dữ liệu nên 3 ô đều sửa được (khác form Edit: bên đó là bản gốc Etsy) */}
              <div style={sec}>
                <div style={secTitle}>Listing details</div>
                <label style={lab}>Title * <span style={secSub}>· {nw.title.length}/200</span></label>
                <textarea value={nw.title} onChange={(e) => setNwField("title", e.target.value)} rows={2}
                  placeholder="Personalized Bedtime Story Book, Custom Name Children's Book, Dragon Unicorn Fairy Adventure, Baby Shower Birthday Gift"
                  style={{ ...ctl, width: "100%", boxSizing: "border-box", resize: "vertical", lineHeight: 1.45, marginBottom: 14 }} />
                <label style={lab}>Description</label>
                <textarea value={nw.description} onChange={(e) => setNwField("description", e.target.value)} rows={5}
                  style={{ ...ctl, width: "100%", boxSizing: "border-box", resize: "vertical", lineHeight: 1.5, marginBottom: 14 }} />
                <label style={lab}>Tags <span style={secSub}>· comma separated</span></label>
                <input value={nw.tags} onChange={(e) => setNwField("tags", e.target.value)} placeholder="personalized book, custom name book, baby shower gift"
                  style={{ ...ctl, width: "100%", boxSizing: "border-box" }} />
              </div>

              {/* 3 · INVENTORY AND PRICING */}
              <div style={sec}>
                <div style={secTitle}>Inventory and pricing</div>
                <div style={{ display: "grid", gridTemplateColumns: "170px 130px 1fr", gap: 12 }}>
                  <div>
                    <label style={lab}>Price (USD)</label>
                    <input value={nw.price} inputMode="decimal" placeholder="16.65"
                      onChange={(e) => setNwField("price", e.target.value.replace(/[^0-9.]/g, ""))}
                      style={{ ...ctl, width: "100%", boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <label style={lab}>Quantity</label>
                    <input value={nw.quantity} inputMode="numeric"
                      onChange={(e) => setNwField("quantity", e.target.value.replace(/[^0-9]/g, ""))}
                      style={{ ...ctl, width: "100%", boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <label style={lab}>SKU</label>
                    <input value={nw.sku} onChange={(e) => setNwField("sku", e.target.value)}
                      style={{ ...ctl, width: "100%", boxSizing: "border-box", fontFamily: "ui-monospace,monospace", fontSize: 12.5 }} />
                  </div>
                </div>
              </div>

              {/* 4 · VARIATIONS — giống hệt form Edit: mỗi giá trị một dòng + cột Price khi tick "Prices vary" */}
              <div style={sec}>
                <div style={secTitle}>Variations <span style={secSub}>· {nvVars.length} variation{nvVars.length === 1 ? "" : "s"} → {nvCombos} variant{nvCombos === 1 ? "" : "s"} on Shopify</span></div>
                {nw.variations.length === 0 && (
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>No variations — this listing pushes as a single variant.</div>
                )}
                {nw.variations.map((v, i) => {
                  const cols = newVary[i] ? "1fr 120px 26px" : "1fr 26px";
                  return (
                    <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 12, marginBottom: 12, overflow: "hidden" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "#FAFBFD", borderBottom: "1px solid var(--line)" }}>
                        <input value={v.name} placeholder="Size" list="etsy-props-new" onChange={(e) => nSetVarName(i, e.target.value)}
                          style={{ ...ctl, padding: "7px 11px", fontSize: 13, fontWeight: 700, width: 190 }} />
                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted)", cursor: "pointer", userSelect: "none" }}>
                          <input type="checkbox" checked={!!newVary[i]} onChange={(e) => nToggleVary(i, e.target.checked)} style={{ cursor: "pointer" }} />
                          Prices vary for each {v.name.trim() || "option"}
                        </label>
                        <div style={{ flex: 1 }} />
                        <button title="Remove variation" onClick={() => nRemoveVar(i)} style={{ ...linkBtn("var(--red)"), fontSize: 17 }}>×</button>
                      </div>
                      <div style={{ padding: "10px 12px" }}>
                        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8, fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 6, letterSpacing: .3 }}>
                          <div>OPTION</div>{newVary[i] && <div>PRICE (USD)</div>}<div />
                        </div>
                        {v.values.map((val, j) => (
                          <div key={j} style={{ display: "grid", gridTemplateColumns: cols, gap: 8, marginBottom: 6, alignItems: "center" }}>
                            <input value={val} placeholder={'8" x 8"'} onChange={(e) => nSetVal(i, j, e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); nAddVal(i, j + 1); } }}
                              style={{ ...ctl, padding: "7px 11px", fontSize: 12.5, width: "100%", boxSizing: "border-box" }} />
                            {newVary[i] && (
                              <input value={nw.variantPrices[val] ?? ""} inputMode="decimal" placeholder={nw.price || "0.00"}
                                onChange={(e) => nSetVP(val, e.target.value.replace(/[^0-9.]/g, ""))}
                                style={{ ...ctl, padding: "7px 11px", fontSize: 12.5, width: "100%", boxSizing: "border-box" }} />
                            )}
                            <button title="Remove option" onClick={() => nRemoveVal(i, j)} style={{ ...linkBtn("var(--red)"), fontSize: 17 }}>×</button>
                          </div>
                        ))}
                        <button onClick={() => nAddVal(i, v.values.length)} style={{ ...linkBtn(ETSY_ORANGE), fontSize: 12.5, marginTop: 2 }}>+ Add another option</button>
                      </div>
                    </div>
                  );
                })}
                {nw.variations.length < 6 && (
                  <button onClick={nAddVar} style={{ ...ghost, fontSize: 12.5, padding: "8px 14px" }}>+ Add variation</button>
                )}
                {nvWarn && (
                  <div style={{ marginTop: 10, fontSize: 12, color: "#B54708", background: "#FFFAEB", border: "1px solid #FEDF89", borderRadius: 10, padding: "8px 11px" }}>{nvWarn}</div>
                )}
                <datalist id="etsy-props-new">
                  <option value="Size" /><option value="Color" /><option value="Material" /><option value="Paper" /><option value="Style" /><option value="Finish" />
                </datalist>
              </div>

              {/* 5 · PERSONALIZATION — v142 · ô khách phải điền trước khi Add to cart */}
              <div style={{ ...sec, border: `1px solid ${ETSY_ORANGE}44`, background: "#FFF9F5", marginBottom: 0 }}>
                <div style={{ ...secTitle, color: ETSY_ORANGE }}>Personalization <span style={secSub}>· {nw.personalization.length}/5 fields</span></div>
                <CustomOptions fields={nw.personalization} onChange={(f) => setNwField("personalization", f)} accent={ETSY_ORANGE} onEditingChange={setNewPersEditing} />
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
          <div style={{ background: "#fff", width: 940, maxWidth: "96vw", maxHeight: "92vh", borderRadius: 18, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(16,24,40,.24)", animation: "popIn .18s ease" }} onClick={(e) => e.stopPropagation()}>
            {/* header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", borderBottom: "1px solid var(--line)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <MarketplaceLogo mk="etsy" size={20} />
                <div style={{ fontWeight: 800, fontSize: 17 }}>Edit listing</div>
                <span style={{ fontSize: 11.5, color: "var(--muted)" }}>· Etsy info · edit Shopify content in Manage Products · Shopify</span>
              </div>
              <button onClick={() => setEditId(null)} style={{ border: "none", background: "#F3F4F6", borderRadius: 9, width: 30, height: 30, cursor: "pointer", fontSize: 16, color: "var(--muted)" }}>×</button>
            </div>

            {editLoading || !edit ? (
              <div style={{ padding: 50, textAlign: "center", color: "var(--muted)" }}>Loading…</div>
            ) : (
              <div style={{ padding: "16px 18px 20px", overflowY: "auto", flex: 1, background: "#F5F6F8" }}>

                {/* 1 · PHOTOS — tile lớn xếp ngang, kéo thả đổi thứ tự, ô đầu là Thumbnail (đúng chữ Etsy dùng) */}
                <div style={sec}>
                  <div style={secTitle}>Photos <span style={secSub}>({edit.images.length}/20) · drag to reorder · the first photo is the thumbnail</span></div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {edit.images.map((u, i) => (
                      <div key={i} draggable
                        onDragStart={() => setDragImg(i)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => { if (dragImg !== null && dragImg !== i) moveImg(dragImg, i); setDragImg(null); }}
                        onDragEnd={() => setDragImg(null)}
                        style={{ position: "relative", width: 94, height: 94, borderRadius: 10, overflow: "hidden", background: "#fff", cursor: "grab", opacity: dragImg === i ? .45 : 1, border: dragImg === i ? `2px dashed ${ETSY_ORANGE}` : "1px solid var(--line)" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={u} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        {i === 0 && <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, fontSize: 9.5, fontWeight: 800, background: "rgba(0,0,0,.62)", color: "#fff", padding: "2px 0", textAlign: "center", letterSpacing: .2 }}>Thumbnail</span>}
                        <button title="Remove photo" onClick={() => setEdit({ ...edit, images: edit.images.filter((_, k) => k !== i) })}
                          style={{ position: "absolute", top: 3, right: 3, border: "none", background: "rgba(0,0,0,.6)", color: "#fff", borderRadius: 6, width: 20, height: 20, fontSize: 12, lineHeight: "20px", padding: 0, cursor: "pointer" }}>×</button>
                      </div>
                    ))}
                    <label style={{ width: 94, height: 94, borderRadius: 10, border: `1.5px dashed ${ETSY_ORANGE}88`, background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, color: ETSY_ORANGE, fontSize: 11, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? .5 : 1 }}>
                      <span style={{ fontSize: 21, lineHeight: 1 }}>+</span>{busy ? "Uploading…" : "Add photos"}
                      <input type="file" accept="image/*" multiple disabled={busy} onChange={(e) => { uploadImg(e.target.files); e.target.value = ""; }} style={{ display: "none" }} />
                    </label>
                  </div>
                  <button onClick={addImgUrl} disabled={busy} style={{ ...linkBtn("var(--blue)"), fontSize: 12, marginTop: 10 }}>+ Add by URL</button>
                </div>

                {/* 2 · LISTING DETAILS — bản gốc Etsy, read-only (nội dung Shopify sửa bên Manage Products · Shopify) */}
                <div style={sec}>
                  <div style={secTitle}>Listing details <span style={secSub}>· from Etsy · read-only</span></div>
                  <label style={lab}>Title</label>
                  <div style={ro}>{edit.title}</div>
                  <label style={lab}>Description</label>
                  <div style={{ ...ro, maxHeight: 170, overflowY: "auto", whiteSpace: "pre-wrap", color: edit.description ? "var(--ink)" : "var(--muted)" }}>{edit.description || "—"}</div>
                  <label style={lab}>Tags</label>
                  <div style={{ ...ro, marginBottom: 0, color: edit.tags ? "var(--ink)" : "var(--muted)" }}>{(edit.tags ?? "").replace(/_/g, " ") || "—"}</div>
                </div>

                {/* 3 · INVENTORY AND PRICING — gom Price/Quantity/SKU về một chỗ như Etsy */}
                <div style={sec}>
                  <div style={secTitle}>Inventory and pricing</div>
                  <div style={{ display: "grid", gridTemplateColumns: "170px 130px 1fr", gap: 12 }}>
                    <div>
                      <label style={lab}>Price (USD)</label>
                      <input value={edit.price ?? ""} inputMode="decimal" placeholder="0.00"
                        onChange={(e) => setEdit({ ...edit, price: e.target.value.replace(/[^0-9.]/g, "") })}
                        style={{ ...ctl, width: "100%", boxSizing: "border-box" }} />
                    </div>
                    <div>
                      <label style={lab}>Quantity <span style={secSub}>· Etsy</span></label>
                      <div style={{ ...ro, marginBottom: 0 }}>{edit.quantity ?? "—"}</div>
                    </div>
                    <div>
                      <label style={lab}>SKU <span style={secSub}>· Etsy</span></label>
                      <div style={{ ...ro, marginBottom: 0, fontFamily: "ui-monospace,monospace", fontSize: 12.5 }}>{edit.sku || "—"}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 10 }}>
                    Store <b style={{ color: "var(--ink)" }}>{edit.storeName ?? "—"}</b>{edit.sellerName ? <> · Seller <b style={{ color: "var(--ink)" }}>{edit.sellerName}</b></> : null}
                  </div>
                </div>

                {/* 4 · VARIATIONS — mỗi giá trị một dòng riêng + cột Price khi tick "Prices vary", đúng kiểu Etsy */}
                <div style={sec}>
                  <div style={secTitle}>Variations <span style={secSub}>· {evVars.length} variation{evVars.length === 1 ? "" : "s"} → {evCombos} variant{evCombos === 1 ? "" : "s"} on Shopify</span></div>
                  {edit.variations.length === 0 && (
                    <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>No variations — this listing pushes as a single variant.</div>
                  )}
                  {edit.variations.map((v, i) => {
                    const vals = v.values ?? [];
                    const cols = vary[i] ? "1fr 120px 26px" : "1fr 26px";
                    return (
                      <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 12, marginBottom: 12, overflow: "hidden" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "#FAFBFD", borderBottom: "1px solid var(--line)" }}>
                          <input value={v.name ?? ""} placeholder="Size" list="etsy-props" onChange={(e) => setVarName(i, e.target.value)}
                            style={{ ...ctl, padding: "7px 11px", fontSize: 13, fontWeight: 700, width: 190 }} />
                          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted)", cursor: "pointer", userSelect: "none" }}>
                            <input type="checkbox" checked={!!vary[i]} onChange={(e) => toggleVary(i, e.target.checked)} style={{ cursor: "pointer" }} />
                            Prices vary for each {String(v.name ?? "").trim() || "option"}
                          </label>
                          <div style={{ flex: 1 }} />
                          <button title="Chuyển xuống Custom (Personalization) — dùng cho Girl/Boy, kiểu nhân vật… không đổi giá"
                            onClick={() => moveVarToCustom(i)}
                            style={{ border: "1px solid #F0D0B6", background: "#FFF6EE", color: ETSY_ORANGE, fontWeight: 700, fontSize: 12, borderRadius: 8, padding: "5px 10px", cursor: "pointer", whiteSpace: "nowrap" }}>
                            ↓ Move to Custom
                          </button>
                          <button title="Remove variation" onClick={() => removeVar(i)} style={{ ...linkBtn("var(--red)"), fontSize: 17 }}>×</button>
                        </div>
                        <div style={{ padding: "10px 12px" }}>
                          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8, fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 6, letterSpacing: .3 }}>
                            <div>OPTION</div>{vary[i] && <div>PRICE (USD)</div>}<div />
                          </div>
                          {vals.map((val, j) => (
                            <div key={j} style={{ display: "grid", gridTemplateColumns: cols, gap: 8, marginBottom: 6, alignItems: "center" }}>
                              <input value={val} placeholder={'8" x 8"'} onChange={(e) => setVal(i, j, e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addVal(i, j + 1); } }}
                                style={{ ...ctl, padding: "7px 11px", fontSize: 12.5, width: "100%", boxSizing: "border-box" }} />
                              {vary[i] && (
                                <input value={edit.variantPrices[val] ?? ""} inputMode="decimal" placeholder={edit.price ?? "0.00"}
                                  onChange={(e) => setVP(val, e.target.value.replace(/[^0-9.]/g, ""))}
                                  style={{ ...ctl, padding: "7px 11px", fontSize: 12.5, width: "100%", boxSizing: "border-box" }} />
                              )}
                              <button title="Remove option" onClick={() => removeVal(i, j)} style={{ ...linkBtn("var(--red)"), fontSize: 17 }}>×</button>
                            </div>
                          ))}
                          <button onClick={() => addVal(i, vals.length)} style={{ ...linkBtn(ETSY_ORANGE), fontSize: 12.5, marginTop: 2 }}>+ Add another option</button>
                        </div>
                      </div>
                    );
                  })}
                  <button onClick={addVar} style={{ ...ghost, fontSize: 12.5, padding: "8px 14px" }}>+ Add variation</button>
                  {evWarn && (
                    <div style={{ marginTop: 10, fontSize: 12, color: "#B54708", background: "#FFFAEB", border: "1px solid #FEDF89", borderRadius: 10, padding: "8px 11px" }}>{evWarn}</div>
                  )}
                  <datalist id="etsy-props">
                    <option value="Size" /><option value="Color" /><option value="Material" /><option value="Paper" /><option value="Style" /><option value="Finish" />
                  </datalist>
                </div>

                {/* 5 · PERSONALIZATION — v142 · ô khách phải điền trước khi Add to cart */}
                <div style={{ ...sec, border: `1px solid ${ETSY_ORANGE}44`, background: "#FFF9F5", marginBottom: 0 }}>
                  <div style={{ ...secTitle, color: ETSY_ORANGE }}>Personalization <span style={secSub}>· {edit.personalization.length}/5 fields</span></div>
                  <CustomOptions fields={edit.personalization} onChange={(f) => setEdit({ ...edit, personalization: f })} accent={ETSY_ORANGE} onEditingChange={setPersEditing} />
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
// v204 · icon copy (simple line) cho nút Duplicate
const IcCopy = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
// v204 · nút icon nhỏ chỉ có đường viền line — dùng cho Actions (Duplicate / Delete)
const iconBtn = (c: string): React.CSSProperties => ({ border: "none", background: "none", padding: 4, cursor: "pointer", color: c, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 7 });
const IcSearch = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>;
const IcShop = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l1-5h16l1 5M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9M3 9h18M9 20v-6h6v6" /></svg>;
const IcEdit = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>;
