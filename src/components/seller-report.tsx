"use client";
import { useLang } from "@/components/lang-provider";
import { useEffect, useState } from "react";

type Seller = { id: string | null; name: string; orders: number; items: number; daily: { o: number; i: number }[] };
type Data = { buckets: string[]; sellers: Seller[]; totals: { orders: number; items: number } };

// Bảng màu cố định theo thứ tự xếp hạng — đủ 24 seller, lặp lại nếu nhiều hơn
const PALETTE = [
  "#1D5FAE", "#E0A45E", "#D583AB", "#5FAE87", "#9D89D4", "#CE7B7B", "#5FA8BC", "#9FB56B",
  "#DB9468", "#3D9BE0", "#5FAFA3", "#C388D6", "#CBB05E", "#5E8FC7", "#7BB88A", "#D07F93",
  "#6BA3CE", "#AB8BD0", "#8CA860", "#DBA070", "#C1687D", "#8E7BCB", "#5A9E87", "#C983AC",
];

type RangeProps = { range: string; from?: string; to?: string };
export default function SellerReport({ range, from, to }: RangeProps) {
  const { t: tr } = useLang();
  const [metric, setMetric] = useState<"o" | "i">("o");
  const [data, setData] = useState<Data | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; bi: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    setLoading(true); setErr(false);
    fetch(`/api/stats/seller-report?range=${range}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`).then((r) => r.json())
      .then((j) => { if (j.ok) setData(j); else setErr(true); })
      .catch(() => setErr(true)).finally(() => setLoading(false));
  }, [range, from, to]);

  if (err) return null; // không có quyền / lỗi → không hiển thị thay vì kẹt loading
  if (!data) return <div className="card" style={{ padding: 24, color: "var(--muted)" }}>{tr("rep.loadingSeller")}</div>;

  const { buckets, sellers, totals } = data;
  const colTotal = buckets.map((_, bi) => sellers.reduce((a, s) => a + s.daily[bi][metric], 0));
  const max = Math.max(...colTotal, 1);
  const H = 240;

  return (
    <div className="card" style={{ padding: "20px 22px", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <a href="/stats/orders" style={{ fontWeight: 700, fontSize: 15, color: "var(--ink)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>Seller Report <span style={{ color: "var(--sky)", fontSize: 12.5 }}>{tr("rep.viewDetails")}</span></a>
        <div style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
          {([["o", tr("rep.ordersTab")], ["i", "Items"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setMetric(k)} style={{
              padding: "6px 12px", fontSize: 12.5, border: "none", cursor: "pointer",
              background: metric === k ? "var(--blue-soft)" : "#fff", color: metric === k ? "var(--blue)" : "var(--muted)", fontWeight: 600,
            }}>{label}</button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", fontWeight: 700, fontSize: 14 }}>
          {tr("rep.totalColon")} {totals.orders.toLocaleString()} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({totals.items.toLocaleString()} items)</span>
        </div>
      </div>

      {/* Legend: TÊN đơn (items) */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginBottom: 14 }}>
        {sellers.map((s, si) => (
          <span key={si} style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: PALETTE[si % PALETTE.length], display: "inline-block" }} />
            <b>{s.name}</b> {s.orders.toLocaleString()} <span style={{ color: "var(--muted)" }}>({s.items.toLocaleString()})</span>
          </span>
        ))}
      </div>

      {loading && <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,.5)", borderRadius: 18, zIndex: 5 }} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, alignItems: "start" }}>
        {/* Stacked bars */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: buckets.length > 20 ? 3 : 8, height: H + 40, overflowX: "auto", paddingBottom: 4 }}>
        {buckets.map((b, bi) => {
          const t = colTotal[bi];
          return (
            <div key={bi} style={{ flex: "1 0 auto", minWidth: buckets.length > 20 ? 22 : 34, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}
              onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, bi })} onMouseLeave={() => setTip(null)}>
              <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 3 }}>{t || ""}</div>
              <div style={{ width: "100%", maxWidth: 40, height: Math.max((t / max) * H, t ? 3 : 0), display: "flex", flexDirection: "column-reverse", borderRadius: 6, overflow: "hidden" }}>
                {sellers.map((s, si) => {
                  const v = s.daily[bi][metric];
                  return v ? <div key={si} style={{ height: `${(v / t) * 100}%`, background: PALETTE[si % PALETTE.length] }} /> : null;
                })}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 5, whiteSpace: "nowrap" }}>{b}</div>
            </div>
          );
        })}
        </div>

        {/* Donut tỉ trọng + xếp hạng */}
        <div>
          <Donut sellers={sellers} metric={metric} total={metric === "o" ? totals.orders : totals.items} />
          <div style={{ marginTop: 14, maxHeight: 220, overflowY: "auto", paddingRight: 4 }}>
            {sellers.map((s, si) => {
              const v = metric === "o" ? s.orders : s.items;
              const tot = metric === "o" ? totals.orders : totals.items;
              const pct = tot ? (v / tot) * 100 : 0;
              return (
                <div key={si} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12.5, borderBottom: "1px solid var(--line)" }}>
                  <span style={{ width: 20, textAlign: "center", fontWeight: 800, color: si < 3 ? "var(--blue)" : "var(--muted)", fontSize: si < 3 ? 13 : 12 }}>{si + 1}</span>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: PALETTE[si % PALETTE.length], flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: si < 3 ? 700 : 400 }}>{s.name}</span>
                  <b>{s.orders.toLocaleString()}</b>
                  <span style={{ color: "var(--muted)" }}>({s.items.toLocaleString()})</span>
                  <span style={{ width: 44, textAlign: "right", color: "var(--muted)", fontSize: 11.5 }}>{pct.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tooltip chi tiết ngày */}
      {tip && (
        <div style={{
          position: "fixed", left: Math.min(tip.x + 14, typeof window !== "undefined" ? window.innerWidth - 240 : tip.x), top: tip.y + 10, zIndex: 50,
          background: "#fff", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "0 8px 24px rgba(17,24,39,.12)", padding: "10px 14px", minWidth: 200, pointerEvents: "none",
        }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>{buckets[tip.bi]} — {colTotal[tip.bi]} {metric === "o" ? tr("rep.ordersWord") : "items"}</div>
          {sellers.map((s, si) => {
            const v = s.daily[tip.bi][metric];
            return v ? (
              <div key={si} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "1.5px 0" }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: PALETTE[si % PALETTE.length] }} />
                <span style={{ flex: 1 }}>{s.name}</span><b>{v}</b>
              </div>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}

function Donut({ sellers, metric, total }: { sellers: Seller[]; metric: "o" | "i"; total: number }) {
  const { t: tr } = useLang();
  const [hov, setHov] = useState<number | null>(null);
  const R = 70, r = 44, C = 100;
  let acc = 0;
  const arcs = sellers.map((s, si) => {
    const v = metric === "o" ? s.orders : s.items;
    const frac = total ? v / total : 0;
    const a0 = acc * 2 * Math.PI - Math.PI / 2; acc += frac;
    const a1 = acc * 2 * Math.PI - Math.PI / 2;
    const large = frac > 0.5 ? 1 : 0;
    const p = (a: number, rad: number) => `${C + rad * Math.cos(a)},${C + rad * Math.sin(a)}`;
    return { si, v, frac, d: `M ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)} L ${p(a1, r)} A ${r} ${r} 0 ${large} 0 ${p(a0, r)} Z` };
  });
  const show = hov !== null ? sellers[hov] : null;
  const showV = show ? (metric === "o" ? show.orders : show.items) : total;
  return (
    <svg viewBox="0 0 200 200" style={{ width: "100%", maxWidth: 230, display: "block", margin: "0 auto" }}>
      {arcs.map((a) => a.frac > 0 && (
        <path key={a.si} d={a.d} fill={PALETTE[a.si % PALETTE.length]}
          opacity={hov === null || hov === a.si ? 1 : 0.25}
          style={{ cursor: "pointer", transition: "opacity .15s" }}
          onMouseEnter={() => setHov(a.si)} onMouseLeave={() => setHov(null)} />
      ))}
      <text x="100" y="94" textAnchor="middle" style={{ fontSize: 22, fontWeight: 800, fill: "var(--ink)" }}>{showV.toLocaleString()}</text>
      <text x="100" y="114" textAnchor="middle" style={{ fontSize: 11, fill: "var(--muted)" }}>
        {show ? `${show.name} · ${((showV / (total || 1)) * 100).toFixed(1)}%` : metric === "o" ? tr("rep.totalOrders") : tr("rep.totalItems")}
      </text>
    </svg>
  );
}
