import { Sentry, initSentry } from "./lib/sentry"
initSentry()

import { Hono } from "hono"
import { createBunWebSocket } from "hono/bun"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { prettyJSON } from "hono/pretty-json"
import { auth } from "./lib/auth"
import { dungeonsRouter } from "./routes/dungeons"
import { friendsRouter } from "./routes/friends"
import { healthRouter } from "./routes/health"
import { inventoryRouter } from "./routes/inventory"
import { leaderboardRouter } from "./routes/leaderboard"
import { problemsRouter } from "./routes/problems"
import { profileRouter } from "./routes/profile"
import { submissionsRouter } from "./routes/submissions"
import { worldsRouter } from "./routes/worlds"

// ── Rate limiting ─────────────────────────────────────────────────────────────
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")
  if (fwd) return fwd.split(",")[0]!.trim()
  return "unknown"
}

// ── Isometric tile math (mirrors PhaserGame constants) ────────────────────────
const TILE_W = 64
const TILE_H = 32
const MAP_SIZE = 32
const ORIGIN_X = MAP_SIZE * (TILE_W / 2)
const ORIGIN_Y = 140

function toTile(x: number, y: number): { tx: number; ty: number } {
  const relX = x - ORIGIN_X
  const relY = y - ORIGIN_Y
  const tx = Math.round((relX / (TILE_W / 2) + relY / (TILE_H / 2)) / 2)
  const ty = Math.round((relY / (TILE_H / 2) - relX / (TILE_W / 2)) / 2)
  return {
    tx: Math.max(0, Math.min(MAP_SIZE - 1, tx)),
    ty: Math.max(0, Math.min(MAP_SIZE - 1, ty)),
  }
}

// ── Dungeon co-op WS state ────────────────────────────────────────────────────
interface DungeonCoopRoom {
  runId: string
  sockets: Map<string, { userId: string; hp: number }> // socketId → player state
  bossHp: number
  status: "fighting" | "victory" | "defeat"
}
const dungeonCoopRooms = new Map<string, DungeonCoopRoom>() // runId → room
const socketDungeonRoom = new Map<string, string>() // socketId → runId

function broadcastDungeonRoom(runId: string) {
  const room = dungeonCoopRooms.get(runId)
  if (!room) return
  const players = [...room.sockets.entries()].map(([sid, p]) => ({ socketId: sid, hp: p.hp }))
  const packet = JSON.stringify({
    type: "dungeon_state",
    bossHp: room.bossHp,
    players,
    status: room.status,
  })
  for (const [sid] of room.sockets) {
    const meta = socketMeta.get(sid)
    if (!meta) continue
    try {
      meta.ws.send(packet)
    } catch {
      // ignore
    }
  }
}

// ── WebSocket room state ───────────────────────────────────────────────────────
interface PlayerState {
  username: string
  x: number
  y: number
}

// ── Tag-game state ─────────────────────────────────────────────────────────────
interface TagGameState {
  itSocketId: string
  currentItStart: number
  endsAt: number
  itTotals: Map<string, number> // socketId → accumulated ms as "it"
  lastTagAt: number
  timer: ReturnType<typeof setTimeout> | null
}

const socketMeta = new Map<string, { worldId: string | null; ws: { send(d: string): void } }>()
const worldRooms = new Map<string, Map<string, PlayerState>>()
const tagGames = new Map<string, TagGameState>()

// ── Broadcast helpers ─────────────────────────────────────────────────────────
function broadcastRoom(worldId: string) {
  const room = worldRooms.get(worldId)
  if (!room) return
  for (const [sid, meta] of socketMeta) {
    if (meta.worldId !== worldId) continue
    const others: Record<string, PlayerState> = {}
    for (const [otherId, state] of room) {
      if (otherId !== sid) others[otherId] = state
    }
    try {
      meta.ws.send(JSON.stringify({ type: "sync", players: others }))
    } catch {
      // ignore closed socket errors
    }
  }
}

