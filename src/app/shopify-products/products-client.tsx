"use client";
import { AmazonLogo } from "@/components/amazon-logo";
import { useEffect, useMemo, useState } from "react";
import { useConfirm, usePrompt } from "@/components/confirm-provider";
import ThumbZoom from "@/components/thumb-zoom";
// v142: editor Custom options dùng chung với Edit listing và màn Etsy — 1 bản duy nhất.
import CustomOptions, { NEW_PQ, pqProblem, pqSummary, toPQ, type PQ } from "@/components/custom-options";

type Store = { id: string; name: string; sellerId: string | null; sellerName: string | null };
type Seller = { id: string; name: string };
type Row = {
  id: string; storeId: string; storeName: string | null; sellerName: string | null;
  title: string; handle: string | null; status: string; dirty: boolean;
  variantCount: number; minPrice: number | null; maxPrice: number | null;
  mainImage: string | null; imageCount: number; imageUrls?: string[]; onlineStoreUrl: string | null;
  videoCode: number | null; videoThumbUrl: string | null; videoPushed: boolean;
  totalInventory: number | null; optionsSummary: string;
  productType: string; categoryName: string; collectionTitles: string[];
  templateId: string | null; templateName: string; templatePinned: boolean; templateHasFacts: boolean;
  aiAt: string | null; pushedAt: string | null;
  feedAt: string | null; feedTitleLen: number; feedDescLen: number;
  // v127: cột PIPELINE. skuDone/skuTotal = số variant đã có SKU; altDone/altTotal = số ảnh đã có alt.
  skuDone: number; skuTotal: number; altDone: number; altTotal: number;
  // v141: Custom options. persOwn = listing đã tự đặt bộ ô riêng (không còn ăn theo template).
  persOwn: boolean; persCount: number;
  // v177: Policy & trademark scan. null = chưa quét.
  policyRisk: "clean" | "medium" | "high" | null; policyHitsSummary: string; policyCheckedAt: string | null;
  policyHits?: { term: string; field: string; severity: string; fix?: string }[]; // v191: click chip → khung xem đầy đủ
  // v181: listing Etsy gốc — nút "Etsy" nhảy sang Manage Products · Etsy để đối chiếu.
  etsyListing: { id: string; title: string; store: string; seller: string } | null;
  // v286: đã đẩy sang Manage Products Amazon chưa (badge AMZ).
  amz: boolean;
};
type SelOpt = { name: string; value: string };
type Variant = { id: string; title: string; selectedOptions: SelOpt[]; price: string; compareAtPrice: string | null; sku: string; inventoryQty: number | null; barcode: string; inventoryItemId?: string | null };
type Img = { id: string; src: string; altText: string; position: number };
type Detail = {
  id: string; storeId: string; storeName: string | null; shopifyProductId: string; handle: string | null;
  title: string; bodyHtml: string | null; vendor: string | null; productType: string | null; tags: string | null;
  seoTitle: string | null; seoDescription: string | null;
  feedTitle: string | null; feedDescription: string | null; feedAt: string | null;
  status: string; options: { name: string; position: number; values: string[] }[];
  variants: Variant[]; images: Img[]; onlineStoreUrl: string | null; totalInventory: number | null; dirty: boolean;
  // v142: bộ Custom options RIÊNG của listing. null = chưa đặt riêng ⇒ đang ăn theo template.
  personalization: PQ[] | null;
  // v223: video từ Video Library đang gắn vào listing (dán #videoCode). null = chưa gắn.
  videoCode: number | null; videoTitle: string | null; videoThumbUrl: string | null;
};

const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,.04)" };
const ctl: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 12, padding: "10px 13px", fontSize: 13.5, font: "inherit", background: "#fff", outline: "none" };
const pill = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 7, border: "none", background: bg, color: fg, borderRadius: 12, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" });
const ghost: React.CSSProperties = { ...pill("#fff", "var(--ink)"), border: "1px solid var(--line)" };
const lab: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 6 };
const linkBtn = (c: string): React.CSSProperties => ({ border: "none", background: "none", padding: 0, cursor: "pointer", color: c, fontWeight: 700, fontSize: 12.5 });
const money = (n: number | null) => n == null ? "—" : "$" + n.toFixed(2);
const SHOP_GREEN = "#5E8E3E";
// Control nhỏ dùng cho thanh filter/action — nhỏ hơn ctl để cả hàng nằm gọn 1 dòng.
// v179b: nén thêm để 10 ô filter nằm gọn MỘT hàng (Search → Risk) không phải cuộn/xuống dòng.
const fctl: React.CSSProperties = { ...ctl, padding: "6px 7px", fontSize: 11.5, maxWidth: 122, borderRadius: 10 };
// Select đang có giá trị thì đổi màu — nhìn phát biết đang lọc cái gì.
// v182: co giãn theo bề ngang màn hình (flex 1 1) — 10 ô LUÔN vừa đúng 1 hàng, KHÔNG bao giờ sinh thanh cuộn.
const fsel = (on: boolean, fg = "#1F6F45", bd = "#BFE3CD", bg = "#F3FBF6"): React.CSSProperties =>
  ({ ...fctl, maxWidth: "none", width: "auto", flex: "1 1 72px", minWidth: 0, borderColor: on ? bd : "var(--line)", background: on ? bg : "#fff", color: on ? fg : "inherit", fontWeight: on ? 700 : 400 });
// Nhóm nút theo bước làm việc — chỉ còn vạch ngăn, bỏ nhãn 1/2/3 cho đỡ rối.
// v172: nowrap + flexShrink 0 — action bar phải nằm gọn MỘT hàng, không cho nhóm nào rơi xuống dòng dưới.
const grp: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 8px 3px 6px", borderLeft: "1px solid #CDEFD8", flexWrap: "nowrap", flexShrink: 0 };
// "2h ago" / "3d ago" — nhìn phát biết listing nào vừa chạy AI, khỏi chạy lại tốn tiền.
// v119: một dòng chỉ được coi là CÓ FEED khi đủ điều kiện Export — feed-export bỏ qua dòng
// thiếu title/description, và dưới 600 ký tự thì viết feed coi như hỏng mục đích.
const feedOk = (r: { feedAt: string | null; feedTitleLen: number; feedDescLen: number }) =>
  !!r.feedAt && r.feedTitleLen > 0 && r.feedDescLen >= 600;
// v127: màu chip "sku 4/4" / "alt 10/10". Xanh = xong hết, vàng = làm dở, xám = chưa có gì.
// total = 0 (listing không variant/không ảnh) coi như không áp dụng ⇒ xám, đừng báo động giả.
const chipTone = (done: number, total: number): React.CSSProperties =>
  total === 0 || done === 0 ? { background: "#F1F1F4", color: "#8794A5" }
    : done >= total ? { background: "#E9F7EF", color: "#1F6F45" }
      : { background: "#FEF6E7", color: "#B7791F" };
const ago = (iso: string | null) => {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms) || ms < 0) return "just now";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

// Hàm POST dùng chung cho mọi hành động theo lô.
// Vì sao không dùng thẳng .then(r => r.json()): khi function trên Vercel bị cắt (hết giờ / 502 / hết RAM)
// thì body trả về RỖNG, r.json() ném đúng câu "Unexpected end of JSON input" — người dùng đọc không hiểu
// gì và cái gợi ý 429/402 phía dưới lại chỉ sai hướng. Đọc text trước rồi mới parse để báo đúng mã HTTP.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function postJSON<T = any>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const txt = await r.text();
  if (!txt.trim()) throw new Error(`HTTP ${r.status} — server ngắt giữa chừng, không trả dữ liệu (thường là chạy quá lâu bị cắt). Chọn ít sản phẩm hơn rồi bấm Retry failed.`);
  try { return JSON.parse(txt) as T; }
  catch { throw new Error(`HTTP ${r.status} — server trả về không phải JSON: ${txt.replace(/\s+/g, " ").slice(0, 140)}`); }
}

// v117: 22 mục → 13. Mỗi cặp add/remove giờ là MỘT mục có công tắc Add/Remove trong modal;
// 3 kiểu push-từ-template gộp thành 1 modal có checkbox; 3 bước Google feed gộp thành 1 lệnh
// chạy tuần tự. Catalogs đã BỎ HẲN — đó là tính năng Shopify B2B, Talewix không bán B2B.
type ActKey =
  | "set_template" | "push_template" | "find_replace" | "personalization"
  | "google_prep" | "feed_copy" | "feed_export"
  | "policy_ai" | "ai_collection" | "tags" | "collection" | "channels"
  | "active" | "draft" | "archive" | "delete"
  | "pinterest" | "push_amazon";
type ActionItem = { key: ActKey; label: string; danger?: boolean };
type ActionGroup = { title: string; items: ActionItem[] };
const ACTION_GROUPS: ActionGroup[] = [
  {
    title: "Template & text",
    items: [
      // Chỉ gán nguồn facts cho AI Optimize — KHÔNG gửi gì lên Shopify.
      { key: "set_template", label: "Set AI template…" },
      // Gộp của: Apply template + Push delivery times + Push personalization fields.
      { key: "push_template", label: "Push template fields…" },
      // v141: bộ ô cá nhân hoá RIÊNG của listing đang chọn — không đụng template.
      { key: "personalization", label: "Custom options…" },
      { key: "find_replace", label: "Find & replace in text…" },
    ],
  },
  {
    // KHÔNG phải việc dùng-một-lần. SKU và alt chỉ gắn được vào variant/media ĐÃ TỒN TẠI trên
    // Shopify, nên MỖI lô sản phẩm mới đều phải chạy lại (sau Push → Sync).
    // google_prep chỉ ghi SKU / metafield / alt ⇒ không đụng title-mô tả-giá-ảnh, không cần Push.
    // 2 mục feed KHÔNG đụng Shopify: chỉ ghi vào FUSION OS rồi xuất ra file feed phụ.
    title: "Google feed",
    items: [
      { key: "google_prep", label: "Prepare for Google feed (SKU + fields + alt)…" },
      { key: "feed_copy", label: "Generate feed title + long description (AI)" },
      { key: "feed_export", label: "Export supplemental feed (.txt)" },
    ],
  },
  {
    // v289 · Kênh ngoài Shopify — dọn từ thanh nút chính vào đây cho gọn.
    title: "Channels",
    items: [
      { key: "pinterest", label: "Export Pinterest CSV…" },
    ],
  },
  {
    title: "Organize",
    items: [
      // v179: AI audit TOÀN BỘ listing (artwork + title/desc/tags + SEO + Google feed) —
      // trả cảnh báo + CÁCH SỬA từng chỗ. HIGH bị chặn ở nút Push. Cần model 👁.
      { key: "policy_ai", label: "AI policy check (full listing) ✦" },
      // v173: AI nhìn ảnh + title rồi tự chọn 1–2 collection ĐANG CÓ (không tạo mới). Con nào không
      // hợp cái nào → đánh dấu unmatched để tự xử. Cần model có 👁 (đọc ảnh).
      { key: "ai_collection", label: "Auto-assign collections (AI) ✦" },
      { key: "tags", label: "Add / remove tags…" },
      { key: "collection", label: "Add / remove collection…" },
      { key: "channels", label: "Include / exclude sales channels…" },
    ],
  },
  {
    // 3 mục này giữ nguyên 1-click: đây là thao tác hay dùng nhất, nhét vào modal chỉ tốn thêm click.
    title: "Status",
    items: [
      { key: "active", label: "Set as Active" },
      { key: "draft", label: "Unlist products (set to Draft)" },
      { key: "archive", label: "Archive products" },
      { key: "delete", label: "Delete products on Shopify", danger: true },
    ],
  },
];

// Logo Pinterest — dùng cho nút Export Pinterest (bảng sản phẩm) để nhìn phát biết ngay là việc gì.
const PIN_RED = "#E60023";
const PinLogo = ({ size = 15, color = "#fff" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true" style={{ flex: "none" }}>
    <path d="M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.208 0 1.031.397 2.137.893 2.738a.36.36 0 0 1 .083.345c-.091.379-.293 1.194-.333 1.361-.052.22-.174.267-.401.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.608 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146A12 12 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z" />
  </svg>
);

const statusBadge = (s: string) => {
  const up = (s || "").toUpperCase();
  const c = up === "ACTIVE" ? { bg: "#EAF7F0", fg: "#158A57" } : up === "ARCHIVED" ? { bg: "#F1F1F4", fg: "#66788E" } : { bg: "#FFF6E6", fg: "#B7791F" };
  return <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: c.bg, color: c.fg }}>{up || "DRAFT"}</span>;
};

