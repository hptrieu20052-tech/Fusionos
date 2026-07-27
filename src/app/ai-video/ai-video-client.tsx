"use client";
import { useEffect, useRef, useState } from "react";

// Danh sách model image-to-video (khớp VIDEO_MODELS trong src/lib/ai/fal.ts).
const MODELS: { id: string; name: string; note: string; aspect: boolean; neg: boolean; res: boolean; multi: boolean }[] = [
  { id: "fal-ai/kling-video/v2.1/standard/image-to-video", name: "Kling 2.1 — best motion", note: "Smoothest, most faithful motion. Output ratio follows the source image.", aspect: false, neg: true, res: false, multi: false },
  { id: "fal-ai/kling-video/v2.1/pro/image-to-video", name: "Kling 2.1 Pro — highest quality", note: "Sharper detail and cleaner motion than standard (higher cost). Ratio follows the source image.", aspect: false, neg: true, res: false, multi: false },
  { id: "bytedance/seedance-2.0/image-to-video", name: "Seedance 2.0 (ByteDance, +audio)", note: "Same family as Seedream. Pick the aspect ratio, includes audio, supports 1080p.", aspect: true, neg: false, res: true, multi: false },
  { id: "bytedance/seedance-2.0/reference-to-video", name: "Seedance 2.0 Multi-image — scenes", note: "2–4 images → multi-scene video. Reference them in the prompt as @Image1, @Image2…", aspect: true, neg: false, res: true, multi: true },
];
const MULTI_ID = "bytedance/seedance-2.0/reference-to-video";
const MAX_IMAGES = 4; // giới hạn body ~4.5MB của Vercel (ảnh đã nén còn ~0.5–0.9MB/tấm)
const RATIOS = ["auto", "9:16", "1:1", "16:9"];
// Negative prompt mặc định (khớp DEFAULT_NEGATIVE ở src/lib/ai/fal.ts) — bỏ trống là dùng cái này.
const NEG_DEFAULT = "blur, distortion, low quality, warped text, deformed logo, extra fingers, extra limbs, morphing face, flicker, watermark, subtitles";

const box: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 14, background: "#fff", padding: 18 };
const lab: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 5 };
const ctl: React.CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 11px", fontSize: 13, font: "inherit", background: "#fff" };

const POLL_MS = 5000;
const MAX_POLLS = 84; // ~7 phút

