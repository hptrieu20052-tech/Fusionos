"use client";
import { useEffect, useState, useRef } from "react";
import { BOOK_PRODUCTS, getBookProduct, genBlocks } from "@/lib/book-products";
import DateRangePicker, { rangeToDates, RangeValue } from "@/components/date-range";

type Title = { id: string; name: string; occasion: string | null; audience: string | null; status: string; kind?: string | null; sourceId?: string | null; updatedAt: string; createdAt?: string | null; ownerId?: string | null; ownerName?: string | null };
type Owner = { id: string; name: string };
type Idea = { name: string; hook: string; angle: string; usp: string; outline: string[] };
type Bible = { format?: string; character?: string; wardrobe?: string; artStyle?: string; palette?: string; textStyle?: string; restrictions?: string };
type Cover = { text?: string; brief?: string; prompt?: string };
type Var = { key: string; label?: string; value?: string; type?: "text" | "image"; imageKey?: string; imageUrl?: string };
type Page = { page_no: number; text: string; illustration: string; prompt?: string };
type Detail = {
  title: { id: string; name: string; status: string; occasion: string | null; audience: string | null; concept: unknown; characterRefKey?: string | null; characterRefUrl?: string | null; stylePrompt?: string | null; bible?: Bible | null; vars?: Var[] | null; productKey?: string | null; cover?: Cover | null; kind?: string | null; sourceId?: string | null };
  pages: { pageNo: number; textTemplate: string | null; illustrationBrief: string | null; promptTemplate?: string | null }[];
  assets?: Record<number, string | null>;
};

const inp: React.CSSProperties = { padding: "9px 12px", border: "1px solid var(--line)", borderRadius: 10, font: "inherit", fontSize: 13, width: "100%", boxSizing: "border-box" };
const btn: React.CSSProperties = { border: 0, borderRadius: 10, padding: "9px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13 };
const btnBlue = { ...btn, background: "var(--blue)", color: "#fff" };
const btnGhost = { ...btn, background: "#fff", border: "1px solid var(--line)", color: "var(--ink)" };
const STATUS_COLOR: Record<string, string> = { idea: "#8a6d00", script: "#0e6bd6", characters: "#7a3fb0", simulation: "#0e8a5f", mockup: "#c2410c", ready: "#12703c" };

// Icon SVG đơn giản (không dùng emoji) — nét mảnh, ăn theo màu chữ của nút.
const icp = { width: 13, height: 13, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, style: { verticalAlign: "-2px", marginRight: 5 } };
const IcSpark = () => <svg {...icp}><path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2L12 2z" /></svg>;
const IcBrush = () => <svg {...icp}><path d="M17 3l4 4L8 20H4v-4L17 3z" /></svg>;
const IcRefresh = () => <svg {...icp}><path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" /></svg>;
const IcDownload = () => <svg {...icp}><path d="M12 3v12M6 11l6 6 6-6M4 21h16" /></svg>;
const IcStop = () => <svg {...icp}><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>;
const IcLayers = () => <svg {...icp}><path d="M12 2l10 6-10 6L2 8l10-6zM2 16l10 6 10-6" /></svg>;
const IcBookS = () => <svg {...icp}><path d="M4 4a2 2 0 0 1 2-2h14v18H6a2 2 0 0 0-2 2V4zM20 16H6" /></svg>;

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
  { key: "photo", label: "Character photo", value: "", type: "image" },
  { key: "name", label: "Child's name", value: "", type: "text" },
  { key: "age", label: "Age", value: "", type: "text" },
  { key: "city", label: "City", value: "", type: "text" },
  { key: "hobby", label: "Hobby", value: "", type: "text" },
];
// Đảm bảo có 1 biến ẢNH nhân vật: nếu chưa có biến image mà book còn characterRefKey (bản cũ) → chèn vào.
function seedImageVar(base: Var[], refKey?: string | null, refUrl?: string | null): Var[] {
  if (base.some((v) => v.type === "image")) return base;
  if (refKey) return [{ key: "photo", label: "Character photo", type: "image", imageKey: refKey, imageUrl: refUrl ?? undefined }, ...base];
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
    const note = r.status === 404 ? " — API not deployed"
      : (r.status === 502 || r.status === 504) ? " — timed out (model too slow or output too long). Try a faster model (text: Claude Haiku/Gemini Flash · image: Google nano‑banana), or draw pages one at a time."
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
  const [owners, setOwners] = useState<Owner[]>([]);
  const [scoped, setScoped] = useState(false);
  const loadList = () => api("/api/books").then((j) => {
    if (j.ok) { setTitles(j.titles as Title[]); setOwners((j.owners as Owner[]) ?? []); setScoped(!!j.scoped); }
  });
  useEffect(() => {
    loadList();
    api("/api/books/models?type=text").then((j) => { if (j.ok) setTextModels((j.models as { id: string; name: string }[]) ?? []); });
  }, []);

  const [custom, setCustom] = useState<{ cloneId: string; masterId: string } | null>(null);
  const [masterView, setMasterView] = useState<string | null>(null);
  // Tab danh sách nâng lên parent — để "+ New Book" chỉ hiện ở tab New ideas.
  const [tab, setTab] = useState<"ideas" | "custom">("ideas");
  useEffect(() => { const v = lsGet("bs_list_tab"); if (v === "custom" || v === "ideas") setTab(v); }, []);
  const openDetail = async (id: string) => {
    const j = await api(`/api/books/${id}`);
    if (j.ok) setDetail(j as unknown as Detail); else flash("✗ " + (j.error ?? "Error"));
  };

  return (
    <div style={{ padding: "18px 20px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Book Studio</h2>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#7a3fb0", background: "#F3EAFB", border: "1px solid #E3D0F5", borderRadius: 999, padding: "2px 9px" }}>AI · Beta</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {(detail || custom || masterView) && <button style={btnGhost} onClick={() => { setDetail(null); setCustom(null); setMasterView(null); loadList(); }}>← List</button>}
        </div>
      </div>
      {detail && <div className="sub" style={{ marginBottom: 14, color: "var(--muted)", fontSize: 12.5 }}>Script → Detailed prompt → Custom photo/name → Generate each page.</div>}
      {msg && (
        <div style={{ position: "fixed", bottom: 22, right: 22, zIndex: 200, maxWidth: 380, padding: "12px 18px", borderRadius: 12, fontSize: 13, fontWeight: 600, color: "#fff", boxShadow: "0 10px 30px rgba(15,23,42,.22)", background: msg.startsWith("✗") ? "var(--red)" : msg.startsWith("⚠") ? "#b45309" : "var(--green)" }}>
          {msg}
        </div>
      )}

      {custom ? <CustomizeView cloneId={custom.cloneId} masterId={custom.masterId} flash={flash} openFull={() => { const id = custom.cloneId; setCustom(null); openDetail(id); }} />
        : masterView ? <MasterView id={masterView} flash={flash} openFull={() => { const id = masterView; setMasterView(null); openDetail(id); }} onCustomize={(cloneId, masterId) => { setMasterView(null); setCustom({ cloneId, masterId }); }} />
        : detail ? <DetailView detail={detail} models={textModels} reload={() => openDetail(detail.title.id)} flash={flash} />
        : <ListView titles={titles} owners={owners} scoped={scoped} tab={tab} setTab={setTab} open={openDetail} openMaster={(id) => setMasterView(id)} reload={loadList} flash={flash} onCustomize={(cloneId, masterId) => setCustom({ cloneId, masterId })} onNewBook={() => setShowNew(true)} />}

      {showNew && <NewBookModal models={textModels} close={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); loadList(); openDetail(id); }} flash={flash} />}
    </div>
  );
}

