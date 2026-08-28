"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Row = {
  listingKey: string; title: string; listingId: string | null; productUrl: string | null;
  image: string | null; orders: number; qty: number; revenue: number | null;
  lastOrder: string | null; platforms: string[]; baseSku: number | null;
};

const RANGES = [
  { k: "30", label: "30 ngày" },
  { k: "90", label: "90 ngày" },
  { k: "365", label: "1 năm" },
  { k: "1096", label: "Tất cả" },
];
const SORTS = [
  { k: "orders", label: "Nhiều đơn nhất" },
  { k: "qty", label: "Nhiều sản phẩm nhất" },
  { k: "revenue", label: "Doanh thu cao nhất" },
  { k: "recent", label: "Bán gần đây" },
];
const PLAT_COLOR: Record<string, string> = { etsy: "#F1641E", shopify: "#5E8E3E", amazon: "#FF9900", tiktok: "#010101", other: "#66788E" };
const money = (n: number | null) => (n == null ? "" : "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString() : "—");

export function ProductSalesClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [showMoney, setShowMoney] = useState(false);
  const [q, setQ] = useState("");
  const [days, setDays] = useState("365");
  const [sort, setSort] = useState("orders");
  const [plat, setPlat] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true); setErr("");
    try {
      const p = new URLSearchParams({ days, sort, limit: "100" });
      if (q.trim()) p.set("q", q.trim());
      if (plat) p.set("platform", plat);
      const res = await fetch(`/api/stats/product-sales?${p}`);
      const j = await res.json();
      if (my !== seq.current) return;
      if (!j?.ok) throw new Error(j?.error || "lỗi");
      setRows(j.rows); setTotal(j.total); setShowMoney(!!j.showMoney);
    } catch (e) {
      if (my === seq.current) setErr(String((e as Error)?.message ?? e));
    } finally { if (my === seq.current) setLoading(false); }
  }, [q, days, sort, plat]);

  // debounce search; reload khi đổi filter
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

  const th: React.CSSProperties = { textAlign: "left", fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted,#888)", padding: "8px 10px", fontWeight: 700, whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "10px", borderTop: "1px solid var(--line,#eee)", fontSize: 14, verticalAlign: "middle" };

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "0 4px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", margin: "4px 0 4px" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Sale theo Listing</h1>
        <span style={{ fontSize: 13, color: "var(--muted,#888)" }}>{total.toLocaleString()} listing có đơn</span>
      </div>
      <p style={{ fontSize: 13, color: "var(--muted,#888)", margin: "0 0 14px" }}>
        Gộp mọi đơn của cùng một listing (kể cả đơn customized chưa gán design) → biết mẫu nào bán chạy để ưu tiên chạy ads.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <input className="field" placeholder="Tìm listing theo tên hoặc listing_id…" value={q} onChange={(e) => setQ(e.target.value)}
          style={{ flex: "1 1 260px", minWidth: 220, padding: "9px 12px", fontSize: 14 }} />
        <select className="field" value={days} onChange={(e) => setDays(e.target.value)} style={{ padding: "9px 10px" }}>
          {RANGES.map((r) => <option key={r.k} value={r.k}>{r.label}</option>)}
        </select>
        <select className="field" value={sort} onChange={(e) => setSort(e.target.value)} style={{ padding: "9px 10px" }}>
          {SORTS.map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}
        </select>
        <select className="field" value={plat} onChange={(e) => setPlat(e.target.value)} style={{ padding: "9px 10px" }}>
          <option value="">Mọi sàn</option>
          <option value="etsy">Etsy</option>
          <option value="shopify">Shopify</option>
          <option value="amazon">Amazon</option>
          <option value="tiktok">TikTok</option>
        </select>
      </div>

      {err && <div className="panel" style={{ padding: 12, marginBottom: 12, color: "#b4321f" }}>Lỗi: {err}</div>}

      <div className="panel" style={{ padding: 0, overflowX: "auto", borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 46 }}></th>
              <th style={th}>Listing</th>
              <th style={{ ...th, textAlign: "right" }}>Đơn</th>
              <th style={{ ...th, textAlign: "right" }}>SL</th>
              {showMoney && <th style={{ ...th, textAlign: "right" }}>Doanh thu</th>}
              <th style={th}>Sàn</th>
              <th style={th}>Bán gần nhất</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.listingKey}>
                <td style={{ ...td, padding: "6px 4px 6px 10px" }}>
                  {r.image
                    ? <img src={r.image} alt="" width={38} height={38} style={{ width: 38, height: 38, objectFit: "cover", borderRadius: 7, display: "block" }} />
                    : <div style={{ width: 38, height: 38, borderRadius: 7, background: "var(--ground,#eee)" }} />}
                </td>
                <td style={td}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--muted,#aaa)", fontWeight: 700, minWidth: 20 }}>{i + 1}.</span>
                    {r.productUrl
                      ? <a href={r.productUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: "inherit", textDecoration: "none" }}>{r.title}</a>
                      : <span style={{ fontWeight: 600 }}>{r.title}</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--muted,#999)", marginLeft: 26 }}>
                    {r.baseSku != null && <span>Base #{r.baseSku}</span>}
                    {r.baseSku != null && r.listingId && <span> · </span>}
                    {r.listingId && <span>listing {r.listingId}</span>}
                  </div>
                </td>
                <td style={{ ...td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{r.orders}</td>
                <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.qty}</td>
                {showMoney && <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(r.revenue)}</td>}
                <td style={td}>
                  <span style={{ display: "inline-flex", gap: 4 }}>
                    {r.platforms.map((p) => (
                      <span key={p} style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", color: "#fff", background: PLAT_COLOR[p] ?? PLAT_COLOR.other, padding: "2px 6px", borderRadius: 5 }}>{p}</span>
                    ))}
                  </span>
                </td>
                <td style={{ ...td, color: "var(--muted,#888)", fontSize: 13, whiteSpace: "nowrap" }}>{fmtDate(r.lastOrder)}</td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr><td colSpan={showMoney ? 7 : 6} style={{ ...td, textAlign: "center", color: "var(--muted,#999)", padding: 30 }}>Không có listing nào khớp.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {loading && <div style={{ textAlign: "center", color: "var(--muted,#999)", fontSize: 13, marginTop: 10 }}>Đang tải…</div>}
    </div>
  );
}
