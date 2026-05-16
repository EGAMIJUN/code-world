import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { prettyJSON } from "hono/pretty-json"
import { healthRouter } from "./routes/health"
import { problemsRouter } from "./routes/problems"
import { submissionsRouter } from "./routes/submissions"

const app = new Hono().basePath("/api")

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(logger())
app.use(prettyJSON())
app.use(
  cors({
    origin: process.env["NEXT_PUBLIC_WEB_URL"] ?? "http://localhost:3000",
    credentials: true,
  }),
)

// ── Routes ────────────────────────────────────────────────────────────────────
app.route("/health", healthRouter)
app.route("/problems", problemsRouter)
app.route("/submissions", submissionsRouter)

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
