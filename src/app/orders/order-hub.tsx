"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import DateRangePicker, { rangeToDates, RangeValue } from "@/components/date-range";
import { useLang } from "@/components/lang-provider";
import { IconCopy, IconPin, IconTruck, IconTrash, IconUpload, IconWarn } from "@/components/icons";

type Item = {
  id: string; product_title: string; internal_sku: string | null; qty: number; unit_price: string;
  design_id: string | null; design_sku: number | null; design_title: string | null; personalization: string | null;
  special_print: boolean; designThumb: string | null; mockupUrl: string | null;
  designSides?: { kind: string; label: string; thumb: string | null; original: string | null }[];
  suggest: { designId: string; skuCode: number; title: string; thumb: string | null } | null;
};
type Order = {
  id: string; external_id: string; platform: string; status: string; ordered_at: string;
  buyer_first: string | null; buyer_last: string | null;
  addr1: string | null; addr2: string | null; city: string | null; state: string | null; zip: string | null; country: string;
  total: string; platform_fee: string; seller_name: string | null; store_name: string | null; order_label: string | null; note: string | null;
  items: Item[];
};
type DetailItem = Item & { mappings: Record<string, { fulfillerSku: string; unitCost: number }> };
type Variant = { id: string; fulfillerSku: string; internalSku: string; unitCost: number; style: string; color: string; size: string };
type Detail = { storeName?: string | null; order: Order & Record<string, unknown>; items: DetailItem[]; fulfillerOptions: { fulfillerId: string; name: string; mapped: boolean; estCost: number | null }[]; catalog: Record<string, Variant[]>; ffOrders?: FfOrder[] };
type Opt = { id: string; name: string };
type FfOrder = { id: string; fulfillerId?: string; fulfillerName: string; status: string; trackingNumber: string | null; trackingCarrier: string | null; trackingUrl: string | null; supplierOrderUrl: string | null; externalFfId: string | null; cost: string | null; baseCost: string | null; shipCost: string | null };

