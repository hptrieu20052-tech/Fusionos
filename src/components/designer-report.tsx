"use client";
import { useLang } from "@/components/lang-provider";
import { useEffect, useRef, useState } from "react";

type Designer = {
  id: string; name: string; designs: number; points: number;
  salesOrders: number; salesRevenue: number; avgScore: number; reviews: number;
  videos?: number;
  kpi: number; daily: { d: number; s: number }[];
};
type Data = { buckets: string[]; designers: Designer[]; totals: { designs: number; videos?: number; salesOrders: number; salesRevenue: number } };

const PALETTE = [
  "#9D89D4", "#5FAE87", "#E0A45E", "#D583AB", "#1D5FAE", "#CE7B7B", "#5FA8BC", "#9FB56B",
  "#DB9468", "#3D9BE0", "#5FAFA3", "#C388D6", "#CBB05E", "#5E8FC7", "#7BB88A", "#D07F93",
];
const money = (n: number) => "$" + (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// v476 · TẠM ẨN cột Score + KPI + dòng chú thích công thức (yêu cầu 2026-09-12 — "về sau cần bổ sung").
// Khi muốn hiện lại: đổi thành true (API vẫn trả đủ avgScore/kpi, không đụng backend).
const SHOW_KPI = false;
// v477 · TẠM ẨN Revenue (cột trong bảng + số $ trên header) — bật lại: đổi true.
const SHOW_REVENUE = false;

// by="designer" → gom theo người thiết kế. by="content" → gom theo ô Creator của design (role content).
// Dùng chung một component: cùng API, chỉ khác tham số `by` và nhãn cột đầu.
type RangeProps = { range: string; from?: string; to?: string; hideMoney?: boolean; title?: string; by?: "designer" | "content" };
export default function DesignerReport({ range, from, to, hideMoney, title, by = "designer" }: RangeProps) {
  const { t: tr } = useLang();
  const [metric, setMetric] = useState<"d" | "s">("d"); // d = design tạo, s = đơn phát sinh
  const [data, setData] = useState<Data | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; bi: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isContent = by === "content";

  // v469/v471 · Đổi range → xoá data cũ ngay (không show số kỳ cũ) + ignore-guard chống response cũ ghi đè.
  //  + v472: request LỖI thì hiện NGUYÊN VĂN lỗi server (chẩn đoán), không kẹt "Loading" vô hạn.
  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setErr(null);
    setData(null);
    fetch(`/api/stats/designer-report?by=${by}&range=${range}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`).then((r) => r.json())
      .then((j) => { if (ignore) return; if (j.ok) setData(j); else setErr(String(j.error ?? "unknown")); })
      .catch(() => { if (!ignore) setErr("no response from server (function timeout — query took too long)"); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [by, range, from, to]);

  // Cột bar cuộn ngang trong panel → tự nhảy tới NGÀY MỚI NHẤT (mép phải) mỗi khi đổi dữ liệu/metric
  const barsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = barsRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [data, metric]);

  if (err && !data) return <div className="card" style={{ padding: 24, color: "var(--red)", fontSize: 13 }}>Failed to load report — error: <b>{err}</b></div>;
  if (!data) return <div className="card" style={{ padding: 24, color: "var(--muted)" }}>{tr("rep.loadingDesigner")}</div>;

  const { buckets, designers, totals } = data;
  const colTotal = buckets.map((_, bi) => designers.reduce((a, s) => a + s.daily[bi][metric], 0));
  const max = Math.max(...colTotal, 1);
  const H = 220;

  return (
    <div className="card" style={{ padding: "20px 22px", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        {isContent
          ? <span style={{ fontWeight: 700, fontSize: 15, color: "var(--ink)" }}>{title ?? "Creator Report"}</span>
          : <a href="/stats/designers" style={{ fontWeight: 700, fontSize: 15, color: "var(--ink)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>{title ?? "Designer Report"} <span style={{ color: "var(--sky)", fontSize: 12.5 }}>{tr("rep.viewDetails")}</span></a>}
        <div style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
          {([["d", "Design"], ["s", "Item sale"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setMetric(k)} style={{
              padding: "6px 12px", fontSize: 12.5, border: "none", cursor: "pointer",
              background: metric === k ? "var(--blue-soft)" : "#fff", color: metric === k ? "var(--blue)" : "var(--muted)", fontWeight: 600,
            }}>{label}</button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", fontWeight: 700, fontSize: 14 }}>
          {totals.designs.toLocaleString()} design{isContent ? ` · ${(totals.videos ?? 0).toLocaleString()} video` : ""} · {totals.salesOrders.toLocaleString()} {tr("rep.genOrdersUnit")}{SHOW_REVENUE && !hideMoney && <> · <span style={{ color: "var(--green)" }}>{money(totals.salesRevenue)}</span></>}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginBottom: 14 }}>
        {designers.map((s, si) => (
          <span key={si} style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: PALETTE[si % PALETTE.length], display: "inline-block" }} />
            <b>{s.name}</b> {s.designs} <span style={{ color: "var(--muted)" }}>({s.salesOrders} {tr("rep.saleWord")})</span>
          </span>
        ))}
      </div>

      {loading && <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,.5)", borderRadius: 18, zIndex: 5 }} />}

      <div className="rep-grid" style={{ ["--rep-side" as string]: "400px" } as React.CSSProperties}>
        {/* Stacked bars */}
        <div className="rep-bars" ref={barsRef} style={{ gap: buckets.length > 20 ? 3 : 8, height: H + 40 }}>
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

        {/* v474 · Bỏ donut — dành trọn cột phải cho bảng xếp hạng KPI (hiện được nhiều dòng hơn) */}
        <div className="rep-side">
          <div className="rep-rank" style={{ maxHeight: 480, overflowY: "auto" }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--muted)", textAlign: "right" }}>
                  <th style={{ textAlign: "left", padding: "3px 4px" }}># {isContent ? "Creator" : "Designer"}</th>
                  <th style={{ padding: "3px 4px" }}>Design</th>
                  {isContent && <th style={{ padding: "3px 4px" }}>Video</th>}
                  <th style={{ padding: "3px 4px" }}>Item sale</th>
                  {SHOW_REVENUE && !hideMoney && <th className="rep-col-opt" style={{ padding: "3px 4px" }}>Revenue</th>}
                  {SHOW_KPI && <th className="rep-col-opt" style={{ padding: "3px 4px" }}>{tr("rep.score")}</th>}
                  {SHOW_KPI && <th style={{ padding: "3px 4px" }}>KPI</th>}
                </tr>
              </thead>
              <tbody>
                {designers.map((s, si) => {
                  const un = s.id === "unassigned"; // v481 · dòng "(Unassigned)" hiển thị mờ, không tranh hạng
                  return (
                  <tr key={si} style={{ borderTop: "1px solid var(--line)", textAlign: "right", color: un ? "var(--muted)" : undefined }}>
                    <td style={{ textAlign: "left", padding: "6px 4px", maxWidth: 170, overflow: "hidden" }}>
                      <div style={{ whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
                        <span style={{ fontWeight: 800, color: !un && si < 3 ? "var(--blue)" : "var(--muted)", marginRight: 6 }}>{un ? "—" : si + 1}</span>
                        <span style={{ width: 9, height: 9, borderRadius: 3, background: PALETTE[si % PALETTE.length], display: "inline-block", marginRight: 5 }} />
                        <b style={{ fontWeight: !un && si < 3 ? 700 : 500, fontStyle: un ? "italic" : undefined }}>{s.name}</b>
                      </div>
                    </td>
                    <td style={{ padding: "6px 4px" }}><b>{s.designs.toLocaleString()}</b>{SHOW_KPI && <> <span style={{ color: "var(--muted)", fontSize: 11 }}>({s.points}{tr("rep.ptSuffix")})</span></>}</td>
                    {isContent && <td style={{ padding: "6px 4px", fontWeight: 700, color: "#4338CA" }}>{s.videos ?? 0}</td>}
                    <td style={{ padding: "6px 4px" }}>{s.salesOrders.toLocaleString()}</td>
                    {SHOW_REVENUE && !hideMoney && <td className="rep-col-opt" style={{ padding: "5px 4px", color: "var(--green)", fontWeight: 600 }}>{money(s.salesRevenue)}</td>}
                    {SHOW_KPI && <td className="rep-col-opt" style={{ padding: "5px 4px" }}>{s.avgScore ? s.avgScore.toFixed(1) : <span style={{ color: "var(--muted)" }}>—</span>}</td>}
                    {SHOW_KPI && <td style={{ padding: "5px 4px" }}>
                      <span style={{ background: si === 0 ? "var(--blue)" : "var(--blue-soft)", color: si === 0 ? "#fff" : "var(--blue)", borderRadius: 8, padding: "2px 8px", fontWeight: 800 }}>{s.kpi.toFixed(1)}</span>
                    </td>}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {SHOW_KPI && <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 6 }}>{tr("rep.kpiFormula")}</div>}
        </div>
      </div>

      {/* Tooltip */}
      {tip && (
        <div style={{
          position: "fixed", left: Math.min(tip.x + 14, typeof window !== "undefined" ? window.innerWidth - 240 : tip.x), top: tip.y + 10, zIndex: 50,
          background: "#fff", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "0 8px 24px rgba(17,24,39,.12)", padding: "10px 14px", minWidth: 200, pointerEvents: "none",
        }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>{buckets[tip.bi]} — {colTotal[tip.bi]} {metric === "d" ? "design" : tr("rep.saleWord")}</div>
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
