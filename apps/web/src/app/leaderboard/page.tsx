// biome-ignore lint/complexity/useLiteralKeys: bracket notation required per CLAUDE.md
const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

interface LeaderboardEntry {
  rank: number
  id: string
  username: string
  totalKills: number
  totalDeaths: number
  totalScore: number
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
            TOP SOLDIERS — RANKED BY TOTAL SCORE
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
              href="/world"
              style={{ color: "#00aa2a", textDecoration: "none", fontSize: "0.8rem" }}
            >
              ▶ PLAY TO RANK →
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
              const kd =
                entry.totalDeaths > 0
                  ? (entry.totalKills / entry.totalDeaths).toFixed(2)
                  : entry.totalKills.toString()

              return (
                <a
                  key={entry.id}
                  href={`/profile/${entry.id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "1rem",
                    border: `1px solid ${isTop3 ? `${rankColor}44` : "#003300"}`,
                    padding: "0.75rem 1rem",
                    background: isTop3 ? "rgba(0,15,0,0.8)" : "rgba(0,8,0,0.6)",
                    boxShadow: isTop3 ? `0 0 10px ${rankColor}22` : "none",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
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
                    }}
                  >
                    {entry.username.charAt(0).toUpperCase()}
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
                    <div style={{ fontSize: "0.65rem", color: "#005500", letterSpacing: "0.05em" }}>
                      K/D {kd}
                    </div>
                  </div>

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
                    K {entry.totalKills}
                  </div>

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
                      {entry.totalDeaths} DEATHS
                    </div>
                  </div>
                </a>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
