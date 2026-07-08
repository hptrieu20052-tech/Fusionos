"use client";
import { createContext, useCallback, useContext, useState } from "react";

type Opts = { title?: string; message: string; confirmText?: string; cancelText?: string; danger?: boolean; info?: boolean };
type Ctx = { confirm: (o: Opts | string) => Promise<boolean> };
const ConfirmCtx = createContext<Ctx | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ opts: Opts; resolve: (v: boolean) => void } | null>(null);

  const confirm = useCallback((o: Opts | string) =>
    new Promise<boolean>((resolve) => setState({ opts: typeof o === "string" ? { message: o } : o, resolve })), []);

  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  const o = state?.opts;

  return (
    <ConfirmCtx.Provider value={{ confirm }}>
      {children}
      {o && (
        <div onClick={() => close(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(20,26,38,.46)", backdropFilter: "blur(2px)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, animation: "cf-fade .12s ease" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 18, width: 420, maxWidth: "94vw", padding: "24px 24px 20px", boxShadow: "0 18px 50px rgba(13,40,80,.28)", animation: "cf-pop .16s cubic-bezier(.2,.9,.3,1.2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 20,
                background: o.info ? "#EAF1FB" : o.danger ? "#FCEBEB" : "#EAF1FB", color: o.info ? "var(--blue)" : o.danger ? "#D14343" : "var(--blue)" }}>
                {o.info ? "ⓘ" : o.danger ? "⚠" : "?"}
              </div>
              <b style={{ fontSize: 16, lineHeight: 1.3 }}>{o.title ?? (o.info ? "Thông báo" : o.danger ? "Xác nhận xóa" : "Xác nhận")}</b>
            </div>
            <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: 20, paddingLeft: 52 }}>{o.message}</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              {!o.info && <button onClick={() => close(false)}
                style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 11, padding: "9px 18px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>{o.cancelText ?? "Hủy"}</button>}
              <button onClick={() => close(true)} autoFocus
                style={{ border: 0, borderRadius: 11, padding: "9px 20px", fontWeight: 800, cursor: "pointer", fontSize: 13, color: "#fff",
                  background: o.danger ? "#D14343" : "var(--blue)" }}>{o.confirmText ?? (o.info ? "OK" : o.danger ? "Xóa" : "Đồng ý")}</button>
            </div>
          </div>
        </div>
      )}
      <style>{`@keyframes cf-fade{from{opacity:0}to{opacity:1}}@keyframes cf-pop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}`}</style>
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const c = useContext(ConfirmCtx);
  return c ? c.confirm : (async (o: Opts | string) => window.confirm(typeof o === "string" ? o : o.message));
}
