"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { useI18n } from "../../i18n"
import { logout } from "../../lib/auth-client"

// biome-ignore lint/complexity/useLiteralKeys: bracket notation required per CLAUDE.md
const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

interface ProfileData {
  id: string
  username: string
  totalKills: number
  totalDeaths: number
  totalScore: number
  maxKillstreak: number
  weaponKills: Record<string, number>
  countryCode: string | null
  kd: number
  createdAt: string
}

interface MatchEntry {
  id: string
  mode: string
  mapId: string
  kills: number
  deaths: number
  score: number
  killstreak: number
  headshots: number
  durationSec: number
  result: string
  createdAt: string
}

function countryFlag(code: string | null): string {
  if (!code || code.length !== 2) return ""
  const A = 0x1f1e6
  const a = code.toUpperCase().charCodeAt(0) - 65
  const b = code.toUpperCase().charCodeAt(1) - 65
  if (a < 0 || a > 25 || b < 0 || b > 25) return ""
  return String.fromCodePoint(A + a) + String.fromCodePoint(A + b)
}

// Phase F: OSAKA の称号・スーツ・実績。各フラグは ThreeWorld.tsx の OSAKA クリア処理が
// localStorage に "1" で書き込む (device-local)。ここはクライアント側で読み出して表示
// するだけ (サーバ送信は今回スコープ外)。
// Phase D: tone drives the accent colour + the localised kind label; name stays a
// JP proper noun; the description is localised (t.profile.ach*, keyed below).
const OSAKA_ACHIEVEMENTS: { key: string; tone: "title" | "feat" | "suit"; name: string }[] = [
  { key: "osaka_oni_clear", tone: "title", name: "大阪の鬼" },
  { key: "osaka_true_clear", tone: "feat", name: "真・五変化 撃破" },
  { key: "osaka_tetsurin_champion", tone: "title", name: "鉄輪の覇者" },
  { key: "osaka_dash_oni", tone: "feat", name: "疾走の鬼" },
  { key: "osaka_cataclysm_clear", tone: "title", name: "終焉を超えし者" },
  { key: "osaka_shuen_suit", tone: "suit", name: "終焉" },
]
const OSAKA_BEST_KEY = "osaka_best_score"

