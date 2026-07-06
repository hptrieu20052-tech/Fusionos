"use client";
import { useCallback, useEffect, useState } from "react";
import { BarChart, Heat } from "@/components/charts";

type Seller = { id: string; name: string; values: number[]; total: number };

export function OrderStats() {
  const [days, setDays] = useState(7);
  const [metric, setMetric] = useState<"orders" | "items">("orders");
  const [dayList, setDayList] = useState<string[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);

  const load = useCallback(() => {
    fetch(`/api/stats/orders?days=${days}&metric=${metric}`).then((r) => r.json()).then((j) => {
      if (j.ok) { setDayList(j.days); setSellers(j.sellers); }
    });
  }, [days, metric]);
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
      <div className="panel" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h3 style={{ fontWeight: 800, fontSize: 15 }}>Thống kê Đơn hàng</h3>
        <div className="nav" style={{ marginTop: 0 }}>
          {[7, 14, 30].map((d) => <a key={d} onClick={() => setDays(d)} className={days === d ? "on" : ""} style={{ cursor: "pointer" }}>{d} ngày</a>)}
        </div>
        <div className="nav" style={{ marginTop: 0, marginLeft: "auto" }}>
          <a onClick={() => setMetric("orders")} className={metric === "orders" ? "on" : ""} style={{ cursor: "pointer" }}>Orders</a>
          <a onClick={() => setMetric("items")} className={metric === "items" ? "on" : ""} style={{ cursor: "pointer" }}>Items</a>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="l">{L} hôm nay</div><div className="v">{today.toLocaleString()}</div>
          <div className="d" style={{ color: diff >= 0 ? "var(--green)" : "var(--red)" }}>{diff >= 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(1)}% vs hôm qua</div></div>
        <div className="kpi"><div className="l">Tổng {days} ngày</div><div className="v">{grand.toLocaleString()}</div><div className="d">TB {(grand / (days || 1)).toFixed(1)}/ngày</div></div>
        <div className="kpi"><div className="l">Top seller</div><div className="v" style={{ fontSize: 17 }}>{top?.name ?? "—"}</div><div className="d" style={{ color: "var(--green)" }}>{top?.total.toLocaleString() ?? 0} {L.toLowerCase()}</div></div>
        <div className="kpi"><div className="l">Số seller có đơn</div><div className="v">{sellers.length}</div></div>
      </div>

      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>{L} theo ngày — toàn công ty</h3>
        <div className="sub" style={{ marginBottom: 8 }}>Cột đậm là hôm nay · nét đứt là trung bình kỳ</div>
        <BarChart labels={dayList.map(fmtD)} values={totals} />
      </div>

      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>Bảng chi tiết: Seller × Ngày</h3>
        <div className="sub" style={{ marginBottom: 8 }}>Ô càng đậm càng nhiều {L.toLowerCase()} · click tiêu đề xem xếp hạng</div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Seller</th>{dayList.map((d) => <th key={d} style={{ textAlign: "center" }}>{fmtD(d)}</th>)}<th style={{ textAlign: "right" }}>Tổng</th><th style={{ textAlign: "right" }}>TB/ngày</th></tr></thead>
            <tbody>
              {sellers.map((s, idx) => (
                <tr key={s.id}>
                  <td><b>{idx === 0 ? "" : ""}{s.name}</b></td>
                  {s.values.map((v, i) => <td key={i} style={{ textAlign: "center" }}><Heat v={v} max={maxCell} /></td>)}
                  <td style={{ textAlign: "right", fontWeight: 800 }}>{s.total.toLocaleString()}</td>
                  <td style={{ textAlign: "right", fontWeight: 800 }}>{(s.total / (days || 1)).toFixed(1)}</td>
                </tr>
              ))}
              <tr style={{ background: "var(--blue-soft)" }}>
                <td style={{ fontWeight: 800 }}>Toàn công ty</td>
                {totals.map((v, i) => <td key={i} style={{ textAlign: "center", fontWeight: 800 }}>{v}</td>)}
                <td style={{ textAlign: "right", fontWeight: 800 }}>{grand.toLocaleString()}</td>
                <td style={{ textAlign: "right", fontWeight: 800 }}>{(grand / (days || 1)).toFixed(1)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
