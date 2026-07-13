"use client";
import { useCallback, useEffect, useState } from "react";
import DateRangePicker, { rangeToDates, RangeValue } from "@/components/date-range";
import { BarChart, Heat } from "@/components/charts";

type Seller = { id: string; name: string; values: number[]; total: number };

export function OrderStats() {
  const [days] = useState(30);
  const [dr, setDr] = useState<RangeValue | null>({ range: "30d" }); // mặc định 30 days
  const [metric, setMetric] = useState<"orders" | "items">("orders");
  const [dayList, setDayList] = useState<string[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [scoped, setScoped] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/stats/orders?${dr ? (() => { const { from, to } = rangeToDates(dr); return `from=${from}&to=${to}`; })() : `days=${days}`}&metric=${metric}`).then((r) => r.json()).then((j) => {
      if (j.ok) { setDayList(j.days); setSellers(j.sellers); setScoped(!!j.scoped); }
    });
  }, [days, metric, dr]);
  useEffect(() => { load(); }, [load]);

  const totals = dayList.map((_, i) => sellers.reduce((t, s) => t + s.values[i], 0));
  const grand = totals.reduce((a, b) => a + b, 0);
  const today = totals[totals.length - 1] ?? 0, yest = totals[totals.length - 2] ?? 0;
  const diff = yest ? ((today - yest) / yest) * 100 : 0;
  const top = sellers[0];
  const maxCell = Math.max(...sellers.flatMap((s) => s.values), 1);
  const fmtD = (d: string) => d.slice(8, 10) + "/" + d.slice(5, 7);
  const L = metric === "orders" ? "Orders" : "Items";

  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <div className="nav" style={{ marginTop: 0 }}>
          <a onClick={() => setMetric("orders")} className={metric === "orders" ? "on" : ""} style={{ cursor: "pointer" }}>Orders</a>
          <a onClick={() => setMetric("items")} className={metric === "items" ? "on" : ""} style={{ cursor: "pointer" }}>Items</a>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <DateRangePicker value={dr ?? { range: "30d" }} onChange={(v) => setDr(v)} align="right" allowClear onClear={() => setDr({ range: "30d" })} />
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="l">{L} today</div><div className="v">{today.toLocaleString()}</div>
          <div className="d" style={{ color: diff >= 0 ? "var(--green)" : "var(--red)" }}>{diff >= 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(1)}% vs yesterday</div></div>
        <div className="kpi"><div className="l">Total {dayList.length} days</div><div className="v">{grand.toLocaleString()}</div><div className="d">Avg {(grand / (dayList.length || 1)).toFixed(1)}/day</div></div>
        <div className="kpi"><div className="l">Top seller</div><div className="v" style={{ fontSize: 17 }}>{top?.name ?? "—"}</div><div className="d" style={{ color: "var(--green)" }}>{top?.total.toLocaleString() ?? 0} {L.toLowerCase()}</div></div>
        <div className="kpi"><div className="l">Sellers with orders</div><div className="v">{sellers.length}</div></div>
      </div>

      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>{L} per day{scoped ? " — your team" : " — whole company"}</h3>
        <div className="sub" style={{ marginBottom: 8 }}>Bold column = today · dashed line = period average</div>
        <BarChart labels={dayList.map(fmtD)} values={totals} />
      </div>

      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>Detail: Seller × Day</h3>
        <div className="sub" style={{ marginBottom: 8 }}>Darker cells = more {L.toLowerCase()} · click a header to see ranking</div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Seller</th>{dayList.map((d) => <th key={d} style={{ textAlign: "center" }}>{fmtD(d)}</th>)}<th style={{ textAlign: "right" }}>Total</th><th style={{ textAlign: "right" }}>Avg/day</th></tr></thead>
            <tbody>
              {sellers.map((s, idx) => (
                <tr key={s.id}>
                  <td><b>{idx === 0 ? "" : ""}{s.name}</b></td>
                  {s.values.map((v, i) => <td key={i} style={{ textAlign: "center" }}><Heat v={v} max={maxCell} /></td>)}
                  <td style={{ textAlign: "right", fontWeight: 800 }}>{s.total.toLocaleString()}</td>
                  <td style={{ textAlign: "right", fontWeight: 800 }}>{(s.total / (dayList.length || 1)).toFixed(1)}</td>
                </tr>
              ))}
              <tr style={{ background: "var(--blue-soft)" }}>
                <td style={{ fontWeight: 800 }}>{scoped ? "Team total" : "Whole company"}</td>
                {totals.map((v, i) => <td key={i} style={{ textAlign: "center", fontWeight: 800 }}>{v}</td>)}
                <td style={{ textAlign: "right", fontWeight: 800 }}>{grand.toLocaleString()}</td>
                <td style={{ textAlign: "right", fontWeight: 800 }}>{(grand / (dayList.length || 1)).toFixed(1)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
