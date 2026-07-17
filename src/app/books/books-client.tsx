"use client";
import { useEffect, useState } from "react";

type Title = { id: string; name: string; occasion: string | null; audience: string | null; status: string; updatedAt: string };
type Idea = { name: string; hook: string; angle: string; usp: string; outline: string[] };
type Page = { page_no: number; text: string; illustration: string };
type Detail = { title: { id: string; name: string; status: string; occasion: string | null; audience: string | null; concept: unknown; characterRefUrl?: string | null; stylePrompt?: string | null }; pages: { pageNo: number; textTemplate: string | null; illustrationBrief: string | null }[]; assets?: Record<number, string | null> };

const inp: React.CSSProperties = { padding: "9px 12px", border: "1px solid var(--line)", borderRadius: 10, font: "inherit", fontSize: 13, width: "100%", boxSizing: "border-box" };
const btn: React.CSSProperties = { border: 0, borderRadius: 10, padding: "9px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13 };
const btnBlue = { ...btn, background: "var(--blue)", color: "#fff" };
const btnGhost = { ...btn, background: "#fff", border: "1px solid var(--line)", color: "var(--ink)" };
const STATUS_COLOR: Record<string, string> = { idea: "#8a6d00", script: "#0e6bd6", characters: "#7a3fb0", simulation: "#0e8a5f", mockup: "#c2410c", ready: "#12703c" };

// Gọi API + hiện ĐÚNG mã lỗi (thay vì gộp thành "network"). 404 = chưa deploy; 502/500 = lỗi server/OpenRouter.
type ApiResult = { ok?: boolean; error?: string; [k: string]: unknown };
async function api(url: string, method = "GET", body?: unknown): Promise<ApiResult> {
  try {
    const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const raw = await r.text();
    let j: ApiResult | null = null;
    try { j = JSON.parse(raw); } catch { /* không phải JSON */ }
    if (j) return j;
    const isHtml = /^\s*</.test(raw);
    const note = r.status === 404 ? " — API chưa deploy"
      : (r.status === 502 || r.status === 504) ? " — hết giờ (ảnh sinh quá lâu). Đổi sang model ảnh NHANH (Google nano‑banana) hoặc vẽ từng trang."
      : isHtml ? "" : (raw ? " · " + raw.slice(0, 120) : "");
    return { ok: false, error: `HTTP ${r.status}${note}` };
  } catch (e) {
    return { ok: false, error: "network: " + String((e as Error)?.message ?? e).slice(0, 140) };
  }
}

const lsGet = (k: string) => { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

const PROV_NAME: Record<string, string> = { anthropic: "Anthropic", google: "Google", openai: "OpenAI", cohere: "Cohere", "meta-llama": "Meta", mistralai: "Mistral", "x-ai": "xAI", deepseek: "DeepSeek", qwen: "Qwen", "amazon": "Amazon", "perplexity": "Perplexity" };
// Nhóm model theo HÃNG (optgroup) cho dễ tìm — Anthropic / Google / Cohere… mỗi nhóm riêng.
function ModelOptions({ models }: { models: { id: string; name: string }[] }) {
  const groups = new Map<string, { id: string; name: string }[]>();
  for (const m of models) { const prov = m.id.split("/")[0] || "other"; (groups.get(prov) ?? (() => { const a: { id: string; name: string }[] = []; groups.set(prov, a); return a; })()).push(m); }
  const sorted = Array.from(groups.entries()).sort((a, b) => (PROV_NAME[a[0]] ?? a[0]).localeCompare(PROV_NAME[b[0]] ?? b[0]));
  return (<>{sorted.map(([prov, items]) => (
    <optgroup key={prov} label={PROV_NAME[prov] ?? prov}>
      {items.map((m) => <option key={m.id} value={m.id}>{m.name.replace(/^[^:]+:\s*/, "")}</option>)}
    </optgroup>
  ))}</>);
}
// Bộ chọn AI model cho khâu (lấy list từ OpenRouter). "" = dùng model mặc định ở env.
function ModelPicker({ models, value, onChange, label = "AI model" }: { models: { id: string; name: string }[]; value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <label style={{ fontSize: 12, fontWeight: 600, display: "block" }}>{label}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inp, marginTop: 4 }}>
        <option value="">— Mặc định (env) —</option>
        <ModelOptions models={models} />
      </select>
    </label>
  );
}

