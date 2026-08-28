"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ThumbZoom from "@/components/thumb-zoom";

type Row = {
  listingKey: string; title: string; listingId: string | null; productUrl: string | null;
  image: string | null; orders: number; qty: number; revenue: number | null;
  lastOrder: string | null; platforms: string[]; baseSku: number | null;
};
type StoreOpt = { id: string; name: string; sellerId: string | null; platform: string | null };
type SellerOpt = { id: string; name: string | null };

const RANGES = [
  { k: "30", label: "30 days" }, { k: "90", label: "90 days" }, { k: "365", label: "1 year" }, { k: "1096", label: "All time" },
];
const SORTS = [
  { k: "orders", label: "Most orders" }, { k: "qty", label: "Most units" }, { k: "revenue", label: "Top revenue" }, { k: "recent", label: "Recently sold" },
];
const PLAT_COLOR: Record<string, string> = { etsy: "#F1641E", shopify: "#5E8E3E", amazon: "#FF9900", tiktok: "#010101", other: "#66788E" };
const money = (n: number | null) => (n == null ? "" : "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString() : "—");

const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,.04)" };
const ctl: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 12, padding: "10px 13px", fontSize: 13.5, font: "inherit", background: "#fff", outline: "none" };
const IcSearch = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>;

const PER_PAGE = 20;

