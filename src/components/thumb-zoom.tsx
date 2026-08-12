"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ============================================================================
//  THUMB ZOOM — xem to ảnh main mockup ngay trong bảng (Etsy / Shopify / TikTok)
//  Hover  -> preview nổi 340px cạnh hàng, position:fixed nên bảng có overflow:hidden
//            cũng không cắt được (không ancestor nào của bảng dùng transform).
//  Click  -> lightbox full màn. Truyền `images` (cả listing) thì có mũi tên trái/phải
//            + phím ←/→ để trượt qua lại toàn bộ ảnh; Esc hoặc click nền để đóng.
//  Ảnh phóng to thử tải bản gốc (Etsy il_fullxfull / Shopify bỏ hậu tố _600x600);
//  URL lỗi thì onError fallback về đúng URL thumbnail nên không bao giờ vỡ ảnh.
// ============================================================================

const PREVIEW = 340;
const GAP = 14;

/** Nâng URL thumbnail lên bản độ phân giải cao của Etsy / Shopify CDN. */
function upscale(src: string): string {
  if (/etsystatic\.com/i.test(src)) return src.replace(/il_\d+x[\dN]+\./i, "il_fullxfull.");
  if (/cdn\.shopify\.com/i.test(src)) return src.replace(/_\d+x\d*(@\dx)?(?=\.(jpe?g|png|webp|gif))/i, "");
  return src;
}

type Props = {
  src?: string | null;
  alt?: string;
  size?: number;
  radius?: number;
  border?: boolean;
  images?: (string | null | undefined)[]; // toàn bộ ảnh của listing — để trượt qua lại trong lightbox
};

export default function ThumbZoom({ src, alt = "", size = 42, radius = 8, border = false, images }: Props) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);

  // Danh sách ảnh để trượt: ưu tiên `images`; không có thì chỉ mình `src`.
  const gallery = (images ?? []).map((x) => String(x ?? "")).filter(Boolean);
  const list = gallery.length ? gallery : (src ? [src] : []);
  const many = list.length > 1;
  const cur = list[Math.min(idx, list.length - 1)] ?? src ?? "";
  const big = cur ? upscale(cur) : "";

  const go = useCallback((d: number) => setIdx((i) => (list.length ? (i + d + list.length) % list.length : 0)), [list.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, go]);

  // Đóng preview khi cuộn trang — nếu không nó đứng lơ lửng sai chỗ.
  useEffect(() => {
    if (!pos) return;
    const off = () => setPos(null);
    window.addEventListener("scroll", off, true);
    window.addEventListener("resize", off);
    return () => { window.removeEventListener("scroll", off, true); window.removeEventListener("resize", off); };
  }, [pos]);

  // Đặt preview cạnh thumbnail, tự lật sang trái / kéo lên khi chạm mép màn hình.
  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = r.right + GAP;
    if (left + PREVIEW > window.innerWidth - 8) left = Math.max(8, r.left - GAP - PREVIEW);
    let top = r.top + r.height / 2 - PREVIEW / 2;
    top = Math.min(Math.max(8, top), Math.max(8, window.innerHeight - PREVIEW - 8));
    setPos({ top, left });
  }, []);

  const fallback = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (cur && e.currentTarget.src !== cur) e.currentTarget.src = cur;
  };
  const openLightbox = () => {
    // Mở ở ĐÚNG ảnh vừa bấm (src) nếu nó nằm trong danh sách.
    const start = src ? list.indexOf(src) : 0;
    setIdx(start >= 0 ? start : 0);
    setPos(null); setOpen(true);
  };

  const arrow: React.CSSProperties = {
    position: "fixed", top: "50%", transform: "translateY(-50%)", width: 46, height: 46, borderRadius: 999,
    background: "rgba(255,255,255,.16)", color: "#fff", fontSize: 26, lineHeight: "44px", textAlign: "center",
    cursor: "pointer", userSelect: "none",
  };

  if (!src) return <div style={{ width: size, height: size, borderRadius: radius, background: "#F1F1F4" }} />;

  return (
    <div
      ref={ref}
      onMouseEnter={place}
      onMouseLeave={() => setPos(null)}
      onClick={openLightbox}
      style={{ width: size, height: size, cursor: "zoom-in", lineHeight: 0 }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        style={{
          width: size, height: size, objectFit: "cover", borderRadius: radius, display: "block",
          ...(border ? { border: "1px solid var(--line)" } : {}),
        }}
      />

      {pos && !open && (
        <div
          style={{
            position: "fixed", top: pos.top, left: pos.left, width: PREVIEW, height: PREVIEW,
            background: "#fff", borderRadius: 12, padding: 6, zIndex: 9000, pointerEvents: "none",
            boxShadow: "0 12px 40px rgba(16,24,40,.24)", border: "1px solid rgba(0,0,0,.08)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={upscale(src)} alt={alt} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", borderRadius: 8 }} />
        </div>
      )}

      {open && (
        <div
          onClick={(e) => { e.stopPropagation(); setOpen(false); }}
          style={{
            position: "fixed", inset: 0, zIndex: 9500, background: "rgba(12,14,20,.78)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 24, cursor: "zoom-out",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={big}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            onError={fallback}
            style={{ maxWidth: "88vw", maxHeight: "92vh", objectFit: "contain", borderRadius: 10, boxShadow: "0 24px 70px rgba(0,0,0,.5)", cursor: "default" }}
          />
          {many && (
            <>
              <span onClick={(e) => { e.stopPropagation(); go(-1); }} style={{ ...arrow, left: 18 }}>‹</span>
              <span onClick={(e) => { e.stopPropagation(); go(1); }} style={{ ...arrow, right: 18 }}>›</span>
              <span style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,.5)", color: "#fff", fontSize: 13, fontWeight: 700, padding: "5px 12px", borderRadius: 999 }}>
                {idx + 1} / {list.length}
              </span>
            </>
          )}
          <span
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            style={{
              position: "fixed", top: 18, right: 22, width: 38, height: 38, borderRadius: 999,
              background: "rgba(255,255,255,.16)", color: "#fff", fontSize: 22, lineHeight: "36px",
              textAlign: "center", cursor: "pointer",
            }}
          >
            ×
          </span>
        </div>
      )}
    </div>
  );
}