export default function BooksClient() {
  const [titles, setTitles] = useState<Title[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [msg, setMsg] = useState("");

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 5000); };
  const [textModels, setTextModels] = useState<{ id: string; name: string }[]>([]);
  const loadList = () => api("/api/books").then((j) => { if (j.ok) setTitles(j.titles as Title[]); });
  useEffect(() => {
    loadList();
    api("/api/books/models?type=text").then((j) => { if (j.ok) setTextModels((j.models as { id: string; name: string }[]) ?? []); });
  }, []);

  const openDetail = async (id: string) => {
    const j = await api(`/api/books/${id}`);
    if (j.ok) setDetail(j as unknown as Detail); else flash("✗ " + (j.error ?? "Lỗi"));
  };

  return (
    <div style={{ padding: "18px 20px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>✨ Book Studio</h2>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#7a3fb0", background: "#F3EAFB", border: "1px solid #E3D0F5", borderRadius: 999, padding: "2px 9px" }}>AI · Beta</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {detail && <button style={btnGhost} onClick={() => { setDetail(null); loadList(); }}>← Danh sách</button>}
          {!detail && <button style={btnBlue} onClick={() => setShowNew(true)}>+ New Book</button>}
        </div>
      </div>
      <div className="sub" style={{ marginBottom: 14, color: "var(--muted)", fontSize: 12.5 }}>Ý tưởng → Kịch bản (MVP‑1). Mô phỏng &amp; Mockup ở bước sau.</div>
      {msg && <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 600, color: msg.startsWith("✗") ? "var(--red)" : "var(--green)" }}>{msg}</div>}

      {detail ? <DetailView detail={detail} models={textModels} reload={() => openDetail(detail.title.id)} flash={flash} />
        : <ListView titles={titles} open={openDetail} />}

      {showNew && <NewBookModal models={textModels} close={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); loadList(); openDetail(id); }} flash={flash} />}
    </div>
  );
}

