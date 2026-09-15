"use client";
/**
 * MANAGE TEMPLATES WOOCOMMERCE (v504, nâng v507 theo khuôn ShopBase) — template = khuôn listing:
 * thumbnail mockup, title mẫu, description chuẩn, giá, categories, tags, status, và (v507)
 * PRODUCT TYPES — Apply template ở Manage Products là tự tick đúng loại sản phẩm.
 * (Variants/size/màu vẫn do plugin Woo Custom Pro trên store lo — khác ShopBase ở điểm đó.)
 */
import { useCallback, useEffect, useState } from "react";
import { MarketplaceLogo } from "@/components/marketplace-logo";

type StoreOpt = { id: string; name: string; sellerId: string | null; sellerName: string | null };
type Cat = { id: number; name: string; parent: number; count: number; slug: string };
type Tpl = { id: string; name: string; title: string | null; description: string | null; price: string | null; salePrice: string | null; categoryIds: number[]; tags: string | null; status: string; thumb?: string | null; wcpStyles?: string[]; editable?: boolean; creator?: string; createdAt?: string };

const inp: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13.5, background: "#fff" };
const btnPri: React.CSSProperties = { background: "var(--ink)", color: "#fff", border: 0, borderRadius: 12, padding: "10px 18px", fontWeight: 800, fontSize: 13, cursor: "pointer" };
const btnBlue: React.CSSProperties = { background: "var(--blue)", color: "#fff", border: 0, borderRadius: 12, padding: "10px 18px", fontWeight: 800, fontSize: 13, cursor: "pointer" };
const btnGhost: React.CSSProperties = { background: "#fff", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer" };

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: "block", marginBottom: 10 }}><div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>{label}</div>{children}</label>;
}

