"use client";
/**
 * MANAGE PRODUCTS WOOCOMMERCE (v497) — seller tự list sản phẩm mới, tạo category,
 * sửa sản phẩm TRỰC TIẾP từ FUSION. Đọc/ghi sống qua Woo REST (không bảng sync riêng).
 *
 * Lưu ý store dùng Woo Custom Pro (Sorawix): sản phẩm là SIMPLE product — style/size/màu
 * do plugin render từ products.json, nên listing từ FUSION chỉ cần title + ảnh + giá gốc
 * + description + category là đủ lên kệ.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type StoreOpt = { id: string; name: string; sellerId: string | null; sellerName: string | null };
type Cat = { id: number; name: string; parent: number; count: number; slug: string };
type Prod = {
  id: number; name: string; sku: string; status: string;
  price: string; regularPrice: string; salePrice: string;
  permalink: string; thumb: string;
  images: { id: number; src: string }[];
  categories: { id: number; name: string }[];
  description: string; tags: string[]; totalSales: number; dateCreated: string;
};

const inp: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13.5, background: "#fff" };
const btnPri: React.CSSProperties = { background: "var(--blue)", color: "#fff", border: 0, borderRadius: 10, padding: "9px 16px", fontWeight: 800, fontSize: 13, cursor: "pointer" };
const btnGhost: React.CSSProperties = { background: "#fff", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" };

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: "block", marginBottom: 10 }}><div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>{label}</div>{children}</label>;
}

// Nén ảnh phía client trước khi upload (max cạnh 1600px, JPEG q0.85) — đủ nét cho Woo.
async function compressImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const max = 1600, ratio = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.round(img.width * ratio), h = Math.round(img.height * ratio);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return c.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.85);
  } finally { URL.revokeObjectURL(url); }
}

export default function WooProductsClient({ stores, canEdit }: { stores: StoreOpt[]; canEdit: boolean }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [products, setProducts] = useState<Prod[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 4000); };

  const loadCats = useCallback(async (sid: string) => {
    if (!sid) return;
    const j = await fetch(`/api/woo-products/categories?storeId=${sid}`).then((r) => r.json()).catch(() => ({ ok: false }));
    if (j.ok) setCats(j.categories ?? []);
  }, []);

  const loadProducts = useCallback(async (sid: string, q: string, pg: number, append: boolean) => {
    if (!sid) return;
    setBusy(true);
    const j = await fetch(`/api/woo-products?storeId=${sid}&search=${encodeURIComponent(q)}&page=${pg}`).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setBusy(false);
    if (j.ok) { setProducts((prev) => (append ? [...prev, ...(j.products ?? [])] : (j.products ?? []))); setHasMore(!!j.hasMore); }
    else flash("✗ " + (j.error ?? "Error"));
  }, []);

  useEffect(() => { if (storeId) { setPage(1); loadProducts(storeId, "", 1, false); loadCats(storeId); } }, [storeId, loadProducts, loadCats]);

  const doSearch = () => { setPage(1); loadProducts(storeId, search, 1, false); };

  // ── New / Edit product modal ─────────────────────────────────────────────
  const empty = { id: 0, name: "", description: "", regularPrice: "", salePrice: "", sku: "", status: "publish", categoryIds: [] as number[], tags: "", images: [] as string[] };
  const [form, setForm] = useState<typeof empty | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const openNew = () => setForm({ ...empty });
  const openEdit = async (p: Prod) => {
    setBusy(true);
    const j = await fetch(`/api/woo-products?storeId=${storeId}&productId=${p.id}`).then((r) => r.json()).catch(() => ({ ok: false }));
    setBusy(false);
    const d: Prod = j.ok ? j.product : p;
    setForm({
      id: d.id, name: d.name, description: d.description,
      regularPrice: d.regularPrice || d.price, salePrice: d.salePrice, sku: d.sku,
      status: d.status === "draft" ? "draft" : "publish",
      categoryIds: d.categories.map((c) => c.id),
      tags: d.tags.join(", "),
      images: d.images.map((i) => i.src),
    });
  };

  const addImages = async (files: FileList | null) => {
    if (!files?.length || !form) return;
    setSaving(true);
    const urls: string[] = [];
    for (const f of Array.from(files).slice(0, 12)) {
      try {
        const dataUrl = await compressImage(f);
        const j = await fetch("/api/woo-products/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl }) }).then((r) => r.json());
        if (j.ok && j.url) urls.push(j.url); else flash("✗ " + (j.error ?? "upload error"));
      } catch { flash("✗ upload error"); }
    }
    setSaving(false);
    setForm((f0) => (f0 ? { ...f0, images: [...f0.images, ...urls].slice(0, 12) } : f0));
  };

  const save = async () => {
    if (!form) return;
    if (!form.name.trim()) { flash("✗ Enter a product title"); return; }
    if (!form.regularPrice.trim()) { flash("✗ Enter a price"); return; }
    setSaving(true);
    const product = {
      name: form.name, description: form.description,
      regularPrice: form.regularPrice, salePrice: form.salePrice,
      sku: form.sku, status: form.status,
      categoryIds: form.categoryIds,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      images: form.images,
    };
    const j = form.id
      ? await fetch("/api/woo-products", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, productId: form.id, product }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }))
      : await fetch("/api/woo-products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, product }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setSaving(false);
    if (j.ok) { flash(form.id ? "✓ Product updated" : "✓ Product created on the store"); setForm(null); loadProducts(storeId, search, 1, false); loadCats(storeId); }
    else flash("✗ " + (j.error ?? "Error"));
  };

  // ── New category ─────────────────────────────────────────────────────────
  const [catOpen, setCatOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const [catParent, setCatParent] = useState(0);
  const addCat = async () => {
    if (!catName.trim()) return;
    setSaving(true);
    const j = await fetch("/api/woo-products/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, name: catName.trim(), parentId: catParent }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setSaving(false);
    if (j.ok) { flash("✓ Category created"); setCatName(""); setCatParent(0); setCatOpen(false); loadCats(storeId); }
    else flash("✗ " + (j.error ?? "Error"));
  };

  const parents = cats.filter((c) => c.parent === 0);
  const catLabel = (c: Cat) => (c.parent ? `— ${c.name}` : c.name);
  const sortedCats = [...parents.map((p) => [p, ...cats.filter((c) => c.parent === p.id)]).flat()];

  if (!stores.length) {
    return <div className="panel empty">No WooCommerce store yet — create one in <b>Stores</b> (marketplace: WooCommerce), enter the REST API keys, then come back here.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {msg && <div style={{ position: "fixed", top: 70, right: 20, zIndex: 60, background: msg.startsWith("✓") ? "#1E7A3E" : "#B3261E", color: "#fff", padding: "10px 16px", borderRadius: 10, fontWeight: 700, fontSize: 13 }}>{msg}</div>}

      {/* Toolbar */}
      <div className="panel" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "12px 14px" }}>
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)} style={{ ...inp, width: 220 }}>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}{s.sellerName ? ` · ${s.sellerName}` : ""}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doSearch()} placeholder="Search products…" style={{ ...inp, width: 260 }} />
        <button onClick={doSearch} style={btnGhost}>Search</button>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {canEdit && <button onClick={() => setCatOpen(true)} style={btnGhost}>+ New category</button>}
          {canEdit && <button onClick={openNew} style={btnPri}>+ New product</button>}
        </span>
      </div>

      {/* Categories strip */}
      <div className="panel" style={{ padding: "10px 14px", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <b style={{ fontSize: 12.5, marginRight: 4 }}>Categories:</b>
        {sortedCats.length ? sortedCats.map((c) => (
          <span key={c.id} style={{ fontSize: 11.5, fontWeight: 700, background: c.parent ? "#F1F3F8" : "#EEF3FF", border: "1px solid var(--line)", borderRadius: 99, padding: "3px 10px" }}>
            {catLabel(c)} <span style={{ color: "var(--muted)", fontWeight: 600 }}>({c.count})</span>
          </span>
        )) : <span style={{ fontSize: 12, color: "var(--muted)" }}>none yet</span>}
      </div>

      {/* Product grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 12 }}>
        {products.map((p) => (
          <div key={p.id} className="panel" style={{ padding: 10, cursor: canEdit ? "pointer" : "default" }} onClick={() => canEdit && openEdit(p)}>
            <div style={{ aspectRatio: "1", borderRadius: 10, overflow: "hidden", background: "#F1F3F8", marginBottom: 8 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.thumb ? <img src={p.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.35, height: 50, overflow: "hidden" }}>{p.name}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <b style={{ fontSize: 13.5 }}>${p.price || p.regularPrice || "—"}</b>
              <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 99, background: p.status === "publish" ? "var(--green-soft)" : "#FFF3D6", color: p.status === "publish" ? "#2E7D46" : "#8A6D1A" }}>{p.status}</span>
              {p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: "var(--blue)" }}>View ↗</a>}
            </div>
          </div>
        ))}
      </div>
      {busy && <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Loading…</div>}
      {hasMore && !busy && (
        <button onClick={() => { const n = page + 1; setPage(n); loadProducts(storeId, search, n, true); }} style={{ ...btnGhost, justifySelf: "center" }}>Load more</button>
      )}

      {/* New category modal */}
      {catOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,20,40,.45)", zIndex: 50, display: "grid", placeItems: "center", padding: 16 }} onClick={() => setCatOpen(false)}>
          <div className="panel" style={{ width: 420, maxWidth: "100%", padding: 18 }} onClick={(e) => e.stopPropagation()}>
            <b style={{ fontSize: 15 }}>New category</b>
            <div style={{ marginTop: 12 }}>
              <L label="Name"><input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="e.g. Christmas" style={inp} /></L>
              <L label="Parent (optional — leave for a top-level category)">
                <select value={catParent} onChange={(e) => setCatParent(Number(e.target.value))} style={inp}>
                  <option value={0}>— none (top level) —</option>
                  {parents.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </L>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
              <button onClick={() => setCatOpen(false)} style={btnGhost}>Cancel</button>
              <button onClick={addCat} disabled={saving} style={btnPri}>{saving ? "Creating…" : "Create category"}</button>
            </div>
          </div>
        </div>
      )}

      {/* New / Edit product modal */}
      {form && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,20,40,.45)", zIndex: 50, display: "grid", placeItems: "center", padding: 16, overflowY: "auto" }} onClick={() => !saving && setForm(null)}>
          <div className="panel" style={{ width: 720, maxWidth: "100%", padding: 18, maxHeight: "92vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <b style={{ fontSize: 15 }}>{form.id ? "Edit product" : "New product"}</b>
            <div className="m-stack-sm" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px", marginTop: 12 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <L label="Title"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Personalized Pumpkin Patch Crew Shirt…" style={inp} /></L>
              </div>
              <L label="Price ($)"><input value={form.regularPrice} onChange={(e) => setForm({ ...form, regularPrice: e.target.value })} placeholder="18.99" style={inp} /></L>
              <L label="Sale price ($ — optional, leave blank for none)"><input value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} placeholder="" style={inp} /></L>
              <L label="SKU (optional)"><input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="SKU-119" style={inp} /></L>
              <L label="Status">
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} style={inp}>
                  <option value="publish">Publish (live on store)</option>
                  <option value="draft">Draft (hidden)</option>
                </select>
              </L>
              <div style={{ gridColumn: "1 / -1" }}>
                <L label="Description (HTML allowed)">
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={6} style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} />
                </L>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <L label="Categories">
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {sortedCats.map((c) => {
                      const on = form.categoryIds.includes(c.id);
                      return (
                        <button key={c.id} type="button"
                          onClick={() => setForm({ ...form, categoryIds: on ? form.categoryIds.filter((x) => x !== c.id) : [...form.categoryIds, c.id] })}
                          style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: 99, cursor: "pointer", border: on ? "1px solid var(--blue)" : "1px solid var(--line)", background: on ? "var(--blue)" : "#fff", color: on ? "#fff" : "var(--ink)" }}>
                          {catLabel(c)}
                        </button>
                      );
                    })}
                  </div>
                </L>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <L label="Tags (comma separated — optional)"><input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="halloween, family matching" style={inp} /></L>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <L label={`Images (${form.images.length}/12 — first image = cover)`}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {form.images.map((src, i) => (
                      <div key={src + i} style={{ position: "relative", width: 86, height: 86, borderRadius: 10, overflow: "hidden", border: i === 0 ? "2px solid var(--blue)" : "1px solid var(--line)" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        <button type="button" onClick={() => setForm({ ...form, images: form.images.filter((_, x) => x !== i) })}
                          style={{ position: "absolute", top: 3, right: 3, width: 20, height: 20, borderRadius: 99, border: 0, background: "rgba(0,0,0,.6)", color: "#fff", fontSize: 12, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                      </div>
                    ))}
                    <button type="button" onClick={() => fileRef.current?.click()} disabled={saving}
                      style={{ width: 86, height: 86, borderRadius: 10, border: "1.5px dashed var(--line)", background: "#F8F9FC", color: "var(--muted)", fontSize: 24, cursor: "pointer" }}>+</button>
                    <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addImages(e.target.files); e.target.value = ""; }} />
                  </div>
                </L>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={() => setForm(null)} disabled={saving} style={btnGhost}>Cancel</button>
              <button onClick={save} disabled={saving} style={btnPri}>{saving ? "Saving…" : form.id ? "Save changes" : "Create product"}</button>
            </div>
            {!form.id && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10, lineHeight: 1.5 }}>
                Products are created as <b>simple products</b> — on Sorawix the style / size / color picker and per-size pricing come from the Woo Custom Pro products.json, so a title + images + base price + category is all a listing needs.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
