"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "@/components/confirm-provider";

/**
 * v207 · Video library.
 * Luồng: creator chọn file → browser đọc metadata (thời lượng/kích thước) + bắt frame đầu làm poster
 * → PUT thẳng lên R2 bằng presigned URL → tạo bản ghi → admin duyệt → đẩy Shopify / lấy caption.
 * File KHÔNG đi qua Vercel nên video 50–100MB vẫn upload được.
 */

type Caption = { text: string; hashtags: string[] };
type Row = {
  id: string; title: string; note: string | null;
  storageKey: string; publicUrl: string | null; thumbUrl: string | null;
  contentType: string | null; sizeBytes: number | null; durationSec: string | null;
  width: number | null; height: number | null; aspect: string | null;
  status: string; reviewNote: string | null;
  productId: string | null; productTitle: string | null; productGid: string | null;
  storeId: string | null; storeName: string | null; uploader: string | null;
  captions: Record<string, Caption> | null; captionsAt: string | null;
  shopifyMediaId: string | null; shopifyPushedAt: string | null;
  postedTo: Record<string, string> | null;
  createdAt: string; canEdit: boolean;
};
type Prod = { id: string; title: string; storeId: string; productType: string | null; storeName: string | null };

const CHANNELS = [
  { key: "tiktok", label: "TikTok", color: "#111827" },
  { key: "reels", label: "IG Reels", color: "#C13584" },
  { key: "shorts", label: "YT Shorts", color: "#CC0000" },
  { key: "facebook", label: "Facebook", color: "#1877F2" },
  { key: "pinterest", label: "Pinterest", color: "#BD081C" },
] as const;

const card: React.CSSProperties = { background: "#fff", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,.04)" };
const ctl: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 10, padding: "8px 11px", fontSize: 13, font: "inherit", background: "#fff", outline: "none" };
const pill = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 7, border: "none", background: bg, color: fg, borderRadius: 11, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" });
const ghost: React.CSSProperties = { ...pill("#fff", "var(--ink)"), border: "1px solid var(--line)" };
const chip = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-block", background: bg, color: fg, borderRadius: 999, padding: "2px 9px", fontSize: 11, fontWeight: 800 });

const STATUS_TONE: Record<string, { bg: string; fg: string; label: string }> = {
  pending: { bg: "#FEF6E7", fg: "#B7791F", label: "PENDING" },
  approved: { bg: "#E9F7EF", fg: "#1F6F45", label: "APPROVED" },
  rejected: { bg: "#FEE4E2", fg: "#B42318", label: "REJECTED" },
};
const mb = (n: number | null) => n == null ? "—" : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
const secs = (s: string | null) => { const n = Number(s); return isFinite(n) && n > 0 ? `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, "0")}` : "—"; };

