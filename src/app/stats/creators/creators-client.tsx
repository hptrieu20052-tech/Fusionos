"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import DateRangePicker, { rangeToDates, type RangeValue } from "@/components/date-range";
import { BarChart, Heat, HBarList } from "@/components/charts";

// v209 · Creator Stats — cùng bố cục với Designer Stats để hai bảng đọc như nhau.
type Creator = {
  id: string; name: string; values: number[]; total: number;
  approved: number; rejected: number; pending: number; approvalRate: number | null;
  listings: number; onShopify: number; kpi: number;
};

const fmtD = (d: string) => d.slice(5).replace("-", "/");
const rateColor = (r: number | null) =>
  r == null ? "var(--muted)" : r >= 85 ? "var(--green)" : r >= 60 ? "var(--amber)" : "var(--red)";

export default function CreatorStats() {
  const [dr, setDr] = useState<RangeValue>({ range: "7d" });
  const [dayList, setDayList] = useState<string[]>([]);
  const [totals, setTotals] = useState<number[]>([]);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [grand, setGrand] = useState(0);
  const [seeAll, setSeeAll] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const { from, to } = rangeToDates(dr);
    fetch(`/api/stats/creators?from=${from}&to=${to}`).then((r) => r.json()).then((j) => {
      if (!j.ok) return;
      setDayList(j.dayList ?? []); setTotals(j.totals ?? []);
      setCreators(j.creators ?? []); setGrand(j.grand ?? 0); setSeeAll(!!j.seeAll);
    }).finally(() => setLoading(false));
  }, [dr]);
  useEffect(() => { load(); }, [load]);

  const maxCell = Math.max(1, ...creators.flatMap((c) => c.values));
  const today = totals[totals.length - 1] ?? 0;
  const yest = totals[totals.length - 2] ?? 0;
  const approvedAll = creators.reduce((t, c) => t + c.approved, 0);
  const pendingAll = creators.reduce((t, c) => t + c.pending, 0);
  const listingsAll = creators.reduce((t, c) => t + c.listings, 0);
  const shopifyAll = creators.reduce((t, c) => t + c.onShopify, 0);
  const judged = creators.reduce((t, c) => t + c.approved + c.rejected, 0);
  const rateAll = judged ? Math.round((approvedAll / judged) * 100) : null;
  const topImpact = [...creators].sort((a, b) => b.listings - a.listings)[0];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <h2 style={{ fontWeight: 800, fontSize: 19, margin: 0 }}>Creator Stats</h2>
          <div className="sub">{seeAll ? "Whole team" : "Your own uploads"}</div>
        </div>
        <div style={{ flex: 1 }} />
        <Link href="/videos" className="btn" style={{ fontSize: 12.5, padding: "7px 13px", borderRadius: 10, border: "1px solid var(--line)", textDecoration: "none", color: "var(--ink)", background: "#fff", fontWeight: 700 }}>
          ← Video Library
        </Link>
        <DateRangePicker value={dr} onChange={setDr} align="right" />
      </div>

      <div className="kpis" style={{ marginBottom: 14 }}>
        <div className="kpi">
          <div className="l">Uploaded today</div>
          <div className="v">{today}</div>
          <div className="d" style={{ color: today >= yest ? "var(--green)" : "var(--red)" }}>{today >= yest ? "▲ +" : "▼ "}{today - yest} vs yesterday</div>
        </div>
        <div className="kpi">
          <div className="l">Total {dayList.length} days</div>
          <div className="v">{grand}</div>
          <div className="d">Avg {(grand / (dayList.length || 1)).toFixed(1)}/day · {creators.length} creator(s)</div>
        </div>
        <div className="kpi">
          <div className="l">Approval rate</div>
          <div className="v" style={{ color: rateColor(rateAll) }}>{rateAll == null ? "—" : rateAll + "%"}</div>
          <div className="d">{approvedAll} approved{pendingAll ? ` · ${pendingAll} pending` : ""}</div>
        </div>
        <div className="kpi">
          <div className="l">Listings covered</div>
          <div className="v">{listingsAll}</div>
          <div className="d" style={{ color: "var(--green)" }}>{shopifyAll} live on Shopify</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 14 }}>
        <div className="panel">
          <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>Videos uploaded per day</h3>
          <div className="sub" style={{ marginBottom: 8 }}>{seeAll ? "Whole team" : "You"}</div>
          <BarChart labels={dayList.map(fmtD)} values={totals} />
        </div>
        <div className="panel">
          <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>Overall KPI ranking</h3>
          <div className="sub" style={{ marginBottom: 8 }}>40% output (approved) + 30% quality (approval rate) + 30% impact (listings)</div>
          <HBarList rows={creators.map((c) => ({ label: c.name, value: c.kpi, suffix: c.kpi.toFixed(1) }))} />
        </div>
      </div>

      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>Detail: Creator × Day</h3>
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table>
            <thead><tr>
              <th>Creator</th>
              {dayList.map((d) => <th key={d} style={{ textAlign: "center" }}>{fmtD(d)}</th>)}
              <th style={{ textAlign: "right" }}>Total</th>
            </tr></thead>
            <tbody>
              {creators.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b></td>
                  {c.values.map((v, i) => <td key={i} style={{ textAlign: "center" }}><Heat v={v} max={maxCell} /></td>)}
                  <td style={{ textAlign: "right", fontWeight: 800 }}>{c.total}</td>
                </tr>
              ))}
              {creators.length > 1 && (
                <tr style={{ background: "var(--blue-soft)" }}>
                  <td style={{ fontWeight: 800 }}>Whole team</td>
                  {totals.map((v, i) => <td key={i} style={{ textAlign: "center", fontWeight: 800 }}>{v}</td>)}
                  <td style={{ textAlign: "right", fontWeight: 800 }}>{grand}</td>
                </tr>
              )}
              {!creators.length && !loading && (
                <tr><td colSpan={dayList.length + 2} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No uploads in this range</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3 style={{ fontWeight: 800, fontSize: 14.5 }}>Quality &amp; impact per creator</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ marginTop: 8 }}>
            <thead><tr>
              <th>Creator</th>
              <th style={{ textAlign: "center" }}>Approved</th>
              <th style={{ textAlign: "center" }}>Rejected</th>
              <th style={{ textAlign: "center" }}>Pending</th>
              <th style={{ textAlign: "center" }}>Approval rate</th>
              <th style={{ textAlign: "right" }}>Listings covered</th>
              <th style={{ textAlign: "right" }}>Live on Shopify</th>
              <th style={{ textAlign: "right" }}>KPI</th>
            </tr></thead>
            <tbody>
              {creators.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b></td>
                  <td style={{ textAlign: "center", fontWeight: 700, color: "var(--green)" }}>{c.approved}</td>
                  <td style={{ textAlign: "center", color: c.rejected ? "var(--red)" : "var(--muted)" }}>{c.rejected}</td>
                  <td style={{ textAlign: "center", color: c.pending ? "var(--amber)" : "var(--muted)" }}>{c.pending}</td>
                  <td style={{ textAlign: "center" }}>
                    {c.approvalRate == null ? "—" : (
                      <span style={{ fontWeight: 800, padding: "3px 10px", borderRadius: 8, background: "var(--blue-soft)", color: rateColor(c.approvalRate) }}>{c.approvalRate}%</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 800 }}>{c.listings}</td>
                  <td style={{ textAlign: "right", fontWeight: 800, color: "var(--green)" }}>{c.onShopify}</td>
                  <td style={{ textAlign: "right", fontWeight: 800, color: "var(--blue)" }}>{c.kpi.toFixed(1)}</td>
                </tr>
              ))}
              {!creators.length && !loading && (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {topImpact && (
        <div className="panel" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13 }}>
            Most impact: <b>{topImpact.name}</b> — video của người này đang hiện trên <b>{topImpact.listings}</b> listing
            {topImpact.onShopify ? <> ({topImpact.onShopify} đã lên Shopify)</> : null}.
          </div>
        </div>
      )}
    </>
  );
}
