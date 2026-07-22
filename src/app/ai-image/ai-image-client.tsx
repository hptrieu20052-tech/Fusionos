"use client";
import { useRef, useState } from "react";

type Mode = "clone" | "bgremove" | "redesign";
const TABS: { key: Mode; label: string; desc: string; icon: string }[] = [
  { key: "clone", label: "Clone", desc: "Chép lại ảnh gần như y hệt — tái tạo design sắc nét, giữ nguyên bố cục / màu / chữ.", icon: "M8 4h10a2 2 0 0 1 2 2v10M16 8H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2Z" },
  { key: "bgremove", label: "Tách nền", desc: "Xoá nền → xuất PNG nền trong suốt, giữ chủ thể với viền sạch.", icon: "M3 3h7v7H3zM14 14h7v7h-7zM14 3h7v7h-7zM3 14h7v7H3z" },
  { key: "redesign", label: "Redesign", desc: "Thiết kế lại theo yêu cầu bạn nhập, giữ chất lượng in.", icon: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" },
];

const box: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 14, background: "#fff", padding: 18 };

export function GenImageClient() {
  const [mode, setMode] = useState<Mode>("clone");
  const [srcData, setSrcData] = useState<string>("");   // dataURL ảnh nguồn
  const [srcName, setSrcName] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<{ url: string | null; dataUrl: string; cost: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const readFile = (f: File) => {
    if (!f.type.startsWith("image/")) { setMsg("✗ Chỉ nhận file ảnh (PNG/JPG/WebP)"); return; }
    if (f.size > 15 * 1024 * 1024) { setMsg("✗ Ảnh quá lớn (>15MB)"); return; }
    const r = new FileReader();
    r.onload = () => { setSrcData(String(r.result)); setSrcName(f.name); setResult(null); setMsg(""); };
    r.readAsDataURL(f);
  };

  const tab = TABS.find((t) => t.key === mode)!;

  const generate = async () => {
    if (!srcData) { setMsg("✗ Tải lên 1 ảnh nguồn trước"); return; }
    if (mode === "redesign" && !prompt.trim()) { setMsg("✗ Nhập yêu cầu thiết kế lại"); return; }
    setBusy(true); setMsg("Đang xử lý… (10–40s)"); setResult(null);
    try {
      const j = await fetch("/api/ai-image/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, image: srcData, prompt }),
      }).then((r) => r.json());
      if (j.ok) { setResult({ url: j.url, dataUrl: j.dataUrl, cost: j.cost ?? 0 }); setMsg(""); }
      else setMsg("✗ " + (j.error ?? "Lỗi"));
    } catch { setMsg("✗ Lỗi mạng — thử lại"); }
    setBusy(false);
  };

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "18px 16px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Gen Image</h1>
        <span style={{ fontSize: 11, fontWeight: 700, background: "#EEE9FB", color: "#6D48C9", borderRadius: 999, padding: "3px 10px" }}>AI Agent · beta</span>
      </div>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>Xử lý ảnh design bằng AI (Gemini Flash Image).</div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map((tb) => (
          <button key={tb.key} onClick={() => { setMode(tb.key); setResult(null); setMsg(""); }}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, border: `1.5px solid ${mode === tb.key ? "var(--blue)" : "var(--line)"}`, background: mode === tb.key ? "var(--blue-soft)" : "#fff", color: mode === tb.key ? "var(--blue)" : "var(--ink)", borderRadius: 11, padding: "9px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={tb.icon} /></svg>
            {tb.label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14 }}>{tab.desc}</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Nguồn */}
        <div style={box}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Ảnh nguồn</div>
          <div onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) readFile(f); }}
            style={{ border: "2px dashed var(--line)", borderRadius: 12, minHeight: 280, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: "#FAFBFD", overflow: "hidden", position: "relative" }}>
            {srcData
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={srcData} alt="" style={{ maxWidth: "100%", maxHeight: 340, objectFit: "contain" }} />
              : <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 12.5, padding: 20 }}>
                  <div style={{ fontSize: 30, marginBottom: 6 }}>＋</div>
                  Kéo-thả hoặc bấm để chọn ảnh<br />PNG / JPG / WebP · ≤ 15MB
                </div>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ""; }} />
          {srcName && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{srcName}</div>}

          {mode === "redesign" && (
            <div style={{ marginTop: 12 }}>
              <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginBottom: 5 }}>Yêu cầu thiết kế lại</label>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3}
                placeholder="Vd: đổi tông màu sang pastel, thêm hoa lá quanh chữ, giữ nguyên tên…"
                style={{ width: "100%", boxSizing: "border-box", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 11px", fontSize: 13, font: "inherit", resize: "vertical" }} />
            </div>
          )}

          <button onClick={generate} disabled={busy}
            style={{ marginTop: 14, width: "100%", background: busy ? "#9CB2D8" : "var(--blue)", color: "#fff", border: "none", borderRadius: 11, padding: "11px 0", fontSize: 14, fontWeight: 800, cursor: busy ? "default" : "pointer" }}>
            {busy ? "Đang xử lý…" : `Chạy ${tab.label}`}
          </button>
          {msg && <div style={{ marginTop: 10, fontSize: 12.5, color: msg.startsWith("✗") ? "var(--red)" : "var(--muted)" }}>{msg}</div>}
        </div>

        {/* Kết quả */}
        <div style={box}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Kết quả</div>
          <div style={{ borderRadius: 12, minHeight: 280, display: "flex", alignItems: "center", justifyContent: "center", background: result ? "repeating-conic-gradient(#EDF0F4 0% 25%, #fff 0% 50%) 50%/20px 20px" : "#FAFBFD", border: "1px solid var(--line)", overflow: "hidden" }}>
            {result
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={result.dataUrl} alt="" style={{ maxWidth: "100%", maxHeight: 340, objectFit: "contain" }} />
              : <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{busy ? "AI đang vẽ…" : "Kết quả sẽ hiện ở đây"}</div>}
          </div>
          {result && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
              <a href={result.url ?? result.dataUrl} download={`genimage-${mode}.png`} target="_blank" rel="noreferrer"
                style={{ flex: 1, textAlign: "center", background: "var(--ink)", color: "#fff", borderRadius: 11, padding: "10px 0", fontSize: 13, fontWeight: 800, textDecoration: "none" }}>
                ⬇ Tải PNG
              </a>
              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>~${(result.cost || 0).toFixed(3)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
