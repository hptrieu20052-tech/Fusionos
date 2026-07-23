"use client";
import { useEffect, useRef, useState } from "react";

type Mode = "clone" | "bgremove" | "redesign";
const TABS: { key: Mode; label: string; desc: string; icon: string }[] = [
  { key: "clone", label: "Clone", desc: "Extract the printed design (drop the shirt/photo background) and reproduce it clean & sharp → TRANSPARENT PNG.", icon: "M8 4h10a2 2 0 0 1 2 2v10M16 8H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2Z" },
  { key: "bgremove", label: "Remove BG", desc: "Cut the subject from its background → TRANSPARENT PNG with clean edges.", icon: "M3 3h7v7H3zM14 14h7v7h-7zM14 3h7v7h-7zM3 14h7v7H3z" },
  { key: "redesign", label: "Redesign", desc: "Redesign per your prompt → print-ready TRANSPARENT PNG.", icon: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" },
];
const RATIOS = ["auto", "1:1", "4:5", "3:4", "2:3", "16:9", "9:16"];

const box: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 14, background: "#fff", padding: 18 };
const lab: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 5 };
const ctl: React.CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 11px", fontSize: 13, font: "inherit", background: "#fff" };

export function GenImageClient() {
  const [mode, setMode] = useState<Mode>("clone");
  const [srcData, setSrcData] = useState<string>("");   // dataURL hoặc http URL ảnh nguồn
  const [srcName, setSrcName] = useState<string>("");
  const [link, setLink] = useState("");
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<{ url: string | null; dataUrl: string; cost: number; usedModel?: string; method?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [model, setModel] = useState("");
  useEffect(() => {
    fetch("/api/books/models?type=image").then((r) => r.json()).then((j) => {
      if (j.ok && Array.isArray(j.models)) {
        setModels(j.models);
        const def = j.models.find((m: { id: string }) => /seedream/i.test(m.id)) ?? j.models.find((m: { id: string }) => /gemini.*flash.*image/i.test(m.id)) ?? j.models[0];
        setModel((prev) => prev || def?.id || "");
      }
    }).catch(() => {});
  }, []);

  const readFile = (f: File) => {
    if (!f.type.startsWith("image/")) { setMsg("✗ Image files only (PNG/JPG/WebP)"); return; }
    if (f.size > 15 * 1024 * 1024) { setMsg("✗ Image too large (>15MB)"); return; }
    const r = new FileReader();
    r.onload = () => { setSrcData(String(r.result)); setSrcName(f.name); setResult(null); setMsg(""); };
    r.readAsDataURL(f);
  };
  const useLink = () => {
    const u = link.trim();
    if (!/^https?:\/\/\S+/i.test(u)) { setMsg("✗ Link must start with http(s)://"); return; }
    setSrcData(u); setSrcName(u.split("/").pop() || "link"); setResult(null); setMsg("");
  };
  const clearSrc = () => { setSrcData(""); setSrcName(""); setResult(null); };

  const tab = TABS.find((t) => t.key === mode)!;

  const generate = async () => {
    if (!srcData) { setMsg("✗ Upload or paste a source image link first"); return; }
    if (mode === "redesign" && !prompt.trim()) { setMsg("✗ Enter the redesign prompt"); return; }
    setBusy(true); setMsg("Processing… (10–40s)"); setResult(null);
    try {
      const j = await fetch("/api/ai-image/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, image: srcData, prompt, model: model || undefined, aspectRatio: ratio, autoFallback: true }),
      }).then((r) => r.json());
      if (j.ok) { setResult({ url: j.url, dataUrl: j.dataUrl, cost: j.cost ?? 0, usedModel: j.usedModel, method: j.method }); setMsg(j.method === "ai" && j.usedModel && model && j.usedModel !== model && j.usedModel !== "default" ? `↻ Your model refused — auto-switched to: ${j.usedModel}` : ""); }
      else setMsg("✗ " + (j.error ?? "Error"));
    } catch { setMsg("✗ Network error — try again"); }
    setBusy(false);
  };

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "18px 16px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Gen Image</h1>
        <span style={{ fontSize: 11, fontWeight: 700, background: "#EEE9FB", color: "#6D48C9", borderRadius: 999, padding: "3px 10px" }}>AI Agent · beta</span>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map((tb) => (
          <button key={tb.key} onClick={() => { setMode(tb.key); setResult(null); setMsg(""); setPrompt(""); }}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, border: `1.5px solid ${mode === tb.key ? "var(--blue)" : "var(--line)"}`, background: mode === tb.key ? "var(--blue-soft)" : "#fff", color: mode === tb.key ? "var(--blue)" : "var(--ink)", borderRadius: 11, padding: "9px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={tb.icon} /></svg>
            {tb.label}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Nguồn + tuỳ chọn */}
        <div style={box}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Source image</div>
            {srcData && (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => fileRef.current?.click()} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "3px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", color: "var(--blue)" }}>Change</button>
                <button onClick={clearSrc} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "3px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", color: "var(--red)" }}>Remove</button>
              </div>
            )}
          </div>
          <div onClick={() => { if (!srcData) fileRef.current?.click(); }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) readFile(f); }}
            style={{ border: "2px dashed var(--line)", borderRadius: 12, minHeight: 240, display: "flex", alignItems: "center", justifyContent: "center", cursor: srcData ? "default" : "pointer", background: "#FAFBFD", overflow: "hidden" }}>
            {srcData
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={srcData} alt="" style={{ maxWidth: "100%", maxHeight: 300, objectFit: "contain" }} />
              : <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 12.5, padding: 20 }}>
                  <div style={{ fontSize: 30, marginBottom: 6 }}>＋</div>
                  Drag & drop or click to choose<br />PNG / JPG / WebP · ≤ 15MB
                </div>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ""; }} />
          {srcName && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{srcName}</div>}

          {/* Dán ảnh từ link */}
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="…or paste an image link (http/https)" style={{ ...ctl, flex: 1 }} onKeyDown={(e) => e.key === "Enter" && useLink()} />
            <button onClick={useLink} style={{ border: "1px solid var(--line)", background: "#F3F6FB", borderRadius: 10, padding: "0 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: "var(--ink)" }}>Use link</button>
          </div>

          {/* Prompt — mọi mode (redesign bắt buộc) */}
          <div style={{ marginTop: 12 }}>
            <label style={lab}>{mode === "redesign" ? "Prompt (required)" : "Prompt (optional)"}</label>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2}
              placeholder={mode === "redesign" ? "E.g. pastel tones, add florals around the text, keep the name…" : "E.g. sharper lines, more contrast… (optional)"}
              style={{ ...ctl, resize: "vertical" }} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8, marginTop: 12 }}>
            <div>
              <label style={lab}>Model AI ({models.length || "…"})</label>
              <select value={model} onChange={(e) => setModel(e.target.value)} style={ctl}>
                {!models.length && <option value="">Loading…</option>}
                {models.map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
              </select>
            </div>
            <div>
              <label style={lab}>Aspect ratio</label>
              <select value={ratio} onChange={(e) => setRatio(e.target.value)} style={ctl}>
                {RATIOS.map((r) => <option key={r} value={r}>{r === "auto" ? "Auto" : r}</option>)}
              </select>
            </div>
          </div>

          <button onClick={generate} disabled={busy}
            style={{ marginTop: 14, width: "100%", background: busy ? "#9CB2D8" : "var(--blue)", color: "#fff", border: "none", borderRadius: 11, padding: "11px 0", fontSize: 14, fontWeight: 800, cursor: busy ? "default" : "pointer" }}>
            {busy ? "Processing…" : `Run ${tab.label}`}
          </button>
          {msg && <div style={{ marginTop: 10, fontSize: 12.5, color: msg.startsWith("✗") ? "var(--red)" : "var(--muted)" }}>{msg}</div>}
        </div>

        {/* Kết quả */}
        <div style={box}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Result</div>
          <div style={{ borderRadius: 12, minHeight: 240, display: "flex", alignItems: "center", justifyContent: "center", background: result ? "repeating-conic-gradient(#EDF0F4 0% 25%, #fff 0% 50%) 50%/20px 20px" : "#FAFBFD", border: "1px solid var(--line)", overflow: "hidden" }}>
            {result
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={result.dataUrl} alt="" style={{ maxWidth: "100%", maxHeight: 460, objectFit: "contain" }} />
              : <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{busy ? "AI is drawing…" : "Result will appear here"}</div>}
          </div>
          {result && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
              <a href={result.url ?? result.dataUrl} download={`genimage-${mode}.png`} target="_blank" rel="noreferrer"
                style={{ flex: 1, textAlign: "center", background: "var(--ink)", color: "#fff", borderRadius: 11, padding: "10px 0", fontSize: 13, fontWeight: 800, textDecoration: "none" }}>
                ⬇ Download PNG
              </a>
              <button onClick={() => { if (result.dataUrl) { setSrcData(result.dataUrl); setSrcName("previous result"); setResult(null); } }}
                title="Use this result as the source for further editing"
                style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 11, padding: "10px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: "var(--ink)" }}>
                Use as source ↻
              </button>
              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>~${(result.cost || 0).toFixed(3)}</span>
            </div>
          )}
          {result && (
            result.method === "direct"
              ? <div style={{ fontSize: 11.5, color: "var(--green)", fontWeight: 600, marginTop: 8 }}>✓ Direct cut — 100% original quality (no AI)</div>
              : result.usedModel ? <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>AI model: {result.usedModel}</div> : null
          )}
        </div>
      </div>
    </div>
  );
}
