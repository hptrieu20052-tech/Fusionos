"use client";
import { useEffect, useState } from "react";

type Title = { id: string; name: string; occasion: string | null; audience: string | null; status: string; updatedAt: string };
type Idea = { name: string; hook: string; angle: string; usp: string; outline: string[] };
type Bible = { format?: string; character?: string; wardrobe?: string; artStyle?: string; palette?: string; textStyle?: string; restrictions?: string };
type Var = { key: string; label?: string; value?: string };
type Page = { page_no: number; text: string; illustration: string; prompt?: string };
type Detail = {
  title: { id: string; name: string; status: string; occasion: string | null; audience: string | null; concept: unknown; characterRefUrl?: string | null; stylePrompt?: string | null; bible?: Bible | null; vars?: Var[] | null };
  pages: { pageNo: number; textTemplate: string | null; illustrationBrief: string | null; promptTemplate?: string | null }[];
  assets?: Record<number, string | null>;
};

const inp: React.CSSProperties = { padding: "9px 12px", border: "1px solid var(--line)", borderRadius: 10, font: "inherit", fontSize: 13, width: "100%", boxSizing: "border-box" };
const btn: React.CSSProperties = { border: 0, borderRadius: 10, padding: "9px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13 };
const btnBlue = { ...btn, background: "var(--blue)", color: "#fff" };
const btnGhost = { ...btn, background: "#fff", border: "1px solid var(--line)", color: "var(--ink)" };
const STATUS_COLOR: Record<string, string> = { idea: "#8a6d00", script: "#0e6bd6", characters: "#7a3fb0", simulation: "#0e8a5f", mockup: "#c2410c", ready: "#12703c" };

// Bible mặc định (khớp defaultBible() ở server) — bấm "Dùng mẫu" để đổ vào.
const DEFAULT_BIBLE: Bible = {
  format: "Single horizontal landscape page, aspect ratio 23:17 (print 3450×2550px at 300 DPI). Premium, professionally published children's picture-book quality. Keep the child's face and all text safely inside the trim margins.",
  character: "- approximately {age} years old\n- the SAME face, hair color, hairstyle and skin tone as the attached reference photo\n- soft round cheeks\n- warm, gentle, cheerful expression\n- realistic toddler body proportions\n- kind, curious and caring personality",
  wardrobe: "",
  artStyle: "Premium magical children's storybook digital painting. Soft cinematic lighting, expressive but gentle facial features, realistic fabric texture, detailed dreamy backgrounds, warm golden highlights, polished professional illustration quality.",
  palette: "deep navy blue, soft sky blue, warm cream, teal blue, glowing golden accents",
  textStyle: "Use a clear, elegant, child-friendly serif font. Dark navy text on a clean, light-colored area. All words correctly spelled, easy to read and professionally typeset. Do not place text over faces or visually busy areas. Do not add page titles, page numbers, or any extra words.",
  restrictions: "- No copyrighted characters, costumes, symbols or logos\n- No distorted hands, fingers, faces or body proportions\n- No misspelled text\n- No extra children except those described in the scene\n- No dark or frightening atmosphere\n- No harsh yellow color cast\n- No overly cartoonish or exaggerated proportions\n- Generate the flat page artwork only — no page mockup, no hands holding the book, no surrounding background",
};
const DEFAULT_VARS: Var[] = [
  { key: "name", label: "Tên bé", value: "" },
  { key: "age", label: "Tuổi", value: "" },
  { key: "city", label: "Thành phố", value: "" },
  { key: "hobby", label: "Sở thích", value: "" },
];

// Thay {key}/[key] trong preview.
function fill(tpl: string, vars: Var[]): string {
  let out = tpl ?? "";
  for (const v of vars) {
    const val = (v.value ?? "").trim(); if (!v.key || !val) continue;
    const esc = v.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`[\\{\\[]\\s*${esc}\\s*[\\}\\]]`, "gi"), val);
  }
  return out;
}

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
      <div className="sub" style={{ marginBottom: 14, color: "var(--muted)", fontSize: 12.5 }}>Kịch bản → Prompt chi tiết → Custom ảnh/tên → Gen ảnh từng trang.</div>
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

