"use client"

import dynamic from "next/dynamic"
import { useCallback, useEffect, useRef, useState } from "react"

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false })

interface ProblemBody {
  description: string
  setup?: string
  hints?: Array<{ level: number; text: string }>
}

interface Problem {
  id: string
  title: string
  category: string
  difficulty: number
  body: ProblemBody
}

interface DungeonRoom {
  id: string
  dungeonId: string
  problemId: string
  roomType: "minion" | "miniboss" | "boss"
  roomOrder: number
  problem: Problem
}

interface DungeonWithRooms {
  id: string
  name: string
  description: string
  language: string
  levelRequired: number
  bossName: string
  bossHp: number
  rooms: DungeonRoom[]
}

type BattlePhase = "fighting" | "victory" | "defeat"
type SubmitStatus = "idle" | "submitting" | "polling" | "done"
type JudgeResult = "accepted" | "wrong_answer" | "runtime_error" | "time_limit_exceeded"
type PollResult = { result: JudgeResult; message?: string }

const BOSS_ASCII: Record<string, string[]> = {
  default: [
    "   ╔═══════╗   ",
    "   ║ ◉   ◉ ║   ",
    "   ║   ▼   ║   ",
    "   ║ ╔═══╗ ║   ",
    "   ╚═╝   ╚═╝   ",
    "  /│  ███  │\\  ",
    " / │       │ \\ ",
    "   ╔═══════╗   ",
    "   ║███████║   ",
    "   ╚═══════╝   ",
  ],
  miniboss: [
    " ┌─────────┐ ",
    " │ ◈     ◈ │ ",
    " │    ▽    │ ",
    " │  ╔═══╗  │ ",
    " └──╝   ╚──┘ ",
    "  /│  ▓▓▓  │\\",
    "   │ ▓▓▓▓▓ │  ",
    " ┌─╨─────╨─┐ ",
    " │ ▓▓▓▓▓▓▓ │ ",
    " └─────────┘ ",
  ],
  boss: [
    "╔═══════════╗",
    "║ ◉◉     ◉◉ ║",
    "║   ╔═══╗   ║",
    "║   ║▓▓▓║   ║",
    "╠═══╬═══╬═══╣",
    "║▓▓▓║   ║▓▓▓║",
    "║   ╚═══╝   ║",
    "╠═══════════╣",
    "║▓▓▓▓▓▓▓▓▓▓▓║",
    "╚═══════════╝",
  ],
}

function getBossArt(roomType: string): string[] {
  if (roomType === "boss") return BOSS_ASCII.boss!
  if (roomType === "miniboss") return BOSS_ASCII.miniboss!
  return BOSS_ASCII.default!
}

function HpBar({
  current,
  max,
  color,
  label,
}: {
  current: number
  max: number
  color: string
  label: string
}) {
  const pct = Math.max(0, Math.min(100, (current / max) * 100))
  return (
    <div style={{ flex: 1 }}>
      <div
        style={{
          fontSize: "0.7rem",
          color: "#00aa2a",
          letterSpacing: "0.15em",
          marginBottom: "4px",
        }}
      >
        {label}: {current}/{max}
      </div>
      <div
        style={{
          height: "12px",
          background: "#001100",
          border: `1px solid ${color}`,
          borderRadius: "2px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: color,
            boxShadow: `0 0 8px ${color}`,
            transition: "width 0.3s ease",
          }}
        />
      </div>
    </div>
  )
}

