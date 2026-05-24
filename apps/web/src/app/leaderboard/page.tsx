"use client"

import { useCallback, useEffect, useState } from "react"
import { useI18n } from "../../i18n"
import { fetchMe } from "../../lib/auth-client"

// biome-ignore lint/complexity/useLiteralKeys: bracket notation required per CLAUDE.md
const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

type Window = "all" | "week" | "month"
type SortKey = "score" | "kills" | "kd"

interface LeaderboardEntry {
  rank: number
  id: string
  username: string
  countryCode: string | null
  totalKills: number
  totalDeaths: number
  totalScore: number
  kd: number
}

interface MeRank {
  rank: number
  total: number
  id: string
  username: string
  countryCode: string | null
  totalKills: number
  totalDeaths: number
  totalScore: number
  kd: number
}

function countryFlag(code: string | null): string {
  if (!code || code.length !== 2) return ""
  const A = 0x1f1e6
  const a = code.toUpperCase().charCodeAt(0) - 65
  const b = code.toUpperCase().charCodeAt(1) - 65
  if (a < 0 || a > 25 || b < 0 || b > 25) return ""
  return String.fromCodePoint(A + a) + String.fromCodePoint(A + b)
}

export default function LeaderboardPage() {
  const { t } = useI18n()
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [window, setWindow] = useState<Window>("all")
  const [sort, setSort] = useState<SortKey>("score")
  const [me, setMe] = useState<MeRank | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const load = useCallback(async (w: Window, s: SortKey) => {
    try {
      const res = await fetch(`${API_URL}/api/leaderboard?window=${w}&sort=${s}&limit=50`, {
        cache: "no-store",
      })
      if (!res.ok) return
      const json = (await res.json()) as {
        data: { entries: LeaderboardEntry[]; updatedAt: string }
      }
      setEntries(json.data.entries)
      setUpdatedAt(new Date(json.data.updatedAt))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    load(window, sort)
    const id = setInterval(() => load(window, sort), 30_000)
    return () => clearInterval(id)
  }, [window, sort, load])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const user = await fetchMe()
      if (cancelled || !user) return
      try {
        const res = await fetch(
          `${API_URL}/api/leaderboard/me-rank?userId=${encodeURIComponent(user.id)}`,
          { cache: "no-store" },
        )
        if (!res.ok) return
        const json = (await res.json()) as { data: MeRank | null }
        if (!cancelled) setMe(json.data)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div
      style={{
        minHeight: "100%",
        fontFamily: "monospace",
        color: "#00ff41",
        paddingBottom: me ? "5rem" : "1rem",
      }}
    >
      <main style={{ margin: "0 auto", maxWidth: "800px", padding: "2rem 1rem" }}>
        <div style={{ textAlign: "center", marginBottom: "1rem" }}>
          <div
            style={{
              fontSize: "1.5rem",
              fontWeight: "bold",
              letterSpacing: "0.3em",
              color: "#00ff41",
              textShadow: "0 0 15px #00ff41",
              marginBottom: "0.5rem",
            }}
          >
            ▓ {t.leaderboard.title} ▓
          </div>
          {updatedAt && (
            <div style={{ fontSize: "0.65rem", color: "#005500", letterSpacing: "0.15em" }}>
              {t.leaderboard.refresh}{" "}
              <span style={{ opacity: 0.7 }}>({updatedAt.toLocaleTimeString()})</span>
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            justifyContent: "center",
            marginBottom: "0.75rem",
            flexWrap: "wrap",
          }}
        >
          {(["all", "week", "month"] as const).map((w) => (
            <button
              type="button"
              key={w}
              onClick={() => setWindow(w)}
              style={{
                background: w === window ? "rgba(0,255,65,0.15)" : "transparent",
                color: w === window ? "#00ff41" : "#00aa2a",
                border: `1px solid ${w === window ? "#00ff41" : "#003300"}`,
                padding: "0.3rem 1rem",
                fontFamily: "monospace",
                fontSize: "0.75rem",
                letterSpacing: "0.15em",
                cursor: "pointer",
                textShadow: w === window ? "0 0 6px #00ff41" : "none",
              }}
            >
              {t.leaderboard.windows[w]}
            </button>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            justifyContent: "center",
            marginBottom: "1.5rem",
            flexWrap: "wrap",
          }}
        >
          {(["score", "kills", "kd"] as const).map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => setSort(s)}
              style={{
                background: "transparent",
                color: s === sort ? "#00ff41" : "#005500",
                border: "none",
                padding: "0.2rem 0.5rem",
                fontFamily: "monospace",
                fontSize: "0.7rem",
                letterSpacing: "0.1em",
                cursor: "pointer",
                borderBottom: `1px dashed ${s === sort ? "#00ff41" : "transparent"}`,
              }}
            >
              {t.leaderboard.sort[s]}
            </button>
          ))}
        </div>

        {entries.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "5rem",
              color: "#005500",
              letterSpacing: "0.2em",
              border: "1px solid #003300",
            }}
          >
            <div style={{ marginBottom: "1rem" }}>{t.leaderboard.empty}</div>
            <a
              href="/world"
              style={{ color: "#00aa2a", textDecoration: "none", fontSize: "0.8rem" }}
            >
              ▶ PLAY →
            </a>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {entries.map((entry) => {
              const isTop3 = entry.rank <= 3
              const rankLabel =
                entry.rank === 1
                  ? "1ST"
                  : entry.rank === 2
                    ? "2ND"
                    : entry.rank === 3
                      ? "3RD"
                      : `#${entry.rank}`
              const rankColor =
                entry.rank === 1
                  ? "#ffd700"
                  : entry.rank === 2
                    ? "#c0c0c0"
                    : entry.rank === 3
                      ? "#cd7f32"
                      : "#00aa2a"
              const isSelf = me?.id === entry.id
              return (
                <a
                  key={entry.id}
                  href={`/profile/${entry.id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    border: `1px solid ${isSelf ? "#00ff41" : isTop3 ? `${rankColor}44` : "#003300"}`,
                    padding: "0.6rem 0.8rem",
                    background: isSelf
                      ? "rgba(0,40,0,0.85)"
                      : isTop3
                        ? "rgba(0,15,0,0.8)"
                        : "rgba(0,8,0,0.6)",
                    boxShadow: isTop3 ? `0 0 10px ${rankColor}22` : "none",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <div
                    style={{
                      width: "3rem",
                      textAlign: "center",
                      fontWeight: "bold",
                      fontSize: "0.85rem",
                      color: rankColor,
                      textShadow: isTop3 ? `0 0 8px ${rankColor}` : "none",
                      flexShrink: 0,
                    }}
                  >
                    {rankLabel}
                  </div>
                  <div style={{ flexShrink: 0, fontSize: "1.1rem" }}>
                    {countryFlag(entry.countryCode)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "0.85rem",
                        fontWeight: "bold",
                        color: "#00ff41",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {entry.username}
                    </div>
                    <div style={{ fontSize: "0.65rem", color: "#005500" }}>
                      K/D {entry.kd.toFixed(2)} · {entry.totalKills}K / {entry.totalDeaths}D
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div
                      style={{
                        fontSize: "0.9rem",
                        fontWeight: "bold",
                        color: rankColor,
                        letterSpacing: "0.05em",
                      }}
                    >
                      {entry.totalScore.toLocaleString()}
                    </div>
                    <div style={{ fontSize: "0.6rem", color: "#005500" }}>PT</div>
                  </div>
                </a>
              )
            })}
          </div>
        )}
      </main>

      {me && (
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            background: "rgba(0,30,0,0.95)",
            borderTop: "1px solid #00ff41",
            padding: "0.6rem 1rem",
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            color: "#00ff41",
            fontFamily: "monospace",
            fontSize: "0.8rem",
            letterSpacing: "0.1em",
            zIndex: 10,
            boxShadow: "0 -4px 12px rgba(0,255,65,0.2)",
          }}
        >
          <span style={{ color: "#00aa2a" }}>{t.leaderboard.yourRank}</span>
          <span style={{ fontWeight: "bold", textShadow: "0 0 6px #00ff41" }}>
            #{me.rank} / {me.total}
          </span>
          <span style={{ flex: 1, textAlign: "center" }}>
            {countryFlag(me.countryCode)} {me.username}
          </span>
          <span>K/D {me.kd.toFixed(2)}</span>
          <span style={{ fontWeight: "bold" }}>{me.totalScore.toLocaleString()} PT</span>
        </div>
      )}
    </div>
  )
}
