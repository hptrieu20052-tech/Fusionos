"use client";
import { useCallback, useEffect, useState } from "react";

/**
 * v484 · Studio "Create Your Own" — trang admin cấu hình wizard khách trên talewix.com.
 *   1. Settings: bật/tắt · MODEL gen ảnh (chọn từ danh sách OpenRouter + Seedream) · aspect ·
 *      limit/IP/ngày · trần toàn hệ · watermark · origins · prompt chung.
 *   2. Templates: các đầu sách khách được chọn (title, ảnh cover reference, variant Shopify, giá).
 *   3. Leads: 100 preview mới nhất (tên bé + email + ảnh) — kho remarketing.
 */

type Settings = { enabled: boolean; model: string; aspectRatio: string; dailyLimitIp: number; dailyLimitGlobal: number; watermark: string; origins: string[]; prompt: string };
type Tpl = { id: string; title: string; thumbUrl: string; baseImageUrl: string; variantId: string; price: string; promptExtra: string; active: boolean; sort: number };
type Lead = { id: string; templateId: string | null; childName: string; email: string; previewUrl: string | null; model: string; cost: string; ip: string; status: string; error: string; createdAt: string };
type Model = { id: string; name: string };
type PickProduct = { id: string; title: string; thumb: string; url: string | null; variants: { id: string; title: string; price: string }[] };

const inp: React.CSSProperties = { padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "#fff", fontSize: 13, width: "100%", boxSizing: "border-box" };
const lbl: React.CSSProperties = { fontSize: 11.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 4, display: "block" };
const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 14, padding: 16, marginBottom: 14 };
const btn = (bg: string): React.CSSProperties => ({ background: bg, color: "#fff", border: 0, borderRadius: 11, padding: "10px 20px", fontWeight: 800, fontSize: 13.5, cursor: "pointer" });

const EMPTY_TPL: Tpl = { id: "", title: "", thumbUrl: "", baseImageUrl: "", variantId: "", price: "", promptExtra: "", active: true, sort: 0 };

