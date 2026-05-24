"use client"

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { en } from "./locales/en"
import { es } from "./locales/es"
import { fr } from "./locales/fr"
import { ja } from "./locales/ja"
import { ko } from "./locales/ko"
import { zh } from "./locales/zh"

export type Locale = "ja" | "en" | "zh" | "ko" | "es" | "fr"

export const LOCALES: { code: Locale; label: string; flag: string }[] = [
  { code: "ja", label: "日本語", flag: "🇯🇵" },
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "zh", label: "中文", flag: "🇨🇳" },
  { code: "ko", label: "한국어", flag: "🇰🇷" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
]

const DICT = { ja, en, zh, ko, es, fr } as const
const STORAGE_KEY = "cw_locale"

function detectFromHeader(): Locale | null {
  if (typeof navigator === "undefined") return null
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const raw of langs) {
    const code = raw.toLowerCase().slice(0, 2)
    if (code === "ja") return "ja"
    if (code === "en") return "en"
    if (code === "zh") return "zh"
    if (code === "ko") return "ko"
    if (code === "es") return "es"
    if (code === "fr") return "fr"
  }
  return null
}

interface I18nCtx {
  locale: Locale
  setLocale: (l: Locale) => void
  t: typeof ja
}

const I18nContext = createContext<I18nCtx | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("ja")
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Locale | null
      if (saved && saved in DICT) {
        setLocaleState(saved)
      } else {
        const detected = detectFromHeader()
        if (detected) setLocaleState(detected)
      }
    } catch {
      /* ignore */
    }
    setReady(true)
  }, [])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo<I18nCtx>(
    () => ({
      locale,
      setLocale,
      t: DICT[locale],
    }),
    [locale, setLocale],
  )

  return <I18nContext.Provider value={value}>{ready ? children : children}</I18nContext.Provider>
}

export function useI18n(): I18nCtx {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    return { locale: "ja", setLocale: () => {}, t: DICT.ja }
  }
  return ctx
}
