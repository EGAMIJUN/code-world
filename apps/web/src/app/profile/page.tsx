"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { signOut } from "../../lib/auth-client"

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

type AchievementType = "first_ac" | "ten_solved" | "diamond_block" | "level_5"

interface AchievementInfo {
  label: string
  description: string
  icon: string
}

const ACHIEVEMENT_INFO: Record<AchievementType, AchievementInfo> = {
  first_ac: { label: "FIRST HIT", description: "初めての正解", icon: "★" },
  ten_solved: { label: "10 CLEAR", description: "10問クリア達成", icon: "◆" },
  diamond_block: { label: "DIAMOND", description: "ダイヤブロックを入手", icon: "◈" },
  level_5: { label: "LV.5", description: "レベル5に到達", icon: "⚡" },
}

const ALL_ACHIEVEMENTS: AchievementType[] = ["first_ac", "ten_solved", "diamond_block", "level_5"]

interface ProfileData {
  id: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  level: number
  xp: number
  problemsSolved: number
  totalSubmissions: number
  correctRate: number
  totalBlocks: number
  achievements: { id: string; achievementType: AchievementType; unlockedAt: string }[]
}

interface FriendEntry {
  friendId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  level: number
}

interface PendingEntry {
  requesterId: string
  username: string
  displayName: string | null
}

function computeXpProgress(totalXp: number): {
  level: number
  xpInLevel: number
  xpForNext: number
} {
  let level = 0
  let consumed = 0
  for (;;) {
    const needed = 100 * (level + 1)
    if (consumed + needed > totalXp) {
      return { level, xpInLevel: totalXp - consumed, xpForNext: needed }
    }
    consumed += needed
    level++
  }
}

