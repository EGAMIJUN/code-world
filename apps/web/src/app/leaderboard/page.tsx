const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

interface LeaderboardEntry {
  rank: number
  playerId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  level: number
  totalScore: number
  problemsSolved: number
}

async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    const res = await fetch(`${API_URL}/api/leaderboard`, { cache: "no-store" })
    if (!res.ok) return []
    const json = (await res.json()) as { data: { entries: LeaderboardEntry[] } }
    return json.data.entries
  } catch {
    return []
  }
}

export default async function LeaderboardPage() {
  const entries = await getLeaderboard()

  return (
    <div
      style={{
        minHeight: "100%",
        fontFamily: "monospace",
        color: "#00ff41",
      }}
    >
      <main style={{ margin: "0 auto", maxWidth: "800px", padding: "2rem 1rem" }}>
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
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
            ▓ GLOBAL RANKING ▓
          </div>
          <div style={{ fontSize: "0.75rem", color: "#00aa2a", letterSpacing: "0.2em" }}>
            TOP HACKERS — RANKED BY SYSTEM ACCESS SCORE
          </div>
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
            <div style={{ marginBottom: "1rem" }}>NO DATA — RANKING EMPTY</div>
            <a
              href="/problems"
              style={{ color: "#00aa2a", textDecoration: "none", fontSize: "0.8rem" }}
            >
              ▶ SOLVE MISSIONS TO RANK →
            </a>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
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

              return (
                <div
                  key={entry.playerId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "1rem",
                    border: `1px solid ${isTop3 ? `${rankColor}44` : "#003300"}`,
                    padding: "0.75rem 1rem",
                    background: isTop3 ? "rgba(0,15,0,0.8)" : "rgba(0,8,0,0.6)",
                    boxShadow: isTop3 ? `0 0 10px ${rankColor}22` : "none",
                  }}
                >
                  {/* Rank */}
                  <div
                    style={{
                      width: "3.5rem",
                      textAlign: "center",
                      fontWeight: "bold",
                      fontSize: "0.9rem",
                      letterSpacing: "0.1em",
                      color: rankColor,
                      textShadow: isTop3 ? `0 0 8px ${rankColor}` : "none",
                      flexShrink: 0,
                    }}
                  >
                    {rankLabel}
                  </div>

                  {/* Avatar */}
                  <div
                    style={{
                      height: "36px",
                      width: "36px",
                      flexShrink: 0,
                      border: "1px solid #003300",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.85rem",
                      fontWeight: "bold",
                      color: "#00aa2a",
                      overflow: "hidden",
                    }}
                  >
                    {entry.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={entry.avatarUrl}
                        alt=""
                        style={{ height: "100%", width: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      (entry.displayName ?? entry.username).charAt(0).toUpperCase()
                    )}
                  </div>

                  {/* Name */}
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
                      {entry.displayName ?? entry.username}
                    </div>
                    <div style={{ fontSize: "0.65rem", color: "#005500", letterSpacing: "0.05em" }}>
                      @{entry.username}
                    </div>
                  </div>

                  {/* Level */}
                  <div
                    style={{
                      flexShrink: 0,
                      border: "1px solid #003300",
                      padding: "0.1rem 0.5rem",
                      fontSize: "0.7rem",
                      color: "#00aa2a",
                      letterSpacing: "0.1em",
                    }}
                  >
                    LV.{entry.level}
                  </div>

                  {/* Score */}
                  <div style={{ flexShrink: 0, textAlign: "right" }}>
                    <div
                      style={{
                        fontSize: "0.9rem",
                        fontWeight: "bold",
                        color: rankColor,
                        textShadow: isTop3 ? `0 0 6px ${rankColor}` : "none",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {entry.totalScore.toLocaleString()} PT
                    </div>
                    <div style={{ fontSize: "0.65rem", color: "#005500" }}>
                      {entry.problemsSolved} SOLVED
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
