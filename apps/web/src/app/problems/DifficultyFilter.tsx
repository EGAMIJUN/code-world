"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback } from "react"

const DIFFICULTY_LABELS: Record<number, string> = {
  0: "Lv.0 BASIC",
  1: "Lv.1 NORMAL",
  2: "Lv.2 HARD",
  3: "Lv.3 EXPERT",
}

export default function DifficultyFilter() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const current = searchParams.get("difficulty")

  const setDifficulty = useCallback(
    (value: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value === null) {
        params.delete("difficulty")
      } else {
        params.set("difficulty", value)
      }
      router.push(`/problems?${params.toString()}`)
    },
    [router, searchParams],
  )

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", fontFamily: "monospace" }}>
      <button
        type="button"
        onClick={() => setDifficulty(null)}
        style={{
          padding: "0.3rem 1rem",
          fontSize: "0.75rem",
          letterSpacing: "0.15em",
          background: current === null ? "rgba(0,255,65,0.1)" : "transparent",
          border: `1px solid ${current === null ? "#00ff41" : "#003300"}`,
          color: current === null ? "#00ff41" : "#00aa2a",
          textShadow: current === null ? "0 0 6px #00ff41" : "none",
          cursor: "pointer",
          fontFamily: "monospace",
        }}
      >
        ALL
      </button>
      {Object.entries(DIFFICULTY_LABELS).map(([level, label]) => {
        const isActive = current === level
        return (
          <button
            key={level}
            type="button"
            onClick={() => setDifficulty(level)}
            style={{
              padding: "0.3rem 1rem",
              fontSize: "0.75rem",
              letterSpacing: "0.15em",
              background: isActive ? "rgba(0,255,65,0.1)" : "transparent",
              border: `1px solid ${isActive ? "#00ff41" : "#003300"}`,
              color: isActive ? "#00ff41" : "#00aa2a",
              textShadow: isActive ? "0 0 6px #00ff41" : "none",
              cursor: "pointer",
              fontFamily: "monospace",
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
