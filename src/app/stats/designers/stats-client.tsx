"use client";
import { useCallback, useEffect, useState } from "react";
import DateRangePicker, { rangeToDates, RangeValue } from "@/components/date-range";
import { BarChart, Heat, HBarList } from "@/components/charts";

type Designer = { id: string; name: string; values: number[]; total: number; points: number; avgScore: number; reviews: number; bizOrders: number; kpi: number };

// ═══ v175 · DESIGN SALES — design nào ra bao nhiêu sale (cho Designer + Creator Content) ═══
type SaleRow = {
  id: string; sku: string; title: string; platform: string | null; salesPlatforms: string[]; store: string | null;
  seller: string | null; designer: string | null; creator: string | null;
  orders: number; qty: number; revenue: number | null; lastOrder: string | null; createdAt: string;
  productLink: string | null; thumb: string | null; preview: string | null;
};
type PersonOpt = { id: string; name: string };
const PLATFORMS = ["tiktok", "etsy", "shopify", "amazon", "other"];
const PLAT_COLOR: Record<string, string> = { tiktok: "#111", etsy: "#F1641E", shopify: "#5E8E3E", amazon: "#FF9900", other: "#64748B" };

export function DesignSales() {
  const [dr, setDr] = useState<RangeValue>({ range: "30d" });
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState("");
  const [sellerId, setSellerId] = useState("");
  const [designerId, setDesignerId] = useState("");
  const [creatorId, setCreatorId] = useState("");
  const [salesF, setSalesF] = useState("has");
  const [sortF, setSortF] = useState("orders");
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [sellers, setSellers] = useState<PersonOpt[]>([]);
  const [designers, setDesigners] = useState<PersonOpt[]>([]);
  const [creators, setCreators] = useState<PersonOpt[]>([]);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  // v176b · Tiền chỉ hiện cho admin — API quyết định (showMoney), UI chỉ nghe theo.
  const [showMoney, setShowMoney] = useState(false);
  // v176c · Lightbox: click thumbnail → xem ảnh to; click nền / Esc để đóng.
  const [lightbox, setLightbox] = useState<{ src: string; title: string } | null>(null);
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLightbox(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);
  const LIMIT = 50;

  const load = useCallback((off: number, append: boolean) => {
    setLoading(true);
    const { from, to } = rangeToDates(dr);
    const p = new URLSearchParams({ from, to, sales: salesF, sort: sortF, limit: String(LIMIT), offset: String(off) });
    if (q.trim()) p.set("q", q.trim());
    if (platform) p.set("platform", platform);
    if (sellerId) p.set("sellerId", sellerId);
    if (designerId) p.set("designerId", designerId);
    if (creatorId) p.set("creatorId", creatorId);
    fetch(`/api/stats/design-sales?${p}`).then((r) => r.json()).then((j) => {
      if (!j.ok) return;
      setRows((prev) => (append ? [...prev, ...j.rows] : j.rows));
      setTotal(j.total); setShowMoney(!!j.showMoney);
      setSellers(j.filters?.sellers ?? []); setDesigners(j.filters?.designers ?? []); setCreators(j.filters?.creators ?? []);
    }).finally(() => setLoading(false));
  }, [dr, q, platform, sellerId, designerId, creatorId, salesF, sortF]);

  // Đổi filter → nạp lại từ đầu (debounce nhẹ cho ô search)
  useEffect(() => { const t = setTimeout(() => { setOffset(0); load(0, false); }, q ? 350 : 0); return () => clearTimeout(t); }, [load, q]);

  const money = (v: number) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (s: string | null) => (s ? String(s).slice(0, 10) : "—");
  const sel: React.CSSProperties = { padding: "7px 9px", fontSize: 12.5, borderRadius: 9, border: "1px solid var(--line)", background: "#fff", maxWidth: 150 };
  const totalOrders = rows.reduce((t, r) => t + r.orders, 0);
  const totalRevenue = rows.reduce((t, r) => t + (r.revenue ?? 0), 0);

  return (
    <div className="panel">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ fontWeight: 800, fontSize: 14.5, margin: 0 }}>Design sales</h3>
          <div className="sub">Which design generates how many orders — excludes new/cancelled/trash</div>
        </div>
        <div style={{ flex: 1 }} />
        <DateRangePicker value={dr} onChange={setDr} align="right" />
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title / SKU" style={{ ...sel, flex: "1 1 190px", maxWidth: "none", minWidth: 140 }} />
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={sel}>
          <option value="">All marketplaces</option>{PLATFORMS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select value={sellerId} onChange={(e) => setSellerId(e.target.value)} style={sel}>
          <option value="">All sellers</option>{sellers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select value={designerId} onChange={(e) => setDesignerId(e.target.value)} style={sel}>
          <option value="">All designers</option>{designers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select value={creatorId} onChange={(e) => setCreatorId(e.target.value)} style={sel}>
          <option value="">All creators</option>{creators.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select value={salesF} onChange={(e) => setSalesF(e.target.value)} style={sel}>
          <option value="has">Has sales</option>
          <option value="none">No sales yet</option>
          <option value="all">All designs</option>
        </select>
        <select value={sortF} onChange={(e) => setSortF(e.target.value)} style={sel}>
          <option value="orders">Sort: most orders</option>
          <option value="qty">Sort: most quantity</option>
          {showMoney && <option value="revenue">Sort: most revenue</option>}
          <option value="newest">Sort: newest design</option>
        </select>
      </div>

      <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--muted)" }}>
        <b style={{ color: "var(--ink)" }}>{total}</b> design(s) · shown {rows.length}: <b style={{ color: "var(--ink)" }}>{totalOrders}</b> orders{showMoney && <> · <b style={{ color: "var(--ink)" }}>{money(totalRevenue)}</b></>}
      </div>

      <div style={{ overflowX: "auto", marginTop: 8 }}>
        <table>
          <thead><tr>
            <th style={{ width: 56 }}></th><th>SKU</th><th>Title</th><th>Marketplace</th><th>Seller</th><th>Designer</th><th>Creator</th>
            <th style={{ textAlign: "right" }}>Orders</th><th style={{ textAlign: "right" }}>Qty</th>{showMoney && <th style={{ textAlign: "right" }}>Revenue</th>}<th>Last order</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.thumb
                  ? <img src={r.thumb} alt="" title="Click to enlarge"
                      onClick={() => setLightbox({ src: r.preview ?? r.thumb!, title: `${r.sku} · ${r.title}` })}
                      style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)", cursor: "zoom-in" }} />
                  : <div style={{ width: 44, height: 44, borderRadius: 8, border: "1px dashed var(--line)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "var(--muted)" }}>no img</div>}
                </td>
                <td style={{ whiteSpace: "nowrap", fontWeight: 700 }}>{r.sku}</td>
                <td style={{ maxWidth: 340 }}>
                  {r.productLink
                    ? <a href={r.productLink} target="_blank" rel="noreferrer" style={{ color: "var(--blue)", textDecoration: "none" }}>{r.title}</a>
                    : r.title}
                  {r.store && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.store}</div>}
                </td>
                <td>
                  {/* v176d · Sàn RA SALE (từ đơn hàng); chưa có sale thì rơi về platform gắn trên design */}
                  {(r.salesPlatforms?.length ? r.salesPlatforms : r.platform ? [r.platform] : []).map((p) => (
                    <span key={p} style={{ fontSize: 10.5, fontWeight: 800, color: "#fff", background: PLAT_COLOR[p] ?? "#64748B", borderRadius: 6, padding: "2px 8px", textTransform: "uppercase", marginRight: 4, display: "inline-block", marginBottom: 2 }}>{p}</span>
                  ))}
                  {!r.salesPlatforms?.length && !r.platform && "—"}
                </td>
                <td>{r.seller ?? "—"}</td>
                <td>{r.designer ?? "—"}</td>
                <td>{r.creator ?? "—"}</td>
                <td style={{ textAlign: "right", fontWeight: 800 }}>{r.orders}</td>
                <td style={{ textAlign: "right" }}>{r.qty}</td>
                {showMoney && <td style={{ textAlign: "right", fontWeight: 700 }}>{r.revenue ? money(r.revenue) : "—"}</td>}
                <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.lastOrder)}</td>
              </tr>
            ))}
            {!rows.length && !loading && <tr><td colSpan={showMoney ? 11 : 10} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>No designs match these filters.</td></tr>}
          </tbody>
        </table>
      </div>

      {rows.length < total && (
        <div style={{ textAlign: "center", marginTop: 10 }}>
          <button disabled={loading} onClick={() => { const off = offset + LIMIT; setOffset(off); load(off, true); }}
            style={{ padding: "8px 18px", borderRadius: 10, border: "1px solid var(--line)", background: "#fff", cursor: "pointer", fontSize: 13, opacity: loading ? .6 : 1 }}>
            {loading ? "Loading…" : `Load more (${total - rows.length} left)`}
          </button>
        </div>
      )}

      {/* v176c · Lightbox xem ảnh to — click nền hoặc Esc để đóng */}
      {lightbox && (
        <div onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,.75)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "zoom-out", padding: 24 }}>
          <img src={lightbox.src} alt="" style={{ maxWidth: "min(92vw, 900px)", maxHeight: "82vh", borderRadius: 12, background: "#fff", objectFit: "contain", boxShadow: "0 20px 60px rgba(0,0,0,.4)" }} />
          <div style={{ marginTop: 12, color: "#fff", fontSize: 13, maxWidth: "min(92vw, 900px)", textAlign: "center", textShadow: "0 1px 4px rgba(0,0,0,.6)" }}>{lightbox.title}</div>
        </div>
      )}
    </div>
  );
}

