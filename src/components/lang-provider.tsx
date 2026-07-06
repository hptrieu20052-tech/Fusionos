"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { Lang, translate } from "@/lib/i18n";

type Ctx = { lang: Lang; setLang: (l: Lang) => void; toggle: () => void; t: (key: string) => string };
const LangCtx = createContext<Ctx | null>(null);

export function LangProvider({ initial, children }: { initial: Lang; children: React.ReactNode }) {
  const router = useRouter();
  const [lang, setLangState] = useState<Lang>(initial);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    document.cookie = `fusion_lang=${l}; path=/; max-age=31536000`;
    try { localStorage.setItem("fusion_lang", l); } catch {}
    router.refresh();
  }, [router]);

  const toggle = useCallback(() => setLang(lang === "vi" ? "en" : "vi"), [lang, setLang]);
  const t = useCallback((key: string) => translate(lang, key), [lang]);

  return <LangCtx.Provider value={{ lang, setLang, toggle, t }}>{children}</LangCtx.Provider>;
}

export function useLang(): Ctx {
  const c = useContext(LangCtx);
  if (!c) return { lang: "vi", setLang: () => {}, toggle: () => {}, t: (k) => translate("vi", k) };
  return c;
}
