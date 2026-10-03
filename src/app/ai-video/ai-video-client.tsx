"use client";
import { useEffect, useRef, useState } from "react";

// v628 · Gen Video có 2 chế độ:
//   • One video — như cũ: 1 ảnh i2v, hoặc 2–4 ảnh = 1 video multi-scene (Seedance reference-to-video).
//   • Multi-clip (stitch) — MỖI ẢNH 1 CLIP ~5s với PROMPT RIÊNG, render song song trên fal,
//     xong NỐI theo thứ tự thành 1 video (fal ffmpeg merge). Clip không đổi thì DÙNG LẠI, đỡ tốn phí.
//     "AI script per clip": AI nhìn cả bộ ảnh và viết kịch bản RIÊNG cho từng clip, nối mạch 1 quảng cáo.
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

// ===== v628 · MULTI-CLIP (stitch): mỗi ảnh 1 clip ~5s với PROMPT RIÊNG → fal ffmpeg nối thành 1 video =====
const CLIP_MODELS = MODELS.filter((m) => !m.multi); // multi-clip render từng ảnh riêng → chỉ model 1-ảnh
const MAX_SEGS = 6;
type Seg = { data: string; name: string; prompt: string; dur: "5" | "10"; stat?: string; clip?: { url: string; sig: string } };
// Giá fal tham khảo (10/2026) — CHỈ để ƯỚC TÍNH hiển thị, con số thật xem dashboard fal.
// Kling: giá theo video 5s + phụ trội mỗi giây thêm. Seedance 2.0: theo giây (720p $0.3034/s, 1080p $0.682/s).
function estClip(modelId: string, dur: number, reso: string): number {
  if (modelId.includes("kling")) { const pro = modelId.includes("/pro/"); return (pro ? 0.49 : 0.28) + Math.max(0, dur - 5) * (pro ? 0.098 : 0.056); }
  if (modelId.includes("seedance")) return dur * (reso === "1080p" ? 0.682 : 0.3034);
  return 0;
}

const box: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 14, background: "#fff", padding: 18 };
const lab: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 5 };
const ctl: React.CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 11px", fontSize: 13, font: "inherit", background: "#fff" };

const POLL_MS = 5000;
const MAX_POLLS = 84; // ~7 phút
const MAX_BODY = 4_200_000; // giới hạn body 4.5MB của Vercel — chặn trước ở client cho lỗi dễ hiểu

// POST JSON và LUÔN trả về lỗi đọc được: server trả HTML/timeout (không phải JSON) thì hiện "HTTP <status>: <trích đoạn>"
// thay vì "Network error" vô nghĩa.
// v628 · retryGateway: gateway (Cloudflare/Vercel) thỉnh thoảng trả trang HTML "502 Bad gateway" dù
// route vẫn khoẻ (từng dính ở nút AI script) → cho phép TỰ RETRY 1 lần sau 1.5s. CHỈ bật cho call
// không tốn phí render (script); call submit render không retry kẻo nhân đôi job mất tiền.
async function postJSON<T extends { ok?: boolean; error?: string }>(url: string, body: unknown, opts?: { retryGateway?: boolean }): Promise<T> {
  const payload = JSON.stringify(body);
  if (payload.length > MAX_BODY) throw new Error("Images too large in total (>4MB after compress) — remove an image or use smaller ones");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
    const text = await res.text();
    try { return JSON.parse(text) as T; }
    catch {
      if (opts?.retryGateway && attempt === 0 && res.status >= 500) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      throw new Error(`HTTP ${res.status}${res.status === 413 ? " (payload too large)" : res.status === 504 ? " (server timeout)" : ""}: ${text.replace(/<[^>]+>/g, " ").trim().slice(0, 120) || "empty response"}`);
    }
  }
}

