"use client";
import { useEffect, useState } from "react";

type Title = { id: string; name: string; occasion: string | null; audience: string | null; status: string; updatedAt: string };
type Idea = { name: string; hook: string; angle: string; usp: string; outline: string[] };
type Bible = { format?: string; character?: string; wardrobe?: string; artStyle?: string; palette?: string; textStyle?: string; restrictions?: string };
type Var = { key: string; label?: string; value?: string; type?: "text" | "image"; imageKey?: string; imageUrl?: string };
type Page = { page_no: number; text: string; illustration: string; prompt?: string };
type Detail = {
  title: { id: string; name: string; status: string; occasion: string | null; audience: string | null; concept: unknown; characterRefKey?: string | null; characterRefUrl?: string | null; stylePrompt?: string | null; bible?: Bible | null; vars?: Var[] | null };
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
  { key: "photo", label: "Ảnh nhân vật", value: "", type: "image" },
  { key: "name", label: "Tên bé", value: "", type: "text" },
  { key: "age", label: "Tuổi", value: "", type: "text" },
  { key: "city", label: "Thành phố", value: "", type: "text" },
  { key: "hobby", label: "Sở thích", value: "", type: "text" },
];
// Đảm bảo có 1 biến ẢNH nhân vật: nếu chưa có biến image mà book còn characterRefKey (bản cũ) → chèn vào.
function seedImageVar(base: Var[], refKey?: string | null, refUrl?: string | null): Var[] {
  if (base.some((v) => v.type === "image")) return base;
  if (refKey) return [{ key: "photo", label: "Ảnh nhân vật", type: "image", imageKey: refKey, imageUrl: refUrl ?? undefined }, ...base];
  return base;
}
const MAX_REFS = 4; // số ảnh tham khảo đối thủ tối đa (nén ~448px, giữ payload nhẹ để không timeout)

// Nén ảnh NGAY TRÊN TRÌNH DUYỆT xuống ~448px (JPEG) → payload nhỏ, model vision xử lý nhanh, đỡ timeout.
function downscaleImage(dataUrl: string, max = 448): Promise<string> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (Math.max(w, h) > max) { const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const ctx = c.getContext("2d"); if (!ctx) { resolve(dataUrl); return; }
        ctx.drawImage(img, 0, 0, w, h);
        try { resolve(c.toDataURL("image/jpeg", 0.72)); } catch { resolve(dataUrl); }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch { resolve(dataUrl); }
  });
}

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
      : (r.status === 502 || r.status === 504) ? " — hết giờ (model quá chậm hoặc kết quả quá dài). Đổi sang model NHANH hơn (text: Claude Haiku/Gemini Flash · ảnh: Google nano‑banana), hoặc giảm số trang / vẽ từng trang."
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
        : <ListView titles={titles} open={openDetail} reload={loadList} flash={flash} />}

      {showNew && <NewBookModal models={textModels} close={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); loadList(); openDetail(id); }} flash={flash} />}
    </div>
  );
}

function ListView({ titles, open, reload, flash }: { titles: Title[]; open: (id: string) => void; reload: () => void; flash: (m: string) => void }) {
  const del = async (t: Title) => {
    if (typeof window !== "undefined" && !window.confirm(`Xoá đầu sách "${t.name}"? Thao tác này không khôi phục được.`)) return;
    const j = await api(`/api/books/${t.id}`, "DELETE");
    if (j.ok) { flash("✓ Đã xoá đầu sách"); reload(); } else flash("✗ " + (j.error ?? "Lỗi xoá"));
  };
  if (!titles.length) return <div className="panel empty" style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>Chưa có đầu sách nào. Bấm <b>+ New Book</b> để bắt đầu.</div>;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {titles.map((t) => (
        <div key={t.id} style={{ ...btnGhost, cursor: "default", textAlign: "left", padding: "13px 15px", display: "flex", alignItems: "center", gap: 12 }}>
          <div onClick={() => open(t.id)} style={{ flex: 1, cursor: "pointer", minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{t.name}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{[t.occasion, t.audience].filter(Boolean).join(" · ") || "—"}</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLOR[t.status] ?? "#555", textTransform: "uppercase", letterSpacing: ".4px" }}>{t.status}</span>
          <button onClick={() => del(t)} title="Xoá đầu sách" style={{ ...btnGhost, padding: "6px 11px", fontSize: 12, color: "var(--red)", borderColor: "var(--line)" }}>Xoá</button>
        </div>
      ))}
    </div>
  );
}