export default function StudioClient() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [edit, setEdit] = useState<Tpl | null>(null);      // template đang sửa/tạo (null = đóng form)
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"settings" | "templates" | "leads">("settings");
  // Product picker: gõ tên → tìm trong shopify_products đã sync → click là tự điền form.
  const [pickQ, setPickQ] = useState("");
  const [pickRows, setPickRows] = useState<PickProduct[]>([]);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    try {
      const j = await fetch("/api/studio/admin").then((r) => r.json());
      if (j.ok) { setSettings(j.settings); setTemplates(j.templates ?? []); setLeads(j.leads ?? []); }
      else setMsg("✗ " + (j.error || "Failed to load"));
    } catch (e) { setMsg("✗ " + String((e as Error)?.message ?? e)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/books/models?type=image").then((r) => r.json())
      .then((j) => { if (j.ok) setModels(j.models ?? []); }).catch(() => {});
  }, []);

  const saveSettings = async () => {
    if (!settings) return;
    setSaving(true); setMsg("");
    try {
      const j = await fetch("/api/studio/admin", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings }) }).then((r) => r.json());
      if (j.ok) { setSettings(j.settings); setMsg("✓ Settings saved"); }
      else setMsg("✗ " + (j.error || "Save failed"));
    } catch (e) { setMsg("✗ " + String((e as Error)?.message ?? e)); }
    setSaving(false);
  };

  const saveTpl = async () => {
    if (!edit) return;
    if (!edit.title.trim()) { setMsg("✗ Template title required"); return; }
    setSaving(true); setMsg("");
    try {
      const method = edit.id ? "PUT" : "POST";
      const j = await fetch("/api/studio/admin", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template: edit }) }).then((r) => r.json());
      if (j.ok) { setMsg("✓ Template saved"); setEdit(null); load(); }
      else setMsg("✗ " + (j.error || "Save failed"));
    } catch (e) { setMsg("✗ " + String((e as Error)?.message ?? e)); }
    setSaving(false);
  };

  const searchProducts = async () => {
    if (!pickQ.trim()) return;
    setPicking(true);
    try {
      const j = await fetch(`/api/studio/admin?search=${encodeURIComponent(pickQ.trim())}`).then((r) => r.json());
      setPickRows(j.ok ? (j.products ?? []) : []);
      if (j.ok && !(j.products ?? []).length) setMsg("✗ No active Shopify products match — sync products first or refine the search.");
    } catch { setPickRows([]); }
    setPicking(false);
  };
  // Chọn sản phẩm (kèm variant) → tự điền form template. Giá lấy theo variant đã chọn.
  const applyPick = (p: PickProduct, variantId: string) => {
    const v = p.variants.find((x) => x.id === variantId) ?? p.variants[0];
    setEdit((prev) => ({
      ...(prev ?? { ...EMPTY_TPL, sort: templates.length }),
      title: p.title,
      thumbUrl: p.thumb,
      baseImageUrl: (prev?.baseImageUrl?.trim() ? prev.baseImageUrl : p.thumb),
      variantId: v?.id ?? "",
      price: v?.price ? `$${v.price}` : "",
    }) as Tpl);
    setPickRows([]); setPickQ("");
  };

  const delTpl = async (id: string) => {
    if (!confirm("Delete this template? Existing leads are kept.")) return;
    const j = await fetch(`/api/studio/admin?id=${id}`, { method: "DELETE" }).then((r) => r.json());
    if (j.ok) load(); else setMsg("✗ " + (j.error || "Delete failed"));
  };

  const S = settings;
  const leadCount24h = leads.filter((l) => Date.now() - new Date(l.createdAt).getTime() < 86400e3).length;

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "0 4px" }}>
      {/* Hero */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, background: "linear-gradient(90deg, #FFF4E8, #F2FBFF)", border: "1px solid #F2D9BC", borderRadius: 16, padding: "16px 20px", marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ width: 38, height: 38, borderRadius: 11, background: "#f68b1e", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>
        </span>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#14213D" }}>Create Your Own <span style={{ color: "#f68b1e" }}>Studio</span></div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>Customer wizard on talewix.com/pages/create-your-own · AI cover preview · lead capture</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {S && <span style={{ fontSize: 12, fontWeight: 800, padding: "5px 12px", borderRadius: 99, background: S.enabled ? "#EDF9F0" : "var(--red-soft)", color: S.enabled ? "#1F6F45" : "var(--red)" }}>{S.enabled ? "LIVE" : "OFF"}</span>}
          <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>{leadCount24h} previews / 24h</span>
        </div>
      </div>

      {msg && <div style={{ fontSize: 13, padding: "9px 13px", borderRadius: 10, marginBottom: 12, background: msg.startsWith("✗") ? "var(--red-soft)" : "#EDF9F0", color: msg.startsWith("✗") ? "var(--red)" : "#1F6F45", fontWeight: 600 }}>{msg}</div>}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {(["settings", "templates", "leads"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "8px 18px", borderRadius: 99, border: "1px solid var(--line)", background: tab === t ? "#14213D" : "#fff", color: tab === t ? "#fff" : "#14213D", fontWeight: 800, fontSize: 13, cursor: "pointer", textTransform: "capitalize" }}>
            {t}{t === "templates" ? ` (${templates.length})` : t === "leads" ? ` (${leads.length})` : ""}
          </button>
        ))}
      </div>

      {!S && <div style={card}>Loading…</div>}

      {/* ── SETTINGS ─────────────────────────────────────────────── */}
      {S && tab === "settings" && (
        <div style={card}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 14 }}>
            <div>
              <span style={lbl}>Status</span>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 700, cursor: "pointer", padding: "9px 0" }}>
                <input type="checkbox" checked={S.enabled} onChange={(e) => setSettings({ ...S, enabled: e.target.checked })} style={{ width: 17, height: 17 }} />
                Enable the public wizard
              </label>
            </div>
            <div>
              <span style={lbl}>Image model</span>
              <select value={S.model} onChange={(e) => setSettings({ ...S, model: e.target.value })} style={inp}>
                {!models.some((m) => m.id === S.model) && <option value={S.model}>{S.model}</option>}
                {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <span style={lbl}>Aspect ratio</span>
              <select value={S.aspectRatio} onChange={(e) => setSettings({ ...S, aspectRatio: e.target.value })} style={inp}>
                {["1:1", "4:5", "3:4", "2:3", "16:9", "9:16"].map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <span style={lbl}>Limit / IP / 24h</span>
              <input type="number" value={S.dailyLimitIp} onChange={(e) => setSettings({ ...S, dailyLimitIp: Number(e.target.value) || 1 })} style={inp} />
            </div>
            <div>
              <span style={lbl}>Global limit / 24h</span>
              <input type="number" value={S.dailyLimitGlobal} onChange={(e) => setSettings({ ...S, dailyLimitGlobal: Number(e.target.value) || 10 })} style={inp} />
            </div>
            <div>
              <span style={lbl}>Watermark text</span>
              <input value={S.watermark} onChange={(e) => setSettings({ ...S, watermark: e.target.value })} placeholder="PREVIEW · TALEWIX (empty = none)" style={inp} />
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <span style={lbl}>Allowed origins (one per line)</span>
            <textarea value={S.origins.join("\n")} onChange={(e) => setSettings({ ...S, origins: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} rows={2} style={{ ...inp, fontFamily: "monospace", resize: "vertical" }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <span style={lbl}>Cover prompt — {"{name}"} = child&apos;s name · refs = [template cover, child photo]</span>
            <textarea value={S.prompt} onChange={(e) => setSettings({ ...S, prompt: e.target.value })} rows={10} style={{ ...inp, fontFamily: "monospace", fontSize: 12, lineHeight: 1.5, resize: "vertical" }} />
          </div>
          <button onClick={saveSettings} disabled={saving} style={{ ...btn("#f68b1e"), opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : "Save settings"}</button>
        </div>
      )}

      {/* ── TEMPLATES ────────────────────────────────────────────── */}
      {S && tab === "templates" && (
        <>
          <div style={card}>
            {templates.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13, padding: 4 }}>No templates yet — add the covers customers can personalize.</div>}
            {templates.map((t) => (
              <div key={t.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 2px", borderBottom: "1px solid var(--line)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {t.thumbUrl ? <img src={t.thumbUrl} alt="" style={{ width: 52, height: 52, borderRadius: 10, objectFit: "cover", border: "1px solid var(--line)" }} /> : <div style={{ width: 52, height: 52, borderRadius: 10, background: "#f4f4f4" }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 13.5 }}>{t.title} {!t.active && <span style={{ color: "var(--red)", fontSize: 11.5 }}>· hidden</span>}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{t.price || "—"} · variant {t.variantId || "—"} · sort {t.sort}</div>
                </div>
                <button onClick={() => setEdit({ ...t })} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 9, padding: "7px 14px", cursor: "pointer", fontSize: 12.5, fontWeight: 700 }}>Edit</button>
                <button onClick={() => delTpl(t.id)} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 9, padding: "7px 12px", cursor: "pointer", color: "var(--red)", fontSize: 13 }}>✕</button>
              </div>
            ))}
            <button onClick={() => setEdit({ ...EMPTY_TPL, sort: templates.length })} style={{ marginTop: 10, background: "none", border: "1px dashed var(--line)", borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 700, color: "#f68b1e", cursor: "pointer" }}>+ Add template</button>
          </div>

          {edit && (
            <div style={card}>
              <div style={{ fontWeight: 900, fontSize: 15, marginBottom: 12 }}>{edit.id ? "Edit template" : "New template"}</div>

            {/* Picker: chọn từ sản phẩm Shopify đã sync — tự điền title/ảnh/variant/giá */}
            <div style={{ background: "#FFF9F2", border: "1px solid #F2D9BC", borderRadius: 12, padding: 12, marginBottom: 14 }}>
              <span style={lbl}>Pick from your Shopify products (auto-fill)</span>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={pickQ} onChange={(e) => setPickQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") searchProducts(); }} placeholder="Search product title… e.g. zoo book" style={inp} />
                <button onClick={searchProducts} disabled={picking} style={{ ...btn("#14213D"), padding: "9px 18px", fontSize: 13, opacity: picking ? 0.6 : 1 }}>{picking ? "…" : "Search"}</button>
              </div>
              {pickRows.length > 0 && (
                <div style={{ marginTop: 10, maxHeight: 300, overflowY: "auto" }}>
                  {pickRows.map((p) => (
                    <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 4px", borderTop: "1px solid #f2e4d2" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.thumb ? <img src={p.thumb} alt="" style={{ width: 42, height: 42, borderRadius: 8, objectFit: "cover" }} /> : <div style={{ width: 42, height: 42, borderRadius: 8, background: "#eee" }} />}
                      <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
                      {p.variants.length > 1 ? (
                        <select defaultValue="" onChange={(e) => { if (e.target.value) applyPick(p, e.target.value); }} style={{ ...inp, width: 190 }}>
                          <option value="" disabled>Pick variant…</option>
                          {p.variants.map((v) => <option key={v.id} value={v.id}>{v.title} — ${v.price}</option>)}
                        </select>
                      ) : (
                        <button onClick={() => applyPick(p, p.variants[0]?.id ?? "")} style={{ ...btn("#f68b1e"), padding: "8px 14px", fontSize: 12.5 }}>Use{p.variants[0]?.price ? ` — $${p.variants[0].price}` : ""}</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>Tip: point this at the <b>Photo Edition</b> variant/product ($39.95) — not the standard $29.95 one — so Studio orders carry the personalized price.</div>
            </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginBottom: 12 }}>
                <div><span style={lbl}>Title (shown to customers)</span><input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Personalized Zoo Book" style={inp} /></div>
                <div><span style={lbl}>Price label</span><input value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} placeholder="$29.95" style={inp} /></div>
                <div><span style={lbl}>Shopify variant ID (add to cart)</span><input value={edit.variantId} onChange={(e) => setEdit({ ...edit, variantId: e.target.value })} placeholder="4512345678901" style={inp} /></div>
                <div><span style={lbl}>Sort</span><input type="number" value={edit.sort} onChange={(e) => setEdit({ ...edit, sort: Number(e.target.value) || 0 })} style={inp} /></div>
              </div>
              <div style={{ marginBottom: 12 }}><span style={lbl}>Thumb URL (wizard grid)</span><input value={edit.thumbUrl} onChange={(e) => setEdit({ ...edit, thumbUrl: e.target.value, baseImageUrl: edit.baseImageUrl || e.target.value })} placeholder="https://cdn.shopify.com/…/cover.jpg" style={inp} /></div>
              <div style={{ marginBottom: 12 }}><span style={lbl}>Base cover URL (AI reference — the original cover art, defaults to thumb)</span><input value={edit.baseImageUrl} onChange={(e) => setEdit({ ...edit, baseImageUrl: e.target.value })} style={inp} /></div>
              <div style={{ marginBottom: 12 }}><span style={lbl}>Extra prompt for this template (optional)</span><textarea value={edit.promptExtra} onChange={(e) => setEdit({ ...edit, promptExtra: e.target.value })} rows={2} style={{ ...inp, resize: "vertical" }} /></div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, marginBottom: 14, cursor: "pointer" }}>
                <input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} style={{ width: 16, height: 16 }} /> Active (visible to customers)
              </label>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={saveTpl} disabled={saving} style={{ ...btn("#f68b1e"), opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : "Save template"}</button>
                <button onClick={() => setEdit(null)} style={{ ...btn("#8a8f98") }}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── LEADS ────────────────────────────────────────────────── */}
      {S && tab === "leads" && (
        <div style={card}>
          {leads.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13, padding: 4 }}>No previews yet.</div>}
          {leads.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--muted)", textTransform: "uppercase", fontSize: 11 }}>
                    <th style={{ padding: "6px 8px" }}>Time</th><th style={{ padding: "6px 8px" }}>Child</th><th style={{ padding: "6px 8px" }}>Email</th>
                    <th style={{ padding: "6px 8px" }}>Template</th><th style={{ padding: "6px 8px" }}>Preview</th><th style={{ padding: "6px 8px" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l.id} style={{ borderTop: "1px solid var(--line)" }}>
                      <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>{new Date(l.createdAt).toLocaleString()}</td>
                      <td style={{ padding: "7px 8px", fontWeight: 700 }}>{l.childName || "—"}</td>
                      <td style={{ padding: "7px 8px" }}>{l.email || <span style={{ color: "var(--muted)" }}>—</span>}</td>
                      <td style={{ padding: "7px 8px" }}>{templates.find((t) => t.id === l.templateId)?.title ?? "—"}</td>
                      <td style={{ padding: "7px 8px" }}>{l.previewUrl ? <a href={l.previewUrl} target="_blank" rel="noreferrer" style={{ color: "#f68b1e", fontWeight: 700 }}>view</a> : "—"}</td>
                      <td style={{ padding: "7px 8px" }}>{l.status === "done" ? "✓" : <span title={l.error} style={{ color: "var(--red)" }}>✗</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
