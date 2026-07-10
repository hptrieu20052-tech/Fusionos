"use client";
import { useLang } from "@/components/lang-provider";
import { useEffect, useState } from "react";

type Team = { name: string; orders: number; items: number; revenue: number; aov: number; members: { name: string; role: string; orders: number; revenue: number }[]; daily: { o: number; r: number }[] };
type Data = { buckets: string[]; teams: Team[]; totals: { orders: number; items: number; revenue: number } };

const PALETTE = ["#1D5FAE", "#E0A45E", "#5FAE87", "#D583AB", "#9D89D4", "#CE7B7B"];

const money = (n: number) => "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });

type RangeProps = { range: string; from?: string; to?: string };
export default function TeamReport({ range, from, to }: RangeProps) {
  const { t: tr } = useLang();
  const [metric, setMetric] = useState<"r" | "o">("r"); // r = doanh thu, o = đơn
  const [data, setData] = useState<Data | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; bi: number } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/stats/team-report?range=${range}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`).then((r) => r.json())
      .then((j) => { if (j.ok) setData(j); }).finally(() => setLoading(false));
  }, [range, from, to]);

  if (!data) return <div className="card" style={{ padding: 24, color: "var(--muted)" }}>{tr("rep.loadingTeam")}</div>;

  const { buckets, teams, totals } = data;
  const colTotal = buckets.map((_, bi) => teams.reduce((a, t) => a + t.daily[bi][metric], 0));
  const max = Math.max(...colTotal, 1);
  const H = 210;

  return (
    <div className="card" style={{ padding: "20px 22px", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <a href="/stats/orders" style={{ fontWeight: 700, fontSize: 15, color: "var(--ink)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>Team Report <span style={{ color: "var(--sky)", fontSize: 12.5 }}>{tr("rep.viewDetails")}</span></a>
        <div style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
          {([["r", tr("rep.revenueTab")], ["o", tr("rep.ordersTab")]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setMetric(k)} style={{
              padding: "6px 12px", fontSize: 12.5, border: "none", cursor: "pointer",
              background: metric === k ? "var(--blue-soft)" : "#fff", color: metric === k ? "var(--blue)" : "var(--muted)", fontWeight: 600,
            }}>{label}</button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", fontWeight: 700, fontSize: 14 }}>
          <span style={{ color: "var(--green)" }}>{money(totals.revenue)}</span> · {totals.orders.toLocaleString()} {tr("rep.ordersWord")} ({totals.items.toLocaleString()} items)
        </div>
      </div>

      {loading && <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,.5)", borderRadius: 18, zIndex: 5 }} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20, alignItems: "start" }}>
        {/* Stacked bar theo thời gian */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: buckets.length > 20 ? 3 : 8, height: H + 40, overflowX: "auto", paddingBottom: 4 }}>
          {buckets.map((b, bi) => {
            const t = colTotal[bi];
            return (
              <div key={bi} style={{ flex: "1 0 auto", minWidth: buckets.length > 20 ? 22 : 34, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}
                onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, bi })} onMouseLeave={() => setTip(null)}>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 3, whiteSpace: "nowrap" }}>{t ? (metric === "r" ? money(t) : t) : ""}</div>
                <div style={{ width: "100%", maxWidth: 44, height: Math.max((t / max) * H, t ? 3 : 0), display: "flex", flexDirection: "column-reverse", borderRadius: 6, overflow: "hidden" }}>
                  {teams.map((s, si) => {
                    const v = s.daily[bi][metric];
                    return v ? <div key={si} style={{ height: `${(v / t) * 100}%`, background: PALETTE[si % PALETTE.length] }} /> : null;
                  })}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 5, whiteSpace: "nowrap" }}>{b}</div>
              </div>
            );
          })}
        </div>

        {/* Donut + xếp hạng team thu gọn bên phải */}
        <div>
          <Donut teams={teams} metric={metric} total={metric === "r" ? totals.revenue : totals.orders} />
          <div style={{ marginTop: 12 }}>
            {teams.map((t, ti) => (
              <div key={ti} style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: ti === 0 ? "var(--blue)" : "var(--muted)", border: "1.5px solid currentColor", borderRadius: 7, padding: "0 6px" }}>#{ti + 1}</span>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: PALETTE[ti % PALETTE.length] }} />
                  <b style={{ fontSize: 13, flex: 1 }}>{t.name}</b>
                  <b style={{ fontSize: 13.5, color: "var(--green)" }}>{money(t.revenue)}</b>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--muted)", paddingLeft: 24 }}>
                  <span>{t.orders} {tr("rep.ordersWord")} ({t.items} items)</span>
                  <span>AOV {money(t.aov)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {tip && (
        <div style={{
          position: "fixed", left: Math.min(tip.x + 14, typeof window !== "undefined" ? window.innerWidth - 240 : tip.x), top: tip.y + 10, zIndex: 50,
          background: "#fff", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "0 8px 24px rgba(17,24,39,.12)", padding: "10px 14px", minWidth: 210, pointerEvents: "none",
        }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>
            {buckets[tip.bi]} — {metric === "r" ? money(colTotal[tip.bi]) : `${colTotal[tip.bi]} ${tr("rep.ordersWord")}`}
          </div>
          {teams.map((s, si) => {
            const v = s.daily[tip.bi][metric];
            return v ? (
              <div key={si} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "1.5px 0" }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: PALETTE[si % PALETTE.length] }} />
                <span style={{ flex: 1 }}>{s.name}</span><b>{metric === "r" ? money(v) : v}</b>
              </div>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}

function Donut({ teams, metric, total }: { teams: Team[]; metric: "r" | "o"; total: number }) {
  const { t: tr } = useLang();
  const [hov, setHov] = useState<number | null>(null);
  const R = 70, r = 44, C = 100;
  let acc = 0;
  const val = (t: Team) => (metric === "r" ? t.revenue : t.orders);
  const arcs = teams.map((t, ti) => {
    const v = val(t);
    const frac = total ? v / total : 0;
    const a0 = acc * 2 * Math.PI - Math.PI / 2; acc += frac;
    const a1 = acc * 2 * Math.PI - Math.PI / 2;
    const large = frac > 0.5 ? 1 : 0;
    const p = (a: number, rad: number) => `${C + rad * Math.cos(a)},${C + rad * Math.sin(a)}`;
    return { ti, v, frac, d: `M ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)} L ${p(a1, r)} A ${r} ${r} 0 ${large} 0 ${p(a0, r)} Z` };
  });
  const show = hov !== null ? teams[hov] : null;
  const showV = show ? val(show) : total;
  const fmt = (n: number) => metric === "r" ? "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toLocaleString();
  return (
    <svg viewBox="0 0 200 200" style={{ width: "100%", maxWidth: 210, display: "block", margin: "0 auto" }}>
      {arcs.map((a) => a.frac > 0 && (
        <path key={a.ti} d={a.d} fill={PALETTE[a.ti % PALETTE.length]}
          opacity={hov === null || hov === a.ti ? 1 : 0.25}
          style={{ cursor: "pointer", transition: "opacity .15s" }}
          onMouseEnter={() => setHov(a.ti)} onMouseLeave={() => setHov(null)} />
      ))}
      <text x="100" y="94" textAnchor="middle" style={{ fontSize: 20, fontWeight: 800, fill: "var(--ink)" }}>{fmt(showV)}</text>
      <text x="100" y="114" textAnchor="middle" style={{ fontSize: 11, fill: "var(--muted)" }}>
        {show ? `${show.name} · ${((showV / (total || 1)) * 100).toFixed(1)}%` : metric === "r" ? tr("rep.totalRevenue") : tr("rep.totalOrders")}
      </text>
    </svg>
  );
}
