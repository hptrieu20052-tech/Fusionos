"use client";
import { useEffect, useRef, useState } from "react";

// Danh sách model image-to-video (khớp VIDEO_MODELS trong src/lib/ai/fal.ts).
const MODELS: { id: string; name: string; note: string; aspect: boolean }[] = [
  { id: "fal-ai/kling-video/v2.1/standard/image-to-video", name: "Kling 2.1 — best motion", note: "Smoothest, most faithful motion. Output ratio follows the source image.", aspect: false },
  { id: "bytedance/seedance-2.0/image-to-video", name: "Seedance 2.0 (ByteDance, +audio)", note: "Same family as Seedream. Pick the aspect ratio, includes audio.", aspect: true },
];
const RATIOS = ["auto", "9:16", "1:1", "16:9"];

const box: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 14, background: "#fff", padding: 18 };
const lab: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 5 };
const ctl: React.CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 11px", fontSize: 13, font: "inherit", background: "#fff" };

const POLL_MS = 5000;
const MAX_POLLS = 84; // ~7 phút

export function GenVideoClient() {
  const [srcData, setSrcData] = useState<string>("");
  const [srcName, setSrcName] = useState<string>("");
  const [link, setLink] = useState("");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(MODELS[0].id);
  const [duration, setDuration] = useState<"5" | "10">("5");
  const [ratio, setRatio] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<{ url: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const runId = useRef(0);          // token để hủy vòng poll khi user chạy lại / rời trang
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const modelInfo = MODELS.find((m) => m.id === model) ?? MODELS[0];

  useEffect(() => () => { runId.current++; if (timerRef.current) clearInterval(timerRef.current); }, []);

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

  const startTimer = () => {
    setElapsed(0);
    const t0 = Date.now();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
  };
  const stopTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };

  const generate = async () => {
    if (!srcData) { setMsg("✗ Upload or paste a source image link first"); return; }
    const myId = ++runId.current;
    setBusy(true); setResult(null); setMsg("Submitting…"); startTimer();
    try {
      const sub = await fetch("/api/ai-video/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: srcData, prompt, model, duration, aspectRatio: ratio }),
      }).then((r) => r.json());
      if (!sub.ok) { setMsg("✗ " + (sub.error ?? "Submit failed")); setBusy(false); stopTimer(); return; }

      const { statusUrl, responseUrl } = sub;
      setMsg("Rendering… video usually takes 1–4 min.");
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((res) => setTimeout(res, POLL_MS));
        if (myId !== runId.current) return; // đã bị hủy
        let st: { ok?: boolean; done?: boolean; url?: string; status?: string; error?: string };
        try {
          st = await fetch("/api/ai-video/status", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ statusUrl, responseUrl }),
          }).then((r) => r.json());
        } catch { continue; } // lỗi mạng tạm thời → thử lại
        if (myId !== runId.current) return;
        if (!st.ok) { setMsg("✗ " + (st.error ?? "Render failed")); setBusy(false); stopTimer(); return; }
        if (st.done && st.url) { setResult({ url: st.url }); setMsg(""); setBusy(false); stopTimer(); return; }
      }
      setMsg("✗ Timed out (>7 min). Try a shorter duration or run again.");
    } catch { setMsg("✗ Network error — try again"); }
    setBusy(false); stopTimer();
  };

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "18px 16px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Gen Video</h1>
        <span style={{ fontSize: 11, fontWeight: 700, background: "#EEE9FB", color: "#6D48C9", borderRadius: 999, padding: "3px 10px" }}>AI Agent · beta</span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6, marginBottom: 16 }}>
        Image → Video: turn a design/photo into a short animated clip.
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

          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="…or paste an image link (http/https)" style={{ ...ctl, flex: 1 }} onKeyDown={(e) => e.key === "Enter" && useLink()} />
            <button onClick={useLink} style={{ border: "1px solid var(--line)", background: "#F3F6FB", borderRadius: 10, padding: "0 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: "var(--ink)" }}>Use link</button>
          </div>

          {/* Prompt mô tả chuyển động (optional) */}
          <div style={{ marginTop: 12 }}>
            <label style={lab}>Motion prompt (optional)</label>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2}
              placeholder="E.g. gentle camera push-in, character waves, sparkles drift… (optional)"
              style={{ ...ctl, resize: "vertical" }} />
          </div>

          {/* Model */}
          <div style={{ marginTop: 12 }}>
            <label style={lab}>Model AI</label>
            <select value={model} onChange={(e) => setModel(e.target.value)} style={ctl}>
              {MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 5 }}>{modelInfo.note}</div>
          </div>

          {/* Duration + Aspect */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
            <div>
              <label style={lab}>Duration</label>
              <select value={duration} onChange={(e) => setDuration(e.target.value === "10" ? "10" : "5")} style={ctl}>
                <option value="5">5 seconds</option>
                <option value="10">10 seconds</option>
              </select>
            </div>
            <div>
              <label style={lab}>Aspect ratio{modelInfo.aspect ? "" : " (follows image)"}</label>
              <select value={ratio} onChange={(e) => setRatio(e.target.value)} disabled={!modelInfo.aspect} style={{ ...ctl, opacity: modelInfo.aspect ? 1 : 0.6 }}>
                {RATIOS.map((r) => <option key={r} value={r}>{r === "auto" ? "Auto" : r}</option>)}
              </select>
            </div>
          </div>

          <button onClick={generate} disabled={busy}
            style={{ marginTop: 14, width: "100%", background: busy ? "#9CB2D8" : "var(--blue)", color: "#fff", border: "none", borderRadius: 11, padding: "11px 0", fontSize: 14, fontWeight: 800, cursor: busy ? "default" : "pointer" }}>
            {busy ? `Rendering… ${elapsed}s` : "Generate video"}
          </button>
          {msg && <div style={{ marginTop: 10, fontSize: 12.5, color: msg.startsWith("✗") ? "var(--red)" : "var(--muted)" }}>{msg}</div>}
        </div>

        {/* Kết quả */}
        <div style={box}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Result</div>
          <div style={{ borderRadius: 12, minHeight: 240, display: "flex", alignItems: "center", justifyContent: "center", background: "#0B0D12", border: "1px solid var(--line)", overflow: "hidden" }}>
            {result
              ? <video src={result.url} controls autoPlay loop playsInline style={{ maxWidth: "100%", maxHeight: 460 }} />
              : <div style={{ color: "#9AA6B8", fontSize: 12.5, textAlign: "center", padding: 20 }}>
                  {busy ? <>AI is rendering the video…<br /><span style={{ fontSize: 11 }}>{elapsed}s elapsed — please keep this tab open</span></> : "Video will appear here"}
                </div>}
          </div>
          {result && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
              <a href={result.url} download="genvideo.mp4" target="_blank" rel="noreferrer"
                style={{ flex: 1, textAlign: "center", background: "var(--ink)", color: "#fff", borderRadius: 11, padding: "10px 0", fontSize: 13, fontWeight: 800, textDecoration: "none" }}>
                ⬇ Download MP4
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
