"use client"

import dynamic from "next/dynamic"
import { useCallback, useEffect, useRef, useState } from "react"

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false })

const API_URL_DEFAULT = "http://localhost:3001"

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
  if (roomType === "boss") return BOSS_ASCII.boss ?? []
  if (roomType === "miniboss") return BOSS_ASCII.miniboss ?? []
  return BOSS_ASCII.default ?? []
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

interface CoopState {
  runId: string | null
  inviteToken: string | null
  coPlayerHp: number | null
  coPlayerMaxHp: number
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
  const [isMobile, setIsMobile] = useState(false)
  const [coop, setCoop] = useState<CoopState>({
    runId: null,
    inviteToken: null,
    coPlayerHp: null,
    coPlayerMaxHp: 200,
  })
  const [inviteCopied, setInviteCopied] = useState(false)
  const coopWsRef = useRef<WebSocket | null>(null)
  const playerHpRef = useRef(playerHp)
  const bossHpRef = useRef(bossHp)
  const phaseRef = useRef(phase)
  const runIdRef = useRef<string | null>(null)

  const playerMaxHp = 200
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? API_URL_DEFAULT

  useEffect(() => {
    setIsMobile(navigator.maxTouchPoints > 0)
  }, [])

  useEffect(() => {
    playerHpRef.current = playerHp
  }, [playerHp])
  useEffect(() => {
    bossHpRef.current = bossHp
  }, [bossHp])
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  // Start a dungeon run to get runId for co-op
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    async function startRun() {
      try {
        const res = await fetch(`${apiUrl}/api/dungeons/runs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ dungeonId: dungeon.id }),
        })
        if (res.ok) {
          const json = (await res.json()) as {
            data: { id: string; coPlayerId?: string; coPlayerHp?: number }
          }
          runIdRef.current = json.data.id
          setCoop((prev) => ({
            ...prev,
            runId: json.data.id,
            coPlayerHp: json.data.coPlayerHp ?? null,
          }))
        }
      } catch {
        // ignore — co-op just won't work
      }
    }
    startRun()
  }, [])

  // Co-op WebSocket connection
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run when runId changes
  useEffect(() => {
    if (!coop.runId) return

    const WS_URL = apiUrl.replace(/^http/, "ws")
    const ws = new WebSocket(`${WS_URL}/ws`)
    coopWsRef.current = ws

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "dungeon_join",
          runId: coop.runId,
          userId: "local",
          bossHp: dungeon.bossHp,
          playerHp: playerMaxHp,
        }),
      )
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          type: string
          bossHp?: number
          players?: { socketId: string; hp: number }[]
          status?: string
        }
        if (msg.type === "dungeon_state") {
          if (msg.bossHp !== undefined) setBossHp(msg.bossHp)
          if (msg.players && msg.players.length >= 2) {
            const hps = msg.players.map((p) => p.hp)
            setCoop((prev) => ({ ...prev, coPlayerHp: hps[1] ?? null }))
          }
          if (msg.status === "victory") setPhase("victory")
          if (msg.status === "defeat") setPhase("defeat")
        }
      } catch {
        // ignore
      }
    }

    ws.onclose = () => {
      coopWsRef.current = null
    }

    return () => {
      ws.close()
      coopWsRef.current = null
    }
  }, [coop.runId])

  const generateInvite = useCallback(async () => {
    if (!coop.runId) return
    try {
      const res = await fetch(`${apiUrl}/api/dungeons/runs/${coop.runId}/invite`, {
        credentials: "include",
      })
      if (res.ok) {
        const json = (await res.json()) as { data: { token: string } }
        const url = `${window.location.origin}/dungeon/join/${json.data.token}`
        setCoop((prev) => ({ ...prev, inviteToken: url }))
        await navigator.clipboard.writeText(url)
        setInviteCopied(true)
        setTimeout(() => setInviteCopied(false), 3000)
      }
    } catch {
      // ignore
    }
  }, [apiUrl, coop.runId])

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
      if (retries >= maxRetries)
        return { result: "runtime_error", message: "Execution timed out (executor may be down)" }
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
      try {
        const res = await fetch(`${apiUrl}/api/submissions/${submissionId}`, {
          credentials: "include",
        })
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
    [apiUrl, pollInterval],
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
        const dmg = 50
        const newBossHp = Math.max(0, bossHpRef.current - dmg)
        setBossHp(newBossHp)
        triggerFlash("green")
        // Broadcast hit to co-op partner
        coopWsRef.current?.send(JSON.stringify({ type: "dungeon_hit", dmg }))

        if (newBossHp <= 0) {
          setPhase("victory")
          // Unlock FPS weapons progressively by dungeon difficulty
          try {
            const current = JSON.parse(
              localStorage.getItem("fps_unlocked_weapons") ?? '["pistol"]',
            ) as string[]
            const unlocked = new Set(current)
            unlocked.add("pistol")
            if (rooms.some((r) => r.roomType === "miniboss" || r.roomType === "boss")) {
              unlocked.add("shotgun")
            }
            if (rooms.some((r) => r.roomType === "boss")) {
              unlocked.add("sniper")
            }
            localStorage.setItem("fps_unlocked_weapons", JSON.stringify([...unlocked]))
          } catch {
            /* ignore */
          }
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
        const newHp = Math.max(0, playerHpRef.current - 10)
        setPlayerHp(newHp)
        triggerFlash("red")
        setShake(true)
        setTimeout(() => setShake(false), 500)
        if (newHp <= 0) setPhase("defeat")
        // Broadcast damage to co-op partner
        coopWsRef.current?.send(JSON.stringify({ type: "dungeon_damage", dmg: 10 }))
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
    dungeon.language,
    initialCode,
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
          padding: isMobile ? "0.35rem 0.5rem" : "0.5rem 1rem",
          display: "flex",
          gap: isMobile ? "0.5rem" : "1.5rem",
          alignItems: "center",
          overflowX: "auto",
          flexWrap: "nowrap",
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
        {coop.coPlayerHp !== null && (
          <HpBar
            current={coop.coPlayerHp}
            max={coop.coPlayerMaxHp}
            color="#00aaff"
            label="CO-OP HP"
          />
        )}
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
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
          position: "relative",
          zIndex: 10,
          flexDirection: isMobile ? "column" : "row",
        }}
      >
        {/* Boss display: left column on desktop, compact strip on mobile */}
        <div
          style={
            isMobile
              ? {
                  flexShrink: 0,
                  height: "130px",
                  borderBottom: "1px solid #003300",
                  background: "rgba(0,0,0,0.85)",
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0.5rem 1rem",
                  gap: "0.75rem",
                  overflow: "hidden",
                }
              : {
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
                }
          }
        >
          {!isMobile && (
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
          )}
          <pre
            style={{
              fontFamily: "monospace",
              fontSize: isMobile ? "0.5rem" : "0.85rem",
              color:
                currentRoom?.roomType === "boss"
                  ? "#ff3333"
                  : currentRoom?.roomType === "miniboss"
                    ? "#ff9900"
                    : "#ff6666",
              lineHeight: isMobile ? 1.2 : 1.3,
              textAlign: "center",
              textShadow:
                currentRoom?.roomType === "boss"
                  ? "0 0 15px #ff3333, 0 0 30px #ff0000"
                  : "0 0 8px #ff6666",
              whiteSpace: "pre",
              margin: 0,
              padding: 0,
              flexShrink: 0,
            }}
          >
            {bossArt.join("\n")}
          </pre>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.3rem",
              alignItems: isMobile ? "flex-start" : "center",
            }}
          >
            <div
              style={{
                fontSize: isMobile ? "0.8rem" : "0.9rem",
                fontWeight: "bold",
                letterSpacing: "0.15em",
                color: "#ff3333",
                textShadow: "0 0 10px #ff3333",
              }}
            >
              {dungeon.bossName}
            </div>
            <div
              style={{
                fontSize: "0.65rem",
                color: "#aa0000",
                textAlign: isMobile ? "left" : "center",
                lineHeight: 1.4,
              }}
            >
              {currentRoom?.roomType === "boss"
                ? "⚠ BOSS FORM"
                : currentRoom?.roomType === "miniboss"
                  ? "⚠ ELITE GUARD"
                  : "SYSTEM GUARDIAN"}
            </div>
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

          {/* Editor: textarea on mobile, Monaco on desktop */}
          <div style={{ flex: 1, overflow: "hidden", position: "relative", minHeight: "200px" }}>
            {isMobile ? (
              <textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                style={{
                  width: "100%",
                  height: "100%",
                  minHeight: "200px",
                  background: "#001100",
                  color: "#00ff41",
                  fontFamily: "monospace",
                  fontSize: "16px",
                  lineHeight: 1.5,
                  padding: "0.75rem",
                  border: "none",
                  outline: "none",
                  resize: "none",
                  boxSizing: "border-box",
                }}
              />
            ) : (
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
            )}
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
                padding: isMobile ? "0.75rem 2rem" : "0.5rem 1.5rem",
                fontFamily: "monospace",
                fontSize: isMobile ? "1rem" : "0.85rem",
                letterSpacing: "0.2em",
                cursor: isLoading ? "not-allowed" : "pointer",
                opacity: isLoading ? 0.6 : 1,
                textShadow: isLoading ? "none" : "0 0 8px #00ff41",
                flexShrink: 0,
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

            <div
              style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.75rem" }}
            >
              {coop.coPlayerHp === null && coop.runId && (
                <button
                  type="button"
                  onClick={generateInvite}
                  style={{
                    background: "transparent",
                    color: "#00aaff",
                    border: "1px solid #00aaff",
                    padding: "0.25rem 0.75rem",
                    fontFamily: "monospace",
                    fontSize: "0.7rem",
                    letterSpacing: "0.1em",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {inviteCopied ? "✓ COPIED" : "⚡ 協力招待"}
                </button>
              )}
              <span style={{ fontSize: "0.7rem", color: "#005500" }}>
                DMG/HIT: 50 | BOSS HP: {bossHp}/{dungeon.bossHp}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