export function DesignerStats() {
  const [days, setDays] = useState(7);
  const [dr, setDr] = useState<RangeValue | null>({ range: "30d" }); // mặc định 30 days — chỉnh bằng picker
  const [dayList, setDayList] = useState<string[]>([]);
  const [designers, setDesigners] = useState<Designer[]>([]);

  const load = useCallback(() => {
    fetch(`/api/stats/designers?${dr ? (() => { const { from, to } = rangeToDates(dr); return `from=${from}&to=${to}`; })() : `days=${days}`}`).then((r) => r.json()).then((j) => {
      if (j.ok) { setDayList(j.days); setDesigners(j.designers); }
    });
  }, [days, dr]);
  useEffect(() => { load(); }, [load]);

  const totals = dayList.map((_, i) => designers.reduce((t, d) => t + d.values[i], 0));
  const grand = totals.reduce((a, b) => a + b, 0);
  const today = totals[totals.length - 1] ?? 0, yest = totals[totals.length - 2] ?? 0;
  const avgScore = designers.length ? (designers.reduce((t, d) => t + (d.avgScore || 0), 0) / designers.filter((d) => d.avgScore).length || 0) : 0;
  const topBiz = [...designers].sort((a, b) => b.bizOrders - a.bizOrders)[0];
  const maxCell = Math.max(...designers.flatMap((d) => d.values), 1);
  const fmtD = (d: string) => d.slice(8, 10) + "/" + d.slice(5, 7);
  const scoreColor = (s: number) => (s >= 8.5 ? "var(--green)" : s >= 7.5 ? "var(--blue)" : "var(--amber)");

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <DateRangePicker value={dr ?? { range: "30d" }} onChange={(v) => setDr(v)} align="right" allowClear onClear={() => setDr({ range: "30d" })} />
      </div>

      <div className="kpis">
        <div className="kpi"><div className="l">Designs today</div><div className="v">{today}</div>
          <div className="d" style={{ color: today >= yest ? "var(--green)" : "var(--red)" }}>{today >= yest ? "▲ +" : "▼ "}{today - yest} vs yesterday</div></div>
        <div className="kpi"><div className="l">Total {dayList.length} days</div><div className="v">{grand}</div><div className="d">Avg {(grand / (dayList.length || 1)).toFixed(1)}/day · {designers.length} designers</div></div>
        <div className="kpi"><div className="l">Avg quality score</div><div className="v">{avgScore ? avgScore.toFixed(1) : "—"}<span style={{ fontSize: 13, color: "var(--muted)" }}>/10</span></div></div>
        <div className="kpi"><div className="l">Top order-generating design</div><div className="v" style={{ fontSize: 17 }}>{topBiz?.name ?? "—"}</div><div className="d" style={{ color: "var(--green)" }}>{topBiz?.bizOrders ?? 0} orders / 30 days</div></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 14 }}>
        <div className="panel">
          <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>Designs completed per day</h3>
          <div className="sub" style={{ marginBottom: 8 }}>Whole team</div>
          <BarChart labels={dayList.map(fmtD)} values={totals} />
        </div>
        <div className="panel">
          <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>Overall KPI ranking</h3>
          <div className="sub" style={{ marginBottom: 8 }}>40% output (points) + 30% quality + 30% impact</div>
          <HBarList rows={designers.map((d, i) => ({ label: (i === 0 ? "" : "") + d.name, value: d.kpi, suffix: d.kpi.toFixed(1) }))} />
        </div>
      </div>

      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>Detail: Designer × Day</h3>
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table>
            <thead><tr><th>Designer</th>{dayList.map((d) => <th key={d} style={{ textAlign: "center" }}>{fmtD(d)}</th>)}<th style={{ textAlign: "right" }}>Total</th><th style={{ textAlign: "right" }}>Points</th></tr></thead>
            <tbody>
              {designers.map((d) => (
                <tr key={d.id}>
                  <td><b>{d.name}</b></td>
                  {d.values.map((v, i) => <td key={i} style={{ textAlign: "center" }}><Heat v={v} max={maxCell} /></td>)}
                  <td style={{ textAlign: "right", fontWeight: 800 }}>{d.total}</td>
                  <td style={{ textAlign: "right", fontWeight: 800 }}>×{d.points}</td>
                </tr>
              ))}
              <tr style={{ background: "var(--blue-soft)" }}>
                <td style={{ fontWeight: 800 }}>Whole team</td>
                {totals.map((v, i) => <td key={i} style={{ textAlign: "center", fontWeight: 800 }}>{v}</td>)}
                <td style={{ textAlign: "right", fontWeight: 800 }}>{grand}</td><td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>Quality & impact per designer</h3>
        <table style={{ marginTop: 8 }}>
          <thead><tr><th>Designer</th><th style={{ textAlign: "center" }}>Avg review score</th><th style={{ textAlign: "center" }}>Reviews</th><th style={{ textAlign: "right" }}>Orders from designs (30d)</th><th style={{ textAlign: "right" }}>KPI</th></tr></thead>
          <tbody>
            {designers.map((d) => (
              <tr key={d.id}>
                <td><b>{d.name}</b></td>
                <td style={{ textAlign: "center" }}>
                  {d.avgScore ? <span style={{ fontWeight: 800, padding: "3px 10px", borderRadius: 8, background: "var(--blue-soft)", color: scoreColor(d.avgScore) }}>{d.avgScore.toFixed(1)}</span> : "—"}
                </td>
                <td style={{ textAlign: "center" }}>{d.reviews}</td>
                <td style={{ textAlign: "right", fontWeight: 800 }}>{d.bizOrders}</td>
                <td style={{ textAlign: "right", fontWeight: 800, color: "var(--blue)" }}>{d.kpi.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* v175 · Bảng design × sale — admin thấy trong dashboard đầy đủ */}
      <DesignSales />
    </>
  );
}
