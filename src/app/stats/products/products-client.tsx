"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Row = {
  listingKey: string; title: string; listingId: string | null; productUrl: string | null;
  image: string | null; orders: number; qty: number; revenue: number | null;
  lastOrder: string | null; platforms: string[]; baseSku: number | null;
};

const RANGES = [
  { k: "30", label: "30 days" },
  { k: "90", label: "90 days" },
  { k: "365", label: "1 year" },
  { k: "1096", label: "All time" },
];
const SORTS = [
  { k: "orders", label: "Most orders" },
  { k: "qty", label: "Most units" },
  { k: "revenue", label: "Top revenue" },
  { k: "recent", label: "Recently sold" },
];
const PLAT_COLOR: Record<string, string> = { etsy: "#F1641E", shopify: "#5E8E3E", amazon: "#FF9900", tiktok: "#010101", other: "#66788E" };
const money = (n: number | null) => (n == null ? "" : "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString() : "—");

const sel: React.CSSProperties = { padding: "8px 11px", border: "1px solid var(--line)", borderRadius: 9, fontSize: 13, background: "#fff" };

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
  const [zoom, setZoom] = useState<{ src: string; title: string } | null>(null);
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
      if (!j?.ok) throw new Error(j?.error || "error");
      setRows(j.rows); setTotal(j.total); setShowMoney(!!j.showMoney);
    } catch (e) {
      if (my === seq.current) setErr(String((e as Error)?.message ?? e));
    } finally { if (my === seq.current) setLoading(false); }
  }, [q, days, sort, plat]);

  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setZoom(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  const thc: React.CSSProperties = { padding: "8px 8px", textAlign: "left" };

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>
          Product Sales <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: 13 }}>by listing</span>
        </h2>
        <span style={{ color: "var(--muted)", fontSize: 12.5 }}>· {total.toLocaleString()} listings with orders</span>
        <div style={{ flex: 1 }} />
        <select value={days} onChange={(e) => setDays(e.target.value)} style={sel}>
          {RANGES.map((r) => <option key={r.k} value={r.k}>{r.label}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={sel}>
          {SORTS.map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}
        </select>
        <select value={plat} onChange={(e) => setPlat(e.target.value)} style={sel}>
          <option value="">All channels</option>
          <option value="etsy">Etsy</option>
          <option value="shopify">Shopify</option>
          <option value="amazon">Amazon</option>
          <option value="tiktok">TikTok</option>
        </select>
      </div>

      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 12px" }}>
        Every order of the same listing grouped together (including customized orders not yet assigned a design) — spot best-sellers to prioritize ads.
      </p>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search listing by name or listing_id…"
        style={{ width: "100%", ...sel, padding: "9px 12px", marginBottom: 12 }} />

      {err && <div style={{ fontSize: 12.5, color: "var(--red)", marginBottom: 10 }}>✗ {err}</div>}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
          <thead>
            <tr style={{ color: "var(--muted)", fontSize: 11.5, textTransform: "uppercase" }}>
              <th style={{ ...thc, width: 44 }}></th>
              <th style={thc}>Listing</th>
              <th style={{ ...thc, textAlign: "right" }}>Orders</th>
              <th style={{ ...thc, textAlign: "right" }}>Units</th>
              {showMoney && <th style={{ ...thc, textAlign: "right" }}>Revenue</th>}
              <th style={thc}>Channel</th>
              <th style={thc}>Last sale</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.listingKey} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: "6px 4px 6px 8px" }}>
                  {r.image
                    ? <img src={r.image} alt="" width={38} height={38} onClick={() => setZoom({ src: r.image!, title: r.title })}
                        style={{ width: 38, height: 38, objectFit: "cover", borderRadius: 7, display: "block", cursor: "zoom-in" }} />
                    : <div style={{ width: 38, height: 38, borderRadius: 7, background: "var(--ground, #eee)" }} />}
                </td>
                <td style={{ padding: "8px 8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700, minWidth: 18 }}>{i + 1}.</span>
                    {r.productUrl
                      ? <a href={r.productUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: "inherit", textDecoration: "none" }}>{r.title}</a>
                      : <span style={{ fontWeight: 600 }}>{r.title}</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginLeft: 24 }}>
                    {r.baseSku != null && <span>Base #{r.baseSku}</span>}
                    {r.baseSku != null && r.listingId && <span> · </span>}
                    {r.listingId && <span>listing {r.listingId}</span>}
                  </div>
                </td>
                <td style={{ padding: "8px 8px", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{r.orders}</td>
                <td style={{ padding: "8px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.qty}</td>
                {showMoney && <td style={{ padding: "8px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(r.revenue)}</td>}
                <td style={{ padding: "8px 8px" }}>
                  <span style={{ display: "inline-flex", gap: 4 }}>
                    {r.platforms.map((p) => (
                      <span key={p} style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", color: "#fff", background: PLAT_COLOR[p] ?? PLAT_COLOR.other, padding: "2px 6px", borderRadius: 5 }}>{p}</span>
                    ))}
                  </span>
                </td>
                <td style={{ padding: "8px 8px", color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtDate(r.lastOrder)}</td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr><td colSpan={showMoney ? 7 : 6} style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>No listing matches.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {loading && <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, marginTop: 10 }}>Loading…</div>}

      {zoom && (
        <div onClick={() => setZoom(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,17,20,.78)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, cursor: "zoom-out" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: "min(90vw, 640px)", maxHeight: "90vh", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <img src={zoom.src} alt={zoom.title} style={{ maxWidth: "100%", maxHeight: "82vh", objectFit: "contain", borderRadius: 12, boxShadow: "0 10px 40px rgba(0,0,0,.5)" }} />
            <div style={{ color: "#fff", fontSize: 13, textAlign: "center", maxWidth: 560, lineHeight: 1.4 }}>{zoom.title}</div>
          </div>
          <button onClick={() => setZoom(null)} aria-label="Close"
            style={{ position: "fixed", top: 18, right: 22, width: 38, height: 38, borderRadius: 999, border: 0, background: "rgba(255,255,255,.16)", color: "#fff", fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>
      )}
    </div>
  );
}
