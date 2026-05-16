import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { prettyJSON } from "hono/pretty-json"
import { auth } from "./lib/auth"
import { healthRouter } from "./routes/health"
import { problemsRouter } from "./routes/problems"
import { submissionsRouter } from "./routes/submissions"

const app = new Hono()

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(logger())
app.use(prettyJSON())
app.use(
  cors({
    origin: [
      process.env["NEXT_PUBLIC_WEB_URL"] ?? "http://localhost:3000",
      process.env["WEB_URL"] ?? "http://localhost:3000",
    ],
    credentials: true,
  }),
)

// ── Auth routes (Better Auth handles /api/auth/*) ─────────────────────────────
app.on(["POST", "GET"], "/api/auth/**", (c) => auth.handler(c.req.raw))

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

// ── Error handling ────────────────────────────────────────────────────────────
app.onError((err, c) => {
  console.error("[API Error]", err)
  return c.json({ error: "Internal server error" }, 500)
})

app.notFound((c) => c.json({ error: "Not found" }, 404))

// ── Export for Bun ────────────────────────────────────────────────────────────
const port = Number(process.env["API_PORT"] ?? 3001)
console.log(`🚀 API server running at http://localhost:${port}`)

export default {
  port,
  fetch: app.fetch,
}
