import { db, problems } from "@code-world/db"
import { CreateProblemSchema } from "@code-world/types"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"

export const problemsRouter = new Hono()

// GET /problems — list approved problems
problemsRouter.get("/", async (c) => {
  const category = c.req.query("category")
  const difficulty = c.req.query("difficulty")

  const rows = await db.query.problems.findMany({
    where: (p, { eq, and }) => {
      const filters = [eq(p.status, "approved")]
      if (category) filters.push(eq(p.category, category as "sql" | "debug" | "design" | "review"))
      if (difficulty) filters.push(eq(p.difficulty, Number(difficulty)))
      return and(...filters)
    },
    orderBy: (p, { asc }) => [asc(p.difficulty), asc(p.createdAt)],
    limit: 50,
  })

  return c.json({ data: rows })
})

// GET /problems/:id
problemsRouter.get("/:id", async (c) => {
  const id = c.req.param("id")
  const row = await db.query.problems.findFirst({
    where: (p, { eq }) => eq(p.id, id),
  })

  if (!row) return c.json({ error: "Not found" }, 404)
  return c.json({ data: row })
})

// POST /problems — create (requires auth)
problemsRouter.post(
  "/",
  zValidator("json", CreateProblemSchema),
  async (c) => {
    const body = c.req.valid("json")

    const [row] = await db
      .insert(problems)
      .values({
        ...body,
        status: "pending",
      })
      .returning()

    return c.json({ data: row }, 201)
  },
)