function NewBookModal({ close, onCreated, flash, models }: { close: () => void; onCreated: (id: string) => void; flash: (m: string) => void; models: { id: string; name: string }[] }) {
  const [brief, setBrief] = useState({ occasion: "", audience: "", pages: 12, notes: "", count: 4 });
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [model, setModel] = useState("");
  const [refs, setRefs] = useState<string[]>([]); // ảnh listing đối thủ (data URL)
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  useEffect(() => { setModel(lsGet("bs_text_model")); }, []);

  const addRefs = (files: FileList) => {
    const room = MAX_REFS - refs.length;
    const list = Array.from(files).slice(0, Math.max(0, room));
    list.forEach((f) => {
      const r = new FileReader();
      r.onload = () => { downscaleImage(String(r.result)).then((small) => setRefs((cur) => (cur.length >= MAX_REFS ? cur : [...cur, small]))); };
      r.readAsDataURL(f);
    });
  };
  // Import ảnh từ LINK (listing Etsy/Amazon/web hoặc link ảnh trực tiếp). Server đọc og:image, loại video.
  const importFromLink = async () => {
    const u = importUrl.trim();
    if (!u) return;
    if (refs.length >= MAX_REFS) { flash(`✗ Đã đủ ${MAX_REFS} ảnh`); return; }
    setImporting(true);
    const j = await api("/api/books/import-image", "POST", { url: u });
    setImporting(false);
    if (j.ok && j.dataUrl) { const small = await downscaleImage(String(j.dataUrl)); setRefs((cur) => (cur.length >= MAX_REFS ? cur : [...cur, small])); setImportUrl(""); }
    else {
      const raw = String(j.error ?? "Lỗi lấy ảnh từ link");
      const msg = /\b50[24]\b|hết giờ|timeout/i.test(raw) ? "Link chặn bot / quá hạn — tải ảnh thủ công bằng nút +" : raw;
      flash("✗ Import: " + msg);
    }
  };

  const gen = async () => {
    setBusy(true); setIdeas([]);
    lsSet("bs_text_model", model);
    // BƯỚC RIÊNG (best-effort): phân tích ảnh đối thủ → text. Lỗi/chậm thì bỏ qua, vẫn sinh ý tưởng.
    let extra = "";
    if (refs.length) {
      const a = await api("/api/books/analyze-refs", "POST", { images: refs, notes: brief.notes });
      if (a.ok && a.analysis) extra = "\n\n[Phân tích ảnh listing đối thủ]\n" + String(a.analysis);
      else flash("⚠ Không phân tích được ảnh — vẫn sinh ý tưởng từ mô tả" + (a.error ? ` (${String(a.error).slice(0, 60)})` : ""));
    }
    const j = await api("/api/books/ideas", "POST", { ...brief, notes: (brief.notes || "") + extra, model: model || undefined });
    setBusy(false);
    if (j.ok) {
      setIdeas((j.ideas as Idea[]) ?? []);
      if (extra) flash("✓ Đã đưa phân tích ảnh đối thủ vào ý tưởng");
    } else flash("✗ " + (j.error ?? "Lỗi sinh ý tưởng"));
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
        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600 }}>Mô tả cuốn sách
            <textarea rows={3} style={{ ...inp, marginTop: 4, resize: "vertical", lineHeight: 1.5 }}
              placeholder="Sách gì, cho ai, phong cách nào… vd: Sách sinh nhật đầu đời cho bé ~1 tuổi, phong cách storybook ấm áp, tông pastel."
              value={brief.notes} onChange={(e) => setBrief({ ...brief, notes: e.target.value })} />
          </label>
          <label style={{ fontSize: 12, fontWeight: 600, width: 150 }}>Số trang
            <input type="number" style={{ ...inp, marginTop: 4 }} value={brief.pages} onChange={(e) => setBrief({ ...brief, pages: Number(e.target.value) || 12 })} />
          </label>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Ảnh tham khảo đối thủ <span style={{ color: "var(--muted)", fontWeight: 400 }}>(tuỳ chọn, tối đa {MAX_REFS} — AI đọc để đề xuất ý tưởng cạnh tranh)</span></div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {refs.map((u, i) => (
                <div key={i} style={{ position: "relative" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt={`ref${i}`} style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} />
                  <button onClick={() => setRefs((cur) => cur.filter((_, idx) => idx !== i))} title="Xoá" style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 999, border: "1px solid var(--line)", background: "#fff", cursor: "pointer", fontSize: 11, lineHeight: 1, padding: 0 }}>✕</button>
                </div>
              ))}
              {refs.length < MAX_REFS && (
                <label style={{ width: 56, height: 56, display: "grid", placeItems: "center", borderRadius: 8, border: "1px dashed var(--line)", color: "var(--blue)", fontSize: 22, cursor: "pointer" }} title="Tải ảnh từ máy">
                  +
                  <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { if (e.target.files?.length) addRefs(e.target.files); e.target.value = ""; }} />
                </label>
              )}
            </div>
            {refs.length < MAX_REFS && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input value={importUrl} onChange={(e) => setImportUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); importFromLink(); } }}
                  placeholder="Dán link listing Etsy / Amazon / web… (tự lấy ảnh, bỏ video)" style={{ ...inp, flex: 1, fontSize: 12.5, padding: "8px 11px" }} />
                <button onClick={importFromLink} disabled={importing || !importUrl.trim()} style={{ ...btnGhost, whiteSpace: "nowrap", opacity: (importing || !importUrl.trim()) ? 0.6 : 1 }}>{importing ? "Đang lấy…" : "Nhập từ link"}</button>
              </div>
            )}
            {refs.length > 0 && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>Ảnh được phân tích ở một bước riêng (model xem‑ảnh) rồi đưa vào ý tưởng. Nếu phân tích ảnh lỗi/chậm, hệ thống vẫn sinh ý tưởng từ mô tả.</div>}
          </div>
          <details style={{ fontSize: 12 }}>
            <summary style={{ cursor: "pointer", color: "var(--muted)", fontWeight: 600 }}>⚙ Tuỳ chọn (số ý tưởng · model AI)</summary>
            <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 600, width: 150 }}>Số ý tưởng
                <input type="number" style={{ ...inp, marginTop: 4 }} value={brief.count} onChange={(e) => setBrief({ ...brief, count: Number(e.target.value) || 4 })} />
              </label>
              <ModelPicker models={models} value={model} onChange={setModel} label="AI viết ý tưởng/kịch bản" />
            </div>
          </details>
        </div>
        <button style={{ ...btnBlue, marginTop: 14, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={gen}>{busy ? "Đang nghĩ…" : "✨ Sinh ý tưởng"}</button>

        {ideas.length > 0 && (
          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            {ideas.map((idea, i) => (
              <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 13 }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{idea.name}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>{idea.hook}</div>
                <div style={{ fontSize: 12, marginTop: 6 }}><b>Angle:</b> {idea.angle}</div>
                <div style={{ fontSize: 12, marginTop: 2 }}><b>USP:</b> {idea.usp}</div>
                {idea.outline?.length > 0 && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>Tóm tắt: {idea.outline.slice(0, 3).join(" · ")}{idea.outline.length > 3 ? "…" : ""}</div>}
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
// Gọn: mặc định chỉ hiện phần hay chỉnh (nhân vật/trang phục/phong cách/màu). Phần khung cố định
// (quy tắc chữ/cấm/khổ) giấu trong "Nâng cao" — AI đã điền sẵn, ít khi phải sửa.
function BiblePanel({ bible, setBible, onSave }: { bible: Bible; setBible: (b: Bible) => void; onSave: () => void }) {
  const [open, setOpen] = useState(false);
  const [adv, setAdv] = useState(false);
  const F = (k: keyof Bible, label: string, rows = 2, ph = "") => (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--faint)", textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
      <textarea value={bible[k] ?? ""} onChange={(e) => setBible({ ...bible, [k]: e.target.value })} rows={rows} placeholder={ph} style={{ ...inp, resize: "vertical", lineHeight: 1.5, fontSize: 12.5 }} />
    </div>
  );
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, marginBottom: 12, background: "#FCFCFF" }}>
      <button onClick={() => setOpen((v) => !v)} style={{ ...btnGhost, border: 0, width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 8, background: "transparent" }}>
        <span style={{ fontWeight: 800, fontSize: 14 }}>Style Bible</span>
        <span style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 500 }}>— giữ nhân vật &amp; phong cách nhất quán mọi trang</span>
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
          <button onClick={() => setAdv((v) => !v)} style={{ ...btnGhost, border: 0, background: "transparent", padding: 0, fontSize: 12, color: "var(--blue)", textAlign: "left", cursor: "pointer" }}>{adv ? "▲ Ẩn nâng cao" : "▼ Nâng cao (quy tắc chữ · cấm · khổ)"}</button>
          {adv && <>{F("textStyle", "Quy tắc chữ", 3)}{F("restrictions", "Danh sách cấm", 5)}{F("format", "Khổ trang / chất lượng", 2)}</>}
        </div>
      )}
    </div>
  );
}

