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
  productUrl: string | null; productHandle: string | null;
  postedTo: Record<string, { url: string; at: string }> | null;
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
type Match = { id: string; title: string; productType: string | null; videoId: string | null };
// Performance quy về từng video qua UTM (utm_campaign = video_<code>), tách theo kênh (utm_source).
type Perf = { orders: number; revenue: number; channels: Record<string, { orders: number; revenue: number }> };

const LANGS = [{ v: "none", label: "No voice" }, { v: "en", label: "English" }, { v: "vi", label: "Tiếng Việt" }];
const CHANNELS = [
  { key: "tiktok", label: "TikTok" }, { key: "reels", label: "IG Reels" }, { key: "shorts", label: "YT Shorts" },
  { key: "facebook", label: "Facebook" }, { key: "pinterest", label: "Pinterest" },
] as const;
// Nhãn kênh cho Performance (khớp utm_source do nút UTM sinh ra).
const CH_LABEL: Record<string, string> = { tiktok: "TikTok", meta: "Meta (FB+IG)", reels: "IG Reel", facebook: "FB Page", pinterest: "Pinterest", shorts: "YT Short", meta_ads: "Meta Ads", gmc: "GMC/PMax", other: "Other" };
// Nhãn ngắn cho hàng "đã đăng" trên card.
const POSTED_LABEL: Record<string, string> = { tiktok: "TikTok", meta: "Meta", reels: "IG", shorts: "YT", facebook: "FB", pinterest: "Pinterest", meta_ads: "Ads", gmc: "GMC" };
const money = (n: number) => "$" + Math.round(n || 0).toLocaleString();
const WIN_ORDERS = 10; // đủ số đơn quy về mới gắn cờ 🔥 "winning creative"

const chip = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-block", background: bg, color: fg, borderRadius: 999, padding: "2px 9px", fontSize: 11, fontWeight: 800 });
const pgBtn: React.CSSProperties = { minWidth: 34, height: 34, borderRadius: 9, border: "1px solid var(--line)", background: "#fff", cursor: "pointer", fontSize: 13 };
const mb = (n: number | null) => n == null ? "—" : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
const secs = (s: string | null) => { const n = Number(s); return isFinite(n) && n > 0 ? `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, "0")}` : "—"; };
const LIMIT = 24;