function ListView({ titles, owners, scoped, tab, setTab, open, openMaster, reload, flash, onCustomize, onNewBook }: { titles: Title[]; owners: Owner[]; scoped: boolean; tab: "ideas" | "custom"; setTab: (t: "ideas" | "custom") => void; open: (id: string) => void; openMaster?: (id: string) => void; reload: () => void; flash: (m: string) => void; onCustomize?: (cloneId: string, masterId: string) => void; onNewBook?: () => void }) {
  // Filter theo SELLER (admin) + KHOẢNG NGÀY (mặc định 30 ngày) + phân trang 20 book/trang.
  const PER_PAGE = 20;
  const [owner, setOwner] = useState("");
  const [dr, setDr] = useState<RangeValue | null>({ range: "30d" });
  const [pg, setPg] = useState(1);
  useEffect(() => { setPg(1); }, [tab, owner, dr]);
  const del = async (t: Title) => {
    if (typeof window !== "undefined" && !window.confirm(`Delete book "${t.name}"? This cannot be undone.`)) return;
    const j = await api(`/api/books/${t.id}`, "DELETE");
    if (j.ok) { flash("✓ Book deleted"); reload(); } else flash("✗ " + (j.error ?? "Delete error"));
  };
  // Nhân bản từ mẫu → bản cho KHÁCH (giữ script/prompt/style; xoá tên/ảnh để điền của khách).
  const [askT, setAskT] = useState<Title | null>(null);
  const [cloneBusy, setCloneBusy] = useState(false);
  const customize = async (t: Title, customer: string) => {
    if (cloneBusy) return;
    setCloneBusy(true);
    const j = await api(`/api/books/${t.id}/clone`, "POST", { customer });
    setCloneBusy(false);
    if (j.ok) {
      setAskT(null);
      flash("✓ Customer copy created — fill in the customer's variables, then Generate");
      if (onCustomize) onCustomize(j.id as string, t.id); else open(j.id as string);
    } else flash("✗ " + (j.error ?? "Clone error"));
  };

  const row = (t: Title, master: boolean) => (
    <div key={t.id} style={{ ...btnGhost, cursor: "default", textAlign: "left", padding: "13px 15px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {/* Click theo loại: master → màn master gọn · bản khách → màn customize 2 cột · book thường → editor đầy đủ */}
      <div onClick={() => master && openMaster ? openMaster(t.id) : t.sourceId && onCustomize ? onCustomize(t.id, t.sourceId!) : open(t.id)} style={{ flex: 1, cursor: "pointer", minWidth: 180 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{t.name}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{[!scoped ? t.ownerName : null, t.occasion, t.audience].filter(Boolean).join(" · ") || "—"}</div>
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLOR[t.status] ?? "#555", textTransform: "uppercase", letterSpacing: ".4px" }}>{t.status}</span>
      {master ? (
        <button onClick={() => setAskT(t)} title="Clone this design for a customer order: keeps everything, clears name & photo for the new customer" style={{ ...btnBlue, padding: "6px 12px", fontSize: 12 }}>Customize for customer</button>
      ) : t.sourceId ? (
        <button onClick={() => { if (onCustomize) onCustomize(t.id, t.sourceId!); }} title="Reopen the 2-column customize screen (original design vs personalized copy)" style={{ ...btnBlue, padding: "6px 12px", fontSize: 12 }}>Continue customize</button>
      ) : null}
      <button onClick={() => del(t)} title="Delete book" style={{ ...btnGhost, padding: "6px 11px", fontSize: 12, color: "var(--red)", borderColor: "var(--line)" }}>Delete</button>
    </div>
  );

  // Áp filter seller + khoảng ngày (theo ngày TẠO book).
  const range = dr ? rangeToDates(dr) : null;
  const inFilter = (t: Title) => {
    if (owner && t.ownerId !== owner) return false;
    if (range) {
      const c = String(t.createdAt ?? t.updatedAt ?? "").slice(0, 10);
      if (c && (c < range.from || c > range.to)) return false;
    }
    return true;
  };
  const vis = titles.filter(inFilter);
  // Master ở tab Custom books; BẢN KHÁCH (sourceId) cũng ở Custom books — xếp ngay dưới master gốc.
  // New ideas chỉ còn sách Ý TƯỞNG thật.
  const masters = vis.filter((t) => t.kind === "master");
  const copies = vis.filter((t) => t.kind !== "master" && t.sourceId);
  const drafts = vis.filter((t) => t.kind !== "master" && !t.sourceId);
  const copiesOf = (m: Title) => copies.filter((c) => c.sourceId === m.id);
  const orphans = copies.filter((c) => !masters.some((m) => m.id === c.sourceId));

  // Hàng BẢN KHÁCH — thụt vào dưới master, gọn hơn hàng thường.
  const copyRow = (t: Title) => (
    <div key={t.id} style={{ ...btnGhost, cursor: "default", textAlign: "left", padding: "9px 13px", marginLeft: 26, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "#FAFBFF" }}>
      <div onClick={() => { if (onCustomize && t.sourceId) onCustomize(t.id, t.sourceId); }} style={{ flex: 1, cursor: "pointer", minWidth: 160, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: "var(--blue)", background: "#E8F0FE", borderRadius: 999, padding: "2px 8px", letterSpacing: ".4px" }}>COPY</span>
        <span style={{ fontWeight: 650, fontSize: 13 }}>{t.name}</span>
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLOR[t.status] ?? "#555", textTransform: "uppercase", letterSpacing: ".4px" }}>{t.status}</span>
      <button onClick={() => { if (onCustomize && t.sourceId) onCustomize(t.id, t.sourceId); }} style={{ ...btnBlue, padding: "5px 11px", fontSize: 11.5 }}>Continue customize</button>
      <button onClick={() => del(t)} title="Delete copy" style={{ ...btnGhost, padding: "5px 10px", fontSize: 11.5, color: "var(--red)", borderColor: "var(--line)" }}>Delete</button>
    </div>
  );
  // Phân trang 20 book/trang (theo tab đang mở).
  const totalItems = tab === "custom" ? masters.length : drafts.length;
  const totalPg = Math.max(1, Math.ceil(totalItems / PER_PAGE));
  const pgSafe = Math.min(pg, totalPg);
  const pageSlice = <T,>(arr: T[]) => arr.slice((pgSafe - 1) * PER_PAGE, pgSafe * PER_PAGE);
  const goPg = (n: number) => { setPg(n); if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" }); };
  const pager = totalItems > PER_PAGE ? (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 16 }}>
      <button style={{ ...btnGhost, padding: "6px 13px", fontSize: 12, opacity: pgSafe <= 1 ? 0.45 : 1 }} disabled={pgSafe <= 1} onClick={() => goPg(pgSafe - 1)}>← Prev</button>
      <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 700 }}>Page {pgSafe}/{totalPg} · {totalItems} books</span>
      <button style={{ ...btnGhost, padding: "6px 13px", fontSize: 12, opacity: pgSafe >= totalPg ? 0.45 : 1 }} disabled={pgSafe >= totalPg} onClick={() => goPg(pgSafe + 1)}>Next →</button>
    </div>
  ) : null;

  return (
    <div>
      {/* Tabs + bộ lọc: seller (admin) + khoảng ngày (mặc định 30 ngày). */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", background: "#EEF1F6", borderRadius: 12, padding: 4, gap: 3 }}>
          {([["ideas", `New ideas (${drafts.length})`], ["custom", `Custom books (${masters.length})`]] as ["ideas" | "custom", string][]).map(([v, lbl]) => (
            <button key={v} onClick={() => { setTab(v); lsSet("bs_list_tab", v); }}
              style={{ padding: "8px 18px", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer", border: 0, background: tab === v ? "#fff" : "transparent", color: tab === v ? "var(--blue)" : "var(--muted)", boxShadow: tab === v ? "0 1px 3px rgba(0,0,0,.12)" : "none" }}>
              {lbl}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {!scoped && owners.length > 1 && (
            <select value={owner} onChange={(e) => setOwner(e.target.value)} style={{ ...inp, width: "auto", minWidth: 150, height: 38, boxSizing: "border-box", fontSize: 12.5 }}>
              <option value="">All sellers</option>
              {owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          <DateRangePicker value={dr ?? { range: "" }} onChange={(v) => setDr(v)} align="right" allowClear onClear={() => setDr(null)} />
          {tab === "ideas" && onNewBook && <button style={{ ...btnBlue, height: 38, padding: "0 16px" }} onClick={onNewBook}>+ New Book</button>}
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
        {tab === "custom" ? "Selling designs (masters) with their customer copies underneath — customize a copy for each order." : "New books being built."}
      </div>
      {tab === "custom" && <ImportDesignBar reload={reload} open={open} flash={flash} />}
      {tab === "custom"
        ? (masters.length || orphans.length
          ? <div style={{ display: "grid", gap: 10 }}>
              {pageSlice(masters).map((t) => (
                <div key={t.id} style={{ display: "grid", gap: 8 }}>
                  {row(t, true)}
                  {copiesOf(t).map(copyRow)}
                </div>
              ))}
              {orphans.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".4px", marginTop: 6 }}>Customer copies (master deleted)</div>
                  {orphans.map((t) => <div key={t.id} style={{ marginLeft: -26 }}>{copyRow(t)}</div>)}
                </>
              )}
            </div>
          : <div className="panel empty" style={{ padding: 26, textAlign: "center", color: "var(--muted)", fontSize: 12.5 }}>No custom books{owner || dr ? " match the current filters" : ""}. <b>Import</b> an existing design by its Design ID above.</div>)
        : (drafts.length
          ? <div style={{ display: "grid", gap: 10 }}>{pageSlice(drafts).map((t) => row(t, false))}</div>
          : <div className="panel empty" style={{ padding: 26, textAlign: "center", color: "var(--muted)", fontSize: 12.5 }}>No new ideas{owner || dr ? " match the current filters" : ""}. Click <b>+ New Book</b> to start.</div>)}
      {pager}
      {askT && <CustomerNameModal title={askT.name} busy={cloneBusy} onOk={(n) => customize(askT, n)} onClose={() => setAskT(null)} />}
    </div>
  );
}

// ===== IMPORT DESIGN CÓ SẴN (Design Studio) → MASTER trong Custom books =====
// Nhập Design ID (#SKU) → hệ thống lấy các file in (cover_front/back_cover/page_01..24 hoặc book_cover liền)
// làm ẢNH GỐC; sau đó khai báo variables (giá trị GỐC đang in) là customize được cho từng khách.
function ImportDesignBar({ reload, open, flash }: { reload: () => void; open: (id: string) => void; flash: (m: string) => void }) {
  const [sku, setSku] = useState("");
  const [productKey, setProductKey] = useState(BOOK_PRODUCTS[0].key);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const n = parseInt(sku.replace(/[^0-9]/g, ""), 10);
    if (!n) { flash("✗ Enter the Design ID (the #number on the design card)"); return; }
    setBusy(true);
    const j = await api("/api/books/import-from-design", "POST", { sku: n, productKey });
    setBusy(false);
    if (j.ok) {
      const miss = (j.missing as string[] | undefined) ?? [];
      flash(`✓ Imported ${j.mapped} file(s)` + (miss.length ? ` — still missing: ${miss.slice(0, 6).join(", ")}${miss.length > 6 ? "…" : ""}` : ""));
      setSku(""); reload(); open(j.id as string);
    } else flash("✗ " + (j.error ?? "Import error"));
  };
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 14, padding: "12px 14px", marginBottom: 14, background: "#fff", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div style={{ minWidth: 200, flex: 1 }}>
        <div style={{ fontWeight: 800, fontSize: 13.5 }}>Import an existing design</div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 1 }}>From Design Studio, by Design ID — its print files (cover_front · back_cover · page_01–24, or a full book_cover) become the master. Then set the variables&apos; <b>original values</b> in the detail screen.</div>
      </div>
      <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Design ID (e.g. 1234)" onKeyDown={(e) => { if (e.key === "Enter") run(); }}
        style={{ ...inp, width: 150, height: 34, boxSizing: "border-box", fontSize: 13 }} />
      <select value={productKey} onChange={(e) => setProductKey(e.target.value)} style={{ ...inp, height: 34, boxSizing: "border-box", fontSize: 12.5, maxWidth: 250 }}>
        {BOOK_PRODUCTS.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
      </select>
      <button onClick={run} disabled={busy} style={{ ...btnBlue, height: 34, padding: "0 16px", fontSize: 12.5, opacity: busy ? 0.6 : 1 }}>{busy ? "Importing…" : "Import"}</button>
    </div>
  );
}

function NewBookModal({ close, onCreated, flash, models }: { close: () => void; onCreated: (id: string) => void; flash: (m: string) => void; models: { id: string; name: string }[] }) {
  const [productKey, setProductKey] = useState(BOOK_PRODUCTS[0].key);
  const product = getBookProduct(productKey);
  const [brief, setBrief] = useState({ occasion: "", audience: "", pages: getBookProduct(BOOK_PRODUCTS[0].key).pageCount, notes: "", count: 4 });
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
    if (refs.length >= MAX_REFS) { flash(`✗ Max ${MAX_REFS} images`); return; }
    setImporting(true);
    const j = await api("/api/books/import-image", "POST", { url: u });
    setImporting(false);
    if (j.ok && j.dataUrl) { const small = await downscaleImage(String(j.dataUrl)); setRefs((cur) => (cur.length >= MAX_REFS ? cur : [...cur, small])); setImportUrl(""); }
    else {
      const raw = String(j.error ?? "Couldn't fetch image from link");
      const msg = /\b50[24]\b|hết giờ|timeout/i.test(raw) ? "Link blocked / timed out — upload the image manually with +" : raw;
      flash("✗ Import: " + msg);
    }
  };

  const gen = async () => {
    setBusy(true); setIdeas([]);
    lsSet("bs_text_model", model);
    // BƯỚC RIÊNG (best-effort): phân tích ảnh đối thủ → text đưa vào ý tưởng. Lỗi/chậm thì bỏ qua.
    let comp = "";
    if (refs.length) {
      const a = await api("/api/books/analyze-refs", "POST", { images: refs, notes: brief.notes });
      if (a.ok && a.analysis) comp = String(a.analysis);
      else flash("⚠ Couldn't analyze images — generating ideas from the description" + (a.error ? ` (${String(a.error).slice(0, 60)})` : ""));
    }
    const j = await api("/api/books/ideas", "POST", { ...brief, competitor: comp || undefined, model: model || undefined });
    setBusy(false);
    if (j.ok) {
      setIdeas((j.ideas as Idea[]) ?? []);
      if (comp) flash("✓ Analyzed competitor images & matched the niche");
    } else flash("✗ " + (j.error ?? "Ideas error"));
  };
  const create = async (idea: Idea) => {
    setBusy(true);
    const j = await api("/api/books", "POST", {
      name: idea.name, occasion: brief.occasion, audience: brief.audience,
      concept: { hook: idea.hook, angle: idea.angle, usp: idea.usp, outline: idea.outline },
      brief: { ...brief, pages: product.pageCount }, productKey,
    });
    if (!j.ok) { setBusy(false); flash("✗ " + (j.error ?? "Create error")); return; }
    const newId = j.id as string;
    // TỰ KHỚP PHONG CÁCH từ ảnh đối thủ ngay khi tạo → điền + lưu Style Bible (khỏi phải bấm thủ công).
    if (refs.length) {
      try {
        const a = await api("/api/books/analyze-refs", "POST", { mode: "style", images: refs, notes: brief.notes });
        if (a.ok && a.style) {
          const s = a.style as { artStyle?: string; palette?: string; textStyle?: string; character?: string; mood?: string; summary?: string };
          const art = [s.artStyle, s.character ? `Character rendering: ${s.character}` : "", s.mood ? `Mood: ${s.mood}` : ""].filter(Boolean).join(" ");
          const nb: Bible = { ...DEFAULT_BIBLE, artStyle: art || DEFAULT_BIBLE.artStyle, palette: s.palette || DEFAULT_BIBLE.palette, textStyle: s.textStyle || DEFAULT_BIBLE.textStyle };
          await api(`/api/books/${newId}`, "PATCH", { bible: nb });
          flash(`✓ Style matched from your reference images${s.summary ? " · " + s.summary : ""}`);
        }
      } catch { /* lỗi phân tích style → bỏ qua, vẫn tạo sách */ }
    }
    setBusy(false);
    onCreated(newId);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,20,35,.5)", zIndex: 1000, display: "grid", placeItems: "center", padding: 16 }} onClick={close}>
      <div style={{ background: "#fff", borderRadius: 14, width: "min(720px,100%)", maxHeight: "90vh", overflow: "auto", padding: 20 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>New Book — Ideas</h3>
          <button style={{ ...btnGhost, marginLeft: "auto", padding: "5px 11px" }} onClick={close}>✕</button>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600 }}>Product type
            <select value={productKey} onChange={(e) => { const p = getBookProduct(e.target.value); setProductKey(p.key); setBrief((b) => ({ ...b, pages: p.pageCount })); }} style={{ ...inp, marginTop: 4 }}>
              {BOOK_PRODUCTS.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>
            <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400 }}>Fixed size &amp; pages: page {product.pageW}×{product.pageH}px · cover {product.coverW}×{product.coverH}px · {product.pageCount} pages.</span>
          </label>
          <label style={{ fontSize: 12, fontWeight: 600 }}>Book description <span style={{ color: "var(--muted)", fontWeight: 400 }}>(type in any language)</span>
            <textarea rows={3} style={{ ...inp, marginTop: 4, resize: "vertical", lineHeight: 1.5 }}
              placeholder="What book, for whom, what style… e.g. First-birthday keepsake book for a ~1yo, warm storybook style, pastel tones."
              value={brief.notes} onChange={(e) => setBrief({ ...brief, notes: e.target.value })} />
          </label>
          <label style={{ fontSize: 12, fontWeight: 600, width: 150 }}>Pages <span style={{ color: "var(--muted)", fontWeight: 400 }}>(by product)</span>
            <input type="number" readOnly value={product.pageCount} title="Page count is fixed by product type" style={{ ...inp, marginTop: 4, background: "#F4F5F8", color: "var(--muted)" }} />
          </label>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Competitor images <span style={{ color: "var(--muted)", fontWeight: 400 }}>(optional · max {MAX_REFS})</span></div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {refs.map((u, i) => (
                <div key={i} style={{ position: "relative" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt={`ref${i}`} style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} />
                  <button onClick={() => setRefs((cur) => cur.filter((_, idx) => idx !== i))} title="Remove" style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 999, border: "1px solid var(--line)", background: "#fff", cursor: "pointer", fontSize: 11, lineHeight: 1, padding: 0 }}>✕</button>
                </div>
              ))}
              {refs.length < MAX_REFS && (
                <label style={{ width: 56, height: 56, display: "grid", placeItems: "center", borderRadius: 8, border: "1px dashed var(--line)", color: "var(--blue)", fontSize: 22, cursor: "pointer" }} title="Upload from device">
                  +
                  <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { if (e.target.files?.length) addRefs(e.target.files); e.target.value = ""; }} />
                </label>
              )}
            </div>
            {refs.length < MAX_REFS && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input value={importUrl} onChange={(e) => setImportUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); importFromLink(); } }}
                  placeholder="Paste Etsy / Amazon / web listing link… (auto-grabs image, skips video)" style={{ ...inp, flex: 1, fontSize: 12.5, padding: "8px 11px" }} />
                <button onClick={importFromLink} disabled={importing || !importUrl.trim()} style={{ ...btnGhost, whiteSpace: "nowrap", opacity: (importing || !importUrl.trim()) ? 0.6 : 1 }}>{importing ? "Loading…" : "Import link"}</button>
              </div>
            )}
            {refs.length > 0 && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>Images are analyzed in a separate step (vision model) then fed into ideas. If analysis fails/slows, ideas are still generated from the description.</div>}
          </div>
          <div style={{ fontSize: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <div style={{ color: "var(--muted)", fontWeight: 700, marginBottom: 8 }}>Options</div>
            <div style={{ display: "grid", gap: 10 }}>
              <label style={{ fontSize: 12, fontWeight: 600, width: 150 }}>Idea count
                <input type="number" style={{ ...inp, marginTop: 4 }} value={brief.count} onChange={(e) => setBrief({ ...brief, count: Number(e.target.value) || 4 })} />
              </label>
              <ModelPicker models={models} value={model} onChange={setModel} label="AI for ideas / script" />
            </div>
          </div>
        </div>
        <button style={{ ...btnBlue, marginTop: 14, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={gen}>{busy ? "Thinking…" : <><IcSpark />Generate ideas</>}</button>

        {ideas.length > 0 && (
          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            {ideas.map((idea, i) => (
              <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 13 }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{idea.name}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>{idea.hook}</div>
                <div style={{ fontSize: 12, marginTop: 6 }}><b>Angle:</b> {idea.angle}</div>
                <div style={{ fontSize: 12, marginTop: 2 }}><b>USP:</b> {idea.usp}</div>
                {idea.outline?.length > 0 && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>Summary: {idea.outline.slice(0, 3).join(" · ")}{idea.outline.length > 3 ? "…" : ""}</div>}
                <button style={{ ...btnBlue, marginTop: 10, padding: "7px 14px", fontSize: 12.5, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => create(idea)}>Select &amp; create →</button>
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
        <span style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 500 }}>— keeps character &amp; style consistent across all pages</span>
        <span style={{ marginLeft: "auto", fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 14px 14px", display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button style={{ ...btnGhost, padding: "6px 12px", fontSize: 12 }} onClick={() => setBible({ ...DEFAULT_BIBLE, ...bible, wardrobe: bible.wardrobe ?? "" })}>Load default</button>
            <button style={{ ...btnBlue, padding: "6px 12px", fontSize: 12, marginLeft: "auto" }} onClick={onSave}>Save Bible</button>
          </div>
          {F("character", "Character (face lock)", 5, "face/hair/eyes features… + {age}")}
          {F("wardrobe", "Fixed outfit / props", 2, "e.g. teal star pajamas (leave empty if none)")}
          {F("artStyle", "Art style", 3)}
          {F("palette", "Color palette", 1)}
          <button onClick={() => setAdv((v) => !v)} style={{ ...btnGhost, border: 0, background: "transparent", padding: 0, fontSize: 12, color: "var(--blue)", textAlign: "left", cursor: "pointer" }}>{adv ? "▲ Hide advanced" : "▼ Advanced (text rules · restrictions · format)"}</button>
          {adv && <>{F("textStyle", "Text rules", 3)}{F("restrictions", "Restrictions", 5)}{F("format", "Page size / quality", 2)}</>}
        </div>
      )}
    </div>
  );
}

// ===== Panel: BIẾN CÁ NHÂN HOÁ (Chữ / Ảnh) — thiết kế gọn, hiện đại =====
function VarsPanel({ vars, setVars, bookId, flash }: { vars: Var[]; setVars: (v: Var[]) => void; bookId: string; flash: (m: string) => void }) {
  const [upIdx, setUpIdx] = useState<number | null>(null);
  const setV = (i: number, k: keyof Var, val: string) => setVars(vars.map((v, idx) => idx === i ? { ...v, [k]: val } : v));
  const patch = (i: number, p: Partial<Var>) => setVars(vars.map((v, idx) => idx === i ? { ...v, ...p } : v));
  const uploadImg = async (i: number, file: File) => {
    setUpIdx(i);
    const t = await api(`/api/books/${bookId}/reference-url`, "POST", { contentType: file.type || "image/png" });
    if (!t.ok) { flash("✗ " + (t.error ?? "Error")); setUpIdx(null); return; }
    try {
      const put = await fetch(t.url as string, { method: (t.method as string) || "PUT", headers: { "Content-Type": file.type || "image/png" }, body: file });
      if (!put.ok) throw new Error("upload HTTP " + put.status);
      patch(i, { imageKey: String(t.key), imageUrl: String(t.publicUrl || "") });
      flash("✓ Image uploaded");
    } catch (e) { flash("✗ upload: " + String((e as Error)?.message ?? e).slice(0, 80)); }
    setUpIdx(null);
  };
  // Đếm key để cảnh báo trùng.
  const dupKeys = new Set<string>();
  const seen = new Set<string>();
  for (const v of vars) { const k = (v.key || "").trim(); if (!k) continue; if (seen.has(k)) dupKeys.add(k); else seen.add(k); }
  const seg = (active: boolean): React.CSSProperties => ({ padding: "4px 12px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: "pointer", border: 0, background: active ? "#fff" : "transparent", color: active ? "var(--blue)" : "var(--muted)", boxShadow: active ? "0 1px 2px rgba(0,0,0,.10)" : "none" });
  const bareInp: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 9, padding: "7px 10px", font: "inherit", fontSize: 13, width: "100%", boxSizing: "border-box", background: "#fff" };

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 14, marginBottom: 12, background: "#fff", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", borderBottom: "1px solid #EEF0F5", background: "#FAFBFF", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 800, fontSize: 14 }}>Personalization variables</span>
        <span style={{ fontSize: 11.5, color: "var(--muted)", flex: 1, minWidth: 120 }}>Text or image — auto-saved as you edit</span>
        <button style={{ ...btnGhost, padding: "6px 11px", fontSize: 12 }} onClick={() => setVars([...vars, { key: "", label: "", value: "", type: "text" }])}>+ Text</button>
        <button style={{ ...btnGhost, padding: "6px 11px", fontSize: 12 }} onClick={() => setVars([...vars, { key: "", label: "", type: "image" }])}>+ Image</button>
      </div>

      {vars.length === 0 && <div style={{ padding: 18, textAlign: "center", color: "var(--muted)", fontSize: 12.5 }}>No variables yet. Click <b>+ Text</b> / <b>+ Image</b> to add.</div>}

      {vars.map((v, i) => {
        const isImg = v.type === "image";
        const isDup = !!v.key && dupKeys.has(v.key.trim());
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: i ? "1px solid #F0F2F7" : "none" }}>
            <div style={{ display: "inline-flex", background: "#EEF1F7", borderRadius: 999, padding: 3, gap: 2, flexShrink: 0 }}>
              <button style={seg(!isImg)} onClick={() => patch(i, { type: "text" })}>Text</button>
              <button style={seg(isImg)} onClick={() => patch(i, { type: "image" })}>Image</button>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <input value={v.label ?? ""} onChange={(e) => setV(i, "label", e.target.value)} placeholder="Label (e.g. Dad's name)" style={{ ...bareInp, fontWeight: 600 }} />
              <div style={{ display: "flex", alignItems: "center", gap: 2, marginTop: 4, paddingLeft: 2 }}>
                <span style={{ fontSize: 11, color: isDup ? "var(--red)" : "var(--faint)", fontFamily: "ui-monospace, monospace" }}>{"{"}</span>
                <input value={v.key} onChange={(e) => setV(i, "key", e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))} placeholder="key" style={{ border: 0, background: "transparent", outline: "none", fontSize: 11.5, fontFamily: "ui-monospace, monospace", color: isDup ? "var(--red)" : "var(--muted)", padding: 0, width: 130 }} />
                <span style={{ fontSize: 11, color: isDup ? "var(--red)" : "var(--faint)", fontFamily: "ui-monospace, monospace" }}>{"}"}</span>
                {isDup && <span style={{ fontSize: 10.5, color: "var(--red)", marginLeft: 6, fontWeight: 600 }}>⚠ duplicate key — rename it</span>}
              </div>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              {isImg ? (
                <label style={{ display: "inline-flex", alignItems: "center", gap: 9, cursor: upIdx === i ? "wait" : "pointer" }}>
                  {v.imageUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={v.imageUrl} alt="ref" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 9, border: "1px solid var(--line)" }} />
                    : <span style={{ width: 40, height: 40, display: "grid", placeItems: "center", borderRadius: 9, border: "1.5px dashed var(--line)", color: "var(--muted)", fontSize: 16 }}>+</span>}
                  <span style={{ fontSize: 12.5, color: "var(--blue)", fontWeight: 700 }}>{upIdx === i ? "Uploading…" : v.imageUrl ? "Change image" : "Upload image"}</span>
                  <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImg(i, f); e.target.value = ""; }} />
                </label>
              ) : (
                <input value={v.value ?? ""} onChange={(e) => setV(i, "value", e.target.value)} placeholder="Value (e.g. Lisa)" style={bareInp} />
              )}
            </div>

            <button title="Delete variable" onClick={() => setVars(vars.filter((_, idx) => idx !== i))} style={{ border: 0, background: "transparent", color: "var(--faint)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 4, flexShrink: 0 }}>×</button>
          </div>
        );
      })}
    </div>
  );
}

