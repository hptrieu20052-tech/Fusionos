"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useConfirm } from "@/components/confirm-provider";
import DateRangePicker, { rangeToDates, type RangeValue } from "@/components/date-range";

/**
 * v272 · Video Library — mô hình CARD cha · video con (kiểu SKU cha/variant con).
 * 1 card = 1 seller + 1 creator + 1 product listing; mã card QT-TH-01, video con .1/.2/.3.
 * Gom nhóm bằng KÉO-THẢ: kéo video lẻ thả vào card (hoặc video lẻ khác) là gộp; hoặc điền
 * "# video mẫu" lúc upload. Listing + captions là CỦA CARD (dùng chung); Points/Distribution/
 * Performance tạm ẨN (data vẫn giữ trong DB, cần thì bật lại).
 * File bay thẳng browser → R2 (presigned) nên clip 50–100MB vẫn upload được.
 */

type Caption = { text: string; hashtags: string[]; title?: string; description?: string };
type Flags = { voice?: boolean; text?: boolean; music?: boolean };
type Row = {
  id: string; videoCode: number; title: string; note: string | null;
  storageKey: string; publicUrl: string | null; thumbUrl: string | null;
  contentType: string | null; sizeBytes: number | null; durationSec: string | null;
  width: number | null; height: number | null; aspect: string | null;
  language: string | null; flags: Flags | null; revision: number; points: number;
  sourceName: string | null; shotAt: string | null;
  productId: string | null; productTitle: string | null;
  productUrl: string | null; productHandle: string | null;
  cardId: string | null; cardCode: string | null; cardSeq: number | null;
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

const LANGS = [{ v: "none", label: "No voice" }, { v: "en", label: "English" }, { v: "vi", label: "Vietnamese" }];
// Facebook & Instagram TÁCH RIÊNG ở CONTENT vì hashtag + link khác nhau (FB ít tag + link; IG nhiều tag + link bio).
const CHANNELS = [
  { key: "facebook", label: "Facebook Reel" }, { key: "instagram", label: "Instagram Reel" }, { key: "shorts", label: "YT Short" }, { key: "meta_ads", label: "Meta Ads" },
] as const;
// v281 · Đánh dấu ĐÃ ĐĂNG thủ công (không API) theo nền tảng. key khớp backend markPosted/unmarkPosted.
const POST_TARGETS = [
  { key: "facebook", label: "Facebook", color: "#1877F2" },
  { key: "reels", label: "Instagram", color: "#E1306C" },
  { key: "shorts", label: "YT Short", color: "#FF0000" },
  { key: "tiktok", label: "TikTok", color: "#111827" },
  { key: "pinterest", label: "Pinterest", color: "#E60023" },
  { key: "meta_ads", label: "Meta Ads", color: "#0081FB" }, // v371 · tick mẫu đã lên camp Meta ads
] as const;
// v272 · nhãn video con trong card: "QT-TH-01.2"; video lẻ thì "#8" như cũ.
const subId = (r: { cardCode: string | null; cardSeq: number | null; videoCode: number }) =>
  r.cardCode ? `${r.cardCode}.${r.cardSeq ?? "?"}` : `#${r.videoCode}`;

// v282 · Title rác khi upload/nhân bản: "copy_<UUID>" hoặc chuỗi UUID trần → khi đã gắn listing thì
// lấy TÊN PRODUCT làm title mặc định (khỏi hiện mã rác).
const isJunkTitle = (t: string | null | undefined) => !t || /^copy[_-]/i.test(t.trim()) || /^[0-9a-f-]{16,}$/i.test(t.trim());
const bestTitle = (r: { title: string; productTitle?: string | null }) => (isJunkTitle(r.title) && r.productTitle) ? r.productTitle : r.title;

// ── Icon line (stroke = currentColor để ăn theo màu chữ). KHÔNG dùng emoji. ──
const svgIc = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const IcUser = ({ s = 13 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" {...svgIc} style={{ flexShrink: 0 }}><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5" /></svg>;
const IcClap = ({ s = 13 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" {...svgIc} style={{ flexShrink: 0 }}><rect x="3" y="8.5" width="18" height="11.5" rx="1.5" /><path d="M3 8.5l2-4 3.6 1.2-2 4M8.6 5.7l4 1.2-2 4M14.6 6.9l4 1.2-2 4" /></svg>;
const IcFlame = ({ s = 13 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" {...svgIc} style={{ flexShrink: 0 }}><path d="M12 3c1 3-2 4.2-2 7a2 2 0 1 0 4 0c2 1 3 3 3 5a5 5 0 1 1-10 0c0-4 4-5 5-12z" /></svg>;
const IcSparkle = ({ s = 13 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" {...svgIc} style={{ flexShrink: 0 }}><path d="M12 3l1.7 4.8L18.5 9.5l-4.8 1.7L12 16l-1.7-4.8L5.5 9.5l4.8-1.7L12 3z" /></svg>;
const IcDownload = ({ s = 13 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" {...svgIc} style={{ flexShrink: 0 }}><path d="M12 3v12M7 11l5 4 5-4M5 21h14" /></svg>;
const IcLock = ({ s = 13 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" {...svgIc} style={{ flexShrink: 0 }}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
const IcRefresh = ({ s = 13 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" {...svgIc} style={{ flexShrink: 0 }}><path d="M20 11a8 8 0 1 0-2 5.3M20 5v6h-6" /></svg>;
const IcEye = ({ s = 13 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" {...svgIc} style={{ flexShrink: 0 }}><path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="2.4" /></svg>;
const IcTrash = ({ s = 14 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" {...svgIc} style={{ flexShrink: 0 }}><path d="M3 6h18" /><path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6" /><path d="M6 6l.9 13.1A2 2 0 0 0 8.9 21h6.2a2 2 0 0 0 2-1.9L18 6" /><path d="M10 10.5v6M14 10.5v6" /></svg>;

// Brand marks (favicon-style) cho từng kênh content — nhận diện nhanh FB / IG / YT / Meta.
const IcBrandFacebook = ({ s = 16 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" style={{ flexShrink: 0, display: "block" }}><path fill="#1877F2" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.6 4.5-4.6 1.3 0 2.7.2 2.7.2v2.9h-1.5c-1.5 0-1.9.9-1.9 1.8V12h3.3l-.5 3.5h-2.8v8.4A12 12 0 0 0 24 12Z" /></svg>;
const IcBrandInstagram = ({ s = 16 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" style={{ flexShrink: 0, display: "block" }}><defs><radialGradient id="fuseIg" cx="0.3" cy="1" r="1.1"><stop offset="0" stopColor="#FED576" /><stop offset="0.35" stopColor="#F47133" /><stop offset="0.65" stopColor="#BC3081" /><stop offset="1" stopColor="#4C63D2" /></radialGradient></defs><rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="url(#fuseIg)" /><circle cx="12" cy="12" r="4.6" fill="none" stroke="#fff" strokeWidth="2" /><circle cx="17.4" cy="6.6" r="1.3" fill="#fff" /></svg>;
const IcBrandYouTube = ({ s = 16 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" style={{ flexShrink: 0, display: "block" }}><rect x="1" y="5" width="22" height="14" rx="4.5" fill="#FF0000" /><path d="M10 8.5v7l6-3.5z" fill="#fff" /></svg>;
const IcBrandMeta = ({ s = 16 }: { s?: number }) => <svg width={s * 1.5} height={s} viewBox="0 0 36 24" style={{ flexShrink: 0, display: "block" }} fill="none" stroke="#0081FB" strokeWidth="3.4" strokeLinecap="round"><path d="M18 15.5C15 10 12.7 6.5 8.7 6.5 5.5 6.5 3.5 9.4 3.5 12s2 5.5 4.7 5.5c3.4 0 5.4-4 9.8-11" /><path d="M18 15.5C21 10 23.3 6.5 27.3 6.5c3.2 0 5.2 2.9 5.2 5.5s-2 5.5-4.7 5.5c-3.4 0-5.4-4-9.8-11" /></svg>;
const PlatIcon = ({ k, s = 16 }: { k: string; s?: number }) =>
  k === "facebook" ? <IcBrandFacebook s={s} /> : k === "instagram" ? <IcBrandInstagram s={s} /> : k === "shorts" ? <IcBrandYouTube s={s} /> : k === "meta_ads" ? <IcBrandMeta s={s} /> : null;

const chip = (bg: string, fg: string): React.CSSProperties => ({ display: "inline-block", background: bg, color: fg, borderRadius: 999, padding: "2px 9px", fontSize: 11, fontWeight: 800 });
const pgBtn: React.CSSProperties = { minWidth: 34, height: 34, borderRadius: 9, border: "1px solid var(--line)", background: "#fff", cursor: "pointer", fontSize: 13 };
const mb = (n: number | null) => n == null ? "—" : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
const secs = (s: string | null) => { const n = Number(s); return isFinite(n) && n > 0 ? `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, "0")}` : "—"; };
const LIMIT = 24;

export default function VideosClient({ isAdmin, myRole, canManage, me }: { isAdmin: boolean; myRole: string; canManage: boolean; me: { id: string; name: string } }) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  // v360 · Perf theo UTM (đơn + doanh thu quy về từng video qua utm_campaign=video_<code>).
  const [perf, setPerf] = useState<Record<string, { orders: number; revenue: number; channels?: Record<string, { orders: number; revenue: number }> }>>({});
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
  // v272 · Gom theo CARD (card cha — video con). Video chưa vào card vẫn là ô lẻ như cũ.
  const [grouped, setGrouped] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  // v272 · kéo-thả gom card: id video lẻ đang kéo + id nhóm đang rê qua (để highlight).
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Model AI cho nút Generate caption — chọn TRƯỚC khi generate. Dùng chung danh sách với các trang AI khác.
  const [aiModels, setAiModels] = useState<{ id: string; name: string }[]>([]);
  const [aiModel, setAiModel] = useState("");
  useEffect(() => {
    try { const s = window.localStorage.getItem("videosAiModel"); if (s) setAiModel(s); } catch { /* ignore */ }
    // Caption GỬI KÈM ẢNH (ảnh listing + frame video) nên chỉ liệt kê model ĐỌC ĐƯỢC ẢNH (vision).
    // Model text-thuần / gen-ảnh không hiện ở đây — tránh chọn nhầm model không xem được ảnh.
    if (isAdmin) fetch("/api/books/models?type=vision").then((r) => r.json())
      .then((j) => { if (Array.isArray(j?.models)) setAiModels(j.models); }).catch(() => { /* offline */ });
  }, [isAdmin]);
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
        // v360 · Bật lại Performance: kéo đơn/doanh thu quy về từng video (utm_campaign=video_<code>).
        const codes = (j.rows ?? []).map((r: Row) => r.videoCode).filter((n: number) => n > 0);
        if (codes.length) {
          fetch(`/api/videos/performance?codes=${codes.join(",")}`).then((r) => r.json())
            .then((pj) => setPerf(pj?.ok ? (pj.perf ?? {}) : {})).catch(() => setPerf({}));
        } else setPerf({});
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

  // v360 · Perf helpers — quy đơn/doanh thu về từng video và cộng tổng theo card.
  const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
  const perfOf = (code: number) => perf[String(code)] as { orders: number; revenue: number } | undefined;
  const sumPerf = (vids: { videoCode: number }[]) => vids.reduce((a, v) => {
    const p = perf[String(v.videoCode)];
    return { orders: a.orders + (p?.orders ?? 0), revenue: Math.round((a.revenue + (p?.revenue ?? 0)) * 100) / 100 };
  }, { orders: 0, revenue: 0 });

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

  const onPick = async (files: FileList | File[] | null, who: { sellerId: string; creatorId: string; sameCode?: string }) => {
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
            // v271 · điền "# video mẫu" lúc upload → video mới copy product của mẫu, tự vào đúng card nhóm.
            ...(who.sameCode?.trim() ? { sameAsCode: Number(who.sameCode.replace(/[^0-9]/g, "")) } : {}),
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

  const patch = async (body: Record<string, unknown>, okText?: string): Promise<boolean> => {
    setBusy(true);
    let ok = false;
    try {
      const j = await fetch("/api/videos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
      if (j.ok) { ok = true; if (okText) flash("✓ " + okText); await load(page); }
      else flash("✗ " + (j.error ?? "failed"), false);
    } catch { flash("✗ Network error", false); }
    setBusy(false);
    return ok;
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

  // v272 · Nhóm theo CARD (trong trang hiện tại). Video lẻ = nhóm 1 phần tử. Trong card xếp theo số con.
  const groups = useMemo<Row[][]>(() => {
    if (!grouped) return rows.map((r) => [r]);
    const byCard = new Map<string, Row[]>();
    const out: Row[][] = [];
    for (const r of rows) {
      if (r.cardId) {
        const g = byCard.get(r.cardId);
        if (g) { g.push(r); continue; }
        const arr = [r]; byCard.set(r.cardId, arr); out.push(arr);
      } else out.push([r]);
    }
    for (const g of out) if (g.length > 1) g.sort((a, b) => (a.cardSeq ?? 0) - (b.cardSeq ?? 0));
    return out;
  }, [rows, grouped]);
  // Video con cùng card của video đang mở — cho dải chuyển video trong modal.
  const siblings = useMemo<Row[]>(() => {
    if (!openRow?.cardId) return openRow ? [openRow] : [];
    return rows.filter((r) => r.cardId === openRow.cardId).sort((a, b) => (a.cardSeq ?? 0) - (b.cardSeq ?? 0));
  }, [rows, openRow]);

  // v272 · Kéo-thả gom card: kéo video LẺ thả vào 1 nhóm. Nhóm đích là card → join card đó;
  // nhóm đích là video lẻ → tạo card mới (video đích là con số 1 = anchor/thumbnail).
  const mergeInto = async (draggedId: string, target: Row) => {
    if (draggedId === target.id) return;
    setBusy(true);
    try {
      const body = target.cardId
        ? { videoId: draggedId, cardId: target.cardId }
        : { videoIds: [target.id, draggedId] };
      const j = await fetch("/api/videos/cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
      if (j.ok) { flash(`✓ Grouped into card ${j.code ?? target.cardCode ?? ""}`.trim()); await load(page); }
      else flash("✗ " + (j.error ?? "group failed"), false);
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <h2 style={{ fontWeight: 800, fontSize: 19, margin: 0 }}>Video Library</h2>
        <div style={{ flex: 1 }} />
        <button onClick={() => setGrouped((v) => !v)} className="btn" title="Group videos of the same card together (drag a video onto another to group)"
          style={{ padding: "7px 12px", fontSize: 12.5, fontWeight: 700, ...(grouped ? { background: "#EEF2FF", borderColor: "#C7D2FE", color: "#4338CA" } : {}) }}>
          {grouped ? "✓ " : ""}Group by card
        </button>
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
        // Toast NỔI trên cùng (z cao hơn modal 3000) — trước đây nằm trong luồng trang nên bị modal che.
        <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 5000, padding: "11px 18px", borderRadius: 10, fontSize: 13, fontWeight: 700, boxShadow: "0 10px 30px rgba(17,24,39,.22)", background: msg.ok ? "#E9F7EF" : "#FEE4E2", color: msg.ok ? "#1F6F45" : "#B42318", maxWidth: "90vw" }}>
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
          {groups.map((g) => {
            const r = g[0];
            const many = g.length > 1;
            // Creator hiện trên card nhóm: gộp tên (không trùng) — mỗi video vẫn giữ creator riêng trong modal.
            const creatorNames = Array.from(new Set(g.map((x) => x.sourceName || x.creatorName || x.uploader || "").filter(Boolean)));
            // v272 · kéo-thả: chỉ video LẺ kéo được (video trong card thì tách bằng nút ✕ trong modal);
            // MỌI ô đều nhận thả — thả vào card = join, thả vào video lẻ = tạo card mới.
            const draggable = canManage && !r.cardId && g.length === 1;
            const isDropping = dropTarget === r.id && dragId && dragId !== r.id;
            // v281 · chấm màu "đã đăng" — gộp mọi nền tảng đã tick của các video trong card.
            const postedKeys = new Set<string>();
            for (const v of g) { const pt = v.postedTo as Record<string, unknown> | null; if (pt) Object.keys(pt).forEach((k) => postedKeys.add(k)); }
            const postedDots = POST_TARGETS.filter((t) => postedKeys.has(t.key));
            return (
            <div key={r.id} className="card" onClick={() => setOpen(r.id)}
              draggable={draggable}
              onDragStart={(e) => { if (!draggable) return; setDragId(r.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", r.id); }}
              onDragEnd={() => { setDragId(null); setDropTarget(null); }}
              onDragOver={(e) => { if (dragId && dragId !== r.id) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropTarget(r.id); } }}
              onDragLeave={() => { if (dropTarget === r.id) setDropTarget(null); }}
              onDrop={(e) => { e.preventDefault(); const src = dragId ?? e.dataTransfer.getData("text/plain"); setDragId(null); setDropTarget(null); if (src && src !== r.id) mergeInto(src, r); }}
              title={draggable ? "Drag onto another video/card to group them" : undefined}
              style={{ overflow: "hidden", cursor: "pointer", display: "flex", flexDirection: "column",
                opacity: dragId === r.id ? .45 : 1,
                outline: isDropping ? "2.5px dashed #4338CA" : "none", outlineOffset: -2,
                transition: "opacity .15s" }}>
              <div style={{ position: "relative", aspectRatio: "4/5", background: "#0B1220", overflow: "hidden" }}>
                {r.thumbUrl
                  ? <img src={r.thumbUrl} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 12, fontWeight: 700 }}>NO PREVIEW</div>}
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                  <span style={{ width: 42, height: 42, borderRadius: 999, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z" /></svg>
                  </span>
                </div>
                {/* v281 · chấm "đã đăng" ở góc trên-trái — nhìn phát biết video đã lên nền tảng nào */}
                {postedDots.length > 0 && (
                  <div style={{ position: "absolute", top: 8, left: 8, display: "flex", gap: 4 }} title={`Posted: ${postedDots.map((d) => d.label).join(", ")}`}>
                    {postedDots.map((d) => (
                      <span key={d.key} style={{ width: 14, height: 14, borderRadius: 999, background: d.color, border: "1.5px solid #fff", boxShadow: "0 1px 3px rgba(0,0,0,.35)" }} />
                    ))}
                  </div>
                )}
                {/* v271 · badge số creative của sản phẩm này */}
                {many && (
                  <span style={{ position: "absolute", top: 8, right: 8, display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 999, background: "rgba(0,0,0,.66)", color: "#fff", fontSize: 11.5, fontWeight: 800 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M22 9l-6 3 6 3z" /></svg>
                    {g.length}
                  </span>
                )}
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
              {/* v295 · Dải video con dưới preview — như dải Mockup của card Design Studio.
                  Click 1 thumb = mở modal đúng video đó (không phải video đại diện). */}
              {many && (
                <div onClick={(e) => e.stopPropagation()}
                  style={{ display: "flex", gap: 8, padding: "8px 10px", overflowX: "auto", background: "#F7F8FA", borderTop: "1px solid var(--line)" }}>
                  {g.map((v) => (
                    <div key={v.id} onClick={() => setOpen(v.id)} title={v.title}
                      style={{ flexShrink: 0, width: 60, cursor: "pointer", textAlign: "center" }}>
                      <div style={{ width: 60, height: 80, borderRadius: 8, overflow: "hidden", background: "#0B1220", border: "1.5px solid var(--line)" }}>
                        {v.thumbUrl
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={v.thumbUrl} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 9, fontWeight: 700 }}>—</div>}
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        .{v.cardSeq ?? "?"} · {secs(v.durationSec)}
                      </div>
                      {/* v360 · perf theo TỪNG video (đơn · doanh thu) */}
                      {(() => {
                        const p = perfOf(v.videoCode);
                        return p && p.orders > 0 ? (
                          <div style={{ fontSize: 9.5, fontWeight: 800, color: "#166534", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>🛒{p.orders} · {money(p.revenue)}</div>
                        ) : null;
                      })()}
                    </div>
                  ))}
                </div>
              )}
              {/* Card gọn: mã card (QT-TH-01) hoặc #id video lẻ · tên product · seller/creator · size. */}
              <div className="dc-body" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="dc-top">
                  <span className="dc-id" style={{ cursor: "pointer" }} title="Copy ID"
                    onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(r.cardCode ?? String(r.videoCode)); }}>
                    {r.cardCode ?? `#${r.videoCode}`}
                  </span>
                  <span className="dc-date">{new Date(r.createdAt).toLocaleString()}</span>
                </div>
                {/* Tiêu đề card = TÊN PRODUCT (nếu đã gắn listing); chưa gắn thì fallback tên video. */}
                <div className="dc-title" style={{ fontWeight: 700 }}>
                  <span title={r.productTitle || r.title} style={{ cursor: "pointer" }}
                    onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(r.productTitle || r.title); }}>{r.productTitle || r.title}</span>
                </div>
                <div className="dc-meta"><span>Seller</span><b>{r.sellerName ?? "—"}</b></div>
                <div className="dc-meta"><span>Creator</span><b>{creatorNames.length ? creatorNames.join(", ") : "—"}</b></div>
                {/* v360 · TỔNG performance của cả product (cộng đơn/doanh thu mọi video trong card) */}
                {(() => {
                  const tp = sumPerf(g);
                  return tp.orders > 0 ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "auto", fontSize: 12.5, fontWeight: 800, color: "#166534", background: "#ECFDF3", border: "1px solid #BBF7D0", borderRadius: 8, padding: "5px 9px" }}>
                      <span>🛒 {tp.orders} order{tp.orders > 1 ? "s" : ""}</span>
                      <span style={{ marginLeft: "auto", color: "#065F46" }}>{money(tp.revenue)}</span>
                    </div>
                  ) : null;
                })()}
                <div className="dc-foot" style={{ marginTop: sumPerf(g).orders > 0 ? 6 : "auto" }}>
                  <span>{many ? `${g.length} videos` : (r.width && r.height ? `${r.width}×${r.height}` : (r.aspect ?? "—"))}</span>
                  <span>{many ? mb(g.reduce((a, x) => a + (x.sizeBytes ?? 0), 0)) : mb(r.sizeBytes)}</span>
                </div>
              </div>
            </div>
            );
          })}
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
          key={openRow.id} row={openRow} canManage={canManage} isAdmin={isAdmin} myRole={myRole} busy={busy} setBusy={setBusy}
          close={() => setOpen(null)} reload={() => load(page)} flash={flash} patch={patch}
          sellers={sellers} creators={creators} confirm={confirm} onReplace={doReplace}
          aiModels={aiModels} aiModel={aiModel} onChooseModel={chooseModel}
          siblings={siblings} onSwitch={(id) => setOpen(id)}
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

/** Chi tiết CARD: thông tin card (mã, seller/creator, listing, captions dùng chung) + dải video con.
 *  Mở từ video nào thì video đó đang chọn; bấm thumbnail để chuyển; ✕ trên thumbnail = tách khỏi card. */
function VideoDetail({ row, canManage, isAdmin, myRole, busy, setBusy, close, reload, flash, patch, sellers, creators, confirm, onReplace, aiModels, aiModel, onChooseModel, siblings = [], onSwitch }: {
  row: Row; canManage: boolean; isAdmin: boolean; myRole: string; busy: boolean; setBusy: (b: boolean) => void;
  close: () => void; reload: () => Promise<void> | void; flash: (m: string, ok?: boolean) => void;
  patch: (b: Record<string, unknown>, ok?: string) => Promise<boolean>;
  sellers: Opt[]; creators: Opt[]; confirm: ReturnType<typeof useConfirm>;
  onReplace: (row: Row, file: File) => Promise<void>;
  aiModels: { id: string; name: string }[]; aiModel: string; onChooseModel: (m: string) => void;
  siblings?: Row[]; onSwitch?: (id: string) => void;
}) {
  const [types, setTypes] = useState<TypeOpt[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [pickType, setPickType] = useState("");
  // Tìm listing theo tên để gán nhanh (1 video 1 listing) — khỏi đi dò trên Shopify.
  const [lq, setLq] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const repRef = useRef<HTMLInputElement>(null);
  // v272c · loading khi AI đang viết caption — giống thanh chạy bên Manage Products · Shopify.
  const [genBusy, setGenBusy] = useState(false);
  // v273 · trạng thái đang đăng Meta (IG + FB) — đăng mất 1–4 phút (Meta tải video từ R2 rồi xử lý).
  const [posting, setPosting] = useState(false);
  const [f, setF] = useState({
    title: bestTitle(row), note: row.note ?? "", language: row.language ?? "", points: row.points ?? 0,
    sellerId: row.sellerId ?? "", creatorId: row.creatorId ?? "",
    sourceName: row.sourceName ?? "", shotAt: row.shotAt ?? "",
    voice: !!row.flags?.voice, text: !!row.flags?.text, music: !!row.flags?.music,
  });
  // v282 · đổi video con / vừa gắn listing → cập nhật lại Title mặc định (lấy tên product nếu title còn rác).
  useEffect(() => { setF((prev) => ({ ...prev, title: bestTitle(row) })); }, [row.id, row.productTitle, row.title]);

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
    // v276 · dán UUID → attach thẳng, khỏi search tên.
    if (q.length < 2 || /^[0-9a-f-]{36}$/i.test(q)) { setMatches([]); return; }
    const t = setTimeout(async () => {
      try {
        const j = await fetch(`/api/videos/assign?videoId=${row.id}&q=${encodeURIComponent(q)}`).then((r) => r.json());
        if (j.ok) setMatches(j.matches ?? []);
      } catch { /* im */ }
    }, 300);
    return () => clearTimeout(t);
  }, [lq, row.id]);

  // 1 nút Save chung: details + seller/creator. (Points/postedTo tạm ẩn UI — không gửi để khỏi ghi đè data cũ.)
  const save = () => patch({
    id: row.id, title: f.title.trim(), note: f.note, language: f.language || null,
    sellerId: f.sellerId || null, creatorId: f.creatorId || null,
    sourceName: f.sourceName || null, shotAt: f.shotAt || null,
    flags: { voice: f.voice, text: f.text, music: f.music },
  }, "Saved");

  // v281 · Đánh dấu ĐÃ ĐĂNG thủ công theo nền tảng (không có API → user tự tick). Toggle qua PATCH.
  const togglePosted = async (key: string) => {
    const done = !!row.postedTo?.[key];
    await patch({ id: row.id, [done ? "unmarkPosted" : "markPosted"]: key }, done ? "Unmarked" : "Marked as posted");
  };

  // v272 · Gắn listing cho CẢ CARD (server đồng bộ productId xuống mọi video con + AI captions).
  const attachSource = async (productId: string, title: string) => {
    setBusy(true);
    try {
      const j = await fetch("/api/videos/assign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoId: row.id, sourceProductId: productId }) }).then((r) => r.json());
      if (j.ok) { flash(`✓ Attached to "${title.slice(0, 60)}"`); setLq(""); setMatches([]); await reload(); }
      else flash("✗ " + (j.error ?? "failed"), false);
    } catch { flash("✗ Network error", false); }
    setBusy(false);
  };

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
    setBusy(true); setGenBusy(true);
    try {
      const j = await fetch("/api/videos/captions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id, model: aiModel || undefined, withImages: true }) }).then((r) => r.json());
      if (j.ok) { flash("✓ Captions written"); await reload(); } else flash("✗ " + (j.error ?? "failed"), false);
    } catch { flash("✗ Network error", false); }
    setBusy(false); setGenBusy(false);
  };

  // v273 · 1 nút đăng CẢ Instagram Reel + Facebook Page Reel. Cần captions trước (IG/FB dùng
  // đúng caption per-video). Server trả link bài từng kênh; lỗi kênh nào báo kênh đó.
  const doPostMeta = async () => {
    if (!row.captions) return flash("✗ Generate captions first — the post uses this video's captions", false);
    if (!(await confirm({ message: `Post ${subId(row)} to Instagram Reel + Facebook Page Reel now?`, confirmText: "Post", tone: "green" }))) return;
    setBusy(true); setPosting(true);
    try {
      const j = await fetch("/api/videos/post-meta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id }) }).then((r) => r.json());
      if (j.ok) {
        const parts = [j.ig ? "IG ✓" : null, j.fb ? "FB ✓" : null, ...(j.errors ?? [])].filter(Boolean);
        flash("✓ Posted — " + parts.join(" · "));
        await reload();
      } else flash("✗ " + (j.error ?? "post failed"), false);
    } catch { flash("✗ Network error", false); }
    setBusy(false); setPosting(false);
  };

  const doDelete = async () => {
    if (!(await confirm({ title: "Delete video", message: `Remove "${row.title}" from the library?`, danger: true, confirmText: "Delete" }))) return;
    setBusy(true);
    const j = await fetch(`/api/videos?id=${row.id}`, { method: "DELETE" }).then((x) => x.json()).catch(() => null);
    if (j?.ok) { flash("✓ Deleted"); close(); await reload(); } else flash("✗ " + (j?.error ?? "failed"), false);
    setBusy(false);
  };

  // v272 · Tách 1 video con khỏi card (card rỗng thì server tự xoá card).
  const doDetach = async (v: Row) => {
    if (!(await confirm({ title: "Remove from card", message: `Take ${subId(v)} out of this card? The video stays in the library as a standalone video.`, confirmText: "Remove" }))) return;
    setBusy(true);
    try {
      const j = await fetch("/api/videos/cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoId: v.id, detach: true }) }).then((r) => r.json());
      if (j.ok) { flash("✓ Removed from card"); if (v.id === row.id) close(); await reload(); }
      else flash("✗ " + (j.error ?? "failed"), false);
    } catch { flash("✗ Network error", false); }
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
  const cbx = (k: "voice" | "text" | "music", label: string) => (
    <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600 }}>
      <input type="checkbox" checked={f[k]} disabled={!canManage} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> {label}
    </label>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.5)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }} onClick={close}>
      <div className="card" style={{ width: siblings.length > 1 ? 1150 : 940, maxWidth: "97vw", maxHeight: "92vh", overflowY: "auto", overflowX: "hidden", padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          {/* Mã CARD trước (QT-TH-01), mã con của video đang chọn sau (.2). Video lẻ chỉ có #id. */}
          <span style={chip("#EEF2FF", "#4338CA")}>{row.cardCode ?? `#${row.videoCode}`}</span>
          {row.cardCode && <span style={chip("#F3F4F6", "#374151")}>{subId(row)} · #{row.videoCode}</span>}
          <div style={{ fontWeight: 800, fontSize: 16, flex: 1 }}>{row.productTitle || row.title}</div>
          <button onClick={close} className="btn" style={{ padding: "6px 11px" }}>✕</button>
        </div>

        {/* v272c · Layout 2 cột theo user: TRÁI = danh sách video con của card (bấm để chuyển),
            PHẢI = chi tiết + CONTENT RIÊNG của video đang chọn (caption đã trả về per-video). */}
        <div style={{ display: "grid", gridTemplateColumns: siblings.length > 1 ? "216px minmax(0,264px) minmax(0,1fr)" : "minmax(0,280px) minmax(0,1fr)", gap: 20 }}>
          {siblings.length > 1 && (
            <div style={{ borderRight: "1px solid var(--line)", paddingRight: 16, display: "flex", flexDirection: "column", gap: 8, alignContent: "start", alignSelf: "start" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", letterSpacing: ".4px" }}>VIDEOS IN THIS CARD · {siblings.length}</div>
              {siblings.map((s) => {
                const active = s.id === row.id;
                return (
                  <div key={s.id} onClick={() => !active && onSwitch?.(s.id)} title={s.title}
                    style={{ display: "flex", gap: 9, alignItems: "center", padding: "7px 8px", borderRadius: 11, cursor: active ? "default" : "pointer",
                      background: active ? "#EEF2FF" : "transparent", border: active ? "1.5px solid #C7D2FE" : "1.5px solid var(--line)" }}>
                    <div style={{ width: 46, height: 60, borderRadius: 8, overflow: "hidden", background: "#0B1220", flexShrink: 0 }}>
                      {s.thumbUrl
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={s.thumbUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        : null}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 800, color: active ? "#4338CA" : "var(--ink)" }}>{s.cardCode ? `.${s.cardSeq ?? "?"}` : `#${s.videoCode}`}</div>
                      <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 1 }}>#{s.videoCode} · {secs(s.durationSec)}</div>
                      {/* mỗi video content RIÊNG → đánh dấu video nào đã có caption */}
                      <div style={{ fontSize: 10.5, fontWeight: 700, marginTop: 1, color: s.captionsAt ? "#1F6F45" : "var(--muted)" }}>{s.captionsAt ? "content ✓" : "no content"}</div>
                    </div>
                    {canManage && (
                      <button onClick={(e) => { e.stopPropagation(); doDetach(s); }} title="Remove from card"
                        style={{ width: 20, height: 20, borderRadius: 999, border: "none", cursor: "pointer", background: "#F1F3F7", color: "var(--muted)", fontSize: 10, lineHeight: "20px", padding: 0, flexShrink: 0 }}>✕</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            {row.publicUrl && (
              <video src={row.publicUrl} poster={row.thumbUrl ?? undefined} controls playsInline
                style={{ width: "100%", borderRadius: 12, background: "#0B1220", maxHeight: 400 }} />
            )}
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8, lineHeight: 1.8 }}>
              {row.width}×{row.height} · {row.aspect ?? "—"} · {secs(row.durationSec)} · {mb(row.sizeBytes)}<br />
              Uploaded by {row.uploader ?? "—"} · {new Date(row.createdAt).toLocaleDateString()}
            </div>
            {/* Thao tác riêng cho FILE video: Download · Copy link · Replace — đặt ngay dưới video. */}
            <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
              {row.publicUrl && (
                <a href={row.publicUrl} download className="btn" style={{ padding: "6px 11px", fontSize: 12, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}><IcDownload /> Download</a>
              )}
              {row.publicUrl && (
                <button onClick={() => copy(row.publicUrl!)} className="btn" style={{ padding: "6px 11px", fontSize: 12 }}>Copy link</button>
              )}
              {canManage && <>
                <input ref={repRef} type="file" accept="video/*" hidden
                  onChange={(e) => { const fl = e.target.files?.[0]; if (fl) onReplace(row, fl); if (repRef.current) repRef.current.value = ""; }} />
                <button disabled={busy} className="btn" onClick={() => repRef.current?.click()}
                  title="Replace the file after re-editing — keeps #ID, listings and captions"
                  style={{ padding: "6px 11px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <IcRefresh /> Replace{row.revision > 1 ? ` (v${row.revision})` : ""}
                </button>
              </>}
            </div>
            {/* v273 · Post to Meta — CHỈ admin. 1 nút đăng cả IG Reel + FB Page Reel. */}
            {isAdmin && (
              <button disabled={busy || posting} onClick={doPostMeta}
                title={row.captions ? "Publish this video to Instagram Reels + Facebook Page Reels" : "Generate captions first"}
                style={{ width: "100%", marginTop: 9, padding: "10px 12px", borderRadius: 10, border: "1px solid #1877F2",
                  background: posting ? "#EAF2FE" : "#1877F2", color: posting ? "#1877F2" : "#fff",
                  fontWeight: 800, fontSize: 12.5, cursor: busy || posting ? "not-allowed" : "pointer",
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                {posting
                  ? <><span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid #A8C7F5", borderTopColor: "#1877F2", borderRadius: "50%", animation: "fusionSpin .7s linear infinite" }} />Posting to IG + FB… (1–4 min)</>
                  : <>Post to Meta (FB+IG)</>}
              </button>
            )}
            {posting && <style>{"@keyframes fusionSpin{to{transform:rotate(360deg)}}"}</style>}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            {/* 1 · Thông tin cơ bản — chỉ giữ field thật sự dùng ở Phase 1 */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", letterSpacing: ".4px", marginBottom: 8 }}>DETAILS</div>
              <div className="filters" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)" }}>
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <label>Title</label>
                  {/* v272e · click = copy luôn (vẫn gõ sửa bình thường) */}
                  <input value={f.title} disabled={!canManage} title="Click to copy"
                    onClick={() => f.title && copy(f.title)}
                    onChange={(e) => setF({ ...f, title: e.target.value })} />
                </div>
                {/* v272d · ID + Seller + Creator gọn 1 hàng 3 cột (đỡ chiếm diện tích). Points vẫn ẩn. */}
                <div className="field">
                  <label>ID</label>
                  <input value={row.cardCode ? `${subId(row)} (#${row.videoCode})` : `#${row.videoCode}`} readOnly title="Click to copy"
                    onClick={() => copy(row.cardCode ? subId(row) : `#${row.videoCode}`)}
                    style={{ background: "#EDEFF4", color: "var(--muted)", cursor: "pointer" }} />
                </div>
                <div className="field">
                  <label>Seller</label>
                  <select value={f.sellerId} disabled={!canManage} onChange={(e) => setF({ ...f, sellerId: e.target.value })}>
                    <option value="">—</option>
                    {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Creator</label>
                  <select value={f.creatorId} disabled={!canManage} onChange={(e) => setF({ ...f, creatorId: e.target.value })}>
                    <option value="">—</option>
                    {creators.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* v281 · ĐÃ ĐĂNG — tick tay theo nền tảng (không có API để tự nhận). Ẩn với role Creator. */}
            {(isAdmin || myRole !== "content") && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", letterSpacing: ".4px", marginBottom: 8 }}>POSTED · tick when done</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {POST_TARGETS.map((t) => {
                    const raw = row.postedTo?.[t.key] as unknown;
                    const done = !!raw;
                    const when = typeof raw === "string" ? raw : (raw as { at?: string } | null)?.at;
                    return (
                      <button key={t.key} disabled={busy} onClick={() => togglePosted(t.key)}
                        title={done && when ? `Posted ${new Date(when).toLocaleDateString()} — click to unmark` : "Click to mark as posted"}
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 999, cursor: busy ? "default" : "pointer",
                          border: done ? `1.5px solid ${t.color}` : "1.5px solid var(--line)",
                          background: done ? t.color : "#fff", color: done ? "#fff" : "var(--muted)", fontSize: 12, fontWeight: 700 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 999, background: done ? "#fff" : t.color, opacity: done ? 1 : .45, flexShrink: 0 }} />
                        {t.label}{done ? " ✓" : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* LISTING — chỉ admin. v271: gắn/đổi sản phẩm NGAY TẠI ĐÂY bằng ô search (chỉ set nguồn
                productId để nhóm card + AI captions — KHÔNG đổi video hero đang hiện trên Shopify). */}
            {isAdmin && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)", marginBottom: 6 }}>LISTING</div>
                  {row.productId && row.productTitle ? (
                    <a href={`/shopify-products?q=${encodeURIComponent(row.productTitle)}`} target="_blank" rel="noreferrer"
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", border: "1px solid var(--line)", borderRadius: 10, textDecoration: "none", color: "var(--ink)", fontSize: 13, background: "#F7FBFF" }}>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.productTitle}</span>
                      <span style={{ color: "var(--blue)", fontWeight: 700, flexShrink: 0 }}>Open in Manage Products →</span>
                    </a>
                  ) : null}
                  <div style={{ position: "relative", marginTop: row.productId ? 8 : 0 }}>
                    {/* v276 · dán product ID để attach thẳng (khỏi search tên). Nhận UUID: gõ/dán rồi Enter. */}
                    <input value={lq} onChange={(e) => setLq(e.target.value)} disabled={busy}
                      onKeyDown={(e) => { if (e.key === "Enter" && /^[0-9a-f-]{36}$/i.test(lq.trim())) { e.preventDefault(); attachSource(lq.trim(), lq.trim()); } }}
                      placeholder={row.productId ? "Change — paste product ID or type a name…" : "Paste product ID (fast) or type a listing name…"}
                      style={{ width: "100%", padding: "9px 12px", fontSize: 13, borderRadius: 10, border: "1px solid var(--line)" }} />
                    {/* Dán đúng 1 product ID (UUID) → hiện nút attach thẳng, khỏi chờ search. */}
                    {/^[0-9a-f-]{36}$/i.test(lq.trim()) && (
                      <div onClick={() => attachSource(lq.trim(), lq.trim())}
                        style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50, background: "#EEF2FF", border: "1px solid #C7D2FE", borderRadius: 10, padding: "9px 12px", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "#4338CA", display: "flex", alignItems: "center", gap: 8 }}>
                        <IcSparkle /> Attach this product ID <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>press Enter</span>
                      </div>
                    )}
                    {!/^[0-9a-f-]{36}$/i.test(lq.trim()) && lq.trim().length >= 2 && matches.length > 0 && (
                      <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50, background: "#fff", border: "1px solid var(--line)", borderRadius: 10, boxShadow: "0 12px 32px rgba(16,24,40,.16)", maxHeight: 240, overflowY: "auto", padding: 4 }}>
                        {matches.map((m) => (
                          <div key={m.id} onClick={() => attachSource(m.id, m.title)}
                            style={{ padding: "8px 10px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "#F5F7FA"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                            <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
            )}

            {/* CONTENT — ẨN với role Creator (v272b: creator chỉ quay clip, không cần thấy caption/
                listing data); admin + seller xem & copy; ô chọn model AI + Regenerate CHỈ admin. */}
            {(isAdmin || myRole !== "content") && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", letterSpacing: ".4px" }}>CONTENT · {subId(row)}</div>
                    {isAdmin && (
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                      {/* Chọn model AI TRƯỚC khi Generate. Chỉ liệt kê model đọc được ảnh (vision). */}
                      <span title="Only image-reading (vision) models are listed — captions are generated with the product image" style={{ color: "var(--muted)", display: "inline-flex" }}><IcEye /></span>
                      <select value={aiModel} onChange={(e) => onChooseModel(e.target.value)} disabled={busy}
                        title="Vision AI model for caption generation. Blank = server default. Avoid ':free' models — they get rate-limited."
                        style={{ maxWidth: 168, padding: "5px 8px", fontSize: 11.5, borderRadius: 8, border: "1px solid var(--line)", background: "#fff" }}>
                        <option value="">Model: Default</option>
                        {aiModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                      <button disabled={busy || genBusy || !row.productId} className="btn" style={{ padding: "4px 10px", fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 5 }}
                        onClick={doCaptions} title={row.productId ? "" : "Attach to a listing first"}>
                        {genBusy
                          ? <span style={{ display: "inline-block", width: 11, height: 11, border: "2px solid #C9B8F5", borderTopColor: "#7C5CFF", borderRadius: "50%", animation: "fusionSpin .7s linear infinite" }} />
                          : <IcSparkle />} {genBusy ? "Writing…" : row.captionsAt ? "Regenerate" : "Generate"}</button>
                    </div>
                    )}
                  </div>
                  {genBusy ? (
                    <div style={{ border: "1px solid #D7CCF5", background: "#F8F6FF", borderRadius: 10, padding: "14px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 700, color: "#5B3FBF" }}>
                        <span style={{ display: "inline-block", width: 13, height: 13, border: "2px solid #C9B8F5", borderTopColor: "#7C5CFF", borderRadius: "50%", animation: "fusionSpin .7s linear infinite" }} />
                        <span>AI is writing captions for {subId(row)}…</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 7 }}>Reading the listing images + video frame — usually 15–60 seconds. Keep this open.</div>
                      <style>{"@keyframes fusionSpin{to{transform:rotate(360deg)}}"}</style>
                    </div>
                  ) : row.captions ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                      {CHANNELS.map((ch) => {
                        const c = row.captions?.[ch.key];
                        if (!c) return null;
                        // v275 · META ADS = khối riêng, map đúng 3 ô ở Meta Ads Manager: Primary text /
                        // Headline / Description, mỗi ô 1 nút Copy. Kèm link UTM ads (URL sạch + params).
                        if (ch.key === "meta_ads") {
                          const adParams = `utm_source=meta_ads&utm_medium=video&utm_campaign=video_${row.videoCode}`;
                          const adUrl = (() => { try { return new URL(row.productUrl!).origin + new URL(row.productUrl!).pathname; } catch { return row.productUrl ?? ""; } })();
                          const fieldRow = (label: string, val: string, multiline = false) => (
                            <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "7px 9px", background: "#fff" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: multiline ? 4 : 0 }}>
                                <span style={chip("#E4EAF1", "#475569")}>{label}</span>
                                {!multiline && <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{val}</span>}
                                <span style={{ flex: multiline ? 1 : 0 }} />
                                <button onClick={() => copy(val)} className="btn" style={{ padding: "2px 8px", fontSize: 11, flexShrink: 0 }}>Copy</button>
                              </div>
                              {multiline && <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{val}</div>}
                            </div>
                          );
                          return (
                            <div key={ch.key} style={{ border: "1px solid #C7D2FE", borderRadius: 12, padding: 12, background: "#F7F9FF", minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                <PlatIcon k={ch.key} />
                                <span style={{ fontSize: 12.5, fontWeight: 800, color: "#4338CA" }}>{ch.label}</span>
                                <span style={{ fontSize: 10.5, color: "var(--muted)" }}>paste each field into Ads Manager</span>
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
                                {fieldRow("PRIMARY", c.text, true)}
                                {c.title && fieldRow("HEADLINE", c.title)}
                                {c.description && fieldRow("DESC", c.description)}
                                {row.productUrl && fieldRow("URL", adUrl)}
                                {row.productUrl && fieldRow("PARAMS", adParams)}
                              </div>
                            </div>
                          );
                        }
                        // Thêm theo kênh khi copy: FB + YT chèn LINK UTM (bấm được); IG chèn câu CTA (link ở bio / Shop).
                        const extra = ch.key === "facebook" ? utmLink("meta")
                          : ch.key === "shorts" ? utmLink("shorts")
                          : ch.key === "instagram" ? "✨ Link in bio — or tap 🛍 Shop — to make hers" : "";
                        const isLink = extra.startsWith("http");
                        // YT Short: Title tách riêng (copy riêng) khỏi Description; kênh khác: 1 ô caption.
                        const full = [c.text, extra, (c.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n");
                        return (
                          <div key={ch.key} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, background: "#fff", minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                              <PlatIcon k={ch.key} />
                              <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--ink)" }}>{ch.label}</span>
                              <span style={{ flex: 1 }} />
                              <button onClick={() => copy(full)} className="btn" style={{ padding: "3px 10px", fontSize: 11 }}>{c.title ? "Copy desc" : "Copy"}</button>
                            </div>
                            {c.title && (
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, background: "#F7FBFF", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 9px" }}>
                                <span style={chip("#E4EAF1", "#475569")}>TITLE</span>
                                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, minWidth: 0 }}>{c.title}</span>
                                <button onClick={() => copy(c.title!)} className="btn" style={{ padding: "2px 8px", fontSize: 11, flexShrink: 0 }}>Copy</button>
                              </div>
                            )}
                            <div style={{ fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.6, color: "var(--ink)" }}>{c.text}</div>
                            {extra && (isLink
                              ? <a href={extra} target="_blank" rel="noreferrer" title={extra}
                                  style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, padding: "6px 9px", background: "#F7FBFF", border: "1px solid var(--line)", borderRadius: 8, fontSize: 11.5, color: "var(--blue)", textDecoration: "none" }}>
                                  <span style={{ flexShrink: 0 }}>🔗</span>
                                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{extra}</span>
                                </a>
                              : <div style={{ fontSize: 12, marginTop: 8, color: "#1F6F45", fontWeight: 700 }}>{extra}</div>)}
                            {!!(c.hashtags ?? []).length && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
                                {c.hashtags.map((h, i) => (
                                  <span key={i} style={{ fontSize: 11, color: "#5B5FC7", background: "#EEF0FF", borderRadius: 6, padding: "2px 7px" }}>{h}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12.5, color: "var(--muted)", background: "#F7F8FA", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px" }}>
                      {isAdmin ? (row.productId ? "No captions yet — click Generate." : "Attach to a listing first, then generate captions.") : "No captions yet."}
                    </div>
                  )}
                </div>
            )}

                {/* v272 · DISTRIBUTION + PERFORMANCE + Points tạm ẨN theo yêu cầu — data (postedTo,
                    points, API /api/videos/performance) vẫn giữ nguyên, cần lại thì bật UI lên. */}

            {/* Delete video + Save xếp NGANG (giống Card Design). Delete khóa khi video đã gắn listing (usedBy>0). */}
            {canManage && (
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                <button disabled={busy || row.usedBy > 0} className="btn" onClick={doDelete}
                  title={row.usedBy > 0 ? "Attached to a listing — remove it in Manage Products before deleting" : "Delete video from the library"}
                  style={{ padding: "10px 18px", fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 7,
                    color: "#fff", background: row.usedBy > 0 ? "#E7A6A0" : "#E5484D", borderColor: row.usedBy > 0 ? "#E7A6A0" : "#E5484D",
                    cursor: row.usedBy > 0 ? "not-allowed" : "pointer" }}>
                  {row.usedBy > 0 ? <IcLock /> : <IcTrash />} Delete video
                </button>
                <button disabled={busy} className="btn btn-primary" onClick={async () => { if (await save()) close(); }}
                  style={{ padding: "10px 24px", background: "#1F9D57", borderColor: "#1F9D57", fontWeight: 800 }}>
                  {busy ? "Saving…" : "Save"}
                </button>
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
function UploadModal({ sellers, creators, isAdmin, myRole, me, busy, close, go }: {
  sellers: Opt[]; creators: Opt[]; isAdmin: boolean; myRole: string; me: { id: string; name: string }; busy: boolean;
  close: () => void; go: (files: File[], who: { sellerId: string; creatorId: string; sameCode?: string }) => Promise<void>;
}) {
  // 3 vai upload:
  //  · Admin   → chọn cả Seller + Creator (danh sách đầy đủ).
  //  · Creator → CHÍNH MÌNH là creator (cố định), phải chọn Seller trong team (video làm cho seller nào).
  //  · Seller  → CHÍNH MÌNH là seller (cố định), chọn Creator trong team (không có "Me", seller ≠ creator).
  const iAmCreator = !isAdmin && myRole === "content";
  const [sellerId, setSellerId] = useState(isAdmin || iAmCreator ? "" : me.id);
  const [creatorId, setCreatorId] = useState(iAmCreator ? me.id : "");
  const [files, setFiles] = useState<File[]>([]);
  // v271 · # video mẫu (tuỳ chọn): quay video MỚI cho đúng sản phẩm cũ → điền # là video tự vào đúng card.
  const [sameCode, setSameCode] = useState("");
  const inRef = useRef<HTMLInputElement>(null);
  const ready = !!sellerId && files.length > 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.5)", zIndex: 3100, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }} onClick={close}>
      <div className="card" style={{ width: 560, maxWidth: "96vw", padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 16, flex: 1 }}>Bulk upload — each file becomes one video</div>
          <button onClick={close} className="btn" style={{ padding: "6px 11px" }}>✕</button>
        </div>

        {/* v271b · Chỉ hiện ô CẦN CHỌN: người upload là ai thì hệ thống tự biết (creator upload → creator
            = chính mình, seller upload → seller = chính mình) — ô disabled chỉ gây rối, bỏ. Admin thấy cả 2. */}
        <div className="filters" style={{ gridTemplateColumns: isAdmin ? "1fr 1fr" : "1fr" }}>
          {(isAdmin || iAmCreator) && (
            <div className="field">
              <label>Seller <span style={{ color: "#B42318" }}>*</span></label>
              <select value={sellerId} onChange={(e) => setSellerId(e.target.value)}
                style={{ borderColor: sellerId ? undefined : "#F0B4AE" }}>
                <option value="">— select a seller —</option>
                {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          {!iAmCreator && (
            <div className="field">
              <label>Creator</label>
              <select value={creatorId} onChange={(e) => setCreatorId(e.target.value)}>
                <option value="">— none —</option>
                {creators.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Add to card of video # <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional — new creative joins that video's card)</span></label>
            <input value={sameCode} onChange={(e) => setSameCode(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="e.g. 2 — the new videos join that card as .2, .3…" inputMode="numeric" />
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
            onClick={() => go(files, { sellerId, creatorId, sameCode })}>
            Upload {files.length || ""}
          </button>
        </div>
      </div>
    </div>
  );
}
