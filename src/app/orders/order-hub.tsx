"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Flash } from "@/components/flash";
import { decodeEntities, splitVariant, type VariantPart } from "@/lib/variant-display";
import { useSearchParams } from "next/navigation";
import DateRangePicker, { rangeToDates, RangeValue } from "@/components/date-range";
import { useLang } from "@/components/lang-provider";
import { useConfirm, usePrompt } from "@/components/confirm-provider";
import { MarketplaceLogo } from "@/components/marketplace-logo";
import { SupplierLogo } from "@/components/supplier-logo";
import { IconCopy, IconPin, IconTruck, IconTrash, IconUpload, IconWarn, IconDownload, IconReport, IconCheck, IconPencil, IconRefresh, IconSend, IconLink } from "@/components/icons";

type Item = {
  id: string; product_title: string; internal_sku: string | null; qty: number; unit_price: string;
  design_id: string | null; design_sku: number | null; design_title: string | null; personalization: string | null;
  special_print: boolean; designThumb: string | null; mockupUrl: string | null;
  imageUrl?: string | null; productUrl?: string | null; variant?: string | null;
  designSides?: { kind: string; label: string; thumb: string | null; original: string | null }[];
  suggests?: Suggest[];
  custom?: boolean;
  baseDesign?: Suggest | null;
};
type Suggest = {
  designId: string; skuCode: number; title: string; thumb: string | null;
  reason: "listing" | "sku" | "name"; hits?: number; score?: number;
};
const REASON_STYLE: Record<Suggest["reason"], { bg: string; fg: string }> = {
  listing: { bg: "#EAF3EA", fg: "#2E7D46" },
  sku: { bg: "#EAF0F8", fg: "#2F5B99" },
  name: { bg: "var(--line)", fg: "var(--muted)" },
};

// Badge lý do gợi ý: seller nhìn là biết tin được tới đâu, không phải mở design ra soi.
function reasonBadge(sg: Suggest, t: (k: string) => string) {
  const st = REASON_STYLE[sg.reason];
  const label =
    sg.reason === "listing" ? t("o.matchListingBadge")
    : sg.reason === "sku" ? t("o.matchSkuBadge")
    : `${t("o.matchNameBadge")} ${Math.round((sg.score ?? 0) * 100)}%`;
  const hits = sg.reason !== "name" && (sg.hits ?? 0) > 1 ? ` · ${sg.hits}\u00d7` : "";
  return (
    <span style={{ background: st.bg, color: st.fg, borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 800 }}>
      {label}{hits}
    </span>
  );
}

type TtLabelUi = { packageId: string; trackingNumber?: string; key: string; url: string | null; fetchedAt: string };

// Nút lấy label TikTok Shipping + hiện link R2 để gửi supplier. Tự quản state, không đụng list cha.
function TiktokLabelButton({ orderId, initial, onFlash }: { orderId: string; initial?: TtLabelUi[] | null; onFlash: (m: string) => void }) {
  const [labels, setLabels] = useState<TtLabelUi[]>(initial ?? []);
  const [busy, setBusy] = useState(false);
  const fetchLabel = async () => {
    setBusy(true);
    const j = await fetch("/api/tiktok/get-label", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setBusy(false);
    if (j.ok) { setLabels(j.labels ?? []); onFlash(`✓ Got ${j.labels?.length ?? 0} label(s)`); }
    else onFlash("✗ " + (j.reason ?? j.error ?? "Error"));
  };
  const copy = (v: string) => { navigator.clipboard?.writeText(v); onFlash("✓ Copied"); };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {labels.length ? labels.map((l) => (
        <span key={l.packageId} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, background: "#EAF3EA", border: "1px solid #BFE0BF", borderRadius: 8, padding: "2px 7px" }}>
          {l.url ? <a href={l.url} target="_blank" rel="noreferrer" style={{ color: "#2E7D46", fontWeight: 700, textDecoration: "none" }}>Label PDF ↗</a> : <span style={{ color: "var(--muted)" }}>label (no url)</span>}
          {l.url && <button onClick={() => copy(l.url!)} style={{ border: 0, background: "transparent", cursor: "pointer", color: "#2E7D46", fontWeight: 700, fontSize: 11 }}>copy</button>}
          {l.trackingNumber && <span style={{ color: "var(--muted)" }}>#{l.trackingNumber}</span>}
          <button onClick={fetchLabel} disabled={busy} title="Refresh label" style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--muted)", fontSize: 12 }}>{busy ? "…" : "↻"}</button>
        </span>
      )) : (
        <button onClick={fetchLabel} disabled={busy} style={{ background: "#111", color: "#fff", border: 0, borderRadius: 8, padding: "3px 9px", fontSize: 11.5, fontWeight: 800, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
          {busy ? "…" : "Get label"}
        </button>
      )}
    </span>
  );
}

type Order = {
  id: string; external_id: string; platform: string; status: string; ordered_at: string;
  buyer_first: string | null; buyer_last: string | null;
  addr1: string | null; addr2: string | null; city: string | null; state: string | null; zip: string | null; country: string;
  total: string; platform_fee: string; seller_name: string | null; store_name: string | null; order_label: string | null; note: string | null; shipping_type?: string | null;
  tiktok_labels?: { packageId: string; trackingNumber?: string; key: string; url: string | null; fetchedAt: string }[] | null;
  items: Item[];
};
type DetailItem = Item & { mappings: Record<string, { fulfillerSku: string; unitCost: number }> };
type Variant = { id: string; fulfillerSku: string; internalSku: string; unitCost: number; style: string; provider: string; color: string; size: string; variant: string };
type Detail = { storeName?: string | null; order: Order & Record<string, unknown>; items: DetailItem[]; fulfillerOptions: { fulfillerId: string; name: string; mapped: boolean; nonPod?: boolean; gsheet?: boolean; estCost: number | null }[]; catalog: Record<string, Variant[]>; ffOrders?: FfOrder[]; hideProfit?: boolean };
type Opt = { id: string; name: string; marketplace?: string };
type FfOrder = { id: string; fulfillerId?: string; fulfillerName: string; status: string; pushedAt?: string | null; trackingNumber: string | null; trackingCarrier: string | null; trackingUrl: string | null; supplierOrderUrl: string | null; externalFfId: string | null; cost: string | null; baseCost: string | null; shipCost: string | null; extraFee: string | null; lines?: { itemId?: string; mappingId?: string; product: string; variant: string | null; sku: string; qty: number }[] | null };

