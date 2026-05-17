import { Sentry, initSentry } from "./lib/sentry"
initSentry()

import { Hono } from "hono"
import { createBunWebSocket } from "hono/bun"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { prettyJSON } from "hono/pretty-json"
import { auth } from "./lib/auth"
import { dungeonsRouter } from "./routes/dungeons"
import { healthRouter } from "./routes/health"
import { inventoryRouter } from "./routes/inventory"
import { leaderboardRouter } from "./routes/leaderboard"
import { problemsRouter } from "./routes/problems"
import { profileRouter } from "./routes/profile"
import { submissionsRouter } from "./routes/submissions"
import { worldsRouter } from "./routes/worlds"

// ── WebSocket position-sync room manager ──────────────────────────────────────
interface PlayerState {
  username: string
  x: number
  y: number
}

const socketMeta = new Map<string, { worldId: string | null; ws: { send(d: string): void } }>()
const worldRooms = new Map<string, Map<string, PlayerState>>()

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

// ── WebSocket — player position sync ─────────────────────────────────────────
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
        } else if (msg["type"] === "move") {
          const { worldId } = meta
          if (!worldId) return
          const room = worldRooms.get(worldId)
          const state = room?.get(socketId)
          if (!state) return
          state.x = Number(msg["x"] ?? state.x)
          state.y = Number(msg["y"] ?? state.y)
          broadcastRoom(worldId)
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
        }
      },

      onClose() {
        const meta = socketMeta.get(socketId)
        if (meta?.worldId) {
          worldRooms.get(meta.worldId)?.delete(socketId)
          if (worldRooms.get(meta.worldId)?.size === 0) worldRooms.delete(meta.worldId)
          broadcastRoom(meta.worldId)
        }
        socketMeta.delete(socketId)
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
  // Pass the Bun server instance to Hono env so upgradeWebSocket can access it
  fetch(req: Request, server: unknown) {
    return app.fetch(req, { server })
  },
  websocket,
}
