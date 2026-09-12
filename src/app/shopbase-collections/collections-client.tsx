"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConfirm } from "@/components/confirm-provider";
import { ShopbaseLogo } from "@/components/shopbase-logo";

/**
 * v417 · Manage Collections · ShopBase — CHẠY BẰNG TAG (ShopBase không mở API collection):
 *   trái  = danh sách collection-tag (tạo/xoá — định nghĩa lưu trong FUSION)
 *   phải  = sản phẩm đang mang tag (Remove = gỡ tag, + Add products = gắn tag)
 * Trên ShopBase, mỗi collection-tag cần 1 SMART collection (Automated) điều kiện
 * "Product tag is equal to <tag>" — tạo 1 lần, sau đó mọi thứ điều khiển từ FUSION.
 */
type Store = { id: string; name: string };
type Col = { id: string; title: string; tag: string; count: number; url?: string | null };
type ColProduct = { localId: string; productId: string; title: string; status: string; thumb: string | null; onlineStoreUrl: string | null };
type LocalRow = { id: string; storeId: string; shopbaseProductId: string; title: string; thumb: string | null; status: string; tags?: string };

const SB_BLUE = "#2F6BFF";
const inp: React.CSSProperties = { padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "#fff", fontSize: 13, boxSizing: "border-box" };
const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 14 };
const btn = (bg: string, fg: string): React.CSSProperties => ({ background: bg, color: fg, border: 0, borderRadius: 10, padding: "9px 16px", fontWeight: 800, fontSize: 13, cursor: "pointer" });
const ghost: React.CSSProperties = { ...btn("#fff", "var(--ink)"), border: "1px solid var(--line)", fontWeight: 700 };

