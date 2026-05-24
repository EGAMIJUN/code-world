"use client"

import { useEffect, useRef, useState } from "react"
import { LOCALES, useI18n } from "../i18n"

export default function LocaleSwitcher() {
  const { locale, setLocale } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  const current = LOCALES.find((l) => l.code === locale) ?? LOCALES[0]

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change language"
        style={{
          background: "transparent",
          color: "#00ff41",
          border: "1px solid #003300",
          padding: "0.35rem 0.6rem",
          fontFamily: "monospace",
          fontSize: "0.8rem",
          letterSpacing: "0.1em",
          cursor: "pointer",
          textShadow: "0 0 4px #00ff41",
        }}
      >
        🌐 {current?.flag} {current?.code.toUpperCase()}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            background: "rgba(0,15,0,0.95)",
            border: "1px solid #003300",
            padding: "0.4rem 0",
            minWidth: "140px",
            zIndex: 1000,
            boxShadow: "0 0 12px rgba(0,255,65,0.2)",
          }}
        >
          {LOCALES.map((l) => (
            <button
              type="button"
              key={l.code}
              onClick={() => {
                setLocale(l.code)
                setOpen(false)
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: l.code === locale ? "rgba(0,255,65,0.15)" : "transparent",
                color: "#00ff41",
                border: "none",
                padding: "0.45rem 0.8rem",
                fontFamily: "monospace",
                fontSize: "0.8rem",
                letterSpacing: "0.1em",
                cursor: "pointer",
              }}
            >
              {l.flag} {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