function broadcastTagState(worldId: string) {
  const game = tagGames.get(worldId)
  const room = worldRooms.get(worldId)
  if (!game || !room) return

  const now = Date.now()
  const itState = room.get(game.itSocketId)
  const itUsername = itState?.username ?? "?"
  const remainingMs = Math.max(0, game.endsAt - now)

  const scores: { username: string; itMs: number }[] = []
  for (const [sid, ms] of game.itTotals) {
    const state = room.get(sid)
    if (!state) continue
    const extra = sid === game.itSocketId ? now - game.currentItStart : 0
    scores.push({ username: state.username, itMs: ms + extra })
  }

  const packet = JSON.stringify({
    type: "tag_state",
    running: true,
    itUsername,
    remainingMs,
    scores,
  })
  for (const [, m] of socketMeta) {
    if (m.worldId !== worldId) continue
    try {
      m.ws.send(packet)
    } catch {
      // ignore
    }
  }
}

function endTagGame(worldId: string) {
  const game = tagGames.get(worldId)
  if (!game) return

  if (game.timer) clearTimeout(game.timer)
  tagGames.delete(worldId)

  const room = worldRooms.get(worldId)
  const now = Date.now()

  // Finalise current "it" time
  const extra = now - game.currentItStart
  game.itTotals.set(game.itSocketId, (game.itTotals.get(game.itSocketId) ?? 0) + extra)

  // Sorted scores: least time as "it" = winner
  const scores: { username: string; itMs: number }[] = []
  if (room) {
    for (const [sid, ms] of game.itTotals) {
      const state = room.get(sid)
      scores.push({ username: state?.username ?? "?", itMs: ms })
    }
  }
  scores.sort((a, b) => a.itMs - b.itMs)
  const winner = scores[0]?.username ?? "?"

  const packet = JSON.stringify({ type: "tag_end", running: false, winner, scores })
  for (const [, m] of socketMeta) {
    if (m.worldId !== worldId) continue
    try {
      m.ws.send(packet)
    } catch {
      // ignore
    }
  }
}

function doTag(worldId: string, game: TagGameState, newItSocketId: string, now: number) {
  const elapsed = now - game.currentItStart
  game.itTotals.set(game.itSocketId, (game.itTotals.get(game.itSocketId) ?? 0) + elapsed)
  game.lastTagAt = now
  game.itSocketId = newItSocketId
  game.currentItStart = now
  broadcastTagState(worldId)
}

function checkTag(worldId: string, movedSocketId: string) {
  const game = tagGames.get(worldId)
  if (!game) return

  const room = worldRooms.get(worldId)
  if (!room) return

  const now = Date.now()
  if (now - game.lastTagAt < 2000) return // 2 s grace period after tag

  const itState = room.get(game.itSocketId)
  if (!itState) return
  const itTile = toTile(itState.x, itState.y)

  if (movedSocketId === game.itSocketId) {
    // "it" moved — check every other player
    for (const [sid, state] of room) {
      if (sid === game.itSocketId) continue
      const t = toTile(state.x, state.y)
      if (t.tx === itTile.tx && t.ty === itTile.ty) {
        doTag(worldId, game, sid, now)
        break
      }
    }
  } else {
    // Non-"it" moved — check against "it" only
    const movedState = room.get(movedSocketId)
    if (!movedState) return
    const t = toTile(movedState.x, movedState.y)
    if (t.tx === itTile.tx && t.ty === itTile.ty) {
      doTag(worldId, game, movedSocketId, now)
    }
  }
}

const { upgradeWebSocket, websocket } = createBunWebSocket()

// ── App ───────────────────────────────────────────────────────────────────────
const app = new Hono()

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(logger())
app.use(prettyJSON())
app.use(
  cors({
    origin: [
      "https://code-worldweb-production.up.railway.app",
      process.env["NEXT_PUBLIC_WEB_URL"] ?? "http://localhost:3000",
      process.env["WEB_URL"] ?? "http://localhost:3000",
    ],
    credentials: true,
  }),
)

// ── Rate limiting middleware ──────────────────────────────────────────────────
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
    if (entry.count > 100) {
      return c.json({ error: "Too many requests" }, 429)
    }
  }
  return next()
})