export default function ShopbaseCollectionsClient({ stores, canEdit }: { stores: Store[]; canEdit: boolean }) {
  const confirm = useConfirm();
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [cols, setCols] = useState<Col[]>([]);
  const [colsLoading, setColsLoading] = useState(false);
  const [active, setActive] = useState<Col | null>(null);
  const [items, setItems] = useState<ColProduct[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [pick, setPick] = useState<null | { list: LocalRow[]; sel: Set<string>; q: string }>(null);

  const flash = (text: string, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 7000); };

  const loadCols = useCallback(async (sid: string) => {
    if (!sid) return;
    setColsLoading(true); setActive(null); setItems([]);
    try {
      const j = await fetch(`/api/shopbase-collections?store=${sid}`).then((r) => r.json());
      if (j.ok) setCols(j.collections ?? []);
      else { setCols([]); flash("✗ " + (j.error ?? "Failed to load"), false); }
    } catch { setCols([]); flash("✗ Network error", false); }
    setColsLoading(false);
  }, []);
  useEffect(() => { loadCols(storeId); }, [storeId, loadCols]);

  const openCol = async (c: Col) => {
    setActive(c); setItems([]); setItemsLoading(true);
    try {
      const j = await fetch(`/api/shopbase-collections?store=${storeId}&tag=${encodeURIComponent(c.tag)}`).then((r) => r.json());
      if (j.ok) setItems(j.products ?? []);
      else flash("✗ " + (j.error ?? "Failed to load products"), false);
    } catch { flash("✗ Network error", false); }
    setItemsLoading(false);
  };

  const createCol = async () => {
    const title = newTitle.trim();
    if (!title) return flash("✗ Enter a collection title first", false);
    setBusy(true);
    try {
      const j = await fetch("/api/shopbase-collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, action: "create", title }) }).then((r) => r.json());
      if (j.ok) {
        flash(`✓ "${title}" created with tag "${j.collection.tag}" — now create the matching Smart collection on ShopBase (see note below)`);
        setNewTitle(""); loadCols(storeId);
      } else flash("✗ " + (j.error ?? "Create failed"), false);
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };

  const deleteCol = async (c: Col) => {
    if (!(await confirm({ message: `Remove collection "${c.title}" from FUSION? Product tags and the ShopBase smart collection stay — delete those on ShopBase if you no longer need them.`, danger: true }))) return;
    setBusy(true);
    try {
      const j = await fetch("/api/shopbase-collections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, action: "delete", id: c.id }) }).then((r) => r.json());
      if (j.ok) { flash(`✓ Removed "${c.title}"`); if (active?.id === c.id) { setActive(null); setItems([]); } loadCols(storeId); }
      else flash("✗ " + (j.error ?? "Delete failed"), false);
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };

  // Gắn/gỡ tag qua action API sẵn có (write_products) — ids = id local của shopbase_products.
  const runTagAction = async (action: "addTags" | "removeTags", ids: string[], tag: string) => {
    const j = await fetch("/api/shopbase-products/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ids, tags: tag }) }).then((r) => r.json());
    return j;
  };

  const removeProduct = async (it: ColProduct) => {
    if (!active) return;
    setBusy(true);
    try {
      const j = await runTagAction("removeTags", [it.localId], active.tag);
      if (j.ok && !(j.failed?.length)) { setItems((prev) => prev.filter((x) => x.localId !== it.localId)); flash("✓ Removed from collection"); }
      else flash("✗ " + (j.failed?.[0]?.error ?? j.error ?? "Remove failed"), false);
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };

  const openPick = async () => {
    if (!active) return;
    setBusy(true);
    try {
      const j = await fetch("/api/shopbase-products").then((r) => r.json());
      const inCol = new Set(items.map((x) => x.localId));
      const list: LocalRow[] = (j.rows ?? [])
        .filter((r: { storeId: string; shopbaseProductId: string; id: string }) => r.storeId === storeId && r.shopbaseProductId && !inCol.has(r.id))
        .map((r: LocalRow) => ({ id: r.id, storeId: r.storeId, shopbaseProductId: r.shopbaseProductId, title: r.title, thumb: r.thumb, status: r.status }));
      if (!list.length) flash("✗ No synced products left to add — Sync in Manage Products · ShopBase first", false);
      else setPick({ list, sel: new Set(), q: "" });
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };

  const doAdd = async () => {
    if (!active || !pick || !pick.sel.size) return;
    setBusy(true);
    try {
      const ids = Array.from(pick.sel);
      const j = await runTagAction("addTags", ids, active.tag);
      if (j.ok || j.done) {
        flash(`✓ Added ${j.done}/${ids.length} product(s) to "${active.title}"${j.failed?.length ? ` · ${j.failed.length} failed: ${j.failed[0]?.error ?? ""}` : ""}`, !j.failed?.length);
        setPick(null);
        openCol(active);
        loadCols(storeId);
      } else flash("✗ " + (j.failed?.[0]?.error ?? j.error ?? "Add failed"), false);
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };

  const statusChip = (s: string) => {
    const m: Record<string, [string, string]> = { ACTIVE: ["#E7F6EC", "#217A3B"], DRAFT: ["#FFF4E5", "#9A6400"], ARCHIVED: ["#EEF0F4", "#5A6474"] };
    const [bg, fg] = m[s] ?? ["#EEF0F4", "#5A6474"];
    return <span style={{ background: bg, color: fg, borderRadius: 999, padding: "2px 9px", fontSize: 11, fontWeight: 800 }}>{s}</span>;
  };

  const pickList = useMemo(() => {
    if (!pick) return [];
    const q = pick.q.trim().toLowerCase();
    return q ? pick.list.filter((r) => r.title.toLowerCase().includes(q) || r.shopbaseProductId.includes(q)) : pick.list;
  }, [pick]);

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 4px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, background: "linear-gradient(90deg, #EEF3FF, #F7FAFF)", border: "1px solid #CBD9FF", borderRadius: 16, padding: "16px 20px", marginBottom: 16, flexWrap: "wrap" }}>
        <ShopbaseLogo s={34} />
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#14213D" }}>Manage Collections · <span style={{ color: SB_BLUE }}>ShopBase</span></div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>Tag-based collections — membership is controlled from FUSION via product tags</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} style={{ ...inp, width: "auto", minWidth: 150 }}>
            {stores.length === 0 && <option value="">No ShopBase store</option>}
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={() => loadCols(storeId)} disabled={colsLoading || !storeId} style={{ ...btn(SB_BLUE, "#fff"), opacity: colsLoading ? .6 : 1 }}>{colsLoading ? "Loading…" : "⟳ Refresh"}</button>
        </div>
      </div>

      {msg && <div style={{ fontSize: 13, padding: "9px 13px", borderRadius: 10, marginBottom: 12, background: msg.ok ? "#E7F6EC" : "var(--red-soft)", color: msg.ok ? "#217A3B" : "var(--red)", fontWeight: 600 }}>{msg.text}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 14, alignItems: "start" }}>
        {/* ── Trái: collection-tags ── */}
        <div style={{ ...card, padding: 14 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 10 }}>Collections ({cols.length})</div>
          {canEdit && (
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="New collection title (e.g. Halloween)" onKeyDown={(e) => { if (e.key === "Enter") createCol(); }} style={{ ...inp, flex: 1, minWidth: 0 }} />
              <button onClick={createCol} disabled={busy || !newTitle.trim()} style={{ ...btn(SB_BLUE, "#fff"), opacity: busy || !newTitle.trim() ? .5 : 1, whiteSpace: "nowrap" }}>+ Add</button>
            </div>
          )}
          {colsLoading ? <div style={{ color: "var(--muted)", fontSize: 13, padding: 8 }}>Loading…</div>
            : cols.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 13, padding: 8 }}>No collections yet{canEdit ? " — create one above." : "."}</div>
            : <div style={{ display: "grid", gap: 4 }}>
                {cols.map((c) => (
                  <div key={c.id} onClick={() => openCol(c)}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", borderRadius: 10, cursor: "pointer", background: active?.id === c.id ? "#EEF3FF" : "transparent", border: active?.id === c.id ? "1px solid #CBD9FF" : "1px solid transparent" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: active?.id === c.id ? SB_BLUE : "#14213D", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>tag: {c.tag} · {c.count} products</div>
                    </div>
                    {canEdit && (
                      <button onClick={(e) => { e.stopPropagation(); deleteCol(c); }} title="Remove collection definition" style={{ border: 0, background: "none", color: "var(--red)", cursor: "pointer", fontSize: 14, padding: 4 }}>✕</button>
                    )}
                  </div>
                ))}
              </div>}
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 12, lineHeight: 1.6, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <b>One-time setup per collection on ShopBase:</b> Products → Collections → Create collection → <b>Automated</b> → condition <b>Product tag is equal to</b> the tag shown above. After that, everything is controlled from here.
          </div>
        </div>

        {/* ── Phải: sản phẩm mang tag ── */}
        <div style={{ ...card, padding: 16, minHeight: 240 }}>
          {!active ? (
            <div style={{ color: "var(--muted)", fontSize: 13.5, padding: "60px 0", textAlign: "center" }}>Select a collection on the left to see its products.</div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 900, fontSize: 16, color: "#14213D" }}>{active.title} <span style={{ color: "var(--muted)", fontWeight: 600, fontSize: 13 }}>({items.length})</span></div>
                <span onClick={() => { navigator.clipboard?.writeText(active.tag); flash("✓ Tag copied"); }} title="Click to copy tag"
                  style={{ background: "#EEF3FF", color: SB_BLUE, borderRadius: 999, padding: "3px 12px", fontSize: 11.5, fontWeight: 800, fontFamily: "monospace", cursor: "copy" }}>{active.tag} ⧉</span>
                {active.url && (
                  <>
                    <a href={active.url} target="_blank" rel="noreferrer" title="Open collection on storefront"
                      style={{ color: SB_BLUE, fontWeight: 700, fontSize: 12, textDecoration: "none" }}>Open ↗</a>
                    <span onClick={() => { navigator.clipboard?.writeText(active.url!); flash("✓ Collection link copied"); }} title={active.url}
                      style={{ background: "#EAF6EC", color: "#217A3B", borderRadius: 999, padding: "3px 12px", fontSize: 11.5, fontWeight: 800, cursor: "copy" }}>🔗 Copy link</span>
                  </>
                )}
                <div style={{ marginLeft: "auto" }}>
                  {canEdit && <button onClick={openPick} disabled={busy || itemsLoading} style={{ ...btn(SB_BLUE, "#fff"), opacity: busy ? .6 : 1 }}>+ Add products</button>}
                </div>
              </div>
              {itemsLoading ? <div style={{ color: "var(--muted)", fontSize: 13, padding: 12 }}>Loading…</div>
                : items.length === 0 ? <div style={{ color: "var(--muted)", fontSize: 13, padding: 12 }}>No products carry this tag yet — hit “+ Add products”.</div>
                : <div style={{ display: "grid", gap: 6 }}>
                    {items.map((it) => (
                      <div key={it.localId} style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid var(--line)", borderRadius: 10, padding: "8px 12px" }}>
                        {it.thumb
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={it.thumb} alt="" width={40} height={40} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)", flexShrink: 0 }} />
                          : <div style={{ width: 40, height: 40, borderRadius: 8, background: "#EEF0F4", flexShrink: 0 }} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title}</div>
                          <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>#{it.productId || "draft"}</div>
                        </div>
                        {statusChip(it.status)}
                        {it.onlineStoreUrl && <a href={it.onlineStoreUrl} target="_blank" rel="noreferrer" style={{ color: SB_BLUE, fontWeight: 700, fontSize: 12.5, textDecoration: "none" }}>Open ↗</a>}
                        {canEdit && <button onClick={() => removeProduct(it)} disabled={busy} style={{ ...ghost, color: "var(--red)", borderColor: "#F3C9C9", padding: "6px 12px", fontSize: 12.5 }}>Remove</button>}
                      </div>
                    ))}
                  </div>}
            </>
          )}
        </div>
      </div>

      {/* ── "+ Add products" modal ── */}
      {pick && active && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.45)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !busy && setPick(null)}>
          <div style={{ background: "#fff", width: 620, maxWidth: "96vw", maxHeight: "88vh", borderRadius: 18, padding: 22, display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(16,24,40,.24)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <b style={{ fontSize: 16 }}>Add products to “{active.title}”</b>
              <button onClick={() => setPick(null)} style={{ border: "none", background: "#F3F4F6", borderRadius: 9, width: 30, height: 30, cursor: "pointer", fontSize: 16, color: "var(--muted)" }}>×</button>
            </div>
            <input value={pick.q} onChange={(e) => setPick((p) => p ? { ...p, q: e.target.value } : p)} placeholder="Search title / product ID" style={{ ...inp, width: "100%", marginBottom: 10 }} />
            <div style={{ flex: 1, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 12, padding: 6, minHeight: 200 }}>
              {pickList.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13, padding: 12 }}>No products match.</div>}
              {pickList.map((r) => {
                const on = pick.sel.has(r.id);
                return (
                  <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 8px", borderRadius: 8, cursor: "pointer", background: on ? "#EEF3FF" : "transparent" }}>
                    <input type="checkbox" checked={on} onChange={() => setPick((p) => {
                      if (!p) return p;
                      const sel = new Set(p.sel);
                      if (sel.has(r.id)) sel.delete(r.id); else sel.add(r.id);
                      return { ...p, sel };
                    })} style={{ width: 16, height: 16 }} />
                    {r.thumb
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={r.thumb} alt="" width={36} height={36} style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 7, border: "1px solid var(--line)", flexShrink: 0 }} />
                      : <div style={{ width: 36, height: 36, borderRadius: 7, background: "#EEF0F4", flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
                      <div style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "monospace" }}>#{r.shopbaseProductId}</div>
                    </div>
                  </label>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
              <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 700 }}>{pick.sel.size} selected</span>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setPick(null)} style={ghost} disabled={busy}>Cancel</button>
                <button onClick={doAdd} disabled={busy || !pick.sel.size} style={{ ...btn(SB_BLUE, "#fff"), opacity: busy || !pick.sel.size ? .5 : 1 }}>{busy ? "Adding…" : "Add to collection"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
