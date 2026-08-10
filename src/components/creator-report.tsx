"use client";
import { useEffect, useRef, useState } from "react";
import { rangeToDates, type RangeValue } from "@/components/date-range";

/**
 * v209e · Khối "Creator Report" trên Dashboard — DÙNG ĐÚNG bố cục của Team Designer Report
 * (legend · cột chồng theo ngày · donut · bảng xếp hạng KPI · dòng công thức) để cả trang đọc
 * như một hệ thống, không phải mỗi khối một kiểu.
 *
 * Lý do khối này tồn tại: người role "content" chỉ có quyền module "videos", không có
 * orders/designs — mọi khối cũ đều gác theo hai quyền đó nên Dashboard của họ trống trơn.
 *
 * API tự giới hạn phạm vi: videos level 2 / admin xem cả đội, level 1 chỉ xem của chính mình.
 */
type Creator = {
  id: string; name: string; values: number[]; total: number;
  listings: number; onShopify: number; kpi: number;
};
type Data = { dayList: string[]; totals: number[]; creators: Creator[]; grand: number; seeAll: boolean };

// Cùng bảng màu với Designer/Content Report — người thứ n ở khối nào cũng một màu.
const PALETTE = [
  "#9D89D4", "#5FAE87", "#E0A45E", "#D583AB", "#1D5FAE", "#CE7B7B", "#5FA8BC", "#9FB56B",
  "#DB9468", "#3D9BE0", "#5FAFA3", "#C388D6", "#CBB05E", "#5E8FC7", "#7BB88A", "#D07F93",
];
const fmtD = (d: string) => d.slice(5).replace("-", "/");

