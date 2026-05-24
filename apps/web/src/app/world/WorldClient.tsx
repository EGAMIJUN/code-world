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

export type GameMode = "wave_defense" | "ffa" | "tdm"
export type GameMap = "urban" | "desert" | "snow"

const STORAGE_MODE = "cw_mode"
const STORAGE_MAP = "cw_map"

export default function WorldClient() {
  const { t } = useI18n()
  const [phase, setPhase] = useState<"select" | "play">("select")
  const [mode, setMode] = useState<GameMode>("wave_defense")
  const [mapId, setMapId] = useState<GameMap>("urban")

  useEffect(() => {
    try {
      const m = localStorage.getItem(STORAGE_MODE) as GameMode | null
      const mp = localStorage.getItem(STORAGE_MAP) as GameMap | null
      if (m && ["wave_defense", "ffa", "tdm"].includes(m)) setMode(m)
      if (mp && ["urban", "desert", "snow"].includes(mp)) setMapId(mp)
    } catch {
      /* ignore */
    }
  }, [])

  if (phase === "play") {
    return <ThreeWorld mode={mode} mapId={mapId} onExit={() => setPhase("select")} />
  }

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
            { id: "urban" as GameMap, label: t.mode.urban, color: "#444444" },
            { id: "desert" as GameMap, label: t.mode.desert, color: "#c9a064" },
            { id: "snow" as GameMap, label: t.mode.snow, color: "#cce8ff" },
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