export default function BattleClient({ dungeon }: { dungeon: DungeonWithRooms }) {
  const rooms = dungeon.rooms.sort((a, b) => a.roomOrder - b.roomOrder)
  const totalRooms = rooms.length

  const [roomIndex, setRoomIndex] = useState(0)
  const [playerHp, setPlayerHp] = useState(200)
  const [bossHp, setBossHp] = useState(dungeon.bossHp)
  const [phase, setPhase] = useState<BattlePhase>("fighting")
  const initialCode = (() => {
    if (dungeon.language === "python") return "# HACK THE SYSTEM\n"
    if (dungeon.language === "javascript") return "// HACK THE SYSTEM\n"
    if (dungeon.language === "csharp") return "// HACK THE SYSTEM\n"
    return "-- HACK THE SYSTEM\nSELECT "
  })()
  const [code, setCode] = useState(initialCode)
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle")
  const [lastResult, setLastResult] = useState<JudgeResult | null>(null)
  const [lastResultMsg, setLastResultMsg] = useState<string | null>(null)
  const [flashType, setFlashType] = useState<"green" | "red" | null>(null)
  const [shake, setShake] = useState(false)
  const [timerTick, setTimerTick] = useState(15)
  const playerHpRef = useRef(playerHp)
  const bossHpRef = useRef(bossHp)
  const phaseRef = useRef(phase)

  const playerMaxHp = 200
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

  useEffect(() => {
    playerHpRef.current = playerHp
  }, [playerHp])
  useEffect(() => {
    bossHpRef.current = bossHp
  }, [bossHp])
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  // Boss attack timer: every 15 seconds deal 5 damage
  // biome-ignore lint/correctness/useExhaustiveDependencies: roomIndex resets the countdown on room advance intentionally
  useEffect(() => {
    if (phase !== "fighting") return

    let countdown = 15
    setTimerTick(15)

    const tick = setInterval(() => {
      if (phaseRef.current !== "fighting") {
        clearInterval(tick)
        return
      }
      countdown--
      setTimerTick(countdown)

      if (countdown <= 0) {
        countdown = 15
        setTimerTick(15)
        const newHp = Math.max(0, playerHpRef.current - 5)
        setPlayerHp(newHp)
        setShake(true)
        setTimeout(() => setShake(false), 500)
        if (newHp <= 0) {
          setPhase("defeat")
          clearInterval(tick)
        }
      }
    }, 1000)

    return () => clearInterval(tick)
  }, [phase, roomIndex])

  const triggerFlash = useCallback((type: "green" | "red") => {
    setFlashType(type)
    setTimeout(() => setFlashType(null), 600)
  }, [])

  const isSqlDungeon = dungeon.language === "sql"
  // SQL: 75 retries × 800ms = 60s  /  non-SQL stubs: 75 retries × 400ms = 30s
  const pollInterval = isSqlDungeon ? 800 : 400
  const maxRetries = 75

  const pollSubmission = useCallback(
    async (submissionId: string, retries = 0): Promise<PollResult> => {
      if (retries >= maxRetries) return { result: "runtime_error", message: "Execution timed out (executor may be down)" }
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
      try {
        const res = await fetch(`${apiUrl}/api/submissions/${submissionId}`)
        if (!res.ok) return { result: "runtime_error", message: "Failed to fetch result" }
        const json = (await res.json()) as {
          data: { result: string; feedback?: { message?: string } }
        }
        const r = json.data.result
        if (r !== "pending" && r !== null && r !== undefined) {
          const pollResult: PollResult = { result: r as JudgeResult }
          const msg = json.data.feedback?.message
          if (msg) pollResult.message = msg
          return pollResult
        }
        return pollSubmission(submissionId, retries + 1)
      } catch {
        return { result: "runtime_error", message: "Network error" }
      }
    },
    [apiUrl, pollInterval, maxRetries],
  )

  const handleSubmit = useCallback(async () => {
    if (phase !== "fighting" || submitStatus !== "idle") return

    const currentRoom = rooms[roomIndex]
    if (!currentRoom) return

    setSubmitStatus("submitting")
    setLastResult(null)
    setLastResultMsg(null)

    try {
      const res = await fetch(`${apiUrl}/api/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          problemId: currentRoom.problem.id,
          code,
          language: dungeon.language,
        }),
      })

      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string }
        setSubmitStatus("done")
        setLastResult("runtime_error")
        setLastResultMsg(errJson.error ?? "Submission failed")
        const newHp = Math.max(0, playerHpRef.current - 10)
        setPlayerHp(newHp)
        triggerFlash("red")
        setShake(true)
        setTimeout(() => setShake(false), 500)
        if (newHp <= 0) setPhase("defeat")
        return
      }

      const json = (await res.json()) as { id: string }
      setSubmitStatus("polling")
      const { result, message } = await pollSubmission(json.id)
      setLastResult(result)
      setLastResultMsg(message ?? null)
      setSubmitStatus("done")

      if (result === "accepted") {
        // Deal damage to boss
        const dmg = 50 // base damage (level system TBD)
        const newBossHp = Math.max(0, bossHpRef.current - dmg)
        setBossHp(newBossHp)
        triggerFlash("green")

        if (newBossHp <= 0) {
          setPhase("victory")
          return
        }

        // Advance to next room
        const nextRoom = roomIndex + 1
        if (nextRoom < totalRooms) {
          setRoomIndex(nextRoom)
          setCode(initialCode)
          setSubmitStatus("idle")
        } else {
          // All rooms cleared — check if boss dead
          if (newBossHp > 0) {
            setPhase("defeat")
          }
        }
      } else {
        // Wrong/error — player takes damage
        const newHp = Math.max(0, playerHpRef.current - 10)
        setPlayerHp(newHp)
        triggerFlash("red")
        setShake(true)
        setTimeout(() => setShake(false), 500)
        if (newHp <= 0) setPhase("defeat")
        setTimeout(() => setSubmitStatus("idle"), 1500)
      }
    } catch {
      setSubmitStatus("done")
      setLastResult("runtime_error")
      setTimeout(() => setSubmitStatus("idle"), 1500)
    }
  }, [
    phase,
    submitStatus,
    roomIndex,
    rooms,
    code,
    apiUrl,
    pollSubmission,
    triggerFlash,
    totalRooms,
  ])

  const currentRoom = rooms[roomIndex]
  const isLoading = submitStatus === "submitting" || submitStatus === "polling"
  const bossArt = getBossArt(currentRoom?.roomType ?? "minion")

  const roomTypeLabel: Record<string, string> = {
    minion: "GRUNT",
    miniboss: "ELITE",
    boss: "BOSS",
  }

  if (phase === "victory") {
    return (
      <div
        style={{
          height: "100%",
          background: "#000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "monospace",
          flexDirection: "column",
          gap: "1.5rem",
        }}
      >
        <div
          style={{
            position: "relative",
            zIndex: 1,
            textAlign: "center",
            color: "#00ff41",
            textShadow: "0 0 30px #00ff41",
          }}
        >
          <div style={{ fontSize: "3rem", fontWeight: "bold", letterSpacing: "0.3em" }}>
            ▓ SYSTEM BREACHED ▓
          </div>
          <div style={{ fontSize: "1.2rem", color: "#00aa2a", marginTop: "1rem" }}>
            {dungeon.bossName} DEFEATED — ACCESS GRANTED
          </div>
          <div
            style={{ marginTop: "2rem", display: "flex", gap: "1rem", justifyContent: "center" }}
          >
            <a
              href="/dungeon"
              style={{
                color: "#00ff41",
                border: "1px solid #00ff41",
                padding: "0.75rem 2rem",
                textDecoration: "none",
                letterSpacing: "0.2em",
                fontSize: "0.9rem",
              }}
            >
              ← DUNGEON SELECT
            </a>
            <a
              href="/world"
              style={{
                color: "#000",
                background: "#00ff41",
                border: "1px solid #00ff41",
                padding: "0.75rem 2rem",
                textDecoration: "none",
                letterSpacing: "0.2em",
                fontSize: "0.9rem",
                fontWeight: "bold",
                textShadow: "none",
              }}
            >
              獲得ブロックをワールドで使う → /world
            </a>
          </div>
        </div>
      </div>
    )
  }

  if (phase === "defeat") {
    return (
      <div
        style={{
          height: "100%",
          background: "#000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "monospace",
          flexDirection: "column",
          gap: "1.5rem",
        }}
      >
        <div
          style={{
            textAlign: "center",
            color: "#ff3333",
            textShadow: "0 0 30px #ff3333",
          }}
        >
          <div style={{ fontSize: "3rem", fontWeight: "bold", letterSpacing: "0.3em" }}>
            ▓ CONNECTION LOST ▓
          </div>
          <div style={{ fontSize: "1.2rem", color: "#aa0000", marginTop: "1rem" }}>
            SYSTEM TRACE COMPLETE — XP PENALTY APPLIED
          </div>
          <div
            style={{ marginTop: "2rem", display: "flex", gap: "1rem", justifyContent: "center" }}
          >
            <a
              href="/dungeon"
              style={{
                color: "#ff3333",
                border: "1px solid #ff3333",
                padding: "0.75rem 2rem",
                textDecoration: "none",
                letterSpacing: "0.2em",
                fontSize: "0.9rem",
              }}
            >
              ← RETREAT
            </a>
            <a
              href={`/dungeon/${dungeon.id}`}
              style={{
                color: "#ff3333",
                border: "1px solid #ff3333",
                padding: "0.75rem 2rem",
                textDecoration: "none",
                letterSpacing: "0.2em",
                fontSize: "0.9rem",
              }}
            >
              ↺ RETRY
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        height: "100%",
        background: "#000",
        fontFamily: "monospace",
        color: "#00ff41",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
        animation: shake ? "shake 0.4s ease" : "none",
      }}
    >
      <style>{`
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          25% { transform: translateX(-8px); }
          75% { transform: translateX(8px); }
        }
        @keyframes glitch {
          0%,100% { text-shadow: 0 0 10px #ff3333; }
          33% { text-shadow: -2px 0 #ff0000, 2px 0 #ff6666; }
          66% { text-shadow: 2px 0 #ff0000, -2px 0 #ff6666; }
        }
        @keyframes greenFlash {
          0% { background: rgba(0,255,65,0.2); }
          100% { background: transparent; }
        }
        @keyframes redFlash {
          0% { background: rgba(255,0,0,0.25); }
          100% { background: transparent; }
        }
      `}</style>

      {/* Flash overlay */}
      {flashType && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            pointerEvents: "none",
            animation: `${flashType === "green" ? "greenFlash" : "redFlash"} 0.6s ease forwards`,
          }}
        />
      )}

      {/* Top HUD */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          borderBottom: "1px solid #003300",
          background: "rgba(0,0,0,0.9)",
          padding: "0.5rem 1rem",
          display: "flex",
          gap: "1.5rem",
          alignItems: "center",
        }}
      >
        <a
          href="/dungeon"
          style={{
            color: "#00aa2a",
            textDecoration: "none",
            fontSize: "0.75rem",
            letterSpacing: "0.15em",
            whiteSpace: "nowrap",
          }}
        >
          ← EXIT
        </a>
        <div style={{ fontSize: "0.8rem", letterSpacing: "0.2em", whiteSpace: "nowrap" }}>
          {dungeon.name}
        </div>
        <div
          style={{
            fontSize: "0.7rem",
            color: "#00aa2a",
            whiteSpace: "nowrap",
            border: "1px solid #003300",
            padding: "0 0.5rem",
          }}
        >
          ROOM {roomIndex + 1}/{totalRooms} [{roomTypeLabel[currentRoom?.roomType ?? "minion"]}]
        </div>

        <HpBar current={playerHp} max={playerMaxHp} color="#00ff41" label="PLAYER HP" />
        <HpBar
          current={bossHp}
          max={dungeon.bossHp}
          color="#ff3333"
          label={`${dungeon.bossName} HP`}
        />

        <div
          style={{
            whiteSpace: "nowrap",
            fontSize: "0.7rem",
            color: timerTick <= 2 ? "#ff3333" : "#00aa2a",
            border: `1px solid ${timerTick <= 2 ? "#ff3333" : "#003300"}`,
            padding: "0.25rem 0.5rem",
            animation: timerTick <= 2 ? "glitch 0.3s infinite" : "none",
          }}
        >
          ⚡ ATTACK IN {timerTick}s
        </div>
      </div>

      {/* Battle area */}
      <div
        style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative", zIndex: 10 }}
      >
        {/* Left: Boss display */}
        <div
          style={{
            width: "260px",
            minWidth: "260px",
            borderRight: "1px solid #003300",
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
            gap: "0.75rem",
          }}
        >
          <div
            style={{
              fontSize: "0.7rem",
              color: "#ff3333",
              letterSpacing: "0.2em",
              animation: "glitch 1s infinite",
            }}
          >
            ▶ HOSTILE AI DETECTED
          </div>
          <pre
            style={{
              fontFamily: "monospace",
              fontSize: "0.85rem",
              color:
                currentRoom?.roomType === "boss"
                  ? "#ff3333"
                  : currentRoom?.roomType === "miniboss"
                    ? "#ff9900"
                    : "#ff6666",
              lineHeight: 1.3,
              textAlign: "center",
              textShadow:
                currentRoom?.roomType === "boss"
                  ? "0 0 15px #ff3333, 0 0 30px #ff0000"
                  : "0 0 8px #ff6666",
              whiteSpace: "pre",
              margin: 0,
              padding: 0,
            }}
          >
            {bossArt.join("\n")}
          </pre>
          <div
            style={{
              fontSize: "0.9rem",
              fontWeight: "bold",
              letterSpacing: "0.15em",
              color: "#ff3333",
              textShadow: "0 0 10px #ff3333",
            }}
          >
            {dungeon.bossName}
          </div>
          <div
            style={{ fontSize: "0.7rem", color: "#aa0000", textAlign: "center", lineHeight: 1.4 }}
          >
            {currentRoom?.roomType === "boss"
              ? "⚠ BOSS FORM ACTIVATED"
              : currentRoom?.roomType === "miniboss"
                ? "⚠ ELITE GUARD"
                : "SYSTEM GUARDIAN"}
          </div>
        </div>

        {/* Right: Problem + Editor */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Problem description */}
          <div
            style={{
              borderBottom: "1px solid #003300",
              padding: "0.75rem 1rem",
              background: "rgba(0,5,0,0.9)",
              overflowY: "auto",
              maxHeight: "35%",
              fontSize: "0.8rem",
              lineHeight: 1.6,
              color: "#00cc33",
            }}
          >
            <div
              style={{
                fontSize: "0.65rem",
                color: "#00aa2a",
                letterSpacing: "0.2em",
                marginBottom: "0.5rem",
              }}
            >
              MISSION: {currentRoom?.problem.title}
            </div>
            <div style={{ whiteSpace: "pre-wrap" }}>
              {currentRoom?.problem.body.description.replace(/##[^#\n]*/g, "").trim()}
            </div>
            {currentRoom?.problem.body.hints && currentRoom.problem.body.hints.length > 0 && (
              <details style={{ marginTop: "0.5rem" }}>
                <summary
                  style={{
                    cursor: "pointer",
                    color: "#00aa2a",
                    fontSize: "0.7rem",
                    letterSpacing: "0.15em",
                  }}
                >
                  ▶ DECRYPT HINT
                </summary>
                <div style={{ paddingTop: "0.5rem", color: "#007700" }}>
                  {currentRoom.problem.body.hints[0]?.text}
                </div>
              </details>
            )}
          </div>

          {/* Monaco Editor */}
          <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
            <MonacoEditor
              height="100%"
              language={dungeon.language === "csharp" ? "csharp" : dungeon.language}
              theme="vs-dark"
              value={code}
              onChange={(v) => setCode(v ?? "")}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                automaticLayout: true,
                fontFamily: "monospace",
              }}
            />
          </div>

          {/* Submit bar */}
          <div
            style={{
              borderTop: "1px solid #003300",
              background: "rgba(0,0,0,0.95)",
              padding: "0.5rem 1rem",
              display: "flex",
              gap: "1rem",
              alignItems: "center",
            }}
          >
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isLoading || phase !== "fighting"}
              style={{
                background: isLoading ? "#001100" : "#003300",
                color: "#00ff41",
                border: "1px solid #00ff41",
                padding: "0.5rem 1.5rem",
                fontFamily: "monospace",
                fontSize: "0.85rem",
                letterSpacing: "0.2em",
                cursor: isLoading ? "not-allowed" : "pointer",
                opacity: isLoading ? 0.6 : 1,
                textShadow: isLoading ? "none" : "0 0 8px #00ff41",
              }}
            >
              {isLoading ? "⟳ EXECUTING..." : "▶ EXECUTE PAYLOAD"}
            </button>

            {lastResult === "accepted" && (
              <span
                style={{ color: "#00ff41", fontSize: "0.8rem", textShadow: "0 0 10px #00ff41" }}
              >
                ✓ HIT! BOSS DAMAGED
              </span>
            )}
            {lastResult === "wrong_answer" && (
              <span style={{ color: "#ff3333", fontSize: "0.8rem" }}>✗ WRONG — TAKING DAMAGE</span>
            )}
            {(lastResult === "runtime_error" || lastResult === "time_limit_exceeded") && (
              <span style={{ color: "#ff9900", fontSize: "0.8rem" }}>
                ⚠ ERROR — {lastResultMsg ? lastResultMsg.slice(0, 80) : "SYSTEM COUNTERMEASURE"}
              </span>
            )}

            <div style={{ marginLeft: "auto", fontSize: "0.7rem", color: "#005500" }}>
              DMG/HIT: 50 | BOSS HP: {bossHp}/{dungeon.bossHp}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
