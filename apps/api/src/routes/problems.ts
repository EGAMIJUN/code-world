import { db, problems, submissions, users } from "@code-world/db"
import { CreateProblemSchema } from "@code-world/types"
import { zValidator } from "@hono/zod-validator"
import { and, count, eq, inArray } from "drizzle-orm"
import { Hono } from "hono"
import { auth } from "../lib/auth"

export const problemsRouter = new Hono()

const VALID_CATEGORIES = ["sql", "debug", "design", "review", "algorithm"] as const
type ValidCategory = (typeof VALID_CATEGORIES)[number]

// GET /problems — list approved problems with solved_count
problemsRouter.get("/", async (c) => {
  const category = c.req.query("category")
  const difficulty = c.req.query("difficulty")

  const filters = [eq(problems.status, "approved")]
  if (category && VALID_CATEGORIES.includes(category as ValidCategory)) {
    filters.push(eq(problems.category, category as ValidCategory))
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

  // Check session to return per-user solved status
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  const sessionEmail = session?.user?.email ?? null

  if (sessionEmail) {
    const gameUser = await db.query.users.findFirst({
      where: (u, { eq: eqFn }) => eqFn(u.email, sessionEmail),
    })
    const playerId = gameUser?.id ?? null

    if (playerId) {
      const problemIds = rows.map((r) => r.id)
      const solvedRows =
        problemIds.length > 0
          ? await db
              .selectDistinct({ problemId: submissions.problemId })
              .from(submissions)
              .where(
                and(
                  eq(submissions.playerId, playerId),
                  eq(submissions.result, "accepted"),
                  inArray(submissions.problemId, problemIds),
                ),
              )
          : []
      const solvedSet = new Set(solvedRows.map((r) => r.problemId))
      return c.json({ data: rows.map((r) => ({ ...r, solved: solvedSet.has(r.id) })) })
    }
  }

  return c.json({ data: rows.map((r) => ({ ...r, solved: false })) })
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
problemsRouter.post("/", zValidator("json", CreateProblemSchema), async (c) => {
  const body = c.req.valid("json")

  const [row] = await db
    .insert(problems)
    .values({
      ...body,
      status: "pending",
    })
    .returning()

  return c.json({ data: row }, 201)
})
