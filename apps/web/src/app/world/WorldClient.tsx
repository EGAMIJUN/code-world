"use client"

import dynamic from "next/dynamic"
import { useEffect, useState } from "react"
import { useI18n } from "../../i18n"

const ThreeWorld = dynamic(() => import("./ThreeWorld"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        display: "flex",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        background: "#000",
        fontFamily: "monospace",
        color: "#00aa2a",
        letterSpacing: "0.25em",
        fontSize: "0.9rem",
      }}
    >
      ⟳ LOADING 3D WORLD...
    </div>
  ),
})

export type GameMode = "wave_defense" | "ffa" | "tdm" | "zombie" | "invasion" | "hunt"
export type GameMap = "urban" | "desert" | "snow" | "sky"
export type BotDifficulty = "easy" | "normal" | "hard"

const STORAGE_MODE = "cw_mode"
const STORAGE_MAP = "cw_map"
const STORAGE_BOT_COUNT = "cw_bot_count"
const STORAGE_BOT_DIFF = "cw_bot_diff"

export default function WorldClient() {
  const { t } = useI18n()
  const [phase, setPhase] = useState<"select" | "play">("select")
  const [mode, setMode] = useState<GameMode>("wave_defense")
  const [mapId, setMapId] = useState<GameMap>("urban")
  const [botCount, setBotCount] = useState<number>(5)
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>("normal")
  const [huntClears, setHuntClears] = useState(0)

  useEffect(() => {
    try {
      const m = localStorage.getItem(STORAGE_MODE) as GameMode | null
      const mp = localStorage.getItem(STORAGE_MAP) as GameMap | null
      const bc = localStorage.getItem(STORAGE_BOT_COUNT)
      const bd = localStorage.getItem(STORAGE_BOT_DIFF) as BotDifficulty | null
      if (m && ["wave_defense", "ffa", "tdm", "zombie", "invasion", "hunt"].includes(m)) setMode(m)
      if (mp && ["urban", "desert", "snow", "sky"].includes(mp)) setMapId(mp)
      if (bc !== null) {
        const n = Number.parseInt(bc, 10)
        if (Number.isFinite(n) && n >= 0 && n <= 9) setBotCount(n)
      }
      if (bd && ["easy", "normal", "hard"].includes(bd)) setBotDifficulty(bd)
      const hc = Number.parseInt(localStorage.getItem("hunt_clears") ?? "0", 10)
      if (Number.isFinite(hc) && hc > 0) setHuntClears(hc)
    } catch {
      /* ignore */
    }
  }, [])

  if (phase === "play") {
    return (
      <ThreeWorld
        mode={mode}
        mapId={mapId}
        botCount={botCount}
        botDifficulty={botDifficulty}
        onExit={() => setPhase("select")}
      />
    )
  }

  const showBotControls = mode === "ffa" || mode === "tdm"

  return (
    <div
      style={{
        height: "100%",
        overflow: "auto",
        background: "#000",
        color: "#00ff41",
        fontFamily: "monospace",
        padding: "1.5rem",
      }}
    >
      <div style={{ margin: "0 auto", maxWidth: "920px" }}>
        <div
          style={{
            textAlign: "center",
            fontSize: "1.6rem",
            fontWeight: "bold",
            letterSpacing: "0.3em",
            textShadow: "0 0 12px #00ff41",
            marginBottom: "1.5rem",
          }}
        >
          {t.mode.title}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "0.75rem",
            marginBottom: "2rem",
          }}
        >
          {[
            { id: "wave_defense" as GameMode, label: t.mode.waveDefense, desc: t.mode.waveDesc },
            { id: "ffa" as GameMode, label: t.mode.ffa, desc: t.mode.ffaDesc },
            { id: "tdm" as GameMode, label: t.mode.tdm, desc: t.mode.tdmDesc },
            { id: "zombie" as GameMode, label: t.mode.zombie, desc: t.mode.zombieDesc },
            { id: "invasion" as GameMode, label: t.mode.invasion, desc: t.mode.invasionDesc },
            { id: "hunt" as GameMode, label: t.mode.hunt, desc: t.mode.huntDesc },
          ].map((m) => {
            const sel = mode === m.id
            return (
              <button
                type="button"
                key={m.id}
                onClick={() => {
                  setMode(m.id)
                  try {
                    localStorage.setItem(STORAGE_MODE, m.id)
                  } catch {
                    /* ignore */
                  }
                }}
                style={{
                  background: sel ? "rgba(0,40,0,0.85)" : "rgba(0,10,0,0.5)",
                  border: `1px solid ${sel ? "#00ff41" : "#003300"}`,
                  color: "#00ff41",
                  padding: "1rem",
                  textAlign: "left",
                  cursor: "pointer",
                  fontFamily: "monospace",
                  boxShadow: sel ? "0 0 12px rgba(0,255,65,0.25)" : "none",
                }}
              >
                <div
                  style={{
                    fontSize: "1rem",
                    fontWeight: "bold",
                    letterSpacing: "0.15em",
                    marginBottom: "0.3rem",
                    textShadow: sel ? "0 0 6px #00ff41" : "none",
                  }}
                >
                  {sel ? `[${m.label}]` : m.label}
                  {m.id === "hunt" && huntClears > 0 && (
                    <span style={{ color: "#ffd700", marginLeft: "0.4rem" }}>
                      ★{huntClears > 1 ? `×${huntClears}` : ""}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "0.7rem", color: "#00aa2a", lineHeight: 1.5 }}>
                  {m.desc}
                </div>
              </button>
            )
          })}
        </div>

        <div
          style={{
            fontSize: "0.9rem",
            letterSpacing: "0.2em",
            marginBottom: "0.5rem",
            color: "#00aa2a",
          }}
        >
          {t.mode.selectMap}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "0.5rem",
            marginBottom: "2rem",
          }}
        >
          {[
            { id: "urban" as GameMap, label: t.mode.urban, color: "#7a8aa0" },
            { id: "desert" as GameMap, label: t.mode.desert, color: "#c9a064" },
            { id: "snow" as GameMap, label: t.mode.snow, color: "#cce8ff" },
            { id: "sky" as GameMap, label: t.mode.sky, color: "#7ec8ff" },
          ].map((m) => {
            const sel = mapId === m.id
            return (
              <button
                type="button"
                key={m.id}
                onClick={() => {
                  setMapId(m.id)
                  try {
                    localStorage.setItem(STORAGE_MAP, m.id)
                  } catch {
                    /* ignore */
                  }
                }}
                style={{
                  background: sel
                    ? `linear-gradient(135deg, ${m.color}30, transparent)`
                    : "rgba(0,8,0,0.6)",
                  border: `1px solid ${sel ? m.color : "#003300"}`,
                  color: sel ? m.color : "#00aa2a",
                  padding: "0.75rem",
                  cursor: "pointer",
                  fontFamily: "monospace",
                  fontSize: "0.85rem",
                  letterSpacing: "0.15em",
                  textShadow: sel ? `0 0 6px ${m.color}` : "none",
                }}
              >
                {sel ? `[${m.label}]` : m.label}
              </button>
            )
          })}
        </div>

        {showBotControls && (
          <>
            <div
              style={{
                fontSize: "0.9rem",
                letterSpacing: "0.2em",
                marginBottom: "0.5rem",
                color: "#00aa2a",
              }}
            >
              AI BOTS
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "0.75rem",
                marginBottom: "2rem",
              }}
            >
              <div
                style={{
                  background: "rgba(0,8,0,0.6)",
                  border: "1px solid #003300",
                  padding: "0.75rem",
                }}
              >
                <div
                  style={{
                    fontSize: "0.7rem",
                    color: "#00aa2a",
                    letterSpacing: "0.15em",
                    marginBottom: "0.5rem",
                  }}
                >
                  BOT COUNT
                </div>
                <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                  {[0, 1, 3, 5, 7, 9].map((n) => {
                    const sel = botCount === n
                    return (
                      <button
                        type="button"
                        key={n}
                        onClick={() => {
                          setBotCount(n)
                          try {
                            localStorage.setItem(STORAGE_BOT_COUNT, String(n))
                          } catch {
                            /* ignore */
                          }
                        }}
                        style={{
                          minWidth: "44px",
                          background: sel ? "rgba(0,255,65,0.18)" : "rgba(0,0,0,0.5)",
                          border: `1px solid ${sel ? "#00ff41" : "#003300"}`,
                          color: sel ? "#00ff41" : "#00aa2a",
                          padding: "0.4rem 0.6rem",
                          fontFamily: "monospace",
                          fontSize: "0.9rem",
                          cursor: "pointer",
                          textShadow: sel ? "0 0 4px #00ff41" : "none",
                        }}
                      >
                        {n}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div
                style={{
                  background: "rgba(0,8,0,0.6)",
                  border: "1px solid #003300",
                  padding: "0.75rem",
                }}
              >
                <div
                  style={{
                    fontSize: "0.7rem",
                    color: "#00aa2a",
                    letterSpacing: "0.15em",
                    marginBottom: "0.5rem",
                  }}
                >
                  DIFFICULTY
                </div>
                <div style={{ display: "flex", gap: "0.3rem" }}>
                  {(
                    [
                      { id: "easy", label: "EASY", color: "#66cc66" },
                      { id: "normal", label: "NORMAL", color: "#ffcc44" },
                      { id: "hard", label: "HARD", color: "#ff5544" },
                    ] as { id: BotDifficulty; label: string; color: string }[]
                  ).map((d) => {
                    const sel = botDifficulty === d.id
                    return (
                      <button
                        type="button"
                        key={d.id}
                        onClick={() => {
                          setBotDifficulty(d.id)
                          try {
                            localStorage.setItem(STORAGE_BOT_DIFF, d.id)
                          } catch {
                            /* ignore */
                          }
                        }}
                        style={{
                          flex: 1,
                          background: sel ? `${d.color}25` : "rgba(0,0,0,0.5)",
                          border: `1px solid ${sel ? d.color : "#003300"}`,
                          color: sel ? d.color : "#666",
                          padding: "0.4rem",
                          fontFamily: "monospace",
                          fontSize: "0.78rem",
                          letterSpacing: "0.1em",
                          cursor: "pointer",
                          textShadow: sel ? `0 0 4px ${d.color}` : "none",
                        }}
                      >
                        {d.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </>
        )}

        <div style={{ textAlign: "center" }}>
          <button
            type="button"
            onClick={() => setPhase("play")}
            style={{
              background: "rgba(0,40,0,0.85)",
              border: "1px solid #00ff41",
              color: "#00ff41",
              padding: "1rem 4rem",
              fontFamily: "monospace",
              fontSize: "1.1rem",
              letterSpacing: "0.3em",
              cursor: "pointer",
              textShadow: "0 0 10px #00ff41",
              boxShadow: "0 0 20px rgba(0,255,65,0.3)",
            }}
          >
            {t.mode.start}
          </button>
        </div>
      </div>
    </div>
  )
}
