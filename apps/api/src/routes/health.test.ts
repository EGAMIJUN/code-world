import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { healthRouter } from "./health"

describe("GET /api/health", () => {
  const app = new Hono()
  app.route("/", healthRouter)

  it("returns HTTP 200", async () => {
    const res = await app.request("/")
    expect(res.status).toBe(200)
  })

  it("returns status ok and service name", async () => {
    const res = await app.request("/")
    const body = (await res.json()) as { status: string; service: string; timestamp: string }
    expect(body.status).toBe("ok")
    expect(body.service).toBe("code-world-api")
  })

  it("timestamp is a valid ISO 8601 string", async () => {
    const res = await app.request("/")
    const body = (await res.json()) as { timestamp: string }
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp)
  })
})