// ===== Panel: BIẾN CÁ NHÂN HOÁ (add custom tên/tuổi/…) =====
function VarsPanel({ vars, setVars, onSave, bookId, flash }: { vars: Var[]; setVars: (v: Var[]) => void; onSave: () => void; bookId: string; flash: (m: string) => void }) {
  const [upIdx, setUpIdx] = useState<number | null>(null);
  const setV = (i: number, k: keyof Var, val: string) => setVars(vars.map((v, idx) => idx === i ? { ...v, [k]: val } : v));
  const patch = (i: number, p: Partial<Var>) => setVars(vars.map((v, idx) => idx === i ? { ...v, ...p } : v));
  const small: React.CSSProperties = { ...inp, fontSize: 12, padding: "6px 9px" };
  const uploadImg = async (i: number, file: File) => {
    setUpIdx(i);
    const t = await api(`/api/books/${bookId}/reference-url`, "POST", { contentType: file.type || "image/png" });
    if (!t.ok) { flash("✗ " + (t.error ?? "Lỗi")); setUpIdx(null); return; }
    try {
      const put = await fetch(t.url as string, { method: (t.method as string) || "PUT", headers: { "Content-Type": file.type || "image/png" }, body: file });
      if (!put.ok) throw new Error("upload HTTP " + put.status);
      patch(i, { imageKey: String(t.key), imageUrl: String(t.publicUrl || "") });
      flash("✓ Đã tải ảnh biến — nhớ Lưu biến");
    } catch (e) { flash("✗ upload: " + String((e as Error)?.message ?? e).slice(0, 80)); }
    setUpIdx(null);
  };
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, marginBottom: 12, padding: 12, background: "#FAFBFF" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 800, fontSize: 14 }}>Biến cá nhân hoá</span>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>— Chữ hoặc ẢNH (bé/bố/mẹ…). Biến ảnh dùng làm reference giữ nhân vật khi vẽ.</span>
        <button style={{ ...btnGhost, marginLeft: "auto", padding: "5px 10px", fontSize: 12 }} onClick={() => setVars([...vars, { key: "", label: "", value: "", type: "text" }])}>+ Chữ</button>
        <button style={{ ...btnGhost, padding: "5px 10px", fontSize: 12 }} onClick={() => setVars([...vars, { key: "", label: "", type: "image" }])}>+ Ảnh</button>
        <button style={{ ...btnBlue, padding: "5px 10px", fontSize: 12 }} onClick={onSave}>Lưu biến</button>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {vars.map((v, i) => {
          const isImg = v.type === "image";
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "104px 1fr 72px 1fr 28px", gap: 6, alignItems: "center" }}>
              <input value={v.key} onChange={(e) => setV(i, "key", e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))} placeholder="key" style={small} />
              <input value={v.label ?? ""} onChange={(e) => setV(i, "label", e.target.value)} placeholder="nhãn" style={small} />
              <select value={v.type ?? "text"} onChange={(e) => patch(i, { type: e.target.value as "text" | "image" })} style={small}>
                <option value="text">Chữ</option>
                <option value="image">Ảnh</option>
              </select>
              {isImg ? (
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: upIdx === i ? "wait" : "pointer" }}>
                  {v.imageUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={v.imageUrl} alt="ref" style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)" }} />
                    : <span style={{ width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: 6, border: "1px dashed var(--line)", color: "var(--muted)", fontSize: 10 }}>Ảnh</span>}
                  <span style={{ fontSize: 11.5, color: "var(--blue)", fontWeight: 600 }}>{upIdx === i ? "Đang tải…" : v.imageUrl ? "Đổi ảnh" : "Tải ảnh"}</span>
                  <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImg(i, f); e.target.value = ""; }} />
                </label>
              ) : (
                <input value={v.value ?? ""} onChange={(e) => setV(i, "value", e.target.value)} placeholder="giá trị (Liam)" style={small} />
              )}
              <button style={{ ...btnGhost, padding: "5px 0", fontSize: 12 }} title="Xoá" onClick={() => setVars(vars.filter((_, idx) => idx !== i))}>✕</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Thẻ BƯỚC đánh số — cho luồng Gen Book rõ ràng, đúng thứ tự.
