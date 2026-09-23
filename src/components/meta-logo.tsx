"use client";
import { useEffect, useState, type ReactNode } from "react";

/**
 * v587 · Logo Meta đọc từ public/marketplaces/meta.png — file logo CHÍNH THỨC do admin tự tải về
 * (Meta Brand Resources) và bỏ vào thư mục, giống các logo sàn khác (etsy/shopify/tiktok.png).
 * Dò file bằng new Image() SAU khi mount rồi mới render <img> — tránh bug ảnh vỡ khi file chưa có:
 * onError của <img> SSR bắn trước lúc React hydrate nên handler ẩn ảnh không kịp chạy (bug 23/9).
 * Chưa có file → render fallback (icon cũ) hoặc không render gì.
 */
const SRC = "/marketplaces/meta.png";
let cached: boolean | null = null; // dò 1 lần cho cả phiên — khỏi 404 lặp lại mỗi component

export function MetaLogo({ size = 18, fallback = null }: { size?: number; fallback?: ReactNode }) {
  const [ok, setOk] = useState<boolean>(cached === true);
  useEffect(() => {
    if (cached !== null) { setOk(cached); return; }
    const im = new Image();
    im.onload = () => { cached = true; setOk(true); };
    im.onerror = () => { cached = false; setOk(false); };
    im.src = SRC;
  }, []);
  if (!ok) return <>{fallback}</>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={SRC} alt="" width={size} height={size} style={{ width: size, height: size, objectFit: "contain", display: "block", flexShrink: 0 }} />;
}
