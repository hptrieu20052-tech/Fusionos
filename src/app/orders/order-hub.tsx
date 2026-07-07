"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import DateRangePicker, { rangeToDates, RangeValue } from "@/components/date-range";
import { useLang } from "@/components/lang-provider";
import { IconCopy, IconPin, IconChevron, IconTruck, IconTrash } from "@/components/icons";

type Item = {
  id: string; product_title: string; internal_sku: string | null; qty: number; unit_price: string;
  design_id: string | null; design_sku: number | null; design_title: string | null; personalization: string | null;
  special_print: boolean; designThumb: string | null; mockupUrl: string | null;
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
type Variant = { id: string; fulfillerSku: string; internalSku: string; unitCost: number };
type Detail = { storeName?: string | null; order: Order & Record<string, unknown>; items: DetailItem[]; fulfillerOptions: { fulfillerId: string; name: string; mapped: boolean; estCost: number | null }[]; catalog: Record<string, Variant[]> };

const STATUS_COLORS: Record<string, string> = {
  new: "#1D5FAE", created: "#D9935B", in_production: "#4F9E93", shipped: "#8FAF5C",
  completed: "#5E86C9", has_issues: "#C06B82", trash: "#BBA054",
};
const money = (n: number | string) => "$" + Number(n).toFixed(2);

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

  const patchOrder = async (id: string, body: Record<string, unknown>) => {
    const j = await fetch(`/api/orders/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    if (j.ok) { flash("✓ Đã cập nhật"); load(); } else flash("✗ " + (j.error ?? "Lỗi"));
    return j;
  };
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
  const downloadInfo = (o: Order) => {
    const blob = new Blob([JSON.stringify(o, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `order-${o.external_id}.json`; a.click();
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

        {/* Pills trạng thái kiểu otab */}
        <div className="otabs">
          <button className={`otab${!status ? " on" : ""}`} onClick={() => { setStatus(""); setPage(1); }}>All ({all})</button>
          {Object.keys(STATUS_COLORS).filter((st) => st !== "completed").map((st) => (
            <button key={st} className={`otab${status === st ? " on" : ""}`} onClick={() => { setStatus(st); setPage(1); }}>
              {st.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} ({data.counts[st] ?? 0})
            </button>
          ))}
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
          reload={load} flash={flash} patchOrder={patchOrder} cloneOrder={cloneOrder}
          downloadInfo={downloadInfo} copyText={copyText} />
      ))}
      {!data.orders.length && <div className="panel empty" style={{ marginTop: 12 }}>{t("o.noMatch")}</div>}

      <div style={{ marginTop: 12 }}>
        <Pager page={page} pages={pages} setPage={setPage} show={show} setShow={(n) => { setShow(n); setPage(1); }} total={data.total} />
      </div>


      {showCreate && <CreateOrderModal close={() => setShowCreate(false)} reload={load} flash={flash} sellers={data.sellers} stores={data.stores} />}
    </>
  );
}

function OrderCard({ o, canEdit, canPushFf, selected, onToggleSel, reload, flash, patchOrder, cloneOrder, downloadInfo, copyText }: {
  o: Order; canEdit: boolean; canPushFf: boolean; selected: boolean; onToggleSel: () => void;
  reload: () => void; flash: (m: string) => void;
  patchOrder: (id: string, body: Record<string, unknown>) => Promise<{ ok: boolean }>;
  cloneOrder: (id: string) => void; downloadInfo: (o: Order) => void; copyText: (v: string) => void;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [ffSel, setFfSel] = useState("");
  const [lines, setLines] = useState<Record<string, { mappingId: string; qty: number }>>({});
  const [busy, setBusy] = useState(false);
  const [ship, setShip] = useState({
    buyerFirst: o.buyer_first ?? "", buyerLast: o.buyer_last ?? "", addr1: o.addr1 ?? "", addr2: o.addr2 ?? "",
    city: o.city ?? "", state: o.state ?? "", zip: o.zip ?? "", country: o.country ?? "United States",
    orderLabel: o.order_label ?? "",
  });

  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (!detail) {
      const j = await fetch(`/api/orders/${o.id}`).then((r) => r.json());
      if (j.ok) {
        setDetail(j);
        setShip((s) => ({ ...s, orderLabel: s.orderLabel || [`${(j.storeName ?? "SHOP").replace(/[^a-zA-Z0-9]/g, "").toUpperCase()}`, o.external_id].filter(Boolean).join("-") }));
      }
    }
  };

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
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: open ? 14 : 0 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
          {canEdit && <input type="checkbox" checked={selected} onChange={onToggleSel} style={{ width: 17, height: 17, marginTop: 3, cursor: "pointer", accentColor: "var(--blue)", flexShrink: 0 }} />}
          <div className={`o2-top${open && detail ? "" : " solo"}`} style={{ flex: 1, minWidth: 0 }}>
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
              <div className="o2-buyer">{[o.buyer_first, o.buyer_last].filter(Boolean).join(" ") || "—"}</div>
              <div className="o2-addr"><IconPin width={15} height={15} /><span>{[o.addr1, o.addr2, o.city, o.state, o.zip, o.country].filter(Boolean).join(", ")}</span></div>
              <div className="o2-fin">
                <div className="c"><span className="k">{t("o.total")}</span><span className="v">{money(o.total)}</span></div>
                <div className="c"><span className="k">{t("o.fee")}</span><span className="v">{money(o.platform_fee)}</span></div>
                <div className="c net"><span className="k">{t("o.afterFee")}</span><span className="v">{money(Number(o.total) - Number(o.platform_fee))}</span></div>
              </div>
              <OrderNote order={o} canEdit={canEdit} onSaved={reload} flash={flash} />
              {canPushFf && (
                <button onClick={toggle} className={`o2-toggle${open ? " open" : ""}`}>{t("o.fulfilment")} <IconChevron width={15} height={15} /></button>
              )}
            </div>

            {/* CỘT 2+3 — form giao hàng + nhãn/tạo đơn (chỉ khi mở) */}
            {open && detail && (
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
          {canEdit && o.status !== "completed" && <button onClick={() => patchOrder(o.id, { status: "completed" })} style={btnDark}>{t("o.complete")}</button>}
          {canEdit && <OrderMenu order={o} patchOrder={patchOrder} downloadInfo={downloadInfo} />}
        </div>
      </div>

      {/* Hàng nút phụ */}
      {canEdit && (
        <div className="o2-btns">
          <button onClick={() => cloneOrder(o.id)} style={btnGhost}>{t("o.dup")}</button>
          <button onClick={() => downloadInfo(o)} style={{ ...btnGhost, color: "var(--green)", borderColor: "var(--green)" }}>{t("o.downloadInfo")}</button>
        </div>
      )}

      {/* Items — variant/qty bên phải khi đã mở fulfillment + chọn nhà fulfill */}
      {o.items.map((it) => {
        const dit = detail?.items.find((x) => x.id === it.id);
        const l = lines[it.id] ?? { mappingId: "", qty: it.qty };
        return <ItemRow key={it.id} it={it} onSaved={reload} flash={flash}
          showVariant={open && !!ffSel && !!dit} variants={variants}
          line={l} setLine={(v) => setLines({ ...lines, [it.id]: v })} />;
      })}
    </div>
  );
}

function ItemRow({ it, onSaved, flash, showVariant, variants, line, setLine }: {
  it: Item; onSaved: () => void; flash: (m: string) => void;
  showVariant?: boolean; variants?: Variant[]; line?: { mappingId: string; qty: number }; setLine?: (v: { mappingId: string; qty: number }) => void;
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
  const v = variants?.find((x) => x.id === line?.mappingId);
  return (
    <div className="o2-item">
      <div className="o2-thumb">{img ? <img src={img} alt="" loading="lazy" /> : <span style={{ fontSize: 11, color: "var(--muted)" }}>{t("o.noImg")}</span>}</div>
      <div style={{ fontSize: 13, minWidth: 0 }}>
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
        {/* Gán design */}
        <div className="o2-assign">
          {it.design_id ? (
            <>
              {it.designThumb && <div className="o2-dthumb"><img src={it.designThumb} alt="" /></div>}
              <div style={{ fontSize: 12.5 }}>
                <div style={{ fontWeight: 700 }}>#{it.design_sku} — {it.design_title}</div>
                <button onClick={() => assign(null)} disabled={busy} style={{ ...btnGhost, marginTop: 6, fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 5 }}><IconTrash width={12} height={12} /> {t("o.unassign")}</button>
              </div>
            </>
          ) : (
            <div style={{ flex: 1 }}>
              {it.suggest ? (
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {it.suggest.thumb && <div className="o2-dthumb"><img src={it.suggest.thumb} alt="" /></div>}
                  <button onClick={() => assign(it.suggest!.skuCode)} disabled={busy} style={{ background: "var(--green)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{t("o.acceptDesign")} #{it.suggest.skuCode}</button>
                </div>
              ) : null}
              <div style={{ display: "flex", gap: 6, marginTop: it.suggest ? 8 : 0 }}>
                <input placeholder={t("o.designId")} value={skuInput} onChange={(e) => setSkuInput(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => e.key === "Enter" && skuInput && assign(skuInput)} style={{ ...inp, width: 130 }} />
                <button onClick={() => skuInput && assign(skuInput)} disabled={busy || !skuInput} style={btnBlue}>{t("o.assign")}</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Cột variant/qty */}
      <div className="o2-vary">
        {showVariant && line && setLine ? (
          <>
            <div className="o2-field">
              <label>{t("o.fulfilledBy")} — variant</label>
              <select value={line.mappingId} onChange={(e) => setLine({ ...line, mappingId: e.target.value })}
                style={{ ...inp, width: "100%", ...(line.mappingId ? {} : { borderColor: "#F0A9A0", background: "var(--red-soft)" }) }}>
                <option value="">{t("o.selectVariant")}</option>
                {variants!.map((x) => <option key={x.id} value={x.id}>{x.fulfillerSku} — {money(x.unitCost)}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
              <div className="o2-field" style={{ width: 90 }}>
                <label>{t("o.qtyLabel")}</label>
                <input type="number" min={1} value={line.qty} onChange={(e) => setLine({ ...line, qty: Number(e.target.value) })} style={{ ...inp, width: "100%", textAlign: "center" }} />
              </div>
              <div style={{ flex: 1, textAlign: "right", fontSize: 13, paddingBottom: 8 }}>{v ? <b style={{ color: "var(--green)" }}>{money(v.unitCost * (line.qty || 0))}</b> : <span style={{ color: "var(--faint)" }}>—</span>}</div>
            </div>
          </>
        ) : null}
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

function OrderMenu({ order, patchOrder, downloadInfo }: {
  order: Order; patchOrder: (id: string, body: Record<string, unknown>) => Promise<{ ok: boolean }>; downloadInfo: (o: Order) => void;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    if (open) document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const act = (fn: () => void) => { fn(); setOpen(false); };
  const Item = ({ onClick, color, children }: { onClick: () => void; color?: string; children: React.ReactNode }) => (
    <button onClick={() => act(onClick)} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 14px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: color ?? "var(--ink)" }}>{children}</button>
  );
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)} style={{ ...btnGhost, padding: "8px 12px", fontWeight: 700 }} title={t("o.actions")}>⋯</button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 30, background: "#fff", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "0 8px 24px rgba(16,24,40,.14)", minWidth: 180, padding: "4px 0", overflow: "hidden" }}>
          {order.status !== "completed" && <Item onClick={() => patchOrder(order.id, { status: "completed" })} color="var(--green)">✓ {t("o.complete")}</Item>}
          {order.status !== "has_issues" && order.status !== "trash" && <Item onClick={() => patchOrder(order.id, { status: "has_issues" })} color="#C06B82">⚠ {t("o.hasIssues")}</Item>}
          {order.status !== "trash" && <Item onClick={() => { if (confirm(t("o.confirmTrash"))) patchOrder(order.id, { status: "trash" }); }} color="#BBA054">{t("o.trash")}</Item>}
          <div style={{ height: 1, background: "var(--line)", margin: "4px 0" }} />
          <Item onClick={() => downloadInfo(order)}>{t("o.downloadInfo")}</Item>
        </div>
      )}
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
const btnDark: React.CSSProperties = { background: "#0b2545", color: "#fff", border: "none", borderRadius: 10, padding: "9px 18px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" };
const btnGhost: React.CSSProperties = { background: "#fff", color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