export default function VideosClient({ isAdmin, canManage }: { isAdmin: boolean; canManage: boolean }) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusF, setStatusF] = useState("");
  const [mine, setMine] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<{ name: string; pct: number } | null>(null);
  const [open, setOpen] = useState<string | null>(null);      // id đang mở chi tiết
  const [prods, setProds] = useState<Prod[]>([]);
  const [pq, setPq] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const flash = (text: string, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 6000); };

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (statusF) qs.set("status", statusF);
    if (mine) qs.set("mine", "1");
    try {
      const j = await fetch(`/api/videos?${qs}`).then((r) => r.json());
      if (j.ok) setRows(j.rows ?? []);
      else flash("✗ " + (j.error ?? "load failed"), false);
    } catch { flash("✗ Network error", false); }
    setLoading(false);
  }, [statusF, mine]);
  useEffect(() => { load(); }, [load]);

  // Danh sách listing để gắn — nạp lười, chỉ khi mở chi tiết lần đầu.
  const loadProds = useCallback(async (q: string) => {
    try {
      const j = await fetch(`/api/videos/products?q=${encodeURIComponent(q)}`).then((r) => r.json());
      if (j.ok) setProds(j.rows ?? []);
    } catch { /* ô chọn trống thì thôi, không chặn gì */ }
  }, []);
  useEffect(() => { if (open) loadProds(pq); }, [open, pq, loadProds]);

  /** Đọc metadata + bắt frame đầu làm poster — làm ở browser để server khỏi phải đụng vào file. */
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
      vid.onloadedmetadata = () => {
        // Nhảy tới giây thứ 1 (hoặc giữa clip nếu ngắn) — frame 0 hay là màn đen.
        vid.currentTime = Math.min(1, (vid.duration || 1) / 2);
      };
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
      setTimeout(fail, 15000); // video lạ định dạng thì đừng treo mãi
    });

  /** Xin chỗ trên R2 rồi PUT thẳng lên. Trả { key, publicUrl }. */
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

  const onPick = async (files: FileList | null) => {
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
          } catch { /* thiếu poster không sao — vẫn xem được video */ }
        }
        setProg({ name: file.name, pct: 92 });

        const j = await fetch("/api/videos", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: file.name.replace(/\.[^.]+$/, "").slice(0, 200),
            storageKey: up.key, publicUrl: up.publicUrl, thumbKey, thumbUrl,
            contentType: file.type || "video/mp4", sizeBytes: file.size,
            durationSec: meta.duration || null, width: meta.width || null, height: meta.height || null,
          }),
        }).then((r) => r.json());
        if (!j?.ok) throw new Error(j?.error ?? "save failed");
        ok++;
      } catch (e) {
        flash(`✗ ${file.name}: ${String((e as Error)?.message ?? e)}`, false);
      }
    }
    setProg(null); setBusy(false);
    if (ok) flash(`✓ Uploaded ${ok} video${ok > 1 ? "s" : ""} — waiting for review`);
    if (fileRef.current) fileRef.current.value = "";
    load();
  };

  const patch = async (body: Record<string, unknown>, okText?: string) => {
    setBusy(true);
    try {
      const j = await fetch("/api/videos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
      if (j.ok) { if (okText) flash("✓ " + okText); await load(); }
      else flash("✗ " + (j.error ?? "failed"), false);
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };

  const doDelete = async (r: Row) => {
    if (!(await confirm({ title: "Delete video", message: `Remove "${r.title}" from the library?\nThe file stays in storage, only the record is removed.`, danger: true, confirmText: "Delete" }))) return;
    setBusy(true);
    const j = await fetch(`/api/videos?id=${r.id}`, { method: "DELETE" }).then((x) => x.json()).catch(() => null);
    if (j?.ok) { flash("✓ Deleted"); if (open === r.id) setOpen(null); await load(); } else flash("✗ " + (j?.error ?? "failed"), false);
    setBusy(false);
  };

  const doPushShopify = async (r: Row) => {
    if (!r.productId) return flash("✗ Link this video to a listing first", false);
    if (!(await confirm({ message: `Add this video to "${r.productTitle}" on Shopify?`, confirmText: "Push", tone: "green" }))) return;
    setBusy(true);
    try {
      const j = await fetch("/api/videos/push-shopify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id }) }).then((x) => x.json());
      if (j.ok) { flash("✓ Sent to Shopify — " + (j.note ?? "")); await load(); }
      else flash("✗ " + (j.error ?? "push failed"), false);
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };

  const doCaptions = async (r: Row) => {
    if (!r.productId) return flash("✗ Link this video to a listing first — captions come from the listing data", false);
    setBusy(true);
    try {
      const j = await fetch("/api/videos/captions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id }) }).then((x) => x.json());
      if (j.ok) { flash("✓ Captions written"); await load(); }
      else flash("✗ " + (j.error ?? "failed"), false);
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); flash("✓ Copied"); }
    catch { flash("✗ Clipboard blocked — select and copy manually", false); }
  };

  const counts = useMemo(() => ({
    pending: rows.filter((r) => r.status === "pending").length,
    approved: rows.filter((r) => r.status === "approved").length,
  }), [rows]);

  const openRow = rows.find((r) => r.id === open) ?? null;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ ...card, padding: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 800, fontSize: 17, display: "flex", alignItems: "center", gap: 9 }}>
            Video library
            {counts.pending > 0 && <span style={chip("#FEF6E7", "#B7791F")}>{counts.pending} pending</span>}
          </div>
        </div>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} style={ctl}>
          <option value="">All status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine only
        </label>
        <input ref={fileRef} type="file" accept="video/*" multiple hidden onChange={(e) => onPick(e.target.files)} />
        {/* Upload cần quyền đầy đủ (level 2) — level 1 chỉ xem thư viện. */}
        {canManage && (
          <button disabled={busy} onClick={() => fileRef.current?.click()} style={{ ...pill("linear-gradient(135deg,#5E8E3E,#4A7230)", "#fff"), opacity: busy ? .6 : 1 }}>
            ⬆ Upload video
          </button>
        )}
      </div>

      {prog && (
        <div style={{ ...card, padding: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Uploading {prog.name}…</div>
          <div style={{ height: 6, background: "#EEF1F5", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${prog.pct}%`, background: "#5E8E3E", transition: "width .3s" }} />
          </div>
        </div>
      )}

      {msg && (
        <div style={{ ...card, padding: "11px 14px", fontSize: 13, fontWeight: 600, background: msg.ok ? "#E9F7EF" : "#FEE4E2", color: msg.ok ? "#1F6F45" : "#B42318", borderColor: "transparent" }}>
          {msg.text}
        </div>
      )}

      {loading ? (
        <div className="panel empty">Loading…</div>
      ) : !rows.length ? (
        <div style={{ ...card, padding: 34, textAlign: "center", color: "var(--muted)", fontSize: 14, fontWeight: 600 }}>No videos yet</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
          {rows.map((r) => {
            const tone = STATUS_TONE[r.status] ?? STATUS_TONE.pending;
            const posted = Object.keys(r.postedTo ?? {}).length;
            return (
              <div key={r.id} style={{ ...card, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                {/* Khung ảnh: tỷ lệ CỐ ĐỊNH 4:5 cho mọi video — hàng card thẳng đều, không so le. */}
                <div onClick={() => setOpen(r.id)} title="Open"
                  style={{ position: "relative", aspectRatio: "4/5", background: "#0B1220", cursor: "pointer", overflow: "hidden" }}>
                  {r.thumbUrl
                    ? <img src={r.thumbUrl} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 12, fontWeight: 700 }}>NO PREVIEW</div>}
                  {/* nút play giữa khung */}
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                    <span style={{ width: 42, height: 42, borderRadius: 999, background: "rgba(0,0,0,.5)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z" /></svg>
                    </span>
                  </div>
                  <span style={{ position: "absolute", top: 8, left: 8, ...chip(tone.bg, tone.fg) }}>{tone.label}</span>
                  <div style={{ position: "absolute", bottom: 8, left: 8, right: 8, display: "flex", gap: 5, alignItems: "center" }}>
                    <span style={chip("rgba(0,0,0,.62)", "#fff")}>{secs(r.durationSec)}</span>
                    {r.aspect && <span style={chip(r.aspect === "9:16" ? "rgba(31,111,69,.85)" : "rgba(183,121,31,.9)", "#fff")}>{r.aspect}</span>}
                    <span style={{ flex: 1 }} />
                    <span style={chip("rgba(0,0,0,.62)", "#fff")}>{mb(r.sizeBytes)}</span>
                  </div>
                </div>

                <div style={{ padding: "10px 11px", display: "grid", gap: 7, flex: 1, alignContent: "start" }}>
                  <div onClick={() => setOpen(r.id)} title={r.title}
                    style={{ fontWeight: 700, fontSize: 13, cursor: "pointer", color: "var(--blue)", lineHeight: 1.35,
                             display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {r.title}
                  </div>

                  {/* Listing đang gắn — thiếu là cảnh báo, vì chưa gắn thì không đẩy Shopify được */}
                  <div style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                    {r.productTitle ? (
                      <>
                        <span style={{ color: "var(--muted)", flexShrink: 0 }}>▣</span>
                        <span style={{ color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.productTitle}</span>
                      </>
                    ) : (
                      <span style={{ color: "#B7791F", fontWeight: 700 }}>⚠ Not linked to a listing</span>
                    )}
                  </div>

                  <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", gap: 5, alignItems: "center" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.uploader ?? "—"}</span>
                    <span>·</span>
                    <span style={{ flexShrink: 0 }}>{new Date(r.createdAt).toLocaleDateString()}</span>
                  </div>

                  {(r.shopifyMediaId || r.captionsAt || posted > 0) && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {r.shopifyMediaId && <span style={chip("#E9F7EF", "#1F6F45")}>ON SHOPIFY</span>}
                      {r.captionsAt && <span style={chip("#EEF2FF", "#4338CA")}>CAPTIONS</span>}
                      {posted > 0 && <span style={chip("#F3F4F6", "#374151")}>POSTED {posted}/5</span>}
                    </div>
                  )}

                  {/* Duyệt ngay trên card — khỏi phải mở từng cái khi có cả loạt chờ */}
                  {canManage && r.status === "pending" && (
                    <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                      <button disabled={busy} onClick={() => patch({ id: r.id, status: "approved" }, "Approved")}
                        style={{ ...pill("#E9F7EF", "#1F6F45"), padding: "5px 10px", fontSize: 11.5, flex: 1, justifyContent: "center" }}>✓ Approve</button>
                      <button disabled={busy} onClick={() => patch({ id: r.id, status: "rejected" }, "Rejected")}
                        style={{ ...pill("#FEE4E2", "#B42318"), padding: "5px 10px", fontSize: 11.5 }}>✕</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---- CHI TIẾT ---- */}
      {openRow && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.5)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }} onClick={() => setOpen(null)}>
          <div style={{ ...card, width: 900, maxWidth: "97vw", maxHeight: "92vh", overflowY: "auto", padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 16, flex: 1 }}>{openRow.title}</div>
              <span style={chip(STATUS_TONE[openRow.status]?.bg ?? "#EEE", STATUS_TONE[openRow.status]?.fg ?? "#333")}>{STATUS_TONE[openRow.status]?.label}</span>
              <button onClick={() => setOpen(null)} style={{ ...ghost, padding: "6px 11px" }}>✕</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,260px) minmax(0,1fr)", gap: 18 }}>
              <div>
                {openRow.publicUrl && (
                  <video src={openRow.publicUrl} poster={openRow.thumbUrl ?? undefined} controls playsInline
                    style={{ width: "100%", borderRadius: 12, background: "#0B1220", maxHeight: 380 }} />
                )}
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8, lineHeight: 1.7 }}>
                  {openRow.width}×{openRow.height} · {openRow.aspect ?? "—"} · {secs(openRow.durationSec)} · {mb(openRow.sizeBytes)}<br />
                  Uploaded by {openRow.uploader ?? "—"} · {new Date(openRow.createdAt).toLocaleDateString()}
                </div>
                {openRow.publicUrl && (
                  <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
                    <a href={openRow.publicUrl} download style={{ ...ghost, padding: "6px 11px", fontSize: 12, textDecoration: "none" }}>⬇ Download</a>
                    <button onClick={() => copy(openRow.publicUrl!)} style={{ ...ghost, padding: "6px 11px", fontSize: 12 }}>Copy link</button>
                  </div>
                )}
                {openRow.aspect && openRow.aspect !== "9:16" && (
                  <div style={{ marginTop: 9, fontSize: 11.5, background: "#FEF6E7", color: "#B7791F", padding: "7px 9px", borderRadius: 9, fontWeight: 600 }}>
                    Not 9:16 — TikTok, Reels and Shorts will letterbox or crop this. Re-export vertical for best reach.
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
                {/* Gắn listing */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)", marginBottom: 5 }}>LINKED LISTING</div>
                  {openRow.canEdit || canManage ? (
                    <>
                      <input value={pq} onChange={(e) => setPq(e.target.value)} placeholder="Search listings…" style={{ ...ctl, width: "100%", marginBottom: 6 }} />
                      <select value={openRow.productId ?? ""} disabled={busy}
                        onChange={(e) => {
                          const p = prods.find((x) => x.id === e.target.value);
                          patch({ id: openRow.id, productId: e.target.value || null, storeId: p?.storeId ?? null }, "Linked");
                        }}
                        style={{ ...ctl, width: "100%" }}>
                        <option value="">— not linked —</option>
                        {openRow.productId && !prods.some((p) => p.id === openRow.productId) && (
                          <option value={openRow.productId}>{openRow.productTitle ?? "(current)"}</option>
                        )}
                        {prods.map((p) => <option key={p.id} value={p.id}>{p.title.slice(0, 70)}</option>)}
                      </select>
                    </>
                  ) : (
                    <div style={{ fontSize: 13 }}>{openRow.productTitle ?? "—"}</div>
                  )}
                </div>

                {/* Duyệt */}
                {canManage && (
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    <button disabled={busy || openRow.status === "approved"} onClick={() => patch({ id: openRow.id, status: "approved" }, "Approved")}
                      style={{ ...pill("#E9F7EF", "#1F6F45"), opacity: openRow.status === "approved" ? .5 : 1 }}>✓ Approve</button>
                    <button disabled={busy || openRow.status === "rejected"} onClick={() => patch({ id: openRow.id, status: "rejected" }, "Rejected")}
                      style={{ ...pill("#FEE4E2", "#B42318"), opacity: openRow.status === "rejected" ? .5 : 1 }}>✕ Reject</button>
                  </div>
                )}

                {/* Hành động */}
                {canManage && (
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    <button disabled={busy || openRow.status !== "approved" || !!openRow.shopifyMediaId || !openRow.productId}
                      onClick={() => doPushShopify(openRow)}
                      title={openRow.shopifyMediaId ? "Already on Shopify" : openRow.status !== "approved" ? "Approve it first" : !openRow.productId ? "Link a listing first" : ""}
                      style={{ ...pill("#5E8E3E", "#fff"), opacity: (busy || openRow.status !== "approved" || !!openRow.shopifyMediaId || !openRow.productId) ? .5 : 1 }}>
                      {openRow.shopifyMediaId ? "✓ On Shopify" : "→ Add to Shopify product"}
                    </button>
                    <button disabled={busy || !openRow.productId} onClick={() => doCaptions(openRow)}
                      style={{ ...pill("linear-gradient(135deg,#4338CA,#312E81)", "#fff"), opacity: (busy || !openRow.productId) ? .5 : 1 }}>
                      ✨ {openRow.captionsAt ? "Rewrite captions" : "Write captions"}
                    </button>
                  </div>
                )}

                {/* Caption từng kênh */}
                {openRow.captions && (
                  <div style={{ display: "grid", gap: 9 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)" }}>CAPTIONS — copy, then post on the channel</div>
                    {CHANNELS.map((ch) => {
                      const c = openRow.captions?.[ch.key];
                      if (!c) return null;
                      const full = [c.text, (c.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n");
                      const done = !!openRow.postedTo?.[ch.key];
                      return (
                        <div key={ch.key} style={{ border: "1px solid var(--line)", borderRadius: 11, padding: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                            <span style={{ ...chip("#F3F4F6", ch.color), fontSize: 11 }}>{ch.label}</span>
                            <span style={{ flex: 1 }} />
                            <button onClick={() => copy(full)} style={{ ...ghost, padding: "4px 9px", fontSize: 11.5 }}>Copy</button>
                            <button disabled={busy}
                              onClick={() => patch({ id: openRow.id, ...(done ? { unmarkPosted: ch.key } : { markPosted: ch.key }) })}
                              style={{ ...pill(done ? "#E9F7EF" : "#fff", done ? "#1F6F45" : "var(--muted)"), padding: "4px 9px", fontSize: 11.5, border: done ? "none" : "1px solid var(--line)" }}>
                              {done ? "✓ Posted" : "Mark posted"}
                            </button>
                          </div>
                          <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{c.text}</div>
                          {!!(c.hashtags ?? []).length && (
                            <div style={{ fontSize: 11.5, color: "#4338CA", marginTop: 5 }}>{c.hashtags.join(" ")}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {(openRow.canEdit || canManage) && (
                  <button disabled={busy} onClick={() => doDelete(openRow)} style={{ ...ghost, color: "#B42318", justifySelf: "start", padding: "6px 12px", fontSize: 12 }}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
