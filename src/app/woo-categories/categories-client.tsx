"use client";
/**
 * MANAGE CATEGORIES · WOOCOMMERCE (v523) — trang riêng theo khuôn Manage Collections ShopBase:
 * cột trái = danh sách category (tạo / đổi tên / xoá), cột phải = sản phẩm của category đang chọn
 * (xem, mở link, gỡ khỏi category). Seller chỉ thấy + sửa category CỦA MÌNH (v517);
 * admin thấy toàn bộ cây collection công khai.
 */
import { useCallback, useEffect, useState } from "react";
import { MarketplaceLogo } from "@/components/marketplace-logo";

type StoreOpt = { id: string; name: string };
type Cat = { id: number; name: string; parent: number; count: number; slug: string; ownerName?: string };
type Prod = {
  id: number; name: string; sku: string; status: string; editable?: boolean;
  price: string; regularPrice: string; salePrice: string; permalink: string; thumb: string;
  categories: { id: number; name: string }[];
};

const inp: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13.5, background: "#fff" };
const btnBlue: React.CSSProperties = { background: "var(--blue)", color: "#fff", border: 0, borderRadius: 12, padding: "10px 18px", fontWeight: 800, fontSize: 13, cursor: "pointer" };
const btnGhost: React.CSSProperties = { background: "#fff", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer" };

export default function WooCategoriesClient({ stores, canEdit }: { stores: StoreOpt[]; canEdit: boolean }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [cats, setCats] = useState<Cat[]>([]);
  const [selCat, setSelCat] = useState<Cat | null>(null);
  const [prods, setProds] = useState<Prod[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 4000); };

  const loadCats = useCallback(async (sid: string) => {
    if (!sid) return;
    setBusy(true);
    const j = await fetch(`/api/woo-products/categories?storeId=${sid}`).then((r) => r.json()).catch(() => ({ ok: false }));
    setBusy(false);
    if (j.ok) setCats(j.categories ?? []); else flash("✗ " + (j.error ?? "Error"));
  }, []);
  useEffect(() => { setSelCat(null); setProds([]); loadCats(storeId); }, [storeId, loadCats]);

  const loadProds = useCallback(async (sid: string, catId: number, pg: number) => {
    setBusy(true);
    const j = await fetch(`/api/woo-products?storeId=${sid}&page=${pg}&category=${catId}`).then((r) => r.json()).catch(() => ({ ok: false }));
    setBusy(false);
    if (j.ok) { setProds(j.products ?? []); setTotal(Number(j.total) || 0); setTotalPages(Math.max(1, Number(j.totalPages) || 1)); }
    else flash("✗ " + (j.error ?? "Error"));
  }, []);
  const pick = (c: Cat) => { setSelCat(c); setPage(1); loadProds(storeId, c.id, 1); };
  const goto = (pg: number) => { if (!selCat) return; const n = Math.min(Math.max(pg, 1), totalPages); setPage(n); loadProds(storeId, selCat.id, n); };

  // ── Tạo / đổi tên / xoá ──
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState(0);
  const addCat = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const j = await fetch("/api/woo-products/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, name: name.trim(), parentId }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setSaving(false);
    if (j.ok) { flash(j.warn ? "⚠ " + j.warn : "✓ Category created"); setName(""); setParentId(0); loadCats(storeId); }
    else flash("✗ " + (j.error ?? "Error"));
  };
  const renameCat = async (c: Cat) => {
    const nn = window.prompt("New category name:", c.name);
    if (!nn?.trim() || nn.trim() === c.name) return;
    const j = await fetch("/api/woo-products/categories", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, id: c.id, name: nn.trim() }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    if (j.ok) { flash("✓ Renamed"); loadCats(storeId); if (selCat?.id === c.id) setSelCat({ ...c, name: nn.trim() }); } else flash("✗ " + (j.error ?? "Error"));
  };
  const delCat = async (c: Cat) => {
    if (!window.confirm(`Delete category "${c.name}"?\nProducts are NOT deleted — they only leave this category.`)) return;
    const j = await fetch(`/api/woo-products/categories?storeId=${storeId}&id=${c.id}`, { method: "DELETE" }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    if (j.ok) { flash("✓ Category deleted"); if (selCat?.id === c.id) { setSelCat(null); setProds([]); } loadCats(storeId); } else flash("✗ " + (j.error ?? "Error"));
  };
  /** Gỡ 1 sản phẩm khỏi category đang chọn (product vẫn sống, chỉ rời category). */
  const removeFromCat = async (p: Prod) => {
    if (!selCat) return;
    setSaving(true);
    const j = await fetch("/api/woo-products", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, productId: p.id, product: { categoryIds: p.categories.filter((c) => c.id !== selCat.id).map((c) => c.id) } }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setSaving(false);
    if (j.ok) { flash("✓ Removed from category"); loadProds(storeId, selCat.id, page); loadCats(storeId); }
    else flash("✗ " + (j.error ?? "Error"));
  };

  const parents = cats.filter((c) => c.parent === 0);
  const sorted = [...parents.map((p) => [p, ...cats.filter((c) => c.parent === p.id)]).flat()];

  if (!stores.length) {
    return <div className="panel empty">No WooCommerce store yet — create one in <b>Stores</b> first.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 1440, margin: "0 auto", width: "100%" }}>
      {msg && <div style={{ position: "fixed", top: 70, right: 20, zIndex: 300, background: msg.startsWith("✓") ? "#1E7A3E" : msg.startsWith("⚠") ? "#8A6D1A" : "#B3261E", color: "#fff", padding: "10px 16px", borderRadius: 10, fontWeight: 700, fontSize: 13 }}>{msg}</div>}

      {/* Header — khuôn Manage Collections ShopBase */}
      <div className="panel" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "14px 18px", background: "#F6F9FF", border: "1px solid #DFE8FA" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
          <MarketplaceLogo mk="woocommerce" size={40} />
          <b style={{ fontSize: 19 }}>Manage Categories · <span style={{ color: "#7F54B3" }}>WooCommerce</span></b>
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} style={{ ...inp, width: 190 }}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={() => { loadCats(storeId); if (selCat) loadProds(storeId, selCat.id, page); }} style={btnBlue}>⟳ Refresh</button>
        </span>
      </div>

      {/* 2 cột: trái danh sách + phải sản phẩm */}
      <div className="m-stack-sm" style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 14, alignItems: "start" }}>
        {/* ── Trái: CATEGORIES ── */}
        <div className="panel" style={{ padding: 16 }}>
          <b style={{ fontSize: 13, letterSpacing: 0.5 }}>CATEGORIES ({cats.length})</b>
          {canEdit && (
            <div style={{ display: "grid", gap: 8, margin: "12px 0" }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCat()} placeholder="New category name (e.g. Christmas)" style={inp} />
                <button onClick={addCat} disabled={saving || !name.trim()} style={{ ...btnBlue, padding: "9px 16px", opacity: name.trim() ? 1 : 0.5, flexShrink: 0 }}>+ Add</button>
              </div>
              <select value={parentId} onChange={(e) => setParentId(Number(e.target.value))} style={inp}>
                <option value={0}>— none (top level) —</option>
                {parents.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div style={{ marginTop: canEdit ? 0 : 12 }}>
            {sorted.map((c) => (
              <div key={c.id}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 10px", borderRadius: 10, cursor: "pointer", background: selCat?.id === c.id ? "#EEF3FF" : "transparent", border: selCat?.id === c.id ? "1px solid #CBD9FF" : "1px solid transparent", marginBottom: 2 }}
                onClick={() => pick(c)}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: c.parent ? 500 : 700, paddingLeft: c.parent ? 14 : 0 }}>
                  {c.name} <span style={{ color: "var(--muted)", fontSize: 11.5, fontWeight: 600 }}>· {c.count} products</span>
                  {c.ownerName ? <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, padding: "1px 7px", borderRadius: 99, background: "#EEF3FF", color: "var(--blue)" }}>{c.ownerName}</span> : null}
                </span>
                {canEdit && <button onClick={(e) => { e.stopPropagation(); renameCat(c); }} title="Rename" style={{ border: 0, background: "transparent", cursor: "pointer", fontSize: 13, color: "var(--muted)" }}>✎</button>}
                {canEdit && <button onClick={(e) => { e.stopPropagation(); delCat(c); }} title="Delete (products stay)" style={{ border: 0, background: "transparent", cursor: "pointer", fontSize: 14, color: "var(--red)" }}>✕</button>}
              </div>
            ))}
            {!cats.length && !busy && <div style={{ fontSize: 13, color: "var(--muted)", padding: "10px 0" }}>No categories yet{canEdit ? " — add one above." : "."}</div>}
          </div>
        </div>

        {/* ── Phải: sản phẩm của category đang chọn ── */}
        <div className="panel" style={{ padding: 16, minHeight: 320 }}>
          {!selCat ? (
            <div style={{ display: "grid", placeItems: "center", minHeight: 280, color: "var(--muted)", fontSize: 14.5 }}>
              Select a category on the left to see its products.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <b style={{ fontSize: 15 }}>{selCat.name}</b>
                <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>{total} products</span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>Page {page} / {totalPages}</span>
              </div>
              <div style={{ marginTop: 10 }}>
                {prods.map((p) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: "1px solid #F1F3F8" }}>
                    <div style={{ width: 44, height: 44, borderRadius: 9, overflow: "hidden", background: "#F1F3F8", flexShrink: 0 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.thumb ? <img src={p.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--blue)", lineHeight: 1.35 }}>{p.name}</div>
                      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 1 }}>${p.price || p.regularPrice || "—"}{p.sku ? ` · ${p.sku}` : ""} · #{p.id}</div>
                    </div>
                    <span style={{ fontSize: 10.5, fontWeight: 800, padding: "3px 10px", borderRadius: 99, background: p.status === "publish" ? "var(--green-soft)" : "#FFF3D6", color: p.status === "publish" ? "#2E7D46" : "#8A6D1A", textTransform: "uppercase", flexShrink: 0 }}>{p.status === "publish" ? "Active" : p.status}</span>
                    {p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer" title="View on store" style={{ width: 30, height: 30, borderRadius: 99, border: "1px solid #CBD9FF", background: "#EEF6FF", color: "var(--blue)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, textDecoration: "none", flexShrink: 0 }}>👁</a>}
                    {canEdit && p.editable !== false && <button onClick={() => removeFromCat(p)} disabled={saving} title="Remove from this category (product stays)" style={{ ...btnGhost, padding: "5px 11px", fontSize: 11.5, color: "var(--red)", borderColor: "#F3C2C0", flexShrink: 0 }}>✕ Remove</button>}
                  </div>
                ))}
                {!prods.length && !busy && <div style={{ fontSize: 13, color: "var(--muted)", padding: "14px 0" }}>No products in this category.</div>}
                {busy && <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: 14 }}>Loading…</div>}
              </div>
              {totalPages > 1 && (
                <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 12 }}>
                  <button onClick={() => goto(page - 1)} disabled={page <= 1 || busy} style={{ ...btnGhost, padding: "7px 14px", opacity: page <= 1 ? 0.4 : 1 }}>‹ Prev</button>
                  <button onClick={() => goto(page + 1)} disabled={page >= totalPages || busy} style={{ ...btnGhost, padding: "7px 14px", opacity: page >= totalPages ? 0.4 : 1 }}>Next ›</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