export function GenVideoClient() {
  // Nhiều ảnh nguồn (tối đa MAX_IMAGES). 1 ảnh = image-to-video thường; 2+ ảnh = multi-scene.
  const [srcs, setSrcs] = useState<{ data: string; name: string }[]>([]);
  const [link, setLink] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negPrompt, setNegPrompt] = useState("");
  const [model, setModel] = useState(MODELS[0].id);
  const [duration, setDuration] = useState<"5" | "10">("5");
  const [ratio, setRatio] = useState("auto");
  const [reso, setReso] = useState<"720p" | "1080p">("720p");
  const [scripting, setScripting] = useState(false);
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<{ url: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const runId = useRef(0);          // token để hủy vòng poll khi user chạy lại / rời trang
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const modelInfo = MODELS.find((m) => m.id === model) ?? MODELS[0];
  const srcData = srcs[0]?.data ?? ""; // ảnh đầu — dùng cho model 1-ảnh

  useEffect(() => () => { runId.current++; if (timerRef.current) clearInterval(timerRef.current); }, []);

  // 2+ ảnh → bắt buộc model Multi-image; quay về 1 ảnh khi đang chọn Multi → trả về model mặc định.
  useEffect(() => {
    if (srcs.length > 1 && model !== MULTI_ID) setModel(MULTI_ID);
    if (srcs.length <= 1 && model === MULTI_ID) setModel(MODELS[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcs.length]);

  // Ảnh quá nặng gửi thẳng dạng base64 sẽ vượt giới hạn body ~4.5MB của Vercel → request chết trước khi tới fal.
  // → tự thu nhỏ về tối đa 1600px / JPEG q0.92 trước khi gửi (chất lượng video không đổi, model cũng chỉ render 720p).
  const shrink = (dataUrl: string): Promise<string> => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1600;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      if (scale === 1 && dataUrl.length < 2_600_000) { resolve(dataUrl); return; }
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      const ctx = c.getContext("2d");
      if (!ctx) { resolve(dataUrl); return; }
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

  const addSrc = (data: string, name: string) => {
    setSrcs((prev) => {
      if (prev.length >= MAX_IMAGES) { setMsg(`✗ Max ${MAX_IMAGES} images`); return prev; }
      return [...prev, { data, name }];
    });
    setResult(null); setMsg("");
  };
  const readFiles = (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) { setMsg("✗ Image files only (PNG/JPG/WebP)"); continue; }
      if (f.size > 15 * 1024 * 1024) { setMsg("✗ Image too large (>15MB)"); continue; }
      const r = new FileReader();
      r.onload = async () => addSrc(await shrink(String(r.result)), f.name);
      r.readAsDataURL(f);
    }
  };
  const useLink = () => {
    const u = link.trim();
    if (!/^https?:\/\/\S+/i.test(u)) { setMsg("✗ Link must start with http(s)://"); return; }
    addSrc(u, u.split("/").pop() || "link"); setLink("");
  };
  const removeSrc = (i: number) => { setSrcs((prev) => prev.filter((_, k) => k !== i)); setResult(null); };
  const clearSrc = () => { setSrcs([]); setResult(null); setIdea(""); };

  // AI TỰ VIẾT KỊCH BẢN: gửi ảnh (+ prompt hiện tại làm gợi ý) → AI trả prompt/negative/duration/ratio, đổ vào form.
  const aiScript = async () => {
    if (!srcData) { setMsg("✗ Upload or paste a source image link first"); return; }
    setScripting(true); setMsg("AI is writing the script…"); setIdea("");
    try {
      const r = await fetch("/api/ai-video/script", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: srcs.map((s) => s.data), notes: prompt }),
      }).then((x) => x.json());
      if (!r.ok) { setMsg("✗ " + (r.error ?? "Script failed")); setScripting(false); return; }
      setPrompt(r.prompt ?? "");
      setNegPrompt(r.negativePrompt ?? "");
      if (r.duration === "5" || r.duration === "10") setDuration(r.duration);
      if (modelInfo.aspect && ["9:16", "1:1", "16:9"].includes(r.aspectRatio)) setRatio(r.aspectRatio);
      setIdea(r.idea ?? "");
      setMsg("");
    } catch { setMsg("✗ Network error — try again"); }
    setScripting(false);
  };

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
        body: JSON.stringify({ image: srcData, images: srcs.map((s) => s.data), prompt, negativePrompt: negPrompt, model, duration, aspectRatio: ratio, resolution: reso }),
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
            <div style={{ fontWeight: 700, fontSize: 13 }}>
              Source image{srcs.length > 1 ? `s (${srcs.length}/${MAX_IMAGES})` : ""}
            </div>
            {srcs.length > 0 && (
              <div style={{ display: "flex", gap: 6 }}>
                {srcs.length < MAX_IMAGES && (
                  <button onClick={() => fileRef.current?.click()} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "3px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", color: "var(--blue)" }}>+ Add image</button>
                )}
                <button onClick={clearSrc} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "3px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", color: "var(--red)" }}>Remove all</button>
              </div>
            )}
          </div>
          <div onClick={() => { if (!srcs.length) fileRef.current?.click(); }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) readFiles(e.dataTransfer.files); }}
            style={{ border: "2px dashed var(--line)", borderRadius: 12, minHeight: srcs.length > 1 ? 150 : 240, display: "flex", alignItems: "center", justifyContent: "center", cursor: srcs.length ? "default" : "pointer", background: "#FAFBFD", overflow: "hidden", padding: srcs.length > 1 ? 8 : 0 }}>
            {srcs.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 12.5, padding: 20 }}>
                <div style={{ fontSize: 30, marginBottom: 6 }}>＋</div>
                Drag & drop or click to choose (multiple allowed)<br />PNG / JPG / WebP · ≤ 15MB · up to {MAX_IMAGES} images = multi-scene
              </div>
            )}
            {srcs.length === 1 && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={srcs[0].data} alt="" style={{ maxWidth: "100%", maxHeight: 300, objectFit: "contain" }} />
            )}
            {srcs.length > 1 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8, width: "100%" }}>
                {srcs.map((s, i) => (
                  <div key={i} style={{ position: "relative", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
                    {/* Thứ tự = thứ tự cảnh: prompt gọi bằng @Image1, @Image2… */}
                    <span style={{ position: "absolute", top: 4, left: 4, background: "#6D48C9", color: "#fff", fontSize: 10, fontWeight: 800, borderRadius: 6, padding: "1px 6px" }}>@Image{i + 1}</span>
                    <button onClick={() => removeSrc(i)} title="Remove"
                      style={{ position: "absolute", top: 4, right: 4, border: "none", background: "rgba(0,0,0,.55)", color: "#fff", borderRadius: 6, width: 18, height: 18, fontSize: 11, lineHeight: "18px", padding: 0, cursor: "pointer" }}>×</button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.data} alt="" style={{ width: "100%", height: 110, objectFit: "cover", display: "block" }} />
                  </div>
                ))}
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { if (e.target.files?.length) readFiles(e.target.files); e.target.value = ""; }} />
          {srcs.length === 1 && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{srcs[0].name}</div>}
          {srcs.length > 1 && <div style={{ fontSize: 11, color: "#6D48C9", marginTop: 6, fontWeight: 600 }}>Multi-scene mode: 1 scene per image, in this order. Press &quot;AI script&quot; to write the scene-by-scene script.</div>}

          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="…or paste an image link (http/https)" style={{ ...ctl, flex: 1 }} onKeyDown={(e) => e.key === "Enter" && useLink()} />
            <button onClick={useLink} style={{ border: "1px solid var(--line)", background: "#F3F6FB", borderRadius: 10, padding: "0 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: "var(--ink)" }}>Use link</button>
          </div>

          {/* Prompt mô tả chuyển động (optional) + nút AI tự viết kịch bản */}
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
              <label style={{ ...lab, marginBottom: 0 }}>Motion prompt (optional)</label>
              <button type="button" onClick={aiScript} disabled={scripting || busy || !srcData}
                title="AI looks at the image and writes a selling ad script (fills prompt, negative prompt, duration and ratio)"
                style={{ border: "none", background: scripting || !srcData ? "#B9A8E8" : "#6D48C9", color: "#fff", borderRadius: 8, padding: "4px 12px", fontSize: 11.5, fontWeight: 800, cursor: scripting || !srcData ? "default" : "pointer" }}>
                {scripting ? "Writing…" : "AI script"}
              </button>
            </div>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3}
              placeholder={'E.g. gentle camera push-in, character waves… — or type a short idea ("cozy fall vibe") then press "AI script" to expand it'}
              style={{ ...ctl, resize: "vertical" }} />
            {idea && <div style={{ fontSize: 11, color: "#6D48C9", marginTop: 5, fontWeight: 600 }}>Ad concept: {idea}</div>}
          </div>

          {/* Negative prompt — thứ KHÔNG muốn xuất hiện trong video (chữ méo, tay thừa, watermark…) */}
          <div style={{ marginTop: 12 }}>
            <label style={lab}>Negative prompt (optional)</label>
            <textarea value={negPrompt} onChange={(e) => setNegPrompt(e.target.value)} rows={2}
              placeholder={NEG_DEFAULT}
              style={{ ...ctl, resize: "vertical" }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 5 }}>
              <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.4 }}>
                What must NOT appear. Leave empty to use the default above.
                {!modelInfo.neg && " This model has no native negative field — it is appended to the prompt as \"Avoid: …\"."}
              </div>
              <button type="button" onClick={() => setNegPrompt(NEG_DEFAULT)}
                style={{ flexShrink: 0, border: "1px solid var(--line)", background: "#F3F6FB", borderRadius: 8, padding: "3px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", color: "var(--ink)" }}>
                Use default
              </button>
            </div>
          </div>

          {/* Model */}
          <div style={{ marginTop: 12 }}>
            <label style={lab}>Model AI</label>
            <select value={model} onChange={(e) => setModel(e.target.value)} style={ctl}>
              {/* 2+ ảnh → chỉ model Multi-image dùng được (model 1-ảnh bị disable) */}
              {MODELS.map((m) => <option key={m.id} value={m.id} disabled={srcs.length > 1 && !m.multi}>{m.name}</option>)}
            </select>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 5 }}>{modelInfo.note}</div>
          </div>

          {/* Duration + Aspect + Resolution */}
          <div style={{ display: "grid", gridTemplateColumns: modelInfo.res ? "1fr 1fr 1fr" : "1fr 1fr", gap: 8, marginTop: 12 }}>
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
            {modelInfo.res && (
              <div>
                <label style={lab}>Resolution</label>
                <select value={reso} onChange={(e) => setReso(e.target.value === "1080p" ? "1080p" : "720p")} style={ctl}>
                  <option value="720p">720p</option>
                  <option value="1080p">1080p (sharper)</option>
                </select>
              </div>
            )}
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