// ── WebSocket — position sync + tag game ──────────────────────────────────────
app.get(
  "/ws",
  upgradeWebSocket(() => {
    const socketId = crypto.randomUUID()

    return {
      onOpen(_event, ws) {
        socketMeta.set(socketId, { worldId: null, ws })
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

        if (msg["type"] === "join") {
          const worldId = String(msg["worldId"] ?? "")
          const username = String(msg["username"] ?? "Player")
          const x = Number(msg["x"] ?? 0)
          const y = Number(msg["y"] ?? 0)

          meta.worldId = worldId
          if (!worldRooms.has(worldId)) worldRooms.set(worldId, new Map())
          worldRooms.get(worldId)!.set(socketId, { username, x, y })
          broadcastRoom(worldId)

          // Notify existing players of new arrival
          const joinPkt = JSON.stringify({
            type: "chat",
            from: "SYSTEM",
            text: `${username} が入場しました`,
          })
          for (const [sid, m] of socketMeta) {
            if (m.worldId !== worldId || sid === socketId) continue
            try {
              m.ws.send(joinPkt)
            } catch {
              /* ignore */
            }
          }

          // Sync active tag game to newly joined player
          const tagGame = tagGames.get(worldId)
          if (tagGame) {
            if (!tagGame.itTotals.has(socketId)) tagGame.itTotals.set(socketId, 0)
            broadcastTagState(worldId)
          }
        } else if (msg["type"] === "move") {
          const { worldId } = meta
          if (!worldId) return
          const room = worldRooms.get(worldId)
          const state = room?.get(socketId)
          if (!state) return
          state.x = Number(msg["x"] ?? state.x)
          state.y = Number(msg["y"] ?? state.y)
          broadcastRoom(worldId)
          checkTag(worldId, socketId)
        } else if (msg["type"] === "chat") {
          const { worldId } = meta
          if (!worldId) return
          const text = String(msg["text"] ?? "")
            .slice(0, 200)
            .trim()
          if (!text) return
          const from = String(msg["from"] ?? "Player")
          const packet = JSON.stringify({ type: "chat", from, text })
          for (const [, m] of socketMeta) {
            if (m.worldId !== worldId) continue
            try {
              m.ws.send(packet)
            } catch {
              // ignore closed socket
            }
          }
        } else if (msg["type"] === "tag_start") {
          const { worldId } = meta
          if (!worldId) return
          if (tagGames.has(worldId)) return // already running

          const room = worldRooms.get(worldId)
          if (!room) return

          const GAME_MS = 3 * 60 * 1000
          const now = Date.now()

          const totals = new Map<string, number>()
          for (const [sid] of room) totals.set(sid, 0)

          const timer = setTimeout(() => endTagGame(worldId), GAME_MS)
          tagGames.set(worldId, {
            itSocketId: socketId,
            currentItStart: now,
            endsAt: now + GAME_MS,
            itTotals: totals,
            lastTagAt: 0,
            timer,
          })

          broadcastTagState(worldId)
        } else if (msg["type"] === "dungeon_join") {
          const runId = String(msg["runId"] ?? "")
          const userId = String(msg["userId"] ?? "")
          const initialBossHp = Number(msg["bossHp"] ?? 250)
          const initialPlayerHp = Number(msg["playerHp"] ?? 200)
          if (!runId) return

          socketDungeonRoom.set(socketId, runId)
          if (!dungeonCoopRooms.has(runId)) {
            dungeonCoopRooms.set(runId, {
              runId,
              sockets: new Map(),
              bossHp: initialBossHp,
              status: "fighting",
            })
          }
          const dungeonRoom = dungeonCoopRooms.get(runId)!
          dungeonRoom.sockets.set(socketId, { userId, hp: initialPlayerHp })
          broadcastDungeonRoom(runId)
        } else if (msg["type"] === "dungeon_hit") {
          const runId = socketDungeonRoom.get(socketId)
          if (!runId) return
          const dungeonRoom = dungeonCoopRooms.get(runId)
          if (!dungeonRoom || dungeonRoom.status !== "fighting") return
          const dmg = Number(msg["dmg"] ?? 50)
          dungeonRoom.bossHp = Math.max(0, dungeonRoom.bossHp - dmg)
          if (dungeonRoom.bossHp <= 0) dungeonRoom.status = "victory"
          broadcastDungeonRoom(runId)
        } else if (msg["type"] === "dungeon_damage") {
          const runId = socketDungeonRoom.get(socketId)
          if (!runId) return
          const dungeonRoom = dungeonCoopRooms.get(runId)
          if (!dungeonRoom || dungeonRoom.status !== "fighting") return
          const dmg = Number(msg["dmg"] ?? 10)
          // Deal damage to ALL players in room
          for (const [sid, player] of dungeonRoom.sockets) {
            player.hp = Math.max(0, player.hp - dmg)
            dungeonRoom.sockets.set(sid, player)
          }
          const allDead = [...dungeonRoom.sockets.values()].every((p) => p.hp <= 0)
          if (allDead) dungeonRoom.status = "defeat"
          broadcastDungeonRoom(runId)
        }
      },

      onClose() {
        const meta = socketMeta.get(socketId)
        socketMeta.delete(socketId)

        if (!meta?.worldId) return
        const worldId = meta.worldId
        const room = worldRooms.get(worldId)

        // Notify remaining players of departure (socketMeta already deleted above)
        const leavingUsername = room?.get(socketId)?.username ?? "Player"
        const leavePkt = JSON.stringify({
          type: "chat",
          from: "SYSTEM",
          text: `${leavingUsername} が退場しました`,
        })
        for (const [, m] of socketMeta) {
          if (m.worldId !== worldId) continue
          try {
            m.ws.send(leavePkt)
          } catch {
            /* ignore */
          }
        }

        // Handle tag game cleanup when a player disconnects
        const tagGame = tagGames.get(worldId)
        if (tagGame) {
          if (tagGame.itSocketId === socketId) {
            // Transfer "it" to another player
            const now = Date.now()
            const elapsed = now - tagGame.currentItStart
            tagGame.itTotals.set(socketId, (tagGame.itTotals.get(socketId) ?? 0) + elapsed)
            tagGame.itTotals.delete(socketId)

            const candidates = room ? [...room.keys()].filter((s) => s !== socketId) : []
            if (candidates.length > 0) {
              const nextSid = candidates[0]!
              if (!tagGame.itTotals.has(nextSid)) tagGame.itTotals.set(nextSid, 0)
              tagGame.itSocketId = nextSid
              tagGame.currentItStart = now
            } else {
              if (tagGame.timer) clearTimeout(tagGame.timer)
              tagGames.delete(worldId)
            }
          } else {
            tagGame.itTotals.delete(socketId)
          }
        }

        room?.delete(socketId)
        if (room?.size === 0) worldRooms.delete(worldId)

        if (tagGames.has(worldId)) broadcastTagState(worldId)
        broadcastRoom(worldId)

        // Dungeon co-op cleanup
        const runId = socketDungeonRoom.get(socketId)
        socketDungeonRoom.delete(socketId)
        if (runId) {
          const dRoom = dungeonCoopRooms.get(runId)
          if (dRoom) {
            dRoom.sockets.delete(socketId)
            if (dRoom.sockets.size === 0) {
              dungeonCoopRooms.delete(runId)
            } else {
              broadcastDungeonRoom(runId)
            }
          }
        }
      },
    }
  }),
)

