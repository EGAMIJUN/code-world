import Link from "next/link"

const MISSIONS = [
  {
    id: "sql",
    title: "SQL爆弾解除",
    subtitle: "QUERY BOMB DEFUSAL",
    description: "データベースに仕掛けられたSQLクエリ爆弾を正しいクエリで解除せよ。時間切れで全データが消滅する。",
    icon: "💾",
    difficulty: 2,
    reward: "木材ブロック ×3",
    href: "/dungeon",
    tags: ["SQL", "SELECT", "JOIN"],
    zoneColor: "#6ab0ff",
    borderColor: "#1a3a6a",
  },
  {
    id: "ai",
    title: "AIエネミー撃破",
    subtitle: "AI ENEMY TAKEDOWN",
    description: "悪意あるAIが生成したバグだらけのコードをデバッグし、AIを無力化せよ。",
    icon: "🤖",
    difficulty: 3,
    reward: "ダイヤブロック ×1",
    href: "/dungeon",
    tags: ["DEBUG", "REVIEW", "LOGIC"],
    zoneColor: "#ff6a6a",
    borderColor: "#5a0000",
  },
  {
    id: "data",
    title: "データ収集",
    subtitle: "DATA COLLECTION",
    description: "分散したサーバーから必要なデータを集め、システム設計の問題を解いて街を復旧させよ。",
    icon: "📡",
    difficulty: 1,
    reward: "石ブロック ×5",
    href: "/dungeon",
    tags: ["DESIGN", "SYSTEM", "API"],
    zoneColor: "#5aef5a",
    borderColor: "#0a3a0a",
  },
  {
    id: "boss",
    title: "ボス討伐",
    subtitle: "BOSS RAID",
    description: "最強のシステム設計ボスに挑め。全問正解でのみ撃破可能。報酬は最高級。",
    icon: "👾",
    difficulty: 3,
    reward: "ダイヤブロック ×3 + XP×500",
    href: "/dungeon",
    tags: ["BOSS", "HARD", "ALL"],
    zoneColor: "#c06aff",
    borderColor: "#3a0a5a",
  },
]

function StarRating({ count }: { count: number }) {
  return (
    <div style={{ display: "flex", gap: "2px" }}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          style={{
            fontSize: "0.8rem",
            color: i <= count ? "#ffcc00" : "#223322",
            textShadow: i <= count ? "0 0 6px #ffcc00" : "none",
          }}
        >
          ★
        </span>
      ))}
    </div>
  )
}

export default function MissionsPage() {
  return (
    <div
      style={{
        minHeight: "100%",
        background: "#000000",
        fontFamily: "monospace",
        color: "#00ff41",
        padding: "2rem 1rem",
      }}
    >
      <div style={{ maxWidth: "900px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "2.5rem", textAlign: "center" }}>
          <div
            style={{
              fontSize: "0.7rem",
              letterSpacing: "0.4em",
              color: "#003300",
              marginBottom: "0.5rem",
            }}
          >
            CODE WORLD // MISSION CONTROL
          </div>
          <h1
            style={{
              fontSize: "2rem",
              fontWeight: "bold",
              letterSpacing: "0.3em",
              color: "#00ff41",
              textShadow: "0 0 30px #00ff41",
              margin: 0,
            }}
          >
            MISSIONS
          </h1>
          <p style={{ color: "#005500", fontSize: "0.8rem", marginTop: "0.75rem", letterSpacing: "0.1em" }}>
            ミッションをクリアしてブロックとXPを獲得せよ
          </p>
        </div>

        {/* Mission grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
            gap: "1.25rem",
          }}
        >
          {MISSIONS.map((mission) => (
            <div
              key={mission.id}
              style={{
                border: `1px solid ${mission.borderColor}`,
                background: "rgba(0,0,0,0.8)",
                padding: "1.5rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.875rem",
                position: "relative",
                overflow: "hidden",
              }}
            >
              {/* Glow accent */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: "1px",
                  background: mission.zoneColor,
                  opacity: 0.4,
                }}
              />

              {/* Title row */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem" }}>
                <span style={{ fontSize: "2rem", lineHeight: 1 }}>{mission.icon}</span>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: "0.6rem",
                      letterSpacing: "0.3em",
                      color: mission.zoneColor,
                      marginBottom: "0.2rem",
                      opacity: 0.8,
                    }}
                  >
                    {mission.subtitle}
                  </div>
                  <h2
                    style={{
                      margin: 0,
                      fontSize: "1.1rem",
                      fontWeight: "bold",
                      letterSpacing: "0.1em",
                      color: "#00ff41",
                    }}
                  >
                    {mission.title}
                  </h2>
                </div>
                <StarRating count={mission.difficulty} />
              </div>

              {/* Description */}
              <p
                style={{
                  margin: 0,
                  fontSize: "0.78rem",
                  color: "#446644",
                  lineHeight: 1.6,
                  letterSpacing: "0.03em",
                }}
              >
                {mission.description}
              </p>

              {/* Tags */}
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                {mission.tags.map((tag) => (
                  <span
                    key={tag}
                    style={{
                      fontSize: "0.6rem",
                      letterSpacing: "0.15em",
                      border: `1px solid ${mission.borderColor}`,
                      color: "#335533",
                      padding: "0.1rem 0.4rem",
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>

              {/* Reward + CTA */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderTop: `1px solid ${mission.borderColor}`,
                  paddingTop: "0.75rem",
                  marginTop: "0.25rem",
                  gap: "0.75rem",
                }}
              >
                <div>
                  <div style={{ fontSize: "0.6rem", color: "#334433", letterSpacing: "0.15em", marginBottom: "0.15rem" }}>
                    REWARD
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "#ffcc00", letterSpacing: "0.05em" }}>
                    {mission.reward}
                  </div>
                </div>
                <Link
                  href={mission.href}
                  style={{
                    padding: "0.4rem 1.25rem",
                    background: "transparent",
                    border: `1px solid ${mission.zoneColor}`,
                    color: mission.zoneColor,
                    fontFamily: "monospace",
                    fontSize: "0.75rem",
                    letterSpacing: "0.2em",
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                    textShadow: `0 0 8px ${mission.zoneColor}`,
                    flexShrink: 0,
                  }}
                >
                  ▶ BEGIN
                </Link>
              </div>
            </div>
          ))}
        </div>

        {/* Footer tip */}
        <div
          style={{
            marginTop: "2.5rem",
            padding: "1rem",
            border: "1px solid #002200",
            background: "rgba(0,10,0,0.6)",
            fontSize: "0.72rem",
            color: "#334433",
            letterSpacing: "0.08em",
            lineHeight: 1.7,
          }}
        >
          <span style={{ color: "#005500" }}>TIP: </span>
          問題を解くとインベントリにブロックが追加されます。{" "}
          <Link href="/world" style={{ color: "#00aa2a", textDecoration: "underline" }}>
            WORLD
          </Link>{" "}
          画面でブロックを使って自分の街を建設しよう。難易度が高いほど良いブロックが手に入ります。
        </div>
      </div>
    </div>
  )
}