function ListView({ titles, open }: { titles: Title[]; open: (id: string) => void }) {
  if (!titles.length) return <div className="panel empty" style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>Chưa có đầu sách nào. Bấm <b>+ New Book</b> để bắt đầu.</div>;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {titles.map((t) => (
        <button key={t.id} onClick={() => open(t.id)} style={{ ...btnGhost, textAlign: "left", padding: "13px 15px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{t.name}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{[t.occasion, t.audience].filter(Boolean).join(" · ") || "—"}</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLOR[t.status] ?? "#555", textTransform: "uppercase", letterSpacing: ".4px" }}>{t.status}</span>
        </button>
      ))}
    </div>
  );
}

function NewBookModal({ close, onCreated, flash, models }: { close: () => void; onCreated: (id: string) => void; flash: (m: string) => void; models: { id: string; name: string }[] }) {
  const [brief, setBrief] = useState({ occasion: "", audience: "", pages: 12, notes: "", count: 4 });
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [model, setModel] = useState("");
  useEffect(() => { setModel(lsGet("bs_text_model")); }, []);

  const gen = async () => {
    setBusy(true); setIdeas([]);
    lsSet("bs_text_model", model);
    const j = await api("/api/books/ideas", "POST", { ...brief, model: model || undefined });
    setBusy(false);
    if (j.ok) setIdeas((j.ideas as Idea[]) ?? []); else flash("✗ " + (j.error ?? "Lỗi sinh ý tưởng"));
  };
  const create = async (idea: Idea) => {
    setBusy(true);
    const j = await api("/api/books", "POST", {
      name: idea.name, occasion: brief.occasion, audience: brief.audience,
      concept: { hook: idea.hook, angle: idea.angle, usp: idea.usp, outline: idea.outline },
      brief,
    });
    setBusy(false);
    if (j.ok) onCreated(j.id as string); else flash("✗ " + (j.error ?? "Lỗi tạo"));
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,20,35,.5)", zIndex: 50, display: "grid", placeItems: "center", padding: 16 }} onClick={close}>
      <div style={{ background: "#fff", borderRadius: 14, width: "min(720px,100%)", maxHeight: "90vh", overflow: "auto", padding: 20 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>New Book — Ý tưởng</h3>
          <button style={{ ...btnGhost, marginLeft: "auto", padding: "5px 11px" }} onClick={close}>✕</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 600 }}>Dịp / ngách<input style={{ ...inp, marginTop: 4 }} placeholder="vd 1st birthday, sleep book…" value={brief.occasion} onChange={(e) => setBrief({ ...brief, occasion: e.target.value })} /></label>
          <label style={{ fontSize: 12, fontWeight: 600 }}>Đối tượng<input style={{ ...inp, marginTop: 4 }} placeholder="vd bé 0–1 tuổi / quà tặng" value={brief.audience} onChange={(e) => setBrief({ ...brief, audience: e.target.value })} /></label>
          <label style={{ fontSize: 12, fontWeight: 600 }}>Số trang<input type="number" style={{ ...inp, marginTop: 4 }} value={brief.pages} onChange={(e) => setBrief({ ...brief, pages: Number(e.target.value) || 12 })} /></label>
          <label style={{ fontSize: 12, fontWeight: 600 }}>Số ý tưởng<input type="number" style={{ ...inp, marginTop: 4 }} value={brief.count} onChange={(e) => setBrief({ ...brief, count: Number(e.target.value) || 4 })} /></label>
          <label style={{ fontSize: 12, fontWeight: 600, gridColumn: "1 / -1" }}>Ghi chú<input style={{ ...inp, marginTop: 4 }} placeholder="phong cách, chủ đề riêng…" value={brief.notes} onChange={(e) => setBrief({ ...brief, notes: e.target.value })} /></label>
          <div style={{ gridColumn: "1 / -1" }}><ModelPicker models={models} value={model} onChange={setModel} label="AI viết ý tưởng/kịch bản" /></div>
        </div>
        <button style={{ ...btnBlue, marginTop: 12, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={gen}>{busy ? "Đang nghĩ…" : "✨ Sinh ý tưởng"}</button>

        {ideas.length > 0 && (
          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            {ideas.map((idea, i) => (
              <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 13 }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{idea.name}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>{idea.hook}</div>
                <div style={{ fontSize: 12, marginTop: 6 }}><b>Angle:</b> {idea.angle}</div>
                <div style={{ fontSize: 12, marginTop: 2 }}><b>USP:</b> {idea.usp}</div>
                {idea.outline?.length > 0 && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>{idea.outline.length} trang: {idea.outline.slice(0, 3).join(" · ")}{idea.outline.length > 3 ? "…" : ""}</div>}
                <button style={{ ...btnBlue, marginTop: 10, padding: "7px 14px", fontSize: 12.5, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => create(idea)}>Chọn &amp; tạo →</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailView({ detail, reload, flash, models }: { detail: Detail; reload: () => void; flash: (m: string) => void; models: { id: string; name: string }[] }) {
  const id = detail.title.id;
  const concept = (detail.title.concept ?? {}) as { hook?: string; angle?: string; usp?: string; outline?: string[] };
  const [pages, setPages] = useState<Page[]>(detail.pages.map((p) => ({ page_no: p.pageNo, text: p.textTemplate ?? "", illustration: p.illustrationBrief ?? "" })));
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState("");
  // ---- Gen Image state ----
  const [imgModels, setImgModels] = useState<{ id: string; name: string }[]>([]);
  const [imgModel, setImgModel] = useState("");
  const [refUrl, setRefUrl] = useState<string | null>(detail.title.characterRefUrl ?? null);
  const [stylePrompt, setStyleP] = useState(detail.title.stylePrompt ?? "");
  const [illus, setIllus] = useState<Record<number, string>>({});
  const [busyPage, setBusyPage] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busyAll, setBusyAll] = useState(false);
  const [previewName, setPreviewName] = useState("Emma"); // tên xem thử để thay {name} khi preview

  useEffect(() => { setModel(lsGet("bs_text_model")); setImgModel(lsGet("bs_image_model")); }, []);
  useEffect(() => { api("/api/books/models?type=image").then((j) => { if (j.ok) setImgModels((j.models as { id: string; name: string }[]) ?? []); }); }, []);
  // Đồng bộ khi detail reload
  useEffect(() => {
    setRefUrl(detail.title.characterRefUrl ?? null);
    setStyleP(detail.title.stylePrompt ?? "");
    const m: Record<number, string> = {};
    for (const [k, v] of Object.entries(detail.assets ?? {})) if (v) m[Number(k)] = v as string;
    setIllus(m);
  }, [detail]);

  const genScript = async () => {
    setBusy(true); lsSet("bs_text_model", model);
    const j = await api(`/api/books/${id}/script`, "POST", { model: model || undefined });
    setBusy(false);
    if (j.ok) { setPages((j.pages as Page[]) ?? []); flash("✓ Đã sinh kịch bản"); reload(); }
    else flash("✗ " + (j.error ?? "Lỗi sinh kịch bản"));
  };
  const save = async () => {
    setBusy(true);
    const j = await api(`/api/books/${id}`, "PATCH", { pages });
    setBusy(false);
    flash(j.ok ? "✓ Đã lưu" : "✗ " + (j.error ?? "Lỗi lưu"));
  };
  const setPage = (i: number, k: "text" | "illustration", v: string) => setPages((ps) => ps.map((p, idx) => idx === i ? { ...p, [k]: v } : p));

  const uploadRef = async (file: File) => {
    setUploading(true);
    const t = await api(`/api/books/${id}/reference-url`, "POST", { contentType: file.type || "image/png" });
    if (!t.ok) { flash("✗ " + (t.error ?? "Lỗi")); setUploading(false); return; }
    try {
      const put = await fetch(t.url as string, { method: (t.method as string) || "PUT", headers: { "Content-Type": file.type || "image/png" }, body: file });
      if (!put.ok) throw new Error("upload HTTP " + put.status);
      const p = await api(`/api/books/${id}`, "PATCH", { characterRefKey: t.key });
      if (p.ok) { flash("✓ Đã tải ảnh nhân vật"); reload(); } else flash("✗ " + (p.error ?? "Lỗi lưu"));
    } catch (e) { flash("✗ upload: " + String((e as Error)?.message ?? e).slice(0, 100)); }
    setUploading(false);
  };
  const saveStyle = async () => { if (stylePrompt !== (detail.title.stylePrompt ?? "")) await api(`/api/books/${id}`, "PATCH", { stylePrompt }); };
  const illustrate = async (pageNo: number) => {
    setBusyPage(pageNo); lsSet("bs_image_model", imgModel);
    let j = await api(`/api/books/${id}/illustrate`, "POST", { pageNo, model: imgModel || undefined });
    // Timeout tạm thời (502/504) → tự thử lại 1 lần
    if (!j.ok && /\b50[24]\b|hết giờ|timeout/i.test(String(j.error ?? ""))) {
      j = await api(`/api/books/${id}/illustrate`, "POST", { pageNo, model: imgModel || undefined });
    }
    setBusyPage(null);
    if (j.ok) setIllus((m) => ({ ...m, [pageNo]: j.url as string }));
    else flash(`✗ trang ${pageNo}: ` + (j.error ?? "Lỗi vẽ"));
  };
  const illustrateAll = async () => {
    setBusyAll(true);
    for (const p of pages) { await illustrate(p.page_no); }
    setBusyAll(false); flash("✓ Vẽ xong (kiểm tra + vẽ lại trang lỗi nếu cần)");
  };

  return (
    <div>
      <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 15, marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>{detail.title.name}</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>{[detail.title.occasion, detail.title.audience].filter(Boolean).join(" · ") || "—"}</div>
        {concept.hook && <div style={{ fontSize: 13, marginTop: 8 }}>{concept.hook}</div>}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Kịch bản {pages.length ? `· ${pages.length} trang` : ""}</h3>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <select value={model} onChange={(e) => setModel(e.target.value)} title="AI viết kịch bản" style={{ ...inp, width: 200, fontSize: 12, padding: "7px 9px" }}>
            <option value="">— Model text mặc định —</option>
            <ModelOptions models={models} />
          </select>
          <button style={{ ...btnGhost, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={genScript}>{busy ? "Đang viết…" : pages.length ? "↻ Sinh lại" : "✨ Sinh kịch bản"}</button>
          {pages.length > 0 && <button style={{ ...btnBlue, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}>Lưu</button>}
        </div>
      </div>

      {pages.length > 0 && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 12, padding: 12, marginBottom: 12, background: "#FAFBFF" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: uploading ? "wait" : "pointer" }}>
            {refUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={refUrl} alt="ref" style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} />
              : <span style={{ width: 52, height: 52, display: "grid", placeItems: "center", borderRadius: 8, border: "1px dashed var(--line)", color: "var(--muted)", fontSize: 11 }}>Ref</span>}
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--blue)" }}>{uploading ? "Đang tải…" : refUrl ? "Đổi ảnh nhân vật" : "Tải ảnh nhân vật (reference)"}</span>
            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadRef(f); e.target.value = ""; }} />
          </label>
          <input value={stylePrompt} onChange={(e) => setStyleP(e.target.value)} onBlur={saveStyle} placeholder="Style chung (vd soft watercolor, pastel…)" style={{ ...inp, flex: 1, minWidth: 150, fontSize: 12.5 }} />
          <input value={previewName} onChange={(e) => setPreviewName(e.target.value)} placeholder="Tên xem thử" title="Thay {name} khi xem trước" style={{ ...inp, width: 120, fontSize: 12.5 }} />
          <select value={imgModel} onChange={(e) => setImgModel(e.target.value)} title="AI vẽ ảnh" style={{ ...inp, width: 200, fontSize: 12, padding: "7px 9px" }}>
            <option value="">— Model ảnh mặc định —</option>
            <ModelOptions models={imgModels} />
          </select>
          <button style={{ ...btnBlue, opacity: (busyAll || busyPage !== null) ? 0.6 : 1 }} disabled={busyAll || busyPage !== null} onClick={illustrateAll}>{busyAll ? "Đang vẽ…" : "🎨 Vẽ tất cả"}</button>
        </div>
      )}

      {pages.length === 0 ? <div className="panel empty" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Chưa có kịch bản. Bấm <b>Sinh kịch bản</b> để AI viết từng trang.</div>
        : (
          <div style={{ display: "grid", gap: 10 }}>
            {pages.map((p, i) => (
              <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, display: "grid", gridTemplateColumns: "34px 1fr 172px", gap: 12 }}>
                <div style={{ fontWeight: 800, color: "var(--muted)", fontSize: 13 }}>#{p.page_no}</div>
                <div style={{ display: "grid", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--faint)", textTransform: "uppercase", marginBottom: 3 }}>Lời văn (có thể chèn {"{name}"})</div>
                    <textarea value={p.text} onChange={(e) => setPage(i, "text", e.target.value)} rows={2} style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--faint)", textTransform: "uppercase", marginBottom: 3 }}>Brief minh hoạ (cảnh vẽ)</div>
                    <textarea value={p.illustration} onChange={(e) => setPage(i, "illustration", e.target.value)} rows={2} style={{ ...inp, resize: "vertical", lineHeight: 1.5, color: "#555" }} />
                  </div>
                </div>
                <div style={{ display: "grid", gap: 6, alignContent: "start" }}>
                  {illus[p.page_no]
                    ? (
                      <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: "1px solid var(--line)", lineHeight: 0 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={illus[p.page_no]} alt={`p${p.page_no}`} style={{ width: "100%", display: "block" }} />
                        {p.text.trim() && (
                          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: "linear-gradient(transparent, rgba(0,0,0,.62))", color: "#fff", fontSize: 9.5, padding: "16px 7px 6px", lineHeight: 1.3, textAlign: "center", fontWeight: 600, textShadow: "0 1px 2px rgba(0,0,0,.5)" }}>
                            {p.text.replace(/\{name\}/gi, previewName || "Emma")}
                          </div>
                        )}
                      </div>
                    )
                    : <div style={{ height: 110, borderRadius: 8, border: "1px dashed var(--line)", display: "grid", placeItems: "center", color: "var(--faint)", fontSize: 11 }}>Chưa vẽ</div>}
                  <button style={{ ...btnGhost, fontSize: 11.5, padding: "6px 10px", opacity: (busyPage === p.page_no) ? 0.6 : 1 }} disabled={busyPage === p.page_no || busyAll} onClick={() => illustrate(p.page_no)}>{busyPage === p.page_no ? "Đang vẽ…" : illus[p.page_no] ? "↻ Vẽ lại" : "🎨 Vẽ"}</button>
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
