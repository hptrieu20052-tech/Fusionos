"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { rangeToDates, type RangeValue } from "@/components/date-range";

/**
 * v209b · Khối "Creator Report" trên Dashboard — bản gọn của /stats/creators.
 *
 * Lý do có file này: người role "content" chỉ có quyền module "videos", không có orders/designs,
 * nên Dashboard của họ TRỐNG TRƠN — mọi khối cũ đều gác theo orders/designs.
 * Khối này lấp đúng chỗ đó và là thứ họ cần thấy: mình quay được bao nhiêu, clip đang chạy ở đâu.
 *
 * API tự giới hạn phạm vi: videos level 2 / admin thấy cả đội, level 1 chỉ thấy của chính mình.
 */
type Creator = {
  id: string; name: string; values: number[]; total: number;
  listings: number; onShopify: number; kpi: number;
};
type Data = { dayList: string[]; totals: number[]; creators: Creator[]; grand: number; seeAll: boolean };

const PALETTE = ["#5FAE87", "#9D89D4", "#E0A45E", "#D583AB", "#5FA8BC", "#9FB56B", "#DB9468", "#3D9BE0"];

export default function CreatorReport({ range, from, to, title = "Creator Report" }: {
  range: string; from?: string; to?: string; title?: string;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const rv = { range, from, to } as RangeValue;
    const d = rangeToDates(rv);
    fetch(`/api/stats/creators?from=${d.from}&to=${d.to}`).then((r) => r.json())
      .then((j) => { if (j.ok) setData(j); }).finally(() => setLoading(false));
  }, [range, from, to]);

  if (loading && !data) return <div className="card" style={{ padding: 24, color: "var(--muted)" }}>Loading creator report…</div>;
  if (!data) return null;

  const { dayList, totals, creators, grand, seeAll } = data;
  const max = Math.max(1, ...totals);
  const listingsAll = creators.reduce((t, c) => t + c.listings, 0);
  const shopifyAll = creators.reduce((t, c) => t + c.onShopify, 0);
  const fmtD = (d: string) => d.slice(5).replace("-", "/");

  return (
    <div className="card" style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <h3 style={{ fontWeight: 800, fontSize: 15, margin: 0 }}>{title}</h3>
        <Link href="/stats/creators" style={{ fontSize: 12.5, color: "var(--blue)", fontWeight: 700, textDecoration: "none" }}>View details →</Link>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 13, fontWeight: 700 }}>
          Total: {grand} <span style={{ color: "var(--muted)", fontWeight: 500 }}>({listingsAll} listings · {shopifyAll} on Shopify)</span>
        </div>
      </div>

      {!grand ? (
        <div style={{ padding: "26px 0", textAlign: "center", color: "var(--muted)", fontSize: 13.5 }}>
          Chưa có video nào trong khoảng này.{" "}
          <Link href="/videos" style={{ color: "var(--blue)", fontWeight: 700, textDecoration: "none" }}>Mở Video Library →</Link>
        </div>
      ) : (
        <>
          {/* Cột theo ngày — cùng ngôn ngữ hình ảnh với Team Designer Report */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 150, overflowX: "auto", paddingBottom: 4 }}>
            {dayList.map((d, i) => (
              <div key={d} style={{ flex: "1 0 26px", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 26 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: totals[i] ? "var(--ink)" : "transparent" }}>{totals[i] || 0}</div>
                <div title={`${fmtD(d)}: ${totals[i]} video`}
                  style={{ width: "100%", height: `${Math.max(2, (totals[i] / max) * 100)}%`, background: totals[i] ? "#5FAE87" : "#E8EDF3", borderRadius: "5px 5px 0 0", minHeight: 3 }} />
                <div style={{ fontSize: 9.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtD(d)}</div>
              </div>
            ))}
          </div>

          <div style={{ overflowX: "auto", marginTop: 14 }}>
            <table style={{ width: "100%" }}>
              <thead><tr>
                <th style={{ textAlign: "left" }}>{seeAll ? "Creator" : "You"}</th>
                <th style={{ textAlign: "right" }}>Videos</th>
                <th style={{ textAlign: "right" }}>Listings</th>
                <th style={{ textAlign: "right" }}>On Shopify</th>
                <th style={{ textAlign: "right" }}>KPI</th>
              </tr></thead>
              <tbody>
                {creators.map((c, i) => (
                  <tr key={c.id}>
                    <td>
                      <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, background: PALETTE[i % PALETTE.length], marginRight: 7 }} />
                      <b>{c.name}</b>
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 800 }}>{c.total}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{c.listings}</td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: "var(--green)" }}>{c.onShopify}</td>
                    <td style={{ textAlign: "right", fontWeight: 800, color: "var(--blue)" }}>{c.kpi.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
