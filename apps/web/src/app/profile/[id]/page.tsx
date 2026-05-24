"use client"

import { useParams } from "next/navigation"
import { useEffect, useState } from "react"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

interface ProfileData {
  id: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  level: number
  xp: number
  problemsSolved: number
  totalBlocks: number
}

type FriendStatus = "none" | "pending_sent" | "pending_received" | "accepted" | "self"

function computeXpProgress(totalXp: number) {
  let level = 0
  let consumed = 0
  for (;;) {
    const needed = 100 * (level + 1)
    if (consumed + needed > totalXp)
      return { level, xpInLevel: totalXp - consumed, xpForNext: needed }
    consumed += needed
    level++
  }
}

export default function PlayerProfilePage() {
  const params = useParams()
  const profileId = String(params.id ?? "")

  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [myId, setMyId] = useState<string | null>(null)
  const [friendStatus, setFriendStatus] = useState<FriendStatus>("none")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const [profileRes, meRes] = await Promise.all([
          fetch(`${API_URL}/api/profile/${profileId}`, { credentials: "include" }),
          fetch(`${API_URL}/api/profile/me`, { credentials: "include" }),
        ])
        if (!profileRes.ok) {
          setError("プロフィールが見つかりません")
          return
        }
        const pJson = (await profileRes.json()) as { data: ProfileData }
        setProfile(pJson.data)

        if (meRes.ok) {
          const mJson = (await meRes.json()) as { data: ProfileData }
          const me = mJson.data
          setMyId(me.id)
          if (me.id === pJson.data.id) {
            setFriendStatus("self")
            return
          }

          // Check friendship status
          const [friendsRes, pendingRes] = await Promise.all([
            fetch(`${API_URL}/api/friends`, { credentials: "include" }),
            fetch(`${API_URL}/api/friends/pending`, { credentials: "include" }),
          ])
          if (friendsRes.ok) {
            const fJson = (await friendsRes.json()) as { data: { friendId: string }[] }
            if (fJson.data.some((f) => f.friendId === pJson.data.id)) {
              setFriendStatus("accepted")
              return
            }
          }
          if (pendingRes.ok) {
            const pJson2 = (await pendingRes.json()) as { data: { requesterId: string }[] }
            if (pJson2.data.some((f) => f.requesterId === pJson.data.id)) {
              setFriendStatus("pending_received")
              return
            }
          }
          // Check if I sent a request
          const sentRes = await fetch(`${API_URL}/api/friends/pending`, { credentials: "include" })
          if (sentRes.ok) {
            // For simplicity, check in sent requests not directly supported; treat as "none"
          }
        }
      } catch {
        setError("読み込みエラー")
      } finally {
        setLoading(false)
      }
    }
    if (profileId) load()
  }, [profileId])

  const sendFriendRequest = async () => {
    if (!profile) return
    const res = await fetch(`${API_URL}/api/friends/request/${profile.id}`, {
      method: "POST",
      credentials: "include",
    })
    if (res.ok) {
      setFriendStatus("pending_sent")
      setActionMsg("フレンド申請を送信しました")
    } else {
      const json = (await res.json()) as { error?: string }
      setActionMsg(json.error ?? "エラーが発生しました")
    }
    setTimeout(() => setActionMsg(null), 3000)
  }

  const acceptFriendRequest = async () => {
    if (!profile) return
    const res = await fetch(`${API_URL}/api/friends/accept/${profile.id}`, {
      method: "POST",
      credentials: "include",
    })
    if (res.ok) {
      setFriendStatus("accepted")
      setActionMsg("フレンドになりました！")
    }
    setTimeout(() => setActionMsg(null), 3000)
  }

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
          ← LEADERBOARD
        </a>
      </div>
    )
  }

  const { level, xpInLevel, xpForNext } = computeXpProgress(profile.xp)
  const xpPct = xpForNext > 0 ? Math.round((xpInLevel / xpForNext) * 100) : 0
  const displayName = profile.displayName ?? profile.username

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
        {/* Player header */}
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
              overflow: "hidden",
            }}
          >
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatarUrl}
                alt=""
                style={{ height: "100%", width: "100%", objectFit: "cover" }}
              />
            ) : (
              <span style={{ color: "#00ff41" }}>{displayName.charAt(0).toUpperCase()}</span>
            )}
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
              {displayName}
            </div>
            <div style={{ fontSize: "0.7rem", color: "#005500" }}>@{profile.username}</div>
          </div>
        </div>

        {/* Level bar */}
        <div
          style={{ border: "1px solid #003300", padding: "1rem", background: "rgba(0,10,0,0.6)" }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "0.75rem",
            }}
          >
            <div style={{ fontSize: "0.75rem", letterSpacing: "0.15em", color: "#00aa2a" }}>
              LEVEL / XP
            </div>
            <div
              style={{
                fontSize: "1.1rem",
                fontWeight: "bold",
                color: "#00ff41",
                textShadow: "0 0 8px #00ff41",
              }}
            >
              LV.{level}
            </div>
          </div>
          <div
            style={{
              height: "8px",
              background: "#001100",
              border: "1px solid #003300",
              overflow: "hidden",
              marginBottom: "0.5rem",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${xpPct}%`,
                background: "#00ff41",
                boxShadow: "0 0 6px #00ff41",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.65rem",
              color: "#005500",
            }}
          >
            <span>TOTAL XP: {profile.xp.toLocaleString()}</span>
            <span>
              {xpInLevel} / {xpForNext} XP
            </span>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          {[
            { label: "MISSIONS CLEARED", value: profile.problemsSolved.toString() },
            { label: "BLOCKS OWNED", value: profile.totalBlocks.toString() },
          ].map(({ label, value }) => (
            <div
              key={label}
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
                }}
              >
                {value}
              </div>
              <div style={{ fontSize: "0.6rem", color: "#00aa2a", marginTop: "0.25rem" }}>
                {label}
              </div>
            </div>
          ))}
        </div>

        {/* Action message */}
        {actionMsg && (
          <div
            style={{
              color: "#00ff41",
              border: "1px solid #00ff41",
              padding: "0.5rem 1rem",
              fontSize: "0.8rem",
              textAlign: "center",
            }}
          >
            {actionMsg}
          </div>
        )}

        {/* Friend action buttons */}
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          {friendStatus === "none" && myId && (
            <button
              type="button"
              onClick={sendFriendRequest}
              style={{
                color: "#00ff41",
                border: "1px solid #00ff41",
                padding: "0.5rem 1.5rem",
                fontSize: "0.8rem",
                letterSpacing: "0.15em",
                background: "rgba(0,255,65,0.05)",
                fontFamily: "monospace",
                cursor: "pointer",
              }}
            >
              ▶ フレンド申請
            </button>
          )}
          {friendStatus === "pending_sent" && (
            <div
              style={{
                color: "#00aa2a",
                border: "1px solid #003300",
                padding: "0.5rem 1.5rem",
                fontSize: "0.8rem",
                letterSpacing: "0.15em",
              }}
            >
              ⏳ 申請済み
            </div>
          )}
          {friendStatus === "pending_received" && (
            <button
              type="button"
              onClick={acceptFriendRequest}
              style={{
                color: "#00ff41",
                border: "1px solid #00ff41",
                padding: "0.5rem 1.5rem",
                fontSize: "0.8rem",
                letterSpacing: "0.15em",
                background: "rgba(0,255,65,0.1)",
                fontFamily: "monospace",
                cursor: "pointer",
              }}
            >
              ✓ 承認する
            </button>
          )}
          {friendStatus === "accepted" && (
            <div
              style={{
                color: "#00ff41",
                border: "1px solid #003300",
                padding: "0.5rem 1.5rem",
                fontSize: "0.8rem",
                letterSpacing: "0.15em",
              }}
            >
              ★ フレンド
            </div>
          )}

          <a
            href={`/world/${profile.id}`}
            style={{
              color: "#00aa2a",
              border: "1px solid #003300",
              padding: "0.5rem 1.5rem",
              textDecoration: "none",
              fontSize: "0.8rem",
              letterSpacing: "0.15em",
            }}
          >
            ▷ ワールドを見る
          </a>
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
          ← LEADERBOARD
        </a>
      </div>
    </div>
  )
}
