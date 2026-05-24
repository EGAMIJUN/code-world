import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { problemsRouter } from "./problems"

// Integration test — requires DATABASE_URL pointing to a real PostgreSQL instance.
// In CI the postgres service is started automatically via the workflow's services block.
// Locally: run `docker compose up -d` first.
describe("GET /api/problems", () => {
  const app = new Hono()
  app.route("/", problemsRouter)

  it("returns HTTP 200 with a data array", async () => {
    const res = await app.request("/")
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body).toHaveProperty("data")
    expect(Array.isArray(body.data)).toBe(true)
  })

  it("filters by valid category param", async () => {
    const res = await app.request("/?category=sql")
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { category: string }[] }
    expect(Array.isArray(body.data)).toBe(true)
    for (const item of body.data) {
      expect(item.category).toBe("sql")
    }
  })

  it("filters by difficulty param", async () => {
    const res = await app.request("/?difficulty=0")
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { difficulty: number }[] }
    expect(Array.isArray(body.data)).toBe(true)
    for (const item of body.data) {
      expect(item.difficulty).toBe(0)
    }
  })

  it("ignores unrecognised category and still returns 200", async () => {
    const res = await app.request("/?category=unknown_category")
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
  })
})
