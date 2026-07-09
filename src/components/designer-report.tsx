"use client";
import { useEffect, useState } from "react";

type Designer = {
  id: string; name: string; designs: number; points: number;
  salesOrders: number; salesRevenue: number; avgScore: number; reviews: number;
  kpi: number; daily: { d: number; s: number }[];
};
type Data = { buckets: string[]; designers: Designer[]; totals: { designs: number; salesOrders: number; salesRevenue: number } };

const PALETTE = [
  "#9D89D4", "#5FAE87", "#E0A45E", "#D583AB", "#1D5FAE", "#CE7B7B", "#5FA8BC", "#9FB56B",
  "#DB9468", "#3D9BE0", "#5FAFA3", "#C388D6", "#CBB05E", "#5E8FC7", "#7BB88A", "#D07F93",
];
const money = (n: number) => "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });

type RangeProps = { range: string; from?: string; to?: string; hideMoney?: boolean };
export default function DesignerReport({ range, from, to, hideMoney }: RangeProps) {
  const [metric, setMetric] = useState<"d" | "s">("d"); // d = design tạo, s = đơn phát sinh
  const [data, setData] = useState<Data | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; bi: number } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/stats/designer-report?range=${range}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`).then((r) => r.json())
      .then((j) => { if (j.ok) setData(j); }).finally(() => setLoading(false));
  }, [range, from, to]);

  if (!data) return <div className="card" style={{ padding: 24, color: "var(--muted)" }}>Đang tải báo cáo designer…</div>;

  const { buckets, designers, totals } = data;
  const colTotal = buckets.map((_, bi) => designers.reduce((a, s) => a + s.daily[bi][metric], 0));
  const max = Math.max(...colTotal, 1);
  const H = 220;

  return (
    <div className="card" style={{ padding: "20px 22px", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <a href="/stats/designers" style={{ fontWeight: 700, fontSize: 15, color: "var(--ink)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>Designer Report <span style={{ color: "var(--sky)", fontSize: 12.5 }}>Xem chi tiết →</span></a>
        <div style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
          {([["d", "Design"], ["s", "Sale"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setMetric(k)} style={{
              padding: "6px 12px", fontSize: 12.5, border: "none", cursor: "pointer",
              background: metric === k ? "var(--blue-soft)" : "#fff", color: metric === k ? "var(--blue)" : "var(--muted)", fontWeight: 600,
            }}>{label}</button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", fontWeight: 700, fontSize: 14 }}>
          {totals.designs.toLocaleString()} design · {totals.salesOrders.toLocaleString()} đơn phát sinh{!hideMoney && <> · <span style={{ color: "var(--green)" }}>{money(totals.salesRevenue)}</span></>}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginBottom: 14 }}>
        {designers.map((s, si) => (
          <span key={si} style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: PALETTE[si % PALETTE.length], display: "inline-block" }} />
            <b>{s.name}</b> {s.designs} <span style={{ color: "var(--muted)" }}>({s.salesOrders} đơn)</span>
          </span>
        ))}
      </div>

      {loading && <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,.5)", borderRadius: 18, zIndex: 5 }} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: 20, alignItems: "start" }}>
        {/* Stacked bars */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: buckets.length > 20 ? 3 : 8, height: H + 40, overflowX: "auto", paddingBottom: 4 }}>
          {buckets.map((b, bi) => {
            const t = colTotal[bi];
            return (
              <div key={bi} style={{ flex: "1 0 auto", minWidth: buckets.length > 20 ? 22 : 34, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}
                onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, bi })} onMouseLeave={() => setTip(null)}>
                <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 3 }}>{t || ""}</div>
                <div style={{ width: "100%", maxWidth: 40, height: Math.max((t / max) * H, t ? 3 : 0), display: "flex", flexDirection: "column-reverse", borderRadius: 6, overflow: "hidden" }}>
                  {designers.map((s, si) => {
                    const v = s.daily[bi][metric];
                    return v ? <div key={si} style={{ height: `${(v / t) * 100}%`, background: PALETTE[si % PALETTE.length] }} /> : null;
                  })}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 5, whiteSpace: "nowrap" }}>{b}</div>
              </div>
            );
          })}
        </div>

        {/* Donut + bảng xếp hạng KPI */}
        <div>
          <Donut designers={designers} metric={metric} total={metric === "d" ? totals.designs : totals.salesOrders} />
          <div style={{ marginTop: 12, maxHeight: 240, overflowY: "auto" }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--muted)", textAlign: "right" }}>
                  <th style={{ textAlign: "left", padding: "3px 4px" }}>#  Designer</th>
                  <th style={{ padding: "3px 4px" }}>Design</th>
                  <th style={{ padding: "3px 4px" }}>Sale</th>
                  {!hideMoney && <th style={{ padding: "3px 4px" }}>Doanh thu</th>}
                  <th style={{ padding: "3px 4px" }}>Điểm</th>
                  <th style={{ padding: "3px 4px" }}>KPI</th>
                </tr>
              </thead>
              <tbody>
                {designers.map((s, si) => (
                  <tr key={si} style={{ borderTop: "1px solid var(--line)", textAlign: "right" }}>
                    <td style={{ textAlign: "left", padding: "5px 4px", whiteSpace: "nowrap" }}>
                      <span style={{ fontWeight: 800, color: si < 3 ? "var(--blue)" : "var(--muted)", marginRight: 6 }}>{si + 1}</span>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: PALETTE[si % PALETTE.length], display: "inline-block", marginRight: 5 }} />
                      <b style={{ fontWeight: si < 3 ? 700 : 500 }}>{s.name}</b>
                    </td>
                    <td style={{ padding: "5px 4px" }}><b>{s.designs}</b> <span style={{ color: "var(--muted)", fontSize: 11 }}>({s.points}đ)</span></td>
                    <td style={{ padding: "5px 4px" }}>{s.salesOrders}</td>
                    {!hideMoney && <td style={{ padding: "5px 4px", color: "var(--green)", fontWeight: 600 }}>{money(s.salesRevenue)}</td>}
                    <td style={{ padding: "5px 4px" }}>{s.avgScore ? s.avgScore.toFixed(1) : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                    <td style={{ padding: "5px 4px" }}>
                      <span style={{ background: si === 0 ? "var(--blue)" : "var(--blue-soft)", color: si === 0 ? "#fff" : "var(--blue)", borderRadius: 8, padding: "2px 8px", fontWeight: 800 }}>{s.kpi.toFixed(1)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 6 }}>KPI = 40% sản lượng (points) · 30% điểm chấm · 30% đơn phát sinh — trong khoảng thời gian đang chọn</div>
        </div>
      </div>

      {/* Tooltip */}
      {tip && (
        <div style={{
          position: "fixed", left: Math.min(tip.x + 14, typeof window !== "undefined" ? window.innerWidth - 240 : tip.x), top: tip.y + 10, zIndex: 50,
          background: "#fff", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "0 8px 24px rgba(17,24,39,.12)", padding: "10px 14px", minWidth: 200, pointerEvents: "none",
        }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>{buckets[tip.bi]} — {colTotal[tip.bi]} {metric === "d" ? "design" : "đơn"}</div>
          {designers.map((s, si) => {
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

function Donut({ designers, metric, total }: { designers: Designer[]; metric: "d" | "s"; total: number }) {
  const [hov, setHov] = useState<number | null>(null);
  const R = 70, r = 44, C = 100;
  let acc = 0;
  const val = (s: Designer) => (metric === "d" ? s.designs : s.salesOrders);
  const arcs = designers.map((s, si) => {
    const v = val(s);
    const frac = total ? v / total : 0;
    const a0 = acc * 2 * Math.PI - Math.PI / 2; acc += frac;
    const a1 = acc * 2 * Math.PI - Math.PI / 2;
    const large = frac > 0.5 ? 1 : 0;
    const p = (a: number, rad: number) => `${C + rad * Math.cos(a)},${C + rad * Math.sin(a)}`;
    return { si, v, frac, d: `M ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)} L ${p(a1, r)} A ${r} ${r} 0 ${large} 0 ${p(a0, r)} Z` };
  });
  const show = hov !== null ? designers[hov] : null;
  const showV = show ? val(show) : total;
  return (
    <svg viewBox="0 0 200 200" style={{ width: "100%", maxWidth: 190, display: "block", margin: "0 auto" }}>
      {arcs.map((a) => a.frac > 0 && (
        <path key={a.si} d={a.d} fill={PALETTE[a.si % PALETTE.length]}
          opacity={hov === null || hov === a.si ? 1 : 0.25}
          style={{ cursor: "pointer", transition: "opacity .15s" }}
          onMouseEnter={() => setHov(a.si)} onMouseLeave={() => setHov(null)} />
      ))}
      <text x="100" y="94" textAnchor="middle" style={{ fontSize: 22, fontWeight: 800, fill: "var(--ink)" }}>{showV.toLocaleString()}</text>
      <text x="100" y="114" textAnchor="middle" style={{ fontSize: 11, fill: "var(--muted)" }}>
        {show ? `${show.name} · ${((showV / (total || 1)) * 100).toFixed(1)}%` : metric === "d" ? "tổng design" : "tổng đơn phát sinh"}
      </text>
    </svg>
  );
}
