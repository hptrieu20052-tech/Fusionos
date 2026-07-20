"use client";
import { useLang } from "@/components/lang-provider";
import { Flash } from "@/components/flash";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { SupplierLogo } from "@/components/supplier-logo";
import { useConfirm } from "@/components/confirm-provider";
import { IconTrash, IconRefresh, IconPlus, IconPin, IconPrinter } from "@/components/icons";

type Ff = { id: string; name: string; method: string; credentials: string | null; shopId: string | null; logoUrl?: string | null; mapCount?: number; pinnedCount?: number };
type Map = { id: string; internalSku: string; fulfillerId: string; fulfillerSku: string; fulfillerProduct: string | null; variant: string | null; baseCost: string; shipCost: string; active: boolean; pinned?: boolean; pfBlueprintId?: number | null; pfProviderId?: number | null; pfVariantId?: number | null };

const inp = { padding: "8px 11px", border: "1px solid var(--line)", borderRadius: 9, font: "inherit", fontSize: 12.5, width: "100%" } as const;
const money = (v: string | number) => `$${Number(v).toFixed(2)}`;
const pgBtn = (disabled: boolean): CSSProperties => ({ background: "#fff", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1, color: "var(--ink)" });

export function SkuMappingClient({ canEdit }: { canEdit: boolean }) {
  const { t } = useLang();
  const confirm = useConfirm();
  const [ffs, setFfs] = useState<Ff[]>([]);
  const [rows, setRows] = useState<Map[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const SIZE = 50;
  const [rowsLoading, setRowsLoading] = useState(false);
  const [active, setActive] = useState<string>("");
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [editRow, setEditRow] = useState<Record<string, Partial<Map>>>({});
  const [nm, setNm] = useState({ internalSku: "", fulfillerSku: "", variant: "", baseCost: "", shipCost: "" });
  // Bộ chọn sản phẩm Printify
  type PP = { id: string; title: string; total: number; mappedCount: number; noSku: number };
  const [picker, setPicker] = useState<PP[] | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerQ, setPickerQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [diag, setDiag] = useState<{ shopId: string; rawCount: number } | null>(null);
  // Recipe picker (Printify): map SKU ↔ blueprint/provider/variant
  const [recipeFor, setRecipeFor] = useState<Map | null>(null);
  const [bps, setBps] = useState<{ id: number; title: string; brand: string; model?: string }[]>([]);
  const [bpQ, setBpQ] = useState("");
  const [provs, setProvs] = useState<{ id: number; title: string }[]>([]);
  const [vars, setVars] = useState<{ id: number; title: string }[]>([]);
  const [rc, setRc] = useState<{ bp?: number; pv?: number; vr?: number }>({});
  const [importAllPv, setImportAllPv] = useState(false);
  const [rcLoad, setRcLoad] = useState("");
  // Thêm sản phẩm Printify: chọn blueprint + nhà in → import TẤT CẢ variant
  const [addProd, setAddProd] = useState(false);
  const [importing, setImporting] = useState(false);
  const [cuOpen, setCuOpen] = useState(false); // panel Import-từ-link của Compassup
  // Ghim sản phẩm cho form tạo đơn
  const [pinPicker, setPinPicker] = useState<{ product: string; count: number }[] | null>(null);
  const [pinSel, setPinSel] = useState<Set<string>>(new Set());
  const [delPicker, setDelPicker] = useState<{ product: string; count: number }[] | null>(null);
  const [delSel, setDelSel] = useState<Set<string>>(new Set());
  const [delQ, setDelQ] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  const [pinQ, setPinQ] = useState("");
  const [pinOnlySel, setPinOnlySel] = useState(false);

  async function openRecipe(m: Map) {
    setRecipeFor(m); setRc({ bp: m.pfBlueprintId ?? undefined, pv: m.pfProviderId ?? undefined, vr: m.pfVariantId ?? undefined });
    setProvs([]); setVars([]); setBpQ("");
    if (bps.length === 0) {
      setRcLoad(t("sk.loadingBp"));
      const j = await fetch(`/api/fulfillers/printify-catalog?fulfillerId=${active}&level=blueprints`).then((r) => r.json()).catch(() => ({ ok: false }));
      setRcLoad(""); if (j.ok) setBps(j.blueprints); else setMsg("⚠ " + (j.error ?? t("sk.errLoadBp")));
    }
  }
  async function pickBp(id: number) {
    setRc({ bp: id }); setProvs([]); setVars([]); setRcLoad(t("sk.loadingProviders"));
    const j = await fetch(`/api/fulfillers/printify-catalog?fulfillerId=${active}&level=providers&blueprint=${id}`).then((r) => r.json()).catch(() => ({ ok: false }));
    setRcLoad(""); if (j.ok) setProvs(j.providers); else setMsg("⚠ " + (j.error ?? t("sk.errLow")));
  }
  async function pickPv(id: number) {
    setRc((p) => ({ ...p, pv: id, vr: undefined })); setVars([]); setRcLoad(t("sk.loadingVariants"));
    const j = await fetch(`/api/fulfillers/printify-catalog?fulfillerId=${active}&level=variants&blueprint=${rc.bp}&provider=${id}`).then((r) => r.json()).catch(() => ({ ok: false }));
    setRcLoad(""); if (j.ok) setVars(j.variants); else setMsg("⚠ " + (j.error ?? t("sk.errLow")));
  }
  async function saveRecipe() {
    if (!recipeFor || !rc.bp || !rc.pv || !rc.vr) { setMsg(t("sk.warnPickAll")); return; }
    const j = await fetch("/api/mappings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: recipeFor.id, pfBlueprintId: rc.bp, pfProviderId: rc.pv, pfVariantId: rc.vr }) }).then((r) => r.json());
    if (j.ok) { setMsg(t("sk.printConfigSaved")); setRecipeFor(null); refresh(); } else setMsg("⚠ " + (j.error ?? t("sk.errLow")));
  }

  // ---- Thêm sản phẩm Printify: pick blueprint → nhà in → import toàn bộ variant (như Merchize) ----
  async function openAddProduct() {
    setAddProd(true); setRc({}); setProvs([]); setVars([]); setBpQ("");
    if (bps.length === 0) {
      setRcLoad(t("sk.loadingBp"));
      const j = await fetch(`/api/fulfillers/printify-catalog?fulfillerId=${active}&level=blueprints`).then((r) => r.json()).catch(() => ({ ok: false }));
      setRcLoad(""); if (j.ok) setBps(j.blueprints); else setMsg("⚠ " + (j.error ?? t("sk.errLoadBp")));
    }
  }
  // Làm mới danh sách blueprint từ Printify (bỏ qua cache client + server) — khi Printify ra SP mới
  async function reloadBlueprints() {
    setRcLoad(t("sk.refreshingProducts"));
    const j = await fetch(`/api/fulfillers/printify-catalog?fulfillerId=${active}&level=blueprints&t=${Date.now()}`).then((r) => r.json()).catch(() => ({ ok: false }));
    setRcLoad("");
    if (j.ok) { setBps(j.blueprints); setMsg(t("sk.refreshedResult").replace("{n}", String(j.blueprints.length))); }
    else setMsg("⚠ " + (j.error ?? t("sk.errRefresh")));
  }
  async function importProduct() {
    if (!rc.bp) { setMsg(t("sk.warnPickBp")); return; }
    if (!importAllPv && !rc.pv) { setMsg(t("sk.warnPickProvider")); return; }
    setImporting(true); setMsg(importAllPv ? t("sk.pullingAll") : t("sk.importingVariant"));
    const bpObj = bps.find((x) => x.id === rc.bp);
    const title = bpObj ? `${bpObj.title}${bpObj.brand || bpObj.model ? ` (${[bpObj.brand, bpObj.model].filter(Boolean).join(" ")})` : ""}` : "";
    const body = importAllPv
      ? { fulfillerId: active, blueprintId: rc.bp, allProviders: true, blueprintTitle: title }
      : { fulfillerId: active, blueprintId: rc.bp, providerId: rc.pv, blueprintTitle: title };
    const j = await fetch("/api/fulfillers/printify-import-variants", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setImporting(false);
    if (j.ok) {
      const more = j.done === false ? t("sk.moreClickAgain2") : "";
      setMsg(t("sk.importResult").replace("{v}", String(j.created)).replace("{pd}", String(j.providersDone ?? 1)).replace("{p}", String(j.providers ?? 1)).replace("{s}", String(j.skipped)) + more + t("sk.pinnedFormSuffix"));
      if (j.done !== false) { setAddProd(false); setImportAllPv(false); }
      refresh();
    } else setMsg("⚠ " + (j.error ?? t("sk.errLow")));
  }

  const loadFfs = useCallback(async () => {
    const j = await fetch("/api/fulfillers").then((r) => r.json()).catch(() => null);
    if (j?.ok) { setFfs(j.fulfillers); setActive((a) => a || (j.fulfillers[0]?.id ?? "")); }
  }, []);
  const [qDeb, setQDeb] = useState("");
  const loadRows = useCallback(async () => {
    if (!active) { setRows([]); setTotal(0); return; }
    setRowsLoading(true);
    const j = await fetch(`/api/mappings/list?ff=${active}&q=${encodeURIComponent(qDeb)}&page=${page}&size=${SIZE}`).then((r) => r.json()).catch(() => null);
    setRowsLoading(false);
    if (j?.ok) { setRows(j.rows); setTotal(j.total); }
  }, [active, qDeb, page]);
  const refresh = useCallback(() => { loadFfs(); loadRows(); }, [loadFfs, loadRows]);

  useEffect(() => { loadFfs(); }, [loadFfs]);
  useEffect(() => { const t = setTimeout(() => setQDeb(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(1); }, [qDeb, active]);   // đổi nhà / tìm kiếm → về trang 1
  useEffect(() => { loadRows(); }, [loadRows]);

  const ff = ffs.find((f) => f.id === active);
  const countBy = (id: string) => ffs.find((f) => f.id === id)?.mapCount ?? 0;
  const pinnedCount = ff?.pinnedCount ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / SIZE));

  // Danh sách hiển thị trong popup ghim: toàn bộ, hoặc chỉ SP đã chọn (để bỏ chọn cho tiện)
  const pinShown = (() => {
    const all = pinPicker ?? [];
    if (!pinOnlySel) return all;
    const cmap = new Map(all.map((p) => [p.product, p.count]));
    return Array.from(pinSel).sort((a, b) => a.localeCompare(b))
      .filter((p) => !pinQ || p.toLowerCase().includes(pinQ.toLowerCase()))
      .map((product) => ({ product, count: cmap.get(product) ?? 0 }));
  })();

  async function addMap() {
    if (!nm.internalSku || !nm.fulfillerSku || isNaN(Number(nm.baseCost))) { setMsg(t("sk.warnFillSku")); return; }
    const j = await fetch("/api/mappings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...nm, fulfillerId: active }) }).then((r) => r.json());
    setMsg(j.ok ? t("sk.added") : "⚠ " + j.error); if (j.ok) { setNm({ internalSku: "", fulfillerSku: "", variant: "", baseCost: "", shipCost: "" }); refresh(); }
  }
  async function saveRow(id: string) {
    const e = editRow[id]; if (!e) return;
    const j = await fetch("/api/mappings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...e }) }).then((r) => r.json());
    setMsg(j.ok ? t("sk.saved") : "⚠ " + j.error); if (j.ok) { setEditRow((p) => { const n = { ...p }; delete n[id]; return n; }); refresh(); }
  }
  async function delRow(id: string) {
    if (!(await confirm({ message: t("sk.deleteMappingRow"), danger: true }))) return;
    const j = await fetch("/api/mappings", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).then((r) => r.json());
    if (j.ok) refresh();
  }
  async function openPicker() {
    setPickerLoading(true); setPicker([]); setMsg("");
    const j = await fetch("/api/fulfillers/printify-products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fulfillerId: active }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setPickerLoading(false);
    if (j.ok) {
      setPicker(j.products);
      setDiag({ shopId: j.shopId, rawCount: j.rawCount });
      // Mặc định tick sản phẩm đã map (>0 variant đã map)
      setSel(new Set((j.products as PP[]).filter((p) => p.mappedCount > 0).map((p) => p.id)));
    } else { setMsg("⚠ " + j.error); setPicker(null); }
  }
  async function syncPicker() {
    setMsg(t("sk.syncing"));
    const j = await fetch("/api/fulfillers/printify-sync-skus", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fulfillerId: active, selectedProductIds: Array.from(sel) }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    if (j.ok) { setMsg(t("sk.syncResult").replace("{a}", String(j.added)).replace("{r}", String(j.removed))); setPicker(null); refresh(); }
    else setMsg("⚠ " + (j.error ?? t("sk.errLow")));
  }
  const toggleSel = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ---- Ghim sản phẩm cho form tạo đơn (danh sách SP lấy từ server, không kéo toàn bộ variant) ----
  const fetchPinProducts = useCallback(async (query: string) => {
    const j = await fetch(`/api/mappings/products?ff=${active}&q=${encodeURIComponent(query)}`).then((r) => r.json()).catch(() => ({ ok: false }));
    return j.ok ? (j.products as { product: string; count: number; pinned: boolean }[]) : [];
  }, [active]);
  async function openPinPicker() {
    setPinQ(""); setPinOnlySel(false);
    setMsg(t("sk.loadingProducts"));
    const products = await fetchPinProducts("");
    setMsg("");
    setPinPicker(products.map((p) => ({ product: p.product, count: p.count })));
    setPinSel(new Set(products.filter((p) => p.pinned).map((p) => p.product)));
  }
  // Tìm trong popup ghim (server-side: theo tên hoặc SKU) — debounce, giữ nguyên lựa chọn đã tick
  const pinOpen = pinPicker !== null;
  useEffect(() => {
    if (!pinOpen || pinOnlySel) return;   // đang lọc t("sk.pinnedOnly") → lọc client, khỏi gọi server
    const t = setTimeout(async () => { setPinPicker(await fetchPinProducts(pinQ.trim())); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinQ]);
  const togglePin = (p: string) => setPinSel((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });

  // ---- Xóa bớt sản phẩm (nhiều variant) để bảng nhẹ hơn ----
  async function openDelPicker() {
    setDelQ(""); setDelSel(new Set());
    setMsg(t("sk.loadingProducts"));
    const products = await fetchPinProducts("");
    setMsg("");
    setDelPicker(products.map((p) => ({ product: p.product, count: p.count })));
  }
  const delOpen = delPicker !== null;
  useEffect(() => {
    if (!delOpen) return;
    const t = setTimeout(async () => { setDelPicker(await fetchPinProducts(delQ.trim())); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delQ]);
  const toggleDel = (p: string) => setDelSel((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });
  async function delProducts() {
    const products = Array.from(delSel);
    if (!products.length) { setMsg(t("sk.warnNoProductToDelete")); return; }
    if (!(await confirm({ message: t("sk.deleteProductsConfirm").replace("{n}", String(products.length)).replace("{ff}", ff?.name ?? t("sk.thisProvider")), danger: true }))) return;
    setDelBusy(true);
    const j = await fetch("/api/mappings", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fulfillerId: active, products }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setDelBusy(false);
    if (j.ok) { setMsg(t("sk.deletedResult").replace("{d}", String(j.deleted)).replace("{n}", String(products.length))); setDelPicker(null); refresh(); }
    else setMsg("⚠ " + (j.error ?? t("sk.errLow")));
  }
  async function delAllOfFf() {
    if (!(await confirm({ message: t("sk.deleteAllConfirm").replace("{n}", countBy(active).toLocaleString()).replace("{ff}", ff?.name ?? t("sk.thisProvider")), danger: true }))) return;
    setDelBusy(true);
    const j = await fetch("/api/mappings", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fulfillerId: active, all: true }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setDelBusy(false);
    if (j.ok) { setMsg(t("sk.deletedAllResult").replace("{d}", String(j.deleted))); setDelPicker(null); refresh(); }
    else setMsg("⚠ " + (j.error ?? t("sk.errLow")));
  }
  async function savePins() {
    setMsg(t("sk.savingPin"));
    const j = await fetch("/api/fulfillers/pin-products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fulfillerId: active, products: Array.from(pinSel) }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    if (j.ok) { setMsg(t("sk.pinnedResult").replace("{p}", String(j.pinned)).replace("{n}", String(j.products))); setPinPicker(null); refresh(); }
    else setMsg("⚠ " + (j.error ?? t("sk.errLow")));
  }
  // Ghim/bỏ ghim nhanh 1 sản phẩm ngay trên bảng (khỏi mở popup)
  async function togglePinProduct(product: string | null, pin: boolean) {
    if (!product) { setMsg(t("sk.warnNoNameToPin")); return; }
    const j = await fetch("/api/fulfillers/pin-products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fulfillerId: active, toggleProduct: product, pinned: pin }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    if (j.ok) { setMsg(pin ? t("sk.pinnedStar").replace("{p}", product).replace("{n}", String(j.count)) : t("sk.unpinnedName").replace("{p}", product)); refresh(); }
    else setMsg("⚠ " + (j.error ?? t("sk.errLow")));
  }
  // 1 nút t("sk.updateSku"): kéo SP mới → điền màu/size + base + ship từ catalog. Chạy tuần tự, tăng dần.
  async function getSkuMerchize() {
    setMsg(t("sk.pullingMerchize"));
    const imp = await fetch("/api/fulfillers/merchize-import-skus", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fulfillerId: active }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    if (!imp.ok) { setMsg("⚠ " + (imp.error ?? t("sk.errPullSku"))); return; }
    setMsg(t("sk.addedFilling").replace("{n}", String(imp.created)));
    const enr = await fetch("/api/fulfillers/merchize-enrich-variants", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fulfillerId: active }) }).then((r) => r.json()).catch(() => ({ ok: false }));
    refresh();
    const notDone = imp.done === false || (enr.ok && enr.done === false);
    const info = t("sk.addedNew").replace("{n}", String(imp.created)) + (enr.ok ? t("sk.filledLabels").replace("{n}", String(enr.updated)) : "");
    setMsg(info + (notDone ? t("sk.moreClickAgain") : " · done"));
  }

  // Kéo catalog Lenful (2 pha, bấm lại để mở rộng tiếp variants) → thêm mapping mới
  async function getSkuLenful() {
    setMsg(t("sk.pullingFrom").replace("{name}", ffs.find((f) => f.id === active)?.name ?? "Lenful"));
    const imp = await fetch("/api/fulfillers/lenful-import-skus", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fulfillerId: active }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    if (!imp.ok) { setMsg("⚠ " + (imp.error ?? t("sk.errPullSku"))); return; }
    refresh();
    setMsg(t("sk.addedNew").replace("{n}", String(imp.created)) + ` · ${imp.found} products` + (imp.remaining ? ` · ${imp.remaining} left — click again to continue` : ""));
  }

  // Kéo catalog Vinaway (products + product-skus → "product_id:sku_id") → thêm mapping mới
  async function getSkuVinaway() {
    setMsg(t("sk.pullingFrom").replace("{name}", ffs.find((f) => f.id === active)?.name ?? "Vinaway"));
    const imp = await fetch("/api/fulfillers/vinaway-import-skus", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fulfillerId: active }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    if (!imp.ok) { setMsg("⚠ " + (imp.error ?? t("sk.errPullSku"))); return; }
    refresh();
    setMsg(t("sk.addedNew").replace("{n}", String(imp.created)) + ` · ${imp.found} found, ${imp.skipped} skipped` + (imp.unmatched ? ` · ${imp.unmatched} unmatched product_id` : ""));
    // Response Vinaway thiếu field (không tên SP / không sku code) → hiện MẪU THÔ để copy gửi admin map lại field.
    if (imp.note && typeof window !== "undefined" && /Response Vinaway/.test(String(imp.note))) window.prompt("Vinaway response sample — copy & gửi admin:", String(imp.note));
  }

  // Kéo catalog SKU Printway (GET /products/list-sku-catalogs) → thêm mapping mới
  async function getSkuPrintway() {
    setMsg(t("sk.pullingFrom").replace("{name}", ffs.find((f) => f.id === active)?.name ?? "Printway"));
    const imp = await fetch("/api/fulfillers/printway-import-skus", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fulfillerId: active }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    if (!imp.ok) { setMsg("⚠ " + (imp.error ?? t("sk.errPullSku"))); return; }
    refresh();
    setMsg(t("sk.addedNew").replace("{n}", String(imp.created)) + ` · ${imp.found} found, ${imp.skipped} skipped`);
  }

  // Kéo catalog ONOS (GET /products) → thêm mapping mới (variant = Color / Size)
  async function getSkuOnos() {
    setMsg(t("sk.pullingFrom").replace("{name}", ffs.find((f) => f.id === active)?.name ?? "ONOS"));
    const imp = await fetch("/api/fulfillers/onos-import-skus", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fulfillerId: active }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    if (!imp.ok) { setMsg("⚠ " + (imp.error ?? t("sk.errPullSku"))); return; }
    refresh();
    setMsg(t("sk.addedNew").replace("{n}", String(imp.created)) + ` · ${imp.found} found, ${imp.skipped} skipped` + (imp.productsPending ? ` · ${imp.productsPending} products pending` : "") + (imp.done === false ? t("sk.moreClickAgain") : ""));
  }

  // Kéo catalog Wembroidery (GET /public/catalog) → dựng SKU WEM-{catalogId}-{COLOR}-{SIZE}
  async function getSkuWembroidery() {
    setMsg(t("sk.pullingFrom").replace("{name}", ffs.find((f) => f.id === active)?.name ?? "Wembroidery"));
    const imp = await fetch("/api/fulfillers/wembroidery-import-skus", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fulfillerId: active }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    if (!imp.ok) { setMsg("⚠ " + (imp.error ?? t("sk.errPullSku"))); return; }
    refresh();
    setMsg(t("sk.addedNew").replace("{n}", String(imp.created)) + ` · ${imp.found} found, ${imp.skipped} skipped`);
  }

  // Kéo variant FlashShip (GET /orders/list-variant-sku) → upsert mapping (API không trả giá)
  async function getSkuFlashship() {
    setMsg(t("sk.pullingFrom").replace("{name}", ffs.find((f) => f.id === active)?.name ?? "FlashShip"));
    const imp = await fetch("/api/fulfillers/flashship-import-skus", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fulfillerId: active }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    if (!imp.ok) { setMsg("⚠ " + (imp.error ?? t("sk.errPullSku"))); return; }
    refresh();
    setMsg(t("sk.addedNew").replace("{n}", String(imp.created)) + ` · ${imp.updated} updated · FlashShip API has no prices — enter Base/Ship manually`);
  }

  const th = { textAlign: "left" as const, fontSize: 11, color: "var(--faint)", fontWeight: 800, textTransform: "uppercase" as const, letterSpacing: ".3px", padding: "8px 10px", borderBottom: "1px solid var(--line)" };
  const td = { padding: "7px 10px", borderBottom: "1px solid var(--line)", fontSize: 12.5, verticalAlign: "middle" as const };

  return (
    <div className="panel" style={{ marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h3 style={{ fontWeight: 800, fontSize: 16 }}>SKU Mapping</h3>
          <div className="sub">{t("sk.mapDesc")}</div>
        </div>
        <Flash msg={msg} />
      </div>

      {/* Tabs supplier */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14, marginBottom: 14 }}>
        {ffs.map((f) => (
          <button key={f.id} onClick={() => setActive(f.id)}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 13px", borderRadius: 11, cursor: "pointer", fontSize: 12.5, fontWeight: 700,
              border: active === f.id ? "1.5px solid var(--blue)" : "1px solid var(--line)",
              background: active === f.id ? "var(--blue-soft)" : "var(--card)", color: active === f.id ? "var(--blue)" : "var(--ink)" }}>
            <SupplierLogo name={f.name} src={f.logoUrl} size={18} /> {f.name}
            <span style={{ background: active === f.id ? "#fff" : "var(--line)", borderRadius: 6, padding: "1px 6px", fontSize: 11 }}>{countBy(f.id)}</span>
          </button>
        ))}
      </div>

      {ff && (
        <>
          {/* Thanh công cụ supplier */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            <input placeholder={t("sk.searchSkuNameVar")} value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inp, width: 260 }} />
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{total.toLocaleString()} {t("sk.rowsWord")}{qDeb ? t("sk.filterSuffix") : ""}{rowsLoading ? " · …" : ""}{pinnedCount > 0 ? <span style={{ color: "#9A6B00", fontWeight: 700 }}> · <IconPin width={11} height={11} style={{ verticalAlign: "-1px" }} /> {pinnedCount} pinned</span> : ""}</span>
            <div style={{ flex: 1 }} />
            {ff.method === "api" && canEdit && countBy(active) > 0 && (
              <button onClick={openPinPicker} title={t("sk.pickExistingProduct")} style={{ background: "#FFF6E5", border: "1px solid #F3D08A", color: "#9A6B00", borderRadius: 10, padding: "8px 14px", fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}><IconPin width={13} height={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />{t("sk.pickForForm")}</button>
            )}
            {ff.method === "api" && canEdit && countBy(active) > 0 && (
              <button onClick={openDelPicker} title={t("sk.removeHeavyProducts")} style={{ background: "#FBECEC", border: "1px solid #F3C6C0", color: "var(--red)", borderRadius: 10, padding: "8px 14px", fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}><IconTrash width={13} height={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />{t("sk.removeProductsBtn")}</button>
            )}
            {ff.method === "api" && ff.name.toLowerCase().includes("printify") && canEdit && (
              <button onClick={openAddProduct} title={t("sk.printifyHint")} style={{ background: "#EAF3EA", border: "1px solid #BFE0BF", color: "#2E7D46", borderRadius: 10, padding: "8px 14px", fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}><IconPlus width={13} height={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />{t("sk.addPrintifyProduct")}</button>
            )}
            {ff.method === "api" && ff.name.toLowerCase().includes("merchize") && canEdit && (
              <button onClick={getSkuMerchize} title={t("sk.pullNewLabels")} style={{ background: "#EAF3EA", border: "1px solid #BFE0BF", color: "#2E7D46", borderRadius: 10, padding: "8px 14px", fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}><IconRefresh width={13} height={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />{t("sk.updateSkuBtn")}</button>
            )}
            {ff.method === "api" && ff.name.toLowerCase().includes("printway") && canEdit && (
              <button onClick={getSkuPrintway} title="Pull SKU catalog from Printway" style={{ background: "#EAF3EA", border: "1px solid #BFE0BF", color: "#2E7D46", borderRadius: 10, padding: "8px 14px", fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}><IconRefresh width={13} height={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />{t("sk.updateSkuBtn")}</button>
            )}
            {ff.method === "api" && ff.name.toLowerCase().includes("flashship") && canEdit && (
              <button onClick={getSkuFlashship} title="Pull variant list from FlashShip" style={{ background: "#EAF3EA", border: "1px solid #BFE0BF", color: "#2E7D46", borderRadius: 10, padding: "8px 14px", fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}><IconRefresh width={13} height={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />{t("sk.updateSkuBtn")}</button>
            )}
            {ff.method === "api" && ff.name.toLowerCase().includes("onos") && canEdit && (
              <button onClick={getSkuOnos} title="Pull product catalog from ONOS" style={{ background: "#EAF3EA", border: "1px solid #BFE0BF", color: "#2E7D46", borderRadius: 10, padding: "8px 14px", fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}><IconRefresh width={13} height={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />{t("sk.updateSkuBtn")}</button>
            )}
            {ff.method === "api" && ff.name.toLowerCase().includes("wembroidery") && canEdit && (
              <button onClick={getSkuWembroidery} title="Pull catalog from Wembroidery" style={{ background: "#EAF3EA", border: "1px solid #BFE0BF", color: "#2E7D46", borderRadius: 10, padding: "8px 14px", fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}><IconRefresh width={13} height={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />{t("sk.updateSkuBtn")}</button>
            )}
            {ff.method === "api" && ff.name.toLowerCase().includes("lenful") && canEdit && (
              <button onClick={getSkuLenful} title="Pull product catalog from Lenful (click again to expand remaining variants)" style={{ background: "#EAF3EA", border: "1px solid #BFE0BF", color: "#2E7D46", borderRadius: 10, padding: "8px 14px", fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}><IconRefresh width={13} height={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />{t("sk.updateSkuBtn")}</button>
            )}
            {ff.method === "api" && ff.name.toLowerCase().includes("vinaway") && canEdit && (
              <button onClick={getSkuVinaway} title="Pull products + variant SKUs from Vinaway (product_id:sku_id)" style={{ background: "#EAF3EA", border: "1px solid #BFE0BF", color: "#2E7D46", borderRadius: 10, padding: "8px 14px", fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}><IconRefresh width={13} height={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />{t("sk.updateSkuBtn")}</button>
            )}
            {ff.method === "api" && ff.name.toLowerCase().includes("compassup") && canEdit && (
              <button onClick={() => setCuOpen((v) => !v)} title="Import variants from a Compassup product link" style={{ background: "#EAF3EA", border: "1px solid #BFE0BF", color: "#2E7D46", borderRadius: 10, padding: "8px 14px", fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}><IconPlus width={13} height={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />{cuOpen ? "Close import" : "Import from link"}</button>
            )}
          </div>

          {/* Compassup: panel Import-từ-link (chỉ hiện khi active là Compassup + đã bật) */}
          {ff?.name.toLowerCase().includes("compassup") && cuOpen && canEdit && (
            <CompassupImport fulfillerId={active} onDone={() => { setCuOpen(false); refresh(); }} />
          )}

          {/* Bảng mapping */}
          <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead><tr>
                <th style={th}>{t("sk.internalSku")}</th><th style={th}>SKU {ff.name}</th><th style={th}>{t("sk.productVariant")}</th>
                <th style={{ ...th, textAlign: "right" }}>Base</th><th style={{ ...th, textAlign: "right" }}>Ship</th><th style={{ ...th, textAlign: "right" }}>{t("sk.totalTh")}</th>
                {canEdit && <th style={{ ...th, textAlign: "right", width: 120 }}></th>}
              </tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td style={{ ...td, textAlign: "center", color: "var(--muted)", padding: 24 }} colSpan={canEdit ? 7 : 6}>{t("sk.noMappingYet")} · {ff.name}</td></tr>}
                {rows.map((m) => {
                  const e = editRow[m.id];
                  return (
                    <tr key={m.id} style={e ? { background: "var(--blue-soft)" } : undefined}>
                      {e ? <>
                        <td style={td}><input value={e.internalSku ?? m.internalSku} onChange={(ev) => setEditRow((p) => ({ ...p, [m.id]: { ...p[m.id], internalSku: ev.target.value } }))} style={inp} /></td>
                        <td style={td}><input value={e.fulfillerSku ?? m.fulfillerSku} onChange={(ev) => setEditRow((p) => ({ ...p, [m.id]: { ...p[m.id], fulfillerSku: ev.target.value } }))} style={inp} /></td>
                        <td style={td}><input value={e.variant ?? m.variant ?? ""} onChange={(ev) => setEditRow((p) => ({ ...p, [m.id]: { ...p[m.id], variant: ev.target.value } }))} style={inp} /></td>
                        <td style={td}><input type="number" step="0.01" value={e.baseCost ?? m.baseCost} onChange={(ev) => setEditRow((p) => ({ ...p, [m.id]: { ...p[m.id], baseCost: ev.target.value } }))} style={{ ...inp, width: 74 }} /></td>
                        <td style={td}><input type="number" step="0.01" value={e.shipCost ?? m.shipCost} onChange={(ev) => setEditRow((p) => ({ ...p, [m.id]: { ...p[m.id], shipCost: ev.target.value } }))} style={{ ...inp, width: 74 }} /></td>
                        <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{money(Number(e.baseCost ?? m.baseCost) + Number(e.shipCost ?? m.shipCost))}</td>
                        <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                          <button onClick={() => saveRow(m.id)} style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 8, padding: "5px 10px", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>{t("sk.save")}</button>
                          <button onClick={() => setEditRow((p) => { const n = { ...p }; delete n[m.id]; return n; })} style={{ marginLeft: 5, background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }}>✕</button>
                        </td>
                      </> : <>
                        <td style={{ ...td, fontWeight: 700, fontFamily: "ui-monospace,monospace" }}>{m.internalSku}</td>
                        <td style={{ ...td, fontFamily: "ui-monospace,monospace" }}>{m.fulfillerSku}</td>
                        <td style={td}>
                          {m.fulfillerProduct ? <span>{m.fulfillerProduct}{m.variant ? <span style={{ color: "var(--muted)" }}> · {m.variant}</span> : ""}</span> : (m.variant || <span style={{ color: "var(--faint)" }}>—</span>)}
                          {ff.name.toLowerCase().includes("printify") && (m.pfBlueprintId
                            ? <span style={{ marginLeft: 8, background: "#EAF3EA", color: "#2E7D46", borderRadius: 6, padding: "1px 7px", fontSize: 10.5, fontWeight: 800 }}>{t("sk.configured")}</span>
                            : <span style={{ marginLeft: 8, background: "#FBECEC", color: "var(--red)", borderRadius: 6, padding: "1px 7px", fontSize: 10.5, fontWeight: 800 }}>{t("sk.notConfigured")}</span>)}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>{money(m.baseCost)}</td>
                        <td style={{ ...td, textAlign: "right" }}>{money(m.shipCost)}</td>
                        <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{money(Number(m.baseCost) + Number(m.shipCost))}</td>
                        {canEdit && <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                          <button onClick={() => togglePinProduct(m.fulfillerProduct, !m.pinned)} title={m.pinned ? t("sk.unpinFromForm") : t("sk.pinToForm")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, color: m.pinned ? "#E0A000" : "var(--faint)" }}><IconPin width={14} height={14} /></button>
                          {ff.name.toLowerCase().includes("printify") && <button onClick={() => openRecipe(m)} title={t("sk.pickBpProvVar")} style={{ marginLeft: 8, background: "none", border: "none", cursor: "pointer", color: "#2E7D46", fontWeight: 700, fontSize: 12, display: "inline-flex", alignItems: "center", gap: 3 }}><IconPrinter width={12} height={12} /> In</button>}
                          <button onClick={() => setEditRow((p) => ({ ...p, [m.id]: {} }))} style={{ marginLeft: 8, background: "none", border: "none", cursor: "pointer", color: "var(--blue)", fontWeight: 700, fontSize: 12 }}>{t("c.edit")}</button>
                          <button onClick={() => delRow(m.id)} style={{ marginLeft: 8, background: "none", border: "none", cursor: "pointer", color: "var(--red)", fontWeight: 700, fontSize: 12 }}>{t("c.delete")}</button>
                        </td>}
                      </>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Phân trang */}
          {pageCount > 1 && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 12 }}>
              <button onClick={() => setPage(1)} disabled={page <= 1} style={pgBtn(page <= 1)}>«</button>
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={pgBtn(page <= 1)}>{t("sk.prev")}</button>
              <span style={{ fontSize: 12.5, color: "var(--muted)", minWidth: 90, textAlign: "center" }}>{t("sk.pageWord")} <b style={{ color: "var(--ink)" }}>{page}</b> / {pageCount}</span>
              <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount} style={pgBtn(page >= pageCount)}>{t("sk.next")}</button>
              <button onClick={() => setPage(pageCount)} disabled={page >= pageCount} style={pgBtn(page >= pageCount)}>»</button>
            </div>
          )}
          {/* Thêm dòng */}
          {canEdit && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center", borderTop: "1px dashed var(--line)", paddingTop: 12 }}>
              <b style={{ fontSize: 12.5 }}>{t("sk.addColon")}</b>
              <input placeholder={t("sk.internalSku")} value={nm.internalSku} onChange={(e) => setNm({ ...nm, internalSku: e.target.value })} style={{ ...inp, width: 150 }} />
              <input placeholder={`SKU ${ff.name}`} value={nm.fulfillerSku} onChange={(e) => setNm({ ...nm, fulfillerSku: e.target.value })} style={{ ...inp, width: 150 }} />
              <input placeholder={t("sk.variantOptional")} value={nm.variant} onChange={(e) => setNm({ ...nm, variant: e.target.value })} style={{ ...inp, width: 160 }} />
              <input type="number" step="0.01" placeholder="Base $" value={nm.baseCost} onChange={(e) => setNm({ ...nm, baseCost: e.target.value })} style={{ ...inp, width: 90 }} />
              <input type="number" step="0.01" placeholder="Ship $" value={nm.shipCost} onChange={(e) => setNm({ ...nm, shipCost: e.target.value })} style={{ ...inp, width: 90 }} />
              <button onClick={addMap} style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 10, padding: "8px 16px", fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}>{t("sk.add")}</button>
            </div>
          )}
        </>
      )}

      {/* Bộ chọn sản phẩm Printify */}
      {(picker !== null || pickerLoading) && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(24,30,42,.5)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => { if (!pickerLoading) setPicker(null); }}>
          <div className="modal-card" style={{ background: "#fff", borderRadius: 18, width: 620, maxWidth: "96vw", maxHeight: "88vh", display: "flex", flexDirection: "column", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <b style={{ fontSize: 16 }}>{t("sk.pickProductToFulfill")}</b>
              {!pickerLoading && <button onClick={() => setPicker(null)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--muted)" }}>✕</button>}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>{t("sk.tickToMap")}</div>

            {pickerLoading ? <div style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>{t("sk.pullingFromPrintify")}</div> : (
              <>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
                  <input placeholder={t("sk.searchProduct")} value={pickerQ} onChange={(e) => setPickerQ(e.target.value)} style={{ ...inp, width: 200 }} />
                  <button onClick={() => setSel(new Set((picker ?? []).map((p) => p.id)))} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 11px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>{t("sk.selectAll")}</button>
                  <button onClick={() => setSel(new Set())} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 11px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>{t("sk.deselectAll")}</button>
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>{t("sk.selectedCount")} {sel.size}/{picker?.length ?? 0}</span>
                </div>
                <div style={{ overflowY: "auto", border: "1px solid var(--line)", borderRadius: 12, flex: 1 }}>
                  {(picker ?? []).filter((p) => !pickerQ || p.title.toLowerCase().includes(pickerQ.toLowerCase())).map((p) => (
                    <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 13px", borderBottom: "1px solid var(--line)", cursor: "pointer" }}>
                      <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggleSel(p.id)} style={{ width: 17, height: 17, cursor: "pointer" }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title}</div>
                        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                          {p.total} SKU{p.mappedCount > 0 ? <span style={{ color: "#2E7D46", fontWeight: 700 }}>{t("sk.mappedMid")}{p.mappedCount}</span> : ""}{p.noSku > 0 ? <span style={{ color: "var(--amber)" }}>{t("sk.noSkuSuffix").replace("{n}", String(p.noSku))}</span> : ""}
                        </div>
                      </div>
                    </label>
                  ))}
                  {(picker ?? []).length === 0 && (
                    <div style={{ padding: "20px 18px", color: "var(--muted)", fontSize: 12.5, lineHeight: 1.7 }}>
                      <b style={{ color: "var(--ink)", fontSize: 13 }}>{t("sk.noPrintifyProducts")}</b>
                      {diag && <div style={{ marginTop: 4 }}>{t("sk.askShopPre")}<b>{diag.shopId}</b>{t("sk.askShopMid")}{diag.rawCount}{t("sk.askShopPost")}</div>}
                      <div style={{ marginTop: 8 }}>{t("sk.checkInOrder")}</div>
                      <div>• {t("sk.tokenHasScope")} <b>products.read</b> {t("sk.notYetToken")}</div>
                      <div>• <b>Shop ID</b> {t("sk.rightShopQ")} <b>Settings → Get shops</b>.</div>
                      <div>{t("sk.printifyProductDot")} <b>{t("sk.created")}</b> {t("sk.notEmptyDraft")}</div>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
                  <button onClick={() => setPicker(null)} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 18px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>{t("c.cancel")}</button>
                  <button onClick={syncPicker} style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 10, padding: "9px 20px", fontWeight: 800, cursor: "pointer", fontSize: 13 }}>{t("sk.save")} ({sel.size})</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {/* Chọn sản phẩm ghim cho form tạo đơn */}
      {pinPicker !== null && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(24,30,42,.5)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setPinPicker(null)}>
          <div className="modal-card" style={{ background: "#fff", borderRadius: 18, width: 620, maxWidth: "96vw", maxHeight: "88vh", display: "flex", flexDirection: "column", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <b style={{ fontSize: 16 }}>{t("sk.pickForFormLong")}</b>
              <button onClick={() => setPinPicker(null)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--muted)" }}>✕</button>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>{t("sk.pinFilterDesc")}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              <input placeholder={t("sk.searchNameSku")} value={pinQ} onChange={(e) => setPinQ(e.target.value)} style={{ ...inp, width: 240 }} />
              <button onClick={() => setPinSel((s) => new Set([...Array.from(s), ...(pinPicker ?? []).map((p) => p.product)]))} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 11px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>{t("sk.selectAll")}</button>
              <button onClick={() => setPinSel((s) => { const n = new Set(s); for (const p of pinPicker ?? []) n.delete(p.product); return n; })} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 11px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>{t("sk.deselectAll")}</button>
              <button onClick={() => setPinOnlySel((v) => !v)} style={{ background: pinOnlySel ? "#FFF6E5" : "var(--card)", border: `1px solid ${pinOnlySel ? "#F3D08A" : "var(--line)"}`, color: pinOnlySel ? "#9A6B00" : "var(--ink)", borderRadius: 8, padding: "6px 11px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}><IconPin width={12} height={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />{t("sk.onlyPinned")} ({pinSel.size})</button>
              <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>{t("sk.pinnedWord")} {pinSel.size} {t("sk.productsAbbr")}{(pinQ || pinOnlySel) ? t("sk.pinShown").replace("{n}", String(pinShown.length)) : ""}</span>
            </div>
            <div style={{ overflowY: "auto", border: "1px solid var(--line)", borderRadius: 12, flex: 1 }}>
              {pinShown.map((p) => (
                <label key={p.product} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 13px", borderBottom: "1px solid var(--line)", cursor: "pointer" }}>
                  <input type="checkbox" checked={pinSel.has(p.product)} onChange={() => togglePin(p.product)} style={{ width: 17, height: 17, cursor: "pointer" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.product}</div>
                    <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{p.count} SKU</div>
                  </div>
                </label>
              ))}
              {pinShown.length === 0 && <div style={{ padding: "20px 18px", color: "var(--muted)", fontSize: 12.5 }}>{pinOnlySel ? t("sk.noPinned") : t("sk.noProductPullFirst")}</div>}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
              <button onClick={() => setPinPicker(null)} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 18px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>{t("c.cancel")}</button>
              <button onClick={savePins} style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 10, padding: "9px 20px", fontWeight: 800, cursor: "pointer", fontSize: 13 }}>{t("sk.save")} ({pinSel.size})</button>
            </div>
          </div>
        </div>
      )}
      {/* Xóa bớt sản phẩm (nhiều variant) */}
      {delPicker !== null && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(24,30,42,.5)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !delBusy && setDelPicker(null)}>
          <div className="modal-card" style={{ background: "#fff", borderRadius: 18, width: 620, maxWidth: "96vw", maxHeight: "88vh", display: "flex", flexDirection: "column", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <b style={{ fontSize: 16, display: "inline-flex", alignItems: "center", gap: 6 }}><IconTrash width={16} height={16} />{t("sk.removeProductsTitle")}{ff?.name}</b>
              <button onClick={() => !delBusy && setDelPicker(null)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--muted)" }}>✕</button>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 12px" }}>{t("sk.tickToDelete")} <b>{t("sk.allVariantsSku")}</b> {t("sk.deleteProductDesc")}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              <input placeholder={t("sk.searchNameSku2")} value={delQ} onChange={(e) => setDelQ(e.target.value)} style={{ ...inp, width: 240 }} />
              <button onClick={() => setDelSel((s) => new Set([...Array.from(s), ...(delPicker ?? []).map((p) => p.product)]))} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 11px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>{t("sk.selectAllShown")}</button>
              <button onClick={() => setDelSel(new Set())} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 11px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>{t("sk.deselect")}</button>
              <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>{t("sk.selectedCount")} {delSel.size} {t("sk.productsAbbr")}</span>
            </div>
            <div style={{ overflowY: "auto", border: "1px solid var(--line)", borderRadius: 12, flex: 1 }}>
              {(delPicker ?? []).map((p) => (
                <label key={p.product} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 13px", borderBottom: "1px solid var(--line)", cursor: "pointer" }}>
                  <input type="checkbox" checked={delSel.has(p.product)} onChange={() => toggleDel(p.product)} style={{ width: 17, height: 17, cursor: "pointer" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.product}</div>
                    <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{p.count}{t("sk.willBeDeleted")}</div>
                  </div>
                </label>
              ))}
              {(delPicker ?? []).length === 0 && <div style={{ padding: "20px 18px", color: "var(--muted)", fontSize: 12.5 }}>{t("sk.noProducts")}</div>}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 14 }}>
              <button onClick={delAllOfFf} disabled={delBusy} style={{ background: "#fff", border: "1px solid #F3C6C0", color: "var(--red)", borderRadius: 10, padding: "9px 14px", fontWeight: 700, cursor: "pointer", fontSize: 12.5 }}>{t("sk.deleteAllBtn")} {countBy(active).toLocaleString()} SKU</button>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setDelPicker(null)} disabled={delBusy} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 18px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>{t("c.cancel")}</button>
                <button onClick={delProducts} disabled={delBusy || delSel.size === 0} style={{ background: "var(--red)", color: "#fff", border: 0, borderRadius: 10, padding: "9px 20px", fontWeight: 800, cursor: delBusy || delSel.size === 0 ? "default" : "pointer", fontSize: 13, opacity: delBusy || delSel.size === 0 ? 0.5 : 1 }}>{delBusy ? t("sk.deletingShort") : t("sk.deleteSelectedBtn").replace("{n}", String(delSel.size))}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Thêm sản phẩm Printify: blueprint → nhà in → import toàn bộ variant */}
      {addProd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(24,30,42,.5)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => { if (!importing) setAddProd(false); }}>
          <div className="modal-card" style={{ background: "#fff", borderRadius: 18, width: 680, maxWidth: "96vw", maxHeight: "88vh", display: "flex", flexDirection: "column", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <b style={{ fontSize: 16, display: "inline-flex", alignItems: "center", gap: 6 }}><IconPlus width={16} height={16} />{t("sk.addPrintifyProduct")}</b>
              <button onClick={() => !importing && setAddProd(false)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--muted)" }}>✕</button>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 12px" }}>{t("sk.pickBpProviderPull")} <b>{t("sk.pullVariantMid")}</b> {t("sk.pullVariantDesc")}</div>
            {rcLoad && <div style={{ fontSize: 12, color: "var(--blue)", marginBottom: 8 }}>{rcLoad}</div>}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, flex: 1, minHeight: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)" }}>{t("sk.step1Product")} {bps.length > 0 && <span style={{ color: "var(--faint)" }}>· {bps.length}</span>}</span>
                  <button onClick={reloadBlueprints} title={t("sk.reloadPrintify")} style={{ marginLeft: "auto", background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, padding: "3px 9px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}><IconRefresh width={12} height={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />{t("sk.refresh")}</button>
                </div>
                <input placeholder={t("sk.searchProduct")} value={bpQ} onChange={(e) => setBpQ(e.target.value)} style={{ ...inp, marginBottom: 6 }} />
                <div style={{ overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, flex: 1 }}>
                  {bps.filter((b) => !bpQ || `${b.title} ${b.brand} ${b.model ?? ""}`.toLowerCase().includes(bpQ.toLowerCase())).slice(0, 200).map((b) => (
                    <div key={b.id} onClick={() => pickBp(b.id)} style={{ padding: "6px 9px", cursor: "pointer", fontSize: 12, borderBottom: "1px solid var(--line)", background: rc.bp === b.id ? "var(--blue-soft)" : undefined }}>
                      <div style={{ fontWeight: 600 }}>{b.title}</div><div style={{ color: "var(--muted)", fontSize: 10.5 }}>{b.brand}{b.model ? " · " + b.model : ""}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)", marginBottom: 5 }}>{t("sk.step2Provider")}</div>
                <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, marginBottom: 6, cursor: "pointer", color: importAllPv ? "#2E7D46" : "var(--ink)" }}>
                  <input type="checkbox" checked={importAllPv} onChange={(e) => setImportAllPv(e.target.checked)} style={{ width: 15, height: 15 }} />
                  <IconPin width={13} height={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />{t("sk.pullAllForProduct")}
                </label>
                <div style={{ overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, flex: 1, opacity: importAllPv ? 0.45 : 1, pointerEvents: importAllPv ? "none" : "auto" }}>
                  {provs.map((p) => (
                    <div key={p.id} onClick={() => pickPv(p.id)} style={{ padding: "7px 9px", cursor: "pointer", fontSize: 12, borderBottom: "1px solid var(--line)", fontWeight: 600, background: rc.pv === p.id ? "var(--blue-soft)" : undefined }}>{p.title}</div>
                  ))}
                  {provs.length === 0 && <div style={{ padding: 12, color: "var(--faint)", fontSize: 11.5 }}>{t("sk.pickProductFirst")}</div>}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--muted)", marginRight: "auto" }}>{importAllPv ? <b style={{ color: "#2E7D46" }}>{t("sk.allProviders")}</b> : (rc.pv ? <b style={{ color: "#2E7D46" }}>{vars.length} variant</b> : "—")} {t("sk.willImport")}</span>
              <button onClick={() => !importing && setAddProd(false)} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 18px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>{t("c.cancel")}</button>
              <button onClick={importProduct} disabled={(!rc.pv && !importAllPv) || !rc.bp || importing} style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 10, padding: "9px 20px", fontWeight: 800, cursor: ((!rc.pv && !importAllPv) || importing) ? "default" : "pointer", fontSize: 13, opacity: ((!rc.pv && !importAllPv) || !rc.bp || importing) ? 0.5 : 1 }}>{importing ? t("sk.importingShort") : (importAllPv ? t("sk.importAllProviders") : `Import ${rc.pv ? vars.length : ""} variant`)}</button>
            </div>
          </div>
        </div>
      )}
      {/* Recipe picker Printify: blueprint → nhà in → variant */}
      {recipeFor && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(24,30,42,.5)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setRecipeFor(null)}>
          <div className="modal-card" style={{ background: "#fff", borderRadius: 18, width: 640, maxWidth: "96vw", maxHeight: "88vh", display: "flex", flexDirection: "column", padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <b style={{ fontSize: 16 }}>{t("sk.printConfigFor")} <span style={{ fontFamily: "ui-monospace,monospace" }}>{recipeFor.internalSku}</span></b>
              <button onClick={() => setRecipeFor(null)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--muted)" }}>✕</button>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 12px" }}>{t("sk.printifyFlowDesc")}</div>
            {rcLoad && <div style={{ fontSize: 12, color: "var(--blue)", marginBottom: 8 }}>{rcLoad}</div>}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, flex: 1, minHeight: 0 }}>
              {/* Blueprint */}
              <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)", marginBottom: 5 }}>1. Blueprint</div>
                <input placeholder={t("sk.searchShort")} value={bpQ} onChange={(e) => setBpQ(e.target.value)} style={{ ...inp, marginBottom: 6 }} />
                <div style={{ overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, flex: 1 }}>
                  {bps.filter((b) => !bpQ || `${b.title} ${b.brand} ${b.model ?? ""}`.toLowerCase().includes(bpQ.toLowerCase())).slice(0, 200).map((b) => (
                    <div key={b.id} onClick={() => pickBp(b.id)} style={{ padding: "6px 9px", cursor: "pointer", fontSize: 12, borderBottom: "1px solid var(--line)", background: rc.bp === b.id ? "var(--blue-soft)" : undefined }}>
                      <div style={{ fontWeight: 600 }}>{b.title}</div><div style={{ color: "var(--muted)", fontSize: 10.5 }}>{b.brand}{b.model ? " · " + b.model : ""}</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Provider */}
              <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)", marginBottom: 5 }}>{t("sk.step2Provider")}</div>
                <div style={{ overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, flex: 1, marginTop: 30 }}>
                  {provs.map((p) => (
                    <div key={p.id} onClick={() => pickPv(p.id)} style={{ padding: "7px 9px", cursor: "pointer", fontSize: 12, borderBottom: "1px solid var(--line)", fontWeight: 600, background: rc.pv === p.id ? "var(--blue-soft)" : undefined }}>{p.title}</div>
                  ))}
                  {provs.length === 0 && <div style={{ padding: 12, color: "var(--faint)", fontSize: 11.5 }}>{t("sk.pickBpFirst")}</div>}
                </div>
              </div>
              {/* Variant */}
              <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)", marginBottom: 5 }}>3. Variant</div>
                <div style={{ overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, flex: 1, marginTop: 30 }}>
                  {vars.map((v) => (
                    <div key={v.id} onClick={() => setRc((p) => ({ ...p, vr: v.id }))} style={{ padding: "7px 9px", cursor: "pointer", fontSize: 12, borderBottom: "1px solid var(--line)", background: rc.vr === v.id ? "var(--blue-soft)" : undefined }}>{v.title}</div>
                  ))}
                  {vars.length === 0 && <div style={{ padding: 12, color: "var(--faint)", fontSize: 11.5 }}>{t("sk.pickProviderFirst")}</div>}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14, alignItems: "center" }}>
              <span style={{ fontSize: 11.5, color: "var(--muted)", marginRight: "auto" }}>{rc.bp ? `BP ${rc.bp}` : "—"} · {rc.pv ? `PV ${rc.pv}` : "—"} · {rc.vr ? `VR ${rc.vr}` : "—"}</span>
              <button onClick={() => setRecipeFor(null)} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 18px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>{t("c.cancel")}</button>
              <button onClick={saveRecipe} style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 10, padding: "9px 20px", fontWeight: 800, cursor: "pointer", fontSize: 13 }}>{t("sk.saveConfig")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ---- Compassup: Import từ link → chọn variant → tạo mapping ----
type CuSku = { sku_id: string; label: string; image: string | null; attribute: string; weight: number; alreadyMapped?: boolean };
type CuProduct = { pid: string; productId: string; title: string; marketplace: string; sellerId: string; images: string[]; skus: CuSku[] };
function CompassupImport({ fulfillerId, onDone }: { fulfillerId: string; onDone: () => void }) {
  const inp2: CSSProperties = { padding: "8px 11px", border: "1px solid var(--line)", borderRadius: 10, font: "inherit", fontSize: 12.5 };
  const [link, setLink] = useState("");
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState<CuProduct | null>(null);
  const [rows, setRows] = useState<Record<string, { on: boolean; internalSku: string; baseCost: string; shipCost: string; weight: string; custom: boolean }>>({});
  const [msg, setMsg] = useState("");

  const fetchVariants = async () => {
    if (!link.trim()) return;
    setLoading(true); setMsg(""); setProduct(null);
    const j = await fetch("/api/fulfillers/compassup-import-skus", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fulfillerId, link: link.trim() }),
    }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setLoading(false);
    if (!j.ok) { setMsg("✗ " + (j.error ?? "error")); return; }
    const p = j.product as CuProduct;
    setProduct(p);
    const init: typeof rows = {};
    for (const s of p.skus) init[s.sku_id] = { on: false, internalSku: "", baseCost: "", shipCost: "0", weight: String(s.weight || ""), custom: false };
    setRows(init);
  };

  const save = async () => {
    if (!product) return;
    const picked = product.skus.filter((s) => rows[s.sku_id]?.on).map((s) => ({
      skuId: s.sku_id, internalSku: rows[s.sku_id].internalSku.trim(),
      baseCost: Number(rows[s.sku_id].baseCost || 0), shipCost: Number(rows[s.sku_id].shipCost || 0),
      weight: Number(rows[s.sku_id].weight || s.weight || 0), attribute: s.attribute, image: s.image ?? "", productName: product.title, custom: !!rows[s.sku_id].custom,
    }));
    if (!picked.length) { setMsg("Select at least 1 variant"); return; }
    // Base cost KHÔNG bắt buộc: Compassup /product/detail không trả giá; poll /orders/fees sẽ
    // kéo giá THẬT sau khi đẩy đơn. Để trống = 0 (ước tính), giá thật ghi đè sau.
    if (picked.some((r) => !r.internalSku)) { setMsg("Fill Internal SKU for selected variants"); return; }
    setLoading(true);
    const j = await fetch("/api/fulfillers/compassup-import-skus", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fulfillerId, link: link.trim(), rows: picked }),
    }).then((r) => r.json()).catch(() => ({ ok: false }));
    setLoading(false);
    setMsg(j.ok ? `✓ Created ${j.created} mapping(s)` : "✗ " + (j.errors?.join("; ") ?? "error"));
    if (j.created) onDone();
  };

  const randSku = () => "CU-" + Math.random().toString(36).slice(2, 8).toUpperCase();
  const setR = (id: string, k: string, v: string | boolean) => setRows((p) => ({ ...p, [id]: { ...p[id], [k]: v } }));
  // Khi bật 1 variant mà chưa có Internal SKU → tự điền mã ngẫu nhiên (bỏ khâu gõ tay)
  const toggleOn = (id: string, on: boolean) => setRows((p) => ({ ...p, [id]: { ...p[id], on, internalSku: on && !p[id]?.internalSku ? randSku() : p[id]?.internalSku } }));
  // Tick/bỏ tất cả variant CHƯA map cùng lúc (tự sinh Internal SKU cho variant được bật)
  const toggleAll = (on: boolean) => setRows((p) => {
    const n = { ...p };
    for (const sk of (product?.skus ?? [])) {
      if (sk.alreadyMapped) continue;
      n[sk.sku_id] = { ...n[sk.sku_id], on, internalSku: on && !n[sk.sku_id]?.internalSku ? randSku() : n[sk.sku_id]?.internalSku };
    }
    return n;
  });

  return (
    <div style={{ marginTop: 10, border: "1px solid #BFE0BF", background: "#F6FBF6", borderRadius: 12, padding: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input placeholder="Paste sourcing.compassup.com/product/… link" value={link} onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") fetchVariants(); }} style={{ ...inp2, flex: 1, minWidth: 280 }} />
        <button type="button" onClick={fetchVariants} disabled={loading}
          style={{ background: "#2E7D46", border: 0, color: "#fff", borderRadius: 10, padding: "8px 16px", fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}>
          {loading ? "Loading…" : "Get variants"}
        </button>
      </div>

      {product && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>{product.title}</span>
            <span style={{ fontWeight: 500, color: "var(--muted)" }}>· {product.marketplace} · seller {product.sellerId.slice(0, 12)}…</span>
            {(() => {
              const selectable = product.skus.filter((s) => !s.alreadyMapped);
              const allOn = selectable.length > 0 && selectable.every((s) => rows[s.sku_id]?.on);
              return (
                <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, cursor: "pointer", color: "var(--blue)" }}>
                  <input type="checkbox" checked={allOn} onChange={(e) => toggleAll(e.target.checked)} />
                  {allOn ? "Clear all" : `Select all (${selectable.length})`}
                </label>
              );
            })()}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {product.skus.map((s) => {
              const r = rows[s.sku_id]; const off = s.alreadyMapped || !r?.on;
              return (
                <div key={s.sku_id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", opacity: s.alreadyMapped ? 0.5 : 1 }}>
                  <input type="checkbox" checked={!!r?.on} disabled={s.alreadyMapped} onChange={(e) => toggleOn(s.sku_id, e.target.checked)} style={{ width: 15, height: 15 }} />
                  {s.image
                    ? <img src={s.image} alt="" referrerPolicy="no-referrer" loading="lazy"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                        style={{ width: 34, height: 34, borderRadius: 6, objectFit: "cover", background: "#EEF1F4" }} />
                    : <div style={{ width: 34, height: 34, borderRadius: 6, background: "#EEF1F4" }} />}
                  <span style={{ fontSize: 12, minWidth: 140, flex: 1 }}>{s.label}{s.alreadyMapped && <span style={{ color: "var(--green)", marginLeft: 6, fontSize: 11 }}>mapped</span>}</span>
                  <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                    <input placeholder="Internal SKU" value={r?.internalSku ?? ""} disabled={off} onChange={(e) => setR(s.sku_id, "internalSku", e.target.value)} style={{ ...inp2, width: 118 }} />
                    <button type="button" disabled={off} onClick={() => setR(s.sku_id, "internalSku", randSku())} title="Generate random SKU"
                      style={{ border: "1px solid var(--line)", background: "var(--card)", borderRadius: 8, padding: "6px 8px", cursor: off ? "default" : "pointer", fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>⟳</button>
                  </div>
                  <input placeholder="Base $ (auto)" title="Để trống — giá thật tự về sau khi đẩy đơn (từ Compassup /orders/fees)" value={r?.baseCost ?? ""} disabled={off} onChange={(e) => setR(s.sku_id, "baseCost", e.target.value)} style={{ ...inp2, width: 92 }} />
                  <input placeholder="Ship $" value={r?.shipCost ?? ""} disabled={off} onChange={(e) => setR(s.sku_id, "shipCost", e.target.value)} style={{ ...inp2, width: 70 }} />
                  <input placeholder="Weight kg" value={r?.weight ?? ""} disabled={off} onChange={(e) => setR(s.sku_id, "weight", e.target.value)} style={{ ...inp2, width: 78 }} title="Estimated weight (kg) used when creating the order" />
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: off ? "var(--faint)" : "var(--ink)", fontWeight: 700 }} title="Custom (embroidery/personalized) — order must have a design attached">
                    <input type="checkbox" checked={!!r?.custom} disabled={off} onChange={(e) => setR(s.sku_id, "custom", e.target.checked)} /> Custom
                  </label>
                </div>
              );
            })}
          </div>
          <button type="button" onClick={save} disabled={loading}
            style={{ marginTop: 10, background: "var(--blue)", color: "#fff", border: "none", borderRadius: 10, padding: "8px 18px", fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}>
            Create mapping for selected variants
          </button>
        </div>
      )}
      {msg && <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: msg.startsWith("✗") ? "var(--red)" : "var(--green)" }}>{msg}</div>}
    </div>
  );
}