export default function ProfilePage() {
  const router = useRouter()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [friends, setFriends] = useState<FriendEntry[]>([])
  const [pending, setPending] = useState<PendingEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const handleLogout = async () => {
    await signOut()
    router.push("/login")
  }

  const acceptFriend = async (requesterId: string) => {
    await fetch(`${API_URL}/api/friends/accept/${requesterId}`, {
      method: "POST",
      credentials: "include",
    })
    const [fRes, pRes] = await Promise.all([
      fetch(`${API_URL}/api/friends`, { credentials: "include" }),
      fetch(`${API_URL}/api/friends/pending`, { credentials: "include" }),
    ])
    if (fRes.ok) setFriends(((await fRes.json()) as { data: FriendEntry[] }).data)
    if (pRes.ok) setPending(((await pRes.json()) as { data: PendingEntry[] }).data)
  }

  useEffect(() => {
    async function loadAll() {
      try {
        const [profileRes, friendsRes, pendingRes] = await Promise.all([
          fetch(`${API_URL}/api/profile/me`, { credentials: "include" }),
          fetch(`${API_URL}/api/friends`, { credentials: "include" }),
          fetch(`${API_URL}/api/friends/pending`, { credentials: "include" }),
        ])
        if (!profileRes.ok) {
          setError(
            profileRes.status === 401 ? "LOGIN REQUIRED — ACCESS DENIED" : "PROFILE LOAD FAILED",
          )
          return
        }
        const json = (await profileRes.json()) as { data: ProfileData }
        setProfile(json.data)
        if (friendsRes.ok) setFriends(((await friendsRes.json()) as { data: FriendEntry[] }).data)
        if (pendingRes.ok) setPending(((await pendingRes.json()) as { data: PendingEntry[] }).data)
      } catch {
        setError("CONNECTION ERROR")
      } finally {
        setLoading(false)
      }
    }
    loadAll()
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

  const { level, xpInLevel, xpForNext } = computeXpProgress(profile.xp)
  const xpPct = xpForNext > 0 ? Math.round((xpInLevel / xpForNext) * 100) : 0
  const unlockedSet = new Set(profile.achievements.map((a) => a.achievementType))
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
          maxWidth: "700px",
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
              fontWeight: "bold",
              color: "#00ff41",
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
              displayName.charAt(0).toUpperCase()
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
            <div style={{ fontSize: "0.7rem", color: "#005500", letterSpacing: "0.05em" }}>
              @{profile.username}
            </div>
          </div>
        </div>

        {/* Level & XP */}
        <div
          style={{
            border: "1px solid #003300",
            padding: "1rem",
            background: "rgba(0,10,0,0.6)",
          }}
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
                letterSpacing: "0.1em",
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
                transition: "width 0.5s ease",
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.75rem" }}>
          <StatCard label="MISSIONS CLEARED" value={profile.problemsSolved.toString()} />
          <StatCard label="ACCURACY" value={`${profile.correctRate}%`} />
          <StatCard label="TOTAL SUBMISSIONS" value={profile.totalSubmissions.toString()} />
          <StatCard label="BLOCKS OWNED" value={profile.totalBlocks.toString()} />
        </div>

        {/* Achievements */}
        <div>
          <div
            style={{
              fontSize: "0.75rem",
              letterSpacing: "0.2em",
              color: "#00aa2a",
              marginBottom: "0.75rem",
            }}
          >
            ▓ ACHIEVEMENTS
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.5rem" }}>
            {ALL_ACHIEVEMENTS.map((type) => {
              const info = ACHIEVEMENT_INFO[type]
              const unlocked = unlockedSet.has(type)
              const achievementRecord = profile.achievements.find((a) => a.achievementType === type)

              return (
                <div
                  key={type}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    border: `1px solid ${unlocked ? "#003300" : "#001100"}`,
                    padding: "0.75rem",
                    background: unlocked ? "rgba(0,15,0,0.6)" : "rgba(0,5,0,0.4)",
                    opacity: unlocked ? 1 : 0.4,
                  }}
                >
                  <span
                    style={{
                      fontSize: "1.3rem",
                      flexShrink: 0,
                      color: unlocked ? "#00ff41" : "#005500",
                      textShadow: unlocked ? "0 0 8px #00ff41" : "none",
                    }}
                  >
                    {info.icon}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: "bold",
                        letterSpacing: "0.1em",
                        color: unlocked ? "#00ff41" : "#005500",
                      }}
                    >
                      {info.label}
                    </div>
                    <div style={{ fontSize: "0.65rem", color: "#005500" }}>{info.description}</div>
                    {unlocked && achievementRecord && (
                      <div style={{ fontSize: "0.6rem", color: "#003300", marginTop: "0.1rem" }}>
                        {new Date(achievementRecord.unlockedAt).toLocaleDateString("ja-JP")}{" "}
                        UNLOCKED
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Pending friend requests */}
        {pending.length > 0 && (
          <div>
            <div
              style={{
                fontSize: "0.75rem",
                letterSpacing: "0.2em",
                color: "#00aa2a",
                marginBottom: "0.75rem",
              }}
            >
              ▓ フレンド申請 ({pending.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {pending.map((p) => (
                <div
                  key={p.requesterId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    border: "1px solid #003300",
                    padding: "0.5rem 0.75rem",
                    background: "rgba(0,10,0,0.6)",
                  }}
                >
                  <span style={{ fontSize: "0.8rem" }}>
                    {p.displayName ?? p.username}
                    <span style={{ color: "#005500", marginLeft: "0.5rem" }}>@{p.username}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => acceptFriend(p.requesterId)}
                    style={{
                      color: "#00ff41",
                      border: "1px solid #00ff41",
                      padding: "0.2rem 0.75rem",
                      fontSize: "0.7rem",
                      background: "transparent",
                      fontFamily: "monospace",
                      cursor: "pointer",
                      letterSpacing: "0.1em",
                    }}
                  >
                    ✓ 承認
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Friend list */}
        <div>
          <div
            style={{
              fontSize: "0.75rem",
              letterSpacing: "0.2em",
              color: "#00aa2a",
              marginBottom: "0.75rem",
            }}
          >
            ▓ フレンド ({friends.length})
          </div>
          {friends.length === 0 ? (
            <div style={{ fontSize: "0.75rem", color: "#003300", letterSpacing: "0.1em" }}>
              まだフレンドがいません。プロフィールページで申請しましょう！
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.5rem" }}>
              {friends.map((f) => (
                <a
                  key={f.friendId}
                  href={`/profile/${f.friendId}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    border: "1px solid #003300",
                    padding: "0.5rem 0.75rem",
                    background: "rgba(0,10,0,0.6)",
                    textDecoration: "none",
                    color: "#00ff41",
                  }}
                >
                  <div
                    style={{
                      width: "32px",
                      height: "32px",
                      flexShrink: 0,
                      border: "1px solid #003300",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                      fontSize: "0.9rem",
                    }}
                  >
                    {f.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={f.avatarUrl}
                        alt=""
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      <span style={{ color: "#00ff41" }}>
                        {(f.displayName ?? f.username).charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "0.75rem", fontWeight: "bold" }}>
                      {f.displayName ?? f.username}
                    </div>
                    <div style={{ fontSize: "0.6rem", color: "#005500" }}>LV.{f.level}</div>
                  </div>
                  <div style={{ marginLeft: "auto", fontSize: "0.65rem", color: "#003300" }}>
                    WORLD →
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Links */}
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <a
            href="/problems"
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
            ▶ SOLVE MISSIONS
          </a>
          <a
            href="/world"
            style={{
              color: "#00aa2a",
              border: "1px solid #003300",
              padding: "0.5rem 1.5rem",
              textDecoration: "none",
              fontSize: "0.8rem",
              letterSpacing: "0.15em",
            }}
          >
            ▷ WORLD
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
            ▷ LOGOUT
          </button>
        </div>
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
