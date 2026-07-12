"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { IconPencil, IconAlert, IconWarn, IconCheck } from "@/components/icons";

type Tone = "blue" | "green" | "red";
type InputOpt = { placeholder?: string; type?: "text" | "password"; minLength?: number; initial?: string };
type Opts = { title?: string; message: string; confirmText?: string; cancelText?: string; danger?: boolean; info?: boolean; tone?: Tone; input?: InputOpt };
type Ctx = { confirm: (o: Opts | string) => Promise<boolean>; prompt: (o: Opts | string) => Promise<string | null> };
const ConfirmCtx = createContext<Ctx | null>(null);

const TONES: Record<Tone, { bg: string; fg: string; btn: string }> = {
  blue: { bg: "#EAF1FB", fg: "var(--blue)", btn: "var(--blue)" },
  green: { bg: "#E7F6EC", fg: "#15803d", btn: "linear-gradient(135deg,#22c55e,#15803d)" },
  red: { bg: "#FCEBEB", fg: "#D14343", btn: "#D14343" },
};

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ opts: Opts; isPrompt: boolean; resolve: (v: boolean | string | null) => void } | null>(null);
  const [val, setVal] = useState("");
  const [errr, setErrr] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const confirm = useCallback((o: Opts | string) =>
    new Promise<boolean>((resolve) => setState({ opts: typeof o === "string" ? { message: o } : o, isPrompt: false, resolve: resolve as (v: boolean | string | null) => void })), []);
  const prompt = useCallback((o: Opts | string) =>
    new Promise<string | null>((resolve) => {
      const opts = typeof o === "string" ? { message: o, input: {} } : { input: {}, ...o };
      setVal(opts.input?.initial ?? ""); setErrr(false);
      setState({ opts, isPrompt: true, resolve: resolve as (v: boolean | string | null) => void });
    }), []);

  useEffect(() => { if (state?.isPrompt) setTimeout(() => inputRef.current?.focus(), 30); }, [state]);

  const o = state?.opts;
  const isPrompt = !!state?.isPrompt;
  // Mặc định: prompt & thông báo thường → xanh lá; danger → đỏ
  const tone: Tone = o?.tone ?? (o?.danger ? "red" : "green");
  const T = TONES[tone];

  const done = (ok: boolean) => {
    if (!state) return;
    if (isPrompt) {
      if (!ok) { state.resolve(null); setState(null); return; }
      const min = o?.input?.minLength ?? 0;
      if (val.trim().length < min) { setErrr(true); inputRef.current?.focus(); return; }
      state.resolve(val); setState(null); return;
    }
    state.resolve(ok); setState(null);
  };

  return (
    <ConfirmCtx.Provider value={{ confirm, prompt }}>
      {children}
      {o && (
        <div onClick={() => done(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(20,26,38,.46)", backdropFilter: "blur(2px)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, animation: "cf-fade .12s ease" }}>
          <div onClick={(e) => e.stopPropagation()}
            className="modal-card" style={{ background: "#fff", borderRadius: 18, width: 420, maxWidth: "94vw", padding: "24px 24px 20px", boxShadow: "0 18px 50px rgba(13,40,80,.28)", animation: "cf-pop .16s cubic-bezier(.2,.9,.3,1.2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: T.bg, color: T.fg }}>
                {isPrompt ? <IconPencil width={20} height={20} /> : o.info ? <IconAlert width={20} height={20} /> : o.danger ? <IconWarn width={20} height={20} /> : <IconCheck width={20} height={20} />}
              </div>
              <b style={{ fontSize: 16, lineHeight: 1.3 }}>{o.title ?? (isPrompt ? "Enter information" : o.info ? "Notice" : o.danger ? "Confirm delete" : "Confirm")}</b>
            </div>
            <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: isPrompt ? 12 : 20, paddingLeft: 52 }}>{o.message}</div>
            {isPrompt && (
              <div style={{ paddingLeft: 52, marginBottom: 18 }}>
                <input ref={inputRef} value={val} type={o.input?.type ?? "text"} placeholder={o.input?.placeholder}
                  onChange={(e) => { setVal(e.target.value); if (errr) setErrr(false); }}
                  onKeyDown={(e) => { if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); }}
                  style={{ width: "100%", padding: "11px 13px", border: `1px solid ${errr ? "#D14343" : "var(--line)"}`, borderRadius: 11, font: "inherit", fontSize: 14, outline: "none" }} />
                {errr && <div style={{ color: "#D14343", fontSize: 12, fontWeight: 700, marginTop: 6 }}>Minimum {o.input?.minLength} characters</div>}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              {(!o.info || isPrompt) && <button onClick={() => done(false)}
                style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 11, padding: "9px 18px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>{o.cancelText ?? "Cancel"}</button>}
              <button onClick={() => done(true)}
                style={{ border: 0, borderRadius: 11, padding: "9px 20px", fontWeight: 800, cursor: "pointer", fontSize: 13, color: "#fff", background: T.btn }}>{o.confirmText ?? (isPrompt ? "Confirm" : o.info ? "OK" : o.danger ? "Delete" : "OK")}</button>
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
export function usePrompt() {
  const c = useContext(ConfirmCtx);
  return c ? c.prompt : (async (o: Opts | string) => window.prompt(typeof o === "string" ? o : o.message));
}
