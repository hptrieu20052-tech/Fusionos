"use client";
import { createContext, useContext, useCallback } from "react";
import { Lang, translate } from "@/lib/i18n";

// App hiển thị 100% tiếng Anh. Giữ interface useLang()/t() để không phải sửa mọi component,
// nhưng ngôn ngữ luôn cố định = "en".
type Ctx = { lang: Lang; setLang: (l: Lang) => void; toggle: () => void; t: (key: string) => string };
const LangCtx = createContext<Ctx | null>(null);

export function LangProvider({ children }: { initial?: Lang; children: React.ReactNode }) {
  const t = useCallback((key: string) => translate("en", key), []);
  const noop = useCallback(() => {}, []);
  return <LangCtx.Provider value={{ lang: "en", setLang: noop, toggle: noop, t }}>{children}</LangCtx.Provider>;
}

export function useLang(): Ctx {
  const c = useContext(LangCtx);
  if (!c) return { lang: "en", setLang: () => {}, toggle: () => {}, t: (k) => translate("en", k) };
  return c;
}
