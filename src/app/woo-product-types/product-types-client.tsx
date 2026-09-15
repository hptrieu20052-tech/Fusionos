"use client";
/**
 * PRODUCT TYPES · WOOCOMMERCE (v505) — quản lý style của Woo Custom Pro (products.json trên store)
 * ngay từ FUSION: thêm loại sản phẩm mới (Pajama, Calendar, Book…), sửa size + giá, màu, mockup —
 * không cần vào WP admin hay sửa code. Ghi qua plugin cầu nối wcp-fusion-bridge (backup tự động).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { MarketplaceLogo } from "@/components/marketplace-logo";

// v509 · Nén ảnh phía client trước khi upload (max cạnh 1200px — thumbnail mockup không cần lớn).
async function compressImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const max = 1200, ratio = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.round(img.width * ratio), h = Math.round(img.height * ratio);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return c.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.85);
  } finally { URL.revokeObjectURL(url); }
}

type StoreOpt = { id: string; name: string };
type Style = { styles: string; image: string; sizes: string[]; colors: string[]; designs: string[]; shipping?: string; group?: string; mine?: boolean; ownerName?: string | null };
// Dạng edit trong form: size/màu tách thành cặp field cho dễ nhập.
type FormStyle = { name: string; image: string; sizes: { n: string; p: string }[]; colors: { n: string; hex: string }[]; front: boolean; back: boolean; ship: string; grp: string };

const inp: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13.5, background: "#fff" };
const btnPri: React.CSSProperties = { background: "var(--ink)", color: "#fff", border: 0, borderRadius: 12, padding: "10px 18px", fontWeight: 800, fontSize: 13, cursor: "pointer" };
const btnBlue: React.CSSProperties = { background: "var(--blue)", color: "#fff", border: 0, borderRadius: 12, padding: "10px 18px", fontWeight: 800, fontSize: 13, cursor: "pointer" };
const btnGhost: React.CSSProperties = { background: "#fff", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer" };

function toForm(s: Style): FormStyle {
  return {
    name: s.styles, image: s.image ?? "",
    sizes: (s.sizes ?? []).map((x) => { const i = x.lastIndexOf("-"); return i > 0 ? { n: x.slice(0, i), p: x.slice(i + 1) } : { n: x, p: "" }; }),
    colors: (s.colors ?? []).map((x) => { const [n, hex] = x.split("|"); return { n: n ?? "", hex: (hex ?? "#cccccc").trim() }; }),
    front: (s.designs ?? []).includes("front") || !(s.designs ?? []).length,
    back: (s.designs ?? []).includes("back") || !(s.designs ?? []).length,
    ship: s.shipping ?? "",
    grp: s.group ?? "",
  };
}
function fromForm(f: FormStyle): Style {
  return {
    styles: f.name.trim(),
    image: f.image.trim(),
    // v514 · plugin tách "Tên-Giá" theo dấu "-" ĐẦU TIÊN → tên size không được chứa "-"; tự đổi thành "–".
    sizes: f.sizes.filter((s) => s.n.trim() && s.p.trim()).map((s) => `${s.n.trim().replace(/-/g, "–")}-${s.p.trim()}`),
    colors: f.colors.filter((c) => c.n.trim()).map((c) => `${c.n.trim()}|${(c.hex || "#cccccc").trim()}`),
    designs: [...(f.front ? ["front"] : []), ...(f.back ? ["back"] : [])].length ? [...(f.front ? ["front"] : []), ...(f.back ? ["back"] : [])] : ["front"],
    ...(f.ship.trim() ? { shipping: f.ship.trim() } : {}),
    ...(f.grp.trim() ? { group: f.grp.trim() } : {}),
  };
}

export default function WooProductTypesClient({ stores, canEdit }: { stores: StoreOpt[]; canEdit: boolean }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const store = stores.find((s) => s.id === storeId);
  const [styles, setStyles] = useState<Style[]>([]);
  const [needBridge, setNeedBridge] = useState(false);
  const [bridgeOld, setBridgeOld] = useState(false);   // v510 · bridge 1.0 chưa hỗ trợ shipping
  const [defShip, setDefShip] = useState("");          // v510 · shipping mặc định (sản phẩm mọi style)
  const [canEditTypes, setCanEditTypes] = useState(false); // admin (không scope): toàn quyền + default shipping
  const [canCreate, setCanCreate] = useState(false);        // v512 · seller được tạo type RIÊNG của mình
  const [typesNeedSql, setTypesNeedSql] = useState(false);  // v512 · bảng woo_type_owners chưa migrate
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 5000); };

  const load = useCallback(async (sid: string) => {
    if (!sid) return;
    setBusy(true);
    const j = await fetch(`/api/woo-product-types?storeId=${sid}`).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setBusy(false);
    if (j.ok) {
      setStyles(j.styles ?? []); setNeedBridge(!!j.needBridge); setCanEditTypes(!!j.canEditTypes);
      setCanCreate(!!j.canCreate); setTypesNeedSql(!!j.typesNeedSql);
      setDefShip(typeof j.defaultShipping === "string" ? j.defaultShipping : "");
      setBridgeOld(!j.needBridge && j.defaultShipping == null);
    }
    else flash("✗ " + (j.error ?? "Error"));
  }, []);
  useEffect(() => { load(storeId); }, [storeId, load]);

  const manageAll = canEdit && canEditTypes;                 // admin
  const canAdd = canEdit && (canEditTypes || canCreate);     // ai được bấm + New / Dup
  const rowEditable = (s0: Style) => canEdit && s0.mine !== false; // đồ mình (admin: tất cả)

  // ── Editor modal ──
  const [form, setForm] = useState<FormStyle | null>(null);
  const [editIndex, setEditIndex] = useState(-1); // -1 = new
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // v509 · Upload mockup từ máy → /api/woo-products/upload (nén client, storage FUSION trả URL).
  const uploadMockup = async (files: FileList | null) => {
    const f0 = files?.[0];
    if (!f0 || !form) return;
    setSaving(true);
    try {
      const dataUrl = await compressImage(f0);
      const j = await fetch("/api/woo-products/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl }) }).then((r) => r.json());
      if (j.ok && j.url) { setForm((f) => (f ? { ...f, image: j.url } : f)); flash("✓ Mockup uploaded"); }
      else flash("✗ " + (j.error ?? "upload error"));
    } catch { flash("✗ upload error"); }
    setSaving(false);
  };

  const openNew = () => { setEditIndex(-1); setForm({ name: "", image: "", sizes: [{ n: "One Size", p: "" }], colors: [], front: true, back: false, ship: "", grp: "" }); };
  const openEdit = (i: number) => { setEditIndex(i); setForm(toForm(styles[i])); };
  // Dup: khởi tạo style mới copy từ style có sẵn (đổi tên rồi lưu).
  const openDup = (i: number) => { setEditIndex(-1); setForm({ ...toForm(styles[i]), name: styles[i].styles + " (Copy)" }); };

  const persist = async (next: Style[], okMsg: string) => {
    setSaving(true);
    const j = await fetch("/api/woo-product-types", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, styles: next, defaultShipping: defShip }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setSaving(false);
    if (j.ok) { flash(okMsg); setForm(null); setStyles(next); }
    else flash("✗ " + (j.error ?? "Error"));
  };
  const save = async () => {
    if (!form) return;
    const s = fromForm(form);
    if (!s.styles) { flash("✗ Enter a style name"); return; }
    if (!s.sizes.length) { flash("✗ Add at least one size with a price"); return; }
    const dup = styles.findIndex((x) => x.styles.toLowerCase() === s.styles.toLowerCase());
    if (dup !== -1 && dup !== editIndex) { flash(`✗ A style named "${s.styles}" already exists`); return; }
    const next = [...styles];
    if (editIndex >= 0) next[editIndex] = s; else next.push(s);
    await persist(next, editIndex >= 0 ? "✓ Style updated on the store" : "✓ New product type added to the store");
  };
  const del = async (i: number) => {
    if (styles.length <= 1) { flash("✗ Can't delete the last style — the plugin needs at least one"); return; }
    if (!window.confirm(`Delete style "${styles[i].styles}"? Products limited to only this style will fall back to showing ALL styles.`)) return;
    await persist(styles.filter((_, x) => x !== i), "✓ Style deleted");
  };

  const setSize = (i: number, k: "n" | "p", v: string) => setForm((f) => f ? { ...f, sizes: f.sizes.map((s, x) => x === i ? { ...s, [k]: v } : s) } : f);
  const setColor = (i: number, k: "n" | "hex", v: string) => setForm((f) => f ? { ...f, colors: f.colors.map((c, x) => x === i ? { ...c, [k]: v } : c) } : f);

  const th: React.CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 800, color: "var(--muted)", letterSpacing: 0.5, textTransform: "uppercase", padding: "10px 12px", borderBottom: "1px solid var(--line)" };
  const td: React.CSSProperties = { padding: "12px", borderBottom: "1px solid var(--line)", verticalAlign: "middle", fontSize: 13 };

  if (!stores.length) {
    return <div className="panel empty">No WooCommerce store yet — create one in <b>Stores</b> (marketplace: WooCommerce), enter the REST API keys, then come back here.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 1100, margin: "0 auto", width: "100%" }}>
      {msg && <div style={{ position: "fixed", top: 70, right: 20, zIndex: 300, background: msg.startsWith("✓") ? "#1E7A3E" : "#B3261E", color: "#fff", padding: "10px 16px", borderRadius: 10, fontWeight: 700, fontSize: 13 }}>{msg}</div>}

      <div className="panel" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "14px 18px", background: "#F6F9FF", border: "1px solid #DFE8FA" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <MarketplaceLogo mk="woocommerce" size={34} />
          <b style={{ fontSize: 19 }}>Product Types · <span style={{ color: "#7F54B3" }}>WooCommerce</span></b>
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {canAdd && !needBridge && <button onClick={openNew} style={btnPri}>+ New product type</button>}
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} style={{ ...inp, width: 190 }}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={() => load(storeId)} style={btnBlue}>⟳ Refresh</button>
        </span>
      </div>

      {typesNeedSql && (
        <div className="panel" style={{ background: "#FFF3D6", border: "1px solid #EAD28A", padding: "12px 16px", fontSize: 13, lineHeight: 1.6 }}>
          Seller-created product types are off until the admin runs <b>MIGRATION_v512_woo_type_owners.sql</b> on Supabase — for now this page is read-only for sellers.
        </div>
      )}

      {bridgeOld && (
        <div className="panel" style={{ background: "#FFF3D6", border: "1px solid #EAD28A", padding: "12px 16px", fontSize: 13, lineHeight: 1.6 }}>
          Store đang chạy <b>WCP Fusion Bridge 1.0</b> — cập nhật lên <b>1.1</b> (upload <b>wcp-fusion-bridge-1.1.zip</b> trong WP admin → Plugins, đè lên bản cũ) để dùng tab <b>Shipping &amp; Delivery theo từng Product Type</b>. Các tính năng khác vẫn chạy bình thường.
        </div>
      )}

      {/* v510 · Shipping mặc định — cho sản phẩm KHÔNG giới hạn type (hiện tất cả style) */}
      {manageAll && !needBridge && !bridgeOld && (
        <div className="panel" style={{ padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <b style={{ fontSize: 13.5 }}>🚚 Default Shipping &amp; Delivery</b>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>shown on products with NO type ticked (all-styles products, e.g. áo 2D) — per-type shipping below overrides this</span>
            <button onClick={() => persist(styles, "✓ Default shipping saved")} disabled={saving || busy} style={{ ...btnBlue, marginLeft: "auto", padding: "7px 14px", fontSize: 12 }}>{saving ? "Saving…" : "Save default"}</button>
          </div>
          <textarea value={defShip} onChange={(e) => setDefShip(e.target.value)} rows={4} placeholder={"<p><strong>PROCESSING TIME</strong><br/>2–4 business days…</p>\n<p><strong>SHIPPING</strong><br/>US 5–10 · CA/UK/DE/AU 10–15 · Rest of world 10–20 business days</p>"} style={{ ...inp, resize: "vertical", fontFamily: "inherit", marginTop: 10 }} />
        </div>
      )}

      {needBridge && (
        <div className="panel" style={{ background: "#FFF3D6", border: "1px solid #EAD28A", padding: "14px 18px", fontSize: 13, lineHeight: 1.6 }}>
          <b>One-time setup:</b> this store doesn&apos;t have the <b>WCP Fusion Bridge</b> plugin yet, so FUSION can&apos;t read/write its product types.
          Install <b>wcp-fusion-bridge.zip</b> in the store&apos;s WP admin → <b>Plugins → Add New → Upload Plugin → Activate</b>, then hit Refresh. No settings needed — it uses the same API keys already entered in FUSION.
        </div>
      )}

      <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead><tr>
            <th style={{ ...th, width: 64 }}>Mockup</th>
            <th style={th}>Style name</th>
            <th style={{ ...th, width: 230 }}>Sizes · price</th>
            <th style={{ ...th, width: 90 }}>Colors</th>
            <th style={{ ...th, width: 110 }}>Print sides</th>
            {canAdd && <th style={{ ...th, width: 170 }}>Actions</th>}
          </tr></thead>
          <tbody>
            {styles.map((s, i) => {
              const prices = s.sizes.map((x) => Number(x.slice(x.lastIndexOf("-") + 1))).filter((n) => n > 0);
              const lo = Math.min(...prices), hi = Math.max(...prices);
              return (
                <tr key={s.styles + i}>
                  <td style={td}>
                    <div style={{ width: 46, height: 46, borderRadius: 10, overflow: "hidden", background: "#F1F3F8", display: "grid", placeItems: "center", color: "var(--muted)", fontSize: 18 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {s.image ? <img src={s.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "👕"}
                    </div>
                  </td>
                  <td style={td}><b>{s.styles}</b>{s.group ? <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 99, background: "#F0E9FA", color: "#7F54B3" }}>{s.group}</span> : null}{s.shipping ? <span title="Has its own Shipping & Delivery tab" style={{ marginLeft: 6, fontSize: 12 }}>🚚</span> : null}
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{s.ownerName ? `by ${s.ownerName}` : "by Admin"}{!rowEditable(s) && canAdd ? " · read-only" : ""}</div>
                  </td>
                  <td style={td}>
                    <div style={{ fontSize: 12.5 }}>{s.sizes.length} sizes · {prices.length ? (lo === hi ? `$${lo}` : `$${lo} – $${hi}`) : "—"}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{s.sizes.map((x) => x.slice(0, x.lastIndexOf("-"))).join(", ").slice(0, 60)}</div>
                  </td>
                  <td style={td}>
                    <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
                      {s.colors.slice(0, 6).map((c, x) => <span key={x} title={c.split("|")[0]} style={{ width: 13, height: 13, borderRadius: 99, background: c.split("|")[1] || "#ccc", border: "1px solid rgba(0,0,0,.15)" }} />)}
                      {s.colors.length > 6 && <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 3 }}>+{s.colors.length - 6}</span>}
                      {!s.colors.length && <span style={{ fontSize: 12, color: "var(--muted)" }}>—</span>}
                    </span>
                  </td>
                  <td style={td}><span style={{ fontSize: 12 }}>{(s.designs ?? []).join(" + ") || "front"}</span></td>
                  {canAdd && (
                    <td style={td}>
                      <span style={{ display: "inline-flex", gap: 6 }}>
                        {rowEditable(s) && <button onClick={() => openEdit(i)} style={{ ...btnGhost, padding: "5px 12px", fontSize: 12 }}>✎ Edit</button>}
                        <button onClick={() => openDup(i)} style={{ ...btnGhost, padding: "5px 12px", fontSize: 12 }}>Dup</button>
                        {rowEditable(s) && <button onClick={() => del(i)} disabled={saving} style={{ ...btnGhost, padding: "5px 12px", fontSize: 12, color: "var(--red)" }}>Del</button>}
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
            {!styles.length && !busy && !needBridge && <tr><td colSpan={canAdd ? 6 : 5} style={{ ...td, textAlign: "center", color: "var(--muted)", padding: 30 }}>No product types yet</td></tr>}
          </tbody>
        </table>
        {busy && <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: 14 }}>Loading…</div>}
      </div>

      {/* Editor modal */}
      {form && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,20,40,.55)", zIndex: 200, overflowY: "auto", padding: "36px 16px" }} onClick={() => !saving && setForm(null)}>
          <div className="panel" style={{ width: 680, maxWidth: "100%", padding: 18, margin: "0 auto", background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 24px 70px rgba(15,20,40,.35)" }} onClick={(e) => e.stopPropagation()}>
            <b style={{ fontSize: 15 }}>{editIndex >= 0 ? `Edit style · ${styles[editIndex]?.styles}` : "New product type"}</b>
            <div className="m-stack-sm" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px", marginTop: 12 }}>
              <label style={{ display: "block", marginBottom: 10 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>Style name (shown to buyers)</div>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Pajama Set / Desk Calendar / Story Book…" style={inp} />
              </label>
              <label style={{ display: "block", marginBottom: 10 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>Mockup thumbnail (upload or paste a URL)</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={saving}
                    style={{ width: 44, height: 44, borderRadius: 10, border: form.image ? "1px solid var(--line)" : "1.5px dashed var(--line)", background: "#F8F9FC", padding: 0, overflow: "hidden", cursor: "pointer", color: "var(--muted)", fontSize: 18, flexShrink: 0, display: "grid", placeItems: "center" }}
                    title="Upload mockup image">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {form.image ? <img src={form.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "+"}
                  </button>
                  <input value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} placeholder="Click + to upload, or paste https://…" style={inp} />
                  {form.image && <button type="button" onClick={() => setForm({ ...form, image: "" })} style={{ ...btnGhost, padding: "7px 10px", fontSize: 12, flexShrink: 0 }}>✕</button>}
                  <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { uploadMockup(e.target.files); e.target.value = ""; }} />
                </div>
              </label>
            </div>

            <label style={{ display: "block", marginBottom: 10 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>Group (optional — types cùng Group gộp thành 1 chip khi list; khách vẫn thấy từng style riêng ngoài site)</div>
              <input value={form.grp} onChange={(e) => setForm({ ...form, grp: e.target.value })} placeholder={"Men's Pajama"} style={inp} />
            </label>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", margin: "4px 0 6px" }}>Sizes &amp; prices ($) — for one-size items use &quot;One Size&quot;. Don&apos;t use &quot;-&quot; in size names (auto-converted to &quot;–&quot;)</div>
            <div style={{ display: "grid", gap: 6 }}>
              {form.sizes.map((s, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 130px 34px", gap: 8, alignItems: "center" }}>
                  <input value={s.n} onChange={(e) => setSize(i, "n", e.target.value)} placeholder="Size name (S, 2XL, One Size…)" style={inp} />
                  <input value={s.p} onChange={(e) => setSize(i, "p", e.target.value.replace(/[^\d.]/g, ""))} placeholder="18.99" style={inp} />
                  <button type="button" onClick={() => setForm({ ...form, sizes: form.sizes.filter((_, x) => x !== i) })} style={{ ...btnGhost, padding: "7px 0", fontSize: 13 }}>✕</button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setForm({ ...form, sizes: [...form.sizes, { n: "", p: "" }] })} style={{ ...btnGhost, padding: "6px 14px", fontSize: 12, marginTop: 8 }}>+ Add size</button>

            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", margin: "16px 0 6px" }}>Colors (optional — leave empty for products without color choice, e.g. calendars/books)</div>
            <div style={{ display: "grid", gap: 6 }}>
              {form.colors.map((c, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 52px 34px", gap: 8, alignItems: "center" }}>
                  <input value={c.n} onChange={(e) => setColor(i, "n", e.target.value)} placeholder="Color name (Black, Navy…)" style={inp} />
                  <input type="color" value={/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : "#cccccc"} onChange={(e) => setColor(i, "hex", e.target.value)} style={{ width: 52, height: 38, padding: 2, border: "1px solid var(--line)", borderRadius: 10, background: "#fff", cursor: "pointer" }} />
                  <button type="button" onClick={() => setForm({ ...form, colors: form.colors.filter((_, x) => x !== i) })} style={{ ...btnGhost, padding: "7px 0", fontSize: 13 }}>✕</button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setForm({ ...form, colors: [...form.colors, { n: "", hex: "#000000" }] })} style={{ ...btnGhost, padding: "6px 14px", fontSize: 12, marginTop: 8 }}>+ Add color</button>

            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", margin: "16px 0 6px" }}>Shipping &amp; Delivery for this type (HTML — shows as a tab on product pages selling this type; empty = use store default)</div>
            <textarea value={form.ship} onChange={(e) => setForm({ ...form, ship: e.target.value })} rows={4} placeholder={"<p><strong>PROCESSING TIME</strong><br/>Calendars: 3–5 business days…</p>"} style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} />

            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", margin: "16px 0 6px" }}>Print sides buyers can choose designs for</div>
            <div style={{ display: "flex", gap: 16 }}>
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={form.front} onChange={(e) => setForm({ ...form, front: e.target.checked })} /> Front</label>
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={form.back} onChange={(e) => setForm({ ...form, back: e.target.checked })} /> Back</label>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setForm(null)} disabled={saving} style={btnGhost}>Cancel</button>
              <button onClick={save} disabled={saving} style={btnBlue}>{saving ? "Saving…" : editIndex >= 0 ? "Save changes" : "Add product type"}</button>
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10, lineHeight: 1.5 }}>
              Saved straight to <b>{store?.name}</b> — the store keeps automatic backups of the last 10 versions.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
