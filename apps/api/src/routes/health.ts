import { Hono } from "hono"

export const healthRouter = new Hono()

healthRouter.get("/", (c) =>
  c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "code-world-api",
  }),
)