export default function VideosClient({ isAdmin, myRole, canManage, me }: { isAdmin: boolean; myRole: string; canManage: boolean; me: { id: string; name: string } }) {
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
  // Performance theo videoCode (chỉ admin xem — tránh lộ doanh thu cho creator/seller). Key = String(videoCode).
  const [perf, setPerf] = useState<Record<string, Perf>>({});
  // Model AI cho nút Generate caption — chọn TRƯỚC khi generate. Dùng chung danh sách với các trang AI khác.
  const [aiModels, setAiModels] = useState<{ id: string; name: string }[]>([]);
  const [aiModel, setAiModel] = useState("");
  const [visionIds, setVisionIds] = useState<Set<string>>(new Set()); // model đọc được ảnh → mới gửi ảnh kèm caption
  useEffect(() => {
    try { const s = window.localStorage.getItem("videosAiModel"); if (s) setAiModel(s); } catch { /* ignore */ }
    if (isAdmin) {
      fetch("/api/books/models?type=text").then((r) => r.json())
        .then((j) => { if (Array.isArray(j?.models)) setAiModels(j.models); }).catch(() => { /* offline */ });
      fetch("/api/books/models?type=vision").then((r) => r.json())
        .then((j) => { if (Array.isArray(j?.models)) setVisionIds(new Set((j.models as { id: string }[]).map((m) => m.id))); }).catch(() => {});
    }
  }, [isAdmin]);
  // Model mặc định (aiModel trống) coi như đọc được ảnh (bản ship là Claude 3.5 Sonnet — có vision).
  const aiModelIsVision = !aiModel || visionIds.has(aiModel);
  const chooseModel = (m: string) => { setAiModel(m); try { window.localStorage.setItem("videosAiModel", m); } catch { /* ignore */ } };

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
        // Performance chỉ kéo cho admin (doanh thu Shopify) — tách 1 call để không chặn danh sách.
        if (isAdmin) {
          const codes = (j.rows ?? []).map((r: Row) => r.videoCode).filter(Boolean);
          if (codes.length) {
            fetch(`/api/videos/performance?codes=${codes.join(",")}`).then((r) => r.json())
              .then((pj) => { if (pj.ok) setPerf(pj.perf ?? {}); }).catch(() => {});
          } else setPerf({});
        }
      } else flash("✗ " + (j.error ?? "load failed"), false);
    } catch { flash("✗ Network error", false); }
    setLoading(false);
  }, [dr, q, sellerId, creatorId, isAdmin]);

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
                <div style={{ position: "absolute", bottom: 8, left: 8, right: 8, display: "flex", gap: 5, alignItems: "center" }}>
                  <span style={chip("rgba(0,0,0,.62)", "#fff")}>{secs(r.durationSec)}</span>
                  {r.aspect && <span style={chip("rgba(0,0,0,.62)", "#fff")}>{r.aspect}</span>}
                  <span style={{ flex: 1 }} />
                  {r.publicUrl && (
                    <a href={r.publicUrl} download onClick={(e) => e.stopPropagation()} title="Download video"
                      style={{ width: 26, height: 26, borderRadius: 999, background: "rgba(0,0,0,.62)", display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none", flexShrink: 0 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
                    </a>
                  )}
                </div>
              </div>
              {/* Card gọn: #id · tên video · product · seller/creator · đã đăng · performance · thời lượng.
                  Chi tiết kỹ thuật (WxH·size·UUID) đưa vào modal. */}
              <div className="dc-body" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="dc-top">
                  <span className="dc-id" style={{ cursor: "pointer" }} title="Copy ID"
                    onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(String(r.videoCode)); }}>#{r.videoCode}</span>
                  <span className="dc-date">{new Date(r.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="dc-title" style={{ fontWeight: 700 }}>
                  <span title={r.title} style={{ cursor: "pointer" }}
                    onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(r.title); }}>{r.title}</span>
                </div>
                {r.productTitle && (
                  <div title={r.productTitle} style={{ fontSize: 11.5, color: "#475569", background: "#F1F5F9", borderRadius: 6, padding: "2px 8px", alignSelf: "flex-start", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.productTitle}</div>
                )}
                <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 1 }}>
                  <span title="Seller">👤 {r.sellerName ?? "—"}</span>
                  <span title="Creator">🎬 {r.sourceName || r.creatorName || r.uploader || "—"}</span>
                </div>
                <PostedTicks postedTo={r.postedTo} />
                {isAdmin && <PerfLine p={perf[String(r.videoCode)]} />}
                <div className="dc-foot" style={{ marginTop: "auto" }}>
                  <span>{r.aspect ?? "—"}</span>
                  <span>{secs(r.durationSec)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showUpload && (
        <UploadModal
          sellers={sellers} creators={creators} isAdmin={isAdmin} myRole={myRole} me={me} busy={busy}
          close={() => setShowUpload(false)}
          go={async (files, who) => { setShowUpload(false); await onPick(files, who); }}
        />
      )}

      {openRow && (
        <VideoDetail
          key={openRow.id} row={openRow} canManage={canManage} isAdmin={isAdmin} busy={busy} setBusy={setBusy}
          close={() => setOpen(null)} reload={() => load(page)} flash={flash} patch={patch}
          sellers={sellers} creators={creators} confirm={confirm} onReplace={doReplace}
          perf={perf[String(openRow.videoCode)]}
          aiModels={aiModels} aiModel={aiModel} onChooseModel={chooseModel} aiModelIsVision={aiModelIsVision}
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
function VideoDetail({ row, canManage, isAdmin, busy, setBusy, close, reload, flash, patch, sellers, creators, confirm, onReplace, perf, aiModels, aiModel, onChooseModel, aiModelIsVision }: {
  row: Row; canManage: boolean; isAdmin: boolean; busy: boolean; setBusy: (b: boolean) => void;
  close: () => void; reload: () => Promise<void> | void; flash: (m: string, ok?: boolean) => void;
  patch: (b: Record<string, unknown>, ok?: string) => Promise<void>;
  sellers: Opt[]; creators: Opt[]; confirm: ReturnType<typeof useConfirm>;
  onReplace: (row: Row, file: File) => Promise<void>;
  perf?: Perf;
  aiModels: { id: string; name: string }[]; aiModel: string; onChooseModel: (m: string) => void; aiModelIsVision: boolean;
}) {
  const [types, setTypes] = useState<TypeOpt[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [pickType, setPickType] = useState("");
  // Tìm listing theo tên để gán nhanh (1 video 1 listing) — khỏi đi dò trên Shopify.
  const [lq, setLq] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
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
  // Gõ tên → tìm listing (debounce 300ms).
  useEffect(() => {
    const q = lq.trim();
    if (q.length < 2) { setMatches([]); return; }
    const t = setTimeout(async () => {
      try {
        const j = await fetch(`/api/videos/assign?videoId=${row.id}&q=${encodeURIComponent(q)}`).then((r) => r.json());
        if (j.ok) setMatches(j.matches ?? []);
      } catch { /* im */ }
    }, 300);
    return () => clearTimeout(t);
  }, [lq, row.id]);

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
      const j = await fetch("/api/videos/captions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id, model: aiModel || undefined, withImages: aiModelIsVision }) }).then((r) => r.json());
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

  // ── UTM link cho từng kênh: link listing chính + tham số để Shopify/GA quy đơn về đúng video × kênh ──
  const utmLink = (ch: string): string => {
    if (!row.productUrl) return "";
    try {
      const u = new URL(row.productUrl);
      u.searchParams.set("utm_source", ch);
      u.searchParams.set("utm_medium", "video");
      u.searchParams.set("utm_campaign", `video_${row.videoCode}`);
      return u.toString();
    } catch { return ""; }
  };
  // ── Posted tracker: đã đăng bài lên kênh nào + link bài, lưu vào postedTo ──
  const [posted, setPosted] = useState<Record<string, { url: string; at: string }>>(
    () => (row.postedTo && typeof row.postedTo === "object" ? { ...row.postedTo } : {}),
  );
  const setPostedUrl = (ch: string, url: string) => setPosted((p) => {
    const n = { ...p };
    if (url.trim()) n[ch] = { url: url.trim(), at: p[ch]?.at ?? new Date().toISOString() };
    else delete n[ch];
    return n;
  });
  const savePosted = () => patch({ id: row.id, postedTo: posted }, "Saved");
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

          <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
            {/* 1 · Thông tin cơ bản — chỉ giữ field thật sự dùng ở Phase 1 */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", letterSpacing: ".4px", marginBottom: 8 }}>DETAILS</div>
              <div className="filters" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div className="field" style={{ gridColumn: "span 2" }}>
                  <label>Title</label>
                  <input value={f.title} disabled={!canManage} onChange={(e) => setF({ ...f, title: e.target.value })} />
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
                <div className="field" style={{ gridColumn: "span 2" }}>
                  <label>Note <span style={{ fontWeight: 400, color: "var(--muted)" }}>· seller ↔ creator</span></label>
                  <input value={f.note} disabled={!canManage} placeholder="What to fix, what to reshoot…"
                    onChange={(e) => setF({ ...f, note: e.target.value })} />
                </div>
              </div>
              {canManage && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                  <button disabled={busy || !dirty} className="btn btn-primary" onClick={save} style={{ opacity: dirty ? 1 : .5 }}>Update</button>
                </div>
              )}
            </div>

            {/* ─── ADMIN-ONLY: Shopify listing + distribution ─── */}
            {isAdmin && (
              <>
                {/* Listing — gắn + đẩy video làm ở Manage Products · Shopify. Ở đây chỉ dẫn link tới listing. */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)", marginBottom: 6 }}>LISTING</div>
                  {row.productId && row.productTitle ? (
                    <a href={`/shopify-products?q=${encodeURIComponent(row.productTitle)}`} target="_blank" rel="noreferrer"
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", border: "1px solid var(--line)", borderRadius: 10, textDecoration: "none", color: "var(--ink)", fontSize: 13, background: "#F7FBFF" }}>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.productTitle}</span>
                      <span style={{ color: "var(--blue)", fontWeight: 700, flexShrink: 0 }}>Open in Manage Products →</span>
                    </a>
                  ) : (
                    <div style={{ fontSize: 12.5, color: "var(--muted)", background: "#F7F8FA", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px" }}>
                      Not attached. In <b>Manage Products · Shopify</b>, open a listing and paste this video ID <b>#{row.videoCode}</b>.
                    </div>
                  )}
                </div>

                {/* CONTENT — caption AI theo từng kênh (sinh 1 lượt cho cả 5 kênh) */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", letterSpacing: ".4px" }}>CONTENT</div>
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                      {/* Chọn model AI TRƯỚC khi Generate — trống = model mặc định của server. */}
                      <select value={aiModel} onChange={(e) => onChooseModel(e.target.value)} disabled={busy}
                        title="AI model for caption generation. Blank = server default. Avoid ':free' models — they get rate-limited."
                        style={{ maxWidth: 170, padding: "5px 8px", fontSize: 11.5, borderRadius: 8, border: "1px solid var(--line)", background: "#fff" }}>
                        <option value="">Model: Default</option>
                        {aiModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                      <button disabled={busy || !row.productId} className="btn" style={{ padding: "4px 10px", fontSize: 11.5 }}
                        onClick={doCaptions} title={row.productId ? "" : "Attach to a listing first"}>✨ {row.captionsAt ? "Regenerate" : "Generate"}</button>
                    </div>
                  </div>
                  {row.captions ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      {CHANNELS.map((ch) => {
                        const c = row.captions?.[ch.key];
                        if (!c) return null;
                        const full = [c.text, (c.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n");
                        return (
                          <div key={ch.key} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 9 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                              <span style={chip("#F3F4F6", "#374151")}>{ch.label}</span>
                              <span style={{ flex: 1 }} />
                              <button onClick={() => copy(full)} className="btn" style={{ padding: "3px 9px", fontSize: 11 }}>Copy</button>
                            </div>
                            <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{c.text}</div>
                            {!!(c.hashtags ?? []).length && <div style={{ fontSize: 11.5, color: "#4338CA", marginTop: 4 }}>{c.hashtags.join(" ")}</div>}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12.5, color: "var(--muted)", background: "#F7F8FA", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px" }}>
                      {row.productId ? "No captions yet — click Generate." : "Attach to a listing first, then generate captions."}
                    </div>
                  )}
                </div>

                {/* ── DISTRIBUTION HUB (compact) · 1 dòng / điểm đến ── */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", letterSpacing: ".4px" }}>DISTRIBUTION</div>
                    <button disabled={busy} className="btn" style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 11.5 }} onClick={savePosted}>Save</button>
                  </div>
                  <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
                    {([
                      // Meta Reel = đăng 1 lần ra CẢ FB Page + Instagram (composer Meta mặc định tick cả 2).
                      // 1 link/bài nên gộp thành 1 kênh utm_source=meta; caption dùng bản IG Reel.
                      { key: "meta", label: "Meta Reel (FB+IG)", owner: "brand", capKey: "reels", opens: [["Reels composer", "https://business.facebook.com/latest/reels_composer"]] },
                      { key: "shorts", label: "YT Short", owner: "brand", opens: [["YouTube", "https://www.youtube.com/upload"]] },
                      { key: "meta_ads", label: "Meta Ads", owner: "brand", opens: [["Ads Manager", "https://adsmanager.facebook.com/adsmanager"]] },
                      // Đã bỏ TikTok (creator tự cầm + đơn qua TikTok Shop, UTM không đo được), Pinterest và GMC/PMax
                      // — khi cần thêm lại: chèn 1 dòng { key, label, owner:"brand", opens:[[label,url]] } vào mảng này.
                    ] as { key: string; label: string; owner: "creator" | "brand"; capKey?: string; opens: string[][] }[]).map((d, i) => {
                      const link = utmLink(d.key);
                      const cap = row.captions?.[d.capKey ?? d.key];
                      const capFull = cap ? [cap.text, (cap.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n") : "";
                      const done = !!posted[d.key]?.url;
                      const cr = d.owner === "creator";
                      const mini: React.CSSProperties = { padding: "3px 8px", fontSize: 11, textDecoration: "none" };
                      return (
                        <div key={d.key} style={{ padding: "7px 9px", borderTop: i ? "1px solid var(--line)" : "none", background: done ? "#F6FBF8" : "#fff" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ ...chip(cr ? "#EDE9FE" : "#E8F3EC", cr ? "#6D28D9" : "#1F6F45"), minWidth: 84, textAlign: "center" }}>{done ? "✓ " : ""}{d.label}</span>
                            {d.opens.map(([lbl, url]) => <a key={url} href={url} target="_blank" rel="noreferrer" className="btn" style={mini}>{lbl} ↗</a>)}
                            {capFull && <button className="btn" style={mini} onClick={() => copy(capFull)}>caption</button>}
                            <button disabled={!link} className="btn" style={{ ...mini, opacity: link ? 1 : .4 }} onClick={() => link && copy(link)}>UTM</button>
                            <input value={posted[d.key]?.url ?? ""} placeholder="posted link…"
                              onChange={(e) => setPostedUrl(d.key, e.target.value)} onBlur={savePosted}
                              style={{ flex: 1, minWidth: 110, padding: "4px 8px", fontSize: 11.5, borderRadius: 7, border: "1px solid var(--line)" }} />
                            {done && <a href={posted[d.key].url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--blue)", textDecoration: "none", flexShrink: 0 }}>↗</a>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* PERFORMANCE — quy đơn về video qua UTM. Orders/Revenue là số THẬT (Shopify);
                    Views/Clicks chờ Phase 2 (cần API TikTok/Meta). */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", letterSpacing: ".4px", marginBottom: 6 }}>PERFORMANCE</div>
                  {(() => {
                    const orders = perf?.orders ?? 0;
                    const revenue = perf?.revenue ?? 0;
                    const chans = perf?.channels ?? {};
                    const chanKeys = Object.keys(chans).sort((a, b) => chans[b].revenue - chans[a].revenue);
                    return (
                      <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", textAlign: "center" }}>
                          {([["Views", "—"], ["Clicks", "—"], ["Orders", String(orders)], ["Revenue", money(revenue)]] as [string, string][]).map(([k, v], i) => (
                            <div key={k} style={{ padding: "10px 6px", borderLeft: i ? "1px solid var(--line)" : "none" }}>
                              <div style={{ fontSize: 17, fontWeight: 800, color: k === "Revenue" && revenue ? "var(--green)" : "var(--ink)" }}>{v}</div>
                              <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>{k}</div>
                            </div>
                          ))}
                        </div>
                        {chanKeys.length > 0 && (
                          <div style={{ borderTop: "1px solid var(--line)" }}>
                            {chanKeys.map((k) => (
                              <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderTop: "1px solid #F1F3F7", fontSize: 12.5 }}>
                                <span style={{ flex: 1 }}>{CH_LABEL[k] ?? k}</span>
                                <span style={{ color: "var(--muted)" }}>{chans[k].orders} orders</span>
                                <b style={{ color: "var(--green)", minWidth: 64, textAlign: "right" }}>{money(chans[k].revenue)}</b>
                              </div>
                            ))}
                          </div>
                        )}
                        <div style={{ borderTop: "1px solid var(--line)", padding: "7px 12px", fontSize: 11, color: "var(--muted)", background: "#FAFBFC" }}>
                          {orders >= WIN_ORDERS
                            ? <span style={{ color: "#B45309", fontWeight: 700 }}>🔥 Winning creative</span>
                            : orders > 0
                              ? "Tracking sales via the UTM links above."
                              : "No tracked sales yet — orders attribute here once the UTM links above are used in posts/ads."}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </>
            )}

            {/* Download + Replace + Delete. Video đã gắn listing (usedBy>0) thì KHÓA Delete — tránh xoá
                video đang hiển thị trên trang sản phẩm; gỡ khỏi listing (Manage Products) trước rồi mới xoá. */}
            {canManage && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {row.publicUrl && (
                  <a href={row.publicUrl} download className="btn" style={{ textDecoration: "none" }}>⬇ Download</a>
                )}
                <input ref={repRef} type="file" accept="video/*" hidden
                  onChange={(e) => { const fl = e.target.files?.[0]; if (fl) onReplace(row, fl); if (repRef.current) repRef.current.value = ""; }} />
                <button disabled={busy} className="btn" onClick={() => repRef.current?.click()}
                  title="Replace the file after re-editing — keeps #ID, listings and captions">
                  ⟳ Replace file{row.revision > 1 ? ` (v${row.revision})` : ""}
                </button>
                <div style={{ flex: 1 }} />
                <button disabled={busy || row.usedBy > 0} className="btn"
                  style={{ color: row.usedBy > 0 ? "var(--muted)" : "#B42318", opacity: row.usedBy > 0 ? .5 : 1, cursor: row.usedBy > 0 ? "not-allowed" : "pointer" }}
                  title={row.usedBy > 0 ? "Attached to a listing — remove it in Manage Products before deleting" : "Delete video from the library"}
                  onClick={doDelete}>
                  {row.usedBy > 0 ? "🔒 Delete" : "Delete"}
                </button>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

/** Hàng "đã đăng" trên card — kênh nào có link bài thì gắn ✓. */
function PostedTicks({ postedTo }: { postedTo: Row["postedTo"] }) {
  const done = postedTo && typeof postedTo === "object"
    ? Object.keys(postedTo).filter((k) => postedTo[k]?.url) : [];
  if (!done.length) return <div style={{ fontSize: 11.5, color: "var(--muted)" }}>Not posted yet</div>;
  return (
    <div style={{ fontSize: 11.5, color: "#1F6F45", fontWeight: 600 }}>
      {done.map((k) => `${POSTED_LABEL[k] ?? k} ✓`).join(" · ")}
    </div>
  );
}

/** Dòng performance trên card — Views chờ Phase 2, Orders/Revenue quy về qua UTM. */
function PerfLine({ p }: { p?: Perf }) {
  const orders = p?.orders ?? 0;
  return (
    <div style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span style={{ color: "var(--muted)" }}>— views</span>
      <span style={{ color: "var(--line)" }}>·</span>
      <span style={{ color: orders ? "var(--ink)" : "var(--muted)", fontWeight: orders ? 700 : 400 }}>{orders} orders</span>
      <span style={{ color: "var(--line)" }}>·</span>
      <span style={{ color: orders ? "var(--green)" : "var(--muted)", fontWeight: 700 }}>{money(p?.revenue ?? 0)}</span>
      {orders >= WIN_ORDERS && <span title="Winning creative">🔥</span>}
    </div>
  );
}

/** Bulk upload — BẮT BUỘC chọn seller trước, giống Design Studio.
 *  Creator = chính người đang upload, không hỏi lại. */
function UploadModal({ sellers, creators, isAdmin, myRole, me, busy, close, go }: {
  sellers: Opt[]; creators: Opt[]; isAdmin: boolean; myRole: string; me: { id: string; name: string }; busy: boolean;
  close: () => void; go: (files: File[], who: { sellerId: string; creatorId: string }) => Promise<void>;
}) {
  // 3 vai upload:
  //  · Admin   → chọn cả Seller + Creator (danh sách đầy đủ).
  //  · Creator → CHÍNH MÌNH là creator (cố định), phải chọn Seller trong team (video làm cho seller nào).
  //  · Seller  → CHÍNH MÌNH là seller (cố định), chọn Creator trong team (không có "Me", seller ≠ creator).
  const iAmCreator = !isAdmin && myRole === "content";
  const [sellerId, setSellerId] = useState(isAdmin || iAmCreator ? "" : me.id);
  const [creatorId, setCreatorId] = useState(iAmCreator ? me.id : "");
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
            {(isAdmin || iAmCreator) ? (
              // Admin + Creator: chọn seller (creator bắt buộc chọn video làm cho seller nào).
              <select value={sellerId} onChange={(e) => setSellerId(e.target.value)}
                style={{ borderColor: sellerId ? undefined : "#F0B4AE" }}>
                <option value="">— select a seller —</option>
                {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : (
              // Seller upload: seller là CHÍNH MÌNH, cố định.
              <input value={me.name} disabled style={{ background: "#F1F3F7", color: "var(--muted)" }} />
            )}
          </div>
          <div className="field">
            <label>Creator</label>
            {iAmCreator ? (
              // Creator upload: creator là CHÍNH MÌNH, cố định.
              <input value={me.name} disabled style={{ background: "#F1F3F7", color: "var(--muted)" }} />
            ) : (
              <select value={creatorId} onChange={(e) => setCreatorId(e.target.value)}>
                <option value="">— none —</option>
                {creators.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
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
