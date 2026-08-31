"use client";
import { useEffect, useMemo, useState } from "react";
import { ShopbaseLogo } from "@/components/shopbase-logo";

type Store = { id: string; name: string; sellerId: string | null; sellerName: string | null };
type Seller = { id: string; name: string };
type Row = {
  id: string; storeId: string; storeName: string; sellerId: string | null; sellerName: string;
  shopbaseProductId: string; handle: string; title: string; productType: string; tags: string;
  status: string; onlineStoreUrl: string | null; totalInventory: number | null;
  dirty: boolean; variantCount: number; imageCount: number;
  priceMin: number | null; priceMax: number | null; skuDone: number; skuTotal: number;
  thumb: string | null; syncedAt: string | null; updatedAt: string | null;
};

const SB_BLUE = "#2F6BFF";
const inp: React.CSSProperties = { padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "#fff", fontSize: 13, width: "100%", boxSizing: "border-box" };
const money = (n: number) => "$" + (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ShopbaseProductsClient({ stores, sellers, canEdit }: { stores: Store[]; sellers: Seller[]; canEdit: boolean; isAdmin: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [syncStore, setSyncStore] = useState(stores[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [fStore, setFStore] = useState("");
  const [fSeller, setFSeller] = useState("");
  const [fType, setFType] = useState("");
  const [fStatus, setFStatus] = useState("");

  const flash = (text: string, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 6000); };
  const load = async () => {
    setLoading(true);
    try { const j = await fetch("/api/shopbase-products").then((r) => r.json()); if (j.ok) setRows(j.rows); else flash("✗ " + (j.error ?? "load failed"), false); }
    catch { flash("✗ Network error", false); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const doSync = async () => {
    if (!syncStore) { flash("✗ Chọn store ShopBase trước", false); return; }
    setSyncing(true);
    try {
      const j = await fetch("/api/shopbase-products/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId: syncStore }) }).then((r) => r.json());
      if (j.ok) { flash(`✓ Synced ${j.fetched ?? 0} · ${j.created ?? 0} new · ${j.updated ?? 0} updated`); await load(); }
      else flash("✗ " + (j.error ?? "sync failed"), false);
    } catch { flash("✗ Network error", false); }
    setSyncing(false);
  };

  const types = useMemo(() => Array.from(new Set(rows.map((r) => r.productType).filter(Boolean))).sort(), [rows]);
  const filtered = useMemo(() => rows.filter((r) => {
    if (fStore && r.storeId !== fStore) return false;
    if (fSeller && r.sellerId !== fSeller) return false;
    if (fType && r.productType !== fType) return false;
    if (fStatus && r.status !== fStatus) return false;
    if (q.trim()) { const s = q.trim().toLowerCase(); if (!(r.title.toLowerCase().includes(s) || r.handle.toLowerCase().includes(s) || r.shopbaseProductId.includes(s))) return false; }
    return true;
  }), [rows, fStore, fSeller, fType, fStatus, q]);

  const statusChip = (s: string) => {
    const m: Record<string, [string, string]> = { ACTIVE: ["#E7F6EC", "#217A3B"], DRAFT: ["#FFF4E5", "#9A6400"], ARCHIVED: ["#EEF0F4", "#5A6474"] };
    const [bg, fg] = m[s] ?? m.DRAFT;
    return <span style={{ background: bg, color: fg, borderRadius: 999, padding: "2px 9px", fontSize: 11, fontWeight: 800 }}>{s}</span>;
  };
  const price = (r: Row) => r.priceMin == null ? "—" : r.priceMin === r.priceMax ? money(r.priceMin) : `${money(r.priceMin)}–${money(r.priceMax!)}`;

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 4px" }}>
      {/* Hero — tone xanh ShopBase */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, background: "linear-gradient(90deg, #EEF3FF, #F7FAFF)", border: "1px solid #CBD9FF", borderRadius: 16, padding: "16px 20px", marginBottom: 16 }}>
        <ShopbaseLogo s={34} />
        <div style={{ fontSize: 20, fontWeight: 900, color: "#14213D" }}>Manage Products · <span style={{ color: SB_BLUE }}>ShopBase</span></div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select value={syncStore} onChange={(e) => setSyncStore(e.target.value)} style={{ ...inp, width: "auto", minWidth: 150 }}>
            {stores.length === 0 && <option value="">No ShopBase store</option>}
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {canEdit && (
            <button onClick={doSync} disabled={syncing || !syncStore} style={{ background: SB_BLUE, color: "#fff", border: 0, borderRadius: 11, padding: "10px 18px", fontWeight: 800, fontSize: 13.5, cursor: syncing || !syncStore ? "default" : "pointer", opacity: syncing || !syncStore ? 0.6 : 1, whiteSpace: "nowrap" }}>
              {syncing ? "Syncing…" : "⟳ Sync from ShopBase"}
            </button>
          )}
        </div>
      </div>

      {msg && <div style={{ fontSize: 13, padding: "9px 13px", borderRadius: 10, marginBottom: 12, background: msg.ok ? "var(--green-soft)" : "var(--red-soft)", color: msg.ok ? "#217A3B" : "var(--red)", fontWeight: 600 }}>{msg.text}</div>}

      {/* Filters */}
      <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title / handle / ID" style={{ ...inp, marginBottom: 10 }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <select value={fStore} onChange={(e) => setFStore(e.target.value)} style={inp}><option value="">All stores</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select value={fSeller} onChange={(e) => setFSeller(e.target.value)} style={inp}><option value="">All sellers</option>{sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select value={fType} onChange={(e) => setFType(e.target.value)} style={inp}><option value="">All types</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={inp}><option value="">All status</option><option value="ACTIVE">Active</option><option value="DRAFT">Draft</option><option value="ARCHIVED">Archived</option></select>
        </div>
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", margin: "0 4px 10px" }}>{filtered.length} products{loading ? " · loading…" : ""}</div>

      {/* Table */}
      <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 820 }}>
            <thead>
              <tr style={{ background: "#F7F9FC", textAlign: "left", color: "var(--muted)", fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".4px" }}>
                <th style={{ padding: "10px 12px" }}>Image</th>
                <th style={{ padding: "10px 12px" }}>Title</th>
                <th style={{ padding: "10px 12px" }}>Store / Seller</th>
                <th style={{ padding: "10px 12px" }}>Type</th>
                <th style={{ padding: "10px 12px" }}>Price</th>
                <th style={{ padding: "10px 12px" }}>Status</th>
                <th style={{ padding: "10px 12px" }}>Link</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "10px 12px" }}>
                    {r.thumb
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={r.thumb} alt="" width={46} height={46} style={{ width: 46, height: 46, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} />
                      : <div style={{ width: 46, height: 46, borderRadius: 8, background: "#EEF0F4" }} />}
                  </td>
                  <td style={{ padding: "10px 12px", maxWidth: 340 }}>
                    <div style={{ fontWeight: 700, color: "#14213D", lineHeight: 1.35 }}>{r.title}{r.dirty && <span style={{ marginLeft: 6, fontSize: 10, background: "#FFF4E5", color: "#9A6400", borderRadius: 4, padding: "1px 5px", fontWeight: 800 }}>EDITED</span>}</div>
                    <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{r.variantCount} variants · {r.imageCount} images · SKU {r.skuDone}/{r.skuTotal}{r.totalInventory != null ? ` · inv ${r.totalInventory}` : ""}</div>
                    <div style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "monospace", marginTop: 1 }}>#{r.shopbaseProductId}</div>
                  </td>
                  <td style={{ padding: "10px 12px" }}><div style={{ fontWeight: 600 }}>{r.storeName}</div><div style={{ fontSize: 12, color: "var(--muted)" }}>{r.sellerName}</div></td>
                  <td style={{ padding: "10px 12px", color: "var(--muted)" }}>{r.productType || "—"}</td>
                  <td style={{ padding: "10px 12px", fontWeight: 700, whiteSpace: "nowrap" }}>{price(r)}</td>
                  <td style={{ padding: "10px 12px" }}>{statusChip(r.status)}</td>
                  <td style={{ padding: "10px 12px" }}>{r.onlineStoreUrl ? <a href={r.onlineStoreUrl} target="_blank" rel="noreferrer" style={{ color: SB_BLUE, fontWeight: 700, textDecoration: "none" }}>Open ↗</a> : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} style={{ padding: "40px 12px", textAlign: "center", color: "var(--muted)" }}>
                  {rows.length === 0 ? "Chưa có sản phẩm — chọn store rồi bấm “Sync from ShopBase”." : "Không có sản phẩm khớp bộ lọc."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