export default function ShopifyProductsClient({ stores, sellers, canEdit, isAdmin }: { stores: Store[]; sellers: Seller[]; canEdit: boolean; isAdmin: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  // Thanh tiến độ cho việc chạy theo lô (AI Optimize / Push) — chạy tới đâu hiện tới đó.
  const [prog, setProg] = useState<{ label: string; done: number; total: number; fail: number } | null>(null);
  // Danh sách sản phẩm AI viết hỏng + lý do — phải thấy được lý do mới sửa được.
  const [fails, setFails] = useState<{ id: string; title: string; error: string }[]>([]);
  // v183: nhận ?q= từ nút "Shopify" bên Manage Products · Etsy — mở trang là ô search điền sẵn title.
  const [kw, setKw] = useState(() => { if (typeof window === "undefined") return "";
    try { return new URLSearchParams(window.location.search).get("q") ?? ""; } catch { return ""; } });
  // v184: ?pid= — nút "Shopify" bên Manage Products · Etsy nhảy về ĐÚNG 1 dòng theo id, khớp 100%
  // (không dò theo title nữa: title có thể đã bị AI đổi, hoặc trùng nhau giữa 2 product).
  const [pidFilter, setPidFilter] = useState(() => { if (typeof window === "undefined") return "";
    try { return new URLSearchParams(window.location.search).get("pid") ?? ""; } catch { return ""; } });
  const [sellerFilter, setSellerFilter] = useState(""); const [storeFilter, setStoreFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState(""); const [categoryFilter, setCategoryFilter] = useState(""); const [collectionFilter, setCollectionFilter] = useState("");
  // Lọc theo trạng thái Shopify — listing đẩy từ Etsy sang luôn là DRAFT, lọc "Draft" để soát trước khi bật Active.
  const [statusFilter, setStatusFilter] = useState("");
  // Lọc theo trạng thái AI: "" tất cả · "todo" chưa chạy AI · "done" đã có AI · "unpushed" đã AI nhưng chưa Push
  const [aiFilter, setAiFilter] = useState<"" | "todo" | "done" | "unpushed">("");
  const [feedFilter, setFeedFilter] = useState<"" | "todo" | "done">("");
  const [prepFilter, setPrepFilter] = useState<"" | "sku" | "alt" | "done">(""); // v127
  const [riskFilter, setRiskFilter] = useState<"" | "high" | "medium" | "clean" | "unchecked">(""); // v177
  const [videoFilter, setVideoFilter] = useState<"" | "has" | "no">(""); // listing có / không có video
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(20);
  const [syncStore, setSyncStore] = useState(stores[0]?.id ?? "");
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Detail | null>(null);
  const [vidCode, setVidCode] = useState(""); // ô dán #Video ID trong Edit modal
  const [editLoading, setEditLoading] = useState(false);
  // AI model
  const [aiModels, setAiModels] = useState<{ id: string; name: string }[]>([]);
  const [aiModel, setAiModel] = useState("");
  // Ô Model là NGUỒN DUY NHẤT cho mọi hành động AI ở trang này. Nhưng alt text cần model ĐỌC ĐƯỢC ẢNH:
  // danh sách vision dùng để biết model đang chọn có xem được ảnh không, không thì chạy model mặc định.
  const [visionIds, setVisionIds] = useState<Set<string>>(new Set());
  // Bulk actions ("More actions")
  const [actionsOpen, setActionsOpen] = useState(false);
  // v191 · click chip policy (⛔/⚠/✓) → mở khung xem đầy đủ kết quả audit thay vì tooltip cụt
  const [riskView, setRiskView] = useState<Row | null>(null);
  // v200 · index ảnh đang kéo trong Edit modal (kéo-thả đổi thứ tự)
  const [dragImg, setDragImg] = useState<number | null>(null);
  // v202 · click ảnh trong Edit modal → xem to (lightbox)
  const [imgZoom, setImgZoom] = useState<string | null>(null);
  useEffect(() => {
    if (!imgZoom) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setImgZoom(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [imgZoom]);
  // Export Pinterest — file CSV nạp vào Pinterest (Settings → Import content). Không đụng Shopify.
  const [pinOpen, setPinOpen] = useState(false);
  const [pinPerProduct, setPinPerProduct] = useState(1);
  const [pinPerFile, setPinPerFile] = useState(200);
  // v141 · Custom options — bộ ô cá nhân hoá RIÊNG của listing đang chọn (mô hình Etsy).
  // persOpen mở modal; persFields là bộ đang sửa; persEditing = đang mở 1 field ra sửa (chặn Save).
  const [persOpen, setPersOpen] = useState(false);
  const [persLoading, setPersLoading] = useState(false);
  const [persFields, setPersFields] = useState<PQ[]>([]);
  const [persEditing, setPersEditing] = useState(false);
  // v142: bộ Custom options đang sửa NGAY TRONG Edit listing (tách khỏi modal hàng loạt ở trên).
  const [edPers, setEdPers] = useState<PQ[]>([]);
  const [edPersEditing, setEdPersEditing] = useState(false);
  const [edPersOwn, setEdPersOwn] = useState(false);
  const [edPersTpl, setEdPersTpl] = useState("");
  const [persInfo, setPersInfo] = useState<{ title: string; source: "product" | "template" | "none"; templateName: string; count: number; withOwn: number }>({ title: "", source: "none", templateName: "", count: 0, withOwn: 0 });
  const [act, setAct] = useState<null | { key: ActKey; title: string; kind: "tags" | "collection" | "publication" | "template" | "replace" | "pushtpl" | "gprep"; storeId: string; loading: boolean; items: { id: string; label: string }[] }>(null);
  const [tagInput, setTagInput] = useState("");
  // Hai lệnh gộp dùng checkbox chọn bước nào chạy; tags/collection/channels dùng công tắc Add↔Remove.
  const [parts, setParts] = useState<Record<string, boolean>>({});
  const [actMode, setActMode] = useState<"add" | "remove">("add");
  // Find & replace (More actions) — chuỗi nguyên văn, không regex.
  const [frFind, setFrFind] = useState("");
  const [frReplace, setFrReplace] = useState("");
  const [frField, setFrField] = useState<"body" | "title">("body");
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
    fetch("/api/books/models?type=vision").then((r) => r.json()).then((j) => {
      if (Array.isArray(j?.models)) setVisionIds(new Set((j.models as { id: string }[]).map((m) => m.id)));
    }).catch(() => { /* offline */ });
  }, []);
  const chooseModel = (m: string) => { setAiModel(m); try { window.localStorage.setItem("shopifyAiModel", m); } catch { /* ignore */ } };

  const showSellerFilter = sellers.length > 1;
  const storesForFilter = useMemo(() => sellerFilter ? stores.filter((s) => s.sellerId === sellerFilter) : stores, [stores, sellerFilter]);
  // Danh sách giá trị distinct cho 3 filter (theo store đang lọc nếu có)
  const scopeRows = useMemo(() => rows.filter((r) => (!storeFilter || r.storeId === storeFilter) && (!sellerFilter || stores.find((s) => s.id === r.storeId)?.sellerId === sellerFilter)), [rows, storeFilter, sellerFilter, stores]);
  const typeOptions = useMemo(() => Array.from(new Set(scopeRows.map((r) => r.productType).filter(Boolean))).sort(), [scopeRows]);
  const categoryOptions = useMemo(() => Array.from(new Set(scopeRows.map((r) => r.categoryName).filter(Boolean))).sort(), [scopeRows]);
  const collectionOptions = useMemo(() => Array.from(new Set(scopeRows.flatMap((r) => r.collectionTitles ?? []).filter(Boolean))).sort(), [scopeRows]);
  const statusOptions = useMemo(() => Array.from(new Set(scopeRows.map((r) => (r.status || "").toUpperCase()).filter(Boolean))).sort(), [scopeRows]);
  const filtered = useMemo(() => rows.filter((r) =>
    (!sellerFilter || stores.find((s) => s.id === r.storeId)?.sellerId === sellerFilter) &&
    (!storeFilter || r.storeId === storeFilter) &&
    (!typeFilter || (typeFilter === "__none__" ? !(r.productType ?? "").trim() : r.productType === typeFilter)) &&
    (!categoryFilter || (categoryFilter === "__none__" ? !(r.categoryName ?? "").trim() : r.categoryName === categoryFilter)) &&
    (!collectionFilter || (collectionFilter === "__none__" ? !(r.collectionTitles ?? []).length : (r.collectionTitles ?? []).includes(collectionFilter))) &&
    (!statusFilter || (r.status || "").toUpperCase() === statusFilter) &&
    (!aiFilter || (aiFilter === "todo" ? !r.aiAt : aiFilter === "done" ? !!r.aiAt : !!r.aiAt && r.dirty)) &&
    (!feedFilter || (feedFilter === "done" ? feedOk(r) : !feedOk(r))) &&
    (!prepFilter || (prepFilter === "sku" ? r.skuDone < r.skuTotal : prepFilter === "alt" ? r.altDone < r.altTotal : r.skuDone >= r.skuTotal && r.altDone >= r.altTotal)) &&
    (!riskFilter || (riskFilter === "unchecked" ? !r.policyRisk : r.policyRisk === riskFilter)) &&
    (!videoFilter || (videoFilter === "has" ? r.videoCode != null : r.videoCode == null)) &&
    (!pidFilter || r.id === pidFilter) &&
    (!kw.trim() || (r.title + " " + (r.handle ?? "") + " " + (r.id ?? "")).toLowerCase().includes(kw.trim().toLowerCase()))
  ), [rows, kw, sellerFilter, storeFilter, typeFilter, categoryFilter, collectionFilter, statusFilter, aiFilter, feedFilter, prepFilter, riskFilter, videoFilter, pidFilter, stores]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => { setPage(1); }, [kw, sellerFilter, storeFilter, typeFilter, categoryFilter, collectionFilter, statusFilter, aiFilter, feedFilter, prepFilter, riskFilter, videoFilter, pageSize]);
  const pageC = Math.min(page, totalPages);
  const paged = useMemo(() => filtered.slice((pageC - 1) * pageSize, pageC * pageSize), [filtered, pageC, pageSize]);
  // Trong danh sách đang chọn: đã chạy AI (selDone), chưa chạy (selTodo), đã sửa chưa Push (selDirty).
  const selDone = useMemo(() => rows.filter((r) => sel.has(r.id) && r.aiAt).length, [rows, sel]);
  const selTodo = useMemo(() => rows.filter((r) => sel.has(r.id) && !r.aiAt).length, [rows, sel]);
  const selDirty = useMemo(() => rows.filter((r) => sel.has(r.id) && r.dirty).length, [rows, sel]);
  const anyFilter = !!(kw.trim() || sellerFilter || storeFilter || typeFilter || categoryFilter || collectionFilter || statusFilter || aiFilter || feedFilter || prepFilter || riskFilter || videoFilter || pidFilter);
  const clearFilters = () => { setKw(""); setSellerFilter(""); setStoreFilter(""); setTypeFilter(""); setCollectionFilter(""); setCategoryFilter(""); setStatusFilter(""); setAiFilter(""); setFeedFilter(""); setPrepFilter(""); setRiskFilter(""); setVideoFilter(""); setPidFilter(""); };
  const allChecked = paged.length > 0 && paged.every((r) => sel.has(r.id));
  const toggleAll = () => { const n = new Set(sel); if (allChecked) paged.forEach((r) => n.delete(r.id)); else paged.forEach((r) => n.add(r.id)); setSel(n); };
  const toggle = (id: string) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };

  const doSync = async () => {
    if (!syncStore) return flash("✗ Chưa có store Shopify — thêm store + cấu hình API trong Stores trước", false);
    setBusy(true);
    try {
      const j = await postJSON("/api/shopify-products/sync", { storeId: syncStore });
      if (j.ok) { flash(`✓ Synced ${j.store}: ${j.total} products (+${j.created} new · ${j.updated} updated${j.skippedDirty ? ` · ${j.skippedDirty} kept local edits` : ""})`); load(); }
      else flash("✗ " + (j.error ?? "Sync failed") + (/read_products|scope/i.test(j.error ?? "") ? "" : ""), false);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
    setBusy(false);
  };
  const openEdit = async (id: string) => {
    setEditId(id); setEdit(null); setEditLoading(true);
    setEdPers([]); setEdPersOwn(false); setEdPersEditing(false); setEdPersTpl("");
    try {
      const j = await fetch(`/api/shopify-products?id=${id}`).then((r) => r.json());
      if (j.ok) setEdit(j.product);
      else { flash("✗ " + (j.error ?? "Load failed"), false); setEditId(null); setEditLoading(false); return; }
      // v142: nạp bộ Custom options ĐANG áp cho listing (bộ riêng nếu có, không thì của template)
      // để mở Edit là thấy ngay, không phải đi vòng qua action hàng loạt.
      const p = await postJSON("/api/shopify-products/personalization", { action: "read", ids: [id] });
      if (p.ok) { setEdPers(toPQ(p.fields)); setEdPersOwn(p.source === "product"); setEdPersTpl(String(p.templateName ?? "")); }
    }
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
        vendor: edit.vendor, productType: edit.productType, options: edit.options, variants: edit.variants, images: edit.images,
        seoTitle: edit.seoTitle, seoDescription: edit.seoDescription,
      }) }).then((r) => r.json());
      if (!p.ok) { flash("✗ " + (p.error ?? "Save failed"), false); setBusy(false); return; }
      // v172: bản NHÁP stage từ Etsy (chưa có Shopify ID) — Save chỉ lưu local, KHÔNG tự tạo trên
      // Shopify. Hoàn thiện xong bấm Push to Shopify ngoài action bar mới tạo thật.
      if (!edit.shopifyProductId) { flash("✓ Draft saved — hit Push to Shopify when it's ready"); setEditId(null); setBusy(false); load(); return; }
      // v206 · HIGH risk: xác nhận trước khi đẩy (admin bỏ qua được). Huỷ ⇒ giữ bản lưu local, không push.
      const ov = await confirmPolicy([edit.id]);
      if (ov === null) { flash("✓ Saved locally — not pushed (HIGH policy risk not overridden)"); setEditId(null); setBusy(false); load(); return; }
      const j = await postJSON("/api/shopify-products/push", { ids: [edit.id], override: ov });
      if (j.ok || j.pushed) { flash("✓ Saved & updated on Shopify"); setEditId(null); load(); }
      else { const err = (j.results ?? [])[0]?.error ?? j.error ?? "push failed"; flash("✗ Saved locally but Shopify update failed: " + err + (/write_products|scope|access/i.test(String(err)) ? " — add scope write_products + reinstall app" : ""), false); setEditId(null); load(); }
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
    setBusy(false);
  };
  // v119: feed copy lưu ĐƯỜNG RIÊNG. Không dùng PATCH /api/shopify-products vì route đó luôn set
  // dirty:true và saveEdit đẩy thẳng lên Shopify — 2 field feed không bao giờ lên Shopify, đẩy là vô ích.
  const saveFeed = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      const j = await postJSON("/api/shopify-products/feed-save", { id: edit.id, feedTitle: edit.feedTitle ?? "", feedDescription: edit.feedDescription ?? "" });
      if (j.ok) { flash("✓ Feed copy saved" + (j.warn ? " — " + j.warn : "")); load(); }
      else flash("✗ " + (j.error ?? "Save failed"), false);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
    setBusy(false);
  };
  // v286 · Đẩy listing sang Manage Products AMAZON (stage — như flow Etsy → Shopify).
  // v297 · PHẢI CHỌN TEMPLATE trước khi push — mở modal chọn, template gán cứng vào bản ghi mới.
  const [amzPushOpen, setAmzPushOpen] = useState(false);
  const [amzTpls, setAmzTpls] = useState<{ id: string; name: string; productType: string | null }[]>([]);
  const [amzTplPick, setAmzTplPick] = useState("");
  const pushToAmazon = async (ids: string[]) => {
    if (!ids.length) return;
    try {
      const j = await fetch("/api/amazon-templates").then((r) => r.json());
      if (j.ok) { setAmzTpls(j.templates); if (!amzTplPick && j.templates[0]) setAmzTplPick(j.templates[0].id); }
    } catch { /* offline */ }
    setAmzPushOpen(true);
  };
  const doPushAmazon = async () => {
    const ids = Array.from(sel);
    if (!ids.length) return;
    setAmzPushOpen(false); setBusy(true);
    try {
      const j = await postJSON("/api/amazon-products", { ids, templateId: amzTplPick || undefined });
      if (j.ok) { flash(`✓ Pushed ${j.created} to Amazon${j.skipped ? ` · ${j.skipped} already there` : ""}`); load(); }
      else flash("✗ " + (j.error ?? "Push failed"), false);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
    setBusy(false);
  };
  // v223 · Gắn/gỡ video vào listing bằng #Video ID (dán từ Video Library). Không đụng nội dung Shopify.
  const setVideo = async (clear = false) => {
    if (!edit) return;
    setBusy(true);
    try {
      const j = await postJSON("/api/shopify-products/set-video", { id: edit.id, videoCode: clear ? "" : vidCode });
      if (j.ok) {
        if (j.cleared) { setEdit({ ...edit, videoCode: null, videoTitle: null, videoThumbUrl: null }); flash("✓ Video removed"); }
        else {
          setEdit({ ...edit, videoCode: j.video.code, videoTitle: j.video.title, videoThumbUrl: j.video.thumbUrl });
          if (j.push?.ok) flash(`✓ Attached + pushed video #${j.video.code} — Shopify is processing, appears in a few minutes.`);
          else if (j.push && !j.push.ok) flash(`✓ Attached video #${j.video.code} — but Shopify push failed: ${j.push.error}`, false);
          else flash(`✓ Attached video #${j.video.code}`);
        }
        setVidCode(""); load();
      } else flash("✗ " + (j.error ?? "failed"), false);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
    setBusy(false);
  };
  // v206 · HIGH risk KHÔNG còn chặn cứng — chỉ cảnh báo. Admin xác nhận thì vẫn Push qua (gửi override).
  //   trả null  = có HIGH nhưng người dùng huỷ / không phải admin ⇒ ĐỪNG push
  //        false = không có gì HIGH ⇒ push bình thường
  //        true  = có HIGH và admin đã bấm "Push anyway" ⇒ gửi override:true
  const confirmPolicy = async (ids: string[]): Promise<boolean | null> => {
    const highs = ids.filter((id) => rows.find((r) => r.id === id)?.policyRisk === "high");
    if (!highs.length) return false;
    if (!isAdmin) { flash(`✗ ${highs.length} listing flagged HIGH risk — only an admin can override the AI policy check`, false); return null; }
    const lines = highs.slice(0, 6).map((id) => {
      const r = rows.find((x) => x.id === id);
      return `• ${(r?.title ?? id).slice(0, 50)} — ${r?.policyHitsSummary || "HIGH risk"}`;
    }).join("\n");
    const okGo = await confirm({
      title: "AI policy flagged HIGH risk",
      message: `${highs.length} listing(s) were flagged HIGH risk by the AI policy check:\n\n${lines}${highs.length > 6 ? `\n…and ${highs.length - 6} more` : ""}\n\nPush anyway? You are responsible for these listings.`,
      danger: true, confirmText: "Push anyway",
    });
    return okGo ? true : null;
  };
  // Push theo LÔ 5 — route /push chỉ có 60s trên Vercel, đẩy 20 con 1 lần là bị cắt giữa chừng.
  const doPush = async (ids: string[], keepProgress = false) => {
    if (!ids.length) return flash("✗ Select products first", false);
    const ov = await confirmPolicy(ids);
    if (ov === null) return;
    setBusy(true);
    let ok = 0; const errs: string[] = [];
    setProg({ label: "Pushing to Shopify", done: 0, total: ids.length, fail: 0 });
    for (let i = 0; i < ids.length; i += 5) {
      const batch = ids.slice(i, i + 5);
      try {
        const j = await postJSON("/api/shopify-products/push", { ids: batch, override: ov });
        ok += j.pushed ?? 0;
        (j.results ?? []).filter((r: { ok: boolean; error?: string }) => !r.ok).forEach((r: { error?: string }) => { if (errs.length < 3) errs.push(r.error ?? "failed"); });
        if (!j.ok && !j.pushed && j.error && errs.length < 3) errs.push(j.error);
      } catch (e) { if (errs.length < 3) errs.push(String((e as Error)?.message ?? "network")); }
      const sent = Math.min(i + batch.length, ids.length);
      setProg((p) => p ? { ...p, done: sent, fail: Math.max(0, sent - ok) } : p);
    }
    const failed = ids.length - ok;
    flash(`${failed ? "⚠" : "✓"} Pushed ${ok}/${ids.length} to Shopify${failed ? ` · ${failed} failed: ${errs[0] ?? ""}` : ""}${/write_products|scope|access/i.test(errs.join(" ")) ? " — thêm scope write_products + Install lại app" : ""}`, failed === 0);
    if (!keepProgress) setProg(null);
    await load();
    setBusy(false);
    return { ok, failed };
  };
  // ── Bộ chạy theo lô dùng chung ────────────────────────────────────────────────
  // Mọi hành động chạy-theo-lô đều cùng một khuôn: cắt lô → POST → cộng số → gom lỗi → đẩy thanh
  // tiến độ. Tách ra đây để một hành động gộp (vd Prepare for Google feed) chạy được NHIỀU bước
  // trên MỘT thanh tiến độ và CỘNG DỒN lỗi, thay vì bước sau xoá mất lỗi của bước trước.
  // Không tự flash, không tự setBusy — hàm gọi lo phần đó.
  type BatchFail = { id: string; title: string; error: string };
  const runBatch = async (o: {
    url: string; ids: string[]; label: string; chunk: number;
    counters: string[];                    // các key số trong JSON trả về cần cộng dồn
    body?: Record<string, unknown>;
    offset?: number; grand?: number; failBase?: number;   // để nhiều bước dùng chung 1 thanh
  }): Promise<{ counts: Record<string, number>; failed: BatchFail[] }> => {
    const counts: Record<string, number> = {};
    o.counters.forEach((k) => (counts[k] = 0));
    const failed: BatchFail[] = [];
    const grand = o.grand ?? o.ids.length;
    const offset = o.offset ?? 0;
    const failBase = o.failBase ?? 0;
    const titleOf = (id: string) => rows.find((r) => r.id === id)?.title ?? id;
    for (let i = 0; i < o.ids.length; i += o.chunk) {
      const batch = o.ids.slice(i, i + o.chunk);
      try {
        const j = await postJSON(o.url, { ids: batch, ...(o.body ?? {}) });
        o.counters.forEach((k) => (counts[k] += Number(j?.[k] ?? 0)));
        const res = (j?.results ?? []) as { id: string; title: string; ok: boolean; error?: string }[];
        res.filter((x) => !x.ok).forEach((x) => failed.push({ id: x.id, title: x.title, error: x.error ?? "failed" }));
        // Route chết trước khi kịp trả results ⇒ ghi lỗi cho cả lô, không im lặng bỏ qua.
        if (!res.length && j?.error) batch.forEach((id) => failed.push({ id, title: titleOf(id), error: String(j.error) }));
      } catch (e) {
        const m = String((e as Error)?.message ?? "network");
        batch.forEach((id) => failed.push({ id, title: titleOf(id), error: m }));
      }
      setProg({ label: o.label, done: offset + Math.min(i + o.chunk, o.ids.length), total: grand, fail: failBase + failed.length });
    }
    return { counts, failed };
  };

  // ── Các "pass" chạy theo lô ───────────────────────────────────────────────────
  // Mỗi hàm dưới đây là MỘT bước, không tự hỏi xác nhận, không tự flash, không tự setBusy —
  // để hai lệnh gộp (Push template fields / Prepare for Google feed) ghép chúng lại thành một
  // lượt chạy có chung thanh tiến độ và chung danh sách lỗi.

  // fusion.delivery — chỉ số ngày giao hàng, không đụng variants nên chạy được cả trên listing sạch.
  const passDelivery = (ids: string[], p?: { offset: number; grand: number; failBase: number }) =>
    runBatch({ url: "/api/shopify-products/push-delivery", ids, label: "Pushing delivery times", chunk: 25, counters: ["pushed"], ...p });

  // fusion.options — bộ ô cá nhân hoá khách điền trên trang sản phẩm.
  // Template không khai ô nào ⇒ ghi mảng rỗng = XOÁ ô trên listing; đếm riêng "cleared" để báo rõ.
  const passPersonalization = (ids: string[], p?: { offset: number; grand: number; failBase: number }) =>
    runBatch({ url: "/api/shopify-products/push-personalization", ids, label: "Pushing personalization fields", chunk: 25, counters: ["pushed", "cleared"], ...p });

  // ══ Google feed · BƯỚC THƯỜNG XUYÊN, KHÔNG PHẢI ONE-OFF ═════════════════════
  // 3 pass dưới đây phải chạy lại cho MỖI lô sản phẩm mới: SKU gắn vào variant GID và alt gắn vào
  // media GID — hai thứ chỉ tồn tại SAU khi sản phẩm đã lên Shopify, không sinh sẵn lúc tạo được.
  // Quy trình mỗi lô: Push từ Etsy → Sync from Shopify → Prepare for Google feed.
  // Cả 3 chỉ ghi SKU / metafield / alt ⇒ không set dirty, không cần bấm Push sau đó.

  // Sinh TLW-0007-8X8-GLO cho variant ĐANG TRỐNG. Variant đã có SKU thì giữ nguyên —
  // đổi SKU là Google coi như hàng mới, mất hết lịch sử của item đó.
  const passSku = (ids: string[], p?: { offset: number; grand: number; failBase: number }) =>
    runBatch({ url: "/api/shopify-products/fill-sku", ids, label: "Generating SKUs", chunk: 25, counters: ["pushed", "filled", "skipped"], ...p });

  // mm-google-shopping.custom_product = true (hàng tự sản xuất, không cần GTIN)
  // + rút shopify.target-audience về đúng "Kids" (Google chỉ nhận 1 giá trị age_group).
  const passGoogleFields = (ids: string[], p?: { offset: number; grand: number; failBase: number }) =>
    runBatch({ url: "/api/shopify-products/push-google-fields", ids, label: "Pushing Google feed fields", chunk: 25, counters: ["pushed", "audienceFixed", "audienceSkipped"], body: { customProduct: true, audience: "kids" }, ...p });

  // Model VISION xem từng tấm ảnh rồi viết alt ≤125 ký tự, ghi thẳng lên Shopify (chỉ field alt).
  // Ảnh đã có alt thì giữ nguyên. Lô 6 vì mỗi listing là 1 lượt gọi vision — bắn nhiều dễ ăn 429.
  const CHUNK_ALT = 6;
  const passImageAlt = (ids: string[], model: string | undefined, p?: { offset: number; grand: number; failBase: number }) =>
    runBatch({ url: "/api/shopify-products/image-alt", ids, label: "Writing image alt text", chunk: CHUNK_ALT, counters: ["pushed", "written", "skipped"], body: { model }, ...p });

  // ── Lệnh gộp 1: Push template fields ─────────────────────────────────────────
  // Gộp của: nút "🔄 Update Template" + Apply template + Push delivery times + Push personalization
  // fields. Cả bốn đều là ghi-từ-template, chỉ khác phạm vi và khác nguồn template.
  //   templateId rỗng  → mỗi listing dùng template CỦA NÓ  → /update-template
  //   templateId có    → cả lô dùng MỘT template đã chọn    → /apply-template
  // Hai route này đã bao gồm luôn fusion.delivery ⇒ tick "full" thì bỏ qua bước delivery cho khỏi
  // chạy hai lần cùng một việc.
  const doPushTemplate = async (ids: string[], want: { full: boolean; delivery: boolean; personalization: boolean }, templateId: string) => {
    if (!ids.length) return flash("✗ Select products first", false);
    const doDelivery = want.delivery && !want.full;   // full đã ghi delivery rồi
    const steps = [want.full, doDelivery, want.personalization].filter(Boolean).length;
    if (!steps) return flash("✗ Tick at least one field to push", false);
    if (want.full) {
      const okGo = await confirm({
        title: "Push template fields",
        danger: true,
        confirmText: `Push to ${ids.length}`,
        message: `Ghi lên ${ids.length} listing: product type, vendor, theme template, category + metafield, options + variants + GIÁ, số ngày giao hàng, kênh bán${want.personalization ? ", ô cá nhân hoá" : ""}.\n\nGiữ nguyên: collections, tiêu đề, mô tả, ảnh, SEO, tags, trạng thái Active/Draft.\n\n⚠ Variants bị dựng lại theo template: variant nào template không có sẽ bị XOÁ khỏi Shopify và không khôi phục được.`,
      });
      if (!okGo) return;
    }
    setBusy(true); setFails([]);
    const grand = ids.length * steps;
    let done = 0; const failed: { id: string; title: string; error: string }[] = [];
    const bits: string[] = [];
    setProg({ label: "Pushing template fields", done: 0, total: grand, fail: 0 });

    if (want.full) {
      // Hai route này có payload riêng (chạy cả lô 1 lần / có templateId) nên không dùng runBatch.
      const url = templateId ? "/api/shopify-products/apply-template" : "/api/shopify-products/update-template";
      setProg({ label: "Applying template", done, total: grand, fail: failed.length });
      try {
        const j = await postJSON(url, templateId ? { ids, templateId } : { ids });
        const okCount = Number(j?.done ?? j?.updated ?? 0);
        bits.push(`template on ${okCount}`);
        const res = (j?.results ?? []) as { id: string; title: string; ok: boolean; error?: string }[];
        res.filter((r) => !r.ok).forEach((r) => failed.push({ id: r.id, title: r.title, error: r.error ?? "failed" }));
        if (!res.length && j?.error) ids.forEach((id) => failed.push({ id, title: rows.find((r) => r.id === id)?.title ?? id, error: String(j.error) }));
      } catch (e) {
        const m = String((e as Error)?.message ?? "network");
        ids.forEach((id) => failed.push({ id, title: rows.find((r) => r.id === id)?.title ?? id, error: m }));
      }
      done += ids.length;
      setProg({ label: "Applying template", done, total: grand, fail: failed.length });
    }
    if (doDelivery) {
      const r = await passDelivery(ids, { offset: done, grand, failBase: failed.length });
      failed.push(...r.failed); done += ids.length;
      bits.push(`delivery on ${r.counts.pushed}`);
    }
    if (want.personalization) {
      const r = await passPersonalization(ids, { offset: done, grand, failBase: failed.length });
      failed.push(...r.failed); done += ids.length;
      // Template rỗng ⇒ listing bị xoá sạch ô cá nhân hoá. Phải nói ra, không nuốt.
      bits.push(`personalization on ${r.counts.pushed}${r.counts.cleared ? ` (${r.counts.cleared} cleared — template has no fields)` : ""}`);
    }

    setProg(null); setFails(failed);
    flash(`${failed.length ? "⚠" : "✓"} Template fields pushed: ${bits.join(" · ")}${failed.length ? ` · ${failed.length} failed — see the list below` : ""}`, failed.length === 0);
    await load();
    setBusy(false);
  };

  // ── Lệnh gộp 2: Prepare for Google feed ──────────────────────────────────────
  // Gộp của Generate missing SKUs + Push Google feed fields + Generate image alt text — ba bước
  // này luôn chạy cùng nhau, đúng thứ tự này, sau mỗi lô sản phẩm mới. Chạy lại vô hại: cả ba
  // đều bỏ qua thứ đã có (SKU cũ, alt cũ), không ghi đè.
  const doGooglePrep = async (ids: string[], want: { sku: boolean; fields: boolean; alt: boolean }) => {
    if (!ids.length) return flash("✗ Select products first", false);
    const steps = [want.sku, want.fields, want.alt].filter(Boolean).length;
    if (!steps) return flash("✗ Tick at least one step", false);
    // Model lấy từ ô Model trên thanh action. Model chỉ đọc chữ thì không xem được ảnh ⇒ để server dùng model mặc định.
    const useVision = !!aiModel && visionIds.has(aiModel);
    setBusy(true); setFails([]);
    const grand = ids.length * steps;
    let done = 0; const failed: { id: string; title: string; error: string }[] = [];
    const bits: string[] = [];
    setProg({ label: "Preparing for Google feed", done: 0, total: grand, fail: 0 });

    if (want.sku) {
      const r = await passSku(ids, { offset: done, grand, failBase: failed.length });
      failed.push(...r.failed); done += ids.length;
      bits.push(`${r.counts.filled} SKU(s) written${r.counts.skipped ? ` · ${r.counts.skipped} variant(s) already had one` : ""}`);
    }
    if (want.fields) {
      const r = await passGoogleFields(ids, { offset: done, grand, failBase: failed.length });
      failed.push(...r.failed); done += ids.length;
      bits.push(`Google fields on ${r.counts.pushed} · audience narrowed on ${r.counts.audienceFixed}${r.counts.audienceSkipped ? ` · ${r.counts.audienceSkipped} had no audience value — left untouched` : ""}`);
    }
    if (want.alt) {
      const r = await passImageAlt(ids, useVision ? aiModel : undefined, { offset: done, grand, failBase: failed.length });
      failed.push(...r.failed); done += ids.length;
      bits.push(`${r.counts.written} alt text(s) written${r.counts.skipped ? ` · ${r.counts.skipped} image(s) already had alt` : ""}`);
    }

    setProg(null); setFails(failed);
    flash(`${failed.length ? "⚠" : "✓"} ${bits.join(" · ")}${failed.length ? ` · ${failed.length} failed — see the list below` : ""}`, failed.length === 0);
    await load();
    setBusy(false);
  };

  // ── Supplemental feed ────────────────────────────────────────────────────────
  // Feed Merchant Center đang lấy description từ ô SEO meta (≤155 ký tự) — mà ô đó là dòng snippet
  // trên Google Search nên KHÔNG được dài. Google cho feed tới 5000 ký tự. Hai hàm dưới đây viết
  // một bản title/description RIÊNG cho feed rồi xuất file .txt để upload làm feed phụ:
  // Merchant Center ghi đè 2 field đó trong feed, listing Shopify không đổi một chữ nào.
  const CHUNK_FEED = 6;
  const doFeedCopy = async (ids: string[]) => {
    if (!ids.length) return flash("✗ Select products first", false);
    const modelName = aiModels.find((m) => m.id === aiModel)?.name ?? aiModel;
    const okGo = await confirm({
      title: "Generate feed title + long description",
      confirmText: `Generate on ${ids.length}`,
      tone: "green",
      message: `AI viết feed title (≤150 ký tự) + feed description (800-1200 ký tự) cho ${ids.length} listing.\n\nModel: ${aiModel ? modelName : "mặc định của server"}\n\nHai field này CHỈ nằm trong FUSION OS — không ghi lên Shopify, không đụng title/mô tả/SEO của listing, không tạo trạng thái Edited.\n\nChúng chỉ đi ra ngoài khi bấm "Export supplemental feed".\n\nKhoảng ${Math.ceil(ids.length / CHUNK_FEED)} lượt, mỗi lượt tới ~1 phút.`,
    });
    if (!okGo) return;
    setBusy(true); setFails([]);
    setProg({ label: "Writing feed copy", done: 0, total: ids.length, fail: 0 });
    const { counts, failed } = await runBatch({ url: "/api/shopify-products/feed-copy", ids, label: "Writing feed copy", chunk: CHUNK_FEED, counters: ["written"], body: { model: aiModel || undefined } });
    setProg(null); setFails(failed);
    flash(`${failed.length ? "⚠" : "✓"} Feed copy written for ${counts.written}/${ids.length} listing(s)${failed.length ? ` · ${failed.length} failed — see the list below` : ""}`, failed.length === 0);
    await load();
    setBusy(false);
  };

  // Xuất TSV: 1 dòng / VARIANT, cột id = shopify_ZZ_<productId>_<variantId> — trùng tuyệt đối với
  // feed chính, sai 1 ký tự là Google bỏ qua dòng đó mà không báo lỗi.
  const doFeedExport = async (ids: string[]) => {
    if (!ids.length) return flash("✗ Select products first", false);
    setBusy(true);
    try {
      const res = await fetch("/api/shopify-products/feed-export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        flash("✗ " + String(j?.error ?? `export failed (${res.status})`), false);
        setBusy(false); return;
      }
      const nRows = res.headers.get("X-Feed-Rows") ?? "?";
      const nSkip = Number(res.headers.get("X-Feed-Skipped") ?? 0);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "talewix-supplemental-feed.txt";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      flash(`${nSkip ? "⚠" : "✓"} Exported ${nRows} variant row(s)${nSkip ? ` · ${nSkip} listing(s) skipped — run "Generate feed title + long description" on them first` : ""}`, nSkip === 0);
    } catch (e) {
      flash("✗ " + String((e as Error)?.message ?? "network"), false);
    }
    setBusy(false);
  };

  // ---- Export Pinterest ----
  // Xuất CSV để nạp vào Pinterest: Settings → Import content → upload .csv.
  // Ảnh lấy thẳng link CDN Shopify (vốn công khai) nên KHÔNG cần hosting, không vẽ card, không tốn credit.
  // Pinterest chỉ nhận 200 dòng/lần ⇒ server cắt sẵn thành nhiều file, tải lần lượt.
  const doPinterest = async () => {
    const ids = Array.from(sel);
    if (!ids.length) return flash("✗ Select products first", false);
    setBusy(true);
    try {
      const j = await postJSON<{ ok: boolean; error?: string; files?: { name: string; content: string }[]; rows?: number; noImage?: number; noLink?: number; noBoard?: number }>(
        "/api/shopify-products/pinterest-csv", { ids, perProduct: pinPerProduct, perFile: pinPerFile },
      );
      if (!j.ok || !j.files?.length) { flash("✗ " + String(j.error ?? "export failed"), false); setBusy(false); return; }
      for (const f of j.files) {
        const url = URL.createObjectURL(new Blob([f.content], { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url; a.download = f.name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        // Trình duyệt chặn tải nhiều file liên tiếp — giãn ra cho chắc.
        if (j.files.length > 1) await new Promise((r) => setTimeout(r, 700));
      }
      const skip = (j.noImage ?? 0) + (j.noLink ?? 0);
      setPinOpen(false);
      flash(`✓ ${j.rows} pin(s) in ${j.files.length} file(s)${skip ? ` · ${skip} product(s) skipped (no image or no product URL)` : ""}${j.noBoard ? ` · ${j.noBoard} without collection — board fell back to product type` : ""}`, skip === 0);
    } catch (e) {
      flash("✗ " + String((e as Error)?.message ?? "network"), false);
    }
    setBusy(false);
  };

  // ══ v141 · CUSTOM OPTIONS (personalization theo TỪNG listing) ═══════════════
  // Mỗi listing hỏi khách một kiểu khác nhau ⇒ đây là đường CHÍNH, template chỉ là bộ khởi điểm.
  // Mở modal → nạp bộ ĐANG áp cho listing đầu tiên đang chọn (bộ riêng nếu có, không thì của template)
  // → sửa → Save. Save ghi vào FUSION rồi đẩy luôn metafield fusion.options lên Shopify.
  const openPers = async (ids: string[]) => {
    setPersOpen(true); setPersLoading(true); setPersEditing(false); setPersFields([]);
    try {
      const j = await postJSON("/api/shopify-products/personalization", { action: "read", ids });
      if (!j.ok) { flash("✗ " + String(j.error ?? "load failed"), false); setPersOpen(false); setPersLoading(false); return; }
      setPersFields(toPQ(j.fields));
      setPersInfo({ title: String(j.title ?? ""), source: j.source ?? "none", templateName: String(j.templateName ?? ""), count: Number(j.count ?? ids.length), withOwn: Number(j.withOwn ?? 0) });
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "network"), false); setPersOpen(false); }
    setPersLoading(false);
  };
  // Save = ghi bộ riêng cho TẤT CẢ listing đang chọn, rồi đẩy lên Shopify ngay.
  // Không tách 2 nút: lưu mà không đẩy thì trang sản phẩm vẫn trống, người dùng tưởng hỏng.
  const savePers = async () => {
    const ids = Array.from(sel);
    if (!ids.length) return flash("✗ Select products first", false);
    const problem = pqProblem(persFields);
    if (problem) return flash("✗ " + problem, false);
    if (ids.length > 1) {
      const okGo = await confirm({
        title: "Custom options",
        danger: true,
        confirmText: `Apply to ${ids.length}`,
        message: `Ghi bộ ${persFields.length} field này cho ${ids.length} listing — mỗi listing hiện có bộ riêng sẽ bị GHI ĐÈ.\n\nMỗi listing custom một kiểu thì nên chọn ĐÚNG 1 listing rồi sửa, đừng áp cả lô.`,
      });
      if (!okGo) return;
    }
    setPersOpen(false); setBusy(true); setFails([]);
    try {
      const j = await postJSON("/api/shopify-products/personalization", { action: "save", ids, fields: persFields });
      if (!j.ok) { flash("✗ " + String(j.error ?? "save failed"), false); setBusy(false); return; }
      const n = (j.fields ?? []).length;
      // Đẩy luôn lên Shopify để trang sản phẩm đổi ngay — dùng chung thanh tiến độ của các lệnh khác.
      setProg({ label: "Pushing personalization fields", done: 0, total: ids.length, fail: 0 });
      const r = await passPersonalization(ids);
      setProg(null); setFails(r.failed);
      flash(`${r.failed.length ? "⚠" : "✓"} ${n} field(s) saved on ${ids.length} listing(s) · pushed to Shopify: ${r.counts.pushed ?? 0}${r.failed.length ? ` · ${r.failed.length} failed — see the list below` : ""}`, r.failed.length === 0);
    } catch (e) { setProg(null); flash("✗ " + String((e as Error)?.message ?? "network"), false); }
    await load();
    setBusy(false);
  };
  // Bỏ bộ riêng ⇒ listing quay về ăn theo template (và đẩy lại ngay cho khớp).
  const clearPers = async () => {
    const ids = Array.from(sel);
    if (!ids.length) return;
    const okGo = await confirm({
      title: "Use the template instead",
      confirmText: `Reset ${ids.length}`,
      tone: "green",
      message: `Xoá bộ Custom options riêng của ${ids.length} listing. Từ giờ listing lấy theo template, và "Push template fields" sẽ ghi đè được như cũ.`,
    });
    if (!okGo) return;
    setPersOpen(false); setBusy(true); setFails([]);
    try {
      const j = await postJSON("/api/shopify-products/personalization", { action: "clear", ids });
      if (!j.ok) { flash("✗ " + String(j.error ?? "failed"), false); setBusy(false); return; }
      setProg({ label: "Pushing personalization fields", done: 0, total: ids.length, fail: 0 });
      const r = await passPersonalization(ids);
      setProg(null); setFails(r.failed);
      flash(`${r.failed.length ? "⚠" : "✓"} ${ids.length} listing(s) back on the template${r.failed.length ? ` · ${r.failed.length} failed — see the list below` : ""}`, r.failed.length === 0);
    } catch (e) { setProg(null); flash("✗ " + String((e as Error)?.message ?? "network"), false); }
    await load();
    setBusy(false);
  };
  // v142 · Custom options ngay trong Edit listing — chỉ 1 listing, không confirm hàng loạt.
  // Đi đường riêng như "Save feed copy": KHÔNG gộp vào nút Save chính (nút đó đẩy title/ảnh/giá,
  // ô cá nhân hoá lại nằm ở metafield) — gộp vào là mỗi lần sửa ô lại đẩy nguyên cả listing.
  const saveEdPers = async () => {
    if (!edit) return;
    const problem = pqProblem(edPers);
    if (problem) return flash("✗ " + problem, false);
    setBusy(true);
    try {
      const j = await postJSON("/api/shopify-products/personalization", { action: "save", ids: [edit.id], fields: edPers });
      if (!j.ok) { flash("✗ " + String(j.error ?? "save failed"), false); setBusy(false); return; }
      const p = await postJSON("/api/shopify-products/push-personalization", { ids: [edit.id] });
      const err = (p.results ?? []).find((x: { ok: boolean; error?: string }) => !x.ok)?.error;
      setEdPersOwn(true);
      setEdPers(toPQ(j.fields));
      setEdit({ ...edit, personalization: toPQ(j.fields) });
      flash(err ? "⚠ Saved in FUSION but Shopify push failed: " + err : `✓ ${(j.fields ?? []).length} custom option field(s) saved & pushed`, !err);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "network"), false); }
    await load();
    setBusy(false);
  };
  const clearEdPers = async () => {
    if (!edit) return;
    const okGo = await confirm({
      title: "Use the template instead",
      confirmText: "Reset",
      tone: "green",
      message: "This listing drops its own custom options and follows the template again. Template pushes will overwrite it from now on.",
    });
    if (!okGo) return;
    setBusy(true);
    try {
      const j = await postJSON("/api/shopify-products/personalization", { action: "clear", ids: [edit.id] });
      if (!j.ok) { flash("✗ " + String(j.error ?? "failed"), false); setBusy(false); return; }
      await postJSON("/api/shopify-products/push-personalization", { ids: [edit.id] });
      const r = await postJSON("/api/shopify-products/personalization", { action: "read", ids: [edit.id] });
      setEdPersOwn(false); setEdPers(toPQ(r.fields));
      setEdit({ ...edit, personalization: null });
      flash("✓ Back on the template");
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "network"), false); }
    await load();
    setBusy(false);
  };

  // AI Optimize theo LÔ 6 + hiện tiến độ + TỰ CHẠY LẠI con fail (2 vòng nữa) vì lỗi hay gặp là
  // 429 rate limit / provider chậm — chạy lại là qua. Con nào vẫn hỏng thì liệt kê kèm lý do.
  // KHÔNG tự Push: gen xong sản phẩm ở trạng thái EDITED → xem lại → bấm "⬆ Push to Shopify".
  // 6 = MAX_PER_CALL của route (chạy được nhờ Vercel Pro cho 300s). Hạ về Hobby thì phải đưa lại 3.
  const CHUNK_AI = 6;
  const runAiPass = async (ids: string[], label: string, offsetDone: number, grandTotal: number) => {
    let ok = 0; let withTpl = 0; const failed: { id: string; title: string; error: string }[] = [];
    for (let i = 0; i < ids.length; i += CHUNK_AI) {
      const batch = ids.slice(i, i + CHUNK_AI);
      try {
        const j = await postJSON("/api/shopify-products/ai-optimize", { ids: batch, model: aiModel || undefined });
        ok += j.optimized ?? 0; withTpl += j.withTemplate ?? 0;
        const res = (j.results ?? []) as { id: string; title: string; ok: boolean; error?: string }[];
        res.filter((x) => !x.ok).forEach((x) => failed.push({ id: x.id, title: x.title, error: x.error ?? "failed" }));
        if (!res.length && !j.ok) batch.forEach((id) => failed.push({ id, title: rows.find((r) => r.id === id)?.title ?? id, error: j.error ?? "request failed" }));
      } catch (e) {
        const err = String((e as Error)?.message ?? "network error — Vercel function bị cắt hoặc mất mạng");
        batch.forEach((id) => failed.push({ id, title: rows.find((r) => r.id === id)?.title ?? id, error: err }));
      }
      setProg({ label, done: offsetDone + Math.min(i + batch.length, ids.length), total: grandTotal, fail: failed.length });
    }
    return { ok, withTpl, failed };
  };
  const doAiOptimize = async (retryIds?: string[]) => {
    const idsAll = retryIds ?? Array.from(sel);
    if (!idsAll.length) return flash("✗ Select products first", false);
    setBusy(true); setMsg(null); setFails([]);
    let done = 0; let withTpl = 0;
    let pending = idsAll;
    let lastFails: { id: string; title: string; error: string }[] = [];
    // vòng 1 chạy hết, vòng 2-3 chỉ chạy lại con hỏng
    for (let pass = 1; pass <= 3 && pending.length; pass++) {
      const label = pass === 1 ? "AI writing content" : `Retrying ${pending.length} failed (pass ${pass}/3)`;
      const base = pass === 1 ? 0 : idsAll.length - pending.length;
      setProg({ label, done: base, total: pass === 1 ? idsAll.length : idsAll.length, fail: lastFails.length });
      const r = await runAiPass(pending, label, base, idsAll.length);
      done += r.ok; withTpl += r.withTpl;
      lastFails = r.failed;
      pending = r.failed.map((f) => f.id);
      if (pending.length) await new Promise((s) => setTimeout(s, 2500)); // hạ nhiệt rate limit
    }
    setProg(null);
    setFails(lastFails);
    const fail = lastFails.length;
    if (done > 0) flash(`✓ AI wrote ${done}/${idsAll.length} listing(s) · ${withTpl} with 3 tabs from template${fail ? ` · ${fail} still failed — see the list below` : ""} — review, then press ⬆ Push to Shopify`, fail === 0);
    else flash(`✗ AI Optimize failed on all ${idsAll.length}: ${lastFails[0]?.error ?? "unknown"}`, false);
    await load();
    setBusy(false);
  };

  // ══ v287 · RUN PIPELINE — gom cả chuỗi hoàn thiện listing thành MỘT nút ═══════════════
  // Chuỗi chuẩn sau khi push Etsy → Shopify: AI Optimize → Push to Shopify → Google prep
  // (SKU + fields + alt) → Feed copy (AI) → Set Active → Push to Amazon + AI Amazon copy.
  // Mỗi bước tick chọn được; "Skip done" (mặc định BẬT) tự bỏ qua con đã xong ở từng bước
  // (đã có AI, không dirty, đủ SKU/alt, đã có feed, đã ACTIVE, đã có bản Amazon + copy).
  const [pipeOpen, setPipeOpen] = useState(false);
  const [pipeSteps, setPipeSteps] = useState<Record<string, boolean>>({ ai: true, push: true, gprep: true, feed: true, active: true, amazon: true });
  const [pipeSkipDone, setPipeSkipDone] = useState(true);
  const fetchRowsFresh = async (): Promise<Row[]> => {
    try { const j = await fetch("/api/shopify-products").then((r) => r.json()); return Array.isArray(j?.rows) ? j.rows as Row[] : rows; }
    catch { return rows; }
  };
  const runPipeline = async () => {
    const ids = Array.from(sel);
    if (!ids.length) return flash("✗ Select products first", false);
    setPipeOpen(false); setBusy(true); setMsg(null); setFails([]);
    const summary: string[] = [];
    const idSet = new Set(ids);
    let fresh = rows.filter((r) => idSet.has(r.id));

    // 1 · AI Optimize (bỏ qua con đã có aiAt khi Skip done)
    if (pipeSteps.ai) {
      const t = (pipeSkipDone ? fresh.filter((r) => !r.aiAt) : fresh).map((r) => r.id);
      if (t.length) {
        setProg({ label: `Pipeline 1/6 · AI Optimize (${t.length})`, done: 0, total: t.length, fail: 0 });
        const r1 = await runAiPass(t, `Pipeline 1/6 · AI Optimize`, 0, t.length);
        let fails = r1.failed;
        if (fails.length) { await new Promise((s) => setTimeout(s, 2500)); const r2 = await runAiPass(fails.map((f) => f.id), "Pipeline 1/6 · retry", t.length - fails.length, t.length); fails = r2.failed; }
        summary.push(`AI ${t.length - fails.length}/${t.length}`);
      } else summary.push("AI skipped (done)");
      fresh = (await fetchRowsFresh()).filter((r) => idSet.has(r.id));
    }

    // 2 · Push to Shopify (chỉ con dirty)
    if (pipeSteps.push) {
      const t = fresh.filter((r) => r.dirty).map((r) => r.id);
      if (t.length) {
        const res = await doPush(t, true);
        setBusy(true); // doPush tự tắt busy — bật lại cho các bước sau
        summary.push(`Push ${res?.ok ?? 0}/${t.length}`);
        fresh = (await fetchRowsFresh()).filter((r) => idSet.has(r.id));
      } else summary.push("Push skipped (clean)");
    }

    // 3 · Google prep: SKU + Google fields + image alt (3 pass, chung 1 thanh)
    if (pipeSteps.gprep) {
      const needSku = pipeSkipDone ? fresh.filter((r) => r.skuDone < r.skuTotal).map((r) => r.id) : ids;
      const needAlt = pipeSkipDone ? fresh.filter((r) => r.altDone < r.altTotal).map((r) => r.id) : ids;
      const grand = needSku.length + ids.length + needAlt.length;
      let off = 0; let failBase = 0;
      if (needSku.length) { const r = await passSku(needSku, { offset: off, grand, failBase }); off += needSku.length; failBase += r.failed.length; }
      { const r = await passGoogleFields(ids, { offset: off, grand, failBase }); off += ids.length; failBase += r.failed.length; }
      if (needAlt.length) { const useVision = !!aiModel && visionIds.has(aiModel); await passImageAlt(needAlt, useVision ? aiModel : undefined, { offset: off, grand, failBase }); }
      summary.push(`Google prep ✓ (sku ${needSku.length} · alt ${needAlt.length})`);
      fresh = (await fetchRowsFresh()).filter((r) => idSet.has(r.id));
    }

    // 4 · Feed copy (AI) — chỉ con chưa đạt chuẩn feed
    if (pipeSteps.feed) {
      const t = (pipeSkipDone ? fresh.filter((r) => !feedOk(r)) : fresh).map((r) => r.id);
      if (t.length) {
        const { failed } = await runBatch({ url: "/api/shopify-products/feed-copy", ids: t, label: `Pipeline 4/6 · Feed copy (${t.length})`, chunk: CHUNK_FEED, counters: ["written"], body: { model: aiModel || undefined } });
        summary.push(`Feed ${t.length - failed.length}/${t.length}`);
      } else summary.push("Feed skipped (done)");
    }

    // 5 · Set as Active — chỉ con chưa ACTIVE
    if (pipeSteps.active) {
      const t = (pipeSkipDone ? fresh.filter((r) => r.status !== "ACTIVE") : fresh).map((r) => r.id);
      if (t.length) {
        setProg({ label: `Pipeline 5/6 · Set Active (${t.length})`, done: 0, total: t.length, fail: 0 });
        try {
          const j = await postJSON("/api/shopify-products/bulk-action", { ids: t, action: "active" });
          summary.push(`Active ${j.done ?? 0}/${t.length}`);
        } catch { summary.push("Active FAILED"); }
        setProg({ label: `Pipeline 5/6 · Set Active`, done: t.length, total: t.length, fail: 0 });
      } else summary.push("Active skipped");
    }

    // 6 · Push to Amazon (stage) + AI Amazon copy
    if (pipeSteps.amazon) {
      setProg({ label: "Pipeline 6/6 · Push to Amazon", done: 0, total: ids.length, fail: 0 });
      try {
        const jp = await postJSON("/api/amazon-products", { ids });
        // Lấy bản ghi Amazon của đúng các con này để chạy AI copy
        const ja = await fetch("/api/amazon-products").then((r) => r.json());
        const mine = (Array.isArray(ja?.rows) ? ja.rows : []) as { id: string; shopifyProductId: string | null; aiAt: string | null }[];
        const targets = mine.filter((a) => a.shopifyProductId && idSet.has(a.shopifyProductId) && (!pipeSkipDone || !a.aiAt)).map((a) => a.id);
        let done = 0; let fail = 0;
        for (let i = 0; i < targets.length; i += 6) {
          const chunk = targets.slice(i, i + 6);
          setProg({ label: `Pipeline 6/6 · AI Amazon copy (${done}/${targets.length})`, done, total: targets.length, fail });
          try {
            const j = await postJSON("/api/amazon-products/ai", { ids: chunk, model: aiModel || undefined });
            for (const res of j?.results ?? []) { if (res.ok) done++; else fail++; }
          } catch { fail += chunk.length; }
        }
        summary.push(`Amazon staged +${jp.created ?? 0} · AI copy ${done}/${targets.length}${fail ? ` (${fail} failed)` : ""}`);
      } catch (e) { summary.push("Amazon FAILED: " + String((e as Error)?.message ?? e).slice(0, 80)); }
    }

    setProg(null);
    await load();
    setBusy(false);
    flash(`✓ Pipeline done — ${summary.join(" · ")}`);
  };

  // v179 · AI policy audit theo LÔ 6 — soi TOÀN BỘ listing (artwork + text + SEO + feed),
  // mỗi phát hiện kèm CÁCH SỬA. Danh sách dưới thanh tiến độ liệt kê từng vấn đề → fix.
  const CHUNK_POLAI = 6;
  const doPolicyAi = async (ids: string[]) => {
    if (!ids.length) return flash("✗ Select products first", false);
    setBusy(true); setMsg(null); setFails([]);
    let clean = 0, medium = 0, high = 0; const failed: { id: string; title: string; error: string }[] = [];
    setProg({ label: "AI checking policy risks", done: 0, total: ids.length, fail: 0 });
    for (let i = 0; i < ids.length; i += CHUNK_POLAI) {
      const batch = ids.slice(i, i + CHUNK_POLAI);
      try {
        const j = await postJSON("/api/shopify-products/policy-ai", { ids: batch, model: aiModel || undefined });
        clean += j.clean ?? 0; medium += j.medium ?? 0; high += j.high ?? 0;
        const res = (j.results ?? []) as { id: string; title: string; ok: boolean; risk?: string; summary?: string; findings?: { term: string; field: string; severity: string; fix?: string }[]; error?: string }[];
        res.filter((x) => !x.ok).forEach((x) => failed.push({ id: x.id, title: x.title, error: x.error ?? "failed" }));
        // v198: BỎ khung liệt kê findings sau khi audit — chi tiết xem từng listing bằng cách
        // click chip ⛔/⚠/✓ (modal v191). Khung fails giờ chỉ còn dành cho LỖI THẬT (429/timeout...).
        if (!res.length && !j.ok) batch.forEach((id) => failed.push({ id, title: rows.find((r) => r.id === id)?.title ?? id, error: j.error ?? "request failed" }));
      } catch (e) {
        const err = String((e as Error)?.message ?? "network error");
        batch.forEach((id) => failed.push({ id, title: rows.find((r) => r.id === id)?.title ?? id, error: err }));
      }
      setProg({ label: "AI checking policy risks", done: Math.min(i + batch.length, ids.length), total: ids.length, fail: failed.length });
    }
    setProg(null); setFails(failed);
    flash(high
      ? `⚠ AI checked ${ids.length}: ${high} HIGH (push BLOCKED) · ${medium} medium · ${clean} clean — click a listing's ⛔/⚠ chip for details & fixes`
      : `✓ AI checked ${ids.length}: ${clean} clean · ${medium} medium · 0 high${medium ? " — click a listing's ⚠ chip for details & fixes" : ""}`, high === 0);
    await load();
    setBusy(false);
  };

  // v173 · AI Auto-Collection theo LÔ 8. Sản phẩm thật (có gid) được gắn collection NGAY trên Shopify;
  // bản nháp chỉ ghi local, Push sẽ áp. Con nào AI thấy không hợp collection nào → đếm vào "unmatched"
  // và liệt kê để người tự xử (KHÔNG tạo collection mới). Cần model có 👁 để đọc ảnh.
  const CHUNK_AICOL = 8;
  const doAiCollection = async (ids: string[]) => {
    if (!ids.length) return flash("✗ Select products first", false);
    setBusy(true); setMsg(null); setFails([]);
    let assigned = 0, unmatched = 0, tagged = 0; const failed: { id: string; title: string; error: string }[] = [];
    setProg({ label: "AI sorting into collections", done: 0, total: ids.length, fail: 0 });
    for (let i = 0; i < ids.length; i += CHUNK_AICOL) {
      const batch = ids.slice(i, i + CHUNK_AICOL);
      try {
        const j = await postJSON("/api/shopify-products/ai-collections", { ids: batch, model: aiModel || undefined });
        assigned += j.assigned ?? 0; unmatched += j.unmatched ?? 0; tagged += j.tagged ?? 0;
        const res = (j.results ?? []) as { id: string; title: string; ok: boolean; unmatched?: boolean; error?: string }[];
        res.filter((x) => !x.ok).forEach((x) => failed.push({ id: x.id, title: x.title, error: x.error ?? "failed" }));
        res.filter((x) => x.ok && x.unmatched).forEach((x) => failed.push({ id: x.id, title: x.title, error: "no matching collection — assign by hand or create one" }));
        if (!res.length && !j.ok) batch.forEach((id) => failed.push({ id, title: rows.find((r) => r.id === id)?.title ?? id, error: j.error ?? "request failed" }));
      } catch (e) {
        const err = String((e as Error)?.message ?? "network error");
        batch.forEach((id) => failed.push({ id, title: rows.find((r) => r.id === id)?.title ?? id, error: err }));
      }
      setProg({ label: "AI sorting into collections", done: Math.min(i + batch.length, ids.length), total: ids.length, fail: failed.length });
    }
    setProg(null); setFails(failed);
    if (assigned + unmatched > 0) flash(`✓ AI sorted ${assigned}/${ids.length} into collections${tagged ? ` · ${tagged} got holiday tags (christmas/easter/…)` : ""}${unmatched ? ` · ${unmatched} had no fit (assign by hand)` : ""}. Drafts apply their collection on Push.`, unmatched === 0 && !failed.length);
    else flash(`✗ AI Auto-Collection failed on all ${ids.length}: ${failed[0]?.error ?? "unknown"}`, false);
    await load();
    setBusy(false);
  };

  // Find & replace: thay chuỗi NGUYÊN VĂN trong mô tả/tiêu đề rồi ghi thẳng lên Shopify qua API.
  // Chạy dry-run trước để biết chính xác bao nhiêu listing dính chuỗi, rồi mới hỏi xác nhận.
  const CHUNK_FR = 25;
  const doFindReplace = async (ids: string[]) => {
    if (!ids.length) return flash("✗ Select products first", false);
    if (!frFind) return flash("✗ Enter the text to find", false);
    setBusy(true);
    let matched = 0, hits = 0;
    try {
      for (let i = 0; i < ids.length; i += CHUNK_FR) {
        const j = await postJSON("/api/shopify-products/find-replace", { ids: ids.slice(i, i + CHUNK_FR), find: frFind, replace: frReplace, field: frField, dryRun: true });
        if (!j.ok) { flash("✗ " + (j.error ?? "Preview failed"), false); setBusy(false); return; }
        matched += j.matched ?? 0; hits += j.hits ?? 0;
      }
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); setBusy(false); return; }
    setBusy(false);
    if (!matched) return flash(`✗ No match — 0/${ids.length} selected listing(s) contain that text`, false);
    const where = frField === "title" ? "title" : "description";
    const okGo = await confirm({
      title: "Find & replace",
      danger: true,
      confirmText: `Replace on ${matched}`,
      message: `${matched}/${ids.length} listing(s) contain the text (${hits} occurrence(s)) in the ${where}.\n\nFind:\n${frFind.slice(0, 300)}\n\nReplace with:\n${frReplace ? frReplace.slice(0, 300) : "(empty — the text will be deleted)"}\n\nWrites straight to Shopify. Variants, prices, images, collections and status are untouched. This cannot be undone.`,
    });
    if (!okGo) return;
    setAct(null); setBusy(true); setFails([]);
    let ok = 0; const failed: { id: string; title: string; error: string }[] = [];
    setProg({ label: "Replacing on Shopify", done: 0, total: ids.length, fail: 0 });
    for (let i = 0; i < ids.length; i += CHUNK_FR) {
      const batch = ids.slice(i, i + CHUNK_FR);
      try {
        const j = await postJSON("/api/shopify-products/find-replace", { ids: batch, find: frFind, replace: frReplace, field: frField });
        ok += j.done ?? 0;
        (j.results ?? []).filter((r: { ok: boolean }) => !r.ok).forEach((r: { id: string; title: string; error?: string }) => failed.push({ id: r.id, title: r.title, error: r.error ?? "failed" }));
        if (!j.results && j.error) batch.forEach((id) => failed.push({ id, title: rows.find((x) => x.id === id)?.title ?? id, error: j.error }));
      } catch (e) {
        const m = String((e as Error)?.message ?? "network");
        batch.forEach((id) => failed.push({ id, title: rows.find((x) => x.id === id)?.title ?? id, error: m }));
      }
      setProg((p) => p ? { ...p, done: Math.min(i + batch.length, ids.length), fail: failed.length } : p);
    }
    setProg(null); setFails(failed);
    flash(`${failed.length ? "⚠" : "✓"} Replaced in ${ok} listing(s) on Shopify${failed.length ? ` · ${failed.length} failed — see the list below` : ""}`, failed.length === 0);
    await load();
    setBusy(false);
  };

  // ---- bulk actions ("More actions") ----
  const selStoreIds = () => Array.from(new Set(rows.filter((r) => sel.has(r.id)).map((r) => r.storeId)));
  const postAction = async (payload: Record<string, unknown>, okMsg: (r: { done: number; failed: number; skipped: number; results?: { ok: boolean; error?: string }[] }) => string) => {
    setBusy(true);
    try {
      const j = await postJSON("/api/shopify-products/bulk-action", { ids: Array.from(sel), ...payload });
      if (j.ok || j.done) { flash(okMsg(j), (j.failed ?? 0) === 0); setSel(new Set()); load(); }
      else { const err = j.error ?? (j.results ?? []).find((r: { ok: boolean }) => !r.ok)?.error ?? "Action failed"; flash("✗ " + err + (/write_products|scope|access|publications/i.test(String(err)) ? " — add scope write_products/write_publications + reinstall app" : ""), false); }
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
    setBusy(false);
  };
  const runAction = async (key: ActKey) => {
    setActionsOpen(false);
    if (!sel.size) return flash("✗ Select products first", false);
    // v289 · Kênh ngoài — chuyển từ nút riêng vào More actions.
    if (key === "pinterest") { setPinOpen(true); return; }
    if (key === "push_amazon") { pushToAmazon(Array.from(sel)); return; }
    // Feed phụ — không đụng Shopify, không cần chọn gì thêm.
    if (key === "feed_copy") return doFeedCopy(Array.from(sel));
    if (key === "feed_export") return doFeedExport(Array.from(sel));
    // v173 · AI tự gán collection — chạy theo lô, dùng model đang chọn (cần 👁 để đọc ảnh).
    if (key === "ai_collection") return doAiCollection(Array.from(sel));
    // v179 · AI audit toàn bộ listing — dùng model đang chọn (cần 👁).
    if (key === "policy_ai") return doPolicyAi(Array.from(sel));
    // Find & replace: chạy được trên nhiều store cùng lúc — mỗi listing dùng credential store của nó.
    if (key === "find_replace") { setAct({ key, title: "Find & replace in text", kind: "replace", storeId: "", loading: false, items: [] }); return; }
    // Custom options — modal riêng, không dùng khung act (nội dung phức tạp hơn hẳn các lệnh kia).
    if (key === "personalization") return openPers(Array.from(sel));
    // Google feed: 3 bước, mặc định tick cả 3 vì lô mới nào cũng cần cả 3.
    if (key === "google_prep") {
      setParts({ sku: true, fields: true, alt: true });
      setAct({ key, title: "Prepare for Google feed", kind: "gprep", storeId: "", loading: false, items: [] });
      return;
    }
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
    // Tags → 1 modal, công tắc Add/Remove nằm trong modal.
    if (key === "tags") {
      setTagInput(""); setActMode("add");
      setAct({ key, title: "Tags", kind: "tags", storeId: "", loading: false, items: [] });
      return;
    }
    // Push template fields: chạy được trên nhiều store nếu dùng template CỦA TỪNG sản phẩm.
    // Chỉ khi chọn 1 template áp cho cả lô mới cần cùng store (template ID là của riêng store).
    if (key === "push_template") {
      setParts({ full: true, delivery: false, personalization: true });
      setPickOne("__own__");
      const one = selStoreIds();
      const sid = one.length === 1 ? one[0] : "";
      const own = { id: "__own__", label: "Each product's own template (auto-match by Product type)" };
      setAct({ key, title: "Push template fields", kind: "pushtpl", storeId: sid, loading: !!sid, items: [own] });
      if (!sid) return;
      try {
        const j = await fetch(`/api/shopify-templates?storeId=${sid}`).then((r) => r.json());
        const tpls = (j.templates ?? []).map((t: { id: string; name: string; productType?: string | null }) => ({ id: t.id, label: t.productType ? `${t.name} — type: ${t.productType}` : t.name }));
        setAct((a) => a ? { ...a, loading: false, items: [own, ...tpls] } : a);
      } catch { setAct((a) => a ? { ...a, loading: false } : a); }
      return;
    }
    // Picker actions còn lại (template / collection / channels) — cần đúng 1 store
    const sids = selStoreIds();
    if (sids.length !== 1) return flash("✗ These actions need products from ONE store — filter by store first (template/channel/collection IDs are per store).", false);
    const storeId = sids[0];
    // Set AI template — chỉ gán nguồn facts cho AI, KHÔNG gửi gì lên Shopify.
    if (key === "set_template") {
      setPickOne("__none__");
      setAct({ key, title: "Set AI template", kind: "template", storeId, loading: true, items: [] });
      try {
        const j = await fetch(`/api/shopify-templates?storeId=${storeId}`).then((r) => r.json());
        if (!j.ok) { flash("✗ " + (j.error ?? "Load failed"), false); setAct(null); return; }
        const tpls = (j.templates ?? []).map((t: { id: string; name: string; productType?: string | null }) => ({ id: t.id, label: t.productType ? `${t.name} — type: ${t.productType}` : t.name }));
        if (!tpls.length) flash("✗ No templates for this store — create one in Manage Templates · Shopify", false);
        setAct((a) => a ? { ...a, loading: false, items: [{ id: "__none__", label: "None — auto-match by Product type" }, ...tpls] } : a);
      } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); setAct(null); }
      return;
    }
    // collection / channels — mỗi cái 1 mục, chiều Add hay Remove chọn trong modal.
    const kind: "collection" | "publication" = key === "collection" ? "collection" : "publication";
    setPickOne(""); setPickMany(new Set()); setActMode("add");
    setAct({ key, title: kind === "collection" ? "Collection" : "Sales channels", kind, storeId, loading: true, items: [] });
    try {
      const j = await fetch(`/api/shopify-products/channels?storeId=${storeId}`).then((r) => r.json());
      if (!j.ok) { flash("✗ " + (j.error ?? "Load failed"), false); setAct(null); return; }
      const items: { id: string; label: string }[] = kind === "collection"
        ? (j.collections ?? []).map((c: { id: string; title: string }) => ({ id: c.id, label: c.title }))
        : (j.publications ?? []).map((p: { id: string; name: string }) => ({ id: p.id, label: p.name }));
      setAct((a) => a ? { ...a, loading: false, items } : a);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); setAct(null); }
  };
  const submitAct = async () => {
    if (!act) return;
    // Set AI template — chỉ gán link trong FUSION, KHÔNG đụng Shopify, KHÔNG đổi mô tả đang có.
    if (act.kind === "template") {
      if (!pickOne) return flash("✗ Pick a template", false);
      const templateId = pickOne === "__none__" ? null : pickOne;
      setAct(null); setBusy(true);
      try {
        const j = await postJSON("/api/shopify-products/set-template", { ids: Array.from(sel), templateId });
        if (j.ok) flash(`✓ ${templateId ? "Linked" : "Unlinked"} template on ${j.done} product(s)${j.skipped ? ` · ${j.skipped} skipped (other store)` : ""} — existing descriptions unchanged; run ✦ AI Optimize to rewrite them`);
        else flash("✗ " + (j.error ?? "Failed"), false);
      } catch (e) { flash("✗ " + String((e as Error)?.message ?? "Network error"), false); }
      await load();
      setBusy(false);
      return;
    }
    if (act.kind === "pushtpl") {
      const want = { full: !!parts.full, delivery: !!parts.delivery, personalization: !!parts.personalization };
      const templateId = pickOne && pickOne !== "__own__" ? pickOne : "";
      setAct(null);
      return doPushTemplate(Array.from(sel), want, templateId);
    }
    if (act.kind === "gprep") {
      const want = { sku: !!parts.sku, fields: !!parts.fields, alt: !!parts.alt };
      setAct(null);
      return doGooglePrep(Array.from(sel), want);
    }
    if (act.kind === "replace") return doFindReplace(Array.from(sel));
    if (act.kind === "tags") {
      const tags = tagInput.split(",").map((t) => t.trim()).filter(Boolean);
      if (!tags.length) return flash("✗ Enter at least one tag", false);
      const action = actMode === "add" ? "tags_add" : "tags_remove";
      const verb = actMode === "add" ? "Added" : "Removed";
      setAct(null);
      return postAction({ action, tags: tags.join(",") }, (r) => `✓ ${verb} tags on ${r.done} product(s)${r.failed ? ` · ${r.failed} failed` : ""}`);
    }
    if (act.kind === "collection") {
      if (!pickOne) return flash("✗ Pick a collection", false);
      const action = actMode === "add" ? "collection_add" : "collection_remove";
      const verb = actMode === "add" ? "Added to" : "Removed from";
      setAct(null);
      return postAction({ action, storeId: act.storeId, collectionId: pickOne }, (r) => `✓ ${verb} collection: ${r.done}${r.failed ? ` · ${r.failed} failed` : ""}${r.skipped ? ` · ${r.skipped} skipped (other store)` : ""}`);
    }
    // publication (sales channels)
    if (!pickMany.size) return flash("✗ Pick at least one", false);
    const action = actMode === "add" ? "channels_include" : "channels_exclude";
    const verb = actMode === "add" ? "Included" : "Excluded";
    setAct(null);
    return postAction({ action, storeId: act.storeId, publicationIds: Array.from(pickMany) }, (r) => `✓ ${verb} ${r.done} product(s)${r.failed ? ` · ${r.failed} failed` : ""}${r.skipped ? ` · ${r.skipped} skipped (other store)` : ""}`);
  };

  // ---- edit modal helpers ----
  const setV = (i: number, k: keyof Variant, val: string) => { if (!edit) return; const vs = edit.variants.slice(); (vs[i] as Record<string, unknown>)[k] = val; setEdit({ ...edit, variants: vs }); };

  // v264 · THÊM OPTION / VARIANT BẰNG TAY ngay trong nháp — khỏi vòng Push→Update Template→Push.
  //  · Sửa tên option + danh sách giá trị (phân tách bằng dấu phẩy).
  //  · "Rebuild variants" dựng lại đúng tổ hợp (tích Descartes) các giá trị option, GIỮ NGUYÊN
  //    price/compare/SKU của tổ hợp đã có (khớp theo chữ ký selectedOptions), tổ hợp mới để giá 0.
  //  Push tạo mới đọc thẳng p.options + p.variants.selectedOptions nên Push một phát là đủ.
  const sigOf = (so: SelOpt[]) => (so ?? []).map((x) => `${x.name}=${x.value}`).join("|");
  // v264b · gõ option/giá trị là TỰ xổ lại variants (bỏ nút Rebuild). options giữ nguyên đúng thứ
  // người dùng đang gõ (kể cả dòng trống); variants tính từ tích Descartes của option đã đủ tên+giá trị,
  // giữ nguyên price/compare/SKU của tổ hợp đã có.
  const recompute = (raw: { name: string; position: number; values: string[] }[]) => {
    if (!edit) return;
    const options = raw.map((o, i) => ({ ...o, position: i + 1 }));
    const opts = options.map((o) => ({ name: (o.name || "").trim(), values: (o.values ?? []).map((v) => v.trim()).filter(Boolean) })).filter((o) => o.name && o.values.length);
    const prev = new Map(edit.variants.map((v) => [sigOf(v.selectedOptions ?? []), v] as const));
    if (!opts.length) {
      const keep = edit.variants[0];
      setEdit({ ...edit, options, variants: [{ id: keep?.id ?? "", title: "Default Title", selectedOptions: [], price: keep?.price ?? "0", compareAtPrice: keep?.compareAtPrice ?? null, sku: keep?.sku ?? "", inventoryQty: keep?.inventoryQty ?? null, barcode: keep?.barcode ?? "" }] });
      return;
    }
    let combos: SelOpt[][] = [[]];
    for (const o of opts) { const next: SelOpt[][] = []; for (const c of combos) for (const val of o.values) next.push([...c, { name: o.name, value: val }]); combos = next; }
    const variants: Variant[] = combos.slice(0, 100).map((so) => {
      const ex = prev.get(sigOf(so));
      return ex ? { ...ex, selectedOptions: so, title: so.map((x) => x.value).join(" / ") }
        : { id: "", title: so.map((x) => x.value).join(" / "), selectedOptions: so, price: "0", compareAtPrice: null, sku: "", inventoryQty: null, barcode: "" };
    });
    setEdit({ ...edit, options, variants });
  };
  const setOptName = (i: number, name: string) => { if (!edit) return; recompute((edit.options ?? []).map((o, k) => k === i ? { ...o, name } : o)); };
  const setOptValues = (i: number, csv: string) => { if (!edit) return; recompute((edit.options ?? []).map((o, k) => k === i ? { ...o, values: csv.split(",").map((v) => v.trim()).filter(Boolean) } : o)); };
  const addOption = () => { if (!edit) return; const os = (edit.options ?? []); if (os.length >= 3) return; recompute([...os, { name: os.length === 0 ? "Size" : "", position: os.length + 1, values: [] }]); };
  const delOption = (i: number) => { if (!edit) return; recompute((edit.options ?? []).filter((_, k) => k !== i)); };
  const setAllPrices = (val: string) => { if (!edit || !val) return; setEdit({ ...edit, variants: edit.variants.map((v) => ({ ...v, price: val })) }); };
  const delImg = (i: number) => { if (!edit) return; setEdit({ ...edit, images: edit.images.filter((_, k) => k !== i) }); };
  const moveImg = (i: number, dir: -1 | 1) => { if (!edit) return; const j = i + dir; if (j < 0 || j >= edit.images.length) return; const a = edit.images.slice(); [a[i], a[j]] = [a[j], a[i]]; setEdit({ ...edit, images: a }); };
  // v200 · kéo-thả đổi thứ tự ảnh (đồng bộ UI với Edit listing bên Etsy) — thả ảnh A vào vị trí B.
  const moveImgTo = (from: number, to: number) => { if (!edit || from === to) return; const a = edit.images.slice(); const [x] = a.splice(from, 1); a.splice(to, 0, x); setEdit({ ...edit, images: a }); };
  const addImg = async () => { if (!edit) return; const url = await askPrompt({ title: "Add image by URL", message: "Paste an image URL (https://...)", input: { placeholder: "https://…" } }); if (!url || !/^https?:\/\//i.test(url)) return; setEdit((e) => e ? { ...e, images: [...e.images, { id: "", src: url.trim(), altText: "", position: e.images.length + 1 }] } : e); };
  // v205 · nhận NHIỀU file 1 lần — upload lần lượt, ảnh nào xong nối ngay vào cuối lưới.
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
        if (j.ok && j.url) { setEdit((e) => e ? { ...e, images: [...e.images, { id: "", src: j.url, altText: "", position: e.images.length + 1 }] } : e); ok++; }
        else fail++;
      } catch { fail++; }
    }
    if (list.length > 1) flash(fail ? `✓ Uploaded ${ok}/${list.length} — ${fail} failed` : `✓ Uploaded ${ok} images`, fail === 0);
    else if (fail) flash("✗ Upload failed", false);
    setBusy(false);
  };

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 4px" }}>
      {/* Hero */}
      <div style={{ ...card, padding: "18px 22px", marginBottom: 14, display: "flex", alignItems: "center", gap: 14, background: "linear-gradient(90deg,#F3FBF6,#fff)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/marketplaces/shopify.png" alt="Shopify" width={42} height={42} style={{ width: 42, height: 42, objectFit: "contain", display: "block", flexShrink: 0 }} />
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

      {/* ── FILTERS ── hàng 1: tìm & lọc · hàng 2: kết quả + chọn. Tách 2 tầng cho khỏi rối. */}
      <div style={{ ...card, padding: "12px 14px", marginBottom: 12 }}>
        {/* Hàng 1: ô tìm kiếm full-width. Hàng 2: các bộ lọc tự xuống dòng. */}
        <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="Search title / handle / ID" style={{ ...fctl, width: "100%", maxWidth: "none", marginBottom: 8 }} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {showSellerFilter && (
            <select value={sellerFilter} onChange={(e) => { setSellerFilter(e.target.value); setStoreFilter(""); }} title="Seller" style={fsel(!!sellerFilter)}>
              <option value="">All sellers</option>{sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} title="Store" style={fsel(!!storeFilter)}>
            <option value="">All stores</option>{storesForFilter.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} title="Product type" style={fsel(!!typeFilter)}>
            <option value="">All types</option><option value="__none__">— No product type —</option>{typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} title="Category" style={fsel(!!categoryFilter)}>
            <option value="">All categories</option><option value="__none__">— No category —</option>{categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} title="Collection" style={fsel(!!collectionFilter)}>
            <option value="">All collections</option><option value="__none__">— Not in any collection —</option>{collectionOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} title="Shopify status" style={fsel(!!statusFilter)}>
            <option value="">All status</option>
            {(statusOptions.length ? statusOptions : ["ACTIVE", "DRAFT", "ARCHIVED"]).map((st) => (
              <option key={st} value={st}>{st.charAt(0) + st.slice(1).toLowerCase()}</option>
            ))}
          </select>
          <select value={aiFilter} onChange={(e) => setAiFilter(e.target.value as "" | "todo" | "done" | "unpushed")} title="AI Optimize status — pick 'Not optimized yet' so you never pay to rewrite the same listing twice" style={fsel(!!aiFilter, "#5B3FBF", "#C9B8F5", "#F8F6FF")}>
            <option value="">AI: all</option>
            <option value="todo">✦ Not optimized yet</option>
            <option value="done">✦ AI optimized</option>
            <option value="unpushed">✦ Optimized · not pushed</option>
          </select>
          <select value={feedFilter} onChange={(e) => setFeedFilter(e.target.value as "" | "todo" | "done")} title="Google Merchant feed copy — pick 'No feed copy yet' to see exactly which listings Export supplemental feed would skip" style={fsel(!!feedFilter, "#1F6F45", "#BFE3CD", "#F3FBF6")}>
            <option value="">Feed: all</option>
            <option value="todo">No feed copy yet</option>
            <option value="done">Feed copy ready</option>
          </select>
          {/* v127: lọc đúng những listing còn thiếu SKU / alt để chỉ chạy lại đúng chỗ đó,
              khỏi bắn cả 135 con qua vision lần nữa. */}
          <select value={prepFilter} onChange={(e) => setPrepFilter(e.target.value as "" | "sku" | "alt" | "done")} title="Google prep status — pick 'Missing image alt' to select only the listings that still need a vision run" style={fsel(!!prepFilter, "#1F6F45", "#BFE3CD", "#F3FBF6")}>
            <option value="">Prep: all</option>
            <option value="sku">Missing SKU</option>
            <option value="alt">Missing image alt</option>
            <option value="done">SKU + alt complete</option>
          </select>
          {/* v177: policy scan — HIGH bị chặn ở Push cho tới khi sửa sạch */}
          <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value as "" | "high" | "medium" | "clean" | "unchecked")} title="Trademark & policy scan result — run 'Scan trademark & policy risks' in More actions first" style={fsel(!!riskFilter, "#B42318", "#F3C9C9", "#FEF3F2")}>
            <option value="">Risk: all</option>
            <option value="high">⛔ High risk</option>
            <option value="medium">⚠ Medium</option>
            <option value="clean">✓ Clean</option>
            <option value="unchecked">Not scanned yet</option>
          </select>
          {/* Lọc listing có / không có video */}
          <select value={videoFilter} onChange={(e) => setVideoFilter(e.target.value as "" | "has" | "no")} title="Video attached to the listing" style={fsel(!!videoFilter, "#4338CA", "#C7CFF5", "#F1F3FF")}>
            <option value="">Video: all</option>
            <option value="has">Has video</option>
            <option value="no">No video</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--line)" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>{filtered.length}</span>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{anyFilter ? `of ${rows.length} products match` : "products"}</span>
          {/* v184: đang xem đúng 1 listing nhảy từ Manage Products · Etsy qua — bấm × để xem lại tất cả */}
          {pidFilter && (
            <button onClick={() => setPidFilter("")} title="Showing only the listing linked from Manage Products · Etsy — click to show all"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid #DCE6FB", background: "#F8FAFF", color: "var(--blue)", borderRadius: 999, padding: "3px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>🔗 Linked listing ×</button>
          )}
          {anyFilter && <button onClick={clearFilters} style={{ ...linkBtn("var(--blue)"), fontSize: 12, whiteSpace: "nowrap", flex: "0 0 auto" }}>Clear filters</button>}
          <div style={{ flex: 1 }} />
          {sel.size > 0 && <span style={{ fontSize: 12.5, fontWeight: 700, color: SHOP_GREEN }}>{sel.size} selected</span>}
          <button onClick={() => setSel(new Set(filtered.map((r) => r.id)))} disabled={!filtered.length} title="Select every product matching the filters above — not just this page" style={{ ...ghost, padding: "7px 12px", fontSize: 12.5, opacity: filtered.length ? 1 : .5 }}>Select all {filtered.length}</button>
          {sel.size > 0 && <button onClick={() => setSel(new Set())} style={{ ...ghost, padding: "7px 12px", fontSize: 12.5 }}>Clear selection</button>}
        </div>
      </div>

      {/* ── ACTION BAR ── xếp theo đúng thứ tự làm việc: ① viết nội dung → ② đẩy lên Shopify → ③ sửa khác */}
      {sel.size > 0 && (
        <div style={{ ...card, padding: "10px 12px", marginBottom: 12, display: "flex", gap: 6, flexWrap: "nowrap", alignItems: "center", background: "#F3FBF6", borderColor: "#CDEFD8" }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: SHOP_GREEN, whiteSpace: "nowrap", flexShrink: 0 }}>{sel.size} selected</span>

          {canEdit && (
            <span style={grp}>
              {/* Ô này là NGUỒN DUY NHẤT cho mọi hành động AI của trang: AI Optimize, feed copy, alt text.
                  Model nào đọc được ảnh thì có dấu 👁 — alt text chỉ dùng được model có dấu đó. */}
              <select value={aiModel} onChange={(e) => chooseModel(e.target.value)} title="AI model for every AI action on this page (Optimize, feed copy, image alt). 👁 = can read images, required for image alt text. Avoid ':free' models, they get rate-limited." style={{ ...fctl, maxWidth: 145 }}>
                <option value="">Model: Default</option>{aiModels.map((m) => <option key={m.id} value={m.id}>{visionIds.has(m.id) ? "👁 " : ""}{m.name}</option>)}
              </select>
              {selDone > 0 && (
                <button disabled={busy} title="Deselect listings AI has already rewritten — don't pay to write the same content twice" onClick={() => setSel(new Set(rows.filter((r) => sel.has(r.id) && !r.aiAt).map((r) => r.id)))} style={{ ...ghost, padding: "8px 11px", fontSize: 12.5, borderColor: "#D7CCF5", color: "#5B3FBF" }}>Skip {selDone} done</button>
              )}
              <button disabled={busy} onClick={() => doAiOptimize()} style={{ ...pill("linear-gradient(135deg,#7C5CFF,#6D48C9)", "#fff"), padding: "8px 11px", opacity: busy ? .6 : 1 }}>✦ AI Optimize{selTodo !== sel.size ? ` (${sel.size})` : ""}</button>
            </span>
          )}

          {canEdit && (
            <span style={grp}>
              <button disabled={busy || !selDirty} title={selDirty ? `Push ${selDirty} edited listing(s) to Shopify` : "Nothing edited in this selection — run AI Optimize or Edit first"} onClick={() => {
                const ids = rows.filter((r) => sel.has(r.id) && r.dirty).map((r) => r.id);
                if (!ids.length) return flash("✗ No edited (unpushed) products in selection", false);
                doPush(ids);
              }} style={{ ...pill("linear-gradient(135deg,#B7791F,#96610F)", "#fff"), padding: "8px 11px", opacity: busy || !selDirty ? .45 : 1 }}>⬆ Push to Shopify{selDirty ? ` (${selDirty})` : ""}</button>
              {/* v286 · Stage sang Manage Products Amazon (như Etsy → Shopify). */}
              <button disabled={busy || !sel.size} title="Stage the selected listings into Manage Products Amazon (like Etsy → Shopify). Already-pushed listings are skipped. Nothing is written to Shopify." onClick={() => pushToAmazon(Array.from(sel))}
                style={{ ...pill("#FF9900", "#111"), padding: "8px 11px", opacity: busy || !sel.size ? .45 : 1 }}><AmazonLogo size={15} color="#111" /> Push to Amazon{sel.size ? ` (${sel.size})` : ""}</button>
              {/* v287 · Run pipeline: AI → Push → Google prep → Feed → Active → Amazon, một nút.
                  v289 · Update Template / Export Pinterest dọn vào More actions. */}
              <button disabled={busy || !sel.size} title="Run the whole finishing chain on the selection: AI Optimize → Push to Shopify → Google prep (SKU + fields + alt) → Feed copy → Set Active → Push to Amazon + AI Amazon copy. Steps are configurable; already-done items are skipped." onClick={() => setPipeOpen(true)}
                style={{ ...pill("linear-gradient(135deg,#1F6F45,#0E4429)", "#fff"), padding: "8px 11px", opacity: busy || !sel.size ? .45 : 1 }}>⚡ Run pipeline{sel.size ? ` (${sel.size})` : ""}</button>
            </span>
          )}

          {canEdit && (
            <span style={grp}>
              <div style={{ position: "relative" }}>
                <button disabled={busy} onClick={() => setActionsOpen((v) => !v)} style={{ ...ghost, padding: "8px 12px", fontSize: 12.5 }}>More actions ▾</button>
                {/* v118: 4 cột ngang → 1 cột DỌC. Bốn cột rộng hơn màn hình nên tràn sang phải,
                    phải kéo ngang mới thấy hết. Neo right:0 để menu mở về bên trái, không tràn mép. */}
                {actionsOpen && (
                  // v179: 1 cột hẹp phải cuộn → PANEL RỘNG 2 CỘT hiện trọn mọi lệnh, không cuộn,
                  // không bị viewport cắt (maxWidth theo màn hình, tự co về 1 cột khi quá hẹp).
                  <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 30, width: "min(680px, calc(100vw - 48px))", background: "#fff", border: "1px solid var(--line)", borderRadius: 14, boxShadow: "0 12px 36px rgba(0,0,0,.14)", padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "4px 16px" }} onMouseLeave={() => setActionsOpen(false)}>
                    {ACTION_GROUPS.map((g) => (
                      <div key={g.title} style={{ padding: 2, minWidth: 0 }}>
                        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .6, textTransform: "uppercase", color: "var(--muted)", padding: "6px 8px 4px", borderBottom: "1px solid var(--line)", marginBottom: 3 }}>{g.title}</div>
                        {g.items.map((a) => (
                          <button key={a.key} disabled={busy} onClick={() => runAction(a.key)} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", fontSize: 13, lineHeight: 1.35, border: "none", background: "none", borderRadius: 8, cursor: "pointer", color: a.danger ? "var(--red)" : "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} onMouseEnter={(e) => (e.currentTarget.style.background = "#F3F5F8")} onMouseLeave={(e) => (e.currentTarget.style.background = "none")} title={a.label}>{a.label}</button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </span>
          )}

        </div>
      )}

      {/* Thanh tiến độ — chạy theo lô nên phải thấy được đang tới đâu */}
      {prog && (
        <div style={{ ...card, padding: "12px 16px", marginBottom: 12, borderColor: "#D7CCF5", background: "#F8F6FF" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 700, color: "#5B3FBF", marginBottom: 8 }}>
            <span style={{ display: "inline-block", width: 13, height: 13, border: "2px solid #C9B8F5", borderTopColor: "#7C5CFF", borderRadius: "50%", animation: "fusionSpin .7s linear infinite" }} />
            <span>{prog.label}… {prog.done}/{prog.total}</span>
            <div style={{ flex: 1 }} />
            {prog.fail > 0 && <span style={{ color: "#C0392B", fontWeight: 700 }}>{prog.fail} failed</span>}
            <span style={{ color: "var(--muted)", fontWeight: 600 }}>{Math.round((prog.done / Math.max(1, prog.total)) * 100)}%</span>
          </div>
          <div style={{ height: 7, borderRadius: 999, background: "#E7E0FB", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.round((prog.done / Math.max(1, prog.total)) * 100)}%`, background: "linear-gradient(90deg,#7C5CFF,#6D48C9)", borderRadius: 999, transition: "width .3s ease" }} />
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 7 }}>Running in small batches — keep this tab open until it finishes.</div>
          <style>{"@keyframes fusionSpin{to{transform:rotate(360deg)}}"}</style>
        </div>
      )}

      {msg && <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 12, background: msg.ok ? "#EAF7F0" : "#FDECEC", color: msg.ok ? "#158A57" : "#C0392B", border: `1px solid ${msg.ok ? "#C7EAD8" : "#F5CFCF"}` }}>{msg.text}</div>}

      {/* Sản phẩm AI viết hỏng + LÝ DO THẬT — không đoán mò nữa. Retry chỉ chạy lại đúng mấy con này. */}
      {/* v187: khung này dùng chung cho 2 loại nội dung — LỖI thật (đỏ) và KẾT QUẢ policy audit (vàng).
          Nhận diện: doPolicyAi ghi mọi finding với tiền tố "HIGH — " / "MEDIUM — ". Nếu TẤT CẢ các dòng
          đều là finding ⇒ đây là kết quả audit, KHÔNG phải lỗi: đổi tiêu đề, đổi nút (Re-check thay vì
          Retry chạy nhầm AI Optimize), bỏ đoạn hướng dẫn 429/402. */}
      {fails.length > 0 && !prog && (() => {
        const isPolicy = fails.every((f) => /^(HIGH|MEDIUM|LOW) — /.test(f.error));
        const hasHigh = fails.some((f) => f.error.startsWith("HIGH"));
        const bd = isPolicy && !hasHigh ? "#F0D897" : "#F5CFCF";
        const bg = isPolicy && !hasHigh ? "#FFFDF3" : "#FFF8F8";
        const fg = isPolicy && !hasHigh ? "#8A5A00" : "#C0392B";
        return (
        <div style={{ ...card, padding: "12px 16px", marginBottom: 12, borderColor: bd, background: bg }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <b style={{ fontSize: 13, color: fg }}>
              {isPolicy
                ? `Policy audit — ${fails.length} listing(s) with findings (the check itself succeeded)`
                : `${fails.length} listing(s) failed after 3 attempts`}
            </b>
            <div style={{ flex: 1 }} />
            {canEdit && (isPolicy
              ? <button disabled={busy} onClick={() => doPolicyAi(fails.map((f) => f.id))} style={{ ...pill("linear-gradient(135deg,#B42318,#8E1A12)", "#fff"), padding: "7px 13px", fontSize: 12.5, opacity: busy ? .6 : 1 }}>↻ Re-check policy</button>
              : <button disabled={busy} onClick={() => doAiOptimize(fails.map((f) => f.id))} style={{ ...pill("linear-gradient(135deg,#7C5CFF,#6D48C9)", "#fff"), padding: "7px 13px", fontSize: 12.5, opacity: busy ? .6 : 1 }}>↻ Retry failed</button>)}
            <button onClick={() => setFails([])} style={{ ...ghost, padding: "7px 12px", fontSize: 12.5 }}>Dismiss</button>
          </div>
          <div style={{ maxHeight: 210, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            {fails.map((f) => (
              <div key={f.id} style={{ fontSize: 12, lineHeight: 1.45, borderTop: `1px solid ${isPolicy && !hasHigh ? "#F0E4C0" : "#F5DEDE"}`, paddingTop: 6 }}>
                <div style={{ fontWeight: 700 }}>{f.title.slice(0, 70)}</div>
                <div style={{ color: f.error.startsWith("HIGH") ? "#C0392B" : isPolicy ? "#8A5A00" : "#C0392B", wordBreak: "break-word" }}>{f.error}</div>
              </div>
            ))}
          </div>
          {isPolicy ? (
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
              <b>MEDIUM</b> = warning only, Push is NOT blocked — apply the fix via Edit if you agree with it.
              {" "}<b>HIGH</b> = Push is blocked until you apply the fixes and re-run the check.
              {" "}Listings not shown here came back <b>clean</b>.
            </div>
          ) : (
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
              <b>429 / rate limit</b> → the AI model is throttling you: pick a paid model instead of a <code>:free</code> one, or retry in a few minutes.
              {" "}<b>402 / credit</b> → top up OpenRouter. <b>timeout</b> → the model is too slow, switch to a faster one.
              {" "}<b>server ngắt giữa chừng</b> → not an AI error: the request ran past its time limit and was killed. Select fewer listings and press Retry failed.
            </div>
          )}
        </div>
        );
      })()}

      {/* Table */}
      <div style={{ ...card, overflow: "hidden" }}>
        {/* v182: tableLayout fixed — bảng LUÔN đúng 100% bề ngang, cột Actions không bao giờ bị cắt khuất.
            Cột Title là cột co giãn (không đặt width), các cột còn lại width cố định. */}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, tableLayout: "fixed" }}>
          <thead>
            <tr style={{ background: "#FAFBFC", color: "var(--muted)", fontSize: 11.5, textTransform: "uppercase" }}>
              {/* v194: cân lại cột — Title là cột auto ăn phần còn lại (to nhất), cột phụ chuyển sang %
                  nhỏ để không chèn ép Title như v182 (title từng bị bóp mỗi từ một dòng). */}
              <th style={{ padding: "10px 12px", textAlign: "left", width: 34 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} /></th>
              <th style={{ padding: "10px 6px", textAlign: "left", width: 54 }}>Image</th>
              <th style={{ padding: "10px 6px", textAlign: "left", width: 50 }} title="Listing đã gắn video chưa">Video</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Title</th>
              <th style={{ padding: "10px 8px", textAlign: "left", width: "11%" }}>Store / Seller</th>
              <th style={{ padding: "10px 8px", textAlign: "left", width: "9%" }}>Type / Category</th>
              <th style={{ padding: "10px 8px", textAlign: "left", width: "8%" }}>Collections</th>
              <th style={{ padding: "10px 8px", textAlign: "left", width: "9%" }}>Template</th>
              <th style={{ padding: "10px 8px", textAlign: "center", width: 175 }} title="What has already been run on this listing — line 1 AI Optimize, line 2 Merchant Center feed copy, line 3 variant SKUs and image alt text">Pipeline</th>
              <th style={{ padding: "10px 8px", textAlign: "right", width: 84 }}>Price</th>
              <th style={{ padding: "10px 8px", textAlign: "center", width: 70 }}>Status</th>
              <th style={{ padding: "10px 12px", textAlign: "right", width: 84 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={12} style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>Loading…</td></tr>}
            {!loading && paged.length === 0 && <tr><td colSpan={12} style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>No products. Chọn store rồi bấm <b>Sync from Shopify</b>.</td></tr>}
            {paged.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: "10px 12px" }}><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td style={{ padding: "8px 6px" }}><ThumbZoom src={r.mainImage} images={r.imageUrls} alt={r.title} size={42} radius={8} border /></td>
                <td style={{ padding: "8px 6px" }}>
                  {r.videoThumbUrl ? (
                    <div title={`Video #${r.videoCode}${r.videoPushed ? " · đã lên Shopify" : " · chưa đẩy lên media"}`} style={{ position: "relative", width: 42, height: 42 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.videoThumbUrl} alt="" style={{ width: 42, height: 42, objectFit: "cover", borderRadius: 8, border: r.videoPushed ? "1px solid var(--line)" : "2px solid #E0A93B", display: "block", background: "#0B1220" }} />
                      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                        <span style={{ width: 18, height: 18, borderRadius: 999, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z" /></svg>
                        </span>
                      </span>
                    </div>
                  ) : <span style={{ color: "var(--faint)", fontSize: 15 }}>–</span>}
                </td>
                <td style={{ padding: "8px" }}>
                  {/* v203 · click thẳng title để mở Edit (giống Shopify admin), bỏ nút Edit riêng */}
                  <div onClick={() => canEdit && openEdit(r.id)} title={canEdit ? "Click to edit" : undefined}
                    style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0, cursor: canEdit ? "pointer" : "default", color: canEdit ? "var(--blue)" : "inherit" }}>{r.title.slice(0, 70)}{r.dirty && <span title="Có chỉnh sửa chưa Push" style={{ fontSize: 10, fontWeight: 800, color: "#B7791F", background: "#FFF6E6", padding: "1px 6px", borderRadius: 999 }}>EDITED</span>}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.variantCount} variants · {r.imageCount} images{r.totalInventory != null ? ` · inv ${r.totalInventory}` : ""}{r.optionsSummary ? ` · ${r.optionsSummary}` : ""}</div>
                  {/* v276 · Product ID để dán nhanh vào Video Library (attach listing bằng ID, khỏi search tên). Click = copy. */}
                  <div onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(r.id); }} title="Click to copy product ID"
                    style={{ fontSize: 10.5, color: "var(--muted)", cursor: "pointer", fontFamily: "monospace", marginTop: 2, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <span style={{ opacity: .55 }}>ID</span> {r.id}
                  </div>
                </td>
                <td style={{ padding: "8px", fontSize: 12 }}>{r.storeName ?? "—"}<div style={{ color: "var(--muted)" }}>{r.sellerName ?? "—"}</div>
                  {/* v203 · chip Etsy giờ là LINK — click mở listing gốc bên Manage Products · Etsy (thay nút Etsy ở Actions) */}
                  {r.etsyListing && (r.etsyListing.store || r.etsyListing.seller) && (
                    <a href={`/etsy-products?pid=${encodeURIComponent(r.etsyListing.id)}`} target="_blank" rel="noreferrer"
                      title={`View source in Manage Products · Etsy — ${r.etsyListing.store || "—"} · ${r.etsyListing.title}`}
                      style={{ marginTop: 3, fontSize: 10.5, fontWeight: 700, color: "#B45309", background: "#FEF3E2", border: "1px solid #F5D9A8", borderRadius: 6, padding: "2px 6px", display: "block", wordBreak: "break-word", lineHeight: 1.35, textDecoration: "none", cursor: "pointer" }}>
                      ↗ Etsy: {r.etsyListing.store || r.etsyListing.seller || "—"}
                    </a>
                  )}
                </td>
                <td style={{ padding: "8px", fontSize: 12, maxWidth: 150 }}>
                  <div title={r.productType || ""} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.productType || "—"}</div>
                  <div title={r.categoryName || ""} style={{ color: "var(--muted)", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.categoryName || "—"}</div>
                </td>
                <td style={{ padding: "8px", fontSize: 12, maxWidth: 160 }}>
                  {(r.collectionTitles ?? []).length === 0 ? <span style={{ color: "var(--muted)" }}>—</span> : (
                    <span title={r.collectionTitles.join(", ")} style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
                      {r.collectionTitles.slice(0, 2).map((c) => <span key={c} style={{ fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 999, background: "#EEF3FF", color: "#3A5BC7" }}>{c.length > 18 ? c.slice(0, 18) + "…" : c}</span>)}
                      {r.collectionTitles.length > 2 && <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>+{r.collectionTitles.length - 2}</span>}
                    </span>
                  )}
                </td>
                <td style={{ padding: "8px", fontSize: 12, maxWidth: 150 }}>
                  {r.templateName ? (
                    <span title={r.templatePinned ? "Pinned manually — AI Optimize always uses this template" : "Auto-matched by Product type — pin it with More actions → Set AI template"} style={{ display: "inline-flex", alignItems: "center", gap: 5, maxWidth: "100%" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: r.templatePinned ? "#F1EBFF" : "#F1F1F4", color: r.templatePinned ? "#5B3FBF" : "#66788E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.templatePinned ? "📌 " : "≈ "}{r.templateName.length > 16 ? r.templateName.slice(0, 16) + "…" : r.templateName}
                      </span>
                      {!r.templateHasFacts && <span title="This template has no Product info / Product Details / Shipping info filled in — AI will only write the Description" style={{ color: "#B7791F", fontWeight: 800 }}>⚠</span>}
                    </span>
                  ) : <span title="No template matched — AI Optimize writes the Description only (no 3 tabs)" style={{ color: "var(--muted)" }}>—</span>}
                </td>
                {/* AI: đã viết lại chưa + cách đây bao lâu. Chấm cam = đã viết nhưng chưa Push lên Shopify. */}
                <td style={{ padding: "8px", textAlign: "center" }}>
                  {r.aiAt ? (
                    <span title={`AI Optimize last run ${new Date(r.aiAt).toLocaleString()}${r.dirty ? " — not pushed to Shopify yet" : ""}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#F1EBFF", color: "#5B3FBF" }}>
                      ✦ {ago(r.aiAt)}{r.dirty && <span style={{ color: "#B7791F" }}>●</span>}
                    </span>
                  ) : (
                    <span title="Never optimized — select it and run ✦ AI Optimize" style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#F1F1F4", color: "#8794A5" }}>not yet</span>
                  )}
                  {/* v119: dòng 2 = feed Merchant Center. Xanh lá = đủ điều kiện Export, vàng = có nhưng cụt. */}
                  <div style={{ marginTop: 3 }}>
                    {feedOk(r) ? (
                      <span title={`Feed copy written ${new Date(r.feedAt as string).toLocaleString()} — title ${r.feedTitleLen} chars, description ${r.feedDescLen} chars`} style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: "#E9F7EF", color: "#1F6F45" }}>feed {r.feedDescLen}</span>
                    ) : r.feedAt ? (
                      <span title={`Feed copy is too short to export — title ${r.feedTitleLen} chars, description ${r.feedDescLen} chars, needs 600+`} style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: "#FEF6E7", color: "#B7791F" }}>feed {r.feedDescLen}</span>
                    ) : (
                      <span title="No feed copy — Export supplemental feed skips this listing" style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: "#F1F1F4", color: "#8794A5" }}>no feed</span>
                    )}
                    {/* v286: đã đẩy sang Manage Products Amazon. */}
                    {r.amz && (
                      <span title="Pushed to Manage Products Amazon — finish the Amazon copy there" style={{ fontSize: 10.5, fontWeight: 800, padding: "1px 7px", borderRadius: 999, background: "#FFF0DB", color: "#B5661A", marginLeft: 4 }}>AMZ</span>
                    )}
                    {/* v179c: chip policy audit — hiện CẢ 3 trạng thái để nhìn phát biết đã check hay chưa.
                        Không có chip nào = CHƯA audit. */}
                    {r.policyRisk === "high" && (
                      <span onClick={() => setRiskView(r)} title="Click to view the full policy audit report" style={{ marginLeft: 4, fontSize: 10.5, fontWeight: 800, padding: "1px 7px", borderRadius: 999, background: "#FEE4E2", color: "#B42318", cursor: "pointer" }}>⛔ risk</span>
                    )}
                    {r.policyRisk === "medium" && (
                      <span onClick={() => setRiskView(r)} title="Click to view the full policy audit report" style={{ marginLeft: 4, fontSize: 10.5, fontWeight: 800, padding: "1px 7px", borderRadius: 999, background: "#FEF6E7", color: "#B7791F", cursor: "pointer" }}>⚠ risk</span>
                    )}
                    {r.policyRisk === "clean" && (
                      <span onClick={() => setRiskView(r)} title="Click to view the full policy audit report" style={{ marginLeft: 4, fontSize: 10.5, fontWeight: 800, padding: "1px 7px", borderRadius: 999, background: "#E9F7EF", color: "#1F6F45", cursor: "pointer" }}>✓ policy</span>
                    )}
                  </div>
                  {/* v127: dòng 3 = 2 việc còn lại của google_prep. Đếm THẬT từ variants[].sku và
                      images[].altText đã ghi ngược về DB, nên không cần Sync mới thấy đúng.
                      Xanh = đủ, vàng = làm dở, xám = chưa chạy. */}
                  <div style={{ marginTop: 3, display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap" }}>
                    <span title={r.skuTotal === 0 ? "No variants" : r.skuDone === r.skuTotal ? `All ${r.skuTotal} variant(s) have a SKU` : `${r.skuTotal - r.skuDone} variant(s) still have no SKU — run Prepare for Google feed`}
                      style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999, ...chipTone(r.skuDone, r.skuTotal) }}>sku {r.skuDone}/{r.skuTotal}</span>
                    <span title={r.altTotal === 0 ? "No images" : r.altDone === r.altTotal ? `All ${r.altTotal} image(s) have alt text` : `${r.altTotal - r.altDone} image(s) still have no alt text — run Prepare for Google feed with a vision model`}
                      style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999, ...chipTone(r.altDone, r.altTotal) }}>alt {r.altDone}/{r.altTotal}</span>
                    {/* v141: đã tự đặt Custom options chưa. Xanh = bộ riêng của listing này,
                        xám = còn ăn theo template (Push template fields vẫn ghi đè được). */}
                    <span title={r.persOwn ? `${r.persCount} custom option field(s) set on this listing` : r.persCount ? `Following the template — ${r.persCount} field(s)` : "No custom options"}
                      style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999, ...(r.persOwn ? { background: "#E9F7EF", color: "#1F6F45" } : { background: "#F1F1F4", color: "#8794A5" }) }}>opt {r.persCount}</span>
                  </div>
                </td>
                <td style={{ padding: "8px", textAlign: "right", whiteSpace: "nowrap", fontSize: 12 }}>{r.minPrice != null && r.maxPrice != null && r.minPrice !== r.maxPrice ? `${money(r.minPrice)}–${money(r.maxPrice)}` : money(r.minPrice)}</td>
                <td style={{ padding: "8px", textAlign: "center" }}>{statusBadge(r.status)}</td>
                {/* v203 · Actions gọn như Shopify admin: 👁 = xem trên storefront · Push (khi có sửa).
                    Edit chuyển sang click title · Etsy chuyển sang click chip nguồn ở cột Store/Seller. */}
                <td style={{ padding: "8px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                  {r.onlineStoreUrl && <a href={r.onlineStoreUrl} target="_blank" rel="noreferrer" title="View on Shopify storefront" style={{ ...linkBtn(SHOP_GREEN), textDecoration: "none", marginRight: 12, fontSize: 17 }}>👁</a>}
                  {canEdit && r.dirty && <button onClick={() => doPush([r.id])} title="Push edits to Shopify" style={linkBtn("#B7791F")}>Push</button>}
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

      {/* v202 · Lightbox xem ảnh to — click ảnh trong Edit modal; click nền / Esc để đóng */}
      {imgZoom && (
        <div onClick={() => setImgZoom(null)}
          style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(0,0,0,.8)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out", padding: 24 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imgZoom} alt="" style={{ maxWidth: "min(94vw, 1100px)", maxHeight: "90vh", objectFit: "contain", borderRadius: 10, boxShadow: "0 20px 60px rgba(0,0,0,.5)" }} />
        </div>
      )}

      {/* v191 · POLICY AUDIT REPORT MODAL — click chip ⛔/⚠/✓ trong bảng để mở */}
      {riskView && (() => {
        const rv = riskView;
        const hits = rv.policyHits ?? [];
        const tone = rv.policyRisk === "high" ? { bg: "#FEE4E2", fg: "#B42318", label: isAdmin ? "HIGH — confirm to Push (admin override)" : "HIGH — needs an admin to Push" }
          : rv.policyRisk === "medium" ? { bg: "#FEF6E7", fg: "#B7791F", label: "MEDIUM — warning only, Push allowed" }
          : { bg: "#E9F7EF", fg: "#1F6F45", label: "CLEAN — no issues found" };
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setRiskView(null)}>
            <div style={{ ...card, width: 640, maxWidth: "96vw", maxHeight: "88vh", overflowY: "auto", padding: 22 }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontWeight: 800, fontSize: 16, flex: 1 }}>AI policy audit</div>
                <button onClick={() => setRiskView(null)} style={{ ...ghost, padding: "6px 11px", fontSize: 12.5 }}>✕</button>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 8 }}>{rv.title}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontWeight: 800, padding: "3px 12px", borderRadius: 999, background: tone.bg, color: tone.fg }}>{tone.label}</span>
                {rv.policyCheckedAt && <span style={{ fontSize: 12, color: "var(--muted)" }}>checked {new Date(rv.policyCheckedAt).toLocaleString()}</span>}
              </div>
              {hits.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
                  {hits.map((h, i) => (
                    <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "10px 13px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 800, padding: "1px 8px", borderRadius: 999, ...(h.severity === "high" ? { background: "#FEE4E2", color: "#B42318" } : { background: "#FEF6E7", color: "#B7791F" }) }}>{String(h.severity).toUpperCase()}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", background: "#F1F1F4", padding: "1px 8px", borderRadius: 999 }}>{h.field}</span>
                      </div>
                      <div style={{ fontSize: 13, lineHeight: 1.5 }}>{h.term}</div>
                      {h.fix && <div style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 6, padding: "7px 10px", borderRadius: 9, background: "#EAF7F0", color: "#14683F" }}><b>Fix:</b> {h.fix}</div>}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 14 }}>No trademark or policy issues were found in this listing (images, title, tags, description, SEO and feed fields).</div>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
                {canEdit && <button disabled={busy} onClick={() => { setRiskView(null); openEdit(rv.id); }} style={{ ...ghost, padding: "8px 14px", fontSize: 12.5 }}>Edit listing</button>}
                {canEdit && <button disabled={busy} onClick={() => { setRiskView(null); doPolicyAi([rv.id]); }} style={{ ...pill("linear-gradient(135deg,#B42318,#8E1A12)", "#fff"), padding: "8px 14px", fontSize: 12.5, opacity: busy ? .6 : 1 }}>↻ Re-check policy</button>}
              </div>
            </div>
          </div>
        );
      })()}

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
                <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 20 }} className="m-stack-sm">
                  {/* LEFT: images + status */}
                  <div>
                    <label style={lab}>Status</label>
                    <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })} style={{ ...ctl, width: "100%", marginBottom: 14 }}>
                      {["ACTIVE", "DRAFT", "ARCHIVED"].map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {/* v200 · UI ảnh giống Edit listing bên Etsy: thumbnail lớn xếp ngang, KÉO-THẢ đổi thứ tự,
                        × ở góc, ô "Add photo" ngay trong lưới. Ảnh đầu là ảnh chính (feed GMC). */}
                    <label style={lab}>Images ({edit.images.length}) · drag to reorder · the first photo is the main image</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {edit.images.map((im, i) => (
                        <div key={i} draggable
                          onDragStart={() => setDragImg(i)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => { if (dragImg !== null) moveImgTo(dragImg, i); setDragImg(null); }}
                          onDragEnd={() => setDragImg(null)}
                          style={{ position: "relative", width: 94, height: 94, borderRadius: 10, overflow: "hidden", background: "#fff", cursor: "grab", opacity: dragImg === i ? .45 : 1, border: dragImg === i ? `2px dashed ${SHOP_GREEN}` : "1px solid var(--line)" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={im.src} alt="" draggable={false} onClick={() => setImgZoom(im.src)} title="Click to view large · drag to reorder" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", cursor: "zoom-in" }} />
                          {i === 0 && <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, fontSize: 9.5, fontWeight: 800, background: "rgba(0,0,0,.62)", color: "#fff", padding: "2px 0", textAlign: "center", letterSpacing: .2, pointerEvents: "none" }}>MAIN</span>}
                          {!im.id && <span style={{ position: "absolute", top: 3, left: 3, fontSize: 9, fontWeight: 800, background: "#B7791F", color: "#fff", padding: "1px 5px", borderRadius: 6, pointerEvents: "none" }}>NEW</span>}
                          <button title="Remove photo" onClick={(e) => { e.stopPropagation(); delImg(i); }}
                            style={{ position: "absolute", top: 3, right: 3, border: "none", background: "rgba(0,0,0,.6)", color: "#fff", borderRadius: 6, width: 20, height: 20, fontSize: 12, lineHeight: "20px", padding: 0, cursor: "pointer" }}>×</button>
                        </div>
                      ))}
                      <label style={{ width: 94, height: 94, borderRadius: 10, border: `1.5px dashed ${SHOP_GREEN}88`, background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, color: SHOP_GREEN, fontSize: 11, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? .5 : 1 }}>
                        <span style={{ fontSize: 21, lineHeight: 1 }}>+</span>{busy ? "Uploading…" : "Add photos"}
                        <input type="file" accept="image/*" multiple hidden disabled={busy} onChange={(e) => { uploadImg(e.target.files); e.currentTarget.value = ""; }} />
                      </label>
                    </div>
                    <button onClick={addImg} disabled={busy} style={{ ...linkBtn("var(--blue)"), fontSize: 12, marginTop: 10 }}>+ Add by URL</button>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>Store: {edit.storeName} · handle: {edit.handle}</div>
                    {/* v224 · Video from Video Library — paste #Video ID to attach (auto-pushes to media). */}
                    <div style={{ border: "1px solid #C9D8F0", borderRadius: 10, padding: "12px 14px", marginTop: 14, background: "#F7FAFF" }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: "#2952B3", marginBottom: 8 }}>Video</div>
                      {edit.videoCode ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {edit.videoThumbUrl && <img src={edit.videoThumbUrl} alt="" width={40} height={40} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} />}
                          <span style={{ fontWeight: 800 }}>#{edit.videoCode}</span>
                          <span style={{ flex: 1, minWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, color: "var(--muted)" }}>{edit.videoTitle}</span>
                          <button disabled={busy} onClick={() => setVideo(true)} style={{ ...ghost, padding: "6px 12px", fontSize: 12.5, color: "#B42318" }}>Remove</button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <input value={vidCode} onChange={(e) => setVidCode(e.target.value.replace(/[^0-9]/g, ""))} placeholder="#Video ID" style={{ ...ctl, width: 110, padding: "8px 11px" }} />
                          <button disabled={busy || !vidCode} onClick={() => setVideo(false)} style={{ ...pill("#2952B3", "#fff"), padding: "7px 14px", fontSize: 12.5, opacity: (busy || !vidCode) ? .6 : 1 }}>Attach</button>
                        </div>
                      )}
                    </div>
                    {/* SEO — đây chính là dòng Google hiển thị. Bỏ trống thì Shopify tự lấy title + đoạn đầu mô tả,
                        thường bị cụt và không có từ khoá. Có preview thật để thấy trước khi Save. */}
                    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px", marginBottom: 14, background: "#FAFBFD" }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: "#334155", marginBottom: 8 }}>Search engine listing (Google)</div>
                      {/* Preview y như kết quả tìm kiếm */}
                      <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
                        <div style={{ fontSize: 11.5, color: "#4d5156", marginBottom: 2 }}>
                          {(edit.onlineStoreUrl ?? "").replace(/^https?:\/\//, "").split("/")[0] || "your-store.com"} <span style={{ color: "#70757a" }}>› products › {edit.handle ?? ""}</span>
                        </div>
                        <div style={{ fontSize: 16, color: "#1a0dab", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {(edit.seoTitle ?? "").trim() || edit.title || "Page title"}
                        </div>
                        <div style={{ fontSize: 12.5, color: "#4d5156", lineHeight: 1.45, marginTop: 2 }}>
                          {((edit.seoDescription ?? "").trim() || (edit.bodyHtml ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "Meta description shown under the link on Google.").slice(0, 160)}
                          {(((edit.seoDescription ?? "").trim() || (edit.bodyHtml ?? "")).length > 160) && "…"}
                        </div>
                      </div>
                      <label style={lab}>Page title <span style={{ fontWeight: 700, color: (edit.seoTitle ?? "").length > 60 ? "var(--red)" : "var(--muted)" }}>({(edit.seoTitle ?? "").length}/60)</span></label>
                      <input value={edit.seoTitle ?? ""} onChange={(e) => setEdit({ ...edit, seoTitle: e.target.value })} maxLength={70} placeholder="Blue link on Google — keyword first, ≤60 chars" style={{ ...ctl, width: "100%", marginBottom: 10, borderColor: (edit.seoTitle ?? "").length > 60 ? "#F3C9C9" : "var(--line)" }} />
                      <label style={lab}>Meta description <span style={{ fontWeight: 700, color: (edit.seoDescription ?? "").length > 155 ? "var(--red)" : "var(--muted)" }}>({(edit.seoDescription ?? "").length}/155)</span></label>
                      <textarea value={edit.seoDescription ?? ""} onChange={(e) => setEdit({ ...edit, seoDescription: e.target.value })} maxLength={320} rows={3} placeholder="One persuasive sentence under the link — keyword + benefit + call to action" style={{ ...ctl, width: "100%", resize: "vertical", borderColor: (edit.seoDescription ?? "").length > 155 ? "#F3C9C9" : "var(--line)" }} />
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>Leave these blank and Shopify falls back to the product title plus a chopped-off slice of the description — worse click-through on Google and Shopping ads.</div>
                    </div>
                    {/* v119: 2 field feed Merchant Center — trước đây viết xong không có chỗ nào xem được.
                        Nút Save feed copy đi route riêng: không set dirty, không Push lên Shopify. */}
                    <div style={{ border: "1px solid #C9B8F5", borderRadius: 10, padding: "12px 14px", marginBottom: 14, background: "#FBFAFF" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 800, color: "#4B3A8F" }}>Google Merchant feed (supplemental)</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{edit.feedAt ? `written ${ago(edit.feedAt)}` : "never generated"}</div>
                      </div>
                      <label style={lab}>Feed title <span style={{ fontWeight: 700, color: (edit.feedTitle ?? "").length > 150 ? "var(--red)" : "var(--muted)" }}>({(edit.feedTitle ?? "").length}/150)</span></label>
                      <input value={edit.feedTitle ?? ""} onChange={(e) => setEdit({ ...edit, feedTitle: e.target.value })} maxLength={150} placeholder="110-150 chars — keyword first, no size or finish suffix" style={{ ...ctl, width: "100%", marginBottom: 10, borderColor: (edit.feedTitle ?? "").length > 150 ? "#F3C9C9" : "var(--line)" }} />
                      <label style={lab}>Feed description <span style={{ fontWeight: 700, color: (edit.feedDescription ?? "").length > 0 && ((edit.feedDescription ?? "").length < 600 || (edit.feedDescription ?? "").length > 1400) ? "var(--red)" : "var(--muted)" }}>({(edit.feedDescription ?? "").length} chars · target 800-1200)</span></label>
                      <textarea value={edit.feedDescription ?? ""} onChange={(e) => setEdit({ ...edit, feedDescription: e.target.value })} rows={7} placeholder="Plain text, no HTML, no line breaks" style={{ ...ctl, width: "100%", resize: "vertical", borderColor: (edit.feedDescription ?? "").length > 0 && ((edit.feedDescription ?? "").length < 600 || (edit.feedDescription ?? "").length > 1400) ? "#F3C9C9" : "var(--line)" }} />
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                        <button disabled={busy} onClick={saveFeed} style={{ ...pill("#5B3FBF", "#fff"), padding: "7px 14px", fontSize: 12.5 }}>Save feed copy</button>
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>Merchant Center only — never sent to Shopify, and not included in Save below.</span>
                      </div>
                    </div>
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
                    {/* v142 · Custom options ngay trong listing — trước đây chỉ sửa được qua action hàng loạt.
                        Nút riêng như Save feed copy: ô cá nhân hoá nằm ở metafield, không đi cùng Save chính. */}
                    <div style={{ border: `1px solid ${SHOP_GREEN}44`, borderRadius: 10, padding: "12px 14px", marginBottom: 14, background: "#F7FAF5" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 800, color: SHOP_GREEN }}>Custom options ({edPers.length}/5)</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>
                          {edPersOwn ? "this listing only" : edPersTpl ? `following template “${edPersTpl}”` : "no template match"}
                        </div>
                      </div>
                      <CustomOptions fields={edPers} onChange={setEdPers} accent={SHOP_GREEN} onEditingChange={setEdPersEditing} />
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                        <button disabled={busy || edPersEditing} onClick={saveEdPers} style={{ ...pill(SHOP_GREEN, "#fff"), padding: "7px 14px", fontSize: 12.5, opacity: (busy || edPersEditing) ? .6 : 1 }}>Save &amp; push</button>
                        {edPersOwn && <button disabled={busy} onClick={clearEdPers} style={{ ...ghost, padding: "7px 14px", fontSize: 12.5 }}>Use the template instead</button>}
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>Goes straight to the Shopify metafield — not included in Save below.</span>
                      </div>
                    </div>
                    {/* v264 · OPTIONS builder — gõ option/giá trị là TỰ xổ lại variants. */}
                    <label style={lab}>Options</label>
                    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10, marginBottom: 10 }}>
                      {(edit.options ?? []).map((o, i) => (
                        <div key={`opt-${i}`} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                          <input value={o.name} onChange={(e) => setOptName(i, e.target.value)} placeholder="Size" style={{ ...ctl, width: 120, padding: "6px 8px" }} />
                          <input defaultValue={(o.values ?? []).join(", ")} key={`vals-${i}`} onChange={(e) => setOptValues(i, e.target.value)} placeholder="12x4, 16x12" style={{ ...ctl, flex: 1, minWidth: 150, padding: "6px 8px" }} />
                          <button onClick={() => delOption(i)} style={{ ...ghost, padding: "6px 10px", fontSize: 12 }}>✕</button>
                        </div>
                      ))}
                      {(edit.options ?? []).length < 3 && <button onClick={addOption} style={{ ...ghost, padding: "6px 12px", fontSize: 12.5 }}>+ Add option</button>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                      <label style={lab}>Variants ({edit.variants.length}) — price / compare-at / SKU</label>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>Đặt giá cho tất cả:</span>
                        <input type="number" step="0.01" min="0" placeholder="0.00" onBlur={(e) => setAllPrices(e.target.value)} style={{ ...ctl, width: 90, padding: "5px 8px", textAlign: "right" }} />
                      </div>
                    </div>
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

      {/* BULK ACTION MODAL (tags / collection / channels / catalogs) */}
      {act && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !busy && setAct(null)}>
          <div style={{ ...card, width: 440, maxWidth: "96vw", maxHeight: "90vh", overflowY: "auto", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <b style={{ fontSize: 16 }}>{act.title}</b>
              <button onClick={() => setAct(null)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--muted)" }}>✕</button>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14 }}>
              {act.key === "set_template"
                ? <>Applies to <b>{sel.size}</b> selected product(s) — links the facts source for ✦ AI Optimize only. Nothing is sent to Shopify and the current description is not touched.</>
                : act.kind === "gprep"
                ? <>Applies to <b>{sel.size}</b> selected product(s). Writes SKU / metafields / image alt only — title, description, price and images are untouched, so this does not restart the Merchant Center review, and no Push is needed afterwards.</>
                : <>Applies to <b>{sel.size}</b> selected product(s) — runs on Shopify.</>}
            </div>

            {/* Công tắc chiều Add ↔ Remove — thay cho việc có 2 mục riêng trong menu. */}
            {(act.kind === "tags" || act.kind === "collection" || act.kind === "publication") && (
              <div style={{ display: "flex", gap: 0, marginBottom: 14, border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
                {(["add", "remove"] as const).map((m) => {
                  const on = actMode === m;
                  const label = act.kind === "publication" ? (m === "add" ? "Include in" : "Exclude from") : m === "add" ? "Add" : "Remove";
                  return (
                    <button key={m} onClick={() => setActMode(m)}
                      style={{ flex: 1, border: "none", padding: "9px 0", fontSize: 13, fontWeight: 700, cursor: "pointer", background: on ? (m === "add" ? "#E7F6EC" : "#FCEBEB") : "#fff", color: on ? (m === "add" ? "#15803d" : "#D14343") : "var(--muted)" }}>{label}</button>
                  );
                })}
              </div>
            )}

            {/* Hai lệnh gộp: tick bước nào chạy bước đó, chạy tuần tự trên MỘT thanh tiến độ. */}
            {(act.kind === "pushtpl" || act.kind === "gprep") && (
              <div style={{ display: "grid", gap: 2, marginBottom: 14 }}>
                {(act.kind === "pushtpl"
                  ? [
                      { k: "full", t: "Template preset", d: "Product type, vendor, theme template, category + metafields, options + variants + prices, delivery times, sales channels. ⚠ Rebuilds variants — any variant not in the template is deleted on Shopify.", off: false },
                      { k: "delivery", t: "Delivery times only", d: parts.full ? "Already included in Template preset." : "Writes metafield fusion.delivery only — no variant rebuild, safe on clean listings.", off: !!parts.full },
                      { k: "personalization", t: "Personalization fields", d: "Writes metafield fusion.options. If the template has no fields, the listing's fields are cleared.", off: false },
                    ]
                  : [
                      { k: "sku", t: "Generate missing SKUs", d: "Empty variants only — a variant that already has a SKU is never changed.", off: false },
                      { k: "fields", t: "Google feed fields", d: "Custom Product = true, Target audience narrowed to \"Kids\".", off: false },
                      { k: "alt", t: "Image alt text (AI vision)", d: `Images without alt only. Model: ${aiModel && visionIds.has(aiModel) ? (aiModels.find((m) => m.id === aiModel)?.name ?? aiModel) : `server default${aiModel ? " — the model picked on the toolbar cannot read images" : ""}`}.`, off: false },
                    ]
                ).map((s) => (
                  <label key={s.k} style={{ display: "flex", gap: 10, padding: "9px 10px", borderRadius: 10, cursor: s.off ? "default" : "pointer", opacity: s.off ? .45 : 1, background: parts[s.k] && !s.off ? "#F3FBF6" : "transparent" }}>
                    <input type="checkbox" disabled={s.off} checked={!!parts[s.k] && !s.off} onChange={(e) => setParts((p) => ({ ...p, [s.k]: e.target.checked }))} style={{ marginTop: 3 }} />
                    <span>
                      <span style={{ fontSize: 13.5, fontWeight: 700 }}>{s.t}</span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{s.d}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            {act.kind === "pushtpl" && <label style={lab}>Template source</label>}

            {act.kind === "tags" && (
              <div>
                <label style={lab}>Tags (comma-separated)</label>
                <input autoFocus value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="e.g. summer, sale, tshirt" style={{ ...ctl, width: "100%" }} />
              </div>
            )}

            {act.kind === "replace" && (
              <div style={{ display: "grid", gap: 12 }}>
                <div>
                  <label style={lab}>Field</label>
                  <div style={{ display: "flex", gap: 16 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13.5, cursor: "pointer" }}>
                      <input type="radio" name="frField" checked={frField === "body"} onChange={() => setFrField("body")} /> Description
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13.5, cursor: "pointer" }}>
                      <input type="radio" name="frField" checked={frField === "title"} onChange={() => setFrField("title")} /> Title
                    </label>
                  </div>
                </div>
                <div>
                  <label style={lab}>Find (exact text — no wildcards)</label>
                  <textarea autoFocus value={frFind} onChange={(e) => setFrFind(e.target.value)} rows={4} style={{ ...ctl, width: "100%", resize: "vertical", fontFamily: "ui-monospace, monospace", fontSize: 12.5 }} />
                </div>
                <div>
                  <label style={lab}>Replace with (leave empty to delete)</label>
                  <textarea value={frReplace} onChange={(e) => setFrReplace(e.target.value)} rows={4} style={{ ...ctl, width: "100%", resize: "vertical", fontFamily: "ui-monospace, monospace", fontSize: 12.5 }} />
                </div>
              </div>
            )}

            {act.kind !== "tags" && act.kind !== "replace" && act.kind !== "gprep" && (
              act.loading ? <div style={{ padding: "24px 0", textAlign: "center", color: "var(--muted)" }}>Loading…</div>
              : act.items.length === 0 ? <div style={{ padding: "20px 0", textAlign: "center", color: "var(--muted)" }}>{act.kind === "collection" ? "No manual collections on this store." : act.kind === "template" ? "No templates for this store — create one in Manage Templates · Shopify." : "None available on this store."}</div>
              : <div style={{ display: "grid", gap: 4, maxHeight: 320, overflowY: "auto" }}>
                  {act.items.map((it) => (act.kind === "collection" || act.kind === "template" || act.kind === "pushtpl") ? (
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

      {/* v141 · CUSTOM OPTIONS — bố cục theo đúng trình soạn listing của Etsy:
          danh sách field (Edit / Delete) + nút Add field, tối đa 5 field. */}
      {persOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !busy && setPersOpen(false)}>
          <div style={{ ...card, width: 560, maxWidth: "96vw", maxHeight: "90vh", overflowY: "auto", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <b style={{ fontSize: 16 }}>Custom options</b>
              <button onClick={() => setPersOpen(false)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--muted)" }}>✕</button>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14, lineHeight: 1.5 }}>
              {persInfo.count > 1
                ? <><b>{persInfo.count}</b> listings selected — loaded from <b>{persInfo.title}</b>. Saving writes the same fields to all {persInfo.count}.</>
                : <><b>{persInfo.title}</b>{persInfo.source === "template" ? <> — currently following the template <b>{persInfo.templateName}</b>. Saving makes it this listing&apos;s own.</> : persInfo.source === "product" ? <> — this listing has its own fields.</> : <> — no fields yet.</>}</>}
            </div>

            {persLoading ? <div style={{ padding: "28px 0", textAlign: "center", color: "var(--muted)" }}>Loading…</div> : (
              <>
                <CustomOptions fields={persFields} onChange={setPersFields} accent={SHOP_GREEN} onEditingChange={setPersEditing} />

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 18 }}>
                  <button onClick={clearPers} disabled={busy || persInfo.source !== "product"} style={{ ...linkBtn("var(--muted)"), opacity: persInfo.source === "product" ? 1 : .4, cursor: persInfo.source === "product" ? "pointer" : "default" }}>Use the template instead</button>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button onClick={() => setPersOpen(false)} style={ghost}>Cancel</button>
                    <button disabled={busy || persEditing} onClick={savePers} style={{ ...pill(SHOP_GREEN, "#fff"), opacity: (busy || persEditing) ? .6 : 1 }}>{busy ? "Working…" : "Save & push"}</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* EXPORT PINTEREST — chỉ tạo file CSV, không chạm Shopify. */}
      {/* v297 · Push to Amazon — chọn TEMPLATE trước rồi mới stage. */}
      {amzPushOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !busy && setAmzPushOpen(false)}>
          <div style={{ ...card, width: "min(460px, 100%)", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <b style={{ fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}><AmazonLogo size={20} /> Push to Amazon ({sel.size} selected)</b>
            <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 14px" }}>
              Pick the Amazon template for these listings — it decides variations, prices and the customization set. It is pinned on each staged product (changeable later in its detail).
            </div>
            <label style={lab}>Amazon template</label>
            <select value={amzTplPick} onChange={(e) => setAmzTplPick(e.target.value)} style={{ ...ctl, width: "100%", marginBottom: 16 }}>
              <option value="">Auto — match by Product type</option>
              {amzTpls.map((t) => <option key={t.id} value={t.id}>Pinned: {t.name}{t.productType ? ` — ${t.productType}` : ""}</option>)}
            </select>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button disabled={busy} onClick={() => setAmzPushOpen(false)} style={{ ...pill("#EEF1F5", "#333"), padding: "8px 14px" }}>Cancel</button>
              <button disabled={busy} onClick={doPushAmazon} style={{ ...pill("#FF9900", "#111"), padding: "8px 16px" }}>Push</button>
            </div>
          </div>
        </div>
      )}

      {/* v287 · Run pipeline — tick bước → Start. Skip done tự bỏ qua con đã xong ở từng bước. */}
      {pipeOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !busy && setPipeOpen(false)}>
          <div style={{ ...card, width: "min(560px, 100%)", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <b style={{ fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>⚡ Run pipeline ({sel.size} selected)</b>
            <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 14px" }}>
              Runs the finishing chain in order, one progress bar per step. Model: {aiModel || "server default"}.
            </div>
            {([
              ["ai", "1 · AI Optimize", "Writes title/SEO/description — skips listings already optimized"],
              ["push", "2 · Push to Shopify", "Pushes edited (dirty) listings only"],
              ["gprep", "3 · Google prep", "SKU + Google fields + image alt — skips what's already filled"],
              ["feed", "4 · Feed copy (AI)", "Merchant Center title + long description — skips listings with feed"],
              ["active", "5 · Set as Active", "Publishes listings still in Draft"],
              ["amazon", "6 · Amazon", "Push to Manage Products Amazon + AI Amazon copy"],
            ] as [string, string, string][]).map(([k, t, d]) => (
              <label key={k} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 10px", borderRadius: 10, cursor: "pointer", background: pipeSteps[k] ? "#F3FBF6" : "transparent", marginBottom: 4 }}>
                <input type="checkbox" checked={!!pipeSteps[k]} onChange={() => setPipeSteps((p) => ({ ...p, [k]: !p[k] }))} style={{ marginTop: 3 }} />
                <span><b style={{ fontSize: 13 }}>{t}</b><br /><span style={{ fontSize: 11.5, color: "var(--muted)" }}>{d}</span></span>
              </label>
            ))}
            <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0 16px", fontSize: 12.5, cursor: "pointer" }}>
              <input type="checkbox" checked={pipeSkipDone} onChange={() => setPipeSkipDone((v) => !v)} />
              Skip items already done at each step (recommended)
            </label>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button disabled={busy} onClick={() => setPipeOpen(false)} style={{ ...pill("#EEF1F5", "#333"), padding: "8px 14px" }}>Cancel</button>
              <button disabled={busy || !Object.values(pipeSteps).some(Boolean)} onClick={runPipeline} style={{ ...pill("linear-gradient(135deg,#1F6F45,#0E4429)", "#fff"), padding: "8px 16px" }}>Start pipeline</button>
            </div>
          </div>
        </div>
      )}

      {pinOpen && (() => {
        const picked = rows.filter((r) => sel.has(r.id));
        const pins = picked.reduce((n, r) => n + Math.min(r.imageCount || 0, pinPerProduct), 0);
        const noColl = picked.filter((r) => !r.collectionTitles?.length).length;
        const files = Math.max(1, Math.ceil(pins / Math.max(pinPerFile, 1)));
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !busy && setPinOpen(false)}>
            <div style={{ ...card, width: 440, maxWidth: "96vw", padding: 22 }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <b style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16 }}><PinLogo size={18} color={PIN_RED} /> Export Pinterest</b>
                <button onClick={() => setPinOpen(false)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--muted)" }}>✕</button>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 16 }}>
                <b>{pins}</b> pin(s) from <b>{picked.length}</b> product(s) → <b>{files}</b> file(s). Board = collection name. Upload in Pinterest → Settings → Import content.
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={lab}>Images per product</label>
                  <select value={pinPerProduct} onChange={(e) => setPinPerProduct(Number(e.target.value))} style={{ ...ctl, width: "100%" }}>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lab}>Pins per file (max 200)</label>
                  <input type="number" min={1} max={200} value={pinPerFile}
                    onChange={(e) => setPinPerFile(Math.min(200, Math.max(1, Number(e.target.value) || 1)))} style={{ ...ctl, width: "100%" }} />
                </div>
              </div>

              {noColl > 0 && (
                <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 10, background: "#FEF6E7", color: "#8A5B00", fontSize: 12.5, lineHeight: 1.5 }}>
                  {noColl} of {picked.length} product(s) are in no collection — their board falls back to the product type. Add them to a collection first if you want a specific board name.
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
                <button onClick={() => setPinOpen(false)} style={ghost}>Cancel</button>
                <button disabled={busy || pins === 0} onClick={doPinterest} style={{ ...pill(PIN_RED, "#fff"), opacity: (busy || pins === 0) ? .6 : 1 }}>{busy ? "Working…" : "Download CSV"}</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