// ===== Panel: STYLE BIBLE (khai báo 1 lần, ráp vào mọi trang) =====
function BiblePanel({ bible, setBible, onSave }: { bible: Bible; setBible: (b: Bible) => void; onSave: () => void }) {
  const [open, setOpen] = useState(false);
  const F = (k: keyof Bible, label: string, rows = 2, ph = "") => (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--faint)", textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
      <textarea value={bible[k] ?? ""} onChange={(e) => setBible({ ...bible, [k]: e.target.value })} rows={rows} placeholder={ph} style={{ ...inp, resize: "vertical", lineHeight: 1.5, fontSize: 12.5 }} />
    </div>
  );
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, marginBottom: 12, background: "#FCFCFF" }}>
      <button onClick={() => setOpen((v) => !v)} style={{ ...btnGhost, border: 0, width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 8, background: "transparent" }}>
        <span style={{ fontWeight: 800, fontSize: 14 }}>📖 Style Bible</span>
        <span style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 500 }}>— khối bí kíp giữ nhân vật &amp; phong cách nhất quán mọi trang</span>
        <span style={{ marginLeft: "auto", fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 14px 14px", display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ ...btnGhost, padding: "6px 12px", fontSize: 12 }} onClick={() => setBible({ ...DEFAULT_BIBLE, ...bible, wardrobe: bible.wardrobe ?? "" })}>Đổ mẫu mặc định</button>
            <button style={{ ...btnBlue, padding: "6px 12px", fontSize: 12, marginLeft: "auto" }} onClick={onSave}>Lưu Bible</button>
          </div>
          {F("character", "Nhân vật (khoá mặt)", 5, "đặc điểm mặt/tóc/mắt… + {age}")}
          {F("wardrobe", "Trang phục / đạo cụ cố định", 2, "vd bộ pyjama sao xanh teal (để trống nếu không có)")}
          {F("artStyle", "Phong cách vẽ", 3)}
          {F("palette", "Bảng màu", 1)}
          {F("textStyle", "Quy tắc chữ (baked vào ảnh)", 3)}
          {F("restrictions", "Danh sách cấm", 5)}
          {F("format", "Khổ trang / chất lượng", 2)}
        </div>
      )}
    </div>
  );
}