const STATUS_COLORS: Record<string, string> = {
  new: "#1D5FAE", created: "#D9935B", in_production: "#4F9E93", shipped: "#8FAF5C",
  delivered: "#7C6FC0", has_issues: "#C06B82", cancel: "#BBA054",
};
const FF_STATUS_COLORS: Record<string, string> = {
  pending: "#8A93A6", pushed: "#D9935B", in_production: "#4F9E93", shipped: "#8FAF5C",
  delivered: "#5E86C9", error: "#C0392B", cancelled: "#8A93A6",
};
const fmtDateTime = (v: string | null | undefined) => { if (!v) return ""; const d = new Date(v); return isNaN(d.getTime()) ? "" : d.toLocaleString(); };
const IMPORT_ITEM: CSSProperties = { display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "9px 10px", background: "none", border: "none", borderRadius: 9, cursor: "pointer", fontSize: 13.5 };
const IMPORT_SUB: CSSProperties = { fontSize: 11, color: "var(--muted)", fontWeight: 400, marginTop: 1 };
const SIDE_KEY: Record<string, string> = { design_front: "d.kindFront", design_back: "d.kindBack", mockup: "d.kindMockup", video: "d.kindVideo" };
const money = (n: number | string) => "$" + Number(n).toFixed(2);
const cleanName = (v: string | null | undefined) => (v ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
// Link tra cứu tracking theo hãng vận chuyển
function trackingUrl(carrier: string | null, num: string): string {
  const c = (carrier ?? "").toLowerCase();
  if (c.includes("usps")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${num}`;
  if (c.includes("ups")) return `https://www.ups.com/track?tracknum=${num}`;
  if (c.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${num}`;
  if (c.includes("dhl")) return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${num}`;
  return `https://parcelsapp.com/en/tracking/${num}`;
}

export default function OrderHub({ canEdit = true, canPushFf = true, isAdmin = false, canChangeStatus = false }: { canEdit?: boolean; canPushFf?: boolean; ownOnly?: boolean; isAdmin?: boolean; canChangeStatus?: boolean }) {
  const searchParams = useSearchParams();
  const [data, setData] = useState<{ orders: Order[]; counts: Record<string, number>; total: number; sellers: { id: string; name: string }[]; stores: Opt[]; fulfillers: { id: string; name: string }[] } | null>(null);
  // Khởi tạo trạng thái ngay từ URL (?status=new) để chỉ gọi API 1 lần đúng bộ lọc, tránh race đè dữ liệu
  const [status, setStatus] = useState(() => {
    const s = searchParams.get("status");
    return s && s in STATUS_COLORS ? s : "";
  });
  const [sellerId, setSellerId] = useState("");
  const [storeId, setStoreId] = useState("");
  const { t } = useLang();
  const confirm = useConfirm();
  const copyText = (v: string) => { navigator.clipboard?.writeText(v); flash(t("d.copied")); };
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState("");
  const [fulfillerId, setFulfillerId] = useState("");
  const [designF, setDesignF] = useState(""); // "" | assigned | unassigned
  const [dr, setDr] = useState<RangeValue | null>({ range: "30d" });
  const [page, setPage] = useState(1); const [show, setShow] = useState(20);
  const [msg, setMsg] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showEtsy, setShowEtsy] = useState(false);
  const [showTiktok, setShowTiktok] = useState(false);
  const [importMenu, setImportMenu] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const excelRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false); // nút đồng bộ tay: ép poll TẤT CẢ nhà in (bỏ throttle 10')
  const [selIds, setSelIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("shipped");
  // Duplicate: hộp xác nhận + sửa Order label. PHẢI khai ở đây, cùng cụm hook —
  // đặt sau `if (!data) return ...` sẽ khiến số hook đổi giữa các lần render (React error #310).
  const [dupFor, setDupFor] = useState<{ id: string; label: string } | null>(null);
  const [showTtTracking, setShowTtTracking] = useState(false);

  const reqSeq = useRef(0);
  const load = useCallback(async () => {
    const my = ++reqSeq.current;
    const p = new URLSearchParams({ page: String(page), show: String(show) });
    if (status) p.set("status", status);
    if (sellerId) p.set("sellerId", sellerId);
    if (storeId) p.set("storeId", storeId);
    if (q) p.set("q", q);
    if (platform) p.set("platform", platform);
    if (fulfillerId) p.set("fulfillerId", fulfillerId);
    if (designF) p.set("design", designF);
    if (dr) { const d = rangeToDates(dr); p.set("from", d.from); p.set("to", d.to); }
    const j = await fetch(`/api/orders?${p}`).then((r) => r.json());
    if (my !== reqSeq.current) return; // bỏ response cũ nếu đã có request mới hơn
    if (j.ok) setData(j);
  }, [page, show, status, sellerId, storeId, q, platform, fulfillerId, designF, dr]);
  useEffect(() => { load(); }, [load]);
  // AUTO-SYNC NGẦM: kéo trạng thái · tracking · chi phí từ TẤT CẢ nhà in.
  // Chạy ngay khi mở trang, rồi lặp mỗi 60s. Server tự throttle (FF_POLL_THROTTLE_MS, mặc định 2')
  // nên gọi dày vẫn an toàn — không đập vào rate limit của nhà in.
  // Tạm dừng khi tab bị ẩn (đỡ tốn invocation Vercel), chạy lại ngay khi quay lại tab.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (stop || document.hidden) return;
      try {
        const j = await fetch("/api/fulfillment/printway-sync", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
        }).then((r) => r.json());
        if (!stop && j?.updated > 0) load();
      } catch { /* im lặng — poll ngầm không được làm phiền người dùng */ }
    };
    tick();
    const id = setInterval(tick, 60_000);
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data) return <div className="panel empty">{t("o.loadingOrders")}</div>;
  const all = Object.values(data.counts).reduce((a, b) => a + b, 0);
  const pages = Math.max(Math.ceil(data.total / show), 1);
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2500); };

  // Ép đồng bộ NGAY (bỏ throttle 10') cho cả 6 nhà in:
  // Printway · Printify · Merchize · ONOS · Wembroidery · FlashShip
  const syncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    const j = await fetch("/api/fulfillment/printway-sync", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }),
    }).then((r) => r.json()).catch(() => ({ ok: false }));
    setSyncing(false);
    if (!j?.ok) { flash("✗ " + t("o.syncFailed")); return; }
    const n = Number(j.updated ?? 0);
    flash(n > 0 ? t("o.syncedN").replace("{n}", String(n)) : t("o.syncedNone"));
    if (n > 0) load();
  };

  const cloneOrder = async (id: string, orderLabel: string) => {
    const j = await fetch(`/api/orders/${id}/clone`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderLabel }),
    }).then((r) => r.json()).catch(() => ({ ok: false }));
    setDupFor(null);
    if (j.ok) { flash(t("o.cloned") + j.order.externalId); load(); } else flash("✗ " + (j.error ?? t("o.errorWord")));
  };
  const toggleSel = (id: string) => {
    const n = new Set(selIds);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelIds(n);
  };
  const applyBulk = async () => {
    if (!selIds.size) return;
    if (bulkStatus === "cancel" && !(await confirm({ message: t("o.bulkTrashConfirm").replace("{n}", String(selIds.size)), danger: true }))) return;
    const j = await fetch("/api/orders/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(selIds), status: bulkStatus }) }).then((r) => r.json());
    if (j.ok) { flash(t("o.bulkChanged").replace("{n}", String(j.updated)).replace("{st}", bulkStatus.toUpperCase()) + (j.refunded ? t("o.refundedSuffix").replace("{n}", String(j.refunded)) : "") + (j.skipped ? t("o.skippedSuffix").replace("{n}", String(j.skipped)) : "")); setSelIds(new Set()); load(); }
    else flash("✗ " + (j.error ?? t("o.errorWord")));
  };

  return (
    <>
      <Flash msg={msg} />

      {/* Page head: tiêu đề + hàng nút (theo FusionDNPrint) */}
      <div className="page-head">
        <div className="page-actions">
          <DateRangePicker value={dr ?? { range: "" }} onChange={setDr} align="right" allowClear onClear={() => setDr(null)} />
          <div style={{ position: "relative" }}>
            <button onClick={() => setExportMenu((v) => !v)} className="btn btn-outline"><IconUpload width={14} height={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />{t("c.export")} ▾</button>
            {exportMenu && (<>
              <div onClick={() => setExportMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
              <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 41, background: "#fff", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "0 10px 28px rgba(20,30,50,.14)", minWidth: 300, overflow: "hidden", padding: 6 }}>
                <div style={{ padding: "6px 10px 4px", fontSize: 10.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".4px" }}>Excel</div>
                <a href={`/api/orders/export${status ? `?status=${status}` : ""}`} onClick={() => setExportMenu(false)} style={{ ...IMPORT_ITEM, textDecoration: "none", color: "var(--ink)" }}>
                  <span style={{ fontSize: 19, width: 20, textAlign: "center", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><IconReport width={17} height={17} /></span><div style={{ textAlign: "left" }}><b>{t("o.allOrders")}</b><div style={IMPORT_SUB}>{t("o.withCostTracking")}</div></div>
                </a>
                <a href={`/api/orders/export?complete=1${status ? `&status=${status}` : ""}`} onClick={() => setExportMenu(false)} style={{ ...IMPORT_ITEM, textDecoration: "none", color: "var(--ink)" }}>
                  <span style={{ fontSize: 19, width: 20, textAlign: "center", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><IconCheck width={17} height={17} /></span><div style={{ textAlign: "left" }}><b>{t("o.onlyEligible")}</b><div style={IMPORT_SUB}>{t("o.eligibleDesc")}</div></div>
                </a>
                <div style={{ borderTop: "1px solid var(--line)", margin: "6px 0 4px", padding: "8px 10px 0", fontSize: 10.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".4px" }}>TikTok Shop</div>
                <button onClick={() => { setExportMenu(false); setShowTtTracking(true); }} style={{ ...IMPORT_ITEM }}>
                  <MarketplaceLogo mk="tiktok" size={20} />
                  <div style={{ textAlign: "left" }}><b>Tracking upload template</b><div style={IMPORT_SUB}>Shipment info file — pick a store, bulk upload in Seller Center</div></div>
                </button>
                <div style={{ borderTop: "1px solid var(--line)", margin: "6px 0 4px", padding: "8px 10px 0", fontSize: 10.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".4px" }}>{t("o.printerNoApi")}</div>
                {["Printway", "Wembroidery", "Flashship", "Onospod"].map((s) => (
                  <button key={s} disabled style={{ ...IMPORT_ITEM, opacity: .5, cursor: "default" }}>
                    <SupplierLogo name={s} size={18} /><div style={{ textAlign: "left" }}><b>{s}</b><div style={IMPORT_SUB}>{t("o.ownTemplateSoon")}</div></div>
                  </button>
                ))}
              </div>
            </>)}
          </div>
          {canPushFf && (
            <button onClick={syncNow} disabled={syncing} className="btn btn-outline" title={t("o.syncNowHint")}
              aria-label={t("o.syncNow")}
              style={{
                opacity: syncing ? 0.6 : 1, cursor: syncing ? "default" : "pointer",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 38, height: 38, padding: 0,
              }}>
              <IconRefresh width={16} height={16} style={{ animation: syncing ? "spin 1s linear infinite" : undefined }} />
            </button>
          )}
          {canEdit && (
            <div style={{ position: "relative" }}>
              <button onClick={() => setImportMenu((v) => !v)} className="btn btn-outline">{importing ? t("c.loading") : <><IconDownload width={14} height={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />{t("c.import")} {t("o.ordersWord")} ▾</>}</button>
              {importMenu && (<>
                <div onClick={() => setImportMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 41, background: "#fff", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "0 10px 28px rgba(20,30,50,.14)", minWidth: 264, overflow: "hidden", padding: 6 }}>
                  <div style={{ padding: "6px 10px 4px", fontSize: 10.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".4px" }}>Marketplace</div>
                  <button onClick={() => { setImportMenu(false); setShowEtsy(true); }} style={IMPORT_ITEM}>
                    <MarketplaceLogo mk="etsy" size={20} /><div style={{ textAlign: "left" }}><b>Etsy</b><div style={IMPORT_SUB}>{t("o.createFromCsv")}</div></div>
                  </button>
                  <button onClick={() => { setImportMenu(false); setShowTiktok(true); }} style={IMPORT_ITEM}>
                    <MarketplaceLogo mk="tiktok" size={20} /><div style={{ textAlign: "left" }}><b>TikTok Shop</b><div style={IMPORT_SUB}>{t("o.createFromCsvToShip")}</div></div>
                  </button>
                  <button disabled style={{ ...IMPORT_ITEM, opacity: .5, cursor: "default" }}>
                    <MarketplaceLogo mk="amazon" size={20} /><div style={{ textAlign: "left" }}><b>Amazon</b><div style={IMPORT_SUB}>{t("o.comingSoon")}</div></div>
                  </button>
                  <div style={{ borderTop: "1px solid var(--line)", margin: "6px 0 4px", padding: "8px 10px 0", fontSize: 10.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".4px" }}>{t("o.otherWord")}</div>
                  <button onClick={() => { setImportMenu(false); excelRef.current?.click(); }} style={IMPORT_ITEM}>
                    <span style={{ fontSize: 19, width: 20, textAlign: "center", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><IconReport width={17} height={17} /></span><div style={{ textAlign: "left" }}><b>{t("o.excelUpdate")}</b><div style={IMPORT_SUB}>{t("o.trackingCostExisting")}</div></div>
                  </button>
                </div>
              </>)}
              <input ref={excelRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} disabled={importing}
                onChange={async (e) => {
                  const file = e.target.files?.[0]; if (!file) return;
                  setImporting(true);
                  const fd = new FormData(); fd.append("file", file);
                  const j = await fetch("/api/orders/import", { method: "POST", body: fd }).then((r) => r.json()).catch(() => ({ ok: false, error: t("o.netError") }));
                  setImporting(false); e.target.value = "";
                  if (j.ok) {
                    flash(t("o.excelResult").replace("{rows}", String(j.rows)).replace("{t}", String(j.trackingUpdated)).replace("{c}", String(j.costUpdated)) + (j.errors?.length ? t("o.errorsSuffix").replace("{n}", String(j.errors.length)) : ""));
                    if (j.errors?.length) await confirm({ message: t("o.importErrLines") + j.errors.join("\n"), info: true });
                    load();
                  } else flash("✗ " + (j.error ?? t("o.importError")));
                }} />
            </div>
          )}
          {canEdit && <button onClick={() => setShowCreate(true)} className="btn btn-primary">{t("o.createOrder")}</button>}
        </div>
      </div>

      {/* Bộ lọc dạng field có label */}
      <div className="card" style={{ padding: "16px 18px", marginBottom: 14 }}>
        <div className="filters">
          <div className="field" style={{ gridColumn: "span 2" }}>
            <label>{t("c.search")}</label>
            <input placeholder={t("o.searchPlaceholder")} value={q}
              onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (setPage(1), load())} />
          </div>
          {data.sellers.length > 0 && (
            <div className="field">
              <label>{t("c.seller")}</label>
              <select value={sellerId} onChange={(e) => { setSellerId(e.target.value); setPage(1); }}>
                <option value="">{t("o.allWord")}</option>
                {data.sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label>{t("c.store")}</label>
            <select value={storeId} onChange={(e) => { setStoreId(e.target.value); setPage(1); }}>
              <option value="">{t("o.allWord")}</option>
              {data.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>{t("c.marketplace")}</label>
            <select value={platform} onChange={(e) => { setPlatform(e.target.value); setPage(1); }}>
              <option value="">{t("o.allWord")}</option>
              <option value="tiktok">TikTok</option><option value="amazon">Amazon</option><option value="etsy">Etsy</option>
            </select>
          </div>
          <div className="field">
            <label>{t("c.supplier")}</label>
            <select value={fulfillerId} onChange={(e) => { setFulfillerId(e.target.value); setPage(1); }}>
              <option value="">{t("o.allWord")}</option>
              {(data.fulfillers ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>{t("o.designFilter")}</label>
            <select value={designF} onChange={(e) => { setDesignF(e.target.value); setPage(1); }}>
              <option value="">{t("o.allWord")}</option>
              <option value="assigned">{t("o.designAssigned")}</option>
              <option value="unassigned">{t("o.designUnassigned")}</option>
            </select>
          </div>
        </div>

        {/* Pills trạng thái — mỗi status một màu */}
        <div className="otabs">
          <button className={`otab${!status ? " on" : ""}`} onClick={() => { setStatus(""); setPage(1); }}>All ({all})</button>
          {Object.keys(STATUS_COLORS).map((st) => {
            const c = STATUS_COLORS[st];
            const on = status === st;
            return (
              <button key={st} className="otab" onClick={() => { setStatus(st); setPage(1); }}
                style={{ border: `1.5px solid ${c}`, background: on ? c : "#fff", color: on ? "#fff" : c, display: "inline-flex", alignItems: "center", gap: 7 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: on ? "#fff" : c, flexShrink: 0 }} />
                {st.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase())} ({data.counts[st] ?? 0})
              </button>
            );
          })}
        </div>
      </div>

      {/* Thanh bulk khi có đơn được chọn */}
      {selIds.size > 0 && (canEdit || canChangeStatus) && (
        <div className="card" style={{ position: "sticky", top: 8, zIndex: 40, padding: "10px 16px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", border: "1.5px solid var(--blue)" }}>
          <b style={{ fontSize: 13.5 }}>{t("o.ordersSelected").replace("{n}", String(selIds.size))}</b>
          {canChangeStatus && <>
          <span style={{ width: 1, height: 22, background: "var(--line)" }} />
          <span style={{ fontSize: 13 }}>{t("o.changeStatusLabel")}</span>
          <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} style={inp}>
            {Object.keys(STATUS_COLORS).map((st) => <option key={st} value={st}>{st.toUpperCase()}</option>)}
          </select>
          <button onClick={applyBulk} style={btnBlue}>{t("o.apply")}</button>
          </>}
          <span style={{ width: 1, height: 22, background: "var(--line)" }} />
          <a href={`/api/orders/export?ids=${Array.from(selIds).join(",")}`} style={{ ...btnGhost, textDecoration: "none" }}>{t("o.exportN").replace("{n}", String(selIds.size))}</a>
          <button onClick={() => setSelIds(new Set())} style={{ ...btnGhost, marginLeft: "auto" }}>{t("o.deselectAll")}</button>
        </div>
      )}

      {/* Chọn cả trang */}
      {canEdit && data.orders.length > 0 && (
        <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, marginBottom: 8, cursor: "pointer", color: "var(--muted)" }}>
          <input type="checkbox"
            checked={data.orders.every((o) => selIds.has(o.id))}
            onChange={(e) => {
              const n = new Set(selIds);
              for (const o of data.orders) e.target.checked ? n.add(o.id) : n.delete(o.id);
              setSelIds(n);
            }} />
          {t("o.selectPage")} ({data.orders.length})
        </label>
      )}

      {/* Phân trang trên */}
      <Pager page={page} pages={pages} setPage={setPage} show={show} setShow={(n) => { setShow(n); setPage(1); }} total={data.total} />

      {/* Cards */}
      {data.orders.map((o) => (
        <OrderCard key={o.id} o={o} canEdit={canEdit} canPushFf={canPushFf} isAdmin={isAdmin}
          selected={selIds.has(o.id)} onToggleSel={() => toggleSel(o.id)}
          reload={load} flash={flash} openDup={(id, label) => setDupFor({ id, label })} copyText={copyText}
          fulfillers={data.fulfillers} />
      ))}
      {!data.orders.length && <div className="panel empty" style={{ marginTop: 12 }}>{t("o.noMatch")}</div>}

      <div style={{ marginTop: 12 }}>
        <Pager page={page} pages={pages} setPage={setPage} show={show} setShow={(n) => { setShow(n); setPage(1); }} total={data.total} />
      </div>


      {showCreate && <CreateOrderModal close={() => setShowCreate(false)} reload={load} flash={flash} sellers={data.sellers} stores={data.stores} />}
      {dupFor && <DuplicateModal init={dupFor} close={() => setDupFor(null)} onConfirm={cloneOrder} />}
      {showTtTracking && <TtTrackingModal close={() => setShowTtTracking(false)} flash={flash} stores={data.stores} dr={dr} />}
      {showEtsy && <EtsyImportModal close={() => setShowEtsy(false)} reload={load} flash={flash} sellers={data.sellers} stores={data.stores} />}
      {showTiktok && <TikTokImportModal close={() => setShowTiktok(false)} reload={load} flash={flash} sellers={data.sellers} stores={data.stores} />}
    </>
  );
}

function VariantPicker({ fulfillerId, seed, line, setLine, label }: {
  fulfillerId: string; seed: Variant[]; line: { mappingId: string; qty: number; unitCost?: number };
  setLine: (v: { mappingId: string; qty: number; unitCost?: number }) => void; label?: string;
}) {
  const { t } = useLang();
  const [q, setQ] = useState("");
  const [fetched, setFetched] = useState<Variant[]>([]);
  const [styleList, setStyleList] = useState<string[]>([]);
  const [selStyle, setSelStyle] = useState("");
  const [loading, setLoading] = useState(false);

  // Đổi nhà fulfill → reset lựa chọn
  useEffect(() => {
    setQ(""); setFetched([]); setSelStyle("");
  }, [fulfillerId]);

  // Nạp DANH SÁCH SẢN PHẨM cho dropdown Style — tìm ở SERVER theo ô lọc (không giới hạn số SP)
  useEffect(() => {
    if (!fulfillerId) { setStyleList([]); return; }
    const query = q.trim();
    const t = setTimeout(() => {
      fetch(`/api/fulfillers/variants?ff=${fulfillerId}&styles=1&pinned=1${query ? `&q=${encodeURIComponent(query)}` : ""}`)
        .then((r) => r.json()).then((j) => setStyleList(j?.ok ? (j.styles as string[]) : [])).catch(() => setStyleList([]));
    }, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [fulfillerId, q]);

  // Chọn 1 STYLE → nạp variant của đúng sản phẩm đó (mọi nhà in / màu / size)
  const selectStyle = async (style: string) => {
    setSelStyle(style);
    setLine({ ...line, mappingId: "", unitCost: undefined });
    if (!style || !fulfillerId) { setFetched([]); return; }
    setLoading(true);
    const j = await fetch(`/api/fulfillers/variants?ff=${fulfillerId}&product=${encodeURIComponent(style)}`).then((r) => r.json()).catch(() => null);
    setFetched(j?.ok ? (j.variants as Variant[]) : []);
    setLoading(false);
  };

  // Gộp seed (variant khớp sẵn đơn) + variant của style đã chọn, khử trùng theo id
  const byId = new Map<string, Variant>();
  for (const vv of seed) byId.set(vv.id, vv);
  for (const vv of fetched) if (!byId.has(vv.id)) byId.set(vv.id, vv);
  const variants = Array.from(byId.values());

  const uniq = (a: string[]) => Array.from(new Set(a.filter(Boolean)));
  const cur = variants.find((v) => v.id === line.mappingId);
  const hasProvider = variants.some((v) => v.provider); // Merchize: không → ẩn cột Provider
  const style = selStyle || cur?.style || "";
  const provider = cur?.provider ?? "";
  const color = cur?.color ?? "";
  const size = cur?.size ?? "";
  const meaningful = (x: string) => !!x && x !== "—";
  // Dropdown Style = danh sách sản phẩm (lọc theo ô tìm); fallback về style trong variants nếu chưa có list
  const allStyles = uniq([...(styleList.length ? styleList : variants.map((v) => v.style)), ...variants.map((v) => v.style)]);
  const styles = allStyles.filter((s) => !q.trim() || s.toLowerCase().includes(q.trim().toLowerCase()));
  const providers = uniq(variants.filter((v) => v.style === style).map((v) => v.provider));
  const afterProv = (v: Variant) => v.style === style && (!hasProvider || v.provider === provider);
  const colors = uniq(variants.filter(afterProv).map((v) => v.color)).filter(meaningful);
  const sizes = uniq(variants.filter((v) => afterProv(v) && (!meaningful(color) || v.color === color)).map((v) => v.size)).filter(meaningful);
  const hasColor = colors.length > 0, hasSize = sizes.length > 0;
  // SKU ứng viên còn lại sau khi lọc theo các chiều CÓ nghĩa → ô chốt SKU (luôn hiện; cần khi màu/size trống)
  const skuCands = variants.filter((vv) =>
    vv.style === style &&
    (!hasProvider || !meaningful(provider) || vv.provider === provider) &&
    (!hasColor || !meaningful(color) || vv.color === color) &&
    (!hasSize || !meaningful(size) || vv.size === size)
  );

  const pick = (nx: { style?: string; provider?: string; color?: string; size?: string }) => {
    const s = nx.style ?? style, p = nx.provider ?? provider, c = nx.color ?? color, z = nx.size ?? size;
    let cands = variants.filter((v) => v.style === s);
    if (hasProvider && p) { const f = cands.filter((v) => v.provider === p); if (f.length) cands = f; }
    if (c) { const f = cands.filter((v) => v.color === c); if (f.length) cands = f; }
    if (z) { const f = cands.filter((v) => v.size === z); if (f.length) cands = f; }
    const chosen = cands[0];
    setLine({ ...line, mappingId: chosen?.id ?? "", unitCost: chosen?.unitCost });
  };
  const v = cur;
  const box = { ...inp, width: "100%" } as React.CSSProperties;
  const miss = !line.mappingId;
  const gridN = 1 + (hasProvider ? 1 : 0) + (hasColor ? 1 : 0) + (hasSize ? 1 : 0);
  const cols = Array(gridN).fill("1fr").join(" ");

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, background: miss ? "var(--red-soft)" : "#fff", ...(miss ? { borderColor: "#F0A9A0" } : {}) }}>
      {label && <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={label}>{label}</div>}
      <div style={{ position: "relative", marginBottom: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("o.filterByProduct")}
          style={{ ...box, paddingRight: 62 }} />
        <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--faint)" }}>
          {loading ? "…" : styleList.length ? `${styleList.length} SP` : ""}
        </span>
      </div>
      {styleList.length === 0 && !loading && (
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>{t("o.noPinnedProd")}</div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8 }}>
        <div className="o2-field">
          <label>Style</label>
          <select value={style} onChange={(e) => selectStyle(e.target.value)} style={box}>
            <option value="">—</option>
            {styles.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {hasProvider && (
          <div className="o2-field">
            <label>Provider</label>
            <select value={provider} disabled={!style} onChange={(e) => pick({ provider: e.target.value, color: "", size: "" })} style={box}>
              <option value="">—</option>
              {providers.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        )}
        {hasColor && (
          <div className="o2-field">
            <label>Color</label>
            <select value={color} disabled={!style || (hasProvider && !provider)} onChange={(e) => pick({ color: e.target.value, size: "" })} style={box}>
              <option value="">—</option>
              {colors.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}
        {hasSize && (
          <div className="o2-field">
            <label>Size</label>
            <select value={size} disabled={(hasProvider && !meaningful(provider)) || (hasColor && !meaningful(color))} onChange={(e) => pick({ size: e.target.value })} style={box}>
              <option value="">—</option>
              {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
      </div>
      {style && skuCands.length > 0 && (
        <div className="o2-field" style={{ marginTop: 8 }}>
          <label>{t("o.skuVariant")}{skuCands.length > 1 ? ` (${skuCands.length})` : ""}</label>
          <select value={line.mappingId} onChange={(e) => { const ch = variants.find((x) => x.id === e.target.value); setLine({ ...line, mappingId: e.target.value, unitCost: ch?.unitCost }); }} style={box}>
            <option value="">—</option>
            {skuCands.map((vv) => { const lbl = (vv.variant && vv.variant.trim()) || [vv.color, vv.size].filter(meaningful).join(" / "); return <option key={vv.id} value={vv.id}>{lbl ? `${lbl} — ${vv.fulfillerSku}` : vv.fulfillerSku}</option>; })}
          </select>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginTop: 8 }}>
        <div className="o2-field" style={{ width: 84 }}>
          <label>{t("o.qtyLabel")}</label>
          <input type="number" min={1} value={line.qty} onChange={(e) => setLine({ ...line, qty: Number(e.target.value) })} style={{ ...box, textAlign: "center" }} />
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12.5, paddingBottom: 8 }}>
          {v ? <b style={{ color: "var(--green)" }}>{money(v.unitCost * (line.qty || 0))}</b> : <span style={{ color: "var(--faint)", fontSize: 11.5 }}>{t("o.selectVariant")}</span>}
        </div>
      </div>
    </div>
  );
}

function IssueModal({ order, fulfillers, defaultFulfillerId, close, flash, onSaved }: {
  order: Order; fulfillers: Opt[]; defaultFulfillerId?: string;
  close: () => void; flash: (m: string) => void; onSaved: () => void;
}) {
  const { t } = useLang();
  const [fulfillerId, setFulfillerId] = useState(defaultFulfillerId ?? "");
  const [reason, setReason] = useState("");
  const [imageKey, setImageKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickImg = async (file: File) => {
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const tk = await fetch("/api/order-issues/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, contentType: file.type }) }).then((r) => r.json());
      if (!tk.ok) throw new Error(tk.error ?? "upload-url error");
      const put = await fetch(tk.url, { method: tk.method ?? "PUT", headers: tk.headers ?? {}, body: file });
      if (!put.ok) throw new Error(`R2 ${put.status}`);
      setImageKey(tk.storageKey);
    } catch (e) { flash("✗ " + (e as Error).message); setPreview(null); }
    setUploading(false);
  };

  const submit = async () => {
    if (!reason.trim()) return flash("✗ " + t("iss.reason"));
    setBusy(true);
    const j = await fetch("/api/order-issues", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: order.id, fulfillerId: fulfillerId || null, reason, imageKey }) }).then((r) => r.json());
    setBusy(false);
    if (j.ok) { flash(t("iss.saved")); onSaved(); close(); } else flash("✗ " + (j.error ?? "Error"));
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(24,30,42,.5)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={busy ? undefined : close}>
      <div className="modal-card" style={{ background: "#fff", borderRadius: 18, width: 480, maxWidth: "95vw", maxHeight: "92vh", overflowY: "auto", padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <b style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 8 }}><span style={{ color: "var(--red)", display: "inline-flex" }}><IconWarn width={16} height={16} /></span> {t("iss.reportIssue")}</b>
          {!busy && <button onClick={close} style={{ background: "none", border: "none", fontSize: 17, cursor: "pointer", color: "var(--muted)" }}>✕</button>}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 16 }}>#{order.external_id}</div>

        <label style={{ ...rLbl, display: "block", marginBottom: 12 }}>{t("iss.supplier")}
          <select value={fulfillerId} onChange={(e) => setFulfillerId(e.target.value)} style={{ ...inp, width: "100%", marginTop: 4 }}>
            <option value="">—</option>
            {fulfillers.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>

        <label style={{ ...rLbl, display: "block", marginBottom: 12 }}>{t("iss.reason")}
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={t("iss.reasonPh")} style={{ ...inp, width: "100%", marginTop: 4, resize: "vertical" }} />
        </label>

        <div style={{ ...rLbl, marginBottom: 6 }}>{t("iss.evidence")}</div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) pickImg(f); e.target.value = ""; }} />
        {preview ? (
          <div onClick={() => fileRef.current?.click()} className="checker" style={{ width: 140, height: 140, borderRadius: 12, overflow: "hidden", cursor: "pointer", border: "1px solid var(--line)" }}>
            <img src={preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        ) : (
          <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ ...btnGhost, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <IconUpload width={14} height={14} /> {uploading ? "…" : t("iss.chooseImg")}
          </button>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          {!busy && <button onClick={close} style={btnGhost}>{t("c.cancel")}</button>}
          <button onClick={submit} disabled={busy || !reason.trim()} style={{ ...btnRed, opacity: busy || !reason.trim() ? 0.55 : 1 }}>{busy ? "…" : t("iss.submit")}</button>
        </div>
      </div>
    </div>
  );
}

function ManualTracking({ orderId, platform, ff, fulfillerId, fulfillers, flash, onSaved }: {
  orderId: string; platform: string; ff?: FfOrder; fulfillerId: string; fulfillers: Opt[];
  flash: (m: string) => void; onSaved: () => void;
}) {
  const { t } = useLang();
  const [pushing, setPushing] = useState(false);
  const pushEtsy = async () => {
    setPushing(true);
    const j = await fetch("/api/etsy/push-tracking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setPushing(false);
    if (j.ok && j.pushed > 0) flash("\u2713 Tracking pushed to Etsy");
    else if (j.ok && j.reason) flash("\u2713 " + j.reason);
    else flash("\u2717 " + (j.errors?.[0] ?? j.error ?? j.reason ?? "Push failed"));
    onSaved();
  };
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState({
    trackingCarrier: ff?.trackingCarrier ?? "",
    trackingNumber: ff?.trackingNumber ?? "",
    trackingUrl: ff?.trackingUrl ?? "",
    supplierOrderUrl: ff?.supplierOrderUrl ?? "",
    baseCost: ff?.baseCost ?? "",
    shipCost: ff?.shipCost ?? "",
    fulfillerId: fulfillerId ?? "",
  });

  const save = async () => {
    setBusy(true);
    const j = await fetch(`/api/orders/${orderId}/tracking`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(v),
    }).then((r) => r.json());
    setBusy(false);
    if (j.ok) { flash(t("o.trackSaved")); setOpen(false); onSaved(); } else flash("✗ " + (j.error ?? "Error"));
  };

  const fld = { ...inp, width: "100%", fontSize: 12 } as React.CSSProperties;
  const lab = { fontSize: 10.5, fontWeight: 700, color: "var(--faint)", textTransform: "uppercase" as const, letterSpacing: ".3px", display: "block", marginBottom: 3 };

  if (!open) {
    return (
      <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
        <button onClick={() => setOpen(true)} style={{ ...btnGhost, fontSize: 11.5, flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <IconPin width={12} height={12} /> {ff?.trackingNumber ? t("o.editTracking") : t("o.addTracking")}
        </button>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 10, borderTop: "1px dashed var(--line)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      {!ff && (
        <div>
          <label style={lab}>{t("o.fulfilledBy")}</label>
          <select value={v.fulfillerId} onChange={(e) => setV({ ...v, fulfillerId: e.target.value })} style={fld}>
            <option value="">—</option>
            {fulfillers.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div><label style={lab}>{t("o.carrier")}</label><input value={v.trackingCarrier} onChange={(e) => setV({ ...v, trackingCarrier: e.target.value })} placeholder="USPS / UPS…" style={fld} /></div>
        <div><label style={lab}>{t("o.tracking")}</label><input value={v.trackingNumber} onChange={(e) => setV({ ...v, trackingNumber: e.target.value })} style={fld} /></div>
      </div>
      <div><label style={lab}>{t("o.trackLink")} ({t("o.optional")})</label><input value={v.trackingUrl} onChange={(e) => setV({ ...v, trackingUrl: e.target.value })} placeholder="https://…" style={fld} /></div>
      <div><label style={lab}>{t("o.supplierOrderLink")}</label><input value={v.supplierOrderUrl} onChange={(e) => setV({ ...v, supplierOrderUrl: e.target.value })} placeholder={t("o.supplierLinkPh")} style={fld} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div><label style={lab}>{t("o.baseCost")} ($)</label><input type="number" step="0.01" value={v.baseCost} onChange={(e) => setV({ ...v, baseCost: e.target.value })} style={fld} /></div>
        <div><label style={lab}>{t("o.shipFee")} ($)</label><input type="number" step="0.01" value={v.shipCost} onChange={(e) => setV({ ...v, shipCost: e.target.value })} style={fld} /></div>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={() => setOpen(false)} style={{ ...btnGhost, fontSize: 12 }}>{t("c.cancel")}</button>
        <button onClick={save} disabled={busy} style={{ ...btnBlue, fontSize: 12, opacity: busy ? 0.6 : 1 }}>{busy ? "…" : t("c.save")}</button>
      </div>
    </div>
  );
}

// Hộp xác nhận Duplicate: bắt bấm 2 lần và cho sửa Order label trước khi tạo.
// Trước đây bấm 1 phát là nhân bản luôn, label trùng y hệt đơn gốc → không phân biệt được.
// Xuất file "Shipment info" để upload tracking hàng loạt lên TikTok Seller Center.
// BẮT BUỘC chọn shop: file upload lên TỪNG shop, trộn nhiều shop vào một file là TikTok từ chối.
function TtTrackingModal({ close, flash, stores, dr }: {
  close: () => void; flash: (m: string) => void; stores: Opt[]; dr: RangeValue | null;
}) {
  const { t } = useLang();
  const ttStores = stores.filter((s) => s.marketplace === "tiktok");
  const [storeId, setStoreId] = useState(ttStores.length === 1 ? ttStores[0].id : "");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!storeId) { flash("✗ " + t("o.mustPickStore")); return; }
    setBusy(true);
    const p = new URLSearchParams({ storeId });
    if (dr) { const d = rangeToDates(dr); p.set("from", d.from); p.set("to", d.to); }
    try {
      const r = await fetch(`/api/orders/export-tiktok-tracking?${p}`);
      if (!r.ok) { const j = await r.json().catch(() => null); flash("✗ " + (j?.error ?? "Export failed")); setBusy(false); return; }
      const n = Number(r.headers.get("X-Row-Count") ?? 0);
      if (!n) { flash("✗ " + t("o.ttNoTracking")); setBusy(false); return; }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = r.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "shipment_info.xlsx";
      a.click(); URL.revokeObjectURL(a.href);
      flash(`✓ ${n} ${t("o.ttExported")}`);
      close();
    } catch { flash("✗ " + t("o.netError")); }
    setBusy(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(24,30,42,.5)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={busy ? undefined : close}>
      <div className="panel" style={{ width: 460, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <b style={{ fontSize: 16, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <MarketplaceLogo mk="tiktok" size={20} /> {t("o.ttTrackingTitle")}
          </b>
          {!busy && <button onClick={close} style={{ background: "none", border: "none", fontSize: 17, cursor: "pointer", color: "var(--muted)" }}>✕</button>}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6, marginBottom: 14 }}>{t("o.ttTrackingHint")}</div>

        <label style={{ ...rLbl, display: "block", marginBottom: 14 }}>
          {t("o.tiktokStore")} <span style={{ color: "var(--red)" }}>*</span>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)}
            style={{ ...inp, width: "100%", marginTop: 4, borderColor: storeId ? undefined : "var(--red)" }}>
            <option value="">{t("o.pickStore")}</option>
            {ttStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {!ttStores.length && <div style={{ fontSize: 11.5, color: "var(--red)", marginTop: 4, fontWeight: 600 }}>{t("o.noStoreForPlatform")}</div>}
        </label>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={close} disabled={busy} style={{ ...btnGhost, fontSize: 13 }}>{t("c.cancel")}</button>
          <button onClick={run} disabled={busy || !storeId}
            style={{ ...btnBlue, fontSize: 13, padding: "9px 20px", opacity: (busy || !storeId) ? 0.5 : 1, cursor: storeId ? "pointer" : "not-allowed" }}>
            {busy ? "…" : t("o.ttExportBtn")}
          </button>
        </div>
      </div>
    </div>
  );
}

function DuplicateModal({ init, close, onConfirm }: {
  init: { id: string; label: string };
  close: () => void;
  onConfirm: (id: string, label: string) => Promise<void>;
}) {
  const { t } = useLang();
  const [label, setLabel] = useState(init.label ? `${init.label}-CLONE` : "");
  const [busy, setBusy] = useState(false);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(24,30,42,.5)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={busy ? undefined : close}>
      <div className="panel" style={{ width: 460, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <b style={{ fontSize: 16 }}>{t("o.dupTitle")}</b>
          {!busy && <button onClick={close} style={{ background: "none", border: "none", fontSize: 17, cursor: "pointer", color: "var(--muted)" }}>✕</button>}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6, marginBottom: 14 }}>{t("o.dupHint")}</div>

        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".3px" }}>
          {t("o.orderLabel")}
          <input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus
            placeholder={init.label || "—"}
            style={{ ...inp, width: "100%", marginTop: 5, fontWeight: 600, textTransform: "none", letterSpacing: 0 }} />
        </label>

        <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
          <button onClick={close} disabled={busy} style={{ ...btnGhost, fontSize: 13 }}>{t("c.cancel")}</button>
          <button onClick={async () => { setBusy(true); await onConfirm(init.id, label.trim()); setBusy(false); }}
            disabled={busy}
            style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 10, padding: "9px 20px", fontWeight: 800, fontSize: 13, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1 }}>
            {busy ? "…" : t("o.dupConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderCard({ o, canEdit, canPushFf, isAdmin, selected, onToggleSel, reload, flash, openDup, copyText, fulfillers }: {
  o: Order; canEdit: boolean; canPushFf: boolean; isAdmin: boolean; selected: boolean; onToggleSel: () => void;
  reload: () => void; flash: (m: string) => void;
  openDup: (id: string, label: string) => void; copyText: (v: string) => void; fulfillers: Opt[];
}) {
  const { t } = useLang();
  const confirm = useConfirm();
  const promptFn = usePrompt();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [showIssue, setShowIssue] = useState(false);
  const [ffSel, setFfSel] = useState("");
  // Google Sheet fulfiller: chọn tab lúc đẩy (Hướng B)
  const [gsheetTabs, setGsheetTabs] = useState<string[]>([]);
  const [gsheetTab, setGsheetTab] = useState("");
  const selFfIsGsheet = !!detail?.fulfillerOptions.find((f) => f.fulfillerId === ffSel)?.gsheet;
  useEffect(() => {
    if (!ffSel || !selFfIsGsheet) { setGsheetTabs([]); setGsheetTab(""); return; }
    setGsheetTabs([]); setGsheetTab("");
    fetch("/api/fulfillers/gsheet-tabs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fulfillerId: ffSel }) })
      .then((r) => r.json()).then((j) => { if (j.ok) { setGsheetTabs(j.tabs ?? []); if ((j.tabs ?? []).length === 1) setGsheetTab(j.tabs[0]); } else flash("✗ Load tabs: " + (j.error ?? "")); })
      .catch(() => flash("✗ Load tabs failed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ffSel, selFfIsGsheet]);
  const canCreate = ["new", "has_issues"].includes(o.status); // chỉ đơn NEW / Has issues mới đẩy được
  // REVIEW: đơn vừa đẩy xong (status = created) → giữ nguyên panel variant + design nhưng KHOÁ,
  // để support đối chiếu đã đẩy đúng variant/design chưa. Sang in_production trở đi thì ẩn.
  const isReview = o.status === "created";
  // Chưa gán đủ design cho mọi sản phẩm thì chưa cho chọn nhà fulfill — tránh đẩy đơn thiếu file in.
  const allDesigned = o.items.length > 0 && o.items.every((i) => !!i.design_id);
  // Có nhà DROPSHIP (non-POD) khả dụng → bỏ chặn "cần gán design": đơn dropship không có design.
  const hasNonPod = (detail?.fulfillerOptions ?? []).some((f) => f.nonPod);
  const designGateOk = allDesigned || hasNonPod;
  const [lines, setLines] = useState<Record<string, { mappingId: string; qty: number; unitCost?: number }>>({});
  const [busy, setBusy] = useState(false);
  const [ship, setShip] = useState({
    buyerFirst: o.buyer_first ?? "", buyerLast: o.buyer_last ?? "", addr1: o.addr1 ?? "", addr2: o.addr2 ?? "",
    city: o.city ?? "", state: o.state ?? "", zip: o.zip ?? "", country: o.country ?? "United States",
    orderLabel: o.order_label ?? "",
  });
  const dirtyShip = useRef(false); // có sửa địa chỉ chưa lưu?

  const loadDetail = useCallback(async () => {
    const j = await fetch(`/api/orders/${o.id}`).then((r) => r.json()).catch(() => null);
    if (j?.ok) {
      setDetail(j);
      const od = j.order ?? {};
      setShip((s) => ({
        // Tự đổ thông tin người nhận + địa chỉ (gồm Apt/Box ở line 2) từ đơn sang form
        buyerFirst: s.buyerFirst || cleanName(od.buyerFirst),
        buyerLast: s.buyerLast || cleanName(od.buyerLast),
        addr1: s.addr1 || (od.addr1 ?? ""),
        addr2: s.addr2 || (od.addr2 ?? ""),
        city: s.city || (od.city ?? ""),
        state: s.state || (od.state ?? ""),
        zip: s.zip || (od.zip ?? ""),
        country: s.country || (od.country ?? "United States"),
        orderLabel: s.orderLabel || [`${(j.storeName ?? "SHOP").replace(/[^a-zA-Z0-9]/g, "").toUpperCase()}`, o.external_id].filter(Boolean).join("-"),
      }));
    }
  }, [o.id, o.external_id]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  // XOÁ BẢN GHI ĐẨY — hành động NGUY HIỂM (sai bút toán nếu bấm nhầm).
  // → Liệt kê CỤ THỂ mất gì, rồi bắt gõ lại đúng mã đơn nhà in mới cho xoá.
  const delFf = async (id: string) => {
    const f = (detail?.ffOrders ?? []).find((x) => x.id === id);
    const code = (f?.externalFfId ?? "").trim();
    const guard = code || "DELETE";
    const cost = Number(f?.cost ?? (Number(f?.baseCost ?? 0) + Number(f?.shipCost ?? 0) + Number(f?.extraFee ?? 0)));
    const onlyOne = (detail?.ffOrders?.length ?? 0) <= 1;

    const bullets = [
      t("o.delFfWhat1").replace("{ff}", f?.fulfillerName ?? "—").replace("{code}", code || "—"),
      cost > 0 ? t("o.delFfWhat2").replace("{amt}", money(cost)) : t("o.delFfWhat2z"),
      f?.trackingNumber ? t("o.delFfWhat3").replace("{tn}", f.trackingNumber) : "",
      onlyOne ? t("o.delFfWhat4") : "",
      t("o.delFfWhat5"), // KHÔNG huỷ đơn bên nhà in
    ].filter(Boolean).map((x) => "• " + x).join("\n");

    const typed = await promptFn({
      title: t("o.delFfTitle"),
      message: `${t("o.delFfIntro")}\n\n${bullets}\n\n${t("o.delFfTypeToConfirm").replace("{code}", guard)}`,
      danger: true, tone: "red",
      confirmText: t("o.delFfBtn"),
      input: { placeholder: guard },
    });
    if (typed === null) return;
    if (typed.trim() !== guard) { flash("✗ " + t("o.delFfMismatch").replace("{code}", guard)); return; }

    const j = await fetch(`/api/fulfillment/${id}`, { method: "DELETE" }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    if (j.ok) { flash(t("o.pushRecDeleted")); loadDetail(); reload(); }
    else flash("✗ " + (j.error ?? t("o.errWordLow")));
  };

  const variants: Variant[] = ffSel && detail ? (detail.catalog[ffSel] ?? []) : [];
  const pickFulfiller = (id: string) => {
    setFfSel(id);
    if (!detail) return;
    const cat = detail.catalog[id] ?? [];
    const init: Record<string, { mappingId: string; qty: number; unitCost?: number }> = {};
    for (const it of detail.items) {
      const match = cat.find((v) => v.internalSku === it.internal_sku);
      init[it.id] = { mappingId: match?.id ?? "", qty: it.qty, unitCost: match?.unitCost };
    }
    setLines(init);
  };
  const complete = !!ffSel && !!detail && detail.items.length > 0 && (!selFfIsGsheet || !!gsheetTab) &&
    detail.items.every((it) => lines[it.id]?.mappingId && lines[it.id]?.qty >= 1);
  const estCost = complete && detail
    ? detail.items.reduce((tot, it) => { const l = lines[it.id]; const uc = l.unitCost ?? variants.find((x) => x.id === l.mappingId)?.unitCost ?? 0; return tot + uc * l.qty; }, 0)
    : null;
  // Printway: gọi calculate-price lấy GIÁ THẬT (mapping không có giá) — debounce, huỷ khi đổi lựa chọn
  const [pwEst, setPwEst] = useState<number | null>(null);
  const isPwFf = !!ffSel && (detail?.fulfillerOptions.find((f) => f.fulfillerId === ffSel)?.name ?? "").toLowerCase().includes("printway");
  useEffect(() => {
    setPwEst(null);
    if (!complete || !detail || !isPwFf) return;
    const payload = {
      fulfillerId: ffSel, country: ship.country, state: ship.state,
      lines: detail.items.map((it) => ({ mappingId: lines[it.id].mappingId, qty: lines[it.id]?.qty || it.qty })),
    };
    const ctl = new AbortController();
    const tm = setTimeout(() => {
      fetch("/api/fulfillers/printway-calc-price", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: ctl.signal })
        .then((r) => r.json()).then((j) => { if (j.ok && j.total > 0) setPwEst(j.total); }).catch(() => {});
    }, 700);
    return () => { clearTimeout(tm); ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, isPwFf, ffSel, JSON.stringify(lines), ship.country, ship.state]);

  const createOrder = async () => {
    if (!complete || !detail) return;
    setBusy(true);
    if (canEdit) {
      const s1 = await fetch(`/api/orders/${o.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ship) }).then((r) => r.json());
      if (!s1.ok) { setBusy(false); return flash("✗ " + (s1.error ?? "")); }
    }
    const body = { orderId: o.id, fulfillerId: ffSel, gsheetTab: gsheetTab || undefined, lines: detail.items.map((it) => ({ itemId: it.id, mappingId: lines[it.id].mappingId, qty: lines[it.id]?.qty || it.qty })) };
    // 5xx/non-JSON (Cloudflare 502, Vercel rollout...) → retry 1 lần sau 2.5s.
    // An toàn: adapter Printway check đơn đã tồn tại theo order_name trước khi tạo → không double.
    const doPush = () => fetch("/api/fulfillment/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async (r) => {
        const txt = await r.text();
        try { return { ...JSON.parse(txt), _status: r.status }; } catch { return { ok: false, _retryable: r.status >= 500, error: `HTTP ${r.status} — non-JSON response: ${txt.replace(/<[^>]*>/g, " ").trim().slice(0, 160)}` }; }
      })
      .catch((e) => ({ ok: false, _retryable: true, error: "Request failed/timeout: " + String(e?.message ?? e) }));
    let j = await doPush();
    if (!j.ok && j._retryable) {
      flash("⏳ Temporary server error — retrying in 2.5s…");
      await new Promise((r) => setTimeout(r, 2500));
      j = await doPush();
    }
    setBusy(false);
    if (j.ok) {
      if (j.simulated) flash(t("o.simPushWarn") + (j.reason ?? t("o.checkFfConfig")));
      else if (j.ttLabelWarn) flash("⚠ Pushed, but TikTok label: " + j.ttLabelWarn);
      else flash(t("o.pushedReal"));
      reload();
    } else flash("✗ " + (j.error ?? "Error"));
  };

  // Sửa địa chỉ: cần quyền edit; với non-admin chỉ được sửa khi đơn còn NEW (đã Create là khoá)
  const addrEditable = canEdit && (isAdmin || o.status === "new");
  // Lưu địa chỉ/người nhận khi rời ô (chỉ khi có thay đổi) — không cần bấm Create order mới lưu.
  const saveShip = async () => {
    if (!addrEditable || !dirtyShip.current) return;
    dirtyShip.current = false;
    const j = await fetch(`/api/orders/${o.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ship) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    if (j.ok) flash("✓ Saved"); else { dirtyShip.current = true; flash("✗ " + (j.error ?? "Save failed")); }
  };
  const F = (k: keyof typeof ship, label: string, placeholder?: string) => (
    <div className="o2-field">
      <label>{label}</label>
      <input value={ship[k]} disabled={!addrEditable} placeholder={placeholder}
        onChange={(e) => { setShip({ ...ship, [k]: e.target.value }); dirtyShip.current = true; }}
        onBlur={saveShip}
        style={{ ...inp, opacity: addrEditable ? 1 : 0.65 }} />
    </div>
  );

  return (
    <div className="card o2" style={{ borderTop: `3px solid ${STATUS_COLORS[o.status] ?? "#6B7280"}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div className={`o2-top${detail ? "" : " solo"}`} style={{ flex: 1, minWidth: 0 }}>
            {/* CỘT 1 — thông tin đơn */}
            <div className="o2-info">
              <div className="o2-l1">
                {canEdit && <input type="checkbox" checked={selected} onChange={onToggleSel} style={{ width: 17, height: 17, cursor: "pointer", accentColor: "var(--blue)", flexShrink: 0 }} />}
                <span className="o2-num" style={{ cursor: "pointer" }} title={t("d.copy") + " ID"} onClick={(e) => { e.stopPropagation(); copyText(o.external_id); }}>#{o.external_id}</span>
                <button className="icon-btn" title={t("d.copy") + " ID"} onClick={() => copyText(o.external_id)}><IconCopy width={12} height={12} /></button>
                <span className="o2-status" style={{ background: STATUS_COLORS[o.status] ?? "#6B7280" }}>{o.status.toUpperCase()}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{new Date(o.ordered_at).toISOString().slice(0, 10)}</span>
              </div>
              <div className="o2-ship">
                <span className="o2-chip plat" style={{ display: "inline-flex", alignItems: "center", gap: 5, paddingLeft: 4 }}>
                  <MarketplaceLogo mk={o.platform} size={16} /> {o.platform}
                </span>
                <span className="o2-chip seller">{o.seller_name ?? "—"}</span>
                {o.store_name && <span className="o2-chip">{o.store_name}</span>}
                {o.platform === "tiktok" && o.shipping_type && (
                  o.shipping_type === "TIKTOK"
                    ? <span className="o2-chip" style={{ background: "#111", color: "#fff", fontWeight: 800 }} title="Fulfilled by TikTok — get the shipping label, then send it to the supplier">{t("o.shipByTiktok")}</span>
                    : o.shipping_type === "SELLER"
                    ? <span className="o2-chip" style={{ background: "#EAF3EA", color: "#2E7D46", fontWeight: 800, border: "1px solid #BFE0BF" }} title="Ship by Seller — you arrange shipping">{t("o.shipBySeller")}</span>
                    : null
                )}
                {o.platform === "tiktok" && o.shipping_type === "TIKTOK" && (
                  <TiktokLabelButton orderId={o.id} initial={o.tiktok_labels} onFlash={flash} />
                )}
              </div>
              {/* Người nhận + địa chỉ */}
              {([cleanName(o.buyer_first), cleanName(o.buyer_last)].filter(Boolean).join(" ")) && (
                <div className="o2-buyer">
                  <span style={{ cursor: "pointer" }} title="Copy name" onClick={(e) => { e.stopPropagation(); copyText([cleanName(o.buyer_first), cleanName(o.buyer_last)].filter(Boolean).join(" ")); }}>{[cleanName(o.buyer_first), cleanName(o.buyer_last)].filter(Boolean).join(" ")}</span>
                  <button className="icon-btn" title="Copy name" onClick={() => copyText([cleanName(o.buyer_first), cleanName(o.buyer_last)].filter(Boolean).join(" "))} style={{ marginLeft: 6, verticalAlign: "-2px" }}><IconCopy width={12} height={12} /></button>
                </div>
              )}
              <div className="o2-addr"><IconPin width={15} height={15} /><span>{[o.addr1, o.addr2, o.city, o.state, o.zip, o.country].filter(Boolean).join(", ") || t("o.noAddress")}</span></div>
              {/* Tài chính đơn */}
              <div className="o2-fin">
                <div className="c"><span className="k">{t("o.total")}</span><span className="v">{money(o.total)}</span></div>
                <div className="c"><span className="k">{t("o.fee")}</span><span className="v">{money(o.platform_fee)}</span></div>
                <div className="c net"><span className="k">{t("o.afterFee")}</span><span className="v">{money(Number(o.total) - Number(o.platform_fee))}</span></div>
              </div>
              {/* Vùng thao tác: ghi chú + tracking/chi phí */}
              <div className="o2-actions">
                <OrderNote order={o} canEdit={canEdit} onSaved={reload} flash={flash} />
              {/* Tracking / chi phí — seller cũng xem được nếu đơn đã đẩy; chỉ người có quyền đẩy mới nhập tay */}
              {detail && ((detail.ffOrders?.length ?? 0) > 0 || canPushFf) && (
                <div className="o2-track">
                  {(detail.ffOrders ?? []).map((f) => (
                    <div key={f.id} className="o2-ff">
                      {/* Header: tên supplier + link đơn supplier cùng hàng */}
                      <div className="o2-ff-head">
                        <SupplierLogo name={f.fulfillerName || ""} size={18} />
                        <span className="o2-track-h" style={{ margin: 0 }}>{f.fulfillerName || t("o.fulfilledBy")}</span>
                        <span style={{ background: FF_STATUS_COLORS[f.status] ?? "#8A93A6", color: "#fff", borderRadius: 6, padding: "1px 7px", fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>{f.status}</span>
                        {f.externalFfId?.startsWith("SIM-") && <span title={t("o.simPushLabel")} style={{ background: "#FBECEC", color: "var(--red)", borderRadius: 6, padding: "1px 7px", fontSize: 10.5, fontWeight: 800 }}>{t("o.notSentBadge")}</span>}
                        {f.supplierOrderUrl && (
                          <a href={f.supplierOrderUrl} target="_blank" rel="noreferrer" className="o2-ff-link">
                            <IconTruck width={12} height={12} /> {t("o.viewSupplierOrder")} ↗
                          </a>
                        )}
                        {canPushFf && canEdit && <button onClick={() => delFf(f.id)} title={t("o.delPushRec")} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--red)", fontSize: 13, fontWeight: 700, padding: "0 4px" }}>✕</button>}
                      </div>
                      {/* Mã đơn nhà in + thời điểm đẩy */}
                      {(f.externalFfId || f.pushedAt) && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--muted)", margin: "2px 0" }}>
                          {f.externalFfId && <>
                            <span>{t("o.codeLabel")}</span>
                            <b style={{ fontFamily: "ui-monospace,monospace", color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180, cursor: "pointer" }} title={t("o.copyFfCode")} onClick={(e) => { e.stopPropagation(); copyText(f.externalFfId!); }}>{f.externalFfId}</b>
                            <button className="icon-btn" title={t("o.copyFfCode")} onClick={() => copyText(f.externalFfId!)}><IconCopy width={11} height={11} /></button>
                          </>}
                          {f.pushedAt && <span style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>{fmtDateTime(f.pushedAt)}</span>}
                        </div>
                      )}
                      {/* Variant + số lượng đã đẩy */}
                      {f.lines && f.lines.length > 0 && (
                        <div style={{ fontSize: 11.5, color: "var(--ink)", margin: "3px 0" }}>
                          {f.lines.map((l, i) => (
                            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              <b>{l.variant || l.sku}</b>
                              {l.variant && l.sku && <span style={{ color: "var(--faint)", fontFamily: "ui-monospace,monospace", fontSize: 10.5 }}>{l.sku}</span>}
                              <span style={{ color: "var(--muted)" }}>× {l.qty}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Chi phí supplier */}
                      {(f.baseCost != null || f.shipCost != null) && (
                        <div className="o2-supcost">
                          <span>{t("o.baseCost")}: <b>{money(f.baseCost ?? 0)}</b></span>
                          <span>{t("o.shipFee")}: <b>{money(f.shipCost ?? 0)}</b></span>
                          {Number(f.extraFee ?? 0) !== 0 && <span>{t("o.taxFee")}: <b>{money(f.extraFee ?? 0)}</b></span>}
                          <span className="tot">{t("o.total")}: <b>{money(f.cost ?? (Number(f.baseCost ?? 0) + Number(f.shipCost ?? 0) + Number(f.extraFee ?? 0)))}</b></span>
                        </div>
                      )}
                      {/* Tracking gọn 1 hàng */}
                      {f.trackingNumber ? (
                        <div className="o2-track-row">
                          <div style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 7 }}>
                            <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }} title={t("o.copyTrack")} onClick={(e) => { e.stopPropagation(); copyText(f.trackingNumber!); }}>{f.trackingNumber}</span>
                            <button className="icon-btn" title={t("o.copyTrack")} onClick={() => copyText(f.trackingNumber!)}><IconCopy width={12} height={12} /></button>
                            <span style={{ fontSize: 11, color: "var(--muted)", cursor: f.trackingCarrier ? "pointer" : "default" }} title={f.trackingCarrier ? "Copy carrier" : undefined} onClick={(e) => { if (f.trackingCarrier) { e.stopPropagation(); copyText(f.trackingCarrier); } }}>· {f.trackingCarrier || t("o.carrier")}</span>
                            {f.trackingCarrier && <button className="icon-btn" title="Copy carrier" onClick={() => copyText(f.trackingCarrier!)}><IconCopy width={12} height={12} /></button>}
                          </div>
                          <a href={f.trackingUrl || trackingUrl(f.trackingCarrier, f.trackingNumber)} target="_blank" rel="noreferrer" style={{ ...btnGhost, textDecoration: "none", fontSize: 11, padding: "5px 10px", whiteSpace: "nowrap" }}>{t("o.trackLink")} ↗</a>
                        </div>
                      ) : (
                        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>{t("o.noTracking")}</div>
                      )}
                    </div>
                  ))}

                  {/* Lợi nhuận sau chi phí */}
                  {(() => {
                    const ffCost = (detail.ffOrders ?? []).reduce((s, f) => s + Number(f.cost ?? (Number(f.baseCost ?? 0) + Number(f.shipCost ?? 0) + Number(f.extraFee ?? 0))), 0);
                    if (ffCost <= 0) return null;
                    const afterFee = Number(o.total) - Number(o.platform_fee);
                    const profit = afterFee - ffCost;
                    return (
                      <div className="o2-profit">
                        <span>{t("o.profitAfterCost")}</span>
                        <span style={{ fontSize: 11, color: "var(--faint)" }}>{money(afterFee)} − {money(ffCost)}</span>
                        <b style={{ color: profit >= 0 ? "var(--green)" : "var(--red)", fontSize: 14 }}>{money(profit)}</b>
                      </div>
                    );
                  })()}

                  {canPushFf && <ManualTracking key={(detail.ffOrders ?? [])[0]?.id ?? "new"} orderId={o.id} platform={o.platform}
                    ff={(detail.ffOrders ?? [])[0]}
                    fulfillerId={ffSel || (detail.ffOrders ?? [])[0]?.fulfillerId || ""}
                    fulfillers={fulfillers}
                    flash={flash} onSaved={() => { loadDetail(); reload(); }} />}
                </div>
              )}
              </div>
            </div>

            {/* CỘT 2+3 — thông tin giao hàng (ai xem đơn đều thấy) + tạo đơn fulfill (chỉ người có quyền đẩy) */}
            {detail && (
              <>
                <div>
                  <div className="o2-secTitle">
                    {canPushFf && <span className="o2-badge"><IconTruck width={13} height={13} /> {t("o.fulfilment")}</span>}
                    <b style={{ fontSize: 13 }}>{t("o.shippingInfo")}</b>
                  </div>
                  <div className="o2-form">
                    {F("buyerFirst", t("o.firstName"))}
                    {F("buyerLast", t("o.lastName"))}
                    {F("addr1", t("o.addr1"))}
                    {F("addr2", t("o.addr2"), "Apt / Suite / Box…")}
                    {F("city", t("o.city"))}
                    {F("zip", t("o.zip"))}
                    {F("country", t("o.country"))}
                    {F("state", t("o.state"))}
                  </div>
                </div>
                <div className="o2-right">
                  <div className="o2-field">{F("orderLabel", t("o.orderLabel"))}</div>
                  {!canPushFf ? null : !designGateOk ? (
                    <div className="o2-field">
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{t("o.fulfilledBy")}</label>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "#B4543C", background: "#FFF6F4", border: "1px dashed #F6D9D0", borderRadius: 10, padding: "10px 12px", fontWeight: 600 }}>
                        <IconWarn width={14} height={14} /> {t("o.needDesignFirst")}
                      </div>
                    </div>
                  ) : canCreate ? (
                  <>
                  <div className="o2-field">
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{ffSel && <SupplierLogo name={detail.fulfillerOptions.find((x) => x.fulfillerId === ffSel)?.name ?? ""} size={15} />}{t("o.fulfilledBy")}</label>
                    <select value={ffSel} onChange={(e) => pickFulfiller(e.target.value)} style={{ ...inp, width: "100%" }}>
                      <option value="">{t("o.chooseFulfiller")}</option>
                      {detail.fulfillerOptions.map((ff) => (
                        <option key={ff.fulfillerId} value={ff.fulfillerId}>{ff.name}{!ff.mapped ? ` ${t("o.noSkuMapping")}` : ""}</option>
                      ))}
                    </select>
                  </div>
                  {/* Chọn variant nằm ở TỪNG sản phẩm bên dưới; nút Create cũng ở cuối cho liền mạch */}
                  {ffSel && <div style={{ fontSize: 11.5, color: "var(--muted)", background: "#F7F9FC", border: "1px dashed var(--line)", borderRadius: 8, padding: "8px 10px" }}>↓ Pick <b>{t("o.variantQty")}</b> on each product, then click <b>Create order</b> at the bottom</div>}
                  </>
                  ) : isReview ? (
                  <>
                  <div className="o2-field">
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <SupplierLogo name={(detail.ffOrders ?? [])[0]?.fulfillerName ?? ""} size={15} />{t("o.fulfilledBy")}
                    </label>
                    <input readOnly value={(detail.ffOrders ?? [])[0]?.fulfillerName ?? ""} style={{ ...inp, width: "100%", background: "#F2F5F9", color: "var(--muted)", cursor: "default" }} />
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", background: "#F7F9FC", border: "1px dashed var(--line)", borderRadius: 8, padding: "8px 10px" }}>
                    {t("o.reviewPushed")}
                  </div>
                  </>
                  ) : (
                    <div style={{ fontSize: 12, color: "var(--muted)", background: "var(--card)", border: "1px dashed var(--line)", borderRadius: 10, padding: "10px 12px" }}>
                      {t("o.pushNotePre")}<b style={{ color: STATUS_COLORS[o.status] ?? "var(--ink)" }}>{o.status.toUpperCase()}</b>{t("o.pushNoteMid")}<b>NEW</b>{t("o.pushNotePost")}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexShrink: 0 }}>
          {canEdit && <button onClick={() => setShowIssue(true)} style={{ ...btnGhost, color: "var(--red)", borderColor: "#F3C6C0", background: "var(--red-soft)", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}><IconWarn width={14} height={14} /> {t("iss.badReview")}</button>}
          {isAdmin && <button onClick={() => openDup(o.id, (o.order_label as string) ?? "")} style={{ ...btnGhost, color: "var(--blue)", borderColor: "var(--blue)", background: "var(--blue-soft)", fontWeight: 700 }}>{t("o.dup")}</button>}
        </div>
      </div>
      {showIssue && <IssueModal order={o} fulfillers={fulfillers}
        close={() => setShowIssue(false)} flash={flash} onSaved={reload} />}

      {/* Items — chỉ hiển thị sản phẩm + gán design (variant đã dời lên cột phải) */}
      {o.items.map((it, idx) => {
        // Đơn đã đẩy → dựng lại dòng ĐÃ ĐẨY của đúng item (ưu tiên itemId; đơn cũ chưa lưu itemId → khớp theo thứ tự)
        const pl = (detail?.ffOrders ?? [])[0]?.lines ?? [];
        const reviewLine = isReview ? (pl.find((l) => l.itemId === it.id) ?? pl[idx] ?? null) : null;
        return <ItemRow key={it.id} it={it} onSaved={reload} flash={flash} canEdit={canEdit}
          showPicker={canPushFf && !!detail && canCreate && !!ffSel}
          reviewLine={canPushFf ? reviewLine : null}
          fulfillerId={ffSel} pickerSeed={variants}
          line={lines[it.id] ?? { mappingId: "", qty: it.qty }}
          setLine={(v) => setLines({ ...lines, [it.id]: v })} />;
      })}
      {canPushFf && detail && canCreate && ffSel && selFfIsGsheet && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Google Sheet tab:</span>
          <select value={gsheetTab} onChange={(e) => setGsheetTab(e.target.value)} style={{ ...inp, minWidth: 180 }}>
            <option value="">{gsheetTabs.length ? "— Chọn tab —" : "Đang tải tabs…"}</option>
            {gsheetTabs.map((tb) => <option key={tb} value={tb}>{tb}</option>)}
          </select>
        </div>
      )}
      {canPushFf && detail && canCreate && ffSel && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 16, marginTop: 14, paddingTop: 14, borderTop: "1px dashed var(--line)", flexWrap: "wrap" }}>
          {complete
            ? <span style={{ fontSize: 13.5 }}>{t("o.estCost")}: <b style={{ color: "var(--green)" }}>{money(pwEst ?? estCost!)}</b>{pwEst != null && <span style={{ fontSize: 10.5, color: "var(--muted)", marginLeft: 5 }}>(Printway live)</span>}</span>
            : <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{t("o.needComplete").replace("{n}", String(detail.items.length))}</span>}
          <button onClick={createOrder} disabled={!complete || busy} style={{ ...btnBlue, padding: "12px 34px", fontSize: 14.5, opacity: !complete || busy ? 0.5 : 1 }}>
            {busy ? t("o.creating") : t("o.pushFfOrder")}
          </button>
        </div>
      )}
    </div>
  );
}

/** Xem ảnh to: click nền hoặc ESC để đóng */
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(16,20,28,.82)", display: "flex", alignItems: "center", justifyContent: "center", padding: 28, cursor: "zoom-out" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" style={{ maxWidth: "92vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,.45)", background: "#AEAEB2" }} />
      <button onClick={onClose} style={{ position: "fixed", top: 18, right: 22, background: "rgba(255,255,255,.14)", color: "#fff", border: "none", borderRadius: 10, width: 38, height: 38, fontSize: 17, cursor: "pointer" }}>✕</button>
    </div>
  );
}

function ItemRow({ it, onSaved, flash, canEdit = true, showPicker = false, fulfillerId = "", pickerSeed = [], line, setLine, reviewLine = null }: {
  it: Item; onSaved: () => void; flash: (m: string) => void; canEdit?: boolean;
  showPicker?: boolean; fulfillerId?: string; pickerSeed?: Variant[];
  line?: { mappingId: string; qty: number; unitCost?: number }; setLine?: (v: { mappingId: string; qty: number; unitCost?: number }) => void;
  /** Đơn ĐÃ ĐẨY (status=created): dòng đã gửi nhà in → hiện panel CHỈ ĐỌC để đối chiếu */
  reviewLine?: { product: string; variant: string | null; sku: string; qty: number } | null;
}) {
  const { t } = useLang();
  const [sideIdx, setSideIdx] = useState(0); // mặt đang xem lớn (design nhiều mặt: photo book 24 trang, calendar 26 mặt)
  useEffect(() => { setSideIdx(0); }, [it.design_id]);
  const [busy, setBusy] = useState(false);
  const assign = async (sku: number | string | null) => {
    setBusy(true);
    const j = await fetch(`/api/order-items/${it.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skuCode: sku }) }).then((r) => r.json());
    setBusy(false);
    if (j.ok) { flash(sku === null ? t("o.unassigned") : `${t("o.assigned")} #${j.design?.sku_code ?? sku}`); onSaved(); }
    else flash("✗ " + (j.error ?? "Error"));
  };
  // Ô DesignId sửa/dán trực tiếp + tự gán (khỏi bấm Assign, khỏi Delete trước khi đổi).
  const assignedSku = it.design_id ? String(it.design_sku ?? "") : "";
  const [val, setVal] = useState(assignedSku);
  useEffect(() => { setVal(assignedSku); }, [assignedSku]);
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitAssign = () => { if (debRef.current) clearTimeout(debRef.current); if (val && val !== assignedSku) assign(val); };
  const onValChange = (raw: string) => {
    const clean = raw.replace(/\D/g, "");
    setVal(clean);
    if (debRef.current) clearTimeout(debRef.current);
    if (clean && clean !== assignedSku) debRef.current = setTimeout(() => assign(clean), 700); // dán/gõ xong ~0.7s tự gán
  };
  // Upload mockup thẳng vào ô ảnh của item (đơn CSV không có mockup)
  const mockRef = useRef<HTMLInputElement>(null);
  const [upBusy, setUpBusy] = useState(false);
  const uploadMockup = async (file: File) => {
    if (!file.type.startsWith("image/")) return flash(t("o.onlyImageFiles"));
    setUpBusy(true);
    try {
      const tk = await fetch("/api/order-issues/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, contentType: file.type }) }).then((r) => r.json());
      if (!tk.ok) throw new Error(tk.error ?? "upload-url");
      const put = await fetch(tk.url, { method: tk.method ?? "PUT", headers: tk.headers ?? {}, body: file });
      if (!put.ok) throw new Error(`R2 ${put.status}`);
      const s = await fetch(`/api/order-items/${it.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mockupKey: tk.storageKey }) }).then((r) => r.json());
      if (!s.ok) throw new Error(s.error ?? "save");
      flash(t("o.mockupUploaded")); onSaved();
    } catch (e) { flash("✗ " + (e as Error).message); }
    setUpBusy(false);
  };
  const img = it.mockupUrl ?? it.imageUrl; // KHÔNG fallback sang ảnh design — gán DesignId không đổi mockup
  const promptApi = usePrompt();
  // Import mockup bằng link ảnh (dán URL) — lưu nguyên URL vào mockupKey, fileUrl trả thẳng
  const importMockupLink = async () => {
    const url = await promptApi({ title: "Import mockup link", message: "Paste mockup image URL (http/https):", confirmText: "Save" });
    if (!url) return;
    if (!/^https?:\/\//i.test(url.trim())) { flash("✗ URL must start with http(s)://"); return; }
    const s = await fetch(`/api/order-items/${it.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mockupKey: url.trim() }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    if (s.ok) { flash(t("o.mockupUploaded")); onSaved(); } else flash("✗ " + (s.error ?? ""));
  };
  const [zoom, setZoom] = useState<string | null>(null);
  return (
    <div className="o2-item">
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
      <div className="o2-thumb" style={{ position: "relative", ...(img ? { cursor: "zoom-in" } : (canEdit ? { cursor: "pointer" } : {})) }}
        onClick={() => { if (img) setZoom(img); else if (canEdit) mockRef.current?.click(); }}
        title={img ? t("o.clickEnlarge") : (canEdit ? t("o.clickUploadMockup") : undefined)}>
        {img
          ? <img src={img} alt="" loading="lazy" />
          : <span style={{ fontSize: 10.5, color: "var(--muted)", textAlign: "center", lineHeight: 1.3, padding: 4 }}>{upBusy ? t("o.loadingShort") : (canEdit ? "＋ Mockup" : t("o.noImg"))}</span>}
        {canEdit && <>
          <input ref={mockRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMockup(f); e.target.value = ""; }} />
          {img && <button onClick={(e) => { e.stopPropagation(); mockRef.current?.click(); }} title={t("o.changeMockup")} style={{ position: "absolute", bottom: 3, right: 3, width: 20, height: 20, borderRadius: 6, border: "none", background: "rgba(0,0,0,.55)", color: "#fff", fontSize: 11, cursor: "pointer", display: "grid", placeItems: "center", lineHeight: 1 }}>{upBusy ? "…" : <IconPencil width={12} height={12} />}</button>}
          <button onClick={(e) => { e.stopPropagation(); importMockupLink(); }} title="Import mockup link"
            style={{ position: "absolute", bottom: 3, left: 3, width: 20, height: 20, borderRadius: 6, border: img ? "none" : "1px solid var(--line)", background: img ? "rgba(0,0,0,.55)" : "var(--card)", color: img ? "#fff" : "var(--muted)", cursor: "pointer", display: "grid", placeItems: "center", lineHeight: 1 }}><IconLink width={11} height={11} /></button>
        </>}
      </div>
      <div className="o2-detail" style={{ fontSize: 13 }}>
        {/* Title chữ thường (không đậm) để variant/personalization nổi lên — giống layout Etsy */}
        <div style={{ color: "var(--ink)", lineHeight: 1.45 }}>{decodeEntities(it.product_title as string)}</div>
        {/* Variant: mỗi thuộc tính một dòng như trên Etsy — nhãn chữ thường mờ, giá trị in đậm.
            decodeEntities() để đơn CŨ trong DB (còn dính &quot;) cũng hiện đúng, không cần backfill. */}
        {(() => {
          const parts = splitVariant(it.variant as string | null);
          if (!parts.length) return null;
          // Copy full variants dạng "label: value" mỗi dòng (kèm personalization nếu có) — gửi designer làm mẫu cho nhanh.
          const copyDetails = () => {
            const lines = parts.map((v: VariantPart) => (v.label ? `${v.label}: ${v.value}` : v.value));
            const pz = (it.personalization ?? "").trim();
            if (pz && !parts.some((p) => (p.value || "").includes(pz))) lines.push(`Personalization: ${pz}`);
            navigator.clipboard?.writeText(lines.join("\n"));
            flash(t("d.copied"));
          };
          return (
            <div style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}>
              {parts.map((v: VariantPart, i: number) => (
                <div key={i} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {v.label && <span style={{ color: "var(--muted)", fontWeight: 500, flexShrink: 0 }}>{v.label}</span>}
                  <span style={{ color: "var(--ink)", fontWeight: 700 }}>{v.value}</span>
                </div>
              ))}
              <button type="button" onClick={copyDetails} title="Copy all details (label: value)"
                style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 3, padding: "2px 8px", border: "1px solid var(--line)", background: "var(--card)", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 700, color: "var(--blue)" }}>
                <IconCopy width={11} height={11} /> Copy details
              </button>
            </div>
          );
        })()}
        {it.productUrl && (
          <a href={it.productUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "#E0913C", fontWeight: 700, textDecoration: "none", marginTop: 3 }}>
            {t("o.viewOnEtsy")} ↗
          </a>
        )}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", color: "var(--muted)", marginTop: 5, fontSize: 12.5 }}>
          <span>{t("o.qtyLabel")}: <b style={{ color: "var(--ink)" }}>{it.qty}</b></span>
          {it.internal_sku && <span>SKU: <b style={{ color: "var(--ink)" }}>{it.internal_sku}</b></span>}
          <span>{t("o.price")}: <b style={{ color: "var(--ink)" }}>{money(it.unit_price)}</b></span>
        </div>
        <Personalization it={it} onSaved={onSaved} flash={flash} />
      </div>
      {/* Gán design — nhãn DesignId gắn liền + preview bên dưới (theo mẫu) */}
      <div className="o2-assigncol">
        <div className="ig">
          <span className="ig-l">DesignId</span>
          <input placeholder="132691" value={val} disabled={busy}
            onChange={(e) => onValChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commitAssign(); }}
            onBlur={commitAssign}
            className="ig-in" />
          {it.design_id && (
            <button onClick={() => assign(null)} disabled={busy} className="ig-btn danger" title={t("o.unassign")}><IconTrash width={14} height={14} /></button>
          )}
        </div>

        {/* Preview design đã gán — 1 ảnh LỚN + dải thumbnail trượt ngang (giống card Design).
            Trước đây trải phẳng mọi mặt → photo book 24 trang chiếm cả màn hình. */}
        {(() => {
          const sides = (it.designSides ?? []).filter((s) => s.thumb);
          if (!it.design_id || !sides.length) {
            return it.design_id && it.designThumb ? (
              <div className="o2-dpreview checker" onClick={() => setZoom(it.designThumb)} title={t("o.clickEnlarge")}>
                <img src={it.designThumb} alt="" />
              </div>
            ) : null;
          }
          const i = Math.min(sideIdx, sides.length - 1);
          const cur = sides[i];
          const labelOf = (x: typeof cur) => t(SIDE_KEY[x.kind]) || x.label;
          return (
            <div style={{ marginTop: 10, width: 232, maxWidth: "100%" }}>
              {/* Ảnh lớn của mặt đang chọn */}
              <div className="o2-dpreview checker" style={{ width: "100%", marginTop: 0 }}
                onClick={() => setZoom(cur.original ?? cur.thumb)} title={labelOf(cur) + " · " + t("o.clickEnlarge")}>
                <img src={cur.thumb!} alt={labelOf(cur)} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: "var(--ink)" }}>{labelOf(cur)}</span>
                <span style={{ fontSize: 10.5, color: "var(--faint)", marginLeft: "auto" }}>{i + 1}/{sides.length}</span>
              </div>
              {/* Dải thumbnail — trượt ngang khi nhiều mặt */}
              {sides.length > 1 && (
                <div style={{ display: "flex", gap: 5, marginTop: 6, overflowX: "auto", paddingBottom: 4, scrollbarWidth: "thin" }}>
                  {sides.map((s, idx) => (
                    <button key={idx} onClick={() => setSideIdx(idx)} title={labelOf(s)}
                      style={{
                        flex: "0 0 auto", width: 40, height: 40, padding: 0, borderRadius: 7, cursor: "pointer", overflow: "hidden",
                        background: "#fff", border: idx === i ? "2px solid var(--accent)" : "1px solid var(--line)",
                        opacity: idx === i ? 1 : 0.72,
                      }}>
                      <img src={s.thumb!} alt={labelOf(s)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
        {/* (đã có DesignId ở ô trên — không lặp lại caption) */}

        {/* Gợi ý khi chưa gán — đơn custom thì không gợi ý, chỉ hiện design gốc để tham chiếu */}
        {!it.design_id && it.custom && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#FFF6F4", border: "1px solid #F6D9D0", borderRadius: 9, padding: "8px 10px", fontSize: 11.5, fontWeight: 700, color: "#B4543C" }}>
              <IconWarn />
              {t("o.customNoSuggest")}
            </div>
            {it.baseDesign && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".3px", color: "var(--muted)", marginBottom: 5 }}>
                  {t("o.baseDesign")} #{it.baseDesign.skuCode}
                </div>
                {it.baseDesign.thumb && (
                  <div className="o2-dpreview checker" onClick={() => setZoom(it.baseDesign!.thumb)} title={t("o.clickEnlarge")}>
                    <img src={it.baseDesign.thumb} alt="" />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!it.design_id && !it.custom && !!it.suggests?.length && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".3px", color: "var(--muted)", marginBottom: 6 }}>
              {t("o.suggestDesigns")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {it.suggests.map((sg) => (
                <div key={sg.designId} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 8 }}>
                  <div style={{ marginBottom: 6 }}>{reasonBadge(sg, t)}</div>
                  {sg.thumb && (
                    <div className="o2-dpreview checker" onClick={() => setZoom(sg.thumb)} title={t("o.clickEnlarge")}>
                      <img src={sg.thumb} alt="" />
                    </div>
                  )}
                  <button onClick={() => assign(sg.skuCode)} disabled={busy} style={{ marginTop: 6, width: "100%", background: "var(--green)", color: "#fff", border: "none", borderRadius: 9, padding: "8px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                    {t("o.acceptDesign")} #{sg.skuCode}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {showPicker && fulfillerId && (
        <div style={{ flex: "1 1 300px", minWidth: 260, background: "#FFF6F4", border: "1px solid #F6D9D0", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".3px", color: "var(--muted)", marginBottom: 8 }}>{t("o.chooseVariantPush")}</div>
          <VariantPicker fulfillerId={fulfillerId} seed={pickerSeed}
            line={line ?? { mappingId: "", qty: it.qty }}
            setLine={setLine ?? (() => {})} />
        </div>
      )}
      {/* ĐÃ ĐẨY — panel CHỈ ĐỌC, cùng chỗ với panel chọn variant, để đối chiếu variant/SKU/SL đã gửi */}
      {!showPicker && reviewLine && (
        <div style={{ flex: "1 1 300px", minWidth: 260, background: "#F3F8F4", border: "1px solid #CFE6D6", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".3px", color: "var(--muted)", marginBottom: 8 }}>{t("o.pushedVariant")}</div>
          {([
            [t("o.product"), reviewLine.product],
            [t("o.variantLabel"), reviewLine.variant ?? "—"],
            [t("o.skuVariant"), reviewLine.sku],
            [t("o.qty"), String(reviewLine.qty)],
          ] as [string, string][]).map(([lab, val]) => (
            <div key={lab} className="o2-field" style={{ marginBottom: 8 }}>
              <label>{lab}</label>
              <input readOnly value={val} title={val}
                style={{ ...inp, width: "100%", background: "#fff", color: "var(--ink)", cursor: "default", fontWeight: 600 }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TikTokImportModal({ close, reload, flash, sellers, stores }: {
  close: () => void; reload: () => void; flash: (m: string) => void;
  sellers: Opt[]; stores: Opt[];
}) {
  const { t } = useLang();
  const confirm = useConfirm();
  const ttStores = stores.filter((s) => s.marketplace === "tiktok");
  const [storeId, setStoreId] = useState("");
  const [sellerId, setSellerId] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const doImport = async (file: File) => {
    // Bắt buộc chọn store: import không store thì đơn không gắn được vào shop nào,
    // sai seller, sai doanh thu, và không biết đường push tracking về đâu.
    if (!storeId) { flash("✗ " + t("o.mustPickStore")); return; }
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("storeId", storeId);
    if (sellerId) fd.append("sellerId", sellerId);
    const j = await fetch("/api/orders/import-tiktok", { method: "POST", body: fd }).then((r) => r.json()).catch(() => ({ ok: false, error: t("o.netError") }));
    setBusy(false);
    if (j.ok) {
      flash(t("o.importResult").replace("{o}", String(j.orders)).replace("{c}", String(j.created)).replace("{s}", String(j.skipped)) + (j.errors?.length ? t("o.errorsSuffix").replace("{n}", String(j.errors.length)) : ""));
      if (j.errors?.length) await confirm({ message: t("o.errorsLines") + j.errors.join("\n"), info: true });
      reload(); close();
    } else flash("✗ " + (j.error ?? t("o.importError")));
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(24,30,42,.5)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={busy ? undefined : close}>
      <div className="modal-card" style={{ background: "#fff", borderRadius: 18, width: 460, maxWidth: "95vw", padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <b style={{ fontSize: 16, display: "inline-flex", alignItems: "center", gap: 8 }}><MarketplaceLogo mk="tiktok" size={20} /> {t("o.importTiktokTitle")}</b>
          {!busy && <button onClick={close} style={{ background: "none", border: "none", fontSize: 17, cursor: "pointer", color: "var(--muted)" }}>✕</button>}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6, marginBottom: 16 }}>
          {t("o.tiktokGuide")}
        </div>

        <label style={{ ...rLbl, display: "block", marginBottom: 12 }}>{t("o.tiktokStore")} <span style={{ color: "var(--red)" }}>*</span>
          {/* Chỉ hiện store TikTok — trước đây liệt kê cả shop Etsy, chọn nhầm là đơn vào sai shop */}
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} style={{ ...inp, width: "100%", marginTop: 4, borderColor: storeId ? undefined : "var(--red)" }}>
            <option value="">{t("o.pickStore")}</option>
            {ttStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {!ttStores.length && <div style={{ fontSize: 11.5, color: "var(--red)", marginTop: 4, fontWeight: 600 }}>{t("o.noStoreForPlatform")}</div>}
        </label>
        <label style={{ ...rLbl, display: "block", marginBottom: 16 }}>{t("o.sellerOptional")}
          <select value={sellerId} onChange={(e) => setSellerId(e.target.value)} style={{ ...inp, width: "100%", marginTop: 4 }}>
            <option value="">—</option>
            {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ""; }} />
        <button onClick={() => fileRef.current?.click()} disabled={busy || !storeId}
          style={{ ...btnBlue, width: "100%", padding: "12px", fontSize: 14, opacity: (busy || !storeId) ? 0.5 : 1, cursor: storeId ? "pointer" : "not-allowed", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <IconUpload width={16} height={16} /> {busy ? t("o.importing") : t("o.pickTiktokCsvImport")}
        </button>
        <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 10 }}>{t("o.dupSkipNote")}</div>
      </div>
    </div>
  );
}


function EtsyImportModal({ close, reload, flash, sellers, stores }: {
  close: () => void; reload: () => void; flash: (m: string) => void;
  sellers: Opt[]; stores: Opt[];
}) {
  const { t } = useLang();
  const confirm = useConfirm();
  const etsyStores = stores.filter((s) => s.marketplace === "etsy");
  const [storeId, setStoreId] = useState("");
  const [sellerId, setSellerId] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const doImport = async (file: File) => {
    // Bắt buộc chọn store: import không store thì đơn không gắn được vào shop nào,
    // sai seller, sai doanh thu, và không biết đường push tracking về đâu.
    if (!storeId) { flash("✗ " + t("o.mustPickStore")); return; }
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("storeId", storeId);
    if (sellerId) fd.append("sellerId", sellerId);
    const j = await fetch("/api/orders/import-etsy", { method: "POST", body: fd }).then((r) => r.json()).catch(() => ({ ok: false, error: t("o.netError") }));
    setBusy(false);
    if (j.ok) {
      if (j.mode === "payments") {
        flash(t("o.feeUpdated").replace("{n}", String(j.updated)) + (j.notFound ? t("o.notImportedSuffix").replace("{n}", String(j.notFound)) : ""));
      } else {
        flash(`✓ ${j.orders} ${t("o.etsyResult")} ${j.created}, ${t("o.etsySkipped")} ${j.skipped}${j.errors?.length ? ` · ${j.errors.length} ${t("o.errors")}` : ""}`);
      }
      if (j.errors?.length) await confirm({ message: t("o.errorsLines") + j.errors.join("\n"), info: true });
      reload(); close();
    } else flash("✗ " + (j.error ?? t("o.importError")));
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(24,30,42,.5)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={busy ? undefined : close}>
      <div className="modal-card" style={{ background: "#fff", borderRadius: 18, width: 460, maxWidth: "95vw", padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <b style={{ fontSize: 16 }}>{t("o.etsyModalTitle")}</b>
          {!busy && <button onClick={close} style={{ background: "none", border: "none", fontSize: 17, cursor: "pointer", color: "var(--muted)" }}>✕</button>}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6, marginBottom: 16 }}>
          {t("o.etsyGuide")}
        </div>

        <label style={{ ...rLbl, display: "block", marginBottom: 12 }}>{t("o.etsyStore")} <span style={{ color: "var(--red)" }}>*</span>
          {/* Chỉ hiện store Etsy */}
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} style={{ ...inp, width: "100%", marginTop: 4, borderColor: storeId ? undefined : "var(--red)" }}>
            <option value="">{t("o.pickStore")}</option>
            {etsyStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {!etsyStores.length && <div style={{ fontSize: 11.5, color: "var(--red)", marginTop: 4, fontWeight: 600 }}>{t("o.noStoreForPlatform")}</div>}
        </label>
        <label style={{ ...rLbl, display: "block", marginBottom: 16 }}>{t("o.sellerOptional")}
          <select value={sellerId} onChange={(e) => setSellerId(e.target.value)} style={{ ...inp, width: "100%", marginTop: 4 }}>
            <option value="">—</option>
            {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ""; }} />
        <button onClick={() => fileRef.current?.click()} disabled={busy || !storeId}
          style={{ ...btnBlue, width: "100%", padding: "12px", fontSize: 14, opacity: (busy || !storeId) ? 0.5 : 1, cursor: storeId ? "pointer" : "not-allowed", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <IconUpload width={16} height={16} /> {busy ? t("o.importing") : t("o.pickCsvImport")}
        </button>
        <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 10 }}>{t("o.dupSkipNote")}</div>
        <div style={{ borderTop: "1px solid var(--line)", marginTop: 14, paddingTop: 12 }}>
          <button onClick={async () => {
            const j = await fetch("/api/orders/reparse-etsy-items", { method: "POST" }).then((r) => r.json()).catch(() => ({ ok: false }));
            flash(j.ok ? t("o.cleanupResult").replace("{u}", String(j.updated)).replace("{s}", String(j.scanned)) : t("o.cleanupErr"));
            if (j.ok) reload();
          }} disabled={busy} style={{ background: "none", border: "none", color: "var(--blue)", fontWeight: 700, fontSize: 12, cursor: "pointer", padding: 0 }}>
            <IconRefresh width={12} height={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />{t("o.cleanupEtsyBtn")}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateOrderModal({ close, reload, flash, sellers, stores }: {
  close: () => void; reload: () => void; flash: (m: string) => void;
  sellers: Opt[]; stores: Opt[];
}) {
  const { t } = useLang();
  const [f, setF] = useState({
    platform: "etsy", externalId: "", storeId: "", sellerId: "",
    buyerFirst: "", buyerLast: "", addr1: "", addr2: "", city: "", state: "", zip: "", country: "United States",
    total: "", platformFee: "",
  });
  const [items, setItems] = useState([{ productTitle: "", internalSku: "", qty: 1, unitPrice: "" }]);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const setIt = (i: number, k: string, v: string | number) => setItems(items.map((x, j) => j === i ? { ...x, [k]: v } : x));

  const submit = async () => {
    setBusy(true);
    const j = await fetch("/api/orders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...f, total: Number(f.total || 0), platformFee: Number(f.platformFee || 0),
        items: items.filter((x) => x.productTitle.trim()).map((x) => ({ ...x, qty: Number(x.qty) || 1, unitPrice: Number(x.unitPrice || 0) })) }),
    }).then((r) => r.json());
    setBusy(false);
    if (j.ok) { flash(t("o.orderCreated") + j.order.externalId); reload(); close(); } else flash("✗ " + (j.error ?? t("o.errorWord")));
  };

  const I = (k: keyof typeof f, ph: string) => (
    <input value={f[k]} placeholder={ph} onChange={(e) => set(k, e.target.value)} style={{ ...inp, width: "100%" }} />
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(42,48,60,.45)", zIndex: 95, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={close}>
      <div className="modal-card" style={{ background: "#fff", borderRadius: 16, width: 760, maxWidth: "96vw", maxHeight: "92vh", overflowY: "auto", padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <b style={{ fontSize: 15 }}>{t("o.createManual")}</b>
          <button onClick={close} style={{ background: "none", border: "none", fontSize: 17, cursor: "pointer", color: "var(--muted)" }}>✕</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <select value={f.platform} onChange={(e) => set("platform", e.target.value)} style={inp}>
            <option value="etsy">Etsy</option><option value="amazon">Amazon</option><option value="tiktok">TikTok</option>
          </select>
          {I("externalId", t("co.externalId"))}
          <select value={f.storeId} onChange={(e) => set("storeId", e.target.value)} style={inp}>
            <option value="">— Store —</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {sellers.length > 0 && (
            <select value={f.sellerId} onChange={(e) => set("sellerId", e.target.value)} style={inp}>
              <option value="">— Seller —</option>
              {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {I("total", "Total ($)")}
          {I("platformFee", t("co.platformFee"))}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, margin: "14px 0 8px" }}>{t("o.recipientWord")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {I("buyerFirst", t("co.first"))}{I("buyerLast", t("co.last"))}{I("addr1", t("co.addr1"))}
          {I("addr2", t("co.addr2"))}{I("city", t("co.city"))}{I("state", t("co.state"))}
          {I("zip", t("co.zip"))}{I("country", t("co.country"))}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, margin: "14px 0 8px" }}>{t("o.productsHeader")}</div>
        {items.map((it, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 70px 90px 34px", gap: 8, marginBottom: 8 }}>
            <input value={it.productTitle} placeholder={t("co.productTitle")} onChange={(e) => setIt(i, "productTitle", e.target.value)} style={inp} />
            <input value={it.internalSku} placeholder={t("co.internalSku")} onChange={(e) => setIt(i, "internalSku", e.target.value)} style={inp} />
            <input type="number" min={1} value={it.qty} onChange={(e) => setIt(i, "qty", Number(e.target.value))} style={inp} />
            <input value={it.unitPrice} placeholder={t("co.price")} onChange={(e) => setIt(i, "unitPrice", e.target.value)} style={inp} />
            <button onClick={() => setItems(items.filter((_, j) => j !== i))} disabled={items.length === 1}
              style={{ ...btnGhost, padding: "4px 0", opacity: items.length === 1 ? 0.4 : 1 }}>✕</button>
          </div>
        ))}
        <button onClick={() => setItems([...items, { productTitle: "", internalSku: "", qty: 1, unitPrice: "" }])} style={btnGhost}>{t("o.addProduct")}</button>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button onClick={close} style={btnGhost}>{t("c.cancel")}</button>
          <button onClick={submit} disabled={busy || !items.some((x) => x.productTitle.trim())}
            style={{ ...btnBlue, opacity: busy || !items.some((x) => x.productTitle.trim()) ? 0.6 : 1 }}>{busy ? t("co.creating") : t("co.createOrder")}</button>
        </div>
      </div>
    </div>
  );
}

function OrderNote({ order, canEdit, onSaved, flash }: { order: Order; canEdit: boolean; onSaved: () => void; flash: (m: string) => void }) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(order.note ?? "");
  const save = async () => {
    const j = await fetch(`/api/orders/${order.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: v }) }).then((r) => r.json());
    if (j.ok) { flash(t("o.savedNote")); setEditing(false); onSaved(); } else flash("✗ " + (j.error ?? "Error"));
  };
  if (editing) return (
    <div style={{ display: "flex", gap: 8, marginTop: 8, maxWidth: 560 }}>
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()}
        placeholder={t("o.notePlaceholder")} style={{ ...inp, flex: 1 }} />
      <button onClick={save} style={btnBlue}>{t("c.save")}</button>
      <button onClick={() => setEditing(false)} style={btnGhost}>{t("c.cancel")}</button>
    </div>
  );
  return order.note ? (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginTop: 8, background: "var(--blue-soft)", borderRadius: 10, padding: "7px 14px", fontSize: 13, maxWidth: 560 }}>
      <span>{order.note}</span>
      {canEdit && <button onClick={() => { setV(order.note ?? ""); setEditing(true); }} style={{ background: "none", border: "none", color: "var(--blue)", cursor: "pointer", fontSize: 12, padding: 0 }}>{t("c.edit")}</button>}
    </div>
  ) : canEdit ? (
    <button onClick={() => setEditing(true)} style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8, background: "none", border: "1px dashed var(--line)", color: "var(--muted)", borderRadius: 8, padding: "5px 12px", fontSize: 12, cursor: "pointer" }}>+ {t("o.addNote")}</button>
  ) : null;
}

function Personalization({ it, onSaved, flash }: { it: Item; onSaved: () => void; flash: (m: string) => void }) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(it.personalization ?? "");
  const save = async () => {
    const j = await fetch(`/api/order-items/${it.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personalization: v }) }).then((r) => r.json());
    if (j.ok) { flash(t("o.savedPerso")); setEditing(false); onSaved(); } else flash("✗ " + (j.error ?? "Error"));
  };
  if (editing) return (
    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
      <textarea autoFocus value={v} onChange={(e) => setV(e.target.value)} rows={2}
        placeholder={t("o.persoPlaceholder")} style={{ ...inp, flex: 1, resize: "vertical" }} />
      <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button onClick={save} style={btnBlue}>{t("c.save")}</button>
        <button onClick={() => setEditing(false)} style={btnGhost}>{t("c.cancel")}</button>
      </span>
    </div>
  );
  return (
    <div style={{ marginTop: 6, fontSize: 13 }}>
      {/* Etsy "Custom options" giờ nằm sẵn trong variant (tách dòng như trên Etsy) → không hiện lại
          ô vàng nữa cho khỏi lặp. Chỉ hiện khi nội dung KHÔNG có trong variant (staff tự thêm tay). */}
      {it.personalization && !decodeEntities(it.variant).includes(decodeEntities(it.personalization).slice(0, 20))
        ? <span style={{ background: "var(--amber-soft)", borderRadius: 8, padding: "4px 10px", display: "inline-block" }}>
            <b>{t("o.personalization")}:</b> {decodeEntities(it.personalization)}
            <button onClick={() => { setV(it.personalization ?? ""); setEditing(true); }} style={{ background: "none", border: "none", color: "var(--blue)", cursor: "pointer", fontSize: 12, marginLeft: 8, padding: 0 }}>{t("c.edit")}</button>
          </span>
        : <button onClick={() => setEditing(true)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 12, padding: 0, textDecoration: "underline" }}>+ {t("o.addPersonalization")}</button>}
    </div>
  );
}

function Pill({ label, color, active, onClick }: { label: string; color: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      background: color, color: "#fff", border: active ? "2.5px solid #111827" : "2.5px solid transparent",
      borderRadius: 999, padding: "5px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer",
      boxShadow: active ? "0 2px 8px rgba(17,24,39,.25)" : "none",
    }}>{label}</button>
  );
}

function Pager({ page, pages, setPage, show, setShow, total }: { page: number; pages: number; setPage: (n: number) => void; show: number; setShow: (n: number) => void; total: number }) {
  const { t } = useLang();
  const nums: (number | "…")[] = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 2) nums.push(i);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Show</span>
      <select value={show} onChange={(e) => setShow(Number(e.target.value))} style={inp}>
        {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <button onClick={() => setPage(Math.max(1, page - 1))} style={btnGhost}>‹</button>
      {nums.map((n, i) => n === "…" ? <span key={i} style={{ color: "var(--muted)" }}>…</span> : (
        <button key={i} onClick={() => setPage(n)} style={{ ...btnGhost, background: n === page ? "var(--blue)" : "#fff", color: n === page ? "#fff" : "var(--ink)", fontWeight: 700 }}>{n}</button>
      ))}
      <button onClick={() => setPage(Math.min(pages, page + 1))} style={btnGhost}>›</button>
      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{total.toLocaleString()} {t("o.ordersWord")}</span>
    </div>
  );
}

const inp: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 10, padding: "7px 10px", fontSize: 13, background: "#fff" };
const btnBlue: React.CSSProperties = { background: "var(--primary-grad)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" };
const btnGhost: React.CSSProperties = { background: "#fff", color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const btnRed: React.CSSProperties = { background: "var(--red)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" };
const rLbl: React.CSSProperties = { fontSize: 13, fontWeight: 600 };
