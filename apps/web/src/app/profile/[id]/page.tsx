"use client"

import { useParams } from "next/navigation"
import { useEffect, useState } from "react"

// biome-ignore lint/complexity/useLiteralKeys: bracket notation required per CLAUDE.md
const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

interface ProfileData {
  id: string
  username: string
  totalKills: number
  totalDeaths: number
  totalScore: number
  kd: number
  createdAt: string
}

export default function PlayerProfilePage() {
  const params = useParams()
  const profileId = String(params.id ?? "")

  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_URL}/api/profile/${profileId}`, {
          credentials: "include",
        })
        if (!res.ok) {
          setError("プロフィールが見つかりません")
          return
        }
        const json = (await res.json()) as { data: ProfileData }
        setProfile(json.data)
      } catch {
        setError("読み込みエラー")
      } finally {
        setLoading(false)
      }
    }
    if (profileId) load()
  }, [profileId])

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
        <div>{error ?? "ERROR"}</div>
        <a href="/leaderboard" style={{ color: "#00ff41", textDecoration: "underline" }}>
          ← RANKING
        </a>
      </div>
    )
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
          maxWidth: "600px",
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
              {profile.username}
            </div>
            <div style={{ fontSize: "0.7rem", color: "#005500" }}>
              JOINED {new Date(profile.createdAt).toLocaleDateString("ja-JP")}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.75rem" }}>
          <StatCard label="TOTAL KILLS" value={profile.totalKills.toLocaleString()} />
          <StatCard label="TOTAL DEATHS" value={profile.totalDeaths.toLocaleString()} />
          <StatCard label="K/D RATIO" value={profile.kd.toFixed(2)} />
          <StatCard label="TOTAL SCORE" value={profile.totalScore.toLocaleString()} />
        </div>

        <a
          href="/leaderboard"
          style={{
            color: "#005500",
            fontSize: "0.75rem",
            letterSpacing: "0.1em",
            textDecoration: "underline",
          }}
        >
          ← RANKING
        </a>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid #003300",
        padding: "0.75rem 1rem",
        textAlign: "center",
        background: "rgba(0,10,0,0.6)",
      }}
    >
      <div
        style={{
          fontSize: "1.5rem",
          fontWeight: "bold",
          color: "#00ff41",
          textShadow: "0 0 6px #00ff41",
          letterSpacing: "0.05em",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: "0.6rem",
          color: "#00aa2a",
          marginTop: "0.25rem",
          letterSpacing: "0.1em",
        }}
      >
        {label}
      </div>
    </div>
  )
}