export function GenVideoClient() {
  // v628 · 2 chế độ: "single" = 1 video (1 ảnh i2v / nhiều ảnh multi-scene, như cũ);
  // "clips" = MULTI-CLIP: mỗi ảnh 1 clip ~5s với prompt riêng → nối lại thành 1 video.
  const [mode, setMode] = useState<"single" | "clips">("single");
  const [segs, setSegs] = useState<Seg[]>([]);
  const [clipNotes, setClipNotes] = useState(""); // ý tưởng chung cho AI script (mode clips)
  const [clipLink, setClipLink] = useState("");
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
  // v628 · shrinkTo: bản tổng quát — AI script chỉ cần ảnh 768px (model vision không cần nét hơn),
  // gửi bản nhỏ giúp call nhanh hơn, rẻ hơn và không bao giờ vượt giới hạn body dù 6 ảnh.
  const shrinkTo = (dataUrl: string, max: number, q: number): Promise<string> => new Promise((resolve) => {
    if (!/^data:image/i.test(dataUrl)) { resolve(dataUrl); return; } // link http → model tự tải, khỏi nén
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      if (scale === 1 && dataUrl.length < (max >= 1600 ? 2_600_000 : 300_000)) { resolve(dataUrl); return; }
      try {
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        const ctx = c.getContext("2d");
        if (!ctx) { resolve(dataUrl); return; }
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", q));
      } catch { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
  const shrink = (dataUrl: string) => shrinkTo(dataUrl, 1600, 0.92);

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
  // v628: gửi bản 768px (vision không cần nét hơn — nhanh + nhẹ) và tự retry 1 lần nếu dính HTML 502 của gateway.
  const aiScript = async () => {
    if (!srcData) { setMsg("✗ Upload or paste a source image link first"); return; }
    setScripting(true); setMsg("AI is writing the script…"); setIdea("");
    try {
      const smalls = await Promise.all(srcs.map((s) => shrinkTo(s.data, 768, 0.8)));
      const r = await postJSON<{ ok?: boolean; error?: string; prompt?: string; negativePrompt?: string; duration?: string; aspectRatio?: string; idea?: string }>(
        "/api/ai-video/script", { images: smalls, notes: prompt }, { retryGateway: true });
      if (!r.ok) { setMsg("✗ " + (r.error ?? "Script failed")); setScripting(false); return; }
      setPrompt(r.prompt ?? "");
      setNegPrompt(r.negativePrompt ?? "");
      if (r.duration === "5" || r.duration === "10") setDuration(r.duration);
      if (modelInfo.aspect && ["9:16", "1:1", "16:9"].includes(String(r.aspectRatio))) setRatio(String(r.aspectRatio));
      setIdea(r.idea ?? "");
      setMsg("");
    } catch (e) { setMsg("✗ " + String((e as Error)?.message ?? "Network error — try again")); }
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
      const sub = await postJSON<{ ok?: boolean; error?: string; statusUrl?: string; responseUrl?: string }>(
        "/api/ai-video/generate",
        { image: srcData, images: srcs.map((s) => s.data), prompt, negativePrompt: negPrompt, model, duration, aspectRatio: ratio, resolution: reso });
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
    } catch (e) { setMsg("✗ " + String((e as Error)?.message ?? "Network error — try again")); }
    setBusy(false); stopTimer();
  };

  // ===================== v628 · MULTI-CLIP (mỗi ảnh 1 clip + prompt riêng → nối) =====================
  const addSeg = (data: string, name: string) => {
    setSegs((prev) => {
      if (prev.length >= MAX_SEGS) { setMsg(`✗ Max ${MAX_SEGS} clips`); return prev; }
      return [...prev, { data, name, prompt: "", dur: "5" }];
    });
    setResult(null); setMsg("");
  };
  const readFilesClips = (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) { setMsg("✗ Image files only (PNG/JPG/WebP)"); continue; }
      if (f.size > 15 * 1024 * 1024) { setMsg("✗ Image too large (>15MB)"); continue; }
      const r = new FileReader();
      r.onload = async () => addSeg(await shrink(String(r.result)), f.name);
      r.readAsDataURL(f);
    }
  };
  const useClipLink = () => {
    const u = clipLink.trim();
    if (!/^https?:\/\/\S+/i.test(u)) { setMsg("✗ Link must start with http(s)://"); return; }
    addSeg(u, u.split("/").pop() || "link"); setClipLink("");
  };
  const patchSeg = (i: number, patch: Partial<Seg>) => setSegs((prev) => prev.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  // Xoá clip giữa lúc đang render → HUỶ vòng chạy trước (index lệch sẽ ghi nhầm trạng thái sang clip khác).
  const removeSeg = (i: number) => { runId.current++; stopTimer(); setBusy(false); setSegs((prev) => prev.filter((_, k) => k !== i)); setResult(null); };

  // Chuyển chế độ: sang Multi-clip lần đầu mà đã up ảnh ở chế độ Single → mang ảnh theo luôn cho tiện.
  const switchMode = (m: "single" | "clips") => {
    if (m === mode) return;
    runId.current++; stopTimer(); setBusy(false); setMsg(""); setResult(null);
    if (m === "clips") {
      if (!segs.length && srcs.length) setSegs(srcs.slice(0, MAX_SEGS).map((s) => ({ data: s.data, name: s.name, prompt: "", dur: "5" as const })));
      if (model === MULTI_ID || !CLIP_MODELS.some((x) => x.id === model)) setModel(CLIP_MODELS[0].id);
    } else if (srcs.length > 1 && model !== MULTI_ID) {
      // quay về Single khi đang có 2+ ảnh → multi-scene bắt buộc model Multi-image
      setModel(MULTI_ID);
    }
    setMode(m);
  };

  // AI GEN KỊCH BẢN CHO TỪNG ẢNH: gửi cả bộ ảnh (bản 768px) → AI trả về MỖI ẢNH 1 prompt riêng,
  // các đoạn nối nhau thành 1 quảng cáo liền mạch (đoạn 1 hook → giữa khoe sản phẩm → cuối chốt đơn).
  const aiScriptClips = async () => {
    if (!segs.length) { setMsg("✗ Add images first — each image becomes one clip"); return; }
    setScripting(true); setMsg(`AI is writing ${segs.length} clip scripts…`); setIdea("");
    try {
      const smalls = await Promise.all(segs.map((s) => shrinkTo(s.data, 768, 0.8)));
      const r = await postJSON<{ ok?: boolean; error?: string; clips?: string[]; negativePrompt?: string; aspectRatio?: string; idea?: string }>(
        "/api/ai-video/script", { images: smalls, notes: clipNotes, mode: "clips" }, { retryGateway: true });
      if (!r.ok) { setMsg("✗ " + (r.error ?? "Script failed")); setScripting(false); return; }
      const clips = Array.isArray(r.clips) ? r.clips : [];
      setSegs((prev) => prev.map((s, i) => (clips[i] ? { ...s, prompt: clips[i], clip: undefined, stat: undefined } : s)));
      if (r.negativePrompt) setNegPrompt(r.negativePrompt);
      const mi = CLIP_MODELS.find((m) => m.id === model);
      if (mi?.aspect && ["9:16", "1:1", "16:9"].includes(String(r.aspectRatio))) setRatio(String(r.aspectRatio));
      setIdea(r.idea ?? "");
      setMsg(clips.filter(Boolean).length < segs.length ? "⚠ AI skipped some clips — write those prompts by hand or run again." : "");
    } catch (e) { setMsg("✗ " + String((e as Error)?.message ?? "Network error — try again")); }
    setScripting(false);
  };

  // Chữ ký clip: đổi ảnh/prompt/model/thời lượng… → render lại; không đổi → DÙNG LẠI clip cũ (đỡ tốn tiền).
  const segSig = (s: Seg) => [model, ratio, reso, negPrompt, s.dur, s.prompt, s.data.length, s.data.slice(0, 80)].join("|");

  const generateClips = async () => {
    if (segs.length < 2) { setMsg("✗ Need at least 2 clips — for a single image use the One video mode"); return; }
    const myId = ++runId.current;
    setBusy(true); setResult(null); startTimer();
    try {
      // 1) Submit từng clip (mỗi call 1 ảnh → không đụng giới hạn body); clip nào không đổi thì dùng lại.
      const jobs: ({ statusUrl: string; responseUrl: string } | null)[] = segs.map(() => null);
      const urls: (string | null)[] = segs.map((s) => (s.clip && s.clip.sig === segSig(s) ? s.clip.url : null));
      for (let i = 0; i < segs.length; i++) {
        if (urls[i]) { patchSeg(i, { stat: "done ✓ (reused)" }); continue; }
        setMsg(`Submitting clip ${i + 1}/${segs.length}…`);
        const s = segs[i];
        const sub = await postJSON<{ ok?: boolean; error?: string; statusUrl?: string; responseUrl?: string }>(
          "/api/ai-video/generate",
          { image: s.data, prompt: s.prompt, negativePrompt: negPrompt, model, duration: s.dur, aspectRatio: ratio, resolution: reso });
        if (myId !== runId.current) return;
        if (!sub.ok || !sub.statusUrl || !sub.responseUrl) { setMsg(`✗ Clip ${i + 1}: ` + (sub.error ?? "submit failed")); setBusy(false); stopTimer(); return; }
        jobs[i] = { statusUrl: sub.statusUrl, responseUrl: sub.responseUrl };
        patchSeg(i, { stat: "rendering…" });
      }
      // 2) Poll song song tới khi đủ clip (clip render đồng thời trên fal).
      setMsg("Rendering clips… each takes 1–4 min (they render in parallel).");
      for (let t = 0; t < MAX_POLLS && urls.some((u) => !u); t++) {
        await new Promise((res) => setTimeout(res, POLL_MS));
        if (myId !== runId.current) return;
        for (let i = 0; i < segs.length; i++) {
          if (urls[i] || !jobs[i]) continue;
          let st: { ok?: boolean; done?: boolean; url?: string; error?: string };
          try {
            st = await fetch("/api/ai-video/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(jobs[i]) }).then((r) => r.json());
          } catch { continue; }
          if (myId !== runId.current) return;
          if (!st.ok) { setMsg(`✗ Clip ${i + 1}: ` + (st.error ?? "render failed") + " — finished clips are kept, fix & run again."); patchSeg(i, { stat: "✗ failed" }); setBusy(false); stopTimer(); return; }
          if (st.done && st.url) {
            urls[i] = st.url;
            patchSeg(i, { stat: "done ✓", clip: { url: st.url, sig: segSig(segs[i]) } });
            setMsg(`Rendering clips… ${urls.filter(Boolean).length}/${segs.length} done.`);
          }
        }
      }
      if (urls.some((u) => !u)) { setMsg("✗ Timed out (>7 min) waiting for clips. Run again — finished clips are kept."); setBusy(false); stopTimer(); return; }
      // 3) Nối các clip theo thứ tự (fal ffmpeg merge) rồi poll chính /status như 1 job thường.
      setMsg(`Stitching ${segs.length} clips into one video…`);
      const mg = await postJSON<{ ok?: boolean; error?: string; statusUrl?: string; responseUrl?: string }>("/api/ai-video/stitch", { urls: urls as string[] });
      if (myId !== runId.current) return;
      if (!mg.ok || !mg.statusUrl || !mg.responseUrl) { setMsg("✗ Stitch: " + (mg.error ?? "submit failed")); setBusy(false); stopTimer(); return; }
      for (let t = 0; t < 60; t++) {
        await new Promise((res) => setTimeout(res, POLL_MS));
        if (myId !== runId.current) return;
        let st: { ok?: boolean; done?: boolean; url?: string; error?: string };
        try {
          st = await fetch("/api/ai-video/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ statusUrl: mg.statusUrl, responseUrl: mg.responseUrl }) }).then((r) => r.json());
        } catch { continue; }
        if (myId !== runId.current) return;
        if (!st.ok) { setMsg("✗ Stitch: " + (st.error ?? "failed")); setBusy(false); stopTimer(); return; }
        if (st.done && st.url) { setResult({ url: st.url }); setMsg(""); setBusy(false); stopTimer(); return; }
      }
      setMsg("✗ Stitch timed out (>5 min). Run again — clips are kept, only the merge reruns.");
    } catch (e) { setMsg("✗ " + String((e as Error)?.message ?? "Network error — try again")); }
    setBusy(false); stopTimer();
  };

  const clipsEst = segs.reduce((t, s) => t + estClip(model, Number(s.dur), reso), 0);
  const singleEst = estClip(model, Number(duration), reso);

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "18px 16px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Gen Video</h1>
        <span style={{ fontSize: 11, fontWeight: 700, background: "#EEE9FB", color: "#6D48C9", borderRadius: 999, padding: "3px 10px" }}>AI Agent · beta</span>
      </div>
      {/* v628 · chọn chế độ: 1 video (như cũ) / multi-clip ghép nối */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        {([["single", "One video"], ["clips", "Multi-clip (stitch)"]] as const).map(([m, label]) => (
          <button key={m} onClick={() => switchMode(m)}
            style={{ border: mode === m ? "1.5px solid #6D48C9" : "1px solid var(--line)", background: mode === m ? "#F3EEFF" : "#fff", color: mode === m ? "#6D48C9" : "var(--muted)", borderRadius: 999, padding: "5px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8, marginBottom: 16 }}>
        {mode === "single"
          ? "Image → Video: turn a design/photo into a short animated clip (several images = one multi-scene video)."
          : `Each image becomes its OWN ~5s clip with its own prompt — clips are then stitched, in order, into one video (up to ${MAX_SEGS} clips).`}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Nguồn + tuỳ chọn */}
        <div style={box}>
          {mode === "single" && (<>
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
          </>)}
          {/* input file DÙNG CHUNG cho cả 2 chế độ — onChange rẽ theo mode */}
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { if (e.target.files?.length) (mode === "clips" ? readFilesClips : readFiles)(e.target.files); e.target.value = ""; }} />
          {mode === "single" && (<>
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
          {singleEst > 0 && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6, textAlign: "center" }}>Estimated cost: ~${singleEst.toFixed(2)} per video (fal pricing, approximate)</div>}
          </>)}

          {/* ===================== v628 · MULTI-CLIP UI ===================== */}
          {mode === "clips" && (<>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Clips ({segs.length}/{MAX_SEGS}) — 1 image = 1 clip</div>
            <div style={{ display: "flex", gap: 6 }}>
              {segs.length < MAX_SEGS && (
                <button onClick={() => fileRef.current?.click()} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "3px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", color: "var(--blue)" }}>+ Add images</button>
              )}
              {segs.length > 0 && (
                <button onClick={() => { setSegs([]); setResult(null); setIdea(""); }} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "3px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", color: "var(--red)" }}>Remove all</button>
              )}
            </div>
          </div>
          {segs.length === 0 && (
            <div onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) readFilesClips(e.dataTransfer.files); }}
              style={{ border: "2px dashed var(--line)", borderRadius: 12, minHeight: 170, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: "#FAFBFD" }}>
              <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 12.5, padding: 20 }}>
                <div style={{ fontSize: 30, marginBottom: 6 }}>＋</div>
                Drop 2–{MAX_SEGS} images — each becomes its own ~5s clip, stitched in this order
              </div>
            </div>
          )}
          {segs.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 10, border: "1px solid var(--line)", borderRadius: 12, padding: 10, marginBottom: 8, background: "#FAFBFD" }}>
              <div style={{ position: "relative", flexShrink: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.data} alt="" style={{ width: 86, height: 86, objectFit: "cover", borderRadius: 8, display: "block", border: "1px solid var(--line)", background: "#fff" }} />
                <span style={{ position: "absolute", top: 4, left: 4, background: "#6D48C9", color: "#fff", fontSize: 10, fontWeight: 800, borderRadius: 6, padding: "1px 6px" }}>Clip {i + 1}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Sửa prompt/thời lượng → clip cache bị huỷ (sig đổi) → clip đó render lại, clip khác giữ nguyên */}
                <textarea value={s.prompt} onChange={(e) => patchSeg(i, { prompt: e.target.value, clip: undefined, stat: undefined })} rows={2}
                  placeholder={`Motion prompt for clip ${i + 1} — or press "AI script per clip"`}
                  style={{ ...ctl, resize: "vertical", fontSize: 12.5 }} />
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
                  <select value={s.dur} onChange={(e) => patchSeg(i, { dur: e.target.value === "10" ? "10" : "5", clip: undefined, stat: undefined })}
                    style={{ ...ctl, width: 66, padding: "4px 6px", fontSize: 12 }}>
                    <option value="5">5s</option>
                    <option value="10">10s</option>
                  </select>
                  {s.stat && <span style={{ fontSize: 11, fontWeight: 700, color: s.stat.startsWith("✗") ? "var(--red)" : s.stat.startsWith("done") ? "#1D9A5B" : "#6D48C9" }}>{s.stat}</span>}
                  <button onClick={() => removeSeg(i)} title="Remove this clip"
                    style={{ marginLeft: "auto", border: "1px solid var(--line)", background: "#fff", color: "var(--red)", borderRadius: 8, padding: "2px 9px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>×</button>
                </div>
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <input value={clipLink} onChange={(e) => setClipLink(e.target.value)} placeholder="…or paste an image link (http/https)" style={{ ...ctl, flex: 1 }} onKeyDown={(e) => e.key === "Enter" && useClipLink()} />
            <button onClick={useClipLink} style={{ border: "1px solid var(--line)", background: "#F3F6FB", borderRadius: 10, padding: "0 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: "var(--ink)" }}>Use link</button>
          </div>

          {/* Ý tưởng chung + AI VIẾT KỊCH BẢN CHO TỪNG CLIP */}
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
              <label style={{ ...lab, marginBottom: 0 }}>Ad idea (optional)</label>
              <button type="button" onClick={aiScriptClips} disabled={scripting || busy || !segs.length}
                title="AI looks at ALL the images and writes one script PER clip — fills every clip's prompt and the negative prompt"
                style={{ border: "none", background: scripting || !segs.length ? "#B9A8E8" : "#6D48C9", color: "#fff", borderRadius: 8, padding: "4px 12px", fontSize: 11.5, fontWeight: 800, cursor: scripting || !segs.length ? "default" : "pointer" }}>
                {scripting ? "Writing…" : "AI script per clip"}
              </button>
            </div>
            <input value={clipNotes} onChange={(e) => setClipNotes(e.target.value)}
              placeholder={'One short idea for the whole ad, e.g. "cozy bedtime vibe" — AI writes each clip\'s script from it'} style={ctl} />
            {idea && <div style={{ fontSize: 11, color: "#6D48C9", marginTop: 5, fontWeight: 600 }}>Ad concept: {idea}</div>}
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={lab}>Negative prompt (all clips)</label>
            <textarea value={negPrompt} onChange={(e) => setNegPrompt(e.target.value)} rows={2} placeholder={NEG_DEFAULT} style={{ ...ctl, resize: "vertical" }} />
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={lab}>Model AI (all clips)</label>
            <select value={model} onChange={(e) => setModel(e.target.value)} style={ctl}>
              {CLIP_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 5 }}>{modelInfo.note}</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: modelInfo.res ? "1fr 1fr" : "1fr", gap: 8, marginTop: 12 }}>
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

          {segs.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--ink)", background: "#F3F6FB", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 11px" }}>
              Estimated cost: <b>~${(clipsEst + 0.02).toFixed(2)}</b> — {segs.length} clip{segs.length === 1 ? "" : "s"} ({segs.reduce((t, s) => t + Number(s.dur), 0)}s total) + stitch ~$0.02. fal pricing, approximate.
            </div>
          )}

          <button onClick={generateClips} disabled={busy || segs.length < 2}
            style={{ marginTop: 12, width: "100%", background: busy || segs.length < 2 ? "#9CB2D8" : "var(--blue)", color: "#fff", border: "none", borderRadius: 11, padding: "11px 0", fontSize: 14, fontWeight: 800, cursor: busy || segs.length < 2 ? "default" : "pointer" }}>
            {busy ? `Working… ${elapsed}s` : `Generate ${segs.length || ""} clips & stitch`}
          </button>
          {model.includes("seedance") && segs.length > 0 && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
              Seedance adds audio PER clip — the stitched sound will cut between segments. For one continuous music track, add it afterwards (CapCut…).
            </div>
          )}
          </>)}

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