// ── Auth routes (Better Auth handles /api/auth/*) ─────────────────────────────
app.on(["POST", "GET"], "/api/auth/:path{.+}", (c) => auth.handler(c.req.raw))
app.on(["POST", "GET"], "/api/auth", (c) => auth.handler(c.req.raw))

// ── API me endpoint ───────────────────────────────────────────────────────────
app.get("/api/me", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401)
  }
  return c.json({ data: { user: session.user } })
})

// ── Routes ────────────────────────────────────────────────────────────────────
app.route("/api/health", healthRouter)
app.route("/api/problems", problemsRouter)
app.route("/api/submissions", submissionsRouter)
app.route("/api/worlds", worldsRouter)
app.route("/api/inventory", inventoryRouter)
app.route("/api/leaderboard", leaderboardRouter)
app.route("/api/profile", profileRouter)
app.route("/api/dungeons", dungeonsRouter)
app.route("/api/friends", friendsRouter)

// ── Error handling ────────────────────────────────────────────────────────────
app.onError((err, c) => {
  console.error("[API Error]", err)
  Sentry.captureException(err)
  return c.json({ error: "Internal server error" }, 500)
})

app.notFound((c) => c.json({ error: "Not found" }, 404))

// ── Start server — Bun native export with WebSocket support ──────────────────
const port = Number(process.env["API_PORT"] ?? 3001)
console.log(`🚀 API server running at http://localhost:${port}`)

export default {
  port,
  fetch(req: Request, server: unknown) {
    return app.fetch(req, { server })
  },
  websocket,
}