const STATUS_COLORS: Record<string, string> = {
  new: "#1D5FAE", created: "#D9935B", in_production: "#4F9E93", shipped: "#8FAF5C",
  completed: "#5E86C9", has_issues: "#C06B82", trash: "#BBA054",
};
const money = (n: number | string) => "$" + Number(n).toFixed(2);
// Link tra cứu tracking theo hãng vận chuyển
function trackingUrl(carrier: string | null, num: string): string {
  const c = (carrier ?? "").toLowerCase();
  if (c.includes("usps")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${num}`;
  if (c.includes("ups")) return `https://www.ups.com/track?tracknum=${num}`;
  if (c.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${num}`;
  if (c.includes("dhl")) return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${num}`;
  return `https://parcelsapp.com/en/tracking/${num}`;
}

export default function OrderHub({ canEdit = true, canPushFf = true }: { canEdit?: boolean; canPushFf?: boolean; ownOnly?: boolean }) {
  const [data, setData] = useState<{ orders: Order[]; counts: Record<string, number>; total: number; sellers: { id: string; name: string }[]; stores: { id: string; name: string }[]; fulfillers: { id: string; name: string }[] } | null>(null);
  const [status, setStatus] = useState("");
  const [sellerId, setSellerId] = useState("");
  const [storeId, setStoreId] = useState("");
  const { t } = useLang();
  const copyText = (v: string) => { navigator.clipboard?.writeText(v); flash(t("d.copied")); };
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState("");
  const [fulfillerId, setFulfillerId] = useState("");
  const [dr, setDr] = useState<RangeValue | null>({ range: "30d" });
  const [page, setPage] = useState(1); const [show, setShow] = useState(20);
  const [msg, setMsg] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selIds, setSelIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("shipped");

  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), show: String(show) });
    if (status) p.set("status", status);
    if (sellerId) p.set("sellerId", sellerId);
    if (storeId) p.set("storeId", storeId);
    if (q) p.set("q", q);
    if (platform) p.set("platform", platform);
    if (fulfillerId) p.set("fulfillerId", fulfillerId);
    if (dr) { const d = rangeToDates(dr); p.set("from", d.from); p.set("to", d.to); }
    const j = await fetch(`/api/orders?${p}`).then((r) => r.json());
    if (j.ok) setData(j);
  }, [page, show, status, sellerId, storeId, q, platform, fulfillerId, dr]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="panel empty">{t("o.loadingOrders")}</div>;
  const all = Object.values(data.counts).reduce((a, b) => a + b, 0);
  const pages = Math.max(Math.ceil(data.total / show), 1);
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2500); };

  const cloneOrder = async (id: string) => {
    const j = await fetch(`/api/orders/${id}/clone`, { method: "POST" }).then((r) => r.json());
    if (j.ok) { flash(`✓ Đã nhân bản → #${j.order.externalId}`); load(); } else flash("✗ " + (j.error ?? "Lỗi"));
  };
  const toggleSel = (id: string) => {
    const n = new Set(selIds);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelIds(n);
  };
  const applyBulk = async () => {
    if (!selIds.size) return;
    if (bulkStatus === "trash" && !confirm(`Chuyển ${selIds.size} đơn vào Trash? Giá vốn sẽ hoàn về 0.`)) return;
    const j = await fetch("/api/orders/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(selIds), status: bulkStatus }) }).then((r) => r.json());
    if (j.ok) { flash(`✓ Đã đổi ${j.updated} đơn → ${bulkStatus.toUpperCase()}${j.refunded ? ` · hoàn giá vốn ${j.refunded} đơn` : ""}${j.skipped ? ` · bỏ qua ${j.skipped}` : ""}`); setSelIds(new Set()); load(); }
    else flash("✗ " + (j.error ?? "Lỗi"));
  };

  return (
    <>
      {msg && <div style={{ position: "fixed", top: 16, right: 16, zIndex: 100, background: "#111827", color: "#fff", padding: "10px 18px", borderRadius: 12, fontSize: 13.5 }}>{msg}</div>}

      {/* Page head: tiêu đề + hàng nút (theo FusionDNPrint) */}
      <div className="page-head">
        <div className="page-actions">
          <DateRangePicker value={dr ?? { range: "" }} onChange={setDr} align="right" allowClear onClear={() => setDr(null)} />
          <a href={`/api/orders/export${status ? `?status=${status}` : ""}`} className="btn btn-outline">{t("c.export")}</a>
          {canEdit && (
            <label className="btn btn-outline" style={{ cursor: "pointer" }}>
              {importing ? t("c.loading") : t("c.import")}
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} disabled={importing}
                onChange={async (e) => {
                  const file = e.target.files?.[0]; if (!file) return;
                  setImporting(true);
                  const fd = new FormData(); fd.append("file", file);
                  const j = await fetch("/api/orders/import", { method: "POST", body: fd }).then((r) => r.json()).catch(() => ({ ok: false, error: "lỗi mạng" }));
                  setImporting(false); e.target.value = "";
                  if (j.ok) {
                    flash(`✓ ${j.rows} dòng — tracking: ${j.trackingUpdated}, base cost: ${j.costUpdated}${j.errors?.length ? ` · ${j.errors.length} lỗi` : ""}`);
                    if (j.errors?.length) alert("Lỗi import:\n" + j.errors.join("\n"));
                    load();
                  } else flash("✗ " + (j.error ?? "Import lỗi"));
                }} />
            </label>
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
                <option value="">Tất cả</option>
                {data.sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label>{t("c.store")}</label>
            <select value={storeId} onChange={(e) => { setStoreId(e.target.value); setPage(1); }}>
              <option value="">Tất cả</option>
              {data.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>{t("c.marketplace")}</label>
            <select value={platform} onChange={(e) => { setPlatform(e.target.value); setPage(1); }}>
              <option value="">Tất cả</option>
              <option value="tiktok">TikTok</option><option value="amazon">Amazon</option><option value="etsy">Etsy</option>
            </select>
          </div>
          <div className="field">
            <label>{t("c.supplier")}</label>
            <select value={fulfillerId} onChange={(e) => { setFulfillerId(e.target.value); setPage(1); }}>
              <option value="">Tất cả</option>
              {(data.fulfillers ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        </div>

        {/* Pills trạng thái — mỗi status một màu */}
        <div className="otabs">
          <button className={`otab${!status ? " on" : ""}`} onClick={() => { setStatus(""); setPage(1); }}>All ({all})</button>
          {Object.keys(STATUS_COLORS).filter((st) => st !== "completed").map((st) => {
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
      {selIds.size > 0 && canEdit && (
        <div className="card" style={{ position: "sticky", top: 8, zIndex: 40, padding: "10px 16px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", border: "1.5px solid var(--blue)" }}>
          <b style={{ fontSize: 13.5 }}>{selIds.size} đơn đã chọn</b>
          <span style={{ width: 1, height: 22, background: "var(--line)" }} />
          <span style={{ fontSize: 13 }}>Chuyển trạng thái:</span>
          <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} style={inp}>
            {Object.keys(STATUS_COLORS).map((st) => <option key={st} value={st}>{st.toUpperCase()}</option>)}
          </select>
          <button onClick={applyBulk} style={btnBlue}>Áp dụng</button>
          <span style={{ width: 1, height: 22, background: "var(--line)" }} />
          <a href={`/api/orders/export?ids=${Array.from(selIds).join(",")}`} style={{ ...btnGhost, textDecoration: "none" }}>Export {selIds.size} đơn</a>
          <button onClick={() => setSelIds(new Set())} style={{ ...btnGhost, marginLeft: "auto" }}>Bỏ chọn tất cả</button>
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
        <OrderCard key={o.id} o={o} canEdit={canEdit} canPushFf={canPushFf}
          selected={selIds.has(o.id)} onToggleSel={() => toggleSel(o.id)}
          reload={load} flash={flash} cloneOrder={cloneOrder} copyText={copyText}
          fulfillers={data.fulfillers} />
      ))}
      {!data.orders.length && <div className="panel empty" style={{ marginTop: 12 }}>{t("o.noMatch")}</div>}

      <div style={{ marginTop: 12 }}>
        <Pager page={page} pages={pages} setPage={setPage} show={show} setShow={(n) => { setShow(n); setPage(1); }} total={data.total} />
      </div>


      {showCreate && <CreateOrderModal close={() => setShowCreate(false)} reload={load} flash={flash} sellers={data.sellers} stores={data.stores} />}
    </>
  );
}

function VariantPicker({ variants, line, setLine, label }: {
  variants: Variant[]; line: { mappingId: string; qty: number };
  setLine: (v: { mappingId: string; qty: number }) => void; label?: string;
}) {
  const { t } = useLang();
  const uniq = (a: string[]) => Array.from(new Set(a));
  const cur = variants.find((v) => v.id === line.mappingId);
  const style = cur?.style ?? "";
  const color = cur?.color ?? "";
  const size = cur?.size ?? "";
  const styles = uniq(variants.map((v) => v.style));
  const colors = uniq(variants.filter((v) => v.style === style).map((v) => v.color));
  const sizes = uniq(variants.filter((v) => v.style === style && v.color === color).map((v) => v.size));

  const pick = (nextStyle: string, nextColor: string, nextSize: string) => {
    // tìm variant khớp nhất theo thứ tự style > color > size
    let cands = variants.filter((v) => v.style === nextStyle);
    if (nextColor) { const c = cands.filter((v) => v.color === nextColor); if (c.length) cands = c; }
    if (nextSize) { const s = cands.filter((v) => v.size === nextSize); if (s.length) cands = s; }
    setLine({ ...line, mappingId: cands[0]?.id ?? "" });
  };
  const v = cur;
  const box = { ...inp, width: "100%" } as React.CSSProperties;
  const miss = !line.mappingId;

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, background: miss ? "var(--red-soft)" : "#fff", ...(miss ? { borderColor: "#F0A9A0" } : {}) }}>
      {label && <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={label}>{label}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <div className="o2-field">
          <label>Style</label>
          <select value={style} onChange={(e) => pick(e.target.value, "", "")} style={box}>
            <option value="">—</option>
            {styles.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="o2-field">
          <label>Color</label>
          <select value={color} disabled={!style} onChange={(e) => pick(style, e.target.value, "")} style={box}>
            <option value="">—</option>
            {colors.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="o2-field">
          <label>Size</label>
          <select value={size} disabled={!color} onChange={(e) => pick(style, color, e.target.value)} style={box}>
            <option value="">—</option>
            {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
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
    <div style={{ position: "fixed", inset: 0, background: "rgba(24,30,42,.5)", zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={busy ? undefined : close}>
      <div style={{ background: "#fff", borderRadius: 18, width: 480, maxWidth: "95vw", maxHeight: "92vh", overflowY: "auto", padding: 24 }} onClick={(e) => e.stopPropagation()}>
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

function ManualTracking({ orderId, ff, fulfillerId, fulfillers, flash, onSaved }: {
  orderId: string; ff?: FfOrder; fulfillerId: string; fulfillers: Opt[];
  flash: (m: string) => void; onSaved: () => void;
}) {
  const { t } = useLang();
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
      <button onClick={() => setOpen(true)} style={{ ...btnGhost, fontSize: 11.5, marginTop: 8, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <IconPin width={12} height={12} /> {ff?.trackingNumber ? t("o.editTracking") : t("o.addTracking")}
      </button>
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
      <div><label style={lab}>{t("o.trackLink")} (tùy chọn)</label><input value={v.trackingUrl} onChange={(e) => setV({ ...v, trackingUrl: e.target.value })} placeholder="https://…" style={fld} /></div>
      <div><label style={lab}>{t("o.supplierOrderLink")}</label><input value={v.supplierOrderUrl} onChange={(e) => setV({ ...v, supplierOrderUrl: e.target.value })} placeholder="Link đơn trên trang nhà cung cấp…" style={fld} /></div>
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

function OrderCard({ o, canEdit, canPushFf, selected, onToggleSel, reload, flash, cloneOrder, copyText, fulfillers }: {
  o: Order; canEdit: boolean; canPushFf: boolean; selected: boolean; onToggleSel: () => void;
  reload: () => void; flash: (m: string) => void;
  cloneOrder: (id: string) => void; copyText: (v: string) => void; fulfillers: Opt[];
}) {
  const { t } = useLang();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [showIssue, setShowIssue] = useState(false);
  const [ffSel, setFfSel] = useState("");
  const [lines, setLines] = useState<Record<string, { mappingId: string; qty: number }>>({});
  const [busy, setBusy] = useState(false);
  const [ship, setShip] = useState({
    buyerFirst: o.buyer_first ?? "", buyerLast: o.buyer_last ?? "", addr1: o.addr1 ?? "", addr2: o.addr2 ?? "",
    city: o.city ?? "", state: o.state ?? "", zip: o.zip ?? "", country: o.country ?? "United States",
    orderLabel: o.order_label ?? "",
  });

  const loadDetail = useCallback(async () => {
    if (!canPushFf) return;
    const j = await fetch(`/api/orders/${o.id}`).then((r) => r.json()).catch(() => null);
    if (j?.ok) {
      setDetail(j);
      setShip((s) => ({ ...s, orderLabel: s.orderLabel || [`${(j.storeName ?? "SHOP").replace(/[^a-zA-Z0-9]/g, "").toUpperCase()}`, o.external_id].filter(Boolean).join("-") }));
    }
  }, [o.id, o.external_id, canPushFf]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  const variants: Variant[] = ffSel && detail ? (detail.catalog[ffSel] ?? []) : [];
  const pickFulfiller = (id: string) => {
    setFfSel(id);
    if (!detail) return;
    const cat = detail.catalog[id] ?? [];
    const init: Record<string, { mappingId: string; qty: number }> = {};
    for (const it of detail.items) {
      const match = cat.find((v) => v.internalSku === it.internal_sku);
      init[it.id] = { mappingId: match?.id ?? "", qty: it.qty };
    }
    setLines(init);
  };
  const complete = !!ffSel && !!detail && detail.items.length > 0 &&
    detail.items.every((it) => lines[it.id]?.mappingId && lines[it.id]?.qty >= 1);
  const estCost = complete && detail
    ? detail.items.reduce((tot, it) => { const l = lines[it.id]; const v = variants.find((x) => x.id === l.mappingId); return tot + (v ? v.unitCost * l.qty : 0); }, 0)
    : null;

  const createOrder = async () => {
    if (!complete || !detail) return;
    setBusy(true);
    if (canEdit) {
      const s1 = await fetch(`/api/orders/${o.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ship) }).then((r) => r.json());
      if (!s1.ok) { setBusy(false); return flash("✗ " + (s1.error ?? "")); }
    }
    const body = { orderId: o.id, fulfillerId: ffSel, lines: detail.items.map((it) => ({ itemId: it.id, mappingId: lines[it.id].mappingId, qty: lines[it.id].qty })) };
    const j = await fetch("/api/fulfillment/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    setBusy(false);
    if (j.ok) { flash(t("o.pushed")); reload(); } else flash("✗ " + (j.error ?? "Error"));
  };

  const F = (k: keyof typeof ship, label: string) => (
    <div className="o2-field">
      <label>{label}</label>
      <input value={ship[k]} disabled={!canEdit} onChange={(e) => setShip({ ...ship, [k]: e.target.value })}
        style={{ ...inp, opacity: canEdit ? 1 : 0.65 }} />
    </div>
  );

  return (
    <div className="card o2">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
          {canEdit && <input type="checkbox" checked={selected} onChange={onToggleSel} style={{ width: 17, height: 17, marginTop: 3, cursor: "pointer", accentColor: "var(--blue)", flexShrink: 0 }} />}
          <div className={`o2-top${canPushFf && detail ? "" : " solo"}`} style={{ flex: 1, minWidth: 0 }}>
            {/* CỘT 1 — thông tin đơn */}
            <div className="o2-info">
              <div className="o2-l1">
                <span className="o2-num">#{o.external_id}</span>
                <button className="icon-btn" title={t("d.copy") + " ID"} onClick={() => copyText(o.external_id)}><IconCopy width={12} height={12} /></button>
                <span className="o2-status" style={{ background: STATUS_COLORS[o.status] ?? "#6B7280" }}>{o.status.toUpperCase()}</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{new Date(o.ordered_at).toISOString().slice(0, 10)}</span>
              </div>
              <div className="o2-ship">
                <span className="o2-chip plat">{o.platform}</span>
                <span className="o2-chip seller">{o.seller_name ?? "—"}</span>
                {o.store_name && <span className="o2-chip">{o.store_name}</span>}
              </div>
              {/* Người nhận + địa chỉ */}
              {([o.buyer_first, o.buyer_last].filter(Boolean).join(" ")) && (
                <div className="o2-buyer">{[o.buyer_first, o.buyer_last].filter(Boolean).join(" ")}</div>
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
              {/* Tracking / chi phí — hiện dữ liệu đã có + cho nhập tay */}
              {canPushFf && detail && (
                <div className="o2-track">
                  {(detail.ffOrders ?? []).map((f) => (
                    <div key={f.id} style={{ marginBottom: 6 }}>
                      <div className="o2-track-h">{f.fulfillerName || t("o.fulfilledBy")}</div>
                      {/* 1) Chi phí supplier */}
                      {(f.baseCost != null || f.shipCost != null) && (
                        <div className="o2-supcost">
                          <span>{t("o.baseCost")}: <b>{money(f.baseCost ?? 0)}</b></span>
                          <span>{t("o.shipFee")}: <b>{money(f.shipCost ?? 0)}</b></span>
                          <span className="tot">{t("o.total")}: <b>{money(f.cost ?? (Number(f.baseCost ?? 0) + Number(f.shipCost ?? 0)))}</b></span>
                        </div>
                      )}
                      {/* 2) Tracking */}
                      {f.trackingNumber ? (
                        <div className="o2-track-row" style={{ borderTop: "1px dashed var(--line)", paddingTop: 7, marginTop: 5 }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                              <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.trackingNumber}</span>
                              <button className="icon-btn" title={t("o.copyTrack")} onClick={() => copyText(f.trackingNumber!)}><IconCopy width={12} height={12} /></button>
                            </div>
                            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{f.trackingCarrier || t("o.carrier")}</div>
                          </div>
                          <a href={f.trackingUrl || trackingUrl(f.trackingCarrier, f.trackingNumber)} target="_blank" rel="noreferrer" style={{ ...btnGhost, textDecoration: "none", fontSize: 11.5, whiteSpace: "nowrap" }}>{t("o.trackLink")} ↗</a>
                        </div>
                      ) : (
                        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>{t("o.noTracking")}</div>
                      )}
                      {/* 3) Link đơn bên supplier */}
                      {f.supplierOrderUrl && (
                        <a href={f.supplierOrderUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--blue)", marginTop: 6, fontWeight: 600, textDecoration: "none" }}>
                          <IconTruck width={13} height={13} /> {t("o.viewSupplierOrder")} ↗
                        </a>
                      )}
                    </div>
                  ))}

                  {/* 4) Lợi nhuận sau chi phí (After fee − tổng chi phí supplier) */}
                  {(() => {
                    const ffCost = (detail.ffOrders ?? []).reduce((s, f) => s + Number(f.cost ?? (Number(f.baseCost ?? 0) + Number(f.shipCost ?? 0))), 0);
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

                  <ManualTracking key={(detail.ffOrders ?? [])[0]?.id ?? "new"} orderId={o.id}
                    ff={(detail.ffOrders ?? [])[0]}
                    fulfillerId={ffSel || (detail.ffOrders ?? [])[0]?.fulfillerId || ""}
                    fulfillers={fulfillers}
                    flash={flash} onSaved={() => { loadDetail(); reload(); }} />
                </div>
              )}
              </div>
            </div>

            {/* CỘT 2+3 — form giao hàng + nhãn/tạo đơn */}
            {canPushFf && detail && (
              <>
                <div>
                  <div className="o2-secTitle">
                    <span className="o2-badge"><IconTruck width={13} height={13} /> {t("o.fulfilment")}</span>
                    <b style={{ fontSize: 13 }}>{t("o.shippingInfo")}</b>
                  </div>
                  <div className="o2-form">
                    {F("buyerFirst", t("o.firstName"))}
                    {F("buyerLast", t("o.lastName"))}
                    {F("addr1", t("o.addr1"))}
                    {F("addr2", t("o.addr2"))}
                    {F("city", t("o.city"))}
                    {F("zip", t("o.zip"))}
                    {F("country", t("o.country"))}
                    {F("state", t("o.state"))}
                  </div>
                </div>
                <div className="o2-right">
                  <div className="o2-field">{F("orderLabel", t("o.orderLabel"))}</div>
                  <div className="o2-field">
                    <label>{t("o.fulfilledBy")}</label>
                    <select value={ffSel} onChange={(e) => pickFulfiller(e.target.value)} style={{ ...inp, width: "100%" }}>
                      <option value="">{t("o.chooseFulfiller")}</option>
                      {detail.fulfillerOptions.map((ff) => (
                        <option key={ff.fulfillerId} value={ff.fulfillerId}>{ff.name}{(detail.catalog[ff.fulfillerId]?.length ?? 0) === 0 ? ` ${t("o.noSkuMapping")}` : ""}</option>
                      ))}
                    </select>
                  </div>
                  {/* Variant từng sản phẩm: Style → Color → Size → Qty */}
                  {ffSel && detail.items.map((it) => (
                    <VariantPicker key={it.id} variants={variants}
                      line={lines[it.id] ?? { mappingId: "", qty: it.qty }}
                      setLine={(v) => setLines({ ...lines, [it.id]: v })}
                      label={detail.items.length > 1 ? it.product_title : undefined} />
                  ))}
                  {complete
                    ? <div style={{ fontSize: 12.5, textAlign: "right" }}>{t("o.estCost")}: <b style={{ color: "var(--green)" }}>{money(estCost!)}</b></div>
                    : ffSel ? <div style={{ fontSize: 11.5, color: "var(--muted)", textAlign: "right" }}>{t("o.needComplete").replace("{n}", String(detail.items.length))}</div> : null}
                  <button onClick={createOrder} disabled={!complete || busy} style={{ ...btnBlue, width: "100%", padding: "11px", fontSize: 14, opacity: !complete || busy ? 0.5 : 1 }}>
                    {busy ? t("o.creating") : t("o.pushFfOrder")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexShrink: 0 }}>
          {canEdit && <button onClick={() => setShowIssue(true)} style={{ ...btnGhost, color: "var(--red)", borderColor: "#F3C6C0", background: "var(--red-soft)", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}><IconWarn width={14} height={14} /> {t("iss.badReview")}</button>}
          {canEdit && <button onClick={() => cloneOrder(o.id)} style={{ ...btnGhost, color: "var(--blue)", borderColor: "var(--blue)", background: "var(--blue-soft)", fontWeight: 700 }}>{t("o.dup")}</button>}
        </div>
      </div>
      {showIssue && <IssueModal order={o} fulfillers={fulfillers}
        close={() => setShowIssue(false)} flash={flash} onSaved={reload} />}

      {/* Items — chỉ hiển thị sản phẩm + gán design (variant đã dời lên cột phải) */}
      {o.items.map((it) => <ItemRow key={it.id} it={it} onSaved={reload} flash={flash} />)}
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

function ItemRow({ it, onSaved, flash }: {
  it: Item; onSaved: () => void; flash: (m: string) => void;
}) {
  const { t } = useLang();
  const [skuInput, setSkuInput] = useState("");
  const [busy, setBusy] = useState(false);
  const assign = async (sku: number | string | null) => {
    setBusy(true);
    const j = await fetch(`/api/order-items/${it.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skuCode: sku }) }).then((r) => r.json());
    setBusy(false);
    if (j.ok) { flash(sku === null ? t("o.unassigned") : `${t("o.assigned")} #${j.design?.sku_code ?? sku}`); onSaved(); }
    else flash("✗ " + (j.error ?? "Error"));
  };
  const toggleSpecial = async () => {
    const j = await fetch(`/api/order-items/${it.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ specialPrint: !it.special_print }) }).then((r) => r.json());
    if (j.ok) onSaved();
  };
  const img = it.mockupUrl ?? it.designThumb;
  const [zoom, setZoom] = useState<string | null>(null);
  return (
    <div className="o2-item">
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
      <div className="o2-thumb" onClick={() => img && setZoom(img)} style={img ? { cursor: "zoom-in" } : undefined} title={img ? "Click để xem to / Click to enlarge" : undefined}>
        {img ? <img src={img} alt="" loading="lazy" /> : <span style={{ fontSize: 11, color: "var(--muted)" }}>{t("o.noImg")}</span>}
      </div>
      <div className="o2-detail" style={{ fontSize: 13 }}>
        <b>{it.product_title}</b>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", color: "var(--muted)", marginTop: 5, fontSize: 12.5 }}>
          <span>{t("o.qtyLabel")}: <b style={{ color: "var(--ink)" }}>{it.qty}</b></span>
          {it.internal_sku && <span>SKU: <b style={{ color: "var(--ink)" }}>{it.internal_sku}</b></span>}
          <span>{t("o.price")}: <b style={{ color: "var(--ink)" }}>{money(it.unit_price)}</b></span>
        </div>
        <Personalization it={it} onSaved={onSaved} flash={flash} />
        <label style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={it.special_print} onChange={toggleSpecial} /> {t("o.specialPrint")}
        </label>
      </div>
      {/* Gán design — nhãn DesignId gắn liền + preview bên dưới (theo mẫu) */}
      <div className="o2-assigncol">
        <div className="ig">
          <span className="ig-l">DesignId</span>
          {it.design_id ? (
            <input value={String(it.design_sku ?? "")} readOnly className="ig-in" />
          ) : (
            <input placeholder="132691" value={skuInput}
              onChange={(e) => setSkuInput(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && skuInput && assign(skuInput)} className="ig-in" />
          )}
          {it.design_id ? (
            <button onClick={() => assign(null)} disabled={busy} className="ig-btn danger" title={t("o.unassign")}><IconTrash width={14} height={14} /></button>
          ) : (
            <button onClick={() => skuInput && assign(skuInput)} disabled={busy || !skuInput} className="ig-btn">{t("o.assign")}</button>
          )}
        </div>

        {/* Preview design đã gán — hiện đủ các mặt */}
        {it.design_id && (it.designSides?.filter((s) => s.thumb).length ?? 0) > 0 ? (
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {it.designSides!.filter((s) => s.thumb).map((s, idx) => (
              <div key={idx} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <div className="o2-dpreview checker" style={{ width: 96, marginTop: 0 }} onClick={() => setZoom(s.original ?? s.thumb)} title={s.label + " — click xem to"}>
                  <img src={s.thumb!} alt={s.label} />
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)" }}>{s.label}</span>
              </div>
            ))}
          </div>
        ) : it.design_id && it.designThumb ? (
          <div className="o2-dpreview checker" onClick={() => setZoom(it.designThumb)} title="Click để xem to">
            <img src={it.designThumb} alt="" />
          </div>
        ) : null}
        {it.design_id && <div className="o2-dcap">#{it.design_sku} — {it.design_title}</div>}

        {/* Gợi ý khi chưa gán */}
        {!it.design_id && it.suggest && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".3px", color: "var(--muted)", marginBottom: 6 }}>{t("o.suggestDesigns")}</div>
            {it.suggest.thumb && (
              <div className="o2-dpreview checker" onClick={() => setZoom(it.suggest!.thumb)} title="Click để xem to">
                <img src={it.suggest.thumb} alt="" />
              </div>
            )}
            <button onClick={() => assign(it.suggest!.skuCode)} disabled={busy} style={{ marginTop: 6, width: "100%", background: "var(--green)", color: "#fff", border: "none", borderRadius: 9, padding: "8px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{t("o.acceptDesign")} #{it.suggest.skuCode}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function CreateOrderModal({ close, reload, flash, sellers, stores }: {
  close: () => void; reload: () => void; flash: (m: string) => void;
  sellers: { id: string; name: string }[]; stores: { id: string; name: string }[];
}) {
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
    if (j.ok) { flash(`✓ Đã tạo đơn #${j.order.externalId}`); reload(); close(); } else flash("✗ " + (j.error ?? "Lỗi"));
  };

  const I = (k: keyof typeof f, ph: string) => (
    <input value={f[k]} placeholder={ph} onChange={(e) => set(k, e.target.value)} style={{ ...inp, width: "100%" }} />
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(42,48,60,.45)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={close}>
      <div style={{ background: "#fff", borderRadius: 16, width: 760, maxWidth: "96vw", maxHeight: "92vh", overflowY: "auto", padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <b style={{ fontSize: 15 }}>Tạo đơn tay</b>
          <button onClick={close} style={{ background: "none", border: "none", fontSize: 17, cursor: "pointer", color: "var(--muted)" }}>✕</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <select value={f.platform} onChange={(e) => set("platform", e.target.value)} style={inp}>
            <option value="etsy">Etsy</option><option value="amazon">Amazon</option><option value="tiktok">TikTok</option>
          </select>
          {I("externalId", "Mã đơn (trống = tự sinh)")}
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
          {I("platformFee", "Fee sàn ($)")}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, margin: "14px 0 8px" }}>Người nhận</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {I("buyerFirst", "Tên")}{I("buyerLast", "Họ")}{I("addr1", "Địa chỉ 1")}
          {I("addr2", "Địa chỉ 2")}{I("city", "Thành phố")}{I("state", "Bang")}
          {I("zip", "ZIP")}{I("country", "Quốc gia")}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, margin: "14px 0 8px" }}>Sản phẩm</div>
        {items.map((it, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 70px 90px 34px", gap: 8, marginBottom: 8 }}>
            <input value={it.productTitle} placeholder="Tên sản phẩm *" onChange={(e) => setIt(i, "productTitle", e.target.value)} style={inp} />
            <input value={it.internalSku} placeholder="SKU nội bộ" onChange={(e) => setIt(i, "internalSku", e.target.value)} style={inp} />
            <input type="number" min={1} value={it.qty} onChange={(e) => setIt(i, "qty", Number(e.target.value))} style={inp} />
            <input value={it.unitPrice} placeholder="Giá" onChange={(e) => setIt(i, "unitPrice", e.target.value)} style={inp} />
            <button onClick={() => setItems(items.filter((_, j) => j !== i))} disabled={items.length === 1}
              style={{ ...btnGhost, padding: "4px 0", opacity: items.length === 1 ? 0.4 : 1 }}>✕</button>
          </div>
        ))}
        <button onClick={() => setItems([...items, { productTitle: "", internalSku: "", qty: 1, unitPrice: "" }])} style={btnGhost}>+ Thêm sản phẩm</button>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button onClick={close} style={btnGhost}>Huỷ</button>
          <button onClick={submit} disabled={busy || !items.some((x) => x.productTitle.trim())}
            style={{ ...btnBlue, opacity: busy || !items.some((x) => x.productTitle.trim()) ? 0.6 : 1 }}>{busy ? "Đang tạo…" : "Tạo đơn"}</button>
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
      {it.personalization
        ? <span style={{ background: "var(--amber-soft)", borderRadius: 8, padding: "4px 10px", display: "inline-block" }}>
            <b>{t("o.personalization")}:</b> {it.personalization}
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
      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{total.toLocaleString()} đơn</span>
    </div>
  );
}

const inp: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 10, padding: "7px 10px", fontSize: 13, background: "#fff" };
const btnBlue: React.CSSProperties = { background: "var(--primary-grad)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" };
const btnGhost: React.CSSProperties = { background: "#fff", color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const btnRed: React.CSSProperties = { background: "var(--red)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" };
const rLbl: React.CSSProperties = { fontSize: 13, fontWeight: 600 };
