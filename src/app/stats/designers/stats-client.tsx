"use client";
import { useCallback, useEffect, useState } from "react";
import { BarChart, Heat, HBarList } from "@/components/charts";

type Designer = { id: string; name: string; values: number[]; total: number; points: number; avgScore: number; reviews: number; bizOrders: number; kpi: number };

export function DesignerStats() {
  const [days, setDays] = useState(7);
  const [dayList, setDayList] = useState<string[]>([]);
  const [designers, setDesigners] = useState<Designer[]>([]);

  const load = useCallback(() => {
    fetch(`/api/stats/designers?days=${days}`).then((r) => r.json()).then((j) => {
      if (j.ok) { setDayList(j.days); setDesigners(j.designers); }
    });
  }, [days]);
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
      <div className="panel" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h3 style={{ fontWeight: 800, fontSize: 15 }}>Thống kê Designer</h3>
        <div className="nav" style={{ marginTop: 0, marginLeft: "auto" }}>
          {[7, 14, 30].map((d) => <a key={d} onClick={() => setDays(d)} className={days === d ? "on" : ""} style={{ cursor: "pointer" }}>{d} ngày</a>)}
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="l">Design hôm nay</div><div className="v">{today}</div>
          <div className="d" style={{ color: today >= yest ? "var(--green)" : "var(--red)" }}>{today >= yest ? "▲ +" : "▼ "}{today - yest} vs hôm qua</div></div>
        <div className="kpi"><div className="l">Tổng {days} ngày</div><div className="v">{grand}</div><div className="d">TB {(grand / (days || 1)).toFixed(1)}/ngày · {designers.length} designer</div></div>
        <div className="kpi"><div className="l">Điểm chất lượng TB</div><div className="v">{avgScore ? avgScore.toFixed(1) : "—"}<span style={{ fontSize: 13, color: "var(--muted)" }}>/10</span></div></div>
        <div className="kpi"><div className="l">Design &quot;ra đơn&quot; nhất</div><div className="v" style={{ fontSize: 17 }}>{topBiz?.name ?? "—"}</div><div className="d" style={{ color: "var(--green)" }}>{topBiz?.bizOrders ?? 0} đơn / 30 ngày</div></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 14 }}>
        <div className="panel">
          <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>Design hoàn thành theo ngày</h3>
          <div className="sub" style={{ marginBottom: 8 }}>Toàn team</div>
          <BarChart labels={dayList.map(fmtD)} values={totals} />
        </div>
        <div className="panel">
          <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>Xếp hạng KPI tổng hợp</h3>
          <div className="sub" style={{ marginBottom: 8 }}>40% sản lượng (points) + 30% chất lượng + 30% hiệu quả</div>
          <HBarList rows={designers.map((d, i) => ({ label: (i === 0 ? "" : "") + d.name, value: d.kpi, suffix: d.kpi.toFixed(1) }))} />
        </div>
      </div>

      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>Bảng chi tiết: Designer × Ngày</h3>
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table>
            <thead><tr><th>Designer</th>{dayList.map((d) => <th key={d} style={{ textAlign: "center" }}>{fmtD(d)}</th>)}<th style={{ textAlign: "right" }}>Tổng</th><th style={{ textAlign: "right" }}>Points</th></tr></thead>
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
                <td style={{ fontWeight: 800 }}>Toàn team</td>
                {totals.map((v, i) => <td key={i} style={{ textAlign: "center", fontWeight: 800 }}>{v}</td>)}
                <td style={{ textAlign: "right", fontWeight: 800 }}>{grand}</td><td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>Chất lượng & hiệu quả từng designer</h3>
        <table style={{ marginTop: 8 }}>
          <thead><tr><th>Designer</th><th style={{ textAlign: "center" }}>Điểm review TB</th><th style={{ textAlign: "center" }}>Số review</th><th style={{ textAlign: "right" }}>Đơn từ design (30d)</th><th style={{ textAlign: "right" }}>KPI</th></tr></thead>
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
