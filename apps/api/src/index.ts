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
interface PlayerState {
  username: string
  x: number
  y: number
}

const socketMeta = new Map<string, { roomId: string | null; ws: { send(d: string): void } }>()
const rooms = new Map<string, Map<string, PlayerState>>()

function broadcastRoom(roomId: string) {
  const room = rooms.get(roomId)
  if (!room) return
  for (const [sid, meta] of socketMeta) {
    if (meta.roomId !== roomId) continue
    const others: Record<string, PlayerState> = {}
    for (const [otherId, state] of room) {
      if (otherId !== sid) others[otherId] = state
    }
    try {
      meta.ws.send(JSON.stringify({ type: "sync", players: others }))
    } catch {
      // ignore closed sockets
    }
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

// ── WebSocket: minimal position broadcast + chat ─────────────────────────────
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

        if (msg.type === "join") {
          const roomId = String(msg.roomId ?? msg.worldId ?? "shared")
          const username = String(msg.username ?? "Player")
          const x = Number(msg.x ?? 0)
          const y = Number(msg.y ?? 0)

          meta.roomId = roomId
          if (!rooms.has(roomId)) rooms.set(roomId, new Map())
          rooms.get(roomId)?.set(socketId, { username, x, y })
          broadcastRoom(roomId)

          const joinPkt = JSON.stringify({
            type: "chat",
            from: "SYSTEM",
            text: `${username} が入場しました`,
          })
          for (const [sid, m] of socketMeta) {
            if (m.roomId !== roomId || sid === socketId) continue
            try {
              m.ws.send(joinPkt)
            } catch {
              /* ignore */
            }
          }
        } else if (msg.type === "move") {
          const { roomId } = meta
          if (!roomId) return
          const room = rooms.get(roomId)
          const state = room?.get(socketId)
          if (!state) return
          state.x = Number(msg.x ?? state.x)
          state.y = Number(msg.y ?? state.y)
          broadcastRoom(roomId)
        } else if (msg.type === "chat") {
          const { roomId } = meta
          if (!roomId) return
          const text = String(msg.text ?? "")
            .slice(0, 200)
            .trim()
          if (!text) return
          const from = String(msg.from ?? "Player")
          const packet = JSON.stringify({ type: "chat", from, text })
          for (const [, m] of socketMeta) {
            if (m.roomId !== roomId) continue
            try {
              m.ws.send(packet)
            } catch {
              // ignore
            }
          }
        }
      },

      onClose() {
        const meta = socketMeta.get(socketId)
        socketMeta.delete(socketId)
        if (!meta?.roomId) return
        const roomId = meta.roomId
        const room = rooms.get(roomId)
        const leavingUsername = room?.get(socketId)?.username ?? "Player"
        room?.delete(socketId)
        if (room?.size === 0) rooms.delete(roomId)

        const leavePkt = JSON.stringify({
          type: "chat",
          from: "SYSTEM",
          text: `${leavingUsername} が退場しました`,
        })
        for (const [, m] of socketMeta) {
          if (m.roomId !== roomId) continue
          try {
            m.ws.send(leavePkt)
          } catch {
            /* ignore */
          }
        }
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
