import { db, problems, submissions } from "@code-world/db"
import { CreateProblemSchema } from "@code-world/types"
import { and, count, eq } from "drizzle-orm"
import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"

export const problemsRouter = new Hono()

// GET /problems — list approved problems with solved_count
problemsRouter.get("/", async (c) => {
  const category = c.req.query("category")
  const difficulty = c.req.query("difficulty")

  const filters = [eq(problems.status, "approved")]
  if (category) {
    filters.push(eq(problems.category, category as "sql" | "debug" | "design" | "review"))
  }
  if (difficulty !== undefined && difficulty !== "") {
    filters.push(eq(problems.difficulty, Number(difficulty)))
  }

  const rows = await db
    .select({
      id: problems.id,
      authorId: problems.authorId,
      title: problems.title,
      category: problems.category,
      difficulty: problems.difficulty,
      body: problems.body,
      isOfficial: problems.isOfficial,
      status: problems.status,
      playCount: problems.playCount,
      createdAt: problems.createdAt,
      updatedAt: problems.updatedAt,
      solvedCount: count(submissions.id),
    })
    .from(problems)
    .leftJoin(
      submissions,
      and(eq(submissions.problemId, problems.id), eq(submissions.result, "accepted")),
    )
    .where(and(...filters))
    .groupBy(problems.id)
    .orderBy(problems.difficulty, problems.createdAt)
    .limit(50)

  return c.json({ data: rows })
})

// GET /problems/:id — return full problem with solved_count
problemsRouter.get("/:id", async (c) => {
  const id = c.req.param("id")

  const rows = await db
    .select({
      id: problems.id,
      authorId: problems.authorId,
      title: problems.title,
      category: problems.category,
      difficulty: problems.difficulty,
      body: problems.body,
      isOfficial: problems.isOfficial,
      status: problems.status,
      playCount: problems.playCount,
      createdAt: problems.createdAt,
      updatedAt: problems.updatedAt,
      solvedCount: count(submissions.id),
    })
    .from(problems)
    .leftJoin(
      submissions,
      and(eq(submissions.problemId, problems.id), eq(submissions.result, "accepted")),
    )
    .where(eq(problems.id, id))
    .groupBy(problems.id)
    .limit(1)

  const row = rows[0]
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
