import { Sentry, initSentry } from "./lib/sentry"
initSentry()

import { Hono } from "hono"
import { createBunWebSocket } from "hono/bun"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { prettyJSON } from "hono/pretty-json"
import { authRouter } from "./routes/auth"
import { healthRouter } from "./routes/health"
import { leaderboardRouter } from "./routes/leaderboard"
import { profileRouter } from "./routes/profile"

// ── Rate limiting ─────────────────────────────────────────────────────────────
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")
  if (fwd) return fwd.split(",")[0]?.trim() ?? "unknown"
  return "unknown"
}

// ── WebSocket room state ──────────────────────────────────────────────────────
type Team = "red" | "blue" | "ffa"
type Mode = "wave_defense" | "ffa" | "tdm"
type MapId = "urban" | "desert" | "snow"

interface PlayerState {
  username: string
  x: number
  y: number
  team: Team
  hp: number
  alive: boolean
  kills: number
  deaths: number
  countryCode?: string | null
}

interface RoomState {
  mode: Mode
  mapId: MapId
  players: Map<string, PlayerState>
  matchStartedAt: number | null
  votes: Map<string, string>
  teamScore: { red: number; blue: number }
}

const MODES: readonly Mode[] = ["wave_defense", "ffa", "tdm"]
const MAPS: readonly MapId[] = ["urban", "desert", "snow"]

const socketMeta = new Map<string, { roomId: string | null; ws: { send(d: string): void } }>()
const rooms = new Map<string, RoomState>()

function ensureRoom(roomId: string, mode: Mode, mapId: MapId): RoomState {
  let r = rooms.get(roomId)
  if (!r) {
    r = {
      mode,
      mapId,
      players: new Map(),
      matchStartedAt: null,
      votes: new Map(),
      teamScore: { red: 0, blue: 0 },
    }
    rooms.set(roomId, r)
  }
  return r
}

function pickTeam(room: RoomState): Team {
  if (room.mode !== "tdm") return "ffa"
  let red = 0
  let blue = 0
  for (const p of room.players.values()) {
    if (p.team === "red") red++
    else if (p.team === "blue") blue++
  }
  return red <= blue ? "red" : "blue"
}

function broadcastRoom(roomId: string) {
  const room = rooms.get(roomId)
  if (!room) return
  for (const [sid, meta] of socketMeta) {
    if (meta.roomId !== roomId) continue
    const others: Record<string, PlayerState> = {}
    for (const [otherId, state] of room.players) {
      if (otherId !== sid) others[otherId] = state
    }
    try {
      meta.ws.send(
        JSON.stringify({
          type: "sync",
          players: others,
          mode: room.mode,
          mapId: room.mapId,
          teamScore: room.teamScore,
        }),
      )
    } catch {
      /* ignore */
    }
  }
}

function broadcastToRoom(roomId: string, pkt: object, exceptSid?: string) {
  const json = JSON.stringify(pkt)
  for (const [sid, m] of socketMeta) {
    if (m.roomId !== roomId) continue
    if (exceptSid && sid === exceptSid) continue
    try {
      m.ws.send(json)
    } catch {
      /* ignore */
    }
  }
}

function sendToSocket(socketId: string, pkt: object) {
  const m = socketMeta.get(socketId)
  if (!m) return
  try {
    m.ws.send(JSON.stringify(pkt))
  } catch {
    /* ignore */
  }
}

const { upgradeWebSocket, websocket } = createBunWebSocket()

// ── App ───────────────────────────────────────────────────────────────────────
const app = new Hono()

app.use(logger())
app.use(prettyJSON())
app.use(
  cors({
    origin: [
      "https://code-worldweb-production.up.railway.app",
      // biome-ignore lint/complexity/useLiteralKeys: bracket notation required per CLAUDE.md
      process.env["NEXT_PUBLIC_WEB_URL"] ?? "http://localhost:3000",
      // biome-ignore lint/complexity/useLiteralKeys: bracket notation required per CLAUDE.md
      process.env["WEB_URL"] ?? "http://localhost:3000",
    ],
    credentials: true,
  }),
)

app.use("*", async (c, next) => {
  if (c.req.path.startsWith("/api/health") || c.req.path === "/ws") {
    return next()
  }
  const ip = getClientIp(c.req.raw)
  const now = Date.now()
  const entry = rateLimitStore.get(ip)
  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + 60_000 })
  } else {
    entry.count++
    if (entry.count > 200) {
      return c.json({ error: "Too many requests" }, 429)
    }
  }
  return next()
})

