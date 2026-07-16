"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Row = {
  id: string; storeId: string; tiktokProductId: string; title: string | null; status: string | null;
  mainImageUrl: string | null; categoryName: string | null; sellerSku: string | null;
  priceMin: string | null; ttUpdateTime: string | null;
};
type Store = { id: string; name: string; sellerId: string | null };
type Seller = { id: string; name: string | null };

const PAGE_SIZE = 20;

const STATUSES = ["ALL", "ACTIVATE", "DRAFT", "PENDING", "FAILED", "SELLER_DEACTIVATED", "PLATFORM_DEACTIVATED", "FREEZE", "DELETED"];
const statusColor = (s: string | null) => {
  if (s === "ACTIVATE") return { bg: "#E7F6EC", fg: "#1E8E4E" };
  if (s === "DRAFT" || s === "PENDING") return { bg: "#FFF6E5", fg: "#B7791F" };
  if (s === "FAILED" || s?.includes("DEACTIVATED") || s === "DELETED" || s === "FREEZE") return { bg: "#FDECEC", fg: "#C0392B" };
  return { bg: "#EEF1F5", fg: "#5B6472" };
};

export default function TiktokProductsClient({ stores, sellers = [], initial, isAdmin, canManage = false }: { stores: Store[]; sellers?: Seller[]; initial: Row[]; isAdmin: boolean; canManage?: boolean }) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [kw, setKw] = useState("");
  const [shop, setShop] = useState("");
  const [seller, setSeller] = useState("");
  const [status, setStatus] = useState("ACTIVATE"); // mặc định chỉ hiện listing đang bán
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState("");
  const [page, setPage] = useState(1);

  const storeName = useMemo(() => new Map(stores.map((s) => [s.id, s.name])), [stores]);
  const storeSeller = useMemo(() => new Map(stores.map((s) => [s.id, s.sellerId])), [stores]);
  // Chọn seller → chỉ hiện shop của seller đó trong dropdown Shop.
  const shopOptions = useMemo(() => (seller ? stores.filter((s) => s.sellerId === seller) : stores), [stores, seller]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (seller && storeSeller.get(r.storeId) !== seller) return false;
    if (shop && r.storeId !== shop) return false;
    if (status !== "ALL" && r.status !== status) return false;
    if (kw) {
      const q = kw.toLowerCase();
      if (!(r.title?.toLowerCase().includes(q) || r.tiktokProductId.includes(q) || r.sellerSku?.toLowerCase().includes(q))) return false;
    }
    return true;
  }), [rows, kw, shop, seller, status, storeSeller]);

  // Phân trang 20/trang; reset về trang 1 khi đổi filter.
  useEffect(() => { setPage(1); }, [kw, shop, seller, status]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const paged = useMemo(() => filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE), [filtered, pageSafe]);

  // Lazy-load ảnh thumbnail cho các dòng đang xem (search list không trả ảnh) — cache client + backfill DB.
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    const need = paged.filter((r) => !r.mainImageUrl && !thumbs[r.id]).map((r) => r.id);
    if (!need.length) return;
    let alive = true;
    fetch("/api/tiktok/products/thumbnails", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: need }) })
      .then((r) => r.json()).then((j) => { if (alive && j?.ok && j.thumbs) setThumbs((p) => ({ ...p, ...j.thumbs })); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paged]);

  const sync = async () => {
    setSyncing(true); setMsg("Syncing products from TikTok…");
    try {
      const j = await fetch("/api/tiktok/products/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(shop ? { storeId: shop } : {}) }).then((r) => r.json());
      if (j.ok) {
        const total = (j.stores ?? []).reduce((t: number, s: { synced: number }) => t + (s.synced || 0), 0);
        const errs = (j.stores ?? []).filter((s: { error?: string }) => s.error).map((s: { store: string; error: string }) => `${s.store}: ${s.error}`);
        setMsg(`✓ Synced ${total} product(s)${errs.length ? " · ⚠ " + errs.join(" | ") : ""}`);
        const r = await fetch("/api/tiktok/products/list").then((x) => x.json()).catch(() => null);
        if (r?.ok) setRows(r.rows);
        else location.reload();
      } else setMsg("✗ " + (j.error ?? "Sync failed"));
    } catch (e) { setMsg("✗ " + String((e as Error)?.message ?? e)); }
    setSyncing(false);
  };

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Manage Products · TikTok Shop <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: 13 }}>({filtered.length})</span></h2>
        <button onClick={sync} disabled={syncing} style={{ background: "var(--blue)", color: "#fff", border: 0, borderRadius: 9, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: syncing ? "default" : "pointer", opacity: syncing ? 0.6 : 1 }}>
          {syncing ? "Syncing…" : "↻ Sync from TikTok"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input placeholder="Keyword (title / product id / sku)" value={kw} onChange={(e) => setKw(e.target.value)} style={{ flex: 1, minWidth: 220, padding: "8px 11px", border: "1px solid var(--line)", borderRadius: 9, fontSize: 13 }} />
        {sellers.length > 1 && (
          <select value={seller} onChange={(e) => { setSeller(e.target.value); setShop(""); }} style={{ padding: "8px 11px", border: "1px solid var(--line)", borderRadius: 9, fontSize: 13 }}>
            <option value="">All sellers</option>
            {sellers.map((s) => <option key={s.id} value={s.id}>{s.name || "—"}</option>)}
          </select>
        )}
        <select value={shop} onChange={(e) => setShop(e.target.value)} style={{ padding: "8px 11px", border: "1px solid var(--line)", borderRadius: 9, fontSize: 13 }}>
          <option value="">All shops</option>
          {shopOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: "8px 11px", border: "1px solid var(--line)", borderRadius: 9, fontSize: 13 }}>
          {STATUSES.map((s) => <option key={s} value={s}>{s === "ALL" ? "All status" : s}</option>)}
        </select>
      </div>

      {msg && <div style={{ fontSize: 12.5, marginBottom: 10, color: msg.startsWith("✗") ? "var(--red)" : "var(--muted)" }}>{msg}</div>}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11.5, textTransform: "uppercase" }}>
              <th style={{ padding: "8px 6px" }}>Image</th>
              <th style={{ padding: "8px 6px" }}>Name / ID</th>
              <th style={{ padding: "8px 6px" }}>Shop</th>
              <th style={{ padding: "8px 6px" }}>Category</th>
              <th style={{ padding: "8px 6px" }}>SKU</th>
              <th style={{ padding: "8px 6px" }}>Price</th>
              <th style={{ padding: "8px 6px" }}>Status</th>
              <th style={{ padding: "8px 6px" }}>Updated</th>
              {canManage && <th style={{ padding: "8px 6px" }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => {
              const sc = statusColor(r.status);
              return (
                <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "8px 6px" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {(r.mainImageUrl || thumbs[r.id]) ? <img src={r.mainImageUrl || thumbs[r.id]} alt="" style={{ width: 42, height: 42, objectFit: "cover", borderRadius: 7 }} /> : <div style={{ width: 42, height: 42, background: "#EEF1F5", borderRadius: 7 }} />}
                  </td>
                  <td style={{ padding: "8px 6px", maxWidth: 380 }}>
                    <div style={{ fontWeight: 600, lineHeight: 1.3 }}>{r.title || "(no title)"}</div>
                    <div style={{ color: "var(--muted)", fontSize: 11.5 }}>ID: {r.tiktokProductId}</div>
                  </td>
                  <td style={{ padding: "8px 6px" }}>{storeName.get(r.storeId) ?? "—"}</td>
                  <td style={{ padding: "8px 6px", color: "var(--muted)" }}>{r.categoryName ?? "—"}</td>
                  <td style={{ padding: "8px 6px", color: "var(--muted)" }}>{r.sellerSku ?? "—"}</td>
                  <td style={{ padding: "8px 6px" }}>{r.priceMin ? `$${Number(r.priceMin).toFixed(2)}` : "—"}</td>
                  <td style={{ padding: "8px 6px" }}>
                    <span style={{ background: sc.bg, color: sc.fg, fontWeight: 700, fontSize: 11, borderRadius: 6, padding: "2px 8px" }}>{r.status ?? "—"}</span>
                  </td>
                  <td style={{ padding: "8px 6px", color: "var(--muted)", fontSize: 12 }}>{r.ttUpdateTime ? new Date(r.ttUpdateTime).toLocaleDateString() : "—"}</td>
                  {canManage && (
                    <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>
                      <Link href={`/tiktok-products/${r.id}/edit`} prefetch={false} style={{ fontSize: 12, fontWeight: 700, color: "var(--blue)", textDecoration: "none", marginRight: 10 }}>Edit</Link>
                      <Link href={`/tiktok-products/${r.id}/edit?mode=clone`} prefetch={false} style={{ fontSize: 12, fontWeight: 700, color: "var(--green)", textDecoration: "none" }}>Duplicate</Link>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!filtered.length && <div style={{ padding: "24px 0", textAlign: "center", color: "var(--muted)" }}>No products. Click &quot;Sync from TikTok&quot; to pull them in.</div>}
      </div>

      {filtered.length > PAGE_SIZE && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
            {(pageSafe - 1) * PAGE_SIZE + 1}–{Math.min(pageSafe * PAGE_SIZE, filtered.length)} / {filtered.length}
          </span>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageSafe <= 1} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: pageSafe <= 1 ? "default" : "pointer", opacity: pageSafe <= 1 ? 0.5 : 1 }}>← Prev</button>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Page {pageSafe}/{totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={pageSafe >= totalPages} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: pageSafe >= totalPages ? "default" : "pointer", opacity: pageSafe >= totalPages ? 0.5 : 1 }}>Next →</button>
          </div>
        </div>
      )}

      {canManage && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>Edit = update live on TikTok · Duplicate = clone within the same shop (defaults to draft). You can edit title/description/images/price/stock/packaging; category/attributes editing comes next.</div>}
    </div>
  );
}