export default function CreatorReport({ range, from, to, title = "Creator Report" }: {
  range: string; from?: string; to?: string; title?: string;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [tip, setTip] = useState<{ x: number; y: number; bi: number } | null>(null);
  const barsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    const d = rangeToDates({ range, from, to } as RangeValue);
    fetch(`/api/stats/creators?from=${d.from}&to=${d.to}`).then((r) => r.json())
      .then((j) => { if (j.ok) setData(j); }).finally(() => setLoading(false));
  }, [range, from, to]);

  // Cột cuộn ngang → luôn nhảy tới ngày mới nhất (mép phải), giống Designer Report.
  useEffect(() => { const el = barsRef.current; if (el) el.scrollLeft = el.scrollWidth; }, [data]);

  if (!data) return <div className="card" style={{ padding: 24, color: "var(--muted)" }}>Loading creator report…</div>;

  const { dayList, creators, grand, seeAll } = data;
  const colTotal = dayList.map((_, bi) => creators.reduce((a, c) => a + (c.values[bi] ?? 0), 0));
  const max = Math.max(...colTotal, 1);
  const listingsAll = creators.reduce((t, c) => t + c.listings, 0);
  const shopifyAll = creators.reduce((t, c) => t + c.onShopify, 0);
  const H = 220;

  return (
    <div className="card" style={{ padding: "20px 22px", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <a href="/stats/creators" style={{ fontWeight: 700, fontSize: 15, color: "var(--ink)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
          {title} <span style={{ color: "var(--sky)", fontSize: 12.5 }}>View details →</span>
        </a>
        <div style={{ marginLeft: "auto", fontWeight: 700, fontSize: 14 }}>
          {grand.toLocaleString()} video · {listingsAll.toLocaleString()} listings covered
          {shopifyAll ? <> · <span style={{ color: "var(--green)" }}>{shopifyAll.toLocaleString()} live</span></> : null}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginBottom: 14 }}>
        {creators.map((c, si) => (
          <span key={c.id} style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: PALETTE[si % PALETTE.length], display: "inline-block" }} />
            <b>{c.name}</b> {c.total} <span style={{ color: "var(--muted)" }}>({c.listings} listings)</span>
          </span>
        ))}
      </div>

      {loading && <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,.5)", borderRadius: 18, zIndex: 5 }} />}

      {!creators.length ? (
        <div style={{ padding: "30px 0", textAlign: "center", color: "var(--muted)", fontSize: 13.5 }}>
          No videos in this range. <a href="/videos" style={{ color: "var(--blue)", fontWeight: 700, textDecoration: "none" }}>Open Video Library →</a>
        </div>
      ) : (
      <div className="rep-grid" style={{ ["--rep-side" as string]: "400px" } as React.CSSProperties}>
        {/* Cột chồng theo ngày */}
        <div className="rep-bars" ref={barsRef} style={{ gap: dayList.length > 20 ? 3 : 8, height: H + 40 }}>
          {dayList.map((b, bi) => {
            const t = colTotal[bi];
            return (
              <div key={b} style={{ flex: "1 0 auto", minWidth: dayList.length > 20 ? 22 : 34, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}
                onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, bi })} onMouseLeave={() => setTip(null)}>
                <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 3 }}>{t || ""}</div>
                <div style={{ width: "100%", maxWidth: 40, height: Math.max((t / max) * H, t ? 3 : 0), display: "flex", flexDirection: "column-reverse", borderRadius: 6, overflow: "hidden" }}>
                  {creators.map((c, si) => {
                    const v = c.values[bi] ?? 0;
                    return v ? <div key={c.id} style={{ height: `${(v / t) * 100}%`, background: PALETTE[si % PALETTE.length] }} /> : null;
                  })}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 5, whiteSpace: "nowrap" }}>{fmtD(b)}</div>
              </div>
            );
          })}
        </div>

        {/* Donut + bảng xếp hạng */}
        <div className="rep-side">
          <Donut creators={creators} total={grand} />
          <div className="rep-rank" style={{ marginTop: 12, maxHeight: 240, overflowY: "auto" }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--muted)", textAlign: "right" }}>
                  <th style={{ textAlign: "left", padding: "3px 4px" }}># {seeAll ? "Creator" : "You"}</th>
                  <th style={{ padding: "3px 4px" }}>Video</th>
                  <th style={{ padding: "3px 4px" }}>Listing</th>
                  <th className="rep-col-opt" style={{ padding: "3px 4px" }}>Live</th>
                  <th style={{ padding: "3px 4px" }}>KPI</th>
                </tr>
              </thead>
              <tbody>
                {creators.map((c, si) => (
                  <tr key={c.id} style={{ borderTop: "1px solid var(--line)", textAlign: "right" }}>
                    <td style={{ textAlign: "left", padding: "5px 4px", whiteSpace: "nowrap" }}>
                      <span style={{ fontWeight: 800, color: si < 3 ? "var(--blue)" : "var(--muted)", marginRight: 6 }}>{si + 1}</span>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: PALETTE[si % PALETTE.length], display: "inline-block", marginRight: 5 }} />
                      <b style={{ fontWeight: si < 3 ? 700 : 500 }}>{c.name}</b>
                    </td>
                    <td style={{ padding: "5px 4px" }}><b>{c.total}</b></td>
                    <td style={{ padding: "5px 4px" }}>{c.listings}</td>
                    <td className="rep-col-opt" style={{ padding: "5px 4px", color: c.onShopify ? "var(--green)" : "var(--muted)", fontWeight: 600 }}>{c.onShopify}</td>
                    <td style={{ padding: "5px 4px" }}>
                      <span style={{ background: si === 0 ? "var(--blue)" : "var(--blue-soft)", color: si === 0 ? "#fff" : "var(--blue)", borderRadius: 8, padding: "2px 8px", fontWeight: 800 }}>{c.kpi.toFixed(1)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 6 }}>
            KPI = 40% output (videos) · 40% listings covered · 20% live on Shopify — within the selected period
          </div>
        </div>
      </div>
      )}

      {/* Tooltip theo ngày */}
      {tip && colTotal[tip.bi] > 0 && (
        <div style={{
          position: "fixed", left: Math.min(tip.x + 14, typeof window !== "undefined" ? window.innerWidth - 240 : tip.x), top: tip.y + 10, zIndex: 50,
          background: "#fff", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "0 8px 24px rgba(17,24,39,.12)", padding: "10px 14px", minWidth: 200, pointerEvents: "none",
        }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>{fmtD(dayList[tip.bi])} — {colTotal[tip.bi]} video</div>
          {creators.map((c, si) => {
            const v = c.values[tip.bi] ?? 0;
            return v ? (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "1.5px 0" }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: PALETTE[si % PALETTE.length] }} />
                <span style={{ flex: 1 }}>{c.name}</span><b>{v}</b>
              </div>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}

function Donut({ creators, total }: { creators: Creator[]; total: number }) {
  const [hov, setHov] = useState<number | null>(null);
  const R = 70, r = 44, C = 100;
  let acc = 0;
  const arcs = creators.map((c, si) => {
    const frac = total ? c.total / total : 0;
    const a0 = acc * 2 * Math.PI - Math.PI / 2; acc += frac;
    const a1 = acc * 2 * Math.PI - Math.PI / 2;
    const large = frac > 0.5 ? 1 : 0;
    const p = (a: number, rad: number) => `${C + rad * Math.cos(a)},${C + rad * Math.sin(a)}`;
    return { si, frac, d: `M ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)} L ${p(a1, r)} A ${r} ${r} 0 ${large} 0 ${p(a0, r)} Z` };
  });
  const show = hov !== null ? creators[hov] : null;
  const showV = show ? show.total : total;
  return (
    <svg viewBox="0 0 200 200" style={{ width: "100%", maxWidth: 190, display: "block", margin: "0 auto" }}>
      {arcs.map((a) => a.frac > 0 && (
        <path key={a.si} d={a.d} fill={PALETTE[a.si % PALETTE.length]}
          opacity={hov === null || hov === a.si ? 1 : 0.25}
          style={{ cursor: "pointer", transition: "opacity .15s" }}
          onMouseEnter={() => setHov(a.si)} onMouseLeave={() => setHov(null)} />
      ))}
      <text x="100" y="94" textAnchor="middle" style={{ fontSize: 22, fontWeight: 800, fill: "var(--ink)" }}>{showV.toLocaleString()}</text>
      <text x="100" y="114" textAnchor="middle" style={{ fontSize: 11, fill: "var(--muted)" }}>
        {show ? `${show.name} · ${((showV / (total || 1)) * 100).toFixed(1)}%` : "total videos"}
      </text>
    </svg>
  );
}