// ── WebSocket ────────────────────────────────────────────────────────────────
app.get(
  "/ws",
  upgradeWebSocket(() => {
    const socketId = crypto.randomUUID()

    return {
      onOpen(_event, ws) {
        socketMeta.set(socketId, { roomId: null, ws })
      },

      onMessage(event) {
        const meta = socketMeta.get(socketId)
        if (!meta) return

        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(String(event.data)) as Record<string, unknown>
        } catch {
          return
        }

        const t = msg.type

        if (t === "join") {
          const roomId = String(msg.roomId ?? msg.worldId ?? "global")
          const username = String(msg.username ?? "Player")
          const x = Number(msg.x ?? 0)
          const y = Number(msg.y ?? 0)
          const modeRaw = msg.mode
          const mapIdRaw = msg.mapId
          const mode: Mode = MODES.includes(modeRaw as Mode) ? (modeRaw as Mode) : "ffa"
          const mapId: MapId = MAPS.includes(mapIdRaw as MapId) ? (mapIdRaw as MapId) : "urban"
          const countryCode = typeof msg.countryCode === "string" ? msg.countryCode : null

          meta.roomId = roomId
          const room = ensureRoom(roomId, mode, mapId)
          const team = pickTeam(room)
          room.players.set(socketId, {
            username,
            x,
            y,
            team,
            hp: 100,
            alive: true,
            kills: 0,
            deaths: 0,
            countryCode,
          })

          sendToSocket(socketId, {
            type: "joined",
            team,
            socketId,
            mode: room.mode,
            mapId: room.mapId,
            teamScore: room.teamScore,
          })

          broadcastRoom(roomId)
          broadcastToRoom(
            roomId,
            { type: "chat", from: "SYSTEM", text: `${username} が入場しました` },
            socketId,
          )
        } else if (t === "move") {
          const { roomId } = meta
          if (!roomId) return
          const room = rooms.get(roomId)
          const state = room?.players.get(socketId)
          if (!state) return
          state.x = Number(msg.x ?? state.x)
          state.y = Number(msg.y ?? state.y)
          broadcastRoom(roomId)
        } else if (t === "chat") {
          const { roomId } = meta
          if (!roomId) return
          const text = String(msg.text ?? "")
            .slice(0, 200)
            .trim()
          if (!text) return
          const from = String(msg.from ?? "Player")
          broadcastToRoom(roomId, { type: "chat", from, text })
        } else if (t === "pvp_hit") {
          const { roomId } = meta
          if (!roomId) return
          const room = rooms.get(roomId)
          if (!room) return
          const targetId = String(msg.targetId ?? "")
          const dmg = Math.max(0, Math.min(200, Number(msg.dmg ?? 0)))
          const headshot = !!msg.headshot
          const weapon = String(msg.weapon ?? "pistol")
          const attacker = room.players.get(socketId)
          const target = room.players.get(targetId)
          if (!attacker || !target || !target.alive) return
          if (room.mode === "tdm" && attacker.team === target.team && attacker.team !== "ffa")
            return

          target.hp = Math.max(0, target.hp - dmg)

          sendToSocket(targetId, {
            type: "pvp_damage",
            from: attacker.username,
            dmg,
            headshot,
            hp: target.hp,
          })

          if (target.hp === 0) {
            target.alive = false
            target.deaths++
            attacker.kills++
            if (attacker.team === "red" || attacker.team === "blue") {
              room.teamScore[attacker.team]++
            }
            broadcastToRoom(roomId, {
              type: "pvp_kill",
              killer: attacker.username,
              victim: target.username,
              weapon,
              headshot,
              killerTeam: attacker.team,
              victimTeam: target.team,
              teamScore: room.teamScore,
            })
            setTimeout(() => {
              const r = rooms.get(roomId)
              const p = r?.players.get(targetId)
              if (!p) return
              p.hp = 100
              p.alive = true
              sendToSocket(targetId, { type: "pvp_respawn", hp: 100, invulnMs: 3000 })
            }, 2500)
          }
        } else if (t === "vote_map") {
          const { roomId } = meta
          if (!roomId) return
          const room = rooms.get(roomId)
          if (!room) return
          const mapId = String(msg.mapId ?? "")
          if (!MAPS.includes(mapId as MapId)) return
          room.votes.set(socketId, mapId)
          const tally: Record<string, number> = {}
          for (const m2 of room.votes.values()) tally[m2] = (tally[m2] ?? 0) + 1
          broadcastToRoom(roomId, { type: "vote_tally", tally })
        }
      },

      onClose() {
        const meta = socketMeta.get(socketId)
        socketMeta.delete(socketId)
        if (!meta?.roomId) return
        const roomId = meta.roomId
        const room = rooms.get(roomId)
        const leavingUsername = room?.players.get(socketId)?.username ?? "Player"
        room?.players.delete(socketId)
        room?.votes.delete(socketId)
        if (room && room.players.size === 0) rooms.delete(roomId)

        broadcastToRoom(roomId, {
          type: "chat",
          from: "SYSTEM",
          text: `${leavingUsername} が退場しました`,
        })
        broadcastRoom(roomId)
      },
    }
  }),
)

// ── Routes ────────────────────────────────────────────────────────────────────
app.route("/api/health", healthRouter)
app.route("/api/auth", authRouter)
app.route("/api/leaderboard", leaderboardRouter)
app.route("/api/profile", profileRouter)

// ── Error handling ────────────────────────────────────────────────────────────
app.onError((err, c) => {
  console.error("[API Error]", err)
  Sentry.captureException(err)
  return c.json({ error: "Internal server error" }, 500)
})

app.notFound((c) => c.json({ error: "Not found" }, 404))

// biome-ignore lint/complexity/useLiteralKeys: bracket notation required per CLAUDE.md
const port = Number(process.env["API_PORT"] ?? 3001)
console.log(`🚀 API server running at http://localhost:${port}`)

export default {
  port,
  fetch(req: Request, server: unknown) {
    return app.fetch(req, { server })
  },
  websocket,
}