export function ProductSalesClient({ stores = [], sellers = [], canPickSeller = false }: { stores?: StoreOpt[]; sellers?: SellerOpt[]; canPickSeller?: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [showMoney, setShowMoney] = useState(false);
  const [q, setQ] = useState("");
  const [days, setDays] = useState("365");
  const [sort, setSort] = useState("orders");
  const [plat, setPlat] = useState("");
  const [seller, setSeller] = useState("");
  const [store, setStore] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const seq = useRef(0);

  const storeOptions = useMemo(() => (seller ? stores.filter((s) => s.sellerId === seller) : stores), [stores, seller]);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true); setErr("");
    try {
      const p = new URLSearchParams({ days, sort, limit: String(PER_PAGE), offset: String(page * PER_PAGE) });
      if (q.trim()) p.set("q", q.trim());
      if (plat) p.set("platform", plat);
      if (seller) p.set("seller", seller);
      if (store) p.set("store", store);
      const res = await fetch(`/api/stats/product-sales?${p}`);
      const j = await res.json();
      if (my !== seq.current) return;
      if (!j?.ok) throw new Error(j?.error || "error");
      setRows(j.rows); setTotal(j.total); setShowMoney(!!j.showMoney);
    } catch (e) {
      if (my === seq.current) setErr(String((e as Error)?.message ?? e));
    } finally { if (my === seq.current) setLoading(false); }
  }, [q, days, sort, plat, seller, store, page]);

  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);
  useEffect(() => { setPage(0); }, [q, days, sort, plat, seller, store]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const th: React.CSSProperties = { padding: "12px 10px", textAlign: "left" };
  const td: React.CSSProperties = { padding: "10px", borderTop: "1px solid var(--line)", verticalAlign: "middle" };

  return (
    <div style={{ padding: "20px 22px 60px", maxWidth: 1280, margin: "0 auto" }}>
      {/* HERO HEADER */}
      <div style={{ ...card, padding: "18px 22px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: "#F5F7FB", border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "var(--blue)" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="21" x2="21" y2="21" /><rect x="5" y="11" width="3.5" height="7" /><rect x="10.25" y="7" width="3.5" height="11" /><rect x="15.5" y="4" width="3.5" height="14" /></svg>
          </div>
          <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0 }}>Product Sales · by Listing</h1>
        </div>
      </div>

      {/* FILTER BAR */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <div style={{ position: "relative", flex: 1, minWidth: 240, maxWidth: 440 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }}><IcSearch /></span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search listing / listing_id" style={{ ...ctl, width: "100%", paddingLeft: 34 }} />
        </div>
        <select value={days} onChange={(e) => setDays(e.target.value)} style={ctl}>
          {RANGES.map((r) => <option key={r.k} value={r.k}>{r.label}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={ctl}>
          {SORTS.map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}
        </select>
        <select value={plat} onChange={(e) => setPlat(e.target.value)} style={ctl}>
          <option value="">All channels</option>
          <option value="etsy">Etsy</option>
          <option value="shopify">Shopify</option>
          <option value="amazon">Amazon</option>
          <option value="tiktok">TikTok</option>
        </select>
        {canPickSeller && (
          <select value={seller} onChange={(e) => { setSeller(e.target.value); setStore(""); }} style={ctl}>
            <option value="">All sellers</option>
            {sellers.map((s) => <option key={s.id} value={s.id}>{s.name || "—"}</option>)}
          </select>
        )}
        {stores.length > 0 && (
          <select value={store} onChange={(e) => setStore(e.target.value)} style={ctl}>
            <option value="">All stores</option>
            {storeOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>{total.toLocaleString()} listings</span>
      </div>

      {err && <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 12, background: "#FDECEC", color: "#C0392B", border: "1px solid #F5CFCF" }}>✗ {err}</div>}

      {/* TABLE */}
      <div style={{ ...card, overflow: "hidden", padding: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 760 }}>
            <thead>
              <tr style={{ color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: .3, background: "#FAFBFD" }}>
                <th style={{ ...th, width: 40, textAlign: "center" }}>#</th>
                <th style={{ ...th, width: 60 }}>Image</th>
                <th style={th}>Listing</th>
                <th style={{ ...th, textAlign: "right" }}>Orders</th>
                <th style={{ ...th, textAlign: "right" }}>Units</th>
                {showMoney && <th style={{ ...th, textAlign: "right" }}>Revenue</th>}
                <th style={th}>Channel</th>
                <th style={th}>Last sale</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={showMoney ? 8 : 7} style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>Loading…</td></tr>}
              {!loading && !rows.length && (
                <tr><td colSpan={showMoney ? 8 : 7} style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>No listing matches your filters.</td></tr>
              )}
              {!loading && rows.map((r, i) => (
                <tr key={r.listingKey} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ ...td, textAlign: "center", color: "var(--muted)", fontWeight: 700 }}>{page * PER_PAGE + i + 1}</td>
                  <td style={{ ...td, padding: "8px 10px" }}>
                    <ThumbZoom src={r.image ?? undefined} alt={r.title} size={46} radius={10} />
                  </td>
                  <td style={{ ...td, maxWidth: 460 }}>
                    {r.productUrl
                      ? <a href={r.productUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: "var(--blue)", textDecoration: "none", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{r.title}</a>
                      : <span style={{ fontWeight: 600, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{r.title}</span>}
                    <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "ui-monospace,monospace", marginTop: 3 }}>
                      {r.baseSku != null && <span>Base #{r.baseSku}</span>}
                      {r.baseSku != null && r.listingId && <span>&nbsp;·&nbsp;</span>}
                      {r.listingId && <span>listing {r.listingId}</span>}
                    </div>
                  </td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{r.orders}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.qty}</td>
                  {showMoney && <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(r.revenue)}</td>}
                  <td style={td}>
                    <span style={{ display: "inline-flex", gap: 4 }}>
                      {r.platforms.map((p) => (
                        <span key={p} style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", color: "#fff", background: PLAT_COLOR[p] ?? PLAT_COLOR.other, padding: "2px 7px", borderRadius: 6 }}>{p}</span>
                      ))}
                    </span>
                  </td>
                  <td style={{ ...td, color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtDate(r.lastOrder)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* PAGINATION */}
      {total > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
            {(page * PER_PAGE + 1).toLocaleString()}–{Math.min((page + 1) * PER_PAGE, total).toLocaleString()} of {total.toLocaleString()}
          </span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0 || loading}
              style={{ ...ctl, cursor: page === 0 ? "default" : "pointer", opacity: page === 0 ? 0.5 : 1 }}>← Prev</button>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Page {page + 1} / {totalPages}</span>
            <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) >= totalPages || loading}
              style={{ ...ctl, cursor: (page + 1) >= totalPages ? "default" : "pointer", opacity: (page + 1) >= totalPages ? 0.5 : 1 }}>Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}
