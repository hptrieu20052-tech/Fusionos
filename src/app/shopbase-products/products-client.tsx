"use client";
import { useEffect, useMemo, useState } from "react";
import { ShopbaseLogo } from "@/components/shopbase-logo";
import { Pager } from "@/components/pager";
import ShopbaseEditModal from "./edit-modal";
import ThumbZoom from "@/components/thumb-zoom";

type Store = { id: string; name: string; sellerId: string | null; sellerName: string | null };
type Seller = { id: string; name: string };
type Row = {
  id: string; storeId: string; storeName: string; sellerId: string | null; sellerName: string;
  shopbaseProductId: string; handle: string; title: string; productType: string; tags: string;
  status: string; onlineStoreUrl: string | null; totalInventory: number | null;
  collections?: { id: string; title: string }[];
  createdBy?: string | null; creatorName?: string | null;
  templateId?: string | null; templateName?: string | null;
  dirty: boolean; variantCount: number; imageCount: number;
  priceMin: number | null; priceMax: number | null; skuDone: number; skuTotal: number;
  thumb: string | null; orders?: number; syncedAt: string | null; updatedAt: string | null;
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
  const [sortOrders, setSortOrders] = useState(false); // sắp xếp theo số đơn cao → thấp
  const [editId, setEditId] = useState<string | null>(null); // Card Detail modal
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  // ── Bulk selection + actions (qua ShopBase API) ──────────────────────────
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState(false);
  const [actMenu, setActMenu] = useState(false);
  const [tagPanel, setTagPanel] = useState<null | "add" | "remove">(null);
  const [tagInput, setTagInput] = useState("");
  // v408 · filter theo collection + Action "Add to collection"
  const [fCollection, setFCollection] = useState("");
  const [fTemplate, setFTemplate] = useState("");   // v411 · lọc theo template đã dùng
  const [colPanel, setColPanel] = useState(false);
  const [colList, setColList] = useState<{ id: string; title: string }[]>([]);
  const [colPick, setColPick] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);

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
      if (j.ok) { flash(`✓ Synced ${j.fetched ?? 0} · ${j.created ?? 0} new · ${j.updated ?? 0} updated${j.removed ? ` · ${j.removed} removed (deleted on ShopBase)` : ""}`); await load(); }
      else flash("✗ " + (j.error ?? "sync failed"), false);
    } catch { flash("✗ Network error", false); }
    setSyncing(false);
  };

  const types = useMemo(() => Array.from(new Set(rows.map((r) => r.productType).filter(Boolean))).sort(), [rows]);
  // v411 · Store chung: filter Seller = NGƯỜI TẠO listing (created_by), gom từ rows.
  const creatorOpts = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.createdBy && !m.has(r.createdBy)) m.set(r.createdBy, r.creatorName || "—");
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);
  const templateOpts = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.templateId && !m.has(r.templateId)) m.set(r.templateId, r.templateName || "—");
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);
  // Collection filter options — gom từ jsonb collections của các dòng (id → title).
  const collectionOpts = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) for (const c of (r.collections ?? [])) if (c?.id && !m.has(c.id)) m.set(c.id, c.title || c.id);
    return Array.from(m, ([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title));
  }, [rows]);
  const filtered = useMemo(() => {
    const list = rows.filter((r) => {
      if (fStore && r.storeId !== fStore) return false;
      if (fSeller && r.createdBy !== fSeller) return false;   // v411 · lọc theo người tạo
      if (fTemplate && r.templateId !== fTemplate) return false;
      if (fType && r.productType !== fType) return false;
      if (fStatus === "__staged") { if (r.shopbaseProductId) return false; }
      else if (fStatus && r.status !== fStatus) return false;
      if (fCollection && !(r.collections ?? []).some((c) => c?.id === fCollection)) return false;
      if (q.trim()) { const s = q.trim().toLowerCase(); if (!(r.title.toLowerCase().includes(s) || r.handle.toLowerCase().includes(s) || r.shopbaseProductId.includes(s))) return false; }
      return true;
    });
    if (sortOrders) list.sort((a, b) => (b.orders ?? 0) - (a.orders ?? 0));
    return list;
  }, [rows, fStore, fSeller, fType, fStatus, fCollection, fTemplate, q, sortOrders]);

  // Phân trang 20/trang; reset về trang 1 khi đổi filter/sort.
  useEffect(() => { setPage(1); }, [q, fStore, fSeller, fType, fStatus, fCollection, fTemplate, sortOrders]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const paged = useMemo(() => filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE), [filtered, pageSafe]);

  // Selection helpers (thao tác trên tập đang lọc).
  const filteredIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const selCount = useMemo(() => filteredIds.filter((id) => sel.has(id)).length, [filteredIds, sel]);
  const allSel = filteredIds.length > 0 && selCount === filteredIds.length;
  const toggleAll = () => setSel((prev) => {
    const n = new Set(prev);
    if (allSel) filteredIds.forEach((id) => n.delete(id)); else filteredIds.forEach((id) => n.add(id));
    return n;
  });
  const toggleOne = (id: string) => setSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const clearSel = () => { setSel(new Set()); setActMenu(false); setTagPanel(null); setTagInput(""); setConfirmDel(false); setColPanel(false); };

  const runAction = async (action: string, tags?: string) => {
    const ids = filteredIds.filter((id) => sel.has(id));
    if (!ids.length) { flash("✗ Chưa chọn sản phẩm", false); return; }
    setActing(true);
    try {
      const j = await fetch("/api/shopbase-products/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ids, tags }) }).then((r) => r.json());
      if (j.ok) {
        const failN = j.failed?.length ?? 0;
        const firstErr = failN ? String(j.failed[0]?.error ?? "") : "";
        flash(`✓ ${j.done} sản phẩm đã xử lý${failN ? ` · ${failN} lỗi: ${firstErr}` : ""}`, failN === 0);
        clearSel();
        await load();
      } else flash("✗ " + (j.error ?? "action failed"), false);
    } catch { flash("✗ Network error", false); }
    setActing(false);
  };

  // v408 · Action "Add to collection" — nạp collection (custom) của store các dòng đã chọn.
  const openColPanel = async () => {
    setActMenu(false); setTagPanel(null); setConfirmDel(false);
    const selRows = rows.filter((r) => sel.has(r.id));
    const storeIds = Array.from(new Set(selRows.map((r) => r.storeId)));
    if (storeIds.length !== 1) { flash("✗ Select products of ONE store to add to a collection", false); return; }
    if (!selRows.some((r) => r.shopbaseProductId)) { flash("✗ Only products already on ShopBase can join a collection (staged drafts: Push first)", false); return; }
    setColList([]); setColPick(""); setColPanel(true);
    try {
      const j = await fetch(`/api/shopbase-collections?store=${storeIds[0]}`).then((r) => r.json());
      if (j.ok) {
        const customs = (j.collections ?? []).filter((c: { kind: string }) => c.kind === "custom").map((c: { id: string; title: string }) => ({ id: c.id, title: c.title }));
        setColList(customs);
        if (!customs.length) flash("✗ This store has no custom collection yet — create one in Manage Collections · ShopBase", false);
      } else flash("✗ " + (j.error ?? "Failed to load collections"), false);
    } catch { flash("✗ Network error", false); }
  };
  const doAddToCollection = async () => {
    const col = colList.find((c) => c.id === colPick);
    if (!col) return;
    const selRows = rows.filter((r) => sel.has(r.id) && r.shopbaseProductId);
    const storeId = selRows[0]?.storeId;
    const pids = selRows.map((r) => r.shopbaseProductId);
    if (!storeId || !pids.length) return;
    setActing(true);
    try {
      const j = await fetch("/api/shopbase-collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, action: "add", collectionId: col.id, collectionTitle: col.title, productIds: pids }) }).then((r) => r.json());
      if (j.ok || j.done) {
        flash(`✓ Added ${j.done}/${pids.length} product(s) to "${col.title}"${j.failed?.length ? ` · ${j.failed.length} failed: ${j.failed[0]?.error ?? ""}` : ""}`, !j.failed?.length);
        setColPanel(false); clearSel();
        await load();
      } else flash("✗ " + (j.failed?.[0]?.error ?? j.error ?? "Add failed"), false);
    } catch { flash("✗ Network error", false); }
    setActing(false);
  };

  // v405 · Push bản nháp đã stage (Etsy/TikTok) lên ShopBase — chỉ tác dụng với dòng STAGED.
  const runPush = async () => {
    setActMenu(false);
    const drafts = rows.filter((r) => sel.has(r.id) && !r.shopbaseProductId).map((r) => r.id);
    if (!drafts.length) { flash("✗ No staged drafts selected — the STAGED badge marks drafts that can be pushed", false); return; }
    setActing(true);
    try {
      const j = await fetch("/api/shopbase-products/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: drafts }) }).then((r) => r.json());
      if (j.ok || j.created) {
        const fail = (j.results ?? []).filter((r: { ok: boolean }) => !r.ok);
        flash(`✓ Pushed ${j.created}/${(j.results ?? []).length} to ShopBase (as unpublished drafts)${j.failed ? ` · ${j.failed} failed: ${fail[0]?.error ?? ""}` : ""}`, j.failed === 0);
        clearSel();
        await load();
      } else flash("✗ " + (j.error ?? (j.results ?? [])[0]?.error ?? "Push failed"), false);
    } catch { flash("✗ Network error", false); }
    setActing(false);
  };

  const exportCsv = () => {
    const head = ["Title", "ID", "Type", "Status", "PriceMin", "PriceMax", "Store", "Seller", "Tags", "Variants", "Link"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.join(",")].concat(filtered.map((r) => [r.title, r.shopbaseProductId, r.productType, r.status, r.priceMin ?? "", r.priceMax ?? "", r.storeName, r.sellerName, r.tags, r.variantCount, r.onlineStoreUrl ?? ""].map(esc).join(",")));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `shopbase-products-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const statusChip = (s: string) => {
    const m: Record<string, [string, string]> = { ACTIVE: ["#E7F6EC", "#217A3B"], DRAFT: ["#FFF4E5", "#9A6400"], ARCHIVED: ["#EEF0F4", "#5A6474"] };
    const [bg, fg] = m[s] ?? m.DRAFT;
    return <span style={{ background: bg, color: fg, borderRadius: 999, padding: "2px 9px", fontSize: 11, fontWeight: 800 }}>{s}</span>;
  };
  const price = (r: Row) => r.priceMin == null ? "—" : r.priceMin === r.priceMax ? money(r.priceMin) : `${money(r.priceMin)}–${money(r.priceMax!)}`;

  const menuBtn: React.CSSProperties = { display: "block", width: "100%", textAlign: "left", padding: "9px 14px", background: "none", border: 0, fontSize: 13.5, cursor: "pointer", color: "#14213D", whiteSpace: "nowrap" };

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 4px" }}>
      {/* Hero — tone xanh ShopBase */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, background: "linear-gradient(90deg, #EEF3FF, #F7FAFF)", border: "1px solid #CBD9FF", borderRadius: 16, padding: "16px 20px", marginBottom: 16, flexWrap: "wrap" }}>
        <ShopbaseLogo s={34} />
        <div style={{ fontSize: 20, fontWeight: 900, color: "#14213D" }}>Manage Products · <span style={{ color: SB_BLUE }}>ShopBase</span></div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={exportCsv} style={{ background: "#fff", color: "#14213D", border: "1px solid #CBD9FF", borderRadius: 11, padding: "10px 16px", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>⭳ Export CSV</button>
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
          <select value={fSeller} onChange={(e) => setFSeller(e.target.value)} style={inp}><option value="">All sellers</option>{creatorOpts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select value={fTemplate} onChange={(e) => setFTemplate(e.target.value)} style={inp}><option value="">All templates</option>{templateOpts.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <select value={fType} onChange={(e) => setFType(e.target.value)} style={inp}><option value="">All types</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={inp}><option value="">All status</option><option value="ACTIVE">Available (Active)</option><option value="DRAFT">Unavailable (Draft)</option><option value="ARCHIVED">Archived</option><option value="__staged">Staged drafts (not on ShopBase yet)</option></select>
          <select value={fCollection} onChange={(e) => setFCollection(e.target.value)} style={inp}><option value="">All collections</option>{collectionOpts.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
        </div>
      </div>

      {/* Bulk action bar — hiện khi có sản phẩm được chọn (chỉ khi canEdit) */}
      {canEdit && selCount > 0 && (
        <div style={{ background: "#EEF3FF", border: "1px solid #CBD9FF", borderRadius: 12, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 800, fontSize: 13.5, color: "#14213D" }}>{selCount} đã chọn</span>
          <div style={{ position: "relative" }}>
            <button onClick={() => setActMenu((v) => !v)} disabled={acting} style={{ background: SB_BLUE, color: "#fff", border: 0, borderRadius: 10, padding: "8px 16px", fontWeight: 800, fontSize: 13, cursor: acting ? "default" : "pointer", opacity: acting ? 0.6 : 1 }}>
              {acting ? "Đang xử lý…" : "Action ▾"}
            </button>
            {actMenu && !acting && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setActMenu(false)} />
                <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 41, background: "#fff", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "0 12px 32px rgba(20,33,61,.14)", padding: "6px 0", minWidth: 210 }}>
                  <button style={{ ...menuBtn, color: SB_BLUE, fontWeight: 800 }} onClick={runPush}>▲ Push to ShopBase (staged drafts)</button>
                  <div style={{ height: 1, background: "var(--line)", margin: "5px 0" }} />
                  <button style={menuBtn} onClick={() => runAction("publish")}>✓ Make available</button>
                  <button style={menuBtn} onClick={() => runAction("unpublish")}>⦸ Make unavailable</button>
                  <div style={{ height: 1, background: "var(--line)", margin: "5px 0" }} />
                  <button style={menuBtn} onClick={() => { setActMenu(false); setConfirmDel(false); setTagPanel("add"); }}>＋ Add tags</button>
                  <button style={menuBtn} onClick={() => { setActMenu(false); setConfirmDel(false); setTagPanel("remove"); }}>－ Remove tags</button>
                  <button style={menuBtn} onClick={openColPanel}>🗂 Add to collection</button>
                  <div style={{ height: 1, background: "var(--line)", margin: "5px 0" }} />
                  <button style={{ ...menuBtn, color: "var(--red)", fontWeight: 700 }} onClick={() => { setActMenu(false); setTagPanel(null); setConfirmDel(true); }}>🗑 Delete selected</button>
                </div>
              </>
            )}
          </div>
          <button onClick={clearSel} style={{ background: "none", border: 0, color: "var(--muted)", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Clear</button>

          {/* Panel nhập tag */}
          {tagPanel && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", width: "100%", marginTop: 4 }}>
              <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder={tagPanel === "add" ? "tag mới, cách nhau dấu phẩy" : "tag cần gỡ, cách nhau dấu phẩy"}
                onKeyDown={(e) => { if (e.key === "Enter" && tagInput.trim()) runAction(tagPanel === "add" ? "addTags" : "removeTags", tagInput); }}
                style={{ ...inp, width: "auto", flex: 1, minWidth: 200 }} autoFocus />
              <button disabled={!tagInput.trim() || acting} onClick={() => runAction(tagPanel === "add" ? "addTags" : "removeTags", tagInput)}
                style={{ background: SB_BLUE, color: "#fff", border: 0, borderRadius: 10, padding: "8px 16px", fontWeight: 800, fontSize: 13, cursor: !tagInput.trim() || acting ? "default" : "pointer", opacity: !tagInput.trim() || acting ? 0.6 : 1 }}>
                {tagPanel === "add" ? "Add" : "Remove"}
              </button>
              <button onClick={() => { setTagPanel(null); setTagInput(""); }} style={{ background: "none", border: 0, color: "var(--muted)", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Huỷ</button>
            </div>
          )}

          {/* v408 · Panel chọn collection */}
          {colPanel && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", width: "100%", marginTop: 4 }}>
              <select value={colPick} onChange={(e) => setColPick(e.target.value)} style={{ ...inp, width: "auto", flex: 1, minWidth: 200 }} autoFocus>
                <option value="">{colList.length ? "— Select collection —" : "Loading collections…"}</option>
                {colList.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
              <button disabled={!colPick || acting} onClick={doAddToCollection}
                style={{ background: SB_BLUE, color: "#fff", border: 0, borderRadius: 10, padding: "8px 16px", fontWeight: 800, fontSize: 13, cursor: !colPick || acting ? "default" : "pointer", opacity: !colPick || acting ? 0.6 : 1 }}>
                Add
              </button>
              <button onClick={() => setColPanel(false)} style={{ background: "none", border: 0, color: "var(--muted)", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Huỷ</button>
            </div>
          )}

          {/* Xác nhận xoá */}
          {confirmDel && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", width: "100%", marginTop: 4, background: "var(--red-soft)", borderRadius: 10, padding: "8px 12px" }}>
              <span style={{ fontSize: 13, color: "var(--red)", fontWeight: 700 }}>Xoá {selCount} sản phẩm khỏi ShopBase? Không thể hoàn tác.</span>
              <button disabled={acting} onClick={() => runAction("delete")} style={{ background: "var(--red)", color: "#fff", border: 0, borderRadius: 10, padding: "7px 16px", fontWeight: 800, fontSize: 13, cursor: acting ? "default" : "pointer", opacity: acting ? 0.6 : 1 }}>Xoá vĩnh viễn</button>
              <button onClick={() => setConfirmDel(false)} style={{ background: "none", border: 0, color: "var(--muted)", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Huỷ</button>
            </div>
          )}
        </div>
      )}

      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", margin: "0 4px 10px" }}>{filtered.length} products{loading ? " · loading…" : ""}</div>

      {/* Table */}
      <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 860 }}>
            <thead>
              <tr style={{ background: "#F7F9FC", textAlign: "left", color: "var(--muted)", fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".4px" }}>
                {canEdit && <th style={{ padding: "10px 12px", width: 34 }}><input type="checkbox" checked={allSel} ref={(el) => { if (el) el.indeterminate = selCount > 0 && !allSel; }} onChange={toggleAll} style={{ cursor: "pointer", width: 16, height: 16 }} /></th>}
                <th style={{ padding: "10px 12px" }}>Image</th>
                <th style={{ padding: "10px 12px" }}>Title</th>
                <th style={{ padding: "10px 12px" }}>Store / Seller</th>
                <th style={{ padding: "10px 12px" }}>Type</th>
                <th onClick={() => setSortOrders((v) => !v)} title="Số đơn đã bán · bấm để sắp xếp cao → thấp" style={{ padding: "10px 12px", textAlign: "right", width: 66, cursor: "pointer", userSelect: "none", color: sortOrders ? SB_BLUE : undefined }}>Orders{sortOrders ? " ↓" : " ⇅"}</th>
                <th style={{ padding: "10px 12px" }}>Price</th>
                <th style={{ padding: "10px 12px" }}>Status</th>
                <th style={{ padding: "10px 12px" }}>Link</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((r) => {
                const checked = sel.has(r.id);
                return (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--line)", background: checked ? "#F3F7FF" : undefined }}>
                    {canEdit && <td style={{ padding: "10px 12px" }}><input type="checkbox" checked={checked} onChange={() => toggleOne(r.id)} style={{ cursor: "pointer", width: 16, height: 16 }} /></td>}
                    <td style={{ padding: "10px 12px" }}>
                      <ThumbZoom src={r.thumb} alt={r.title} size={46} radius={8} />
                    </td>
                    <td style={{ padding: "10px 12px", maxWidth: 340 }}>
                      <div
                        onClick={() => canEdit && setEditId(r.id)}
                        title={canEdit ? "Click to edit" : undefined}
                        style={{ fontWeight: 700, color: canEdit ? SB_BLUE : "#14213D", lineHeight: 1.35, cursor: canEdit ? "pointer" : "default" }}>
                        {r.title}{!r.shopbaseProductId
                          ? <span style={{ marginLeft: 6, fontSize: 10, background: "#EEF3FF", color: SB_BLUE, borderRadius: 4, padding: "1px 5px", fontWeight: 800 }} title="Staged draft — not on ShopBase yet. Select it and use Action → Push to ShopBase.">STAGED</span>
                          : r.dirty && <span style={{ marginLeft: 6, fontSize: 10, background: "#FFF4E5", color: "#9A6400", borderRadius: 4, padding: "1px 5px", fontWeight: 800 }}>EDITED</span>}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{r.variantCount} variants · {r.imageCount} images · SKU {r.skuDone}/{r.skuTotal}{r.totalInventory != null ? ` · inv ${r.totalInventory}` : ""}</div>
                      <div onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(r.shopbaseProductId); }} title="Click to copy product ID" style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "monospace", marginTop: 1, cursor: "copy" }}>#{r.shopbaseProductId}</div>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ fontWeight: 600 }}>{r.storeName}</div>
                      <div style={{ fontSize: 12, color: r.creatorName ? "#14213D" : "var(--muted)", fontWeight: r.creatorName ? 700 : 400 }}>{r.creatorName ?? r.sellerName}</div>
                      {r.templateName && <div style={{ fontSize: 11, color: "var(--muted)" }}>tpl: {r.templateName}</div>}
                    </td>
                    <td style={{ padding: "10px 12px", color: "var(--muted)" }}>{r.productType || "—"}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: (r.orders ?? 0) > 0 ? 800 : 400, color: (r.orders ?? 0) > 0 ? "#14213D" : "var(--muted)" }}>{r.orders ?? 0}</td>
                    <td style={{ padding: "10px 12px", fontWeight: 700, whiteSpace: "nowrap" }}>{price(r)}</td>
                    <td style={{ padding: "10px 12px" }}>{statusChip(r.status)}</td>
                    <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                      {r.onlineStoreUrl ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <a href={r.onlineStoreUrl} target="_blank" rel="noreferrer" title="View on store" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 8, border: "1px solid #CBD9FF", background: "#F3F7FF", color: SB_BLUE }}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
                          </a>
                          <button onClick={() => { navigator.clipboard?.writeText(r.onlineStoreUrl!); flash("✓ Link copied"); }} title="Copy product link"
                            style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 7, width: 26, height: 26, cursor: "pointer", fontSize: 13, lineHeight: 1, color: "var(--muted)" }}>⧉</button>
                        </span>
                      ) : <span style={{ color: "var(--muted)" }}>—</span>}
                    </td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={canEdit ? 9 : 8} style={{ padding: "40px 12px", textAlign: "center", color: "var(--muted)" }}>
                  {rows.length === 0 ? "Chưa có sản phẩm — chọn store rồi bấm “Sync from ShopBase”." : "Không có sản phẩm khớp bộ lọc."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {filtered.length > PAGE_SIZE && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{(pageSafe - 1) * PAGE_SIZE + 1}–{Math.min(pageSafe * PAGE_SIZE, filtered.length)} of {filtered.length} · Page {pageSafe}/{totalPages}</span>
          <Pager page={pageSafe} totalPages={totalPages} onPage={setPage} accent={SB_BLUE} />
        </div>
      )}

      {canEdit && editId && (
        <ShopbaseEditModal id={editId} onClose={() => setEditId(null)} onSaved={load} />
      )}
    </div>
  );
}