function StepCard({ n, title, desc, right, children }: { n: number; title: string; desc?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 14, marginBottom: 14, background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ width: 24, height: 24, borderRadius: 999, background: "var(--blue)", color: "#fff", display: "grid", placeItems: "center", fontSize: 12.5, fontWeight: 800, flexShrink: 0 }}>{n}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14.5 }}>{title}</div>
          {desc && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 1 }}>{desc}</div>}
        </div>
        {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
      </div>
      {children}
    </div>
  );
}

function DetailView({ detail, reload, flash, models }: { detail: Detail; reload: () => void; flash: (m: string) => void; models: { id: string; name: string }[] }) {
  const id = detail.title.id;
  const concept = (detail.title.concept ?? {}) as { hook?: string; angle?: string; usp?: string; outline?: string[] };
  const [pages, setPages] = useState<Page[]>(detail.pages.map((p) => ({ page_no: p.pageNo, text: p.textTemplate ?? "", illustration: p.illustrationBrief ?? "", prompt: p.promptTemplate ?? "" })));
  const [busy, setBusy] = useState(false);
  const [busySetup, setBusySetup] = useState(false);
  const [model, setModel] = useState("");
  // ---- Bible + Vars ----
  const [bible, setBible] = useState<Bible>(detail.title.bible ?? {});
  const [vars, setVars] = useState<Var[]>(seedImageVar(detail.title.vars && detail.title.vars.length ? detail.title.vars : DEFAULT_VARS, detail.title.characterRefKey, detail.title.characterRefUrl));
  const [baked, setBaked] = useState(true);
  // ---- Gen Image state ----
  const [imgModels, setImgModels] = useState<{ id: string; name: string }[]>([]);
  const [imgModel, setImgModel] = useState("");
  const [illus, setIllus] = useState<Record<number, string>>({});
  const [busyPage, setBusyPage] = useState<number | null>(null);

  const previewName = (vars.find((v) => v.key === "name")?.value || "Emma");

  useEffect(() => { setModel(lsGet("bs_text_model")); setImgModel(lsGet("bs_image_model")); }, []);
  useEffect(() => { api("/api/books/models?type=image").then((j) => { if (j.ok) setImgModels((j.models as { id: string; name: string }[]) ?? []); }); }, []);
  // Đồng bộ khi detail reload
  useEffect(() => {
    setBible(detail.title.bible ?? {});
    setVars(seedImageVar(detail.title.vars && detail.title.vars.length ? detail.title.vars : DEFAULT_VARS, detail.title.characterRefKey, detail.title.characterRefUrl));
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
  const saveVars = async () => {
    // Đồng bộ ảnh nhân vật chính (biến image đầu tiên) sang characterRefKey để tương thích bản cũ + tránh vẽ trùng ảnh.
    const firstImg = vars.find((v) => v.type === "image" && v.imageKey);
    const body: Record<string, unknown> = { vars };
    if (firstImg?.imageKey) body.characterRefKey = firstImg.imageKey;
    const j = await api(`/api/books/${id}`, "PATCH", body);
    flash(j.ok ? "✓ Đã lưu biến" : "✗ " + (j.error ?? "Lỗi"));
  };
  // ✨ AI tự dựng Style Bible + bộ biến THEO CHỦ ĐỀ (giải bài toán "1 form cho vô số chủ đề").
  const setupAI = async () => {
    setBusySetup(true); lsSet("bs_text_model", model);
    const j = await api(`/api/books/${id}/setup`, "POST", { model: model || undefined });
    setBusySetup(false);
    if (j.ok) {
      setBible((j.bible as Bible) ?? {});
      setVars(((j.vars as Var[]) ?? []).map((v) => ({ ...v, value: v.value ?? "" })));
      flash("✓ AI đã dựng Bible + biến theo chủ đề — kiểm tra & chỉnh lại nếu cần");
    } else flash("✗ " + (j.error ?? "Lỗi dựng khung"));
  };

  // Ráp prompt chi tiết cho MỌI trang (deterministic, nhanh — không gọi model ảnh nên không quá tải).
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
  // Ráp prompt chi tiết cho 1 trang. Lưu Bible trước để dùng bản mới nhất.
  const composeOne = async (i: number, pageNo: number) => {
    await api(`/api/books/${id}`, "PATCH", { bible });
    const j = await api(`/api/books/${id}/compose`, "POST", { pageNo, baked });
    if (j.ok) { const pr = (j.prompts as { prompt: string }[])[0]?.prompt ?? ""; setPage(i, "prompt", pr); flash(`✓ Ráp prompt trang ${pageNo}`); }
    else flash("✗ " + (j.error ?? "Lỗi"));
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

  return (
    <div>
      <StepCard n={1} title={`Chủ đề: ${detail.title.name}`} desc={[detail.title.occasion, detail.title.audience].filter(Boolean).join(" · ") || undefined}>
        {concept.hook ? <div style={{ fontSize: 13, color: "var(--ink)" }}>{concept.hook}</div>
          : <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Chủ đề đã tạo từ ý tưởng. Sang bước 2 để dựng bộ khung.</div>}
      </StepCard>

      <StepCard n={2} title="Bộ khung chủ đề — Style Bible + Biến"
        desc="AI tự dựng theo chủ đề (nhân vật · trang phục · phong cách · màu · cấm) rồi bạn chỉnh. Khối này ráp vào MỌI trang → giữ nhân vật nhất quán."
        right={<button style={{ ...btnBlue, opacity: busySetup ? 0.6 : 1 }} disabled={busySetup} onClick={setupAI}>{busySetup ? "AI đang dựng…" : "✨ AI dựng theo chủ đề"}</button>}>
        <BiblePanel bible={bible} setBible={setBible} onSave={saveBible} />
        <VarsPanel vars={vars} setVars={setVars} onSave={saveVars} bookId={id} flash={flash} />
      </StepCard>

      <StepCard n={3} title="Kịch bản → Prompt chi tiết → Vẽ" desc="Sinh kịch bản từng trang, ráp prompt sâu, rồi vẽ. Trang lỗi chỉ cần vẽ lại riêng trang đó.">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Kịch bản {pages.length ? `· ${pages.length} trang` : ""}</h3>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <button style={{ ...btnGhost, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={genScript}>{busy ? "Đang viết…" : pages.length ? "↻ Sinh lại" : "✨ Sinh kịch bản"}</button>
          {pages.length > 0 && <button style={{ ...btnBlue, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}>Lưu</button>}
        </div>
      </div>

      {pages.length > 0 && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 12, padding: 12, marginBottom: 12, background: "#FAFBFF" }}>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Ảnh nhân vật đặt ở <b>Biến (bước 2)</b>.</span>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }} title="AI vẽ chữ thẳng vào ảnh (giống mẫu). Tắt = chừa vùng trống để overlay chữ.">
            <input type="checkbox" checked={baked} onChange={(e) => setBaked(e.target.checked)} /> AI vẽ chữ vào ảnh
          </label>
          <button style={{ ...btnGhost, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={composeAll} title="Ráp Bible + brief + chữ → prompt chi tiết cho mọi trang (không vẽ, không quá tải)">Ráp prompt tất cả</button>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Vẽ từng trang bên dưới (tránh quá tải).</span>
          <details style={{ fontSize: 12, marginLeft: "auto" }}>
            <summary style={{ cursor: "pointer", color: "var(--muted)", fontWeight: 600, listStyle: "none" }}>⚙ Model AI</summary>
            <div style={{ display: "grid", gap: 6, marginTop: 6, minWidth: 210 }}>
              <select value={model} onChange={(e) => setModel(e.target.value)} title="AI viết ý tưởng/kịch bản" style={{ ...inp, fontSize: 12, padding: "6px 9px" }}>
                <option value="">— Model text (viết) mặc định —</option>
                <ModelOptions models={models} />
              </select>
              <select value={imgModel} onChange={(e) => setImgModel(e.target.value)} title="AI vẽ ảnh" style={{ ...inp, fontSize: 12, padding: "6px 9px" }}>
                <option value="">— Model ảnh (vẽ) mặc định —</option>
                <ModelOptions models={imgModels} />
              </select>
            </div>
          </details>
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
                  <details>
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
                  <button style={{ ...btnGhost, fontSize: 11.5, padding: "6px 10px", opacity: (busyPage === p.page_no) ? 0.6 : 1 }} disabled={busyPage === p.page_no} onClick={() => illustrate(p.page_no)}>{busyPage === p.page_no ? "Đang vẽ…" : illus[p.page_no] ? "↻ Vẽ lại" : "🎨 Vẽ"}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>Tên preview: <b>{previewName}</b> (đổi ở ô giá trị của biến <code>name</code>).</div>
      </StepCard>
    </div>
  );
}
