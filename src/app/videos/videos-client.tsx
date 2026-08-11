"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useConfirm } from "@/components/confirm-provider";
import DateRangePicker, { rangeToDates, type RangeValue } from "@/components/date-range";

/**
 * v209b · Video Library — cùng khuôn Design Studio.
 * KHÔNG có bước duyệt: seller và creator tự làm việc với nhau, sửa clip rồi update lại.
 * File bay thẳng browser → R2 (presigned) nên clip 50–100MB vẫn upload được.
 * Mỗi listing gắn ĐÚNG 1 video; một video dùng lại cho nhiều listing (gán theo Product type).
 */

type Caption = { text: string; hashtags: string[] };
type Flags = { voice?: boolean; text?: boolean; music?: boolean };
type Row = {
  id: string; videoCode: number; title: string; note: string | null;
  storageKey: string; publicUrl: string | null; thumbUrl: string | null;
  contentType: string | null; sizeBytes: number | null; durationSec: string | null;
  width: number | null; height: number | null; aspect: string | null;
  language: string | null; flags: Flags | null; revision: number;
  sourceName: string | null; shotAt: string | null;
  productId: string | null; productTitle: string | null;
  storeId: string | null; storeName: string | null;
  sellerId: string | null; sellerName: string | null;
  creatorId: string | null; creatorName: string | null; uploader: string | null;
  captions: Record<string, Caption> | null; captionsAt: string | null;
  usedBy: number; usedPushed: number;
  createdAt: string; canEdit: boolean;
};
type Opt = { id: string; name: string | null };
type TypeOpt = { productType: string | null; n: number; withVideo: number };
type Listing = { id: string; title: string; productType: string | null; pushedAt: string | null };

const LANGS = [{ v: "none", label: "No voice" }, { v: "en", label: "English" }, { v: "vi", label: "Tiếng Việt" }];
const CHANNELS = [
  { key: "tiktok", label: "TikTok" }, { key: "reels", label: "IG Reels" }, { key: "shorts", label: "YT Shorts" },
  { key: "facebook", label: "Facebook" }, { key: "pinterest", label: "Pinterest" },
] as const;

const chip = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-block", background: bg, color: fg, borderRadius: 999, padding: "2px 9px", fontSize: 11, fontWeight: 800 });
const pgBtn: React.CSSProperties = { minWidth: 34, height: 34, borderRadius: 9, border: "1px solid var(--line)", background: "#fff", cursor: "pointer", fontSize: 13 };
const mb = (n: number | null) => n == null ? "—" : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
const secs = (s: string | null) => { const n = Number(s); return isFinite(n) && n > 0 ? `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, "0")}` : "—"; };
const LIMIT = 24;

