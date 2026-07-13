"use client";
import { useCallback, useEffect, useState } from "react";
import DateRangePicker, { rangeToDates, RangeValue } from "@/components/date-range";
import { BarChart, Heat, HBarList } from "@/components/charts";

type Designer = { id: string; name: string; values: number[]; total: number; points: number; avgScore: number; reviews: number; bizOrders: number; kpi: number };

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
    </>
  );
}
