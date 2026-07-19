"use client";
import { useEffect, useState } from "react";

// Logo thương hiệu cho từng nhà fulfill (khớp theo tên). Không khớp → thử LOGO ĐÃ UPLOAD
// trong Settings (cache /api/fulfillers/logos, share toàn app) → cuối cùng mới chấm chữ cái đầu.
const LOGOS: { match: (n: string) => boolean; src: string }[] = [
  { match: (n) => n.includes("merchize"), src: "/suppliers/merchize.jpg" },
  { match: (n) => n.includes("printify"), src: "/suppliers/printify.jpg" },
  { match: (n) => n.includes("flash"), src: "/suppliers/flashpod.png" },
  { match: (n) => n.includes("printway"), src: "/suppliers/printway.png" },
  { match: (n) => n.includes("compass"), src: "/suppliers/compassup.jpg" },
  { match: (n) => n.includes("onos") || n.includes("onospod"), src: "/suppliers/onos.jpg" },
  { match: (n) => n.includes("wemb") || n.includes("embroider"), src: "/suppliers/wemb.jpg" },
];

const COLORS = ["#2E7D46", "#3B6BE5", "#E07B39", "#8E44AD", "#16A085", "#C0392B", "#2C7BE5"];

// Cache logo upload: fetch 1 lần cho cả trang, mọi SupplierLogo dùng chung.
let uploadedLogos: Record<string, string> | null = null;
let uploadedPromise: Promise<Record<string, string>> | null = null;
function getUploadedLogos(): Promise<Record<string, string>> {
  if (uploadedLogos) return Promise.resolve(uploadedLogos);
  if (!uploadedPromise) {
    uploadedPromise = fetch("/api/fulfillers/logos")
      .then((r) => r.json())
      .then((j) => { uploadedLogos = (j?.logos as Record<string, string>) ?? {}; return uploadedLogos; })
      .catch(() => { uploadedLogos = {}; return uploadedLogos; });
  }
  return uploadedPromise;
}

export function SupplierLogo({ name, size = 20, radius, src }: { name: string; size?: number; radius?: number; src?: string | null }) {
  const n = (name ?? "").toLowerCase();
  const hit = LOGOS.find((l) => l.match(n));
  const [dyn, setDyn] = useState<string | null>(uploadedLogos?.[n.trim()] ?? null);
  useEffect(() => {
    if (src || hit) return;
    let stop = false;
    getUploadedLogos().then((m) => { if (!stop) setDyn(m[n.trim()] ?? null); });
    return () => { stop = true; };
  }, [n, src, hit]);
  const r = radius ?? Math.round(size * 0.28);
  const box = {
    width: size, height: size, borderRadius: r, display: "inline-block", flexShrink: 0,
    objectFit: "cover" as const, border: "1px solid rgba(0,0,0,.06)", verticalAlign: "middle",
  };
  if (src) return <img src={src} alt={name} width={size} height={size} style={box} />;
  if (hit) return <img src={hit.src} alt={name} width={size} height={size} style={box} />;
  if (dyn) return <img src={dyn} alt={name} width={size} height={size} style={box} />;
  // Fallback: chấm màu + chữ cái đầu
  const color = COLORS[(n.charCodeAt(0) || 0) % COLORS.length];
  return (
    <span style={{ ...box, background: color, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.5, fontWeight: 800, textTransform: "uppercase" }}>
      {(name ?? "?").trim().charAt(0) || "?"}
    </span>
  );
}
