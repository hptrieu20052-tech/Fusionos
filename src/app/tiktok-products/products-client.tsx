"use client";
import { useEffect, useMemo, useState } from "react";
import { useConfirm } from "@/components/confirm-provider";
import ThumbZoom from "@/components/thumb-zoom";
import { MarketplaceLogo } from "@/components/marketplace-logo";
import { Pager } from "@/components/pager";
import TiktokEditModal from "./edit-modal";

const TT_PINK = "#FE2C55"; // tone chủ đạo TikTok
const inp: React.CSSProperties = { padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "#fff", fontSize: 13, width: "100%", boxSizing: "border-box" };

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

export default function TiktokProductsClient({ stores, sellers = [], initial, isAdmin, canManage = false, shopbaseStores = [] }: { stores: Store[]; sellers?: Seller[]; initial: Row[]; isAdmin: boolean; canManage?: boolean; shopbaseStores?: { id: string; name: string }[] }) {
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

  // v405 · Push to ShopBase — chọn listing (checkbox) → stage bản nháp sang Manage Products · ShopBase.
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pushSbOpen, setPushSbOpen] = useState(false);
  const [pushSbStore, setPushSbStore] = useState(shopbaseStores[0]?.id ?? "");
  const [pushSbTemplate, setPushSbTemplate] = useState("");
  const [sbTemplates, setSbTemplates] = useState<{ id: string; name: string; productType?: string | null }[]>([]);
  const [pushing, setPushing] = useState(false);
  useEffect(() => {
    if (!pushSbStore) { setSbTemplates([]); return; }
    fetch(`/api/shopbase-templates?storeId=${pushSbStore}`).then((r) => r.json())
      .then((j) => { const t = j.ok ? j.templates : []; setSbTemplates(t); setPushSbTemplate((cur) => t.some((x: { id: string }) => x.id === cur) ? cur : (t.length === 1 ? t[0].id : "")); })
      .catch(() => setSbTemplates([]));
  }, [pushSbStore]);
  const toggleSel = (id: string) => setSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const doPushShopbase = async () => {
    if (!sel.size || !pushSbStore || !pushSbTemplate) return;
    setPushSbOpen(false); setPushing(true); setMsg("Staging to ShopBase…");
    try {
      const j = await fetch("/api/shopbase-products/stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "tiktok", ids: Array.from(sel), storeId: pushSbStore, templateId: pushSbTemplate }) }).then((r) => r.json());
      if (j.ok || j.created) {
        const fail = (j.results ?? []).filter((r: { ok: boolean }) => !r.ok);
        setMsg(`✓ Staged ${j.created}/${(j.results ?? []).length} for ${j.store} — finish them in Manage Products · ShopBase, then Push${j.failed ? ` · ${j.failed} failed: ${fail[0]?.error ?? ""}` : ""}`);
        setSel(new Set());
      } else {
        const first = (j.results ?? [])[0];
        setMsg("✗ " + (j.error ?? first?.error ?? "Push failed"));
      }
    } catch (e) { setMsg("✗ " + String((e as Error)?.message ?? e)); }
    setPushing(false);
  };

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

  const th: React.CSSProperties = { padding: "10px 12px" };

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 4px" }}>
      {/* Hero — tone TikTok (đồng bộ layout với Shopify/ShopBase) */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, background: "linear-gradient(90deg, #FFF1F4, #F1FEFF)", border: "1px solid #FFD3DC", borderRadius: 16, padding: "16px 20px", marginBottom: 16, flexWrap: "wrap" }}>
        <MarketplaceLogo mk="tiktok" size={34} />
        <div style={{ fontSize: 20, fontWeight: 900, color: "#14213D" }}>Manage Products · <span style={{ color: TT_PINK }}>TikTok Shop</span> <span style={{ color: "var(--muted)", fontWeight: 600, fontSize: 14 }}>({filtered.length})</span></div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={sync} disabled={syncing} style={{ background: TT_PINK, color: "#fff", border: 0, borderRadius: 11, padding: "10px 18px", fontWeight: 800, fontSize: 13.5, cursor: syncing ? "default" : "pointer", opacity: syncing ? 0.6 : 1, whiteSpace: "nowrap" }}>
            {syncing ? "Syncing…" : "↻ Sync from TikTok"}
          </button>
        </div>
      </div>

      {msg && <div style={{ fontSize: 13, padding: "9px 13px", borderRadius: 10, marginBottom: 12, background: msg.startsWith("✗") ? "var(--red-soft)" : "#F3F6FB", color: msg.startsWith("✗") ? "var(--red)" : "var(--muted)", fontWeight: 600 }}>{msg}</div>}

      {/* Filters card */}
      <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <input placeholder="Search title / product id / sku" value={kw} onChange={(e) => setKw(e.target.value)} style={{ ...inp, marginBottom: 10 }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          {sellers.length > 1 && (
            <select value={seller} onChange={(e) => { setSeller(e.target.value); setShop(""); }} style={inp}>
              <option value="">All sellers</option>
              {sellers.map((s) => <option key={s.id} value={s.id}>{s.name || "—"}</option>)}
            </select>
          )}
          <select value={shop} onChange={(e) => setShop(e.target.value)} style={inp}>
            <option value="">All shops</option>
            {shopOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={inp}>
            {STATUSES.map((s) => <option key={s} value={s}>{s === "ALL" ? "All status" : s}</option>)}
          </select>
        </div>
      </div>

      {canManage && shopbaseStores.length > 0 && sel.size > 0 && (
        <div style={{ background: "#EEF3FF", border: "1px solid #CBD9FF", borderRadius: 12, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 800, fontSize: 13.5, color: "#14213D" }}>{sel.size} selected</span>
          <button onClick={() => setPushSbOpen(true)} disabled={pushing} style={{ background: "#2F6BFF", color: "#fff", border: 0, borderRadius: 10, padding: "8px 16px", fontWeight: 800, fontSize: 13, cursor: pushing ? "default" : "pointer", opacity: pushing ? 0.6 : 1 }}>
            {pushing ? "Staging…" : "▲ Push to ShopBase"}
          </button>
          <button onClick={() => setSel(new Set())} style={{ background: "none", border: 0, color: "var(--muted)", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Clear</button>
        </div>
      )}

      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", margin: "0 4px 10px" }}>{filtered.length} products</div>

      {/* Table card */}
      <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 900 }}>
            <thead>
              <tr style={{ background: "#F7F9FC", textAlign: "left", color: "var(--muted)", fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".4px" }}>
                {canManage && shopbaseStores.length > 0 && (
                  <th style={{ ...th, width: 34 }}>
                    <input type="checkbox"
                      checked={paged.length > 0 && paged.every((r) => sel.has(r.id))}
                      onChange={() => setSel((prev) => {
                        const n = new Set(prev);
                        const all = paged.every((r) => n.has(r.id));
                        paged.forEach((r) => { if (all) n.delete(r.id); else n.add(r.id); });
                        return n;
                      })}
                      style={{ cursor: "pointer", width: 16, height: 16 }} />
                  </th>
                )}
                <th style={th}>Image</th>
                <th style={th}>Title</th>
                <th style={th}>Store / Seller</th>
                <th style={th}>Category</th>
                <th onClick={() => setSortOrders((v) => !v)} title="Số đơn đã bán · bấm để sắp xếp cao → thấp" style={{ ...th, textAlign: "right", width: 66, cursor: "pointer", userSelect: "none", color: sortOrders ? TT_PINK : undefined }}>Orders{sortOrders ? " ↓" : " ⇅"}</th>
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
                  <tr key={r.id} style={{ borderTop: "1px solid var(--line)", background: sel.has(r.id) ? "#F3F7FF" : undefined }}>
                    {canManage && shopbaseStores.length > 0 && (
                      <td style={{ padding: "10px 12px" }}>
                        <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggleSel(r.id)} style={{ cursor: "pointer", width: 16, height: 16 }} />
                      </td>
                    )}
                    <td style={{ padding: "10px 12px" }}>
                      <ThumbZoom src={r.mainImageUrl || thumbs[r.id]} alt={r.title || ""} size={46} radius={8} />
                    </td>
                    <td style={{ padding: "10px 12px", maxWidth: 400 }}>
                      <div
                        onClick={() => canManage && setModal({ id: r.id, mode: "edit" })}
                        title={canManage ? "Click to edit" : undefined}
                        style={{ fontWeight: 700, lineHeight: 1.35, cursor: canManage ? "pointer" : "default", color: canManage ? TT_PINK : "#14213D" }}>
                        {(r.title || "(no title)").slice(0, 90)}
                      </div>
                      <div
                        onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(r.tiktokProductId); }}
                        title="Click to copy product ID"
                        style={{ color: "var(--muted)", fontSize: 11.5, cursor: "copy", marginTop: 2 }}>
                        ID: {r.tiktokProductId}{r.sellerSku ? ` · SKU: ${r.sellerSku}` : ""}
                      </div>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ fontWeight: 600 }}>{storeName.get(r.storeId) ?? "—"}</div>
                      {sName && <div style={{ color: "var(--muted)", fontSize: 12 }}>{sName}</div>}
                    </td>
                    <td style={{ padding: "10px 12px", color: "var(--muted)" }}>{r.categoryName ?? "—"}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: (r.orders ?? 0) > 0 ? 800 : 400, color: (r.orders ?? 0) > 0 ? "#14213D" : "var(--muted)" }}>{r.orders ?? 0}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{r.priceMin ? `$${Number(r.priceMin).toFixed(2)}` : "—"}</td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{ background: sc.bg, color: sc.fg, fontWeight: 700, fontSize: 11, borderRadius: 6, padding: "2px 8px" }}>{r.status ?? "—"}</span>
                    </td>
                    <td style={{ padding: "10px 12px", color: "var(--muted)", fontSize: 12 }}>{r.ttUpdateTime ? new Date(r.ttUpdateTime).toLocaleDateString() : "—"}</td>
                    {canManage && (() => {
                      const deactivated = r.status?.includes("DEACTIVATED");
                      const busy = busyId === r.id;
                      const linkBtn = (color: string) => ({ fontSize: 12, fontWeight: 700, color, background: "none", border: 0, padding: 0, cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 } as const);
                      return (
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
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
              {!filtered.length && (
                <tr><td colSpan={(canManage ? 9 : 8) + (canManage && shopbaseStores.length > 0 ? 1 : 0)} style={{ padding: "40px 12px", textAlign: "center", color: "var(--muted)" }}>No products. Click &quot;Sync from TikTok&quot; to pull them in.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {filtered.length > PAGE_SIZE && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
            {(pageSafe - 1) * PAGE_SIZE + 1}–{Math.min(pageSafe * PAGE_SIZE, filtered.length)} of {filtered.length} · Page {pageSafe}/{totalPages}
          </span>
          <Pager page={pageSafe} totalPages={totalPages} onPage={setPage} accent={TT_PINK} />
        </div>
      )}

      {canManage && <div style={{ fontSize: 11, color: "var(--muted)", margin: "10px 4px 0" }}>Bấm vào tiêu đề để mở Card Detail (sửa &amp; cập nhật thẳng lên TikTok) · Duplicate = nhân bản trong cùng shop (mặc định draft) · Deactivate = ngừng bán (bật lại được) · Delete = xoá listing trên TikTok (vĩnh viễn).</div>}

      {/* v405 · Push to ShopBase modal — chọn store + template rồi stage bản nháp */}
      {pushSbOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setPushSbOpen(false)}>
          <div style={{ background: "#fff", width: 520, maxWidth: "94vw", borderRadius: 18, padding: 24, boxShadow: "0 24px 60px rgba(16,24,40,.24)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>Push {sel.size} listing{sel.size === 1 ? "" : "s"} to ShopBase</div>
              <button onClick={() => setPushSbOpen(false)} style={{ border: "none", background: "#F3F4F6", borderRadius: 9, width: 30, height: 30, cursor: "pointer", fontSize: 16, color: "var(--muted)" }}>×</button>
            </div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 6 }}>① Destination store</label>
            <select value={pushSbStore} onChange={(e) => setPushSbStore(e.target.value)} style={{ ...inp, marginBottom: 14 }}>
              {shopbaseStores.length === 0 && <option value="">(No ShopBase store)</option>}
              {shopbaseStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 6 }}>② Template</label>
            <select value={pushSbTemplate} onChange={(e) => setPushSbTemplate(e.target.value)} style={{ ...inp, marginBottom: sbTemplates.length ? 16 : 8 }}>
              <option value="">— Select a template —</option>
              {sbTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.productType ? ` · ${t.productType}` : ""}</option>)}
            </select>
            {pushSbStore && sbTemplates.length === 0 && (
              <div style={{ fontSize: 12, color: "#B42318", marginBottom: 16, padding: "10px 12px", background: "#FEF3F2", borderRadius: 10, border: "1px solid #FDA29B" }}>
                This store has no template yet. Create one in <b>Manage Templates · ShopBase</b> first.
              </div>
            )}
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16, padding: "10px 12px", background: "#F8FAFF", borderRadius: 10, border: "1px solid #DCE6FB" }}>
              Nothing is sent to ShopBase yet. Listings are staged as <b style={{ color: "#14213D" }}>DRAFT</b> in <b style={{ color: "#14213D" }}>Manage Products · ShopBase</b> — finish them there, then hit <b style={{ color: "#14213D" }}>Push to ShopBase</b> to create them live.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setPushSbOpen(false)} style={{ background: "#fff", color: "#14213D", border: "1px solid var(--line)", borderRadius: 11, padding: "9px 15px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Cancel</button>
              <button onClick={doPushShopbase} disabled={!pushSbStore || !pushSbTemplate} style={{ background: "#2F6BFF", color: "#fff", border: 0, borderRadius: 11, padding: "9px 18px", fontSize: 13, fontWeight: 800, cursor: pushSbStore && pushSbTemplate ? "pointer" : "default", opacity: pushSbStore && pushSbTemplate ? 1 : .5 }}>Push now</button>
            </div>
          </div>
        </div>
      )}

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
