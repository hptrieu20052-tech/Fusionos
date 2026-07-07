"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import DateRangePicker, { RangeValue } from "@/components/date-range";
import { useLang } from "@/components/lang-provider";
import TeamReport from "@/components/team-report";
import SellerReport from "@/components/seller-report";
import DesignerReport from "@/components/designer-report";

const money = (n: number) => "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });

type Kpi = { orders: number; revenue: number; prevOrders: number | null; prevRevenue: number | null; items: number; prevLabel: string; pendingNew: number; issues: number; designs: number; profit: number; profitRevenue: number; profitFee: number; profitCost: number };

export default function DashboardClient({ canDesigns }: { canDesigns: boolean }) {
  const { t: tr } = useLang();
  const [dr, setDr] = useState<RangeValue>({ range: "30d" });
  const range = dr.range;
  const [kpi, setKpi] = useState<Kpi | null>(null);

  const ready = range !== "custom" || (dr.from && dr.to);
  const f = range === "custom" ? dr.from : undefined;
  const t = range === "custom" ? dr.to : undefined;

  useEffect(() => {
    if (!ready) return;
    const p = new URLSearchParams({ range });
    if (f) p.set("from", f); if (t) p.set("to", t);
    fetch(`/api/dashboard?${p}`).then((r) => r.json()).then((j) => { if (j.ok) setKpi(j); });
  }, [range, f, t, ready]);

  const delta = (cur: number, prev: number | null, label = "kỳ trước") => {
    if (prev === null) return <div className="d" style={{ color: "var(--faint)" }}>— chưa có dữ liệu {label}</div>;
    if (prev === 0) return <div className="d" style={{ color: "var(--faint)" }}>mới so với {label}</div>;
    const d = ((cur - prev) / prev) * 100;
    return (
      <div className="d" style={{ color: d >= 0 ? "var(--green)" : "var(--red)" }}>
        {d >= 0 ? "▲" : "▼"} {Math.abs(d).toFixed(1)}% vs {label}
      </div>
    );
  };

  return (
    <>
      {/* Bộ chọn thời gian — 1 dòng mảnh, không chiếm card */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <DateRangePicker value={dr} onChange={setDr} align="right" />
      </div>

      {/* KPI theo range */}
      {kpi && (
        <div className="kpis">
          <Link href="/orders" style={kpiLink} className="kpi">
            <div className="l">{tr("db.kpiOrders")}</div>
            <div className="v">{kpi.orders.toLocaleString()} <span style={{ fontSize: 14, fontWeight: 600, color: "var(--muted)" }}>· {kpi.items.toLocaleString()} items</span></div>
            {delta(kpi.orders, kpi.prevOrders, kpi.prevLabel)}
          </Link>
          <Link href="/finance" style={kpiLink} className="kpi">
            <div className="l">{tr("db.kpiRevenue")}</div><div className="v">{money(kpi.revenue)}</div>
            {delta(kpi.revenue, kpi.prevRevenue, kpi.prevLabel)}
          </Link>
          <Link href="/finance" style={kpiLink} className="kpi">
            <div className="l">{tr("db.kpiProfit")}</div>
            <div className="v" style={{ color: kpi.profit >= 0 ? "var(--green)" : "var(--red)" }}>{money(kpi.profit)}</div>
            <div className="d">DT {money(kpi.profitRevenue)} − phí {money(kpi.profitFee)} − vốn {money(kpi.profitCost)}</div>
          </Link>
          <Link href="/fulfillment" style={kpiLink} className="kpi">
            <div className="l">{tr("db.kpiNew")}</div><div className="v">{kpi.pendingNew}</div>
            <div className="d">{tr("db.toFulfill")}</div>
          </Link>
          <Link href="/orders?status=has_issues" style={kpiLink} className="kpi">
            <div className="l">{tr("db.kpiIssues")}</div>
            <div className="v" style={{ color: kpi.issues > 0 ? "var(--red)" : undefined }}>{kpi.issues}</div>
            <div className="d">{kpi.issues > 0 ? tr("db.viewIssues") : tr("db.noIssues")}</div>
          </Link>
        </div>
      )}

      {/* Thứ tự: Team → Seller → Designer, cùng ăn theo range */}
      {ready && (
        <>
          <div className="section"><TeamReport range={range} from={f} to={t} /></div>
          <div className="section"><SellerReport range={range} from={f} to={t} /></div>
          {canDesigns && <div className="section"><DesignerReport range={range} from={f} to={t} /></div>}
        </>
      )}
      {!ready && <div className="panel empty">Chọn đủ ngày bắt đầu và kết thúc để xem dữ liệu.</div>}
    </>
  );
}

const inp: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 10, padding: "6px 10px", fontSize: 13, background: "#fff" };
const kpiLink: React.CSSProperties = { textDecoration: "none", color: "inherit", cursor: "pointer" };
