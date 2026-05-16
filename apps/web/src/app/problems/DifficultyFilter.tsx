'use client'

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback } from "react"

const DIFFICULTY_LABELS: Record<number, string> = {
  0: "Lv.0 入門",
  1: "Lv.1 基礎",
  2: "Lv.2 中級",
  3: "Lv.3 上級",
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
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => setDifficulty(null)}
        className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
          current === null
            ? "bg-primary text-primary-foreground"
            : "border border-border bg-background hover:bg-accent"
        }`}
      >
        すべて
      </button>
      {Object.entries(DIFFICULTY_LABELS).map(([level, label]) => (
        <button
          key={level}
          type="button"
          onClick={() => setDifficulty(level)}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
            current === level
              ? "bg-primary text-primary-foreground"
              : "border border-border bg-background hover:bg-accent"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
