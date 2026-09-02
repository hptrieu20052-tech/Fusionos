"use client";
import { useEffect, useRef, useState } from "react";

type Variant = { id: string; title?: string; price?: string; compareAtPrice?: string | null; sku?: string; barcode?: string; inventoryQty?: number | null; selectedOptions?: { name: string; value: string }[] };
type Img = { id?: string; src?: string; altText?: string; position?: number };
type Detail = {
  id: string; shopbaseProductId: string; handle: string; title: string; bodyHtml: string;
  vendor: string; productType: string; tags: string; status: string;
  onlineStoreUrl: string | null; storeName: string;
  options: { name: string; position: number; values: string[] }[];
  variants: Variant[]; images: Img[];
};

const SB_BLUE = "#2F6BFF";
const lab: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--muted)", margin: "0 0 6px" };
const fld: React.CSSProperties = { width: "100%", padding: "9px 11px", border: "1px solid var(--line)", borderRadius: 9, fontSize: 13.5, boxSizing: "border-box" };
const sec: React.CSSProperties = { marginBottom: 18 };

export default function ShopbaseEditModal({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const dragFrom = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/shopbase-products?id=${id}`).then((r) => r.json()).then((j) => {
      if (!alive) return;
      if (!j.ok) { setErr(j.error || "Load failed"); setLoading(false); return; }
      setD(j.product); setLoading(false);
    }).catch((e) => { if (alive) { setErr(String(e)); setLoading(false); } });
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [busy, onClose]);

  const set = (patch: Partial<Detail>) => setD((p) => (p ? { ...p, ...patch } : p));
  const setVar = (i: number, patch: Partial<Variant>) => setD((p) => p ? { ...p, variants: p.variants.map((v, j) => j === i ? { ...v, ...patch } : v) } : p);
  const applyBase = () => { if (basePrice) setD((p) => p ? { ...p, variants: p.variants.map((v) => ({ ...v, price: basePrice })) } : p); };

  // ── Options ⇄ Variants (mirror Shopify): sửa option name/values → tự sinh lại tổ hợp variant,
  // giữ nguyên price/compare/SKU của tổ hợp đã có (khớp theo chữ ký selectedOptions). ──────────
  const sigOf = (so: { name: string; value: string }[]) => (so ?? []).map((x) => `${x.name}=${x.value}`).join("|");
  const recompute = (raw: { name: string; position: number; values: string[] }[]) => setD((p) => {
    if (!p) return p;
    const options = raw.map((o, i) => ({ ...o, position: i + 1 }));
    const opts = options.map((o) => ({ name: (o.name || "").trim(), values: (o.values ?? []).map((v) => v.trim()).filter(Boolean) })).filter((o) => o.name && o.values.length);
    const prev = new Map(p.variants.map((v) => [sigOf(v.selectedOptions ?? []), v] as const));
    if (!opts.length) {
      const keep = p.variants[0];
      return { ...p, options, variants: [{ id: keep?.id ?? "", title: "Default Title", selectedOptions: [], price: keep?.price ?? "0", compareAtPrice: keep?.compareAtPrice ?? null, sku: keep?.sku ?? "", barcode: keep?.barcode ?? "", inventoryQty: keep?.inventoryQty ?? null }] };
    }
    let combos: { name: string; value: string }[][] = [[]];
    for (const o of opts) { const next: { name: string; value: string }[][] = []; for (const c of combos) for (const val of o.values) next.push([...c, { name: o.name, value: val }]); combos = next; }
    const variants: Variant[] = combos.slice(0, 200).map((so) => {
      const ex = prev.get(sigOf(so));
      return ex ? { ...ex, selectedOptions: so, title: so.map((x) => x.value).join(" / ") }
        : { id: "", title: so.map((x) => x.value).join(" / "), selectedOptions: so, price: "0", compareAtPrice: null, sku: "", barcode: "", inventoryQty: null };
    });
    return { ...p, options, variants };
  });
  const setOptName = (i: number, name: string) => recompute((d?.options ?? []).map((o, k) => k === i ? { ...o, name } : o));
  const setOptValues = (i: number, csv: string) => recompute((d?.options ?? []).map((o, k) => k === i ? { ...o, values: csv.split(",").map((v) => v.trim()).filter(Boolean) } : o));
  const addOption = () => { const os = d?.options ?? []; if (os.length >= 3) return; recompute([...os, { name: os.length === 0 ? "Size" : "", position: os.length + 1, values: [] }]); };
  const delOption = (i: number) => recompute((d?.options ?? []).filter((_, k) => k !== i));

  const delImg = (idx: number) => setD((p) => p ? { ...p, images: p.images.filter((_, i) => i !== idx) } : p);
  const moveImg = (from: number, to: number) => setD((p) => {
    if (!p || from === to || from < 0 || to < 0 || from >= p.images.length || to >= p.images.length) return p;
    const a = p.images.slice(); const [x] = a.splice(from, 1); a.splice(to, 0, x); return { ...p, images: a };
  });
  const addByUrl = () => {
    const url = window.prompt("Dán URL ảnh (https://...)");
    if (!url || !/^https?:\/\//i.test(url.trim())) return;
    setD((p) => p ? { ...p, images: [...p.images, { src: url.trim(), altText: "", position: p.images.length + 1 }] } : p);
  };

  const save = async () => {
    if (!d) return;
    setBusy(true); setMsg("Saving & updating ShopBase…");
    try {
      const j = await fetch("/api/shopbase-products", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        id: d.id, title: d.title, bodyHtml: d.bodyHtml, vendor: d.vendor, productType: d.productType,
        tags: d.tags, status: d.status, options: d.options, variants: d.variants, images: d.images,
      }) }).then((r) => r.json());
      if (j.ok) { setMsg("✓ Saved" + (j.warn ? " · " + j.warn : " & updated on ShopBase")); onSaved(); setTimeout(() => onClose(), 700); }
      else setMsg("✗ " + (j.error || "Save failed"));
    } catch (e) { setMsg("✗ " + String((e as Error)?.message ?? e)); }
    setBusy(false);
  };

  const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(15,23,38,.45)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "3vh 16px", overflowY: "auto" };
  const panel: React.CSSProperties = { background: "#fff", borderRadius: 14, width: "100%", maxWidth: 1040, boxShadow: "0 20px 60px rgba(0,0,0,.3)", display: "flex", flexDirection: "column", maxHeight: "94vh" };
  const colWrap: React.CSSProperties = { display: "flex", gap: 26, flexWrap: "wrap", alignItems: "flex-start" };
  const col: React.CSSProperties = { flex: "1 1 380px", minWidth: 0 };

  return (
    <div style={overlay} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div style={panel} onMouseDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", borderBottom: "1px solid var(--line)" }}>
          <h2 style={{ margin: 0, fontSize: 18, color: "#14213D" }}>Edit product · <span style={{ color: SB_BLUE }}>ShopBase</span></h2>
          <button onClick={() => !busy && onClose()} title="Close" style={{ background: "none", border: "1px solid var(--line)", borderRadius: 8, width: 32, height: 32, cursor: busy ? "default" : "pointer", fontSize: 17, lineHeight: 1, color: "var(--muted)" }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: 22, overflowY: "auto" }}>
          {loading ? <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Loading product…</div>
          : err ? <div style={{ padding: 40, textAlign: "center", color: "var(--red)" }}>✗ {err}</div>
          : d ? (
          <>
            <div style={colWrap}>
              {/* LEFT: Status + Images */}
              <div style={col}>
                <div style={sec}>
                  <label style={lab}>Status</label>
                  <select value={d.status} onChange={(e) => set({ status: e.target.value })} style={fld}>
                    <option value="ACTIVE">ACTIVE (available)</option>
                    <option value="DRAFT">DRAFT (unavailable)</option>
                    <option value="ARCHIVED">ARCHIVED</option>
                  </select>
                </div>

                <div style={sec}>
                  <label style={lab}>Images <span style={{ color: "var(--faint)", fontWeight: 500 }}>({d.images.length}) · kéo để sắp xếp · ảnh đầu = ảnh chính</span></label>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {d.images.map((im, i) => (
                      <div key={(im.id || "") + i}
                        draggable
                        onDragStart={() => { dragFrom.current = i; }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => { e.preventDefault(); if (dragFrom.current !== null) moveImg(dragFrom.current, i); dragFrom.current = null; }}
                        style={{ position: "relative", width: 88, height: 88, cursor: "grab" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={im.src || undefined} alt="" style={{ width: 88, height: 88, objectFit: "cover", borderRadius: 8, border: i === 0 ? `2px solid ${SB_BLUE}` : "1px solid var(--line)" }} />
                        {i === 0 && <span style={{ position: "absolute", left: 4, top: 4, background: SB_BLUE, color: "#fff", fontSize: 9, fontWeight: 800, borderRadius: 4, padding: "1px 5px" }}>MAIN</span>}
                        <button type="button" onClick={() => delImg(i)} title="Delete" style={{ position: "absolute", right: -6, top: -6, width: 20, height: 20, borderRadius: "50%", background: "var(--red)", color: "#fff", border: 0, cursor: "pointer", fontSize: 13, lineHeight: 1 }}>×</button>
                      </div>
                    ))}
                    <button type="button" onClick={addByUrl} style={{ width: 88, height: 88, border: "1.5px dashed var(--line)", borderRadius: 8, background: "#fff", cursor: "pointer", color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>+ Add by URL</button>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 6 }}>Kéo-thả đổi thứ tự · × xoá. Ảnh đầu là ảnh chính. (Thêm ảnh bằng URL công khai.)</div>
                </div>

                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
                  Store: {d.storeName} · handle: {d.handle || "—"}{d.onlineStoreUrl ? <> · <a href={d.onlineStoreUrl} target="_blank" rel="noreferrer" style={{ color: SB_BLUE, textDecoration: "none", fontWeight: 700 }}>Open ↗</a></> : null}
                </div>
              </div>

              {/* RIGHT: Title + Vendor/Type + Tags + Description + Variants */}
              <div style={col}>
                <div style={sec}>
                  <label style={lab}>Title</label>
                  <input value={d.title} onChange={(e) => set({ title: e.target.value })} style={fld} />
                </div>

                <div style={{ ...sec, display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 160px" }}>
                    <label style={lab}>Vendor</label>
                    <input value={d.vendor} onChange={(e) => set({ vendor: e.target.value })} style={fld} />
                  </div>
                  <div style={{ flex: "1 1 160px" }}>
                    <label style={lab}>Type</label>
                    <input value={d.productType} onChange={(e) => set({ productType: e.target.value })} style={fld} />
                  </div>
                </div>

                <div style={sec}>
                  <label style={lab}>Tags (comma-separated)</label>
                  <input value={d.tags} onChange={(e) => set({ tags: e.target.value })} style={fld} />
                </div>

                <div style={sec}>
                  <label style={lab}>Description (HTML)</label>
                  <textarea value={d.bodyHtml} onChange={(e) => set({ bodyHtml: e.target.value })} rows={8} style={{ ...fld, fontFamily: "ui-monospace, monospace", fontSize: 12.5, lineHeight: 1.5, resize: "vertical" }} />
                </div>

                <div style={sec}>
                  <label style={lab}>Options</label>
                  <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                    {(d.options ?? []).map((o, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input value={o.name} onChange={(e) => setOptName(i, e.target.value)} placeholder="Option name" style={{ ...fld, flex: "0 0 150px" }} />
                        <input value={(o.values ?? []).join(", ")} onChange={(e) => setOptValues(i, e.target.value)} placeholder="Values, comma-separated" style={fld} />
                        <button type="button" onClick={() => delOption(i)} title="Remove option" style={{ flex: "0 0 auto", width: 34, height: 34, borderRadius: 8, border: "1px solid var(--line)", background: "#fff", cursor: "pointer", color: "var(--muted)", fontSize: 16, lineHeight: 1 }}>×</button>
                      </div>
                    ))}
                    {(d.options?.length ?? 0) < 3 && (
                      <button type="button" onClick={addOption} style={{ alignSelf: "flex-start", border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", color: "#14213D" }}>+ Add option</button>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 6 }}>Sửa option/giá trị sẽ tự sinh lại tổ hợp variants bên dưới (giữ giá/SKU của tổ hợp đã có). ⚠ Tổ hợp bị bỏ sẽ bị xoá khỏi ShopBase khi Save.</div>
                </div>

                <div style={sec}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                    <label style={{ ...lab, margin: 0 }}>Variants — price / compare-at / SKU <span style={{ color: "var(--faint)", fontWeight: 500 }}>({d.variants.length})</span></label>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>Đặt giá cho tất cả:</span>
                      <input value={basePrice} onChange={(e) => setBasePrice(e.target.value)} inputMode="decimal" placeholder="0.00" style={{ ...fld, width: 90, padding: "6px 8px" }} />
                      <button onClick={applyBase} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, cursor: "pointer", background: "#fff" }}>Apply</button>
                    </div>
                  </div>
                  <div style={{ maxHeight: 320, overflowY: "auto", overflowX: "auto", border: "1px solid var(--line)", borderRadius: 10 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 11.5, position: "sticky", top: 0, background: "#fff", boxShadow: "0 1px 0 var(--line)", zIndex: 1 }}>
                          <th style={{ padding: "8px 10px" }}>Variant</th><th style={{ padding: "8px 10px", width: 96 }}>Price</th><th style={{ padding: "8px 10px", width: 96 }}>Compare-at</th><th style={{ padding: "8px 10px", width: 150 }}>SKU</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.variants.map((v, i) => (
                          <tr key={v.id || i} style={{ borderTop: "1px solid var(--line)" }}>
                            <td style={{ padding: "6px 6px" }}>{v.title || (v.selectedOptions ?? []).map((o) => o.value).join(" / ") || "(default)"}</td>
                            <td style={{ padding: "6px 6px" }}><input value={v.price ?? ""} onChange={(e) => setVar(i, { price: e.target.value })} inputMode="decimal" style={{ ...fld, padding: "6px 8px" }} /></td>
                            <td style={{ padding: "6px 6px" }}><input value={v.compareAtPrice ?? ""} onChange={(e) => setVar(i, { compareAtPrice: e.target.value })} inputMode="decimal" style={{ ...fld, padding: "6px 8px" }} /></td>
                            <td style={{ padding: "6px 6px" }}><input value={v.sku ?? ""} onChange={(e) => setVar(i, { sku: e.target.value })} style={{ ...fld, padding: "6px 8px" }} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {msg && <div style={{ fontSize: 13, margin: "6px 0 4px", color: msg.startsWith("✗") ? "var(--red)" : "#217A3B" }}>{msg}</div>}
          </>
          ) : null}
        </div>

        {/* Footer */}
        {!loading && !err && (
          <div style={{ display: "flex", gap: 10, padding: "14px 22px", borderTop: "1px solid var(--line)" }}>
            <button onClick={save} disabled={busy} style={{ background: SB_BLUE, color: "#fff", border: 0, borderRadius: 9, padding: "10px 22px", fontWeight: 800, fontSize: 14, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
              {busy ? "Saving…" : "Save (auto-updates ShopBase)"}
            </button>
            <button onClick={() => !busy && onClose()} disabled={busy} style={{ background: "none", border: "1px solid var(--line)", borderRadius: 9, padding: "10px 18px", fontSize: 13, cursor: busy ? "default" : "pointer", marginLeft: "auto" }}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}
