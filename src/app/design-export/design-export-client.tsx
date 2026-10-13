"use client";
import { useRef, useState } from "react";

/**
 * v649 · DOWNLOAD ALL DESIGNS of one seller — straight into a folder on this computer.
 * Flow: type seller name → Load → Choose folder & download (Chrome/Edge File System Access API).
 * Files stream same-origin through /api/files/<storageKey> (authed) → no R2 CORS setup needed.
 * Folder layout: <picked folder>/<SKU>-<design title>/<kind>-<original filename>.
 * Re-running SKIPS files that already exist → safe to resume after any interruption.
 */
type F = { sku: number; title: string; kind: string; filename: string; sizeMb: number; key: string };

const inp: React.CSSProperties = { padding: "10px 13px", border: "1px solid var(--line)", borderRadius: 11, fontSize: 13.5, font: "inherit", background: "#fff", outline: "none" };
const btn = (bg: string): React.CSSProperties => ({ border: "none", background: bg, color: "#fff", borderRadius: 12, padding: "10px 18px", fontSize: 13, fontWeight: 800, cursor: "pointer" });
const san = (s: string, max = 60) => s.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim() || "untitled";

export default function DesignExportClient() {
  const [who, setWho] = useState("");
  const [by, setBy] = useState<"seller" | "designer">("seller");
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<{ name: string; count: number; totalMb: number; files: F[] } | null>(null);
  const [run, setRun] = useState<{ done: number; skip: number; fail: number; total: number; cur: string; finished: boolean } | null>(null);
  const [errs, setErrs] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const stopRef = useRef(false);

  const canFS = typeof window !== "undefined" && "showDirectoryPicker" in window;

  async function load() {
    if (!who.trim()) { setMsg("✗ Enter a seller name first"); return; }
    setLoading(true); setInfo(null); setRun(null); setErrs([]); setMsg("");
    const j = await fetch(`/api/designs/export-links?seller=${encodeURIComponent(who.trim())}&format=json${by === "designer" ? "&by=designer" : ""}`)
      .then((r) => r.json()).catch(() => ({ ok: false, error: "network" }));
    setLoading(false);
    if (!j.ok) { setMsg("✗ " + (j.error ?? "error")); return; }
    setInfo({ name: j.user.name, count: j.count, totalMb: j.totalMb, files: j.files });
    if (!j.count) setMsg("This user has no design files.");
  }

  async function download() {
    if (!info?.files.length) return;
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await (window as unknown as { showDirectoryPicker: (o?: { mode?: string }) => Promise<FileSystemDirectoryHandle> })
        .showDirectoryPicker({ mode: "readwrite" });
    } catch { return; } // user bấm Cancel
    stopRef.current = false;
    setErrs([]);
    const st = { done: 0, skip: 0, fail: 0, total: info.files.length, cur: "", finished: false };
    setRun({ ...st });
    for (const f of info.files) {
      if (stopRef.current) break;
      const folder = `${f.sku}-${san(f.title)}`;
      const name = san(`${f.kind}-${f.filename || f.key.split("/").pop() || "file"}`, 120);
      st.cur = `${folder}/${name}`;
      setRun({ ...st });
      try {
        const d = await dir.getDirectoryHandle(folder, { create: true });
        // Đã có file → bỏ qua (resume an toàn)
        let exists = false;
        try { await d.getFileHandle(name); exists = true; } catch { /* chưa có */ }
        if (exists) { st.skip++; setRun({ ...st }); continue; }
        const res = await fetch(`/api/files/${f.key}`);
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const fh = await d.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await res.body.pipeTo(w); // pipeTo tự close writable
        st.done++;
      } catch (e) {
        st.fail++;
        setErrs((p) => p.length < 30 ? [...p, `${st.cur}: ${String((e as Error)?.message ?? e).slice(0, 120)}`] : p);
      }
      setRun({ ...st });
    }
    st.finished = true; st.cur = "";
    setRun({ ...st });
  }

  const pct = run && run.total ? Math.round(((run.done + run.skip + run.fail) / run.total) * 100) : 0;

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 760 }}>
      <div className="panel" style={{ padding: "16px 18px" }}>
        <b style={{ fontSize: 18 }}>Download all designs</b>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>
          Pull every design file of one seller straight into a folder on this computer. Re-run anytime — files already downloaded are skipped.
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <input value={who} onChange={(e) => setWho(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder="Seller name… (e.g. Quang Trường)" style={{ ...inp, flex: 1, minWidth: 220 }} />
          <select value={by} onChange={(e) => setBy(e.target.value as "seller" | "designer")} style={inp}>
            <option value="seller">By seller</option>
            <option value="designer">By designer</option>
          </select>
          <button onClick={load} disabled={loading} style={btn("var(--blue)")}>{loading ? "Loading…" : "Load files"}</button>
        </div>
        {msg && <div style={{ marginTop: 10, fontSize: 13, fontWeight: 700 }}>{msg}</div>}
      </div>

      {info && info.count > 0 && (
        <div className="panel" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 14 }}>
            <b>{info.name}</b> · {info.count.toLocaleString()} files · ≈{(info.totalMb / 1024).toFixed(2)} GB
          </div>
          {!canFS && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: "#B3261E", lineHeight: 1.5 }}>
              This browser can&apos;t write to a folder directly — use <b>Chrome or Edge</b>, or download the
              {" "}<a href={`/api/designs/export-links?seller=${encodeURIComponent(who.trim())}${by === "designer" ? "&by=designer" : ""}`} style={{ fontWeight: 700 }}>CSV link list</a> and run download-designs.ps1.
            </div>
          )}
          {canFS && !run && (
            <button onClick={download} style={{ ...btn("#1E7A3E"), marginTop: 12 }}>⬇ Choose folder &amp; download</button>
          )}
          {run && (
            <div style={{ marginTop: 12 }}>
              <div style={{ height: 10, background: "#EEF1F6", borderRadius: 99, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: run.fail ? "#C9760F" : "var(--green)", transition: "width .2s" }} />
              </div>
              <div style={{ fontSize: 12.5, marginTop: 7, color: "var(--muted)" }}>
                {run.finished
                  ? <b style={{ color: "var(--ink)" }}>✓ Done — {run.done} downloaded · {run.skip} already existed · {run.fail} failed{run.fail ? " (run again to retry)" : ""}</b>
                  : <>{pct}% · {run.done} downloaded · {run.skip} skipped · {run.fail} failed<br /><span style={{ fontFamily: "monospace", fontSize: 11 }}>{run.cur}</span></>}
              </div>
              {!run.finished && <button onClick={() => { stopRef.current = true; }} style={{ ...btn("#B3261E"), marginTop: 10, padding: "7px 14px" }}>Stop</button>}
              {run.finished && <button onClick={download} style={{ ...btn("#1E7A3E"), marginTop: 10, padding: "7px 14px" }}>⬇ Download again (resume)</button>}
            </div>
          )}
          {errs.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 11.5, color: "#B3261E", fontFamily: "monospace", lineHeight: 1.6, maxHeight: 160, overflow: "auto" }}>
              {errs.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
