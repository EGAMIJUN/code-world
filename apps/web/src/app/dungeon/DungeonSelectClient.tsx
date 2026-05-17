"use client"

import { useState } from "react"

interface DungeonRow {
  id: string
  name: string
  description: string
  language: string
  levelRequired: number
  bossName: string
  bossHp: number
}

const LANG_COLORS: Record<string, string> = {
  sql: "#00ff41",
  python: "#4fc3f7",
  javascript: "#ffeb3b",
  csharp: "#ce93d8",
}

const LANG_LABELS: Record<string, string> = {
  sql: "SQL",
  python: "PYTHON",
  javascript: "JAVASCRIPT",
  csharp: "C#",
}

function groupByLanguage(dungeons: DungeonRow[]): Record<string, DungeonRow[]> {
  return dungeons.reduce<Record<string, DungeonRow[]>>((acc, d) => {
    if (!acc[d.language]) acc[d.language] = []
    acc[d.language]?.push(d)
    return acc
  }, {})
}

export default function DungeonSelectClient({ dungeons }: { dungeons: DungeonRow[] }) {
  const [hovered, setHovered] = useState<string | null>(null)
  const grouped = groupByLanguage(dungeons)

  return (
    <div
      style={{
        minHeight: "100%",
        background: "#000",
        color: "#00ff41",
        fontFamily: "monospace",
        position: "relative",
        overflowY: "auto",
      }}
    >
      <div style={{ position: "relative", zIndex: 1, padding: "2rem" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "3rem" }}>
          <div
            style={{
              fontSize: "2.5rem",
              fontWeight: "bold",
              color: "#00ff41",
              textShadow: "0 0 20px #00ff41, 0 0 40px #00ff41",
              letterSpacing: "0.3em",
              marginBottom: "0.5rem",
            }}
          >
            ▓▓ DUNGEON ACCESS ▓▓
          </div>
          <div style={{ color: "#00aa2a", fontSize: "0.9rem", letterSpacing: "0.2em" }}>
            SELECT TARGET DATABASE &gt;&gt; INITIATE BREACH SEQUENCE
          </div>
        </div>

        {/* Dungeon grid by language */}
        {Object.entries(grouped).map(([lang, langDungeons]) => (
          <div key={lang} style={{ marginBottom: "2.5rem" }}>
            <div
              style={{
                borderLeft: `3px solid ${LANG_COLORS[lang] ?? "#00ff41"}`,
                paddingLeft: "1rem",
                marginBottom: "1rem",
                color: LANG_COLORS[lang] ?? "#00ff41",
                fontSize: "1rem",
                letterSpacing: "0.3em",
                textShadow: `0 0 10px ${LANG_COLORS[lang] ?? "#00ff41"}`,
              }}
            >
              ▶ {LANG_LABELS[lang] ?? lang.toUpperCase()} SECTOR
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
                gap: "1rem",
              }}
            >
              {langDungeons.map((dungeon) => (
                <a
                  key={dungeon.id}
                  href={`/dungeon/${dungeon.id}`}
                  onMouseEnter={() => setHovered(dungeon.id)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    display: "block",
                    border: `1px solid ${hovered === dungeon.id ? (LANG_COLORS[lang] ?? "#00ff41") : "#003300"}`,
                    borderRadius: "4px",
                    padding: "1.25rem",
                    background: hovered === dungeon.id ? "rgba(0,255,65,0.05)" : "rgba(0,20,0,0.8)",
                    textDecoration: "none",
                    color: "#00ff41",
                    transition: "all 0.2s",
                    boxShadow:
                      hovered === dungeon.id
                        ? `0 0 20px ${LANG_COLORS[lang] ?? "#00ff41"}33`
                        : "none",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.7rem",
                      color: "#00aa2a",
                      letterSpacing: "0.2em",
                      marginBottom: "0.5rem",
                    }}
                  >
                    LV.{dungeon.levelRequired}+ REQUIRED
                  </div>
                  <div
                    style={{
                      fontSize: "1.1rem",
                      fontWeight: "bold",
                      letterSpacing: "0.1em",
                      marginBottom: "0.5rem",
                      textShadow:
                        hovered === dungeon.id
                          ? `0 0 10px ${LANG_COLORS[lang] ?? "#00ff41"}`
                          : "none",
                    }}
                  >
                    {dungeon.name}
                  </div>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "#00aa2a",
                      marginBottom: "0.75rem",
                      lineHeight: 1.4,
                    }}
                  >
                    {dungeon.description}
                  </div>
                  <div
                    style={{
                      borderTop: "1px solid #003300",
                      paddingTop: "0.5rem",
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "0.75rem",
                    }}
                  >
                    <span style={{ color: "#ff3333" }}>
                      BOSS: {dungeon.bossName} [{dungeon.bossHp} HP]
                    </span>
                    <span style={{ color: LANG_COLORS[lang] ?? "#00ff41" }}>
                      {hovered === dungeon.id ? "[ ENTER >> ]" : "[ LOCKED ]"}
                    </span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        ))}

        {dungeons.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "4rem",
              color: "#ff3333",
              fontSize: "1.2rem",
              letterSpacing: "0.2em",
            }}
          >
            CONNECTION FAILED — RETRY ACCESS
          </div>
        )}
      </div>
    </div>
  )
}