// ===== Panel: BIẾN CÁ NHÂN HOÁ (add custom tên/tuổi/…) =====
function VarsPanel({ vars, setVars, onSave }: { vars: Var[]; setVars: (v: Var[]) => void; onSave: () => void }) {
  const setV = (i: number, k: keyof Var, val: string) => setVars(vars.map((v, idx) => idx === i ? { ...v, [k]: val } : v));
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, marginBottom: 12, padding: 12, background: "#FAFBFF" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 800, fontSize: 14 }}>🧩 Biến cá nhân hoá</span>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>— thay {"{name}"} / {"{age}"}… lúc gen (và preview)</span>
        <button style={{ ...btnGhost, marginLeft: "auto", padding: "5px 10px", fontSize: 12 }} onClick={() => setVars([...vars, { key: "", label: "", value: "" }])}>+ Biến</button>
        <button style={{ ...btnBlue, padding: "5px 10px", fontSize: 12 }} onClick={onSave}>Lưu biến</button>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {vars.map((v, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr 30px", gap: 6, alignItems: "center" }}>
            <input value={v.key} onChange={(e) => setV(i, "key", e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))} placeholder="key (name)" style={{ ...inp, fontSize: 12, padding: "6px 9px" }} />
            <input value={v.label ?? ""} onChange={(e) => setV(i, "label", e.target.value)} placeholder="nhãn (Tên bé)" style={{ ...inp, fontSize: 12, padding: "6px 9px" }} />
            <input value={v.value ?? ""} onChange={(e) => setV(i, "value", e.target.value)} placeholder="giá trị (Liam)" style={{ ...inp, fontSize: 12, padding: "6px 9px" }} />
            <button style={{ ...btnGhost, padding: "5px 0", fontSize: 12 }} title="Xoá" onClick={() => setVars(vars.filter((_, idx) => idx !== i))}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailView({ detail, reload, flash, models }: { detail: Detail; reload: () => void; flash: (m: string) => void; models: { id: string; name: string }[] }) {
  const id = detail.title.id;
  const concept = (detail.title.concept ?? {}) as { hook?: string; angle?: string; usp?: string; outline?: string[] };
  const [pages, setPages] = useState<Page[]>(detail.pages.map((p) => ({ page_no: p.pageNo, text: p.textTemplate ?? "", illustration: p.illustrationBrief ?? "", prompt: p.promptTemplate ?? "" })));
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState("");
  // ---- Bible + Vars ----
  const [bible, setBible] = useState<Bible>(detail.title.bible ?? {});
  const [vars, setVars] = useState<Var[]>(detail.title.vars && detail.title.vars.length ? detail.title.vars : DEFAULT_VARS);
  const [baked, setBaked] = useState(true);
  // ---- Gen Image state ----
  const [imgModels, setImgModels] = useState<{ id: string; name: string }[]>([]);
  const [imgModel, setImgModel] = useState("");
  const [refUrl, setRefUrl] = useState<string | null>(detail.title.characterRefUrl ?? null);
  const [illus, setIllus] = useState<Record<number, string>>({});
  const [busyPage, setBusyPage] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busyAll, setBusyAll] = useState(false);

  const previewName = (vars.find((v) => v.key === "name")?.value || "Emma");

  useEffect(() => { setModel(lsGet("bs_text_model")); setImgModel(lsGet("bs_image_model")); }, []);
  useEffect(() => { api("/api/books/models?type=image").then((j) => { if (j.ok) setImgModels((j.models as { id: string; name: string }[]) ?? []); }); }, []);
  // Đồng bộ khi detail reload
  useEffect(() => {
    setRefUrl(detail.title.characterRefUrl ?? null);
    setBible(detail.title.bible ?? {});
    if (detail.title.vars && detail.title.vars.length) setVars(detail.title.vars);
    const m: Record<number, string> = {};
    for (const [k, v] of Object.entries(detail.assets ?? {})) if (v) m[Number(k)] = v as string;
    setIllus(m);
  }, [detail]);

  const genScript = async () => {
    setBusy(true); lsSet("bs_text_model", model);
    const j = await api(`/api/books/${id}/script`, "POST", { model: model || undefined, vars: vars.map((v) => v.key).filter(Boolean) });
    setBusy(false);
    if (j.ok) { const ps = (j.pages as Page[]) ?? []; setPages(ps.map((p) => ({ ...p, prompt: "" }))); flash("✓ Đã sinh kịch bản"); reload(); }
    else flash("✗ " + (j.error ?? "Lỗi sinh kịch bản"));
  };
  const save = async () => {
    setBusy(true);
    const j = await api(`/api/books/${id}`, "PATCH", { pages });
    setBusy(false);
    flash(j.ok ? "✓ Đã lưu" : "✗ " + (j.error ?? "Lỗi lưu"));
  };
  const setPage = (i: number, k: "text" | "illustration" | "prompt", v: string) => setPages((ps) => ps.map((p, idx) => idx === i ? { ...p, [k]: v } : p));

  const saveBible = async () => { const j = await api(`/api/books/${id}`, "PATCH", { bible }); flash(j.ok ? "✓ Đã lưu Bible" : "✗ " + (j.error ?? "Lỗi")); };
  const saveVars = async () => { const j = await api(`/api/books/${id}`, "PATCH", { vars }); flash(j.ok ? "✓ Đã lưu biến" : "✗ " + (j.error ?? "Lỗi")); };

  // Bước 2 — Ráp prompt chi tiết (deterministic, nhanh). Lưu Bible trước để chắc chắn dùng bản mới nhất.
  const composeAll = async () => {
    setBusy(true);
    await api(`/api/books/${id}`, "PATCH", { bible });
    const j = await api(`/api/books/${id}/compose`, "POST", { baked });
    setBusy(false);
    if (j.ok) {
      const map = new Map((j.prompts as { pageNo: number; prompt: string }[]).map((x) => [x.pageNo, x.prompt]));
      setPages((ps) => ps.map((p) => ({ ...p, prompt: map.get(p.page_no) ?? p.prompt })));
      flash("✓ Đã ráp prompt chi tiết");
    } else flash("✗ " + (j.error ?? "Lỗi ráp prompt"));
  };
  const composeOne = async (i: number, pageNo: number) => {
    await api(`/api/books/${id}`, "PATCH", { bible });
    const j = await api(`/api/books/${id}/compose`, "POST", { pageNo, baked });
    if (j.ok) { const pr = (j.prompts as { prompt: string }[])[0]?.prompt ?? ""; setPage(i, "prompt", pr); flash(`✓ Ráp prompt trang ${pageNo}`); }
    else flash("✗ " + (j.error ?? "Lỗi"));
  };

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

  const illustrate = async (pageNo: number) => {
    setBusyPage(pageNo); lsSet("bs_image_model", imgModel);
    const payload = { pageNo, model: imgModel || undefined, baked, vars };
    let j = await api(`/api/books/${id}/illustrate`, "POST", payload);
    // Timeout tạm thời (502/504) → tự thử lại 1 lần
    if (!j.ok && /\b50[24]\b|hết giờ|timeout/i.test(String(j.error ?? ""))) {
      j = await api(`/api/books/${id}/illustrate`, "POST", payload);
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

      <BiblePanel bible={bible} setBible={setBible} onSave={saveBible} />
      <VarsPanel vars={vars} setVars={setVars} onSave={saveVars} />

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
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }} title="AI vẽ chữ thẳng vào ảnh (giống mẫu). Tắt = chừa vùng trống để overlay chữ.">
            <input type="checkbox" checked={baked} onChange={(e) => setBaked(e.target.checked)} /> AI vẽ chữ vào ảnh (baked)
          </label>
          <select value={imgModel} onChange={(e) => setImgModel(e.target.value)} title="AI vẽ ảnh" style={{ ...inp, width: 190, fontSize: 12, padding: "7px 9px" }}>
            <option value="">— Model ảnh mặc định —</option>
            <ModelOptions models={imgModels} />
          </select>
          <button style={{ ...btnGhost, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={composeAll} title="Ráp Bible + brief + chữ → prompt chi tiết cho mọi trang">🧱 Ráp prompt tất cả</button>
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
                  <details open={!!p.prompt}>
                    <summary style={{ fontSize: 11, fontWeight: 700, color: "var(--blue)", cursor: "pointer", userSelect: "none" }}>
                      Prompt chi tiết {p.prompt ? "✓" : "(chưa ráp)"} — bấm để xem/sửa
                    </summary>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "6px 0 4px" }}>
                      <button style={{ ...btnGhost, padding: "4px 10px", fontSize: 11 }} onClick={() => composeOne(i, p.page_no)}>🧱 Ráp lại prompt này</button>
                      {p.prompt && <span style={{ fontSize: 10.5, color: "var(--faint)" }}>còn placeholder {"{name}"}… → thay lúc gen</span>}
                    </div>
                    <textarea value={p.prompt ?? ""} onChange={(e) => setPage(i, "prompt", e.target.value)} rows={8} placeholder="Bấm 🧱 Ráp để tự sinh, hoặc gõ tay prompt chuẩn vàng…" style={{ ...inp, resize: "vertical", lineHeight: 1.45, fontSize: 11.5, fontFamily: "ui-monospace, monospace", color: "#334" }} />
                  </details>
                </div>
                <div style={{ display: "grid", gap: 6, alignContent: "start" }}>
                  {illus[p.page_no]
                    ? (
                      <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: "1px solid var(--line)", lineHeight: 0 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={illus[p.page_no]} alt={`p${p.page_no}`} style={{ width: "100%", display: "block" }} />
                        {!baked && p.text.trim() && (
                          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: "linear-gradient(transparent, rgba(0,0,0,.62))", color: "#fff", fontSize: 9.5, padding: "16px 7px 6px", lineHeight: 1.3, textAlign: "center", fontWeight: 600, textShadow: "0 1px 2px rgba(0,0,0,.5)" }}>
                            {fill(p.text, vars)}
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
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>Tên preview: <b>{previewName}</b> (đổi ở ô giá trị của biến <code>name</code>).</div>
    </div>
  );
}
