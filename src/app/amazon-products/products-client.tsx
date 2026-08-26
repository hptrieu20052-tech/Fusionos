"use client";

/**
 * Manage Products · Amazon (v286)
 *
 * Bản STAGE riêng của từng listing (như flow Etsy → Shopify): "Push to Amazon" bên
 * Manage Products Shopify tạo bản ghi ở đây; hoàn thiện copy Amazon (AI title 150-200 +
 * 5 bullets + description) rồi Export file customization. Không đụng gì Shopify.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AmazonLogo } from "@/components/amazon-logo";

type Variation = { suffix: string; label: string; price: string };
type Row = {
  id: string; shopifyProductId: string | null;
  title: string | null; bullets: string[] | null; description: string | null;
  aiAt: string | null; status: string; asin: string | null; exportedAt: string | null;
  skuAsins?: Record<string, string> | null; // v349 · map {sku: asin} parent+con để click mở link
  amazonTemplateId: string | null;
  // v313 · override giá/variant riêng listing (null = dùng variations của template)
  variations: Variation[] | null;
  manual?: boolean; // v315 · import thẳng từ Amazon (không có nguồn Shopify)
  sourceTitle: string; productType: string; sourceStatus: string;
  image: string; imageCount: number; srcVariantCount: number; skuRoot: string; storeName: string | null;
  // v297 · bộ ảnh riêng Amazon (null = dùng ảnh Shopify) + toàn bộ ảnh nguồn để khởi điểm
  images: string[] | null; sourceImages: string[];
};
type Tpl = { id: string; name: string; productType: string | null; fields: number; skuSuffixes: string[]; variations?: Variation[] };

const AMZ = "#B5661A";
const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,.04)" };
const ctl: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 12, padding: "10px 13px", fontSize: 13.5, font: "inherit", background: "#fff", outline: "none" };
const pill = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 7, border: "none", background: bg, color: fg, borderRadius: 12, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" });
const lab: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 4 };
const chip = (bg: string, fg: string): React.CSSProperties => ({ fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: bg, color: fg });
// v311 · nhãn trạng thái theo cách Amazon (Draft / Submitted / Live). Enum nội bộ giữ nguyên.
const STATUS_LABEL: Record<string, string> = { DRAFT: "Draft", EXPORTED: "Submitted", LIVE: "Live", INACTIVE: "Inactive" };
const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;

const ago = (iso: string | null) => {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

async function postJSON(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  try { return JSON.parse(text); }
  catch { return { ok: false, error: `HTTP ${r.status} — server returned non-JSON (route timeout or not deployed).` }; }
}

const titleOk = (t: string | null) => !!t && t.length >= 140 && t.length <= 200;
const bulletsOk = (b: string[] | null) => Array.isArray(b) && b.filter(Boolean).length === 5;
const descOk = (d: string | null) => !!d && d.length >= 600;
const readyOk = (r: Row) => titleOk(r.title) && bulletsOk(r.bullets) && descOk(r.description);

export default function AmazonProductsClient({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [fStore, setFStore] = useState("");   // v308 · lọc theo store nguồn
  const [fType, setFType] = useState("");     // v308 · lọc theo product type
  const [fStatus, setFStatus] = useState(""); // v310 · lọc theo trạng thái Amazon
  const [fTpl, setFTpl] = useState("");       // v310 · lọc theo template
  const [fAi, setFAi] = useState("");         // v310 · lọc theo tình trạng AI copy (ready/todo)
  const [fBad, setFBad] = useState(false);    // v352 · lọc listing family THIẾU con (mồ côi) để repush nhanh
  const [amzStores, setAmzStores] = useState<{ id: string; name: string }[]>([]); // v308 · các store Amazon (SP-API account)
  const [storeSel, setStoreSel] = useState(""); // v308 · store Amazon đang chọn cho Sync/SP-API
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [prog, setProg] = useState("");
  const [edit, setEdit] = useState<Row | null>(null);
  const [aiModel, setAiModel] = useState("");
  const [aiModels, setAiModels] = useState<{ id: string; name: string }[]>([]);
  const [tplPick, setTplPick] = useState("");
  const [zoom, setZoom] = useState<{ imgs: string[]; i: number } | null>(null); // v311 · lightbox có kéo qua/lại
  const [confirmDel, setConfirmDel] = useState(""); // v294 · id đang chờ xác nhận xóa
  const [asinOpen, setAsinOpen] = useState(false);  // v304 · modal import ASIN từ report
  const [asinText, setAsinText] = useState("");
  // v305 · SP-API config
  const [cfg, setCfg] = useState<{ region: string; marketplaceId: string; sellerId: string; lwaClientId: string; lwaClientSecret: string; refreshToken: string; hasSecret: boolean; hasRefresh: boolean; configured: boolean }>({ region: "na", marketplaceId: "ATVPDKIKX0DER", sellerId: "", lwaClientId: "", lwaClientSecret: "", refreshToken: "", hasSecret: false, hasRefresh: false, configured: false });
  const [dragImg, setDragImg] = useState<number | null>(null); // v297 · kéo-thả xếp ảnh trong modal
  const [upBusy, setUpBusy] = useState(false);                  // v298 · đang upload ảnh local
  const [whiteBusy, setWhiteBusy] = useState(false);            // v307 · đang tạo ảnh main nền trắng
  const [importOpen, setImportOpen] = useState(false);          // v317 · modal Import listing
  const [importSku, setImportSku] = useState("");
  const [page, setPage] = useState(1);                          // v318 · phân trang
  const [pageSize, setPageSize] = useState(20);
  const imgFileRef = useRef<HTMLInputElement>(null);

  // v297 · bộ ảnh hiệu lực trong modal: override nếu có, không thì ảnh Shopify nguồn.
  const effImages = (r: Row): string[] => r.images ?? r.sourceImages;
  const setImgs = (arr: string[]) => setEdit((p) => p ? { ...p, images: arr } : p);

  // v298 · Upload ảnh từ máy: presign → PUT thẳng lên R2 → thêm publicUrl vào bộ ảnh Amazon.
  const uploadImages = async (files: File[]) => {
    if (!edit) return;
    setUpBusy(true);
    const added: string[] = [];
    for (const f of files.slice(0, 10)) {
      try {
        const j = await postJSON("/api/amazon-products/image-url", { filename: f.name, contentType: f.type || "image/jpeg" });
        if (!j.ok || !j.url) { flash("✗ " + (j.error ?? "Upload URL failed")); continue; }
        const put = await fetch(j.url, { method: j.method ?? "PUT", headers: { "Content-Type": f.type || "image/jpeg" }, body: f });
        if (!put.ok) { flash(`✗ Upload failed (${put.status})`); continue; }
        if (j.publicUrl) added.push(j.publicUrl);
      } catch (e) { flash("✗ " + String((e as Error)?.message ?? e)); }
    }
    if (added.length) setImgs([...effImages(edit), ...added]);
    setUpBusy(false);
  };

  // v307 · Tạo ảnh MAIN nền trắng chuẩn Amazon từ ảnh main hiện tại (mockup Book Studio):
  // làm sạch nền → trắng tuyệt đối, vuông 1600, JPEG nhẹ. Ảnh gốc lùi xuống làm ảnh phụ.
  const makeWhiteMain = async () => {
    if (!edit) return;
    const imgs = effImages(edit);
    const src = imgs[0];
    if (!src) { flash("No image yet — add one first"); return; }
    setWhiteBusy(true);
    try {
      const j = await postJSON("/api/amazon-products/purify-image", { url: src });
      if (j.ok && j.url) {
        const rest = src.includes("/amazon-mockup/") ? imgs.slice(1) : imgs; // đã là mockup → thay; chưa → giữ gốc làm ảnh phụ
        setImgs([j.url, ...rest].slice(0, 9));
        flash("✓ White-background main image created");
      } else flash("✗ " + (j.error ?? "image processing error"));
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e)); }
    setWhiteBusy(false);
  };

  // Template khớp cho 1 sản phẩm: gán tay → khớp Product type → template duy nhất.
  const tplFor = (r: Row): Tpl | null => {
    if (r.amazonTemplateId) { const t = tpls.find((x) => x.id === r.amazonTemplateId); if (t) return t; }
    const pt = r.productType.trim().toLowerCase();
    if (pt) { const t = tpls.find((x) => (x.productType ?? "").trim().toLowerCase() === pt); if (t) return t; }
    return tpls.length === 1 ? tpls[0] : null;
  };
  // v313 · variations HIỆU LỰC: override riêng listing nếu có, không thì lấy của template.
  const effVars = (r: Row): Variation[] => (r.variations && r.variations.length ? r.variations : (tplFor(r)?.variations ?? []));
  const priceOf = (vars: Variation[]): string => {
    const ps = vars.map((v) => Number(v.price)).filter((n) => !isNaN(n) && n > 0);
    if (!ps.length) return "—";
    const lo = Math.min(...ps), hi = Math.max(...ps);
    return lo === hi ? `$${lo.toFixed(2)}` : `$${lo.toFixed(2)}–$${hi.toFixed(2)}`;
  };

  const load = async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        fetch("/api/amazon-products").then((r) => r.json()),
        fetch("/api/amazon-templates").then((r) => r.json()),
      ]);
      if (a.ok) setRows(a.rows);
      if (b.ok) { setTpls(b.templates); if (!tplPick && b.templates[0]) setTplPick(b.templates[0].id); }
    } catch { /* offline */ }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => {
    fetch("/api/books/models?type=text").then((r) => r.json()).then((j) => { if (Array.isArray(j?.models)) setAiModels(j.models); }).catch(() => { /* offline */ });
    // v303 · nhớ model đã chọn qua localStorage (app thật, không phải artifact)
    try { const m = localStorage.getItem("amzAiModel"); if (m) setAiModel(m); } catch { /* ignore */ }
  }, []);
  // Ghi lại mỗi khi đổi model
  useEffect(() => { try { localStorage.setItem("amzAiModel", aiModel); } catch { /* ignore */ } }, [aiModel]);
  // v308 · nạp danh sách store Amazon (SP-API account) cho bộ chọn ở header
  useEffect(() => {
    fetch("/api/stores?marketplace=amazon").then((r) => r.json()).then((j) => {
      if (j.ok && Array.isArray(j.stores)) {
        const list = (j.stores as { id: string; name: string }[]).map((s) => ({ id: s.id, name: s.name }));
        setAmzStores(list);
        setStoreSel((prev) => prev || list[0]?.id || "");
      }
    }).catch(() => { /* offline */ });
  }, []);
  // v308 · nạp trạng thái SP-API của store đang chọn (để nút Sync biết đã cấu hình chưa — không cần mở Settings)
  useEffect(() => {
    if (!storeSel) return;
    fetch(`/api/amazon-config?storeId=${encodeURIComponent(storeSel)}`).then((r) => r.json()).then((j) => {
      if (j.ok) setCfg((p) => ({ ...p, ...(j.config ?? { configured: false }), lwaClientSecret: "", refreshToken: "" }));
    }).catch(() => { /* offline */ });
  }, [storeSel]);

  // v303 · Bộ SKU Amazon THẬT của 1 listing: parent + child theo variations của template.
  const amzSkus = (r: Row): { parent: string; children: { sku: string; label: string }[] } => {
    const vars = effVars(r);
    return {
      parent: r.skuRoot ? `${r.skuRoot}-PARENT-AMZ` : "",
      children: r.skuRoot ? vars.filter((v) => v.suffix).map((v) => ({ sku: `${r.skuRoot}-${v.suffix}`, label: v.label || v.suffix })) : [],
    };
  };
  // v352 · Family THIẾU con: đã có ASIN (đã lên Amazon) + đã Sync (có skuAsins) nhưng số con trong family < số size → mồ côi/chưa đủ.
  const isIncomplete = (r: Row): boolean => {
    if (!r.asin || !r.skuAsins) return false; // chưa lên hoặc chưa sync → không kết luận được
    const expected = amzSkus(r).children.length;
    if (!expected) return false;
    const got = Object.keys(r.skuAsins).filter((k) => !/-PARENT-AMZ$/i.test(k)).length;
    return got < expected;
  };

  const flash = (m: string) => { setNote(m); setTimeout(() => setNote(""), 6000); };

  // v311 · phím ← → chuyển ảnh, Esc đóng lightbox
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setZoom((z) => z ? { ...z, i: (z.i - 1 + z.imgs.length) % z.imgs.length } : z);
      else if (e.key === "ArrowRight") setZoom((z) => z ? { ...z, i: (z.i + 1) % z.imgs.length } : z);
      else if (e.key === "Escape") setZoom(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  // v308/v310 · các tùy chọn đổ vào bộ lọc
  const storeOpts = useMemo(() => Array.from(new Set(rows.map((r) => r.storeName).filter(Boolean))) as string[], [rows]);
  const typeOpts = useMemo(() => Array.from(new Set(rows.map((r) => r.productType).filter(Boolean))) as string[], [rows]);
  const statusOpts = useMemo(() => Array.from(new Set(rows.map((r) => r.status).filter(Boolean))) as string[], [rows]);
  const tplOpts = useMemo(() => Array.from(new Set(rows.map((r) => tplFor(r)?.name).filter(Boolean))) as string[], [rows, tpls]); // eslint-disable-line react-hooks/exhaustive-deps
  const anyFilter = !!(q || fStore || fType || fStatus || fTpl || fAi || fBad);
  const clearFilters = () => { setQ(""); setFStore(""); setFType(""); setFStatus(""); setFTpl(""); setFAi(""); setFBad(false); };
  const badCount = useMemo(() => rows.filter(isIncomplete).length, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (fStore && r.storeName !== fStore) return false;
      if (fType && r.productType !== fType) return false;
      if (fStatus && r.status !== fStatus) return false;
      if (fTpl && tplFor(r)?.name !== fTpl) return false;
      if (fAi === "ready" && !readyOk(r)) return false;
      if (fAi === "todo" && readyOk(r)) return false;
      if (fBad && !isIncomplete(r)) return false;
      if (s && !(r.sourceTitle + " " + (r.title ?? "") + " " + r.skuRoot + " " + r.productType).toLowerCase().includes(s)) return false;
      return true;
    });
  }, [rows, q, fStore, fType, fStatus, fTpl, fAi, fBad]); // eslint-disable-line react-hooks/exhaustive-deps

  // v318 · phân trang (mặc định 20/trang) như Shopify
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageC = Math.min(page, totalPages);
  const paged = filtered.slice((pageC - 1) * pageSize, pageC * pageSize);
  useEffect(() => { setPage(1); }, [q, fStore, fType, fStatus, fTpl, fAi, fBad, pageSize]);

  const toggleAll = () => setSel((p) => p.size === filtered.length ? new Set() : new Set(filtered.map((r) => r.id)));
  const toggle = (id: string) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // AI theo LÔ 6 — client tự chia, hiện tiến độ, gom con fail.
  const runAI = async (ids: string[]) => {
    if (!ids.length) return;
    setBusy(true);
    const failed: string[] = [];
    let done = 0;
    for (let i = 0; i < ids.length; i += 6) {
      const chunk = ids.slice(i, i + 6);
      setProg(`AI Amazon copy — ${done}/${ids.length}…`);
      try {
        const j = await postJSON("/api/amazon-products/ai", { ids: chunk, model: aiModel || undefined });
        for (const res of j?.results ?? []) if (!res.ok) failed.push(res.error ?? res.id);
      } catch { failed.push(...chunk); }
      done += chunk.length;
    }
    setProg("");
    setBusy(false);
    await load();
    flash(failed.length ? `✓ Done with ${failed.length} failed — first error: ${String(failed[0]).slice(0, 120)}` : `✓ AI copy written for ${ids.length} product(s)`);
  };

  const doExport = async () => {
    const ids = Array.from(sel);
    if (!ids.length || !tplPick) return;
    setBusy(true);
    try {
      const res = await fetch("/api/amazon-export/custom-file", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: tplPick, ids }),
      });
      if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.error ?? `HTTP ${res.status}`); }
      const n = res.headers.get("X-Rows") ?? "?";
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `amazon-customizations-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click(); URL.revokeObjectURL(a.href);
      flash(`✓ Exported ${n} SKU rows — upload it at Amazon → Custom Products → Upload Customizations (listings must be LIVE first)`);
      load();
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e)); }
    setBusy(false);
  };

  // v292 · FILE 1 — flat file listing (Add Products via Upload). Tạo Parent + Child theo template.
  const doExportListing = async () => {
    const ids = Array.from(sel);
    if (!ids.length) return;
    setBusy(true);
    try {
      const res = await fetch("/api/amazon-export/listing-file", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.error ?? `HTTP ${res.status}`); }
      const n = res.headers.get("X-Rows") ?? "?";
      const sk = Number(res.headers.get("X-Skipped") ?? 0);
      const skFirst = decodeURIComponent(res.headers.get("X-Skipped-First") ?? "");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `amazon-listings-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click(); URL.revokeObjectURL(a.href);
      flash(`✓ Listing file: ${n} rows (parent+child) — upload at Catalog → Add Products via Upload${sk ? ` · ${sk} skipped: ${skFirst}` : ""}`);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e)); }
    setBusy(false);
  };

  // v351 · ⬆ Push to Amazon — TỰ chia nhóm 6/lần đẩy tuần tự để mỗi request gọn trong 52s
  // → đẩy nhiều listing 1 click, KHÔNG timeout / rớt con. Push 1 listing (từ modal) vẫn 1 call.
  const PUSH_CHUNK = 6;
  const pushListing = async (ids: string[], closeAfter = false) => {
    if (!ids.length) return;
    if (!cfg.configured) { flash("✗ SP-API not configured — Stores → Amazon store → Amazon SP-API section"); return; }
    setBusy(true);
    let updated = 0, created = 0; const skipped: string[] = []; const issues: string[] = []; let failed = "";
    try {
      for (let i = 0; i < ids.length; i += PUSH_CHUNK) {
        const chunk = ids.slice(i, i + PUSH_CHUNK);
        setProg(ids.length > PUSH_CHUNK ? `Pushing ${i + 1}–${Math.min(i + PUSH_CHUNK, ids.length)} of ${ids.length}…` : "Pushing to Amazon…");
        const j = await postJSON("/api/amazon-products/push-listing", { ids: chunk, storeId: storeSel || undefined });
        if (j.ok) { updated += j.updated ?? 0; created += j.created ?? 0; if (Array.isArray(j.skipped)) skipped.push(...j.skipped); if (Array.isArray(j.issues)) issues.push(...j.issues); }
        else { failed = j.error ?? "Push failed"; break; }
      }
      if (failed) flash("✗ " + failed);
      else {
        flash(`✓ Updated ${updated} · created ${created} SKU(s)${skipped.length ? ` · ${skipped.length} skipped` : ""}${issues.length ? ` · ${issues[0]}` : ""}`);
        if (closeAfter) setEdit(null);
      }
      load();
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e)); }
    setProg(""); setBusy(false);
  };

  // v315/v317 · Import 1 listing đã live trên Amazon (kể cả list tay) về FusionOS theo SKU parent (modal).
  const doImportListing = async () => {
    const sku = importSku.trim();
    if (!sku) { flash("Enter the parent SKU first"); return; }
    setBusy(true); setProg("Importing from Amazon…");
    try {
      const j = await postJSON("/api/amazon-products/import-listing", { sku, storeId: storeSel || undefined });
      if (j.ok) { flash("✓ " + (j.note ?? "Imported")); setImportOpen(false); setImportSku(""); load(); }
      else flash("✗ " + (j.error ?? "Import failed"));
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e)); }
    setProg(""); setBusy(false);
  };

  // v305 · SP-API — mở settings, lưu, test, sync
  const syncAsins = async (ids?: string[]) => {
    setBusy(true); setProg("Syncing ASINs from Amazon…");
    try {
      const j = await postJSON("/api/amazon-products/sync-asins", { ...(ids ? { ids } : {}), storeId: storeSel || undefined });
      if (j.ok) flash(`✓ Synced ${j.updated} ASIN(s)${j.removed ? ` · ${j.removed} removed on Amazon → set to Draft` : ""}${j.notFound ? ` · ${j.notFound} not on Amazon yet` : ""}${j.errors?.length ? ` · ${j.errors[0]}` : ""}`);
      else flash("✗ " + (j.error ?? "Sync failed"));
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e)); }
    setProg(""); setBusy(false); load();
  };

  // v304 · Import ASIN từ Amazon Listings Report (TSV/CSV) → khớp SKU root → điền ASIN + LIVE.
  const importAsins = async () => {
    if (!asinText.trim()) return;
    setBusy(true);
    try {
      const j = await postJSON("/api/amazon-products/import-asins", { text: asinText });
      if (j.ok) { flash(`✓ Matched ${j.updated} listing(s) with ASINs`); setAsinOpen(false); setAsinText(""); load(); }
      else flash("✗ " + (j.error ?? "Import failed"));
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e)); }
    setBusy(false);
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/amazon-products?id=${id}`, { method: "DELETE" }).then((x) => x.json());
      if (r.ok) { setRows((p) => p.filter((x) => x.id !== id)); setSel((p) => { const n = new Set(p); n.delete(id); return n; }); }
      else flash("✗ " + (r.error ?? "Delete failed"));
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e)); }
    setBusy(false);
  };

  // v311 · lưu nội dung edit về FusionOS. persist=false = không đóng modal (để push tiếp).
  const persistEdit = async (): Promise<boolean> => {
    if (!edit) return false;
    const r = await fetch("/api/amazon-products", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: edit.id, title: edit.title ?? "", bullets: (edit.bullets ?? []).filter(Boolean), description: edit.description ?? "", asin: edit.asin ?? "", amazonTemplateId: edit.amazonTemplateId ?? "", ...(edit.images ? { images: edit.images } : {}), ...(edit.variations ? { variations: edit.variations } : { variations: [] }) }),
    }).then((x) => x.json()).catch(() => ({ ok: false }));
    return !!r.ok;
  };
  const saveEdit = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      if (await persistEdit()) { flash("✓ Saved"); setEdit(null); load(); }
      else flash("✗ Save failed");
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e)); }
    setBusy(false);
  };
  // v311 · Lưu edit rồi đẩy luôn listing này lên Amazon (update qua SP-API).
  const saveAndPush = async () => {
    if (!edit) return;
    const id = edit.id;
    setBusy(true);
    const ok = await persistEdit();
    setBusy(false);
    if (!ok) { flash("✗ Save failed"); return; }
    await pushListing([id], true);
  };

  const aiOne = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      const j = await postJSON("/api/amazon-products/ai", { ids: [edit.id], model: aiModel || undefined });
      const r = j?.results?.[0];
      if (j.ok && r?.ok) {
        setEdit((p) => p ? { ...p, title: r.title ?? p.title, bullets: r.bullets ?? p.bullets, description: r.description ?? p.description, aiAt: new Date().toISOString() } : p);
        setRows((prev) => prev.map((x) => x.id === edit.id ? { ...x, title: r.title ?? x.title, bullets: r.bullets ?? x.bullets, description: r.description ?? x.description, aiAt: new Date().toISOString() } : x));
        flash("✓ AI copy generated & saved");
      } else flash("✗ " + (r?.error ?? j.error ?? "AI failed"));
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e)); }
    setBusy(false);
  };


  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "18px 16px" }}>
      {/* Header */}
      <div style={{ ...card, padding: "16px 20px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <AmazonLogo size={46} />
          <div>
            <div style={{ fontSize: 21, fontWeight: 800 }}>Manage Products · Amazon</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* v308 · Bộ chọn store Amazon (SP-API account) — như ô chọn store bên Shopify. Cấu hình SP-API ở Stores. */}
          {amzStores.length > 0 && (
            <select value={storeSel} onChange={(e) => setStoreSel(e.target.value)} title="Amazon store (SP-API account) · configure API keys in Stores" style={{ ...ctl, padding: "9px 12px", fontWeight: 700, minWidth: 150 }}>
              {amzStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <button disabled={busy || !cfg.configured} onClick={() => { setImportSku(""); setImportOpen(true); }} title={cfg.configured ? "Pull a listing that is already live on Amazon (even one listed manually) into FusionOS by its parent SKU" : "Configure SP-API in Stores first"} style={{ ...pill("#EEF1F5", "#333"), padding: "9px 12px", opacity: cfg.configured ? 1 : .5 }}>⇩ Import listing</button>
          <button disabled={busy || !cfg.configured} onClick={() => syncAsins(sel.size ? Array.from(sel) : undefined)} title={cfg.configured ? "Pull ASINs & status from Amazon. Select rows first to sync exactly those (even Drafts); with nothing selected it syncs all submitted listings." : "Configure SP-API in Stores (open the Amazon store → Amazon SP-API section)"} style={{ ...pill("#FF9900", "#111"), padding: "9px 14px", opacity: cfg.configured ? 1 : .5 }}>⟳ Sync from Amazon{sel.size ? ` (${sel.size})` : ""}</button>
        </div>
      </div>

      {note && <div style={{ ...card, padding: "10px 16px", marginBottom: 12, fontSize: 13, fontWeight: 600, color: note.startsWith("✓") ? "#1F6F45" : "#B42318" }}>{note}</div>}
      {prog && <div style={{ ...card, padding: "10px 16px", marginBottom: 12, fontSize: 13, fontWeight: 600, color: AMZ }}>{prog}</div>}

      {/* Toolbar — 2 hàng: (1) tìm & chọn · (2) hành động theo nhóm AI | EXPORT */}
      <div style={{ ...card, padding: "12px 16px", marginBottom: 12 }}>
        {/* Hàng 1 — LỌC */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title / SKU / type" style={{ ...ctl, flex: "1 1 240px", minWidth: 180 }} />
          <select value={fStore} onChange={(e) => setFStore(e.target.value)} title="Filter by source store" style={{ ...ctl, padding: "8px 10px", fontSize: 12.5, maxWidth: 130 }}>
            <option value="">All stores</option>
            {storeOpts.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={fType} onChange={(e) => setFType(e.target.value)} title="Filter by product type" style={{ ...ctl, padding: "8px 10px", fontSize: 12.5, maxWidth: 140 }}>
            <option value="">All types</option>
            {typeOpts.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} title="Filter by Amazon status" style={{ ...ctl, padding: "8px 10px", fontSize: 12.5, maxWidth: 120 }}>
            <option value="">All status</option>
            {statusOpts.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
          <select value={fTpl} onChange={(e) => setFTpl(e.target.value)} title="Filter by template" style={{ ...ctl, padding: "8px 10px", fontSize: 12.5, maxWidth: 140 }}>
            <option value="">All templates</option>
            {tplOpts.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={fAi} onChange={(e) => setFAi(e.target.value)} title="Filter by AI copy readiness" style={{ ...ctl, padding: "8px 10px", fontSize: 12.5, maxWidth: 120 }}>
            <option value="">AI: all</option>
            <option value="ready">Copy ready</option>
            <option value="todo">No copy yet</option>
          </select>
          {badCount > 0 && (
            <button onClick={() => setFBad((v) => !v)} title="Listings whose Amazon family is missing a size (orphaned) — select and Push to fix. Run Sync first to detect." style={{ ...pill(fBad ? "#B42318" : "#FDECEA", fBad ? "#fff" : "#B42318"), border: "1px solid #F3C9C9", padding: "8px 12px", fontSize: 12.5, whiteSpace: "nowrap" }}>⚠ Needs fix ({badCount})</button>
          )}
          {anyFilter && <button onClick={clearFilters} title="Clear all filters" style={{ border: "none", background: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "#1D4ED8", padding: "0 4px" }}>Clear filters</button>}
        </div>

        {/* Hàng 2 — CHỌN + hành động theo nhóm: Select · AI · PUSH · EXPORT */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
          {/* Chọn */}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <button onClick={toggleAll} style={{ ...pill("#EEF1F5", "#333"), padding: "8px 12px", whiteSpace: "nowrap" }}>{sel.size === filtered.length && filtered.length ? "Deselect all" : `Select all ${filtered.length}`}</button>
            {sel.size > 0 && <span style={{ fontSize: 12.5, fontWeight: 800, color: "#1F6F45", whiteSpace: "nowrap" }}>{sel.size} selected</span>}
          </span>
          <span style={{ width: 1, alignSelf: "stretch", background: "var(--line)" }} />
          {/* AI */}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <select value={aiModel} onChange={(e) => setAiModel(e.target.value)} title="AI model for Amazon copy" style={{ ...ctl, padding: "8px 10px", fontSize: 12.5, maxWidth: 150 }}>
              <option value="">Model: Default</option>
              {aiModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {canEdit && (
              <button disabled={busy || !sel.size} onClick={() => runAI(Array.from(sel))} title="Generate Amazon copy (title/bullets/description) with AI" style={{ ...pill("#5B3FBF", "#fff"), opacity: busy || !sel.size ? .45 : 1, whiteSpace: "nowrap" }}>✦ AI{sel.size ? ` (${sel.size})` : ""}</button>
            )}
          </span>
          <span style={{ width: 1, alignSelf: "stretch", background: "var(--line)" }} />
          {/* PUSH */}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <button disabled={busy || !sel.size || !cfg.configured} onClick={() => pushListing(Array.from(sel))} title={cfg.configured ? "Push to Amazon via SP-API — updates live listings and creates new ones by cloning a live listing of the same type." : "Configure SP-API in Stores → Amazon store first"} style={{ ...pill("#1F6F45", "#fff"), opacity: busy || !sel.size || !cfg.configured ? .45 : 1, whiteSpace: "nowrap" }}>⬆ Push to Amazon{sel.size ? ` (${sel.size})` : ""}</button>
            <button disabled={busy || !sel.size} onClick={doExportListing} title="Download the flat file (.txt) to create listings at Add Products via Upload — the most reliable way to build variation families." style={{ ...pill("#E6F4F1", "#0F766E"), border: "1px solid #9BD5CB", opacity: busy || !sel.size ? .45 : 1, cursor: busy || !sel.size ? "default" : "pointer", whiteSpace: "nowrap" }}>↓ flat file{sel.size ? ` (${sel.size})` : ""}</button>
          </span>
          <span style={{ width: 1, alignSelf: "stretch", background: "var(--line)" }} />
          {/* EXPORT customization */}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <select value={tplPick} onChange={(e) => setTplPick(e.target.value)} title="Amazon customization template (Manage Templates Amazon)" style={{ ...ctl, padding: "8px 10px", fontSize: 12.5, maxWidth: 150 }}>
              {tpls.length === 0 && <option value="">No template</option>}
              {tpls.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button disabled={busy || !sel.size || !tplPick} onClick={doExport} title="Customization .xlsx — upload at Custom Products → Upload Customizations (Amazon has no API for Custom). Listing must be LIVE with inventory first." style={{ ...pill("#FF9900", "#111"), opacity: busy || !sel.size || !tplPick ? .45 : 1, whiteSpace: "nowrap" }}>↓ 2 · Customization{sel.size ? ` (${sel.size})` : ""}</button>
          </span>
        </div>
      </div>

      {/* Table */}
      <div style={{ ...card, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line)", textAlign: "left", color: "var(--muted)", fontSize: 11.5 }}>
              <th style={{ padding: 10 }}><input type="checkbox" checked={!!filtered.length && sel.size === filtered.length} onChange={toggleAll} /></th>
              <th style={{ padding: 10 }}>IMAGE</th>
              <th style={{ padding: 10 }}>TITLE</th>
              <th style={{ padding: 10 }}>STORE / SELLER</th>
              <th style={{ padding: 10 }}>TYPE / TEMPLATE</th>
              <th style={{ padding: 10 }}>AMAZON SKUs</th>
              <th style={{ padding: 10 }}>PIPELINE</th>
              <th style={{ padding: 10 }}>PRICE</th>
              <th style={{ padding: 10 }}>STATUS</th>
              <th style={{ padding: 10 }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ padding: 28, textAlign: "center", color: "var(--muted)" }}>Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={10} style={{ padding: 28, textAlign: "center", color: "var(--muted)" }}>
                Nothing staged yet — open <b>Manage Products Shopify</b>, select listings and hit <b>🅰 Push to Amazon</b>.
              </td></tr>
            ) : paged.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: 10 }}><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td style={{ padding: 10 }}>
                  {/* v291 · click ảnh → phóng to (lightbox) */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {r.image ? <img src={r.image + (r.image.includes("?") ? "&" : "?") + "width=96"} alt="" onClick={() => { const g = effImages(r).filter(Boolean); setZoom({ imgs: g.length ? g : [r.image], i: 0 }); }} style={{ width: 46, height: 46, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)", cursor: "zoom-in" }} /> : <span style={{ color: "var(--muted)" }}>—</span>}
                </td>
                <td style={{ padding: 10, maxWidth: 300 }}>
                  {/* v291 · click title → mở detail (modal edit) */}
                  <div onClick={() => setEdit({ ...r, bullets: r.bullets ? [...r.bullets] : null })} title="Open Amazon listing detail"
                    style={{ fontWeight: 700, color: "#1D4ED8", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                    {r.title || r.sourceTitle}
                  </div>
                  {/* v308 · gọn như Shopify: chỉ variants + ảnh (sizes ở cột SKU, store ở cột Store/Seller) */}
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>{r.srcVariantCount} variants · {r.imageCount} images</div>
                </td>
                {/* v308 · STORE / SELLER + badge nguồn Shopify (như chip ↗ Etsy bên Shopify) */}
                <td style={{ padding: 10, fontSize: 12, maxWidth: 150 }}>
                  {r.storeName ?? "—"}
                  {r.shopifyProductId && (
                    <a href={`/shopify-products?pid=${encodeURIComponent(r.shopifyProductId)}`} target="_blank" rel="noreferrer"
                      title={`View source in Manage Products · Shopify — ${r.sourceTitle}`}
                      style={{ marginTop: 3, fontSize: 10.5, fontWeight: 700, color: "#2C6E49", background: "#EAF6EF", border: "1px solid #BFE3CD", borderRadius: 6, padding: "2px 6px", display: "block", wordBreak: "break-word", lineHeight: 1.35, textDecoration: "none" }}>
                      ↗ Shopify: {r.sourceTitle.length > 22 ? r.sourceTitle.slice(0, 22) + "…" : r.sourceTitle}
                    </a>
                  )}
                  {r.manual && <span title="Imported directly from Amazon — no Shopify source" style={{ marginTop: 3, fontSize: 10, fontWeight: 800, color: "#B5661A", background: "#FFF0DB", borderRadius: 6, padding: "2px 6px", display: "inline-block" }}>Amazon · manual</span>}
                </td>
                {/* v308 · TYPE / TEMPLATE gộp 2 dòng như Type/Category bên Shopify (bỏ cột TYPE trùng) */}
                <td style={{ padding: 10, fontSize: 12, maxWidth: 160 }}>
                  <div title={r.productType || ""} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.productType || "—"}</div>
                  <div style={{ marginTop: 3 }}>
                    {(() => { const t = tplFor(r); const pinned = !!r.amazonTemplateId; return t
                      ? <span title={pinned ? "Pinned manually — export always uses this template" : "Auto-matched by Product type — pin a different one in the edit modal (click title)"}
                          style={chip(pinned ? "#FFF0DB" : "#F1F1F4", pinned ? "#B5661A" : "#6B7280")}>{pinned ? "📌 " : "≈ "}{t.name.length > 14 ? t.name.slice(0, 14) + "…" : t.name}</span>
                      : <span title="No template matches this Product type — pin one in the edit modal or set Match Product type in Manage Templates Amazon" style={{ color: "#B42318", fontSize: 11.5, fontWeight: 700 }}>none</span>; })()}
                  </div>
                </td>
                {/* AMAZON SKUs */}
                <td style={{ padding: 10, fontSize: 11.5 }}>
                  {(() => {
                    if (!r.skuRoot) return <span style={{ color: "#B42318" }}>no SKU</span>;
                    const s = amzSkus(r);
                    // v349 · asin theo từng SKU (Sync kéo về). Có asin → SKU thành link mở /dp; không có → fallback parent asin.
                    const asinOf = (sku: string) => r.skuAsins?.[sku] || (sku === s.parent ? r.asin : null) || r.asin;
                    const skuLink = (sku: string, label: string, bold: boolean) => {
                      const a = asinOf(sku);
                      return a
                        ? <a key={sku} href={`https://www.amazon.com/dp/${a}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title={`Open ${sku} on Amazon (${a})`} style={{ color: bold ? "#1D4ED8" : "#8794A5", fontWeight: bold ? 700 : 400, textDecoration: "none" }}>{sku}</a>
                        : <span key={sku} style={{ color: bold ? "#1F2733" : "#8794A5", fontWeight: bold ? 700 : 400 }}>{sku}</span>;
                    };
                    return (
                      <div style={{ fontFamily: "monospace", lineHeight: 1.5 }}>
                        <div>{skuLink(s.parent, s.parent, false)}</div>
                        {s.children.map((c) => (
                          <div key={c.sku}>{skuLink(c.sku, c.sku, true)} <span style={{ color: "#9ca3af", fontFamily: "inherit" }}>{c.label}</span>{r.skuAsins?.[c.sku] && <span style={{ color: "#c8ccd2", fontSize: 9.5, marginLeft: 4 }}>{r.skuAsins[c.sku]}</span>}</div>
                        ))}
                      </div>
                    );
                  })()}
                </td>
                {/* v308 · PIPELINE — độ sẵn sàng copy Amazon (title/bullets/desc) + lần AI gần nhất, như cột Pipeline Shopify */}
                <td style={{ padding: 10 }}>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    <span title={r.title ? `${r.title.length} chars` : "No Amazon title yet"} style={chip(titleOk(r.title) ? "#E9F7EF" : "#F1F1F4", titleOk(r.title) ? "#1F6F45" : "#8794A5")}>title {r.title ? r.title.length : "—"}</span>
                    <span title="5 bullet points" style={chip(bulletsOk(r.bullets) ? "#E9F7EF" : "#F1F1F4", bulletsOk(r.bullets) ? "#1F6F45" : "#8794A5")}>bullets {(r.bullets ?? []).filter(Boolean).length}/5</span>
                    <span title={r.description ? `${r.description.length} chars` : "No description yet"} style={chip(descOk(r.description) ? "#E9F7EF" : "#F1F1F4", descOk(r.description) ? "#1F6F45" : "#8794A5")}>desc {r.description ? r.description.length : "—"}</span>
                  </div>
                  {r.aiAt && <div style={{ fontSize: 10.5, color: "#5B3FBF", fontWeight: 700, marginTop: 3 }}>✦ {ago(r.aiAt)}</div>}
                </td>
                <td style={{ padding: 10, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}>{priceOf(effVars(r))}{r.variations && r.variations.length ? <span title="Custom price/variants for this listing" style={{ marginLeft: 4, fontSize: 9.5, fontWeight: 800, color: "#B5661A" }}>✎</span> : null}</td>
                <td style={{ padding: 10 }}>
                  <span style={chip(r.status === "LIVE" ? "#E9F7EF" : r.status === "EXPORTED" ? "#FFF0DB" : "#F1F1F4", r.status === "LIVE" ? "#1F6F45" : r.status === "EXPORTED" ? "#B5661A" : "#8794A5")}>{statusLabel(r.status)}</span>
                  {r.asin && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                      {/* click ASIN = copy · icon mắt = xem trên Amazon */}
                      <span onClick={() => { navigator.clipboard?.writeText(r.asin!); flash("✓ Copied ASIN " + r.asin); }} title="Click to copy ASIN" style={{ fontSize: 10.5, fontFamily: "monospace", color: "#1D4ED8", cursor: "pointer" }}>{r.asin}</span>
                      <a href={`https://www.amazon.com/dp/${r.asin}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="View on Amazon" style={{ display: "inline-flex", color: "#66788E" }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                      </a>
                    </div>
                  )}
                </td>
                <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                  {/* v294 · Edit = click title. Delete = icon thùng rác + BƯỚC XÁC NHẬN inline. */}
                  {canEdit && (confirmDel === r.id ? (
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <button disabled={busy} onClick={() => { setConfirmDel(""); remove(r.id); }} style={{ ...pill("#B42318", "#fff"), padding: "6px 12px", fontSize: 12 }}>Delete?</button>
                      <button disabled={busy} onClick={() => setConfirmDel("")} style={{ ...pill("#EEF1F5", "#333"), padding: "6px 10px", fontSize: 12 }}>Cancel</button>
                    </span>
                  ) : (
                    <button disabled={busy} onClick={() => setConfirmDel(r.id)} title="Remove from Manage Products Amazon (Shopify is untouched)" style={{ ...pill("#fff", "#B42318"), border: "1px solid #F3C9C9", padding: "6px 10px", fontSize: 13 }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* v318 · Pagination */}
      {filtered.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, fontSize: 13, color: "var(--muted)" }}>
          <span>Page {pageC}/{totalPages} · {filtered.length} listings</span>
          <div style={{ flex: 1 }} />
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} style={{ ...ctl, padding: "6px 8px" }}>{[20, 50, 100].map((n) => <option key={n} value={n}>{n}/page</option>)}</select>
          <button disabled={pageC <= 1} onClick={() => setPage(pageC - 1)} style={{ ...pill("#EEF1F5", "#333"), padding: "7px 14px", opacity: pageC <= 1 ? .5 : 1 }}>Prev</button>
          <button disabled={pageC >= totalPages} onClick={() => setPage(pageC + 1)} style={{ ...pill("#EEF1F5", "#333"), padding: "7px 14px", opacity: pageC >= totalPages ? .5 : 1 }}>Next</button>
        </div>
      )}

      {/* v304 · Import ASINs từ Amazon Listings Report */}
      {asinOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,.5)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !busy && setAsinOpen(false)}>
          <div style={{ ...card, width: "min(620px, 100%)", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <b style={{ fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}><AmazonLogo size={20} /> Import ASINs</b>
            <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "8px 0 14px", lineHeight: 1.6 }}>
              Seller Central → <b>Reports → Inventory Reports → All Listings Report</b> → Download. Open the file, copy everything (Ctrl+A, Ctrl+C) and paste below, or choose the file. FusionOS matches by SKU root, fills the ASIN and sets the listing LIVE.
            </div>
            <input type="file" accept=".txt,.csv,.tsv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setAsinText(await f.text()); e.target.value = ""; }} style={{ fontSize: 12.5, marginBottom: 10 }} />
            <textarea value={asinText} onChange={(e) => setAsinText(e.target.value)} rows={7} placeholder="…or paste the report content here (must include a seller-sku column and an asin column)" style={{ ...ctl, width: "100%", resize: "vertical", fontFamily: "monospace", fontSize: 11.5, marginBottom: 14 }} />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button disabled={busy} onClick={() => setAsinOpen(false)} style={{ ...pill("#EEF1F5", "#333"), padding: "8px 14px" }}>Cancel</button>
              <button disabled={busy || !asinText.trim()} onClick={importAsins} style={{ ...pill(AMZ, "#fff"), padding: "8px 18px", opacity: busy || !asinText.trim() ? .5 : 1 }}>{busy ? "Matching…" : "Import"}</button>
            </div>
          </div>
        </div>
      )}

      {/* v291 · Lightbox ảnh */}
      {/* v317 · Import listing modal (thay window.prompt) */}
      {importOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,.5)", zIndex: 3000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "12vh 16px" }} onClick={() => !busy && setImportOpen(false)}>
          <div style={{ ...card, width: "min(500px, 100%)", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 800, display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><AmazonLogo size={20} /> Import listing from Amazon</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6, marginBottom: 14 }}>
              Pull a listing that is already live on Amazon (even one listed manually) into FusionOS — enter the <b>parent SKU</b> (ending in <code style={{ background: "#F1F1F4", padding: "1px 5px", borderRadius: 4 }}>-PARENT-AMZ</code>). It fetches title, bullets, description, variations, price, images and ASIN.
            </div>
            <input autoFocus value={importSku} onChange={(e) => setImportSku(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !busy) doImportListing(); }}
              placeholder="TLW-0011-PARENT-AMZ" style={{ ...ctl, width: "100%", fontFamily: "monospace", fontSize: 13 }} />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <button disabled={busy} onClick={() => setImportOpen(false)} style={{ ...pill("#fff", "#333"), border: "1px solid var(--line)", padding: "9px 18px" }}>Cancel</button>
              <button disabled={busy || !importSku.trim()} onClick={doImportListing} style={{ ...pill(AMZ, "#fff"), padding: "9px 22px", opacity: busy || !importSku.trim() ? .5 : 1 }}>{busy ? "Importing…" : "Import"}</button>
            </div>
          </div>
        </div>
      )}

      {zoom && (() => {
        const cur = zoom.imgs[zoom.i] ?? zoom.imgs[0];
        const many = zoom.imgs.length > 1;
        const go = (d: number) => setZoom((z) => z ? { ...z, i: (z.i + d + z.imgs.length) % z.imgs.length } : z);
        const arrow: React.CSSProperties = { position: "absolute", top: "50%", transform: "translateY(-50%)", width: 52, height: 52, borderRadius: 999, border: "none", background: "rgba(255,255,255,.92)", color: "#111", fontSize: 26, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(0,0,0,.3)" };
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.8)", zIndex: 3100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, cursor: "zoom-out" }} onClick={() => setZoom(null)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cur + (cur.includes("?") ? "&" : "?") + "width=1200"} alt="" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "88vw", maxHeight: "90vh", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,.4)", cursor: "default" }} />
            {many && <>
              <button onClick={(e) => { e.stopPropagation(); go(-1); }} title="Previous (←)" style={{ ...arrow, left: 24 }}>‹</button>
              <button onClick={(e) => { e.stopPropagation(); go(1); }} title="Next (→)" style={{ ...arrow, right: 24 }}>›</button>
              <div style={{ position: "absolute", bottom: 26, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,.6)", color: "#fff", fontSize: 13, fontWeight: 700, padding: "5px 14px", borderRadius: 999 }}>{zoom.i + 1} / {zoom.imgs.length}</div>
            </>}
          </div>
        );
      })()}

      {/* Edit modal — v298: bố cục kiểu ETSY (Photos full-width trên cùng → Listing details → footer Save) */}
      {edit && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,.5)", zIndex: 3000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "3vh 16px", overflow: "auto" }} onClick={() => !busy && setEdit(null)}>
          <div style={{ width: "min(1100px, 100%)", background: "#F3F4F6", borderRadius: 18, overflow: "hidden", boxShadow: "0 24px 70px rgba(0,0,0,.28)" }} onClick={(e) => e.stopPropagation()}>

            {/* Header bar */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 24px", background: "#fff", borderBottom: "1px solid var(--line)" }}>
              <AmazonLogo size={30} />
              <b style={{ fontSize: 19 }}>Edit listing</b>
              <span style={{ fontSize: 13, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>· Amazon info · source: {edit.sourceTitle.slice(0, 60)}{edit.sourceTitle.length > 60 ? "…" : ""}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{edit.aiAt ? `AI written ${ago(edit.aiAt)}` : "never generated"}</span>
              <button onClick={() => setEdit(null)} style={{ width: 34, height: 34, borderRadius: 10, border: "none", background: "#EEF1F5", fontSize: 15, cursor: "pointer", color: "#333" }}>✕</button>
            </div>

            <div style={{ padding: "18px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

              {/* ── Photos ── */}
              <div style={{ ...card, padding: "18px 20px" }}>
                <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>
                  Photos <span style={{ fontWeight: 600, color: "var(--muted)", fontSize: 13 }}>({effImages(edit).length}/9) · drag to reorder · the first photo is the main image</span>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {effImages(edit).map((u, i) => (
                    <div key={u + i} draggable
                      onDragStart={() => setDragImg(i)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); if (dragImg === null || dragImg === i) return; const a = [...effImages(edit)]; const [m] = a.splice(dragImg, 1); a.splice(i, 0, m); setDragImg(null); setImgs(a); }}
                      onDragEnd={() => setDragImg(null)}
                      style={{ position: "relative", width: 118, height: 118, borderRadius: 12, overflow: "hidden", border: i === 0 ? "2px solid #B5661A" : "1px solid var(--line)", cursor: "grab", opacity: dragImg === i ? .5 : 1, flexShrink: 0 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u + (u.includes("?") ? "&" : "?") + "width=240"} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      {i === 0 && <span style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,.62)", color: "#fff", fontSize: 11, fontWeight: 800, textAlign: "center", padding: "2px 0" }}>Main</span>}
                      <button onClick={() => { const a = effImages(edit).filter((_, x) => x !== i); setImgs(a); }} title="Remove"
                        style={{ position: "absolute", top: 5, right: 5, width: 22, height: 22, borderRadius: 999, border: "none", cursor: "pointer", background: "rgba(0,0,0,.55)", color: "#fff", fontSize: 11, lineHeight: "22px", padding: 0 }}>✕</button>
                    </div>
                  ))}
                  {/* Upload local: presign → PUT thẳng R2 */}
                  <button onClick={() => imgFileRef.current?.click()} disabled={upBusy}
                    style={{ width: 118, height: 118, borderRadius: 12, border: "1.5px dashed #E5A868", background: "#FFFBF4", cursor: "pointer", fontSize: 13, fontWeight: 700, color: AMZ }}>
                    {upBusy ? "Uploading…" : <>+<br />Add photos</>}
                  </button>
                  <input ref={imgFileRef} type="file" accept="image/*" multiple style={{ display: "none" }}
                    onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) uploadImages(fs); e.target.value = ""; }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 12 }}>
                  <button onClick={makeWhiteMain} disabled={whiteBusy || !effImages(edit).length} title="Normalize the current main image to a pure white background (255,255,255), 1600px square, light JPEG — Amazon-compliant, no timeout."
                    style={{ border: "1px solid #E5A868", background: "#FFFBF4", borderRadius: 8, cursor: whiteBusy || !effImages(edit).length ? "default" : "pointer", fontSize: 13, fontWeight: 800, color: AMZ, padding: "6px 12px", opacity: whiteBusy || !effImages(edit).length ? .5 : 1 }}>
                    {whiteBusy ? "Processing…" : "⚪ White-bg main"}</button>
                  <button onClick={() => { const u = window.prompt("Image URL (https://…):"); if (u && /^https:\/\//i.test(u.trim())) setImgs([...effImages(edit), u.trim()]); }}
                    style={{ border: "none", background: "none", cursor: "pointer", fontSize: 13.5, fontWeight: 700, color: "#1D4ED8", padding: 0 }}>+ Add by URL</button>
                  {edit.images && (
                    <button onClick={() => setEdit({ ...edit, images: null })} title="Discard the Amazon-only set and go back to the Shopify images"
                      style={{ border: "none", background: "none", cursor: "pointer", fontSize: 13.5, fontWeight: 700, color: "#B42318", padding: 0 }}>Reset to Shopify images</button>
                  )}
                  <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                    {edit.images ? "Amazon-only set — exports use these, Shopify stays untouched." : "Using the Shopify images — any change creates an Amazon-only set."} Main image must be on pure white background.
                  </span>
                </div>
              </div>

              {/* ── v313 · Variations & Price (override riêng listing) ── */}
              {(() => {
                const tplVars = tplFor(edit)?.variations ?? [];
                const custom = !!(edit.variations && edit.variations.length);
                const setVars = (vs: Variation[]) => setEdit((p) => p ? { ...p, variations: vs } : p);
                const rowsV = custom ? (edit.variations as Variation[]) : tplVars;
                return (
                  <div style={{ ...card, padding: "18px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 16, fontWeight: 800 }}>Variations &amp; Price <span style={{ fontWeight: 600, color: "var(--muted)", fontSize: 13 }}>· size + child SKU price</span></div>
                      {custom
                        ? <span style={{ fontSize: 11, fontWeight: 800, color: "#B5661A", background: "#FFF0DB", padding: "2px 8px", borderRadius: 999 }}>This listing only</span>
                        : <span style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", background: "#F1F1F4", padding: "2px 8px", borderRadius: 999 }}>From template</span>}
                      <div style={{ marginLeft: "auto" }}>
                        {custom
                          ? <button onClick={() => setVars([])} title="Discard the override — go back to the template's variants/price" style={{ border: "none", background: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "#B42318", padding: 0 }}>Reset to template</button>
                          : <button onClick={() => setVars(tplVars.length ? tplVars.map((v) => ({ ...v })) : [{ suffix: "", label: "", price: "" }])} style={{ ...pill("#FFF7ED", AMZ), border: `1px solid #E5A868`, padding: "6px 12px", fontSize: 12.5 }}>Customize for this listing</button>}
                      </div>
                    </div>
                    {rowsV.length === 0 ? (
                      <div style={{ fontSize: 12.5, color: "var(--muted)" }}>The template has no variations — add them in Manage Templates Amazon, or click &ldquo;Customize&rdquo; to create per-listing ones.</div>
                    ) : (
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead><tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11 }}>
                          <th style={{ padding: "4px 7px" }}>Suffix (child SKU)</th><th style={{ padding: "4px 7px" }}>Size</th><th style={{ padding: "4px 7px", textAlign: "right" }}>Price $</th>{custom && <th />}
                        </tr></thead>
                        <tbody>
                          {rowsV.map((v, i) => (
                            <tr key={i}>
                              <td style={{ padding: 5 }}><input disabled={!custom} value={v.suffix} onChange={(e) => { const a = [...rowsV]; a[i] = { ...a[i], suffix: e.target.value }; setVars(a); }} placeholder="8X8-AMZ" style={{ ...ctl, width: "100%", fontFamily: "monospace", fontSize: 12.5, padding: "7px 9px", opacity: custom ? 1 : .6 }} /></td>
                              <td style={{ padding: 5 }}><input disabled={!custom} value={v.label} onChange={(e) => { const a = [...rowsV]; a[i] = { ...a[i], label: e.target.value }; setVars(a); }} placeholder={'8"x8"'} style={{ ...ctl, width: "100%", padding: "7px 9px", opacity: custom ? 1 : .6 }} /></td>
                              <td style={{ padding: 5, width: 110 }}><input disabled={!custom} value={v.price} onChange={(e) => { const a = [...rowsV]; a[i] = { ...a[i], price: e.target.value }; setVars(a); }} placeholder="28.95" style={{ ...ctl, width: "100%", textAlign: "right", padding: "7px 9px", opacity: custom ? 1 : .6 }} /></td>
                              {custom && <td style={{ textAlign: "center", width: 32 }}><button onClick={() => setVars(rowsV.filter((_, x) => x !== i))} title="Remove size" style={{ border: 0, background: "none", color: "#E5484D", fontSize: 15, cursor: "pointer" }}>✕</button></td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {custom && <button onClick={() => setVars([...rowsV, { suffix: "", label: "", price: "" }])} style={{ ...pill("#EEF1F5", "#333"), padding: "6px 12px", fontSize: 12.5, marginTop: 8 }}>+ Add size</button>}
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8, lineHeight: 1.5 }}>
                      {custom
                        ? <>These prices/sizes apply to this listing only. ⚠ <b>Do not change the Suffix of a LIVE size</b> (Amazon treats it as a new SKU and loses history). Editing Price/Size is fine.</>
                        : <>Using the template&rsquo;s variants/price. Click &ldquo;Customize for this listing&rdquo; to set a different price/size for this listing only. After editing, hit <b>Save &amp; Push</b> to update Amazon.</>}
                    </div>
                  </div>
                );
              })()}

              {/* ── Listing details ── */}
              <div style={{ ...card, padding: "18px 20px" }}>
                <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>
                  Listing details <span style={{ fontWeight: 600, color: "var(--muted)", fontSize: 13 }}>· Amazon copy · never sent to Shopify</span>
                </div>

                <label style={lab}>Title <span style={{ fontWeight: 700, color: (edit.title ?? "").length > 0 && !titleOk(edit.title) ? "var(--red)" : "var(--muted)" }}>({(edit.title ?? "").length}/200 · target 150-200)</span></label>
                <textarea value={edit.title ?? ""} onChange={(e) => setEdit({ ...edit, title: e.target.value })} maxLength={250} rows={2} placeholder="Personalized <what>, Custom Name <type>, <occasion keywords>, Keepsake Gift — no size, no emojis" style={{ ...ctl, width: "100%", resize: "vertical", marginBottom: 12 }} />

                <label style={lab}>Bullet points (5 · About this item)</label>
                {Array.from({ length: 5 }, (_, i) => (
                  <textarea key={i} value={(edit.bullets ?? [])[i] ?? ""}
                    onChange={(e) => { const b = [...(edit.bullets ?? ["", "", "", "", ""])]; while (b.length < 5) b.push(""); b[i] = e.target.value; setEdit({ ...edit, bullets: b }); }}
                    maxLength={300} rows={2} placeholder={`Bullet ${i + 1} — ALL-CAPS HOOK — then the benefit (150-230 chars)`}
                    style={{ ...ctl, width: "100%", resize: "vertical", marginBottom: 6, fontSize: 12.5 }} />
                ))}

                <label style={{ ...lab, marginTop: 8 }}>Description <span style={{ fontWeight: 700, color: (edit.description ?? "").length > 0 && ((edit.description ?? "").length < 900 || (edit.description ?? "").length > 1500) ? "var(--red)" : "var(--muted)" }}>({(edit.description ?? "").length} chars · target 900-1500)</span></label>
                <textarea value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} rows={8} placeholder="Plain text, 3-4 paragraphs separated by a blank line — Amazon does not render HTML" style={{ ...ctl, width: "100%", resize: "vertical" }} />
              </div>

              {/* ── Settings ── */}
              <div style={{ ...card, padding: "18px 20px" }}>
                <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Settings</div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 260px" }}>
                    <label style={lab}>Amazon template</label>
                    <select value={edit.amazonTemplateId ?? ""} onChange={(e) => setEdit({ ...edit, amazonTemplateId: e.target.value || null })} style={{ ...ctl, width: "100%" }}>
                      <option value="">Auto — match by Product type</option>
                      {tpls.map((t) => <option key={t.id} value={t.id}>Pinned: {t.name}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: "0 1 220px" }}>
                    <label style={lab}>ASIN (once live on Amazon)</label>
                    <input value={edit.asin ?? ""} onChange={(e) => setEdit({ ...edit, asin: e.target.value })} placeholder="B0XXXXXXXX" style={{ ...ctl, width: "100%", fontFamily: "monospace" }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer bar */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 24px", background: "#fff", borderTop: "1px solid var(--line)" }}>
              {canEdit && <button disabled={busy} onClick={aiOne} style={pill("#5B3FBF", "#fff")}>{busy ? "Working…" : "✦ AI Amazon copy"}</button>}
              <span style={{ flex: 1 }} />
              <button disabled={busy} onClick={() => setEdit(null)} style={{ ...pill("#fff", "#333"), border: "1px solid var(--line)", padding: "9px 20px" }}>Cancel</button>
              {canEdit && <button disabled={busy} onClick={saveEdit} style={{ ...pill("#fff", AMZ), border: `1px solid ${AMZ}`, padding: "9px 20px" }}>Save</button>}
              {canEdit && <button disabled={busy || !cfg.configured} onClick={saveAndPush} title={cfg.configured ? "Save then push this listing to Amazon via SP-API (updates if it already exists)" : "Configure SP-API in Stores first"} style={{ ...pill("#1F6F45", "#fff"), padding: "9px 22px", opacity: busy || !cfg.configured ? .5 : 1 }}>⬆ Save &amp; Push to Amazon</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
