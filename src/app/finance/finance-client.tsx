"use client";
import { useCallback, useEffect, useState } from "react";
import DateRangePicker, { rangeToDates, RangeValue } from "@/components/date-range";
import { HBarList } from "@/components/charts";
import { useLang } from "@/components/lang-provider";

const typeLabel = (t: (k: string) => string, ty: string) => t(`fin.t.${ty}`) || ty;
type Row = Record<string, string | number | null>;
const inp = { padding: "9px 12px", border: "1px solid var(--line)", borderRadius: 11, font: "inherit", fontSize: 12.5 } as const;
const money = (v: unknown) => "$" + Math.abs(Number(v ?? 0)).toLocaleString(undefined, { maximumFractionDigits: 0 });

const TX_TYPES = ["revenue","base_cost","shipping","platform_fee","ads","sample","salary","tool","refund","other"];
export function FinanceClient({ canAdd }: { canAdd: boolean }) {
  const { t: tr } = useLang();
  const [days, setDays] = useState(30);
  const [dr, setDr] = useState<RangeValue | null>(null); // range tuỳ chọn — ưu tiên hơn preset days
  const [data, setData] = useState<{ byType: Row[]; daily: Row[]; bySeller: Row[]; byPlatform: Row[] } | null>(null);
  const [form, setForm] = useState({ type: "ads", amount: "", note: "" });
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    const q = dr ? (() => { const { from, to } = rangeToDates(dr); return `from=${from}&to=${to}`; })() : `days=${days}`;
    fetch(`/api/finance?${q}`).then((r) => r.json()).then((j) => j.ok && setData(j));
  }, [days, dr]);
  useEffect(() => { load(); }, [load]);

  async function addTx(e: React.FormEvent) {
    e.preventDefault();
    const j = await fetch("/api/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }).then((r) => r.json());
    setMsg(j.ok ? tr("fin.recorded") : "⚠ " + j.error);
    if (j.ok) { setForm({ type: "ads", amount: "", note: "" }); load(); }
  }

  if (!data) return <div className="panel empty">{tr("c.loading2")}</div>;

  const revenue = data.byType.filter((t) => Number(t.total) > 0).reduce((a, t) => a + Number(t.total), 0);
  const cost = data.byType.filter((t) => Number(t.total) < 0).reduce((a, t) => a + Number(t.total), 0);
  const profit = revenue + cost;
  const margin = revenue ? (profit / revenue) * 100 : 0;
  const dailyNet = data.daily.map((d) => Number(d.rev) + Number(d.cost));
  const maxAbs = Math.max(...dailyNet.map(Math.abs), 1);

  return (
    <>
      <div className="panel" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h3 style={{ fontWeight: 800, fontSize: 15 }}>Finance</h3>
        <div className="nav" style={{ marginTop: 0, marginLeft: "auto" }}>
          {[7, 30, 90].map((d) => <a key={d} onClick={() => { setDays(d); setDr(null); }} className={!dr && days === d ? "on" : ""} style={{ cursor: "pointer" }}>{d} days</a>)}
        </div>
        <DateRangePicker value={dr ?? { range: "" }} onChange={(v) => setDr(v)} align="right" allowClear onClear={() => setDr(null)} />
      </div>

      <div className="kpis">
        <div className="kpi"><div className="l">{tr("fin.revenue")}</div><div className="v" style={{ color: "var(--green)" }}>{money(revenue)}</div></div>
        <div className="kpi"><div className="l">{tr("fin.totalCost")}</div><div className="v" style={{ color: "var(--red)" }}>{money(cost)}</div></div>
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
          <HBarList rows={data.byType.filter((t) => Number(t.total) < 0).map((t) => ({
            label: typeLabel(tr, String(t.type)), value: Math.abs(Number(t.total)),
            color: "#CE6B6B", suffix: money(t.total),
          }))} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div className="panel">
          <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>Profit by seller</h3>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Seller</th><th style={{ textAlign: "right" }}>Revenue</th><th style={{ textAlign: "right" }}>Profit</th></tr></thead>
            <tbody>{data.bySeller.map((s) => (
              <tr key={String(s.name)}><td><b>{String(s.name)}</b></td>
                <td style={{ textAlign: "right" }}>{money(s.rev)}</td>
                <td style={{ textAlign: "right", fontWeight: 800, color: Number(s.profit) >= 0 ? "var(--green)" : "var(--red)" }}>{Number(s.profit) < 0 ? "-" : ""}{money(s.profit)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="panel">
          <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>Profit by platform</h3>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Marketplace</th><th style={{ textAlign: "right" }}>Revenue</th><th style={{ textAlign: "right" }}>Profit</th></tr></thead>
            <tbody>{data.byPlatform.map((p) => (
              <tr key={String(p.marketplace)}><td><span className="chip">{String(p.marketplace)}</span></td>
                <td style={{ textAlign: "right" }}>{money(p.rev)}</td>
                <td style={{ textAlign: "right", fontWeight: 800, color: Number(p.profit) >= 0 ? "var(--green)" : "var(--red)" }}>{Number(p.profit) < 0 ? "-" : ""}{money(p.profit)}</td></tr>
            ))}</tbody>
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
        </div>
      </div>
    </>
  );
}