export default function ProfilePage() {
  const router = useRouter()
  const { t } = useI18n()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [matches, setMatches] = useState<MatchEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Phase F: OSAKA 称号・スーツ・実績 (device-local localStorage フラグ) + ベストスコア。
  const [earned, setEarned] = useState<Record<string, boolean>>({})
  const [osakaBest, setOsakaBest] = useState<number | null>(null)

  const handleLogout = async () => {
    await logout()
    router.push("/login")
  }

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_URL}/api/profile/me`, { credentials: "include" })
        if (!res.ok) {
          setError(res.status === 401 ? "LOGIN REQUIRED" : "PROFILE LOAD FAILED")
          return
        }
        const json = (await res.json()) as { data: ProfileData }
        setProfile(json.data)

        const mres = await fetch(`${API_URL}/api/profile/me/matches`, { credentials: "include" })
        if (mres.ok) {
          const mjson = (await mres.json()) as { data: MatchEntry[] }
          setMatches(mjson.data)
        }
      } catch {
        setError("CONNECTION ERROR")
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Phase F: read the OSAKA achievement flags from localStorage (client-only).
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const e: Record<string, boolean> = {}
      for (const a of OSAKA_ACHIEVEMENTS) e[a.key] = localStorage.getItem(a.key) === "1"
      setEarned(e)
      const best = localStorage.getItem(OSAKA_BEST_KEY)
      const bn = best ? Number.parseInt(best, 10) : Number.NaN
      setOsakaBest(Number.isFinite(bn) ? bn : null)
    } catch {
      /* private mode / storage disabled — leave achievements empty */
    }
  }, [])

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "monospace",
          color: "#00aa2a",
          letterSpacing: "0.2em",
        }}
      >
        ⟳ LOADING PLAYER DATA...
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div
        style={{
          minHeight: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.5rem",
          fontFamily: "monospace",
          color: "#ff0040",
        }}
      >
        <div style={{ letterSpacing: "0.2em" }}>{error ?? "ERROR"}</div>
        <a
          href="/login"
          style={{
            color: "#00ff41",
            border: "1px solid #00ff41",
            padding: "0.5rem 1.5rem",
            textDecoration: "none",
            fontSize: "0.85rem",
            letterSpacing: "0.2em",
          }}
        >
          ▶ LOGIN
        </a>
      </div>
    )
  }

  const weapons = Object.entries(profile.weaponKills ?? {}).sort((a, b) => b[1] - a[1])
  // Phase D: localised description per achievement (name stays JP; everything else
  // resolves through the i18n dict).
  const achDesc: Record<string, string> = {
    osaka_oni_clear: t.profile.achOni,
    osaka_true_clear: t.profile.achTrue,
    osaka_tetsurin_champion: t.profile.achTetsurin,
    osaka_dash_oni: t.profile.achDash,
    osaka_cataclysm_clear: t.profile.achCata,
    osaka_shuen_suit: t.profile.achSuit,
  }

  return (
    <div
      style={{
        minHeight: "100%",
        fontFamily: "monospace",
        color: "#00ff41",
        padding: "2rem 1rem",
      }}
    >
      <div
        style={{
          margin: "0 auto",
          maxWidth: "720px",
          display: "flex",
          flexDirection: "column",
          gap: "1.5rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
          <div
            style={{
              height: "72px",
              width: "72px",
              flexShrink: 0,
              border: "1px solid #003300",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.75rem",
              fontWeight: "bold",
              color: "#00ff41",
            }}
          >
            {profile.username.charAt(0).toUpperCase()}
          </div>
          <div>
            <div
              style={{
                fontSize: "1.3rem",
                fontWeight: "bold",
                letterSpacing: "0.1em",
                color: "#00ff41",
                textShadow: "0 0 10px #00ff41",
              }}
            >
              {countryFlag(profile.countryCode)} {profile.username}
            </div>
            <div style={{ fontSize: "0.7rem", color: "#005500", letterSpacing: "0.05em" }}>
              JOINED {new Date(profile.createdAt).toLocaleDateString()}
            </div>
          </div>
        </div>

        <div style={{ fontSize: "0.75rem", color: "#00aa2a", letterSpacing: "0.2em" }}>
          {t.profile.stats}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.75rem" }}>
          <StatCard label={t.leaderboard.kills} value={profile.totalKills.toLocaleString()} />
          <StatCard label={t.leaderboard.deaths} value={profile.totalDeaths.toLocaleString()} />
          <StatCard label={t.leaderboard.kd} value={profile.kd.toFixed(2)} />
          <StatCard label={t.leaderboard.score} value={profile.totalScore.toLocaleString()} />
          <StatCard
            label={t.profile.maxStreak}
            value={profile.maxKillstreak.toString()}
            highlight
          />
        </div>

        {/* Phase F: 称号・スーツ (OSAKA) — 獲得済みは点灯、未獲得はロック/グレーアウト */}
        <div style={{ fontSize: "0.75rem", color: "#00aa2a", letterSpacing: "0.2em" }}>
          {t.profile.titlesSuits}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.5rem" }}>
          {OSAKA_ACHIEVEMENTS.map((a) => {
            const got = earned[a.key] ?? false
            const accent = a.tone === "suit" ? "#c060ff" : a.tone === "feat" ? "#ffb347" : "#ffd700"
            const kindLabel =
              a.tone === "suit"
                ? t.profile.kindSuit
                : a.tone === "feat"
                  ? t.profile.kindFeat
                  : t.profile.kindTitle
            const desc = achDesc[a.key] ?? ""
            return (
              <div
                key={a.key}
                style={{
                  border: `1px solid ${got ? accent : "#003300"}`,
                  padding: "0.55rem 0.8rem",
                  background: got ? "rgba(30,20,0,0.5)" : "rgba(0,8,0,0.5)",
                  opacity: got ? 1 : 0.45,
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.2rem",
                }}
              >
                <span
                  style={{
                    color: got ? accent : "#557755",
                    fontWeight: "bold",
                    letterSpacing: "0.08em",
                    fontSize: "0.8rem",
                    textShadow: got ? `0 0 8px ${accent}` : "none",
                  }}
                >
                  {got ? "★" : "🔒"} {kindLabel}「{a.name}」
                </span>
                <span
                  style={{
                    color: got ? "#cc9900" : "#335533",
                    fontSize: "0.6rem",
                    letterSpacing: "0.04em",
                  }}
                >
                  {got ? desc : `${t.profile.locked} — ${desc}`}
                </span>
              </div>
            )
          })}
        </div>
        {osakaBest !== null && (
          <div style={{ fontSize: "0.65rem", color: "#00aa2a", letterSpacing: "0.1em" }}>
            {t.profile.osakaBestScore}:{" "}
            <span style={{ color: "#ffd700", fontWeight: "bold" }}>
              {osakaBest.toLocaleString()}
            </span>
          </div>
        )}

        {weapons.length > 0 && (
          <>
            <div style={{ fontSize: "0.75rem", color: "#00aa2a", letterSpacing: "0.2em" }}>
              {t.profile.weaponStats}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.5rem" }}>
              {weapons.map(([w, n]) => (
                <div
                  key={w}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    border: "1px solid #003300",
                    padding: "0.5rem 0.8rem",
                    background: "rgba(0,8,0,0.6)",
                  }}
                >
                  <span style={{ color: "#00aa2a", letterSpacing: "0.15em", fontSize: "0.75rem" }}>
                    {w.toUpperCase()}
                  </span>
                  <span style={{ color: "#00ff41", fontWeight: "bold" }}>{n}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {matches.length > 0 && (
          <>
            <div style={{ fontSize: "0.75rem", color: "#00aa2a", letterSpacing: "0.2em" }}>
              {t.profile.matches}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {matches.map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto auto 1fr auto auto",
                    gap: "0.6rem",
                    border: "1px solid #003300",
                    padding: "0.45rem 0.7rem",
                    fontSize: "0.7rem",
                    alignItems: "center",
                    background: "rgba(0,8,0,0.6)",
                  }}
                >
                  <span style={{ color: "#00aa2a", letterSpacing: "0.1em" }}>
                    {m.mode.toUpperCase()}
                  </span>
                  <span style={{ color: "#005500" }}>{m.mapId.toUpperCase()}</span>
                  <span style={{ color: "#00ff41" }}>
                    {m.kills}K / {m.deaths}D · {m.headshots} HS · streak {m.killstreak}
                  </span>
                  <span style={{ color: "#ffd700", fontWeight: "bold" }}>{m.score}</span>
                  <span style={{ color: "#005500", fontSize: "0.6rem" }}>
                    {new Date(m.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <a
            href="/world"
            style={{
              color: "#00ff41",
              border: "1px solid #00ff41",
              padding: "0.5rem 1.5rem",
              textDecoration: "none",
              fontSize: "0.8rem",
              letterSpacing: "0.15em",
              background: "rgba(0,255,65,0.05)",
            }}
          >
            ▶ {t.profile.play}
          </a>
          <a
            href="/leaderboard"
            style={{
              color: "#00aa2a",
              border: "1px solid #003300",
              padding: "0.5rem 1.5rem",
              textDecoration: "none",
              fontSize: "0.8rem",
              letterSpacing: "0.15em",
            }}
          >
            ▷ {t.profile.ranking}
          </a>
          <button
            type="button"
            onClick={handleLogout}
            style={{
              color: "#ff0040",
              border: "1px solid #ff0040",
              padding: "0.5rem 1.5rem",
              fontSize: "0.8rem",
              letterSpacing: "0.15em",
              background: "transparent",
              fontFamily: "monospace",
              cursor: "pointer",
            }}
          >
            ▷ {t.profile.logout}
          </button>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div
      style={{
        border: `1px solid ${highlight ? "#ffd700" : "#003300"}`,
        padding: "0.75rem 1rem",
        textAlign: "center",
        background: highlight ? "rgba(40,30,0,0.6)" : "rgba(0,10,0,0.6)",
      }}
    >
      <div
        style={{
          fontSize: "1.5rem",
          fontWeight: "bold",
          color: highlight ? "#ffd700" : "#00ff41",
          textShadow: highlight ? "0 0 8px #ffd700" : "0 0 6px #00ff41",
          letterSpacing: "0.05em",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: "0.6rem",
          color: highlight ? "#cc9900" : "#00aa2a",
          marginTop: "0.25rem",
          letterSpacing: "0.1em",
        }}
      >
        {label}
      </div>
    </div>
  )
}
