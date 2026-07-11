"use client";
import { IconCheck, IconWarn } from "@/components/icons";

// Toast dùng chung: tự nhận diện loại từ ký tự đầu (✓ xanh · ✗ đỏ · ⚠ vàng), style hiện đại nhẹ nhàng.
// Mọi nơi vẫn gọi flash("✓ ...") / flash("✗ ...") như cũ — component tự bóc glyph và tô màu.
type Kind = "success" | "error" | "warn" | "info";

function classify(msg: string): { kind: Kind; text: string } {
  const m = msg.trimStart();
  if (/^[✓✅]/.test(m)) return { kind: "success", text: m.replace(/^[✓✅]\s*/, "") };
  if (/^[✗✕❌]/.test(m)) return { kind: "error", text: m.replace(/^[✗✕❌]\s*/, "") };
  if (/^⚠/.test(m)) return { kind: "warn", text: m.replace(/^⚠\uFE0F?\s*/, "") };
  return { kind: "info", text: m };
}

const THEME: Record<Kind, { bar: string; fg: string; bg: string }> = {
  success: { bar: "#16a34a", fg: "#15803d", bg: "#ffffff" },
  error: { bar: "#dc2626", fg: "#b91c1c", bg: "#ffffff" },
  warn: { bar: "#d97706", fg: "#b45309", bg: "#ffffff" },
  info: { bar: "#2563eb", fg: "#1e293b", bg: "#ffffff" },
};

export function Flash({ msg }: { msg: string }) {
  if (!msg) return null;
  const { kind, text } = classify(msg);
  const c = THEME[kind];
  const Icon = kind === "success" ? IconCheck : kind === "info" ? null : IconWarn;
  return (
    <div
      role="status"
      style={{
        position: "fixed", top: 18, right: 18, zIndex: 1000, maxWidth: 380,
        display: "flex", alignItems: "flex-start", gap: 10,
        background: c.bg, color: "#1e293b",
        padding: "12px 16px 12px 14px", borderRadius: 12,
        borderLeft: `4px solid ${c.bar}`,
        boxShadow: "0 10px 30px rgba(15,23,42,.14), 0 2px 6px rgba(15,23,42,.08)",
        fontSize: 13.5, lineHeight: 1.45, fontWeight: 500,
        animation: "fpFlashIn .22s cubic-bezier(.2,.8,.2,1)",
      }}
    >
      {Icon && (
        <span style={{ flexShrink: 0, width: 20, height: 20, borderRadius: "50%", background: c.bar, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
          <Icon width={13} height={13} />
        </span>
      )}
      <span style={{ color: c.fg, paddingTop: Icon ? 1 : 0 }}>{text}</span>
      <style>{`@keyframes fpFlashIn{from{opacity:0;transform:translateY(-8px) scale(.98)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}
