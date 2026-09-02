"use client";
import { useEffect, useMemo, useState } from "react";
import { useConfirm } from "@/components/confirm-provider";
import ThumbZoom from "@/components/thumb-zoom";
import TiktokEditModal from "./edit-modal";

type Row = {
  id: string; storeId: string; tiktokProductId: string; title: string | null; status: string | null;
  mainImageUrl: string | null; categoryName: string | null; sellerSku: string | null;
  priceMin: string | null; ttUpdateTime: string | null; orders?: number;
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
  void isAdmin;
  const [rows, setRows] = useState<Row[]>(initial);
  const [kw, setKw] = useState("");
  const [shop, setShop] = useState("");
  const [seller, setSeller] = useState("");
  const [status, setStatus] = useState("ACTIVATE"); // mặc định chỉ hiện listing đang bán
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState("");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState("");
  const [sortOrders, setSortOrders] = useState(false); // sắp xếp theo số đơn cao → thấp
  const [modal, setModal] = useState<{ id: string; mode: "edit" | "clone" } | null>(null);
  const confirm = useConfirm();

  const storeName = useMemo(() => new Map(stores.map((s) => [s.id, s.name])), [stores]);
  const storeSeller = useMemo(() => new Map(stores.map((s) => [s.id, s.sellerId])), [stores]);
  const sellerName = useMemo(() => new Map(sellers.map((s) => [s.id, s.name])), [sellers]);
  // Chọn seller → chỉ hiện shop của seller đó trong dropdown Shop.
  const shopOptions = useMemo(() => (seller ? stores.filter((s) => s.sellerId === seller) : stores), [stores, seller]);

  const filtered = useMemo(() => {
    const list = rows.filter((r) => {
      if (seller && storeSeller.get(r.storeId) !== seller) return false;
      if (shop && r.storeId !== shop) return false;
      if (status !== "ALL" && r.status !== status) return false;
      if (kw) {
        const q = kw.toLowerCase();
        if (!(r.title?.toLowerCase().includes(q) || r.tiktokProductId.includes(q) || r.sellerSku?.toLowerCase().includes(q))) return false;
      }
      return true;
    });
    if (sortOrders) list.sort((a, b) => (b.orders ?? 0) - (a.orders ?? 0));
    return list;
  }, [rows, kw, shop, seller, status, storeSeller, sortOrders]);

  // Phân trang 20/trang; reset về trang 1 khi đổi filter/sort.
  useEffect(() => { setPage(1); }, [kw, shop, seller, status, sortOrders]);
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

  // Refetch danh sách (sau khi save/clone/lifecycle) — giữ nguyên filter hiện tại.
  const reload = async () => {
    try {
      const r = await fetch("/api/tiktok/products/list").then((x) => x.json());
      if (r?.ok) setRows(r.rows);
    } catch { /* bỏ qua */ }
  };

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

  // Activate / Deactivate / Delete listing trực tiếp trên TikTok.
  const lifecycle = async (r: Row, action: "activate" | "deactivate" | "delete") => {
    const name = r.title || r.tiktokProductId;
    if (action === "delete") {
      const ok = await confirm({ message: `Delete "${name}" from TikTok Shop? This can't be undone.`, danger: true });
      if (!ok) return;
    } else if (action === "deactivate") {
      const ok = await confirm({ message: `Deactivate "${name}"? It will be removed from sale but you can activate it again later.` });
      if (!ok) return;
    }
    setBusyId(r.id); setMsg(`${action === "activate" ? "Activating" : action === "deactivate" ? "Deactivating" : "Deleting"} "${name}"…`);
    try {
      const j = await fetch(`/api/tiktok/products/${r.id}/lifecycle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }).then((x) => x.json());
      if (j.ok) {
        if (action === "delete") { setRows((prev) => prev.filter((x) => x.id !== r.id)); setMsg(`✓ Deleted "${name}"`); }
        else { const st = action === "activate" ? "ACTIVATE" : "SELLER_DEACTIVATED"; setRows((prev) => prev.map((x) => x.id === r.id ? { ...x, status: st } : x)); setMsg(`✓ ${action === "activate" ? "Activated" : "Deactivated"} "${name}"`); }
      } else setMsg("✗ " + (j.error ?? `${action} failed`));
    } catch (e) { setMsg("✗ " + String((e as Error)?.message ?? e)); }
    setBusyId("");
  };

  const th: React.CSSProperties = { padding: "10px 8px" };

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
              <th style={th}>Image</th>
              <th style={th}>Title</th>
              <th style={th}>Store / Seller</th>
              <th style={th}>Category</th>
              <th onClick={() => setSortOrders((v) => !v)} title="Số đơn đã bán · bấm để sắp xếp cao → thấp" style={{ ...th, textAlign: "right", width: 66, cursor: "pointer", userSelect: "none", color: sortOrders ? "#2952B3" : undefined }}>Orders{sortOrders ? " ↓" : " ⇅"}</th>
              <th style={{ ...th, textAlign: "right" }}>Price</th>
              <th style={th}>Status</th>
              <th style={th}>Updated</th>
              {canManage && <th style={th}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => {
              const sc = statusColor(r.status);
              const sName = sellerName.get(storeSeller.get(r.storeId) ?? "") ?? null;
              return (
                <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "8px 8px" }}>
                    <ThumbZoom src={r.mainImageUrl || thumbs[r.id]} alt={r.title || ""} size={44} radius={7} />
                  </td>
                  <td style={{ padding: "8px 8px", maxWidth: 400 }}>
                    <div
                      onClick={() => canManage && setModal({ id: r.id, mode: "edit" })}
                      title={canManage ? "Click to edit" : undefined}
                      style={{ fontWeight: 600, lineHeight: 1.3, cursor: canManage ? "pointer" : "default", color: canManage ? "var(--blue)" : "inherit" }}>
                      {(r.title || "(no title)").slice(0, 90)}
                    </div>
                    <div
                      onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(r.tiktokProductId); }}
                      title="Click to copy product ID"
                      style={{ color: "var(--muted)", fontSize: 11.5, cursor: "copy" }}>
                      ID: {r.tiktokProductId}{r.sellerSku ? ` · SKU: ${r.sellerSku}` : ""}
                    </div>
                  </td>
                  <td style={{ padding: "8px 8px" }}>
                    <div>{storeName.get(r.storeId) ?? "—"}</div>
                    {sName && <div style={{ color: "var(--muted)", fontSize: 11.5 }}>{sName}</div>}
                  </td>
                  <td style={{ padding: "8px 8px", color: "var(--muted)" }}>{r.categoryName ?? "—"}</td>
                  <td style={{ padding: "8px 8px", textAlign: "right", fontWeight: (r.orders ?? 0) > 0 ? 700 : 400, color: (r.orders ?? 0) > 0 ? "var(--ink)" : "var(--muted)" }}>{r.orders ?? 0}</td>
                  <td style={{ padding: "8px 8px", textAlign: "right" }}>{r.priceMin ? `$${Number(r.priceMin).toFixed(2)}` : "—"}</td>
                  <td style={{ padding: "8px 8px" }}>
                    <span style={{ background: sc.bg, color: sc.fg, fontWeight: 700, fontSize: 11, borderRadius: 6, padding: "2px 8px" }}>{r.status ?? "—"}</span>
                  </td>
                  <td style={{ padding: "8px 8px", color: "var(--muted)", fontSize: 12 }}>{r.ttUpdateTime ? new Date(r.ttUpdateTime).toLocaleDateString() : "—"}</td>
                  {canManage && (() => {
                    const deactivated = r.status?.includes("DEACTIVATED");
                    const busy = busyId === r.id;
                    const linkBtn = (color: string) => ({ fontSize: 12, fontWeight: 700, color, background: "none", border: 0, padding: 0, cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 } as const);
                    return (
                    <td style={{ padding: "8px 8px", whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <button type="button" onClick={() => setModal({ id: r.id, mode: "clone" })} style={linkBtn("#1E8E4E")}>Duplicate</button>
                        {deactivated
                          ? <button type="button" disabled={busy} onClick={() => lifecycle(r, "activate")} style={linkBtn("#1E8E4E")}>Activate</button>
                          : <button type="button" disabled={busy} onClick={() => lifecycle(r, "deactivate")} style={linkBtn("#B7791F")}>Deactivate</button>}
                        <button type="button" disabled={busy} onClick={() => lifecycle(r, "delete")} style={linkBtn("#C0392B")}>Delete</button>
                      </div>
                    </td>
                    );
                  })()}
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

      {canManage && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>Bấm vào tiêu đề để mở Card Detail (sửa & cập nhật thẳng lên TikTok) · Duplicate = nhân bản trong cùng shop (mặc định draft) · Deactivate = ngừng bán (bật lại được) · Delete = xoá listing trên TikTok (vĩnh viễn).</div>}

      {modal && canManage && (
        <TiktokEditModal
          id={modal.id}
          mode={modal.mode}
          onClose={() => setModal(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
