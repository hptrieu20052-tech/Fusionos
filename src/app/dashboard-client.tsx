"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import DateRangePicker, { RangeValue } from "@/components/date-range";
import { useLang } from "@/components/lang-provider";
import TeamReport from "@/components/team-report";
import SellerReport from "@/components/seller-report";
import DesignerReport from "@/components/designer-report";

const money = (n: number) => "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });

type Pipe = { c: number; q: number };
type Kpi = { orders: number; revenue: number; prevOrders: number | null; prevRevenue: number | null; items: number; prevLabel: string; pendingNew: number; issues: number; designs: number; profit: number; profitRevenue: number; profitFee: number; profitCost: number;
  pipeline: { order: { c: number; q: number; prev: number | null }; in_production: Pipe; in_transit: Pipe; delivered: Pipe } };

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

  const delta = (cur: number, prev: number | null, label = tr("db.prevPeriod")) => {
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

      {/* Hàng 1 — Số lượng đơn */}
      {kpi?.pipeline && (
        <div className="dash-row">
          <Link href="/orders" className="pipe-card" style={{ ...kpiLink, borderTopColor: "#5A6272" }}>
            <div className="pipe-l">{tr("db.allOrder")}</div>
            <div className="pipe-v">{kpi.pipeline.order.c.toLocaleString()} <span className="pipe-q">({tr("db.quantity")} {kpi.pipeline.order.q.toLocaleString()})</span>
              {kpi.pipeline.order.prev != null && kpi.pipeline.order.prev > 0 && kpi.pipeline.order.prev !== kpi.pipeline.order.c && (
                <span className="pipe-delta" style={{ color: kpi.pipeline.order.c - kpi.pipeline.order.prev >= 0 ? "var(--green)" : "var(--red)" }}>
                  {kpi.pipeline.order.c - kpi.pipeline.order.prev >= 0 ? "+" : ""}{kpi.pipeline.order.c - kpi.pipeline.order.prev} {kpi.pipeline.order.c - kpi.pipeline.order.prev >= 0 ? "↑" : "↓"}
                </span>
              )}
            </div>
          </Link>
          <Link href="/orders?status=new" className="pipe-card" style={{ ...kpiLink, borderTopColor: "#3E7BD6" }}>
            <div className="pipe-l">{tr("db.kpiNew")}</div>
            <div className="pipe-v">{kpi.pendingNew.toLocaleString()}</div>
            <div className="pipe-sub">{tr("db.toFulfill")}</div>
          </Link>
          <Link href="/orders?status=has_issues" className="pipe-card" style={{ ...kpiLink, borderTopColor: "#DB6B5E" }}>
            <div className="pipe-l">{tr("db.kpiIssues")}</div>
            <div className="pipe-v" style={{ color: kpi.issues > 0 ? "var(--red)" : undefined }}>{kpi.issues.toLocaleString()}</div>
            <div className="pipe-sub">{kpi.issues > 0 ? tr("db.viewIssues") : tr("db.noIssues")}</div>
          </Link>
        </div>
      )}

      {/* Hàng 2 — Pipeline sản xuất/giao */}
      {kpi?.pipeline && (
        <div className="dash-row">
          <Link href="/orders?status=in_production" className="pipe-card" style={{ ...kpiLink, borderTopColor: "#4F9E93" }}>
            <div className="pipe-l">{tr("db.pipeInProduction")}</div>
            <div className="pipe-v">{kpi.pipeline.in_production.c.toLocaleString()} <span className="pipe-q">({tr("db.quantity")} {kpi.pipeline.in_production.q.toLocaleString()})</span></div>
          </Link>
          <Link href="/orders?status=shipped" className="pipe-card" style={{ ...kpiLink, borderTopColor: "#8FAF5C" }}>
            <div className="pipe-l">{tr("db.pipeInTransit")}</div>
            <div className="pipe-v">{kpi.pipeline.in_transit.c.toLocaleString()} <span className="pipe-q">({tr("db.quantity")} {kpi.pipeline.in_transit.q.toLocaleString()})</span></div>
          </Link>
          <Link href="/orders?status=completed" className="pipe-card" style={{ ...kpiLink, borderTopColor: "#5E86C9" }}>
            <div className="pipe-l">{tr("db.pipeDelivered")}</div>
            <div className="pipe-v">{kpi.pipeline.delivered.c.toLocaleString()} <span className="pipe-q">({tr("db.quantity")} {kpi.pipeline.delivered.q.toLocaleString()})</span></div>
          </Link>
        </div>
      )}

      {/* Hàng 3 — Tài chính */}
      {kpi && (
        <div className="dash-row">
          <Link href="/finance" className="pipe-card" style={{ ...kpiLink, borderTopColor: "#2FA36B" }}>
            <div className="pipe-l">{tr("db.kpiRevenue")}</div>
            <div className="pipe-v">{money(kpi.revenue)}</div>
            <div className="pipe-sub">{delta(kpi.revenue, kpi.prevRevenue, kpi.prevLabel)}</div>
          </Link>
          <Link href="/finance" className="pipe-card" style={{ ...kpiLink, borderTopColor: "#E0913C" }}>
            <div className="pipe-l">{tr("db.fulfillCost")}</div>
            <div className="pipe-v" style={{ color: "#C9760F" }}>{money(kpi.profitCost)}</div>
            <div className="pipe-sub">{tr("db.fulfillCostSub")}</div>
          </Link>
          <Link href="/finance" className="pipe-card" style={{ ...kpiLink, borderTopColor: kpi.profit >= 0 ? "#2FA36B" : "#DB6B5E" }}>
            <div className="pipe-l">{tr("db.kpiProfit")}</div>
            <div className="pipe-v" style={{ color: kpi.profit >= 0 ? "var(--green)" : "var(--red)" }}>{money(kpi.profit)}</div>
            <div className="pipe-sub">DT {money(kpi.profitRevenue)} − phí {money(kpi.profitFee)} − vốn {money(kpi.profitCost)}</div>
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
