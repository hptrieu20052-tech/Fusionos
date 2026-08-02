"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ============================================================================
//  THUMB ZOOM — xem to ảnh main mockup ngay trong bảng (Etsy / Shopify / TikTok)
//  Hover  -> preview nổi 340px cạnh hàng, position:fixed nên bảng có overflow:hidden
//            cũng không cắt được (không ancestor nào của bảng dùng transform).
//  Click  -> lightbox full màn, Esc hoặc click nền để đóng.
//  Ảnh phóng to thử tải bản gốc (Etsy il_fullxfull / Shopify bỏ hậu tố _600x600);
//  URL lỗi thì onError fallback về đúng URL thumbnail nên không bao giờ vỡ ảnh.
//  Không dùng react-dom createPortal — repo không cài @types/react-dom.
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
};

export default function ThumbZoom({ src, alt = "", size = 42, radius = 8, border = false }: Props) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const big = src ? upscale(src) : "";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open]);

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
    if (src && e.currentTarget.src !== src) e.currentTarget.src = src;
  };

  if (!src) return <div style={{ width: size, height: size, borderRadius: radius, background: "#F1F1F4" }} />;

  return (
    <div
      ref={ref}
      onMouseEnter={place}
      onMouseLeave={() => setPos(null)}
      onClick={() => { setPos(null); setOpen(true); }}
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
          <img src={big} alt={alt} onError={fallback} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", borderRadius: 8 }} />
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
            onError={fallback}
            style={{ maxWidth: "92vw", maxHeight: "92vh", objectFit: "contain", borderRadius: 10, boxShadow: "0 24px 70px rgba(0,0,0,.5)" }}
          />
          <span
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