export default function WooTemplatesClient({ stores, canEdit }: { stores: StoreOpt[]; canEdit: boolean }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const store = stores.find((x) => x.id === storeId);
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [ptypes, setPtypes] = useState<string[]>([]); // v507 · Product Types trên store (từ plugin)
  const [needSql, setNeedSql] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 5000); };

  const load = useCallback(async (sid: string) => {
    if (!sid) return;
    setBusy(true);
    const [t, c, pt] = await Promise.all([
      fetch(`/api/woo-products/templates?storeId=${sid}`).then((r) => r.json()).catch(() => ({ ok: false })),
      fetch(`/api/woo-products/categories?storeId=${sid}`).then((r) => r.json()).catch(() => ({ ok: false })),
      fetch(`/api/woo-product-types?storeId=${sid}`).then((r) => r.json()).catch(() => ({ ok: false })),
    ]);
    setBusy(false);
    if (t.ok) { setTpls((t.templates ?? []).map((x: Tpl) => ({ ...x, categoryIds: Array.isArray(x.categoryIds) ? x.categoryIds : [], wcpStyles: Array.isArray(x.wcpStyles) ? x.wcpStyles : [] }))); setNeedSql(!!t.needMigration); }
    if (c.ok) setCats(c.categories ?? []);
    setPtypes(pt.ok ? (pt.styles ?? []).map((s: { styles?: string }) => String(s.styles ?? "")).filter(Boolean) : []);
  }, []);
  useEffect(() => { load(storeId); }, [storeId, load]);

  const parents = cats.filter((c) => c.parent === 0);
  const catLabel = (c: Cat) => (c.parent ? `— ${c.name}` : c.name);
  const sortedCats = [...parents.map((p) => [p, ...cats.filter((c) => c.parent === p.id)]).flat()];

  // ── Editor modal (v507 · bố cục theo ShopBase: thumbnail + name/status + types) ──
  const empty = { id: "", name: "", title: "", description: "", price: "", salePrice: "", categoryIds: [] as number[], tags: "", status: "publish", thumb: "", wcpStyles: [] as string[] };
  const [form, setForm] = useState<typeof empty | null>(null);
  const [saving, setSaving] = useState(false);
  const openNew = () => setForm({ ...empty });
  const openEdit = (t: Tpl) => setForm({
    id: t.id, name: t.name, title: t.title ?? "", description: t.description ?? "",
    price: t.price ?? "", salePrice: t.salePrice ?? "", categoryIds: [...t.categoryIds],
    tags: t.tags ?? "", status: t.status === "draft" ? "draft" : "publish",
    thumb: t.thumb ?? "", wcpStyles: Array.isArray(t.wcpStyles) ? [...t.wcpStyles] : [],
  });
  const openDup = (t: Tpl) => { openEdit(t); setForm((f) => (f ? { ...f, id: "", name: t.name + " (Copy)" } : f)); };
  const save = async () => {
    if (!form) return;
    if (!form.name.trim()) { flash("✗ Enter a template name"); return; }
    setSaving(true);
    const body = JSON.stringify({ storeId, template: { ...form, id: form.id || undefined } });
    const j = await fetch("/api/woo-products/templates", { method: form.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setSaving(false);
    if (j.ok) { flash(j.warn ? "⚠ " + j.warn : form.id ? "✓ Template updated" : "✓ Template created"); setForm(null); load(storeId); }
    else flash("✗ " + (j.error ?? "Error"));
  };
  const del = async (t: Tpl) => {
    if (!window.confirm(`Delete template "${t.name}"?`)) return;
    const j = await fetch(`/api/woo-products/templates?storeId=${storeId}&id=${t.id}`, { method: "DELETE" }).then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    if (j.ok) { flash("✓ Template deleted"); setTpls((l) => l.filter((x) => x.id !== t.id)); } else flash("✗ " + (j.error ?? "Error"));
  };


  if (!stores.length) {
    return <div className="panel empty">No WooCommerce store yet — create one in <b>Stores</b> first.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 1440, margin: "0 auto", width: "100%" }}>
      {msg && <div style={{ position: "fixed", top: 70, right: 20, zIndex: 300, background: msg.startsWith("✓") ? "#1E7A3E" : msg.startsWith("⚠") ? "#8A6D1A" : "#B3261E", color: "#fff", padding: "10px 16px", borderRadius: 10, fontWeight: 700, fontSize: 13 }}>{msg}</div>}

      <div className="panel" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "14px 18px", background: "#F6F9FF", border: "1px solid #DFE8FA" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
          <MarketplaceLogo mk="woocommerce" size={40} />
          <span>
            <b style={{ fontSize: 19, display: "block", lineHeight: 1.2 }}>Manage Templates · <span style={{ color: "#7F54B3" }}>WooCommerce</span></b>
            <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>{tpls.length} templates</span>
          </span>
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {canEdit && <button onClick={openNew} style={btnPri}>+ New template</button>}
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} style={{ ...inp, width: 190 }}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={() => load(storeId)} style={btnBlue}>⟳ Refresh</button>
        </span>
      </div>

      {needSql && <div className="panel" style={{ padding: "12px 16px", background: "#FFF3D6", border: "1px solid #EAD28A", fontSize: 13 }}>Run <b>MIGRATION_v502_woo_templates.sql</b> then <b>MIGRATION_v507_woo_template_upgrade.sql</b> on Supabase — the templates table/columns are missing.</div>}

      {/* v511 · Danh sách template dạng CARD theo khuôn ShopBase */}
      <div style={{ display: "grid", gap: 12 }}>
        {tpls.map((t) => (
          <div key={t.id} className="panel" style={{ display: "flex", gap: 16, alignItems: "center", padding: "14px 18px" }}>
            <div style={{ width: 72, height: 72, borderRadius: 12, overflow: "hidden", background: "#F1F3F8", border: "1px solid var(--line)", display: "grid", placeItems: "center", color: "var(--muted)", fontSize: 24, flexShrink: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {t.thumb ? <img src={t.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "\ud83d\uddbc"}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div onClick={() => canEdit && t.editable !== false && openEdit(t)} style={{ color: "var(--blue)", fontWeight: 800, fontSize: 16.5, cursor: canEdit && t.editable !== false ? "pointer" : "default", lineHeight: 1.3 }}>{t.name}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>
                {store?.name ?? "—"} · {t.wcpStyles?.length ? `Types (${t.wcpStyles.length}): ${t.wcpStyles.join(", ").slice(0, 60)}${t.wcpStyles.join(", ").length > 60 ? "…" : ""}` : "All styles"} · ${t.price ?? "—"}{t.salePrice ? ` / sale $${t.salePrice}` : ""} · {t.categoryIds.length} categories ·{" "}
                <span style={{ fontWeight: 800, color: t.status === "publish" ? "#2E7D46" : "#8A6D1A" }}>{t.status === "publish" ? "ACTIVE" : "DRAFT"}</span> · by <b>{t.creator || "Admin"}</b>{t.editable === false ? " · read-only" : ""}
              </div>
              {t.title ? <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{t.title.slice(0, 90)}{t.title.length > 90 ? "…" : ""}</div> : null}
            </div>
            {canEdit && (
              <span style={{ display: "inline-flex", gap: 8, flexShrink: 0 }}>
                <button onClick={() => openDup(t)} style={{ ...btnGhost, padding: "8px 16px", fontSize: 12.5 }}>Dup</button>
                {t.editable !== false && <button onClick={() => del(t)} style={{ ...btnGhost, padding: "8px 16px", fontSize: 12.5, color: "var(--red)", borderColor: "#F3C2C0" }}>Delete</button>}
              </span>
            )}
          </div>
        ))}
        {!tpls.length && !busy && !needSql && (
          <div className="panel" style={{ textAlign: "center", color: "var(--muted)", padding: 30, fontSize: 13 }}>
            No templates yet — create one with <b>+ New template</b>, or from Manage Products via <b>Save as template</b>.
          </div>
        )}
        {busy && <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: 14 }}>Loading…</div>}
      </div>

      {/* Editor modal — v507 bố cục theo ShopBase */}
      {form && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,20,40,.55)", zIndex: 200, overflowY: "auto", padding: "36px 16px" }} onClick={() => !saving && setForm(null)}>
          <div className="panel" style={{ width: 760, maxWidth: "100%", padding: 22, margin: "0 auto", background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 24px 70px rgba(15,20,40,.35)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <b style={{ fontSize: 17 }}>{form.id ? "Edit template" : "New template"}</b>
              <button onClick={() => !saving && setForm(null)} style={{ marginLeft: "auto", border: 0, background: "transparent", fontSize: 20, cursor: "pointer", color: "var(--muted)", lineHeight: 1 }}>✕</button>
            </div>

            {/* Thumbnail (như ShopBase) */}
            <div style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: 14, alignItems: "start", marginTop: 14 }}>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 4 }}>Thumbnail</div>
                <div style={{ width: 84, height: 84, borderRadius: 12, overflow: "hidden", background: "#F1F3F8", border: "1px solid var(--line)", display: "grid", placeItems: "center", color: "var(--muted)", fontSize: 24 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {form.thumb ? <img src={form.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "🖼"}
                </div>
              </div>
              <L label="Thumbnail image URL (mockup — 'Save as template' from a product auto-fills its first image)">
                <input value={form.thumb} onChange={(e) => setForm({ ...form, thumb: e.target.value })} placeholder="https://…/mockup.jpg" style={inp} />
              </L>
            </div>

            <div className="m-stack-sm" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px", marginTop: 4 }}>
              <L label="Template name (internal — e.g. 'Wall Calendars 2027')"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inp} /></L>
              <L label="Default status">
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} style={inp}>
                  <option value="publish">Publish (live on store)</option>
                  <option value="draft">Draft (hidden)</option>
                </select>
              </L>
              <div style={{ gridColumn: "1 / -1" }}>
                <L label="Title pattern (pre-fills the product title)"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Personalized … Wall Calendar 2027, …" style={inp} /></L>
              </div>
              <L label="Price ($ — nên = giá size thấp nhất của type)"><input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="24.99" style={inp} /></L>
              <div />
              <div style={{ gridColumn: "1 / -1" }}>
                <L label="Description (HTML allowed — leave empty to write per product)">
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={7} style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} />
                </L>
              </div>
              {ptypes.length > 0 && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <L label="Product types (v507 — Apply template auto-ticks these; none = ALL styles show)">
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {ptypes.map((t) => {
                        const on = form.wcpStyles.includes(t);
                        return (
                          <button key={t} type="button"
                            onClick={() => setForm({ ...form, wcpStyles: on ? form.wcpStyles.filter((x) => x !== t) : [...form.wcpStyles, t] })}
                            style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: 99, cursor: "pointer", border: on ? "1px solid #7F54B3" : "1px solid var(--line)", background: on ? "#7F54B3" : "#fff", color: on ? "#fff" : "var(--ink)" }}>
                            {t}
                          </button>
                        );
                      })}
                    </div>
                  </L>
                </div>
              )}
              <div style={{ gridColumn: "1 / -1" }}>
                <L label="Categories (public collections — sellers can't see or pick these; applied automatically when they use this template)">
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
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={() => setForm(null)} disabled={saving} style={btnGhost}>Cancel</button>
              <button onClick={save} disabled={saving} style={btnBlue}>{saving ? "Saving…" : form.id ? "Save changes" : "Create template"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
