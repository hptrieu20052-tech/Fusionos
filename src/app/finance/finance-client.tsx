"use client";
import { useCallback, useEffect, useState } from "react";
import DateRangePicker, { rangeToDates, RangeValue } from "@/components/date-range";
import { HBarList } from "@/components/charts";
import { useLang } from "@/components/lang-provider";

const typeLabel = (t: (k: string) => string, ty: string) => t(`fin.t.${ty}`) || ty;
type Row = Record<string, string | number | null>;
const inp = { padding: "9px 12px", border: "1px solid var(--line)", borderRadius: 11, font: "inherit", fontSize: 12.5 } as const;
const money = (v: unknown) => "$" + (Math.round(Math.abs(Number(v ?? 0)) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TX_TYPES = ["revenue","base_cost","shipping","platform_fee","ads","sample","salary","tool","refund","other"];

// Logo Excel (bộ nhận diện 2019–2025) — SVG inline, đồng bộ với menu Export bên Orders.
const IcExcel = ({ size = 17 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-label="Excel" style={{ flexShrink: 0 }}>
    <rect x="10" y="3" width="19" height="26" rx="1.6" fill="#fff" />
    <path d="M19.5 3H27.4A1.6 1.6 0 0 1 29 4.6V9.5H19.5V3Z" fill="#33C481" />
    <path d="M10 3h9.5v6.5H10z" fill="#21A366" />
    <path d="M19.5 9.5H29V16H19.5z" fill="#21A366" />
    <path d="M19.5 16H29v6.5H19.5z" fill="#107C41" />
    <path d="M19.5 22.5H29v4.9a1.6 1.6 0 0 1-1.6 1.6H19.5V22.5Z" fill="#185C37" />
    <path d="M10 22.5h9.5v6.5H11.6A1.6 1.6 0 0 1 10 27.4V22.5Z" fill="#107C41" />
    <rect x="2" y="8.5" width="15" height="15" rx="1.6" fill="#107C41" />
    <path d="M6.7 12.3l5.6 7.4M12.3 12.3l-5.6 7.4" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" fill="none" />
  </svg>
);
export function FinanceClient({ canAdd }: { canAdd: boolean }) {
  const { t: tr } = useLang();
  const [days, setDays] = useState(30);
  const [dr, setDr] = useState<RangeValue | null>({ range: "30d" }); // mặc định 30 days — chỉnh bằng picker
  // feeEst / ordersEst: phần phí đang là ƯỚC TÍNH theo % của shop (sàn chưa quyết toán)
  // v632 · totals có thêm ads (Meta tự động + nhập tay) — đã trừ vào profit từ server.
  const [data, setData] = useState<{ totals: { revenue: number; fee: number; cost: number; profit: number; orders: number; feeEst?: number; ordersEst?: number; ads?: number; adsAuto?: number; adsManual?: number; adsUnassigned?: number }; byType: Row[]; daily: Row[]; bySeller: Row[]; byStore: Row[]; byPlatform: Row[]; bySupplier: Row[] } | null>(null);
  const [form, setForm] = useState({ type: "ads", amount: "", note: "" });
  const [msg, setMsg] = useState("");
  const [showExport, setShowExport] = useState(false);

  // v638 · bộ lọc seller / store / platform / supplier — áp ở SERVER cho toàn trang (KPI, chart, bảng)
  const [flt, setFlt] = useState({ seller: "", store: "", platform: "", supplier: "" });
  const [opts, setOpts] = useState<{ sellers: { id: string; name: string }[]; stores: { id: string; name: string; mk: string }[]; suppliers: { id: string; name: string }[]; platforms: string[] } | null>(null);
  const hasFlt = !!(flt.seller || flt.store || flt.platform || flt.supplier);

  const load = useCallback(() => {
    const q = dr ? (() => { const { from, to } = rangeToDates(dr); return `from=${from}&to=${to}`; })() : `days=${days}`;
    const f = [
      flt.seller && `seller=${flt.seller}`, flt.store && `store=${flt.store}`,
      flt.platform && `platform=${flt.platform}`, flt.supplier && `supplier=${flt.supplier}`,
    ].filter(Boolean).join("&");
    fetch(`/api/finance?${q}${f ? "&" + f : ""}`).then((r) => r.json()).then((j) => {
      if (!j.ok) return;
      setData(j);
      // Lần tải KHÔNG filter → gộp (union) danh sách option, để đổi khoảng ngày không làm mất lựa chọn
      if (!f) {
        const stores = (j.byStore as Row[]).map((r) => ({ id: String(r.id), name: String(r.store), mk: String(r.marketplace) }));
        const sellers = (j.bySeller as Row[]).filter((s) => s.id).map((s) => ({ id: String(s.id), name: String(s.name) }));
        const sups = (j.bySupplier as Row[]).filter((s) => s.id).map((s) => ({ id: String(s.id), name: String(s.name) }));
        const plats = (j.byPlatform as Row[]).map((p) => String(p.marketplace));
        setOpts((prev) => {
          const uniq = <T extends { id: string }>(a: T[], b: T[]) => { const m = new Map(a.map((x) => [x.id, x])); for (const x of b) m.set(x.id, x); return Array.from(m.values()); };
          const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
          return {
            sellers: uniq(prev?.sellers ?? [], sellers).sort(byName),
            stores: uniq(prev?.stores ?? [], stores).sort(byName),
            suppliers: uniq(prev?.suppliers ?? [], sups).sort(byName),
            platforms: Array.from(new Set([...(prev?.platforms ?? []), ...plats])).sort(),
          };
        });
      }
    });
  }, [days, dr, flt]);
  useEffect(() => { load(); }, [load]);

  async function addTx(e: React.FormEvent) {
    e.preventDefault();
    const j = await fetch("/api/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }).then((r) => r.json());
    setMsg(j.ok ? tr("fin.recorded") : "⚠ " + j.error);
    if (j.ok) { setForm({ type: "ads", amount: "", note: "" }); load(); }
  }

  if (!data) return <div className="panel empty">{tr("c.loading2")}</div>;

  const { revenue, fee, cost, profit } = data.totals;
  // Có đơn nào đang dùng phí ước tính → mọi cột Fee phải ghi rõ "Fee (est.)" (tiếng Anh, cả 2 ngôn ngữ)
  const feeEst = Number(data.totals.feeEst ?? 0);
  const ordersEst = Number(data.totals.ordersEst ?? 0);
  const isEst = feeEst > 0;
  const FEE_H = isEst ? "Fee (est.)" : "Fee";
  // Mọi cột Cost trong các bảng dưới = CHI PHÍ FULFILL THUẦN (base + ship + ads/…), KHÔNG gồm phí sàn.
  const COST_H = "Fulfillment cost";
  const margin = revenue ? (profit / revenue) * 100 : 0;
  // v632 · chi phí ads (Meta + nhập tay) — server đã trừ vào profit; chart trừ theo từng ngày.
  const ads = Number(data.totals.ads ?? 0);
  const adsAuto = Number(data.totals.adsAuto ?? 0);
  const adsUnassigned = Number(data.totals.adsUnassigned ?? 0);
  const dailyNet = data.daily.map((d) => Number(d.rev) + Number(d.cost) - Number(d.ads ?? 0));
  const maxAbs = Math.max(...dailyNet.map(Math.abs), 1);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginBottom: 12 }}>
        {/* Export CHI TIẾT TỪNG ĐƠN — bấm mở hộp CHỌN KHOẢNG NGÀY trước rồi mới tải */}
        <button onClick={() => setShowExport(true)}
          style={{ display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid var(--line)", background: "#fff", borderRadius: 11, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, color: "var(--ink)", cursor: "pointer" }}>
          <IcExcel /> Export CSV
        </button>
        <DateRangePicker value={dr ?? { range: "30d" }} onChange={(v) => setDr(v)} align="right" allowClear onClear={() => setDr({ range: "30d" })} />
      </div>
      {showExport && <ExportCsvModal defFrom={rangeToDates(dr ?? { range: "30d" }).from} defTo={rangeToDates(dr ?? { range: "30d" }).to} close={() => setShowExport(false)} />}

      {/* v638 · Bộ lọc seller / store / platform / supplier — áp cho TOÀN TRANG (KPI, chart, các bảng) */}
      <div className="panel" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 14px", marginBottom: 12 }}>
        <b style={{ fontSize: 12.5, marginRight: 2 }}>Filters</b>
        <select value={flt.seller} onChange={(e) => setFlt({ ...flt, seller: e.target.value })} style={inp}>
          <option value="">All sellers</option>
          {(opts?.sellers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={flt.store} onChange={(e) => setFlt({ ...flt, store: e.target.value })} style={inp}>
          <option value="">All stores</option>
          {(opts?.stores ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.mk})</option>)}
        </select>
        <select value={flt.platform} onChange={(e) => setFlt({ ...flt, platform: e.target.value })} style={inp}>
          <option value="">All platforms</option>
          {(opts?.platforms ?? ["etsy", "tiktok", "shopify", "woocommerce", "shopbase"]).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={flt.supplier} onChange={(e) => setFlt({ ...flt, supplier: e.target.value })} style={inp}>
          <option value="">All suppliers</option>
          {(opts?.suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {hasFlt && (
          <button onClick={() => setFlt({ seller: "", store: "", platform: "", supplier: "" })}
            style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 9, padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "var(--red)" }}>
            ✕ Clear
          </button>
        )}
        {(flt.store || flt.platform || flt.supplier) && (
          <span style={{ fontSize: 11, color: "var(--muted)" }}>Ads spend is excluded when filtering by store / platform / supplier</span>
        )}
      </div>

      {/* v632 · thêm thẻ ADS SPEND (Meta tự động + nhập tay) — 6 thẻ, đã trừ vào Profit */}
      <div className="kpis kpis-5" style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 12 }}>
        <div className="kpi"><div className="l">{tr("fin.revenue")}</div><div className="v" style={{ color: "var(--green)" }}>{money(revenue)}</div></div>
        <div className="kpi"><div className="l">{isEst ? "Platform fee (est.)" : "Platform fee"}</div><div className="v" style={{ color: "var(--red)" }}>{money(fee)}</div>
          {isEst && <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2, lineHeight: 1.3 }}>incl. Fee (est.) {money(feeEst)} · {ordersEst} orders</div>}
        </div>
        {/* Chi phí Fulfill = base + ship qua supplier. KHÔNG cộng phí sàn (phí sàn đã có card riêng bên trái). */}
        <div className="kpi"><div className="l">{tr("db.fulfillCost")}</div><div className="v" style={{ color: "#C9760F" }}>{money(Math.abs(cost))}</div>
          <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2, lineHeight: 1.3 }}>{tr("db.fulfillCostSub")}</div>
        </div>
        <div className="kpi"><div className="l">Ads spend</div><div className="v" style={{ color: "#1D4ED8" }}>{money(ads)}</div>
          <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2, lineHeight: 1.3 }}>
            Meta {money(adsAuto)}{Number(data.totals.adsManual ?? 0) > 0 ? ` + manual ${money(data.totals.adsManual)}` : ""}{adsUnassigned > 0 ? ` · unassigned ${money(adsUnassigned)}` : ""}
          </div>
        </div>
        <div className="kpi"><div className="l">{tr("fin.profit")}</div><div className="v" style={{ color: profit >= 0 ? "var(--green)" : "var(--red)" }}>{profit >= 0 ? "" : "-"}{money(profit)}</div></div>
        <div className="kpi"><div className="l">{tr("fin.margin")}</div><div className="v">{margin.toFixed(1)}%</div></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 14 }}>
        <div className="panel">
          <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>Net profit/loss per day</h3>
          <div className="sub" style={{ marginBottom: 8 }}>Green = profit · red = loss</div>
          <svg viewBox="0 0 640 200" width="100%" height={200}>
            <line x1={0} x2={640} y1={100} y2={100} stroke="#E5E9F2" />
            {dailyNet.map((v, i) => {
              const n = dailyNet.length, bw = Math.min(30, (640 / n) * 0.7), gap = (640 - n * bw) / (n + 1);
              const h = (Math.abs(v) / maxAbs) * 80;
              return <rect key={i} x={gap + i * (bw + gap)} y={v >= 0 ? 100 - h : 100} width={bw} height={Math.max(h, 1)} rx={4}
                fill={v >= 0 ? "#4C9F70" : "#CE6B6B"} opacity={0.85} />;
            })}
          </svg>
        </div>
        <div className="panel">
          <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>{tr("fin.costBreakdown")}</h3>
          <HBarList rows={[
            ...(fee > 0 ? [{ label: isEst ? "Platform fee (est.)" : "Platform fee", value: fee, color: "#C98A3D", suffix: money(fee) }] : []),
            // v632 · chi phí ads Meta (tự động từ meta_insights) — dòng riêng, màu xanh dương
            ...(adsAuto > 0 ? [{ label: "Meta ads", value: adsAuto, color: "#3A5BC7", suffix: money(adsAuto) }] : []),
            // Bỏ 'platform_fee' ở đây vì đã gộp vào dòng Platform fee phía trên → không hiện 2 lần
            ...data.byType.filter((t) => Number(t.total) < 0 && String(t.type) !== "platform_fee").map((t) => ({
              label: typeLabel(tr, String(t.type)), value: Math.abs(Number(t.total)),
              color: String(t.type) === "ads" ? "#3A5BC7" : "#CE6B6B", suffix: money(t.total),
            })),
          ]} />
        </div>
      </div>

      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>Profit by store</h3>
        <table style={{ marginTop: 8 }}>
          <thead><tr><th>Store</th><th>Seller</th><th style={{ textAlign: "right" }}>Orders</th><th style={{ textAlign: "right" }}>Revenue</th><th style={{ textAlign: "right" }}>{FEE_H}</th><th style={{ textAlign: "right" }}>{COST_H}</th><th style={{ textAlign: "right" }}>Profit</th></tr></thead>
          <tbody>{data.byStore.map((st) => {
            const pf = Number(st.rev) - Number(st.fee) + Number(st.cost);
            return (
              // v637 · key PHẢI gồm cả seller: store chung nhiều seller (Talewix/Sorawix) trả nhiều dòng
              // cùng st.id → key trùng làm React giữ lại dòng cũ khi đổi khoảng ngày (số "đứng im").
              <tr key={`${st.id}·${st.seller ?? ""}`}>
                <td><span className="chip" style={{ marginRight: 6 }}>{String(st.marketplace)}</span><b>{String(st.store)}</b></td>
                <td>{String(st.seller ?? "—")}</td>
                <td style={{ textAlign: "right" }}>{String(st.orders)}</td>
                <td style={{ textAlign: "right" }}>{money(st.rev)}</td>
                <td style={{ textAlign: "right", color: "var(--muted)" }}>{money(st.fee)}</td>
                <td style={{ textAlign: "right", color: "var(--red)" }}>{money(st.cost)}</td>
                <td style={{ textAlign: "right", fontWeight: 800, color: pf >= 0 ? "var(--green)" : "var(--red)" }}>{pf < 0 ? "-" : ""}{money(pf)}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div className="panel">
          <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>Profit by seller</h3>
          {/* v632 · thêm cột Ads (Meta theo chủ ad + bút toán tay theo seller) — trừ thẳng vào Profit
              của từng seller: đây là bảng kế toán tháng cho seller. */}
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Seller</th><th style={{ textAlign: "right" }}>Revenue</th><th style={{ textAlign: "right" }}>{FEE_H}</th><th style={{ textAlign: "right" }}>{COST_H}</th><th style={{ textAlign: "right" }}>Ads</th><th style={{ textAlign: "right" }}>Profit</th></tr></thead>
            <tbody>{data.bySeller.map((s) => {
              const adsS = Number(s.ads ?? 0);
              const pf = Number(s.rev) - Number(s.fee) + Number(s.cost) - adsS;
              return (
                <tr key={String(s.id ?? s.name)}><td><b>{String(s.name)}</b></td>
                  <td style={{ textAlign: "right" }}>{money(s.rev)}</td>
                  <td style={{ textAlign: "right", color: "var(--muted)" }}>{money(s.fee)}</td>
                  <td style={{ textAlign: "right", color: "var(--red)" }}>{money(s.cost)}</td>
                  <td style={{ textAlign: "right", color: adsS > 0 ? "#1D4ED8" : "var(--muted)" }}>{adsS > 0 ? money(adsS) : "—"}</td>
                  <td style={{ textAlign: "right", fontWeight: 800, color: pf >= 0 ? "var(--green)" : "var(--red)" }}>{pf < 0 ? "-" : ""}{money(pf)}</td></tr>
              );
            })}</tbody>
          </table>
          {adsUnassigned > 0 && (
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8, lineHeight: 1.5 }}>
              ⚠ Ads spend chưa gán seller: <b>{money(adsUnassigned)}</b> — vào Meta Ads Center, bấm chip <b>👤 assign</b> trên từng ad (hoặc cả ad set / campaign) để gán chủ; gán xong số này tự chảy vào đúng seller.
            </div>
          )}
        </div>
        <div className="panel">
          <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>Profit by platform</h3>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Marketplace</th><th style={{ textAlign: "right" }}>Revenue</th><th style={{ textAlign: "right" }}>Profit</th></tr></thead>
            <tbody>{data.byPlatform.map((p) => {
              const pf = Number(p.rev) - Number(p.fee) + Number(p.cost);
              return (
                <tr key={String(p.marketplace)}><td><span className="chip">{String(p.marketplace)}</span></td>
                  <td style={{ textAlign: "right" }}>{money(p.rev)}</td>
                  <td style={{ textAlign: "right", fontWeight: 800, color: pf >= 0 ? "var(--green)" : "var(--red)" }}>{pf < 0 ? "-" : ""}{money(pf)}</td></tr>
              );
            })}</tbody>
          </table>
          {canAdd && (
            <form onSubmit={addTx} style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 12, alignItems: "center" }}>
              <b style={{ fontSize: 12.5 }}>{tr("fin.addExpense")}</b>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} style={inp}>
                {TX_TYPES.map((k) => <option key={k} value={k}>{typeLabel(tr, k)}</option>)}
              </select>
              <input required type="number" step="0.01" placeholder={tr("fin.amount")} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={{ ...inp, width: 110 }} />
              <input placeholder={tr("fin.note")} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={{ ...inp, flex: 1, minWidth: 120 }} />
              <button style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 10, padding: "9px 16px", fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}>{tr("c.save")}</button>
              {msg && <span style={{ fontSize: 12, fontWeight: 700 }}>{msg}</span>}
            </form>
          )}

          {/* PROFIT BY SUPPLIER — mỗi nhà in đã fulfill bao nhiêu tiền trong kỳ.
              1 đơn đẩy sang 2 nhà khác nhau sẽ được tính doanh thu ở CẢ HAI hàng (đúng bản chất),
              nên tổng Revenue của bảng này có thể > Revenue tổng. Cột Cost thì luôn chính xác. */}
          <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <h3 style={{ fontWeight: 800, fontSize: 14.5, margin: 0 }}>{tr("fin.bySupplier")}</h3>
            {!(data.bySupplier ?? []).length ? (
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>{tr("fin.noSupplier")}</div>
            ) : (
              <table style={{ marginTop: 8 }}>
                <thead><tr>
                  <th>{tr("fin.supplier")}</th>
                  <th style={{ textAlign: "right" }}>{tr("fin.ordersCol")}</th>
                  <th style={{ textAlign: "right" }}>Revenue</th>
                  <th style={{ textAlign: "right" }}>{COST_H}</th>
                  <th style={{ textAlign: "right" }}>Profit</th>
                </tr></thead>
                <tbody>{(data.bySupplier ?? []).map((f) => {
                  const c = Number(f.cost ?? 0);            // cost lưu DƯƠNG ở fulfillment_orders
                  const pf = Number(f.rev ?? 0) - Number(f.fee ?? 0) - c;
                  return (
                    <tr key={String(f.name)}>
                      <td><b>{String(f.name)}</b></td>
                      <td style={{ textAlign: "right", color: "var(--muted)" }}>{Number(f.orders ?? 0).toLocaleString()}</td>
                      <td style={{ textAlign: "right" }}>{money(f.rev)}</td>
                      <td style={{ textAlign: "right", color: "var(--red)" }}>{money(c)}</td>
                      <td style={{ textAlign: "right", fontWeight: 800, color: pf >= 0 ? "var(--green)" : "var(--red)" }}>{pf < 0 ? "-" : ""}{money(pf)}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// Hộp CHỌN KHOẢNG NGÀY trước khi export — mặc định theo range đang xem trên picker.
// File tải về là CHI TIẾT TỪNG ĐƠN (16 cột, gồm cả đơn New/Cancel) từ /api/finance/export.
function ExportCsvModal({ defFrom, defTo, close }: { defFrom: string; defTo: string; close: () => void }) {
  // Dùng CHUNG bộ lịch DateRangePicker của hệ thống (preset Today/7d/30d/This month… + lịch 2 tháng)
  // thay cho ô date mặc định của trình duyệt — hiện đại & đồng bộ giao diện.
  const [v, setV] = useState<RangeValue>({ range: "custom", from: defFrom, to: defTo });
  const { from, to } = rangeToDates(v);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  const pretty = (s: string) => { const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; };
  return (
    <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 22, width: 430, maxWidth: "92vw", boxShadow: "0 18px 50px rgba(15,23,42,.25)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
          <IcExcel size={20} /> Export orders detail (CSV)
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>
          One row per order — includes ALL orders (New &amp; Cancel too). Revenue · fees · base/ship/other cost · profit.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>Time range</span>
          <DateRangePicker value={v} onChange={setV} />
          <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>{valid ? `${pretty(from)} → ${pretty(to)}` : "—"}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={close}
            style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 11, padding: "9px 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: "var(--ink)" }}>
            Cancel
          </button>
          <a href={valid ? `/api/finance/export?from=${from}&to=${to}` : undefined} onClick={() => { if (valid) close(); }} aria-disabled={!valid}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, background: valid ? "var(--ink)" : "#B9C0CE", color: "#fff", borderRadius: 11, padding: "9px 18px", fontSize: 12.5, fontWeight: 700, textDecoration: "none", cursor: valid ? "pointer" : "not-allowed", pointerEvents: valid ? "auto" : "none" }}>
            Download CSV
          </a>
        </div>
      </div>
    </div>
  );
}