// Modal hỏi TÊN KHÁCH khi tạo bản customize — thay window.prompt (hộp thoại trình duyệt xấu, dễ tưởng lỗi).
function CustomerNameModal({ title, busy, onOk, onClose }: { title: string; busy: boolean; onOk: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 300, display: "grid", placeItems: "center" }} onClick={busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 20, width: 400, maxWidth: "92vw", boxShadow: "0 24px 60px rgba(15,23,42,.25)" }}>
        <div style={{ fontWeight: 800, fontSize: 15.5 }}>Customize for customer</div>
        <div style={{ fontSize: 12, color: "var(--muted)", margin: "3px 0 13px" }}>{title}</div>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name (e.g. Oliva)"
          onKeyDown={(e) => { if (e.key === "Enter" && !busy) onOk(name.trim()); }} style={inp} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 15 }}>
          <button style={{ ...btnGhost, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={onClose}>Cancel</button>
          <button style={{ ...btnBlue, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => onOk(name.trim())}>{busy ? "Creating…" : "Create copy"}</button>
        </div>
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

// ===== MÀN CUSTOM CHO KHÁCH: variables khách gửi → 2 CỘT (trái: design gốc · phải: gen mới chỉ thay biến) =====
function CustomizeView({ cloneId, masterId, flash, openFull }: { cloneId: string; masterId: string; flash: (m: string) => void; openFull?: () => void }) {
  const [master, setMaster] = useState<Detail | null>(null);
  const [clone, setClone] = useState<Detail | null>(null);
  const [vars, setVars] = useState<Var[]>([]);
  const [illus, setIllus] = useState<Record<number, string>>({});
  const [imgModel, setImgModel] = useState("");
  const [imgModels, setImgModels] = useState<{ id: string; name: string }[]>([]);
  const [busyPage, setBusyPage] = useState<number | null>(null);
  const [drawBusy, setDrawBusy] = useState(false);
  const [dlBusy, setDlBusy] = useState(false);
  const stopRef = useRef(false);
  const lastVars = useRef("__init__");

  useEffect(() => {
    api(`/api/books/${masterId}`).then((j) => { if (j.ok) setMaster(j as unknown as Detail); });
    api(`/api/books/${cloneId}`).then((j) => {
      if (!j.ok) return;
      const d = j as unknown as Detail;
      setClone(d);
      const sv = (d.title.vars ?? []).map((v) => ({ ...v, value: v.value ?? "" }));
      setVars(sv); lastVars.current = JSON.stringify(sv);
      const m: Record<number, string> = {};
      for (const [k, v] of Object.entries(d.assets ?? {})) if (v) m[Number(k)] = v as string;
      setIllus(m);
    });
    api("/api/books/models?type=image").then((j) => { if (j.ok) setImgModels((j.models as { id: string; name: string }[]) ?? []); });
    setImgModel(lsGet("bs_image_model"));
  }, [cloneId, masterId]);

  // Tự lưu variables (debounce) — chỉnh xong là lưu, khỏi bấm gì.
  useEffect(() => {
    const snap = JSON.stringify(vars);
    if (lastVars.current === "__init__") { lastVars.current = snap; return; }
    if (lastVars.current === snap) return;
    const t = setTimeout(async () => {
      lastVars.current = snap;
      const firstImg = vars.find((v) => v.type === "image" && v.imageKey);
      const body: Record<string, unknown> = { vars };
      if (firstImg?.imageKey) body.characterRefKey = firstImg.imageKey;
      const j = await api(`/api/books/${cloneId}`, "PATCH", body);
      flash(j.ok ? "✓ Variables saved" : "✗ " + (j.error ?? "Error"));
    }, 700);
    return () => clearTimeout(t);
  }, [vars, cloneId, flash]);

  const product = getBookProduct(clone?.title.productKey);
  const blocks = genBlocks(product);
  const masterIllus: Record<number, string> = {};
  if (master) for (const [k, v] of Object.entries(master.assets ?? {})) if (v) masterIllus[Number(k)] = v as string;

  const draw = async (pageNo: number): Promise<boolean> => {
    setBusyPage(pageNo); lsSet("bs_image_model", imgModel);
    const payload = { pageNo, model: imgModel || undefined, baked: true, vars };
    let j = await api(`/api/books/${cloneId}/illustrate`, "POST", payload);
    if (!j.ok && /\b50[24]\b|timeout|timed out/i.test(String(j.error ?? ""))) j = await api(`/api/books/${cloneId}/illustrate`, "POST", payload);
    setBusyPage(null);
    if (j.ok) {
      const map = (j.urls as Record<string, string> | undefined) ?? { [pageNo]: j.url as string };
      setIllus((m) => ({ ...m, ...Object.fromEntries(Object.entries(map).map(([k, v]) => [Number(k), v as string])) }));
      return true;
    }
    flash(`✗ ${pageNo === 0 ? "cover" : "page " + pageNo}: ` + (j.error ?? "Draw error"));
    return false;
  };

  const blockKey = (blk: GenBlockUi): number => blk.type === "cover" ? 0 : blk.type === "single" ? blk.page : blk.pages[0];
  const blockDone = (blk: GenBlockUi): boolean => blk.type === "cover" ? !!(illus[0] && illus[-1]) : blk.type === "single" ? !!illus[blk.page] : !!(illus[blk.pages[0]] && illus[blk.pages[1]]);

  const drawAll = async () => {
    if (drawBusy) { stopRef.current = true; flash("Stopping after this block…"); return; }
    const todo = blocks.filter((b) => !blockDone(b)).map(blockKey);
    if (!todo.length) { flash("✓ Everything is already drawn"); return; }
    setDrawBusy(true); stopRef.current = false;
    let done = 0, fail = 0;
    for (let i = 0; i < todo.length; i++) {
      if (stopRef.current) break;
      flash(`Drawing block ${i + 1}/${todo.length}…`);
      (await draw(todo[i])) ? done++ : fail++;
      await new Promise((r) => setTimeout(r, 1500));
    }
    setDrawBusy(false);
    if (stopRef.current) flash(`⚠ Stopped — drew ${done} block(s).`);
    else if (fail) flash(`⚠ Drew ${done}/${todo.length} — ${fail} failed. Click Generate all again to retry.`);
    else flash(`✓ All drawn (${done} block${done > 1 ? "s" : ""})`);
  };

  const downloadAll = async () => {
    if (dlBusy) return;
    const order: number[] = [];
    if (illus[0]) order.push(0);
    if (illus[-1]) order.push(-1);
    Object.keys(illus).map(Number).filter((n) => n >= 1 && illus[n]).sort((a, z) => a - z).forEach((n) => order.push(n));
    if (!order.length) { flash("✗ Nothing drawn yet"); return; }
    setDlBusy(true);
    for (let i = 0; i < order.length; i++) {
      flash(`Downloading ${i + 1}/${order.length}…`);
      const el = document.createElement("a");
      el.href = `/api/books/${cloneId}/asset?page=${order[i]}`;
      document.body.appendChild(el); el.click(); el.remove();
      await new Promise((r) => setTimeout(r, 700));
    }
    setDlBusy(false);
    flash(`✓ Downloaded ${order.length} files`);
  };

  if (!clone) return <div className="panel empty" style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>Loading…</div>;

  const cell = (url?: string, h = 96) => url
    ? <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid var(--line)", lineHeight: 0 }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={url} alt="" style={{ width: "100%", display: "block" }} /></div>
    : <div style={{ height: h, borderRadius: 8, border: "1px dashed var(--line)", display: "grid", placeItems: "center", color: "var(--faint)", fontSize: 10.5 }}>—</div>;

  return (
    <div>
      <StepCard n={1} title={`Customize: ${clone.title.name}`} desc={`Product: ${product.name} · base design on the left stays untouched — generate a personalized copy on the right.`}
        right={openFull ? <button style={{ ...btnGhost, padding: "6px 12px", fontSize: 12 }} title="Open the full script/prompt editor for this copy" onClick={openFull}>Full editor</button> : undefined}>
        <VarsPanel vars={vars} setVars={setVars} bookId={cloneId} flash={flash} />
      </StepCard>

      <StepCard n={2} title="Original design → Personalized copy" desc="Left: master design (reference). Right: generated with the customer's variables — same script, prompts and style.">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", marginBottom: 12, background: "#FAFBFF" }}>
          <label style={{ display: "grid", gap: 3 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".4px" }}>Image model · drawing</span>
            <select value={imgModel} onChange={(e) => setImgModel(e.target.value)} style={{ ...inp, fontSize: 12, padding: "6px 9px", minWidth: 180, height: 32, boxSizing: "border-box" }}>
              <option value="">— Default —</option>
              <ModelOptions models={imgModels} />
            </select>
          </label>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button style={{ ...btnBlue, padding: "0 14px", height: 32, fontSize: 12.5, background: drawBusy ? "#b45309" : "var(--blue)", opacity: busyPage !== null && !drawBusy ? 0.6 : 1 }} disabled={busyPage !== null && !drawBusy} onClick={drawAll}>
              {drawBusy ? <><IcStop />Stop</> : <><IcBrush />Generate all (missing)</>}
            </button>
            <button style={{ ...btnGhost, padding: "0 14px", height: 32, fontSize: 12.5, opacity: dlBusy ? 0.6 : 1 }} disabled={dlBusy} onClick={downloadAll}><IcDownload />{dlBusy ? "Downloading…" : "Download all"}</button>
          </div>
        </div>

        {/* Header 2 cột */}
        <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 1fr 110px", gap: 10, padding: "0 4px 6px", fontSize: 10.5, fontWeight: 800, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".4px" }}>
          <div>Block</div><div>Original design</div><div>Personalized (new)</div><div />
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {blocks.map((blk) => {
            const key = blockKey(blk);
            const label = blk.type === "cover" ? "Cover" : blk.type === "single" ? `Page ${blk.page}` : `Pages ${blk.pages[0]}–${blk.pages[1]}`;
            const nos = blk.type === "cover" ? [-1, 0] : blk.type === "single" ? [blk.page] : [blk.pages[0], blk.pages[1]];
            const busy = busyPage !== null && nos.concat(key).includes(busyPage);
            return (
              <div key={label} style={{ display: "grid", gridTemplateColumns: "90px 1fr 1fr 110px", gap: 10, alignItems: "start", border: "1px solid var(--line)", borderRadius: 12, padding: 10, background: "#fff" }}>
                <div style={{ fontWeight: 800, fontSize: 12.5, color: "var(--muted)" }}>{label}</div>
                <div style={{ display: "grid", gridTemplateColumns: nos.length > 1 ? "1fr 1fr" : "1fr", gap: 6 }}>{nos.map((n) => <div key={n}>{cell(masterIllus[n])}</div>)}</div>
                <div style={{ display: "grid", gridTemplateColumns: nos.length > 1 ? "1fr 1fr" : "1fr", gap: 6 }}>{nos.map((n) => <div key={n}>{cell(illus[n])}</div>)}</div>
                <button style={{ ...btnGhost, fontSize: 11.5, padding: "6px 8px", opacity: busy ? 0.6 : 1 }} disabled={busy || drawBusy} onClick={() => draw(key)}>
                  {busy ? "Drawing…" : blockDone(blk) ? <><IcRefresh />Redo</> : <><IcBrush />Generate</>}
                </button>
              </div>
            );
          })}
        </div>
      </StepCard>
    </div>
  );
}
type GenBlockUi = ReturnType<typeof genBlocks>[number];

// ===== MÀN MASTER (Custom books) — gọn: biến GỐC + bộ ảnh design; KHÔNG lẫn UI script của New ideas =====
function MasterView({ id, flash, openFull, onCustomize }: { id: string; flash: (m: string) => void; openFull: () => void; onCustomize: (cloneId: string, masterId: string) => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [vars, setVars] = useState<Var[]>([]);
  const [busy, setBusy] = useState(false);
  const lastVars = useRef("__init__");

  useEffect(() => {
    api(`/api/books/${id}`).then((j) => {
      if (!j.ok) { flash("✗ " + (j.error ?? "Error")); return; }
      const dd = j as unknown as Detail;
      setD(dd);
      const sv = (dd.title.vars ?? []).map((v) => ({ ...v, value: v.value ?? "" }));
      setVars(sv); lastVars.current = JSON.stringify(sv);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Tự lưu biến (debounce) — value ở đây là GIÁ TRỊ GỐC đang in trong design.
  useEffect(() => {
    const snap = JSON.stringify(vars);
    if (lastVars.current === "__init__") { lastVars.current = snap; return; }
    if (lastVars.current === snap) return;
    const t = setTimeout(async () => {
      lastVars.current = snap;
      const j = await api(`/api/books/${id}`, "PATCH", { vars });
      flash(j.ok ? "✓ Variables saved" : "✗ " + (j.error ?? "Error"));
    }, 700);
    return () => clearTimeout(t);
  }, [vars, id, flash]);

  const [ask, setAsk] = useState(false);
  const customize = async (customer: string) => {
    if (busy) return;
    setBusy(true);
    const j = await api(`/api/books/${id}/clone`, "POST", { customer });
    setBusy(false);
    if (j.ok) { setAsk(false); flash("✓ Customer copy created — fill in the customer's variables, then Generate"); onCustomize(j.id as string, id); }
    else flash("✗ " + (j.error ?? "Clone error"));
  };

  if (!d) return <div className="panel empty" style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>Loading…</div>;
  const product = getBookProduct(d.title.productKey);
  const illus: Record<number, string> = {};
  for (const [k, v] of Object.entries(d.assets ?? {})) if (v) illus[Number(k)] = v as string;
  const slots: { no: number; label: string }[] = [
    { no: 0, label: "Cover front" }, { no: -1, label: "Cover back" },
    ...Array.from({ length: product.pageCount }, (_, i) => ({ no: i + 1, label: `Page ${i + 1}` })),
  ];
  const missing = slots.filter((s2) => !illus[s2.no]).length;

  return (
    <div>
      <StepCard n={1} title={`Master design: ${d.title.name}`} desc={`Product: ${product.name} · this is the ORIGINAL — it never changes; each customer gets a personalized copy.`}
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ ...btnGhost, padding: "7px 13px", fontSize: 12.5 }} title="Open the full script/prompt editor (for masters built in Book Studio)" onClick={openFull}>Full editor</button>
            <button style={{ ...btnBlue, padding: "7px 14px", fontSize: 12.5, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => setAsk(true)}>{busy ? "Cloning…" : "Customize for customer"}</button>
          </div>
        }>
        <div style={{ border: "1px solid #F5E1B0", background: "#FFF9EC", color: "#8a6d00", borderRadius: 12, padding: "9px 13px", fontSize: 12, marginBottom: 10 }}>
          Set each variable&apos;s <b>Value</b> to the ORIGINAL value printed in this design (e.g. name = &quot;Layla&quot;). When customizing, it gets replaced by the customer&apos;s value.
        </div>
        <VarsPanel vars={vars} setVars={setVars} bookId={id} flash={flash} />
      </StepCard>

      <StepCard n={2} title="Original design files" desc={missing ? `${slots.length - missing}/${slots.length} slots have an image — missing slots can't be customized yet (upload them to the source design and re-import, or draw them in the Full editor).` : `All ${slots.length} slots ready.`}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
          {slots.map((s2) => (
            <div key={s2.no} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 6, background: "#fff" }}>
              {illus[s2.no]
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={illus[s2.no]} alt={s2.label} style={{ width: "100%", display: "block", borderRadius: 7, border: "1px solid var(--line)" }} />
                : <div style={{ height: 90, borderRadius: 7, border: "1px dashed var(--line)", display: "grid", placeItems: "center", color: "var(--faint)", fontSize: 10.5 }}>missing</div>}
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", marginTop: 5, textAlign: "center" }}>{s2.label}</div>
            </div>
          ))}
        </div>
      </StepCard>
      {ask && <CustomerNameModal title={d.title.name} busy={busy} onOk={(n) => customize(n)} onClose={() => setAsk(false)} />}
    </div>
  );
}

function DetailView({ detail, reload, flash, models }: { detail: Detail; reload: () => void; flash: (m: string) => void; models: { id: string; name: string }[] }) {
  const id = detail.title.id;
  const concept = (detail.title.concept ?? {}) as { hook?: string; angle?: string; usp?: string; outline?: string[] };
  const [pages, setPages] = useState<Page[]>(detail.pages.map((p) => ({ page_no: p.pageNo, text: p.textTemplate ?? "", illustration: p.illustrationBrief ?? "", prompt: p.promptTemplate ?? "" })));
  const [busy, setBusy] = useState(false);
  const [busySetup, setBusySetup] = useState(false);
  const [styleBusy, setStyleBusy] = useState(false);
  const [model, setModel] = useState("");
  // Layout chữ trên SPREAD: "split" = chữ 1 bên · tranh 1 bên (kiểu đối thủ) | "both" = trang nào cũng có chữ.
  const [textLayout, setTextLayout] = useState<"split" | "both">("split");
  useEffect(() => { const v = lsGet("bs_text_layout"); if (v === "both" || v === "split") setTextLayout(v); }, []);
  // ---- Bible + Vars ----
  const [bible, setBible] = useState<Bible>(detail.title.bible ?? {});
  const [cover, setCover] = useState<Cover>(detail.title.cover ?? {});
  const [vars, setVars] = useState<Var[]>(seedImageVar(detail.title.vars && detail.title.vars.length ? detail.title.vars : DEFAULT_VARS, detail.title.characterRefKey, detail.title.characterRefUrl));
  const baked = true; // mặc định AI vẽ chữ vào ảnh (bỏ toggle)
  // ---- Gen Image state ----
  const [imgModels, setImgModels] = useState<{ id: string; name: string }[]>([]);
  const [imgModel, setImgModel] = useState("");
  const [illus, setIllus] = useState<Record<number, string>>({});
  const [busyPage, setBusyPage] = useState<number | null>(null);

  const previewName = (vars.find((v) => v.key === "name")?.value || "Emma");
  // Bố cục sản phẩm (khoá khổ + cách ghép spread) — dùng để gom thẻ trang.
  const product = getBookProduct(detail.title.productKey);

  useEffect(() => { setModel(lsGet("bs_text_model")); setImgModel(lsGet("bs_image_model")); }, []);
  useEffect(() => { api("/api/books/models?type=image").then((j) => { if (j.ok) setImgModels((j.models as { id: string; name: string }[]) ?? []); }); }, []);
  // Đồng bộ khi detail reload
  const lastSavedVars = useRef<string>("__init__");
  useEffect(() => {
    setBible(detail.title.bible ?? {});
    setCover(detail.title.cover ?? {});
    const sv = seedImageVar(detail.title.vars && detail.title.vars.length ? detail.title.vars : DEFAULT_VARS, detail.title.characterRefKey, detail.title.characterRefUrl);
    setVars(sv);
    lastSavedVars.current = JSON.stringify(sv); // đánh dấu đã khớp server → không tự lưu ngay sau khi load
    const m: Record<number, string> = {};
    for (const [k, v] of Object.entries(detail.assets ?? {})) if (v) m[Number(k)] = v as string;
    setIllus(m);
  }, [detail]);

  // TỰ LƯU biến cá nhân hoá mỗi khi thay đổi (debounce) — khỏi bấm Save.
  useEffect(() => {
    const snap = JSON.stringify(vars);
    if (lastSavedVars.current === "__init__") { lastSavedVars.current = snap; return; }
    if (lastSavedVars.current === snap) return;
    const t = setTimeout(async () => {
      lastSavedVars.current = snap;
      const firstImg = vars.find((v) => v.type === "image" && v.imageKey);
      const body: Record<string, unknown> = { vars };
      if (firstImg?.imageKey) body.characterRefKey = firstImg.imageKey;
      const j = await api(`/api/books/${id}`, "PATCH", body);
      flash(j.ok ? "✓ Variables saved" : "✗ " + (j.error ?? "Error"));
    }, 700);
    return () => clearTimeout(t);
  }, [vars, id, flash]);

  // Sinh kịch bản THEO LÔ (6 trang/lần) → sách 24 trang không bao giờ timeout.
  const genScript = async () => {
    setBusy(true); lsSet("bs_text_model", model);
    // Chỉ đưa biến CHỮ cho AI viết văn — biến ẢNH ({photo}…) là reference vẽ, không được chèn vào text.
    const keys = vars.filter((v) => v.type !== "image").map((v) => v.key).filter(Boolean);
    const CHUNK = 6;
    let from = 1, total = 999;
    const acc: Page[] = [];
    try {
      while (from <= total) {
        const to = from + CHUNK - 1;
        const j = await api(`/api/books/${id}/script`, "POST", { model: model || undefined, vars: keys, from, to, replace: from === 1, textLayout });
        if (!j.ok) { flash("✗ " + (j.error ?? "Script error")); break; }
        total = Number(j.total) || total;
        const chunk = ((j.pages as Page[]) ?? []).map((p) => ({ ...p, prompt: "" }));
        if (!chunk.length) break;
        acc.push(...chunk);
        setPages([...acc]);
        flash(`Writing pages ${Math.min(acc.length, total)}/${total}…`);
        from = to + 1;
      }
      if (acc.length) {
        flash(`✓ Script generated · ${acc.length} pages`);
        // AUTO sinh TIÊU ĐỀ + BRIEF cho BÌA (nếu chưa nhập) → cover không còn trống.
        let coverNow = cover;
        try {
          const jcov = await api(`/api/books/${id}/cover-content`, "POST", { model: model || undefined });
          if (jcov.ok) { coverNow = { ...cover, text: String(jcov.text ?? cover.text ?? ""), brief: String(jcov.brief ?? cover.brief ?? "") }; setCover(coverNow); }
        } catch { /* bỏ qua nếu lỗi */ }
        // AUTO ráp prompt chi tiết (cả cover + mọi trang) ngay sau khi có script → khỏi quên bước "Compose all".
        flash("Composing detailed prompts…");
        await api(`/api/books/${id}`, "PATCH", { bible, cover: coverNow });
        const jc = await api(`/api/books/${id}/compose`, "POST", { baked });
        if (jc.ok) {
          const list = jc.prompts as { pageNo: number; prompt: string }[];
          const map = new Map(list.map((x) => [x.pageNo, x.prompt]));
          setPages((ps) => ps.map((p) => ({ ...p, prompt: map.get(p.page_no) ?? p.prompt })));
          const cp = list.find((x) => x.pageNo === 0);
          if (cp) setCover((c) => ({ ...c, prompt: cp.prompt }));
          flash(`✓ Ready · ${acc.length} pages + cover prompts composed`);
        }
      }
    } finally {
      setBusy(false);
      reload();
    }
  };
  const save = async () => {
    setBusy(true);
    const j = await api(`/api/books/${id}`, "PATCH", { pages });
    setBusy(false);
    flash(j.ok ? "✓ Saved" : "✗ " + (j.error ?? "Save error"));
  };
  // Tự lưu khi rời ô (onBlur) — UPDATE đúng 1 trang (không xoá cả bảng → không kẹt "page not found" khi vừa sửa vừa vẽ).
  const lastSavedPage = useRef<Record<number, string>>({});
  const savePage = async (pageNo: number) => {
    const p = pages.find((x) => x.page_no === pageNo);
    if (!p) return;
    const snap = JSON.stringify({ t: p.text, i: p.illustration, pr: p.prompt });
    if (lastSavedPage.current[pageNo] === snap) return;
    lastSavedPage.current[pageNo] = snap;
    const j = await api(`/api/books/${id}`, "PATCH", { page: { page_no: pageNo, text: p.text, illustration: p.illustration, prompt: p.prompt ?? "" } });
    flash(j.ok ? "✓ Saved" : "✗ " + (j.error ?? "Save error"));
  };
  const setPage = (i: number, k: "text" | "illustration" | "prompt", v: string) => setPages((ps) => ps.map((p, idx) => idx === i ? { ...p, [k]: v } : p));

  const saveBible = async () => { const j = await api(`/api/books/${id}`, "PATCH", { bible }); flash(j.ok ? "✓ Bible saved" : "✗ " + (j.error ?? "Error")); };
  // 🎨 Học PHONG CÁCH VẼ từ ảnh mẫu → điền + LƯU thẳng vào Style Bible (Art style · Palette · Text rules).
  const analyzeStyle = async (files: FileList) => {
    const arr = Array.from(files).slice(0, 3);
    setStyleBusy(true);
    try {
      const imgs: string[] = [];
      for (const f of arr) {
        const dataUrl: string = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });
        imgs.push(await downscaleImage(dataUrl, 512));
      }
      const j = await api("/api/books/analyze-refs", "POST", { mode: "style", images: imgs });
      if (j.ok && j.style) {
        const s = j.style as { artStyle?: string; palette?: string; textStyle?: string; character?: string; mood?: string; summary?: string };
        const art = [s.artStyle, s.character ? `Character rendering: ${s.character}` : "", s.mood ? `Mood: ${s.mood}` : ""].filter(Boolean).join(" ");
        const nb: Bible = { ...bible, artStyle: art || bible.artStyle, palette: s.palette || bible.palette, textStyle: s.textStyle || bible.textStyle };
        setBible(nb);
        await api(`/api/books/${id}`, "PATCH", { bible: nb });
        flash(`✓ Style captured & saved${s.summary ? " · " + s.summary : ""}`);
      } else flash("✗ " + (j.error ?? "Style analysis failed"));
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e).slice(0, 80)); }
    setStyleBusy(false);
  };

  // ✨ AI tự dựng Style Bible + bộ biến THEO CHỦ ĐỀ (giải bài toán "1 form cho vô số chủ đề").
  const setupAI = async () => {
    setBusySetup(true); lsSet("bs_text_model", model);
    const j = await api(`/api/books/${id}/setup`, "POST", { model: model || undefined });
    setBusySetup(false);
    if (j.ok) {
      setBible((j.bible as Bible) ?? {});
      const vs = ((j.vars as Var[]) ?? []).map((v) => ({ ...v, value: v.value ?? "", type: v.type === "image" ? "image" as const : "text" as const }));
      // Luôn có ít nhất 1 biến ẢNH nhân vật (kể cả khi AI quên).
      const withImg = vs.some((v) => v.type === "image") ? vs : [{ key: "photo", label: "Character photo", value: "", type: "image" as const }, ...vs];
      setVars(withImg);
      flash("✓ AI built Bible + variables — review & tweak if needed");
    } else flash("✗ " + (j.error ?? "Setup error"));
  };

  // Ráp prompt chi tiết cho 1 trang. Lưu Bible trước để dùng bản mới nhất.
  const composeOne = async (i: number, pageNo: number) => {
    await api(`/api/books/${id}`, "PATCH", { bible });
    const j = await api(`/api/books/${id}/compose`, "POST", { pageNo, baked });
    if (j.ok) { const pr = (j.prompts as { prompt: string }[])[0]?.prompt ?? ""; setPage(i, "prompt", pr); flash(`✓ Prompt composed · page ${pageNo}`); }
    else flash("✗ " + (j.error ?? "Error"));
  };

  // ---- COVER: lưu / ráp prompt / vẽ (lưu trước để bản mới nhất được dùng) ----
  const lastSavedCover = useRef("");
  const autoSaveCover = async () => {
    const snap = JSON.stringify(cover);
    if (snap === lastSavedCover.current) return;
    lastSavedCover.current = snap;
    const j = await api(`/api/books/${id}`, "PATCH", { cover });
    flash(j.ok ? "✓ Saved" : "✗ " + (j.error ?? "Error"));
  };
  const composeCover = async () => {
    await api(`/api/books/${id}`, "PATCH", { cover });
    const j = await api(`/api/books/${id}/compose`, "POST", { pageNo: 0, baked });
    if (j.ok) { const pr = (j.prompts as { pageNo: number; prompt: string }[]).find((x) => x.pageNo === 0)?.prompt ?? ""; setCover((c) => ({ ...c, prompt: pr })); flash("✓ Cover prompt composed"); }
    else flash("✗ " + (j.error ?? "Error"));
  };
  const drawCover = async () => { await api(`/api/books/${id}`, "PATCH", { cover }); await illustrate(0); };

  const illustrate = async (pageNo: number) => {
    setBusyPage(pageNo); lsSet("bs_image_model", imgModel);
    const payload = { pageNo, model: imgModel || undefined, baked, vars };
    let j = await api(`/api/books/${id}/illustrate`, "POST", payload);
    // Timeout tạm thời (502/504) → tự thử lại 1 lần
    if (!j.ok && /\b50[24]\b|hết giờ|timeout|timed out/i.test(String(j.error ?? ""))) {
      j = await api(`/api/books/${id}/illustrate`, "POST", payload);
    }
    setBusyPage(null);
    if (j.ok) {
      // Spread trả 2 URL (trang trái + phải) → cập nhật cả hai. Trang đơn/cover → 1 URL.
      const map = (j.urls as Record<string, string> | undefined) ?? { [pageNo]: j.url as string };
      setIllus((m) => ({ ...m, ...Object.fromEntries(Object.entries(map).map(([k, v]) => [Number(k), v as string])) }));
      return true;
    }
    flash(`✗ ${pageNo === 0 ? "cover" : "page " + pageNo}: ` + (j.error ?? "Draw error"));
    return false;
  };

  // 🎨 VẼ TẤT CẢ: chạy TUẦN TỰ từng khối (cover → trang đơn → spread) tránh timeout; khối đã có ảnh thì bỏ qua,
  // khối lỗi vẫn "chưa vẽ" → bấm lại nút là vẽ tiếp đúng phần thiếu. Bấm lần nữa khi đang chạy = dừng.
  const [drawAllBusy, setDrawAllBusy] = useState(false);
  const drawAllStop = useRef(false);
  const drawAll = async () => {
    if (drawAllBusy) { drawAllStop.current = true; flash("Stopping after this block…"); return; }
    // Danh sách khối CHƯA vẽ xong (cover thiếu mặt nào cũng tính là chưa xong; spread thiếu 1 trong 2 trang cũng vẽ lại cả cặp).
    const todo: number[] = [];
    for (const blk of genBlocks(product)) {
      if (blk.type === "cover") { if (!illus[0] || !illus[-1]) todo.push(0); }
      else if (blk.type === "single") { if (!illus[blk.page]) todo.push(blk.page); }
      else { const [L, R] = blk.pages; if (!illus[L] || !illus[R]) todo.push(L); }
    }
    if (!todo.length) { flash("✓ Everything is already drawn"); return; }
    setDrawAllBusy(true); drawAllStop.current = false;
    let done = 0, fail = 0;
    for (let i = 0; i < todo.length; i++) {
      if (drawAllStop.current) break;
      flash(`Drawing block ${i + 1}/${todo.length}…`);
      const ok = await illustrate(todo[i]);
      if (ok) done++; else fail++;
      // Nghỉ ngắn giữa các khối cho model/gateway thở — chậm mà chắc.
      await new Promise((r) => setTimeout(r, 1500));
    }
    setDrawAllBusy(false);
    if (drawAllStop.current) flash(`⚠ Stopped — drew ${done} block(s). Click Draw all to continue.`);
    else if (fail) flash(`⚠ Drew ${done}/${todo.length} — ${fail} failed. Click Draw all again to retry the missing ones.`);
    else flash(`✓ All drawn (${done} block${done > 1 ? "s" : ""})`);
  };

  // Tải TẤT CẢ ảnh đã vẽ, tên file chuẩn fulfill: cover_front.jpg · cover_back.jpg · 1.jpg…24.jpg.
  const [dlBusy, setDlBusy] = useState(false);
  const downloadAll = async () => {
    if (dlBusy) return;
    const order: number[] = [];
    if (illus[0]) order.push(0);
    if (illus[-1]) order.push(-1);
    Object.keys(illus).map(Number).filter((n) => n >= 1 && illus[n]).sort((a, b) => a - b).forEach((n) => order.push(n));
    if (!order.length) { flash("✗ Nothing drawn yet"); return; }
    setDlBusy(true);
    for (let i = 0; i < order.length; i++) {
      flash(`Downloading ${i + 1}/${order.length}…`);
      const a = document.createElement("a");
      a.href = `/api/books/${id}/asset?page=${order[i]}`;
      document.body.appendChild(a); a.click(); a.remove();
      await new Promise((r) => setTimeout(r, 700));
    }
    setDlBusy(false);
    flash(`✓ Downloaded ${order.length} files (cover_front · cover_back · 1…${Math.max(...order)})`);
  };

  // ---- Render 1 TRANG ĐƠN (bố cục gốc) ----
  const renderSingle = (p: Page, i: number) => (
    <div key={`s${p.page_no}`} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, display: "grid", gridTemplateColumns: "34px 1fr 172px", gap: 12 }}>
      <div style={{ fontWeight: 800, color: "var(--muted)", fontSize: 13 }}>#{p.page_no}</div>
      <div style={{ display: "grid", gap: 8 }}>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--faint)", textTransform: "uppercase", marginBottom: 3 }}>Text (can insert {"{name}"})</div>
          <textarea value={p.text} onChange={(e) => setPage(i, "text", e.target.value)} onBlur={() => savePage(p.page_no)} rows={2} style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} />
        </div>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--faint)", textTransform: "uppercase", marginBottom: 3 }}>Illustration brief (scene)</div>
          <textarea value={p.illustration} onChange={(e) => setPage(i, "illustration", e.target.value)} onBlur={() => savePage(p.page_no)} rows={2} style={{ ...inp, resize: "vertical", lineHeight: 1.5, color: "#555" }} />
        </div>
        <details>
          <summary style={{ fontSize: 11, fontWeight: 700, color: "var(--blue)", cursor: "pointer", userSelect: "none" }}>Detailed prompt {p.prompt ? "✓" : "(not composed)"} — click to view/edit</summary>
          <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "6px 0 4px" }}>
            <button style={{ ...btnGhost, padding: "4px 10px", fontSize: 11 }} onClick={() => composeOne(i, p.page_no)}><IcLayers />Recompose this prompt</button>
          </div>
          <textarea value={p.prompt ?? ""} onChange={(e) => setPage(i, "prompt", e.target.value)} onBlur={() => savePage(p.page_no)} rows={8} placeholder="Auto-composed with the script, or type a gold-standard prompt…" style={{ ...inp, resize: "vertical", lineHeight: 1.45, fontSize: 11.5, fontFamily: "ui-monospace, monospace", color: "#334" }} />
        </details>
      </div>
      <div style={{ display: "grid", gap: 6, alignContent: "start" }}>
        {illus[p.page_no]
          ? <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: "1px solid var(--line)", lineHeight: 0 }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={illus[p.page_no]} alt={`p${p.page_no}`} style={{ width: "100%", display: "block" }} /></div>
          : <div style={{ height: 110, borderRadius: 8, border: "1px dashed var(--line)", display: "grid", placeItems: "center", color: "var(--faint)", fontSize: 11 }}>Not drawn</div>}
        <button style={{ ...btnGhost, fontSize: 11.5, padding: "6px 10px", opacity: (busyPage === p.page_no) ? 0.6 : 1 }} disabled={busyPage === p.page_no} onClick={() => illustrate(p.page_no)}>{busyPage === p.page_no ? "Drawing…" : illus[p.page_no] ? <><IcRefresh />Redraw</> : <><IcBrush />Draw</>}</button>
      </div>
    </div>
  );

  // ---- Render 1 CẶP SPREAD (nạp cả 2 trang, vẽ 1 lần LIỀN MẠCH rồi cắt đôi) ----
  const renderSpread = (L: number, iL: number, R: number, iR: number) => {
    const lp = pages[iL]; const rp = pages[iR]; const busy = busyPage === L || busyPage === R;
    return (
      <div key={`sp${L}-${R}`} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, display: "grid", gridTemplateColumns: "34px 1fr 320px", gap: 12, background: "#fff" }}>
        <div style={{ fontWeight: 800, color: "var(--blue)", fontSize: 12, lineHeight: 1.2 }}>#{L}<br />–{R}<div style={{ fontSize: 8.5, fontWeight: 700, marginTop: 3 }}>SPREAD</div></div>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 12 }}>Pages {L}–{R} · one connected illustration</div>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--faint)", textTransform: "uppercase", marginBottom: 3 }}>Illustration brief — ONE continuous scene across both pages</div>
            <textarea value={lp.illustration} onChange={(e) => setPage(iL, "illustration", e.target.value)} onBlur={() => savePage(L)} rows={2} style={{ ...inp, resize: "vertical", lineHeight: 1.5, color: "#555" }} placeholder="Describe ONE scene spanning the whole spread; it will flow across the gutter." />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--faint)", textTransform: "uppercase", marginBottom: 3 }}>Left text · #{L}</div>
              <textarea value={lp.text} onChange={(e) => setPage(iL, "text", e.target.value)} onBlur={() => savePage(L)} rows={2} style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} />
            </div>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--faint)", textTransform: "uppercase", marginBottom: 3 }}>Right text · #{R}</div>
              <textarea value={rp.text} onChange={(e) => setPage(iR, "text", e.target.value)} onBlur={() => savePage(R)} rows={2} style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} />
            </div>
          </div>
          <details>
            <summary style={{ fontSize: 11, fontWeight: 700, color: "var(--blue)", cursor: "pointer", userSelect: "none" }}>Detailed prompt {lp.prompt ? "✓" : "(not composed)"} — click to view/edit</summary>
            <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "6px 0 4px" }}>
              <button style={{ ...btnGhost, padding: "4px 10px", fontSize: 11 }} onClick={() => composeOne(iL, L)}><IcLayers />Recompose spread prompt</button>
            </div>
            <textarea value={lp.prompt ?? ""} onChange={(e) => setPage(iL, "prompt", e.target.value)} onBlur={() => savePage(L)} rows={8} placeholder="Auto-composed with the script, or click Recompose…" style={{ ...inp, resize: "vertical", lineHeight: 1.45, fontSize: 11.5, fontFamily: "ui-monospace, monospace", color: "#334" }} />
          </details>
        </div>
        <div style={{ display: "grid", gap: 6, alignContent: "start" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {([[L, `Left · #${L}`], [R, `Right · #${R}`]] as [number, string][]).map(([no, label]) => (
              <div key={no} style={{ display: "grid", gap: 4 }}>
                <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".3px" }}>{label}</div>
                {illus[no]
                  ? <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid var(--line)", lineHeight: 0 }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={illus[no]} alt={label} style={{ width: "100%", display: "block" }} /></div>
                  : <div style={{ height: 80, borderRadius: 8, border: "1px dashed var(--line)", display: "grid", placeItems: "center", color: "var(--faint)", fontSize: 10.5 }}>Not drawn</div>}
              </div>
            ))}
          </div>
          <button style={{ ...btnGhost, fontSize: 11.5, padding: "6px 10px", opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => illustrate(L)}>{busy ? "Drawing…" : (illus[L] || illus[R]) ? <><IcRefresh />Redraw spread</> : <><IcBrush />Draw spread (both pages)</>}</button>
        </div>
      </div>
    );
  };

  return (
    <div>
      <StepCard n={1} title={`Theme: ${detail.title.name}`} desc={[detail.title.occasion, detail.title.audience].filter(Boolean).join(" · ") || undefined}>
        {concept.hook ? <div style={{ fontSize: 13, color: "var(--ink)" }}>{concept.hook}</div>
          : <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Theme created from the idea. Go to step 2 to build the kit.</div>}
      </StepCard>

      <StepCard n={2} title="Theme kit — Style Bible + Variables"
        desc="Style is auto-matched from the competitor images you add when creating the book. AI fills the rest from the theme; tweak anything below. This block is applied to EVERY page → keeps the character consistent."
        right={<button style={{ ...btnBlue, opacity: busySetup ? 0.6 : 1 }} disabled={busySetup} onClick={setupAI}>{busySetup ? "Building…" : <><IcSpark />AI build from theme</>}</button>}>
        {/* Thanh STYLE luôn hiển thị: đang theo style nào + nút đổi từ ảnh mẫu (auto lúc Create nếu có ảnh đối thủ). */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid var(--line)", background: "#FAFBFF", borderRadius: 12, padding: "9px 12px", marginBottom: 10, fontSize: 12 }}>
          <span style={{ display: "inline-flex" }}><IcBrush /></span>
          <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={bible.artStyle || ""}>
            <b>Art style:</b> <span style={{ color: "var(--muted)" }}>{(bible.artStyle || "").trim() ? bible.artStyle : "Default storybook style — add a sample image to match a specific look."}</span>
          </span>
          <label style={{ ...btnGhost, padding: "5px 11px", fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 5, cursor: styleBusy ? "default" : "pointer", color: "var(--blue)", whiteSpace: "nowrap", opacity: styleBusy ? 0.6 : 1 }} title="Upload a sample illustration (competitor / your favorite) — AI matches Art style · Palette · Text rules.">
            {styleBusy ? "Reading style…" : "Change style from image"}
            <input type="file" accept="image/*" multiple disabled={styleBusy} style={{ display: "none" }} onChange={(e) => { if (e.target.files?.length) analyzeStyle(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
        <BiblePanel bible={bible} setBible={setBible} onSave={saveBible} />
        {detail.title.kind === "master" && (
          <div style={{ border: "1px solid #F5E1B0", background: "#FFF9EC", color: "#8a6d00", borderRadius: 12, padding: "9px 13px", fontSize: 12, marginBottom: 10 }}>
            <b>Master design:</b> set each variable&apos;s <b>Value</b> to the ORIGINAL value printed in this design (e.g. name = &quot;Sadie&quot;). When you customize for a customer, that original gets replaced by the customer&apos;s value.
          </div>
        )}
        <VarsPanel vars={vars} setVars={setVars} bookId={id} flash={flash} />
      </StepCard>

      <StepCard n={3} title="Script → Detailed prompt → Draw" desc="Generate the script per page, compose deep prompts, then draw. A failed page only needs redrawing on its own.">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Script {pages.length ? `· ${pages.length} pages` : ""}</h3>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <button style={{ ...btnGhost, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={genScript}>{busy ? "Writing…" : pages.length ? <><IcRefresh />Regenerate</> : <><IcSpark />Generate script</>}</button>
          {pages.length > 0 && <button style={{ ...btnBlue, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}>Save</button>}
        </div>
      </div>

      {/* Toolbar LUÔN hiển thị (chọn model được cả trước lần sinh đầu). Thứ tự: Layout → Models → Actions, canh đáy thẳng hàng. */}
      <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", marginBottom: 12, background: "#FAFBFF" }}>
        <label style={{ display: "grid", gap: 3 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".4px" }}>Spread text layout</span>
          <div style={{ display: "inline-flex", background: "#EEF1F6", borderRadius: 999, padding: 3, gap: 2, height: 32, boxSizing: "border-box", alignItems: "center" }}>
            {([["split", "1 side text · 1 side art"], ["both", "Text on both pages"]] as ["split" | "both", string][]).map(([v, lbl]) => (
              <button key={v} onClick={() => { setTextLayout(v); lsSet("bs_text_layout", v); }}
                title={v === "split" ? "Each spread: full text on one page, main subject on the other (competitor style). Applies at Generate/Regenerate script." : "Each page carries its own short text. Applies at Generate/Regenerate script."}
                style={{ padding: "4px 12px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: "pointer", border: 0, background: textLayout === v ? "#fff" : "transparent", color: textLayout === v ? "var(--blue)" : "var(--muted)", boxShadow: textLayout === v ? "0 1px 2px rgba(0,0,0,.10)" : "none" }}>
                {lbl}
              </button>
            ))}
          </div>
        </label>
        <label style={{ display: "grid", gap: 3 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".4px" }}>Text model · writing</span>
          <select value={model} onChange={(e) => setModel(e.target.value)} title="Model for ideas & script" style={{ ...inp, fontSize: 12, padding: "6px 9px", minWidth: 180, height: 32, boxSizing: "border-box" }}>
            <option value="">— Default —</option>
            <ModelOptions models={models} />
          </select>
        </label>
        <label style={{ display: "grid", gap: 3 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".4px" }}>Image model · drawing</span>
          <select value={imgModel} onChange={(e) => setImgModel(e.target.value)} title="Model for drawing pages" style={{ ...inp, fontSize: 12, padding: "6px 9px", minWidth: 180, height: 32, boxSizing: "border-box" }}>
            <option value="">— Default —</option>
            <ModelOptions models={imgModels} />
          </select>
        </label>
        {pages.length > 0 && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button
              style={{ ...btnBlue, padding: "0 14px", height: 32, fontSize: 12.5, background: drawAllBusy ? "#b45309" : "var(--blue)", opacity: busyPage !== null && !drawAllBusy ? 0.6 : 1 }}
              disabled={busyPage !== null && !drawAllBusy}
              onClick={drawAll}
              title="Draws every not-yet-drawn block one at a time (cover → pages → spreads), slow & steady to avoid timeouts. Failed/missing blocks are retried on the next click. Click while running to stop.">
              {drawAllBusy ? <><IcStop />Stop drawing</> : <><IcBrush />Draw all (missing)</>}
            </button>
            <button style={{ ...btnGhost, padding: "0 14px", height: 32, fontSize: 12.5, opacity: dlBusy ? 0.6 : 1 }} disabled={dlBusy} onClick={downloadAll}
              title="Downloads every drawn image with fulfill-ready names: cover_front.jpg · cover_back.jpg · 1.jpg…24.jpg">
              <IcDownload />{dlBusy ? "Downloading…" : "Download all"}
            </button>
          </div>
        )}
      </div>

      {pages.length > 0 && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, marginBottom: 10, background: "#fff", display: "grid", gridTemplateColumns: "34px 1fr 320px", gap: 12 }}>
          <div style={{ fontWeight: 800, color: "var(--muted)" }}><IcBookS /></div>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 13 }}>Cover — one wraparound ({product.coverW}×{product.coverH}px → cover_back + cover_front)</div>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--faint)", textTransform: "uppercase", marginBottom: 3 }}>Title text (baked on the front · can insert {"{name}"})</div>
              <textarea value={cover.text ?? ""} onChange={(e) => setCover((c) => ({ ...c, text: e.target.value }))} onBlur={autoSaveCover} rows={2} placeholder={detail.title.name} style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} />
            </div>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--faint)", textTransform: "uppercase", marginBottom: 3 }}>Illustration brief (wraparound scene — front on right, back continues on left)</div>
              <textarea value={cover.brief ?? ""} onChange={(e) => setCover((c) => ({ ...c, brief: e.target.value }))} onBlur={autoSaveCover} rows={2} placeholder="e.g. Sunset ocean with a lighthouse and sailboat; hero + pet on the right, the same seascape continuing calmly on the left." style={{ ...inp, resize: "vertical", lineHeight: 1.5, color: "#555" }} />
            </div>
            <details>
              <summary style={{ fontSize: 11, fontWeight: 700, color: "var(--blue)", cursor: "pointer", userSelect: "none" }}>Detailed prompt {cover.prompt ? "✓" : "(not composed)"} — click to view/edit</summary>
              <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "6px 0 4px" }}>
                <button style={{ ...btnGhost, padding: "4px 10px", fontSize: 11 }} onClick={composeCover}><IcLayers />Recompose cover prompt</button>
              </div>
              <textarea value={cover.prompt ?? ""} onChange={(e) => setCover((c) => ({ ...c, prompt: e.target.value }))} onBlur={autoSaveCover} rows={7} placeholder="Auto-composed with the script, or click Recompose…" style={{ ...inp, resize: "vertical", lineHeight: 1.45, fontSize: 11.5, fontFamily: "ui-monospace, monospace", color: "#334" }} />
            </details>
          </div>
          <div style={{ display: "grid", gap: 6, alignContent: "start" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {([[-1, "Back (left)"], [0, "Front (right · title)"]] as [number, string][]).map(([no, label]) => (
                <div key={no} style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".3px" }}>{label}</div>
                  {illus[no]
                    ? <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid var(--line)", lineHeight: 0 }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={illus[no]} alt={label} style={{ width: "100%", display: "block" }} /></div>
                    : <div style={{ height: 80, borderRadius: 8, border: "1px dashed var(--line)", display: "grid", placeItems: "center", color: "var(--faint)", fontSize: 10.5 }}>Not drawn</div>}
                </div>
              ))}
            </div>
            <button style={{ ...btnGhost, fontSize: 11.5, padding: "6px 10px", opacity: (busyPage === 0) ? 0.6 : 1 }} disabled={busyPage === 0} onClick={drawCover}>{busyPage === 0 ? "Drawing…" : (illus[0] || illus[-1]) ? <><IcRefresh />Redraw cover</> : <><IcBrush />Draw cover (front + back)</>}</button>
          </div>
        </div>
      )}

      {pages.length === 0 ? <div className="panel empty" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>No script yet. Click <b>Generate script</b> to have AI write each page.</div>
        : (() => {
          // Gom trang theo BỐ CỤC sản phẩm: trang 1 & cuối = đơn; cặp giữa = 1 thẻ SPREAD (vẽ 1 lần cho 2 trang).
          const idxByNo = new Map(pages.map((p, i) => [p.page_no, i]));
          const covered = new Set<number>();
          const nodes: React.ReactNode[] = [];
          for (const blk of genBlocks(product)) {
            if (blk.type === "cover") continue;
            if (blk.type === "single") {
              const i = idxByNo.get(blk.page); if (i == null) continue;
              covered.add(blk.page); nodes.push(renderSingle(pages[i], i));
            } else {
              const [L, R] = blk.pages; const iL = idxByNo.get(L); const iR = idxByNo.get(R);
              if (iL != null && iR != null) { covered.add(L); covered.add(R); nodes.push(renderSpread(L, iL, R, iR)); }
              else { if (iL != null) { covered.add(L); nodes.push(renderSingle(pages[iL], iL)); } if (iR != null) { covered.add(R); nodes.push(renderSingle(pages[iR], iR)); } }
            }
          }
          // Trang lẻ không khớp bố cục (sách cũ / số trang lệch) → hiện dạng đơn.
          pages.forEach((p, i) => { if (!covered.has(p.page_no)) nodes.push(renderSingle(p, i)); });
          return <div style={{ display: "grid", gap: 10 }}>{nodes}</div>;
        })()}
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>Preview name: <b>{previewName}</b> (edit the value of the <code>name</code> variable).</div>
      </StepCard>
    </div>
  );
}