export default function VideosClient({ isAdmin, canManage, me }: { isAdmin: boolean; canManage: boolean; me: { id: string; name: string } }) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [dr, setDr] = useState<RangeValue>({ range: "30d" });
  const [q, setQ] = useState("");
  const [sellerId, setSellerId] = useState("");
  const [creatorId, setCreatorId] = useState("");
  const [sellers, setSellers] = useState<Opt[]>([]);
  const [creators, setCreators] = useState<Opt[]>([]);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<{ name: string; pct: number } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  const flash = (text: string, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 6000); };

  const load = useCallback(async (pageN: number) => {
    setLoading(true);
    const { from, to } = rangeToDates(dr);
    const p = new URLSearchParams({ from, to, page: String(pageN), limit: String(LIMIT) });
    if (q.trim()) p.set("q", q.trim());
    if (sellerId) p.set("sellerId", sellerId);
    if (creatorId) p.set("creatorId", creatorId);
    try {
      const j = await fetch(`/api/videos?${p}`).then((r) => r.json());
      if (j.ok) {
        setRows(j.rows ?? []); setTotal(j.total ?? 0);
        setSellers(j.filters?.sellers ?? []); setCreators(j.filters?.creators ?? []);
      } else flash("✗ " + (j.error ?? "load failed"), false);
    } catch { flash("✗ Network error", false); }
    setLoading(false);
  }, [dr, q, sellerId, creatorId]);

  useEffect(() => { const t = setTimeout(() => { setPage(1); load(1); }, q ? 350 : 0); return () => clearTimeout(t); }, [load, q]);
  const goPage = (n: number) => {
    const pages = Math.max(Math.ceil(total / LIMIT), 1);
    const p2 = Math.min(Math.max(1, n), pages);
    setPage(p2); load(p2);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /** Đọc thời lượng/kích thước + bắt 1 frame làm poster, ngay ở browser. */
  const probe = (file: File): Promise<{ duration: number; width: number; height: number; poster: Blob | null }> =>
    new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const vid = document.createElement("video");
      vid.preload = "metadata"; vid.muted = true; vid.playsInline = true; vid.src = url;
      const done = (poster: Blob | null) => {
        const out = { duration: vid.duration || 0, width: vid.videoWidth || 0, height: vid.videoHeight || 0, poster };
        URL.revokeObjectURL(url); resolve(out);
      };
      const fail = () => done(null);
      vid.onerror = fail;
      vid.onloadedmetadata = () => { vid.currentTime = Math.min(1, (vid.duration || 1) / 2); };
      vid.onseeked = () => {
        try {
          const c = document.createElement("canvas");
          c.width = vid.videoWidth; c.height = vid.videoHeight;
          const ctx = c.getContext("2d");
          if (!ctx || !c.width) return fail();
          ctx.drawImage(vid, 0, 0, c.width, c.height);
          c.toBlob((bl) => done(bl), "image/jpeg", 0.75);
        } catch { fail(); }
      };
      setTimeout(fail, 15000);
    });

  const putToR2 = async (blob: Blob, filename: string, contentType: string, kind: "video" | "thumb") => {
    const j = await fetch("/api/videos/upload-url", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, contentType, kind }),
    }).then((r) => r.json());
    if (!j?.ok) throw new Error(j?.error ?? "upload-url failed");
    let put: Response;
    try {
      put = await fetch(String(j.url), { method: String(j.method || "PUT"), headers: { "Content-Type": contentType }, body: blob });
    } catch {
      throw new Error("PUT → R2 blocked (CORS). Cloudflare R2 → bucket → Settings → CORS Policy → allow PUT from this domain.");
    }
    if (!put.ok) throw new Error(`upload failed (HTTP ${put.status})`);
    return { key: String(j.key), publicUrl: String(j.publicUrl) };
  };

  const onPick = async (files: FileList | File[] | null, who: { sellerId: string; creatorId: string }) => {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    setBusy(true);
    let ok = 0;
    for (const file of list) {
      if (!/^video\//i.test(file.type)) { flash(`✗ ${file.name} is not a video`, false); continue; }
      try {
        setProg({ name: file.name, pct: 5 });
        const meta = await probe(file);
        setProg({ name: file.name, pct: 15 });
        const up = await putToR2(file, file.name, file.type || "video/mp4", "video");
        setProg({ name: file.name, pct: 75 });
        let thumbKey: string | null = null, thumbUrl: string | null = null;
        if (meta.poster) {
          try {
            const t = await putToR2(meta.poster, file.name.replace(/\.[^.]+$/, "") + "-poster.jpg", "image/jpeg", "thumb");
            thumbKey = t.key; thumbUrl = t.publicUrl;
          } catch { /* thiếu poster không chặn gì */ }
        }
        setProg({ name: file.name, pct: 92 });
        const j = await fetch("/api/videos", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: file.name.replace(/\.[^.]+$/, "").slice(0, 200),
            storageKey: up.key, publicUrl: up.publicUrl, thumbKey, thumbUrl,
            contentType: file.type || "video/mp4", sizeBytes: file.size,
            durationSec: meta.duration || null, width: meta.width || null, height: meta.height || null,
            sellerId: who.sellerId,
            ...(who.creatorId ? { creatorId: who.creatorId } : {}),
          }),
        }).then((r) => r.json());
        if (!j?.ok) throw new Error(j?.error ?? "save failed");
        ok++;
      } catch (e) { flash(`✗ ${file.name}: ${String((e as Error)?.message ?? e)}`, false); }
    }
    setProg(null); setBusy(false);
    if (ok) flash(`✓ Uploaded ${ok} video${ok > 1 ? "s" : ""}`);
    load(page);
  };

  const patch = async (body: Record<string, unknown>, okText?: string) => {
    setBusy(true);
    try {
      const j = await fetch("/api/videos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
      if (j.ok) { if (okText) flash("✓ " + okText); await load(page); }
      else flash("✗ " + (j.error ?? "failed"), false);
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };

  /** Thay file cho video ĐÃ CÓ — giữ nguyên #ID, listing đã gán và caption. */
  const doReplace = async (row: Row, file: File) => {
    if (!/^video\//i.test(file.type)) return flash("✗ Not a video file", false);
    setBusy(true);
    try {
      setProg({ name: file.name, pct: 10 });
      const meta = await probe(file);
      const up = await putToR2(file, file.name, file.type || "video/mp4", "video");
      setProg({ name: file.name, pct: 80 });
      let thumbKey: string | null = null, thumbUrl: string | null = null;
      if (meta.poster) {
        try {
          const t = await putToR2(meta.poster, file.name.replace(/\.[^.]+$/, "") + "-poster.jpg", "image/jpeg", "thumb");
          thumbKey = t.key; thumbUrl = t.publicUrl;
        } catch { /* thiếu poster không chặn */ }
      }
      const j = await fetch("/api/videos", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id, storageKey: up.key, publicUrl: up.publicUrl, thumbKey, thumbUrl,
          contentType: file.type || "video/mp4", sizeBytes: file.size,
          durationSec: meta.duration || null, width: meta.width || null, height: meta.height || null,
        }),
      }).then((r) => r.json());
      if (!j?.ok) throw new Error(j?.error ?? "replace failed");
      flash("✓ File replaced — push to Shopify again to publish the new cut");
      await load(page);
    } catch (e) { flash("✗ " + String((e as Error)?.message ?? e), false); }
    setProg(null); setBusy(false);
  };

  const openRow = rows.find((r) => r.id === open) ?? null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <h2 style={{ fontWeight: 800, fontSize: 19, margin: 0 }}>Video Library</h2>
        <div style={{ flex: 1 }} />
        <DateRangePicker value={dr} onChange={setDr} align="right" />
        {canManage && <button disabled={busy} onClick={() => setShowUpload(true)} className="btn btn-primary">Bulk upload +</button>}
      </div>

      <div className="card" style={{ padding: "16px 18px", marginBottom: 14 }}>
        <div className="filters">
          <div className="field" style={{ gridColumn: "span 2" }}>
            <label>Search</label>
            <input placeholder="Video name, or ID (e.g. 29)…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="field">
            <label>Seller</label>
            <select value={sellerId} onChange={(e) => { setSellerId(e.target.value); setPage(1); }}>
              <option value="">All</option>
              {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Creator</label>
            <select value={creatorId} onChange={(e) => { setCreatorId(e.target.value); setPage(1); }}>
              <option value="">All</option>
              {creators.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {prog && (
        <div className="card" style={{ padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Uploading {prog.name}…</div>
          <div style={{ height: 6, background: "#EEF1F5", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${prog.pct}%`, background: "var(--blue)", transition: "width .3s" }} />
          </div>
        </div>
      )}

      {msg && (
        <div className="card" style={{ padding: "11px 14px", marginBottom: 12, fontSize: 13, fontWeight: 600, background: msg.ok ? "#E9F7EF" : "#FEE4E2", color: msg.ok ? "#1F6F45" : "#B42318", border: "none" }}>
          {msg.text}
        </div>
      )}

      <Pager page={page} total={total} show={LIMIT} setPage={goPage} label="videos" />

      {loading ? (
        <div className="panel empty" style={{ marginTop: 14 }}>Loading…</div>
      ) : !rows.length ? (
        <div className="panel empty" style={{ marginTop: 14 }}>No videos</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(248px,1fr))", gap: 18, marginTop: 14 }}>
          {rows.map((r) => (
            <div key={r.id} className="card" onClick={() => setOpen(r.id)} style={{ overflow: "hidden", cursor: "pointer", display: "flex", flexDirection: "column" }}>
              <div style={{ position: "relative", aspectRatio: "4/5", background: "#0B1220", overflow: "hidden" }}>
                {r.thumbUrl
                  ? <img src={r.thumbUrl} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 12, fontWeight: 700 }}>NO PREVIEW</div>}
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                  <span style={{ width: 42, height: 42, borderRadius: 999, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z" /></svg>
                  </span>
                </div>
                <span style={{ position: "absolute", top: 8, left: 8, ...chip("rgba(255,255,255,.93)", "#0B1220") }}>#{r.videoCode}</span>
                <div style={{ position: "absolute", bottom: 8, left: 8, right: 8, display: "flex", gap: 5, alignItems: "center" }}>
                  <span style={chip("rgba(0,0,0,.62)", "#fff")}>{secs(r.durationSec)}</span>
                  {r.aspect && <span style={chip("rgba(0,0,0,.62)", "#fff")}>{r.aspect}</span>}
                  <span style={{ flex: 1 }} />
                  <span style={chip("rgba(0,0,0,.62)", "#fff")}>{mb(r.sizeBytes)}</span>
                </div>
              </div>
              <div style={{ padding: "10px 12px", display: "grid", gap: 6, flex: 1, alignContent: "start" }}>
                <div title={r.title} style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {r.title}
                </div>
                <div style={{ fontSize: 11.5 }}>
                  {r.usedBy > 0
                    ? <span style={{ color: "var(--green)", fontWeight: 700 }}>▣ {r.usedBy} listing{r.usedBy > 1 ? "s" : ""}{r.usedPushed ? ` · ${r.usedPushed} on Shopify` : ""}</span>
                    : <span style={{ color: "var(--muted)" }}>Not on any listing</span>}
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {r.language && r.language !== "none" && <span style={chip("#F3F4F6", "#374151")}>{r.language.toUpperCase()}</span>}
                  {r.flags?.voice && <span style={chip("#F3F4F6", "#374151")}>VOICE</span>}
                  {r.flags?.text && <span style={chip("#FEF6E7", "#B7791F")}>TEXT ON SCREEN</span>}
                  {r.flags?.music && <span style={chip("#F3F4F6", "#374151")}>MUSIC</span>}
                  {r.captionsAt && <span style={chip("#EEF2FF", "#4338CA")}>CAPTIONS</span>}
                  {r.revision > 1 && <span style={chip("#FEF6E7", "#B7791F")}>v{r.revision}</span>}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    Seller: <b style={{ color: "var(--ink)" }}>{r.sellerName ?? "—"}</b>
                  </div>
                  <div style={{ display: "flex", gap: 5 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.sourceName || r.creatorName || r.uploader || "—"}</span>
                    <span>·</span>
                    <span style={{ flexShrink: 0 }}>{new Date(r.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showUpload && (
        <UploadModal
          sellers={sellers} creators={creators} isAdmin={isAdmin} me={me} busy={busy}
          close={() => setShowUpload(false)}
          go={async (files, who) => { setShowUpload(false); await onPick(files, who); }}
        />
      )}

      {openRow && (
        <VideoDetail
          key={openRow.id} row={openRow} canManage={canManage} busy={busy} setBusy={setBusy}
          close={() => setOpen(null)} reload={() => load(page)} flash={flash} patch={patch}
          sellers={sellers} creators={creators} confirm={confirm} onReplace={doReplace}
        />
      )}
    </div>
  );
}

function Pager({ page, total, show, setPage, label }: { page: number; total: number; show: number; setPage: (n: number) => void; label: string }) {
  const pages = Math.max(Math.ceil(total / show), 1);
  const nums: (number | "…")[] = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 2) nums.push(i);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
      <button onClick={() => setPage(Math.max(1, page - 1))} style={pgBtn}>‹</button>
      {nums.map((n, i) => n === "…" ? <span key={i} style={{ color: "var(--muted)" }}>…</span> : (
        <button key={i} onClick={() => setPage(n)} style={{ ...pgBtn, background: n === page ? "var(--blue)" : "#fff", color: n === page ? "#fff" : "var(--ink)", fontWeight: 700 }}>{n}</button>
      ))}
      <button onClick={() => setPage(Math.min(pages, page + 1))} style={pgBtn}>›</button>
      <span style={{ fontSize: 12.5, color: "var(--muted)", marginLeft: 6 }}>{total.toLocaleString()} {label}</span>
    </div>
  );
}

/** Chi tiết. Gán listing theo Product type là đường chính — 1 thao tác cho cả lô. */
function VideoDetail({ row, canManage, busy, setBusy, close, reload, flash, patch, sellers, creators, confirm, onReplace }: {
  row: Row; canManage: boolean; busy: boolean; setBusy: (b: boolean) => void;
  close: () => void; reload: () => Promise<void> | void; flash: (m: string, ok?: boolean) => void;
  patch: (b: Record<string, unknown>, ok?: string) => Promise<void>;
  sellers: Opt[]; creators: Opt[]; confirm: ReturnType<typeof useConfirm>;
  onReplace: (row: Row, file: File) => Promise<void>;
}) {
  const [types, setTypes] = useState<TypeOpt[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [pickType, setPickType] = useState("");
  const repRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({
    title: row.title, note: row.note ?? "", language: row.language ?? "",
    sourceName: row.sourceName ?? "", shotAt: row.shotAt ?? "",
    voice: !!row.flags?.voice, text: !!row.flags?.text, music: !!row.flags?.music,
  });

  const loadAssign = useCallback(async () => {
    try {
      const j = await fetch(`/api/videos/assign?videoId=${row.id}`).then((r) => r.json());
      if (j.ok) { setTypes(j.types ?? []); setListings(j.listings ?? []); }
    } catch { /* không chặn */ }
  }, [row.id]);
  useEffect(() => { loadAssign(); }, [loadAssign]);

  const dirty = f.title.trim() !== row.title || f.note !== (row.note ?? "")
    || f.language !== (row.language ?? "")
    || f.sourceName !== (row.sourceName ?? "") || f.shotAt !== (row.shotAt ?? "")
    || f.voice !== !!row.flags?.voice || f.text !== !!row.flags?.text || f.music !== !!row.flags?.music;

  const save = () => patch({
    id: row.id, title: f.title.trim(), note: f.note, language: f.language || null,
    sourceName: f.sourceName || null, shotAt: f.shotAt || null,
    flags: { voice: f.voice, text: f.text, music: f.music },
  }, "Updated");

  const assign = async (body: Record<string, unknown>, okText: string) => {
    setBusy(true);
    try {
      const j = await fetch("/api/videos/assign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
      if (j.ok) { flash(`✓ ${okText} (${j.changed} listing)`); await loadAssign(); await reload(); }
      else flash("✗ " + (j.error ?? "failed"), false);
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };

  const doPush = async () => {
    if (!listings.length) return flash("✗ Assign this video to listings first", false);
    if (!(await confirm({ message: `Push this video to ${listings.length} listing(s) on Shopify?`, confirmText: "Push", tone: "green" }))) return;
    setBusy(true);
    try {
      const j = await fetch("/api/videos/push-shopify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id }) }).then((r) => r.json());
      if (j.ok) { flash(`✓ Pushed ${j.pushed}${j.failed ? ` · ${j.failed} failed: ${j.error ?? ""}` : ""}`); await loadAssign(); await reload(); }
      else flash("✗ " + (j.error ?? "push failed"), false);
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };

  const doCaptions = async () => {
    setBusy(true);
    try {
      const j = await fetch("/api/videos/captions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id }) }).then((r) => r.json());
      if (j.ok) { flash("✓ Captions written"); await reload(); } else flash("✗ " + (j.error ?? "failed"), false);
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };

  const doDelete = async () => {
    if (!(await confirm({ title: "Delete video", message: `Remove "${row.title}" from the library?`, danger: true, confirmText: "Delete" }))) return;
    setBusy(true);
    const j = await fetch(`/api/videos?id=${row.id}`, { method: "DELETE" }).then((x) => x.json()).catch(() => null);
    if (j?.ok) { flash("✓ Deleted"); close(); await reload(); } else flash("✗ " + (j?.error ?? "failed"), false);
    setBusy(false);
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); flash("✓ Copied"); }
    catch { flash("✗ Clipboard blocked", false); }
  };
  const cbx = (k: "voice" | "text" | "music", label: string) => (
    <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600 }}>
      <input type="checkbox" checked={f[k]} disabled={!canManage} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> {label}
    </label>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.5)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }} onClick={close}>
      <div className="card" style={{ width: 940, maxWidth: "97vw", maxHeight: "92vh", overflowY: "auto", padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={chip("#EEF2FF", "#4338CA")}>#{row.videoCode}</span>
          <div style={{ fontWeight: 800, fontSize: 16, flex: 1 }}>{row.title}</div>
          <button onClick={close} className="btn" style={{ padding: "6px 11px" }}>✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,280px) minmax(0,1fr)", gap: 20 }}>
          <div>
            {row.publicUrl && (
              <video src={row.publicUrl} poster={row.thumbUrl ?? undefined} controls playsInline
                style={{ width: "100%", borderRadius: 12, background: "#0B1220", maxHeight: 400 }} />
            )}
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8, lineHeight: 1.8 }}>
              {row.width}×{row.height} · {row.aspect ?? "—"} · {secs(row.durationSec)} · {mb(row.sizeBytes)}<br />
              Uploaded by {row.uploader ?? "—"} · {new Date(row.createdAt).toLocaleDateString()}<br />
              {row.storeName ? <>Store: {row.storeName}</> : null}
            </div>
            {row.publicUrl && (
              <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
                <a href={row.publicUrl} download className="btn" style={{ padding: "6px 11px", fontSize: 12, textDecoration: "none" }}>⬇ Download</a>
                <button onClick={() => copy(row.publicUrl!)} className="btn" style={{ padding: "6px 11px", fontSize: 12 }}>Copy link</button>
              </div>
            )}
          </div>

          <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
            <div className="filters" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="field" style={{ gridColumn: "span 2" }}>
                <label>Title</label>
                <input value={f.title} disabled={!canManage} onChange={(e) => setF({ ...f, title: e.target.value })} />
              </div>
              <div className="field" style={{ gridColumn: "span 2" }}>
                <label>Note</label>
                <input value={f.note} disabled={!canManage} placeholder="Notes between seller and creator — what to fix, what to reshoot…"
                  onChange={(e) => setF({ ...f, note: e.target.value })} />
              </div>
              <div className="field">
                <label>Language</label>
                <select value={f.language} disabled={!canManage} onChange={(e) => setF({ ...f, language: e.target.value })}>
                  <option value="">—</option>
                  {LANGS.map((l) => <option key={l.v} value={l.v}>{l.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Seller</label>
                <select value={row.sellerId ?? ""} disabled={!canManage}
                  onChange={(e) => patch({ id: row.id, sellerId: e.target.value || null }, "Seller updated")}>
                  <option value="">—</option>
                  {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Creator</label>
                <select value={row.creatorId ?? ""} disabled={!canManage}
                  onChange={(e) => patch({ id: row.id, creatorId: e.target.value || null }, "Creator updated")}>
                  <option value="">—</option>
                  {creators.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Shot on</label>
                <input type="date" value={f.shotAt} disabled={!canManage} onChange={(e) => setF({ ...f, shotAt: e.target.value })} />
              </div>
              <div className="field" style={{ gridColumn: "span 2" }}>
                <label>Filmed by (outside creator)</label>
                <input value={f.sourceName} disabled={!canManage} placeholder="Name of an outside creator with no account in the system"
                  onChange={(e) => setF({ ...f, sourceName: e.target.value })} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              {cbx("voice", "Has voiceover")}
              {cbx("text", "Text on screen")}
              {cbx("music", "Background music")}
              <div style={{ flex: 1 }} />
              {canManage && (
                <button disabled={busy || !dirty} className="btn btn-primary" onClick={save} style={{ opacity: dirty ? 1 : .5 }}>Update</button>
              )}
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)", marginBottom: 6 }}>
                SHOWING ON {listings.length} LISTING{listings.length === 1 ? "" : "S"}
              </div>
              {canManage && (
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                  <select value={pickType} onChange={(e) => setPickType(e.target.value)}
                    style={{ padding: "7px 9px", fontSize: 12.5, borderRadius: 9, border: "1px solid var(--line)", background: "#fff", maxWidth: 280 }}>
                    <option value="">Choose a Product type…</option>
                    {types.map((t) => <option key={t.productType!} value={t.productType!}>{t.productType} ({t.n})</option>)}
                  </select>
                  <button disabled={busy || !pickType} className="btn btn-primary" style={{ padding: "7px 12px", fontSize: 12.5, opacity: pickType ? 1 : .5 }}
                    onClick={() => assign({ videoId: row.id, productType: pickType }, "Assigned")}>
                    Assign to all
                  </button>
                  {!!listings.length && (
                    <button disabled={busy} className="btn" style={{ padding: "7px 12px", fontSize: 12.5, color: "#B42318" }}
                      onClick={() => assign({ videoId: null, productIds: listings.map((l) => l.id) }, "Removed")}>
                      Remove from all
                    </button>
                  )}
                </div>
              )}
              {!!listings.length && (
                <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 10 }}>
                  {listings.map((l) => (
                    <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", fontSize: 12, borderBottom: "1px solid var(--line)" }}>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.title}</span>
                      {l.pushedAt
                        ? <span style={chip("#E9F7EF", "#1F6F45")}>ON SHOPIFY</span>
                        : <span style={chip("#F3F4F6", "#6B7280")}>NOT PUSHED</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {canManage && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button disabled={busy || !listings.length} className="btn btn-primary" onClick={doPush} style={{ opacity: listings.length ? 1 : .5 }}>
                  → Push video to Shopify
                </button>
                <button disabled={busy || !row.productId} className="btn" onClick={doCaptions} title={row.productId ? "" : "Set a primary listing first"}>
                  ✨ {row.captionsAt ? "Rewrite captions" : "Write captions"}
                </button>
                <div style={{ flex: 1 }} />
                <input ref={repRef} type="file" accept="video/*" hidden
                  onChange={(e) => { const fl = e.target.files?.[0]; if (fl) onReplace(row, fl); if (repRef.current) repRef.current.value = ""; }} />
                <button disabled={busy} className="btn" onClick={() => repRef.current?.click()}
                  title="Replace the file after a re-edit — keeps the same #ID, listings and captions">
                  ⟳ Replace file{row.revision > 1 ? ` (v${row.revision})` : ""}
                </button>
                <button disabled={busy} className="btn" style={{ color: "#B42318" }} onClick={doDelete}>Delete</button>
              </div>
            )}

            {row.captions && (
              <div style={{ display: "grid", gap: 8 }}>
                {CHANNELS.map((ch) => {
                  const c = row.captions?.[ch.key];
                  if (!c) return null;
                  const full = [c.text, (c.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n");
                  return (
                    <div key={ch.key} style={{ border: "1px solid var(--line)", borderRadius: 11, padding: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                        <span style={chip("#F3F4F6", "#374151")}>{ch.label}</span>
                        <span style={{ flex: 1 }} />
                        <button onClick={() => copy(full)} className="btn" style={{ padding: "4px 9px", fontSize: 11.5 }}>Copy</button>
                      </div>
                      <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{c.text}</div>
                      {!!(c.hashtags ?? []).length && <div style={{ fontSize: 11.5, color: "#4338CA", marginTop: 5 }}>{c.hashtags.join(" ")}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Bulk upload — BẮT BUỘC chọn seller trước, giống Design Studio.
 *  Creator = chính người đang upload, không hỏi lại. */
function UploadModal({ sellers, creators, isAdmin, me, busy, close, go }: {
  sellers: Opt[]; creators: Opt[]; isAdmin: boolean; me: { id: string; name: string }; busy: boolean;
  close: () => void; go: (files: File[], who: { sellerId: string; creatorId: string }) => Promise<void>;
}) {
  // Admin: chọn cả seller + creator (danh sách đầy đủ). Seller: seller là CHÍNH MÌNH, chỉ chọn Creator trong team.
  const [sellerId, setSellerId] = useState(isAdmin ? "" : me.id);
  const [creatorId, setCreatorId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const inRef = useRef<HTMLInputElement>(null);
  const ready = !!sellerId && files.length > 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.5)", zIndex: 3100, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }} onClick={close}>
      <div className="card" style={{ width: 560, maxWidth: "96vw", padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 16, flex: 1 }}>Bulk upload — each file becomes one video</div>
          <button onClick={close} className="btn" style={{ padding: "6px 11px" }}>✕</button>
        </div>

        <div className="filters" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="field">
            <label>Seller <span style={{ color: "#B42318" }}>*</span></label>
            {isAdmin ? (
              <select value={sellerId} onChange={(e) => setSellerId(e.target.value)}
                style={{ borderColor: sellerId ? undefined : "#F0B4AE" }}>
                <option value="">— select a seller —</option>
                {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : (
              // Seller: cố định chính mình, không cho đổi.
              <input value={me.name} disabled style={{ background: "#F1F3F7", color: "var(--muted)" }} />
            )}
          </div>
          <div className="field">
            <label>Creator</label>
            <select value={creatorId} onChange={(e) => setCreatorId(e.target.value)}>
              <option value="">{isAdmin ? "— none —" : "Me"}</option>
              {creators.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <input ref={inRef} type="file" accept="video/*" multiple hidden
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        <button type="button" onClick={() => inRef.current?.click()} disabled={!sellerId}
          title={sellerId ? "" : "Select a seller first"}
          style={{
            width: "100%", marginTop: 12, padding: "22px 14px", borderRadius: 12, cursor: sellerId ? "pointer" : "not-allowed",
            border: "1.5px dashed var(--line)", background: sellerId ? "#F8FAFC" : "#F1F3F7",
            color: sellerId ? "var(--ink)" : "var(--muted)", fontWeight: 700, fontSize: 13.5, font: "inherit",
          }}>
          {files.length ? `${files.length} file(s) selected — click to change` : sellerId ? "Choose video files…" : "Select a seller before choosing files"}
        </button>

        {!!files.length && (
          <div style={{ maxHeight: 130, overflowY: "auto", marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
            {files.map((f, i) => (
              <div key={i} style={{ display: "flex", gap: 8, padding: "3px 0" }}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                <span style={{ flexShrink: 0 }}>{(f.size / 1048576).toFixed(1)} MB</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button onClick={close} className="btn">Cancel</button>
          <button disabled={!ready || busy} className="btn btn-primary" style={{ opacity: ready && !busy ? 1 : .5 }}
            onClick={() => go(files, { sellerId, creatorId })}>
            Upload {files.length || ""}
          </button>
        </div>
      </div>
    </div>
  );
}
