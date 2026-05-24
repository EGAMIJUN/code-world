import { db, submissions, users } from "@code-world/db"
import { CreateSubmissionSchema } from "@code-world/types"
import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { auth } from "../lib/auth"
import { codeExecutionQueue } from "../lib/queue"

export const submissionsRouter = new Hono()

async function getOrCreateGameUser(authUser: {
  id: string
  email: string
  name: string
  image?: string | null
}) {
  const existing = await db.query.users.findFirst({
    where: (u, { eq: eqFn }) => eqFn(u.email, authUser.email),
  })
  if (existing) return existing

  const base =
    authUser.name
      .replace(/[^a-zA-Z0-9]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .toLowerCase()
      .slice(0, 20) || "player"

  let username = base
  let attempt = 0
  for (;;) {
    const taken = await db.query.users.findFirst({
      where: (u, { eq: eqFn }) => eqFn(u.username, username),
    })
    if (!taken) break
    attempt++
    username = `${base}_${attempt}`
  }

  const [user] = await db
    .insert(users)
    .values({
      email: authUser.email,
      username,
      displayName: authUser.name,
      avatarUrl: authUser.image ?? null,
    })
    .returning()

  if (!user) throw new Error("Failed to create game user")
  return user
}

// POST /submissions — submit code for a problem
submissionsRouter.post("/", zValidator("json", CreateSubmissionSchema), async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Unauthorized" }, 401)

  const user = await getOrCreateGameUser(session.user)
  const playerId = user.id

  const body = c.req.valid("json")

  const [row] = await db
    .insert(submissions)
    .values({
      playerId,
      problemId: body.problemId,
      code: body.code,
      result: "pending",
    })
    .returning()

  if (!row) {
    return c.json({ error: "Failed to create submission" }, 500)
  }

  // Enqueue to BullMQ for execution
  // SQL gets 30s; non-SQL stubs return immediately so 10s is ample
  const jobTimeoutMs = body.language === "sql" ? 30_000 : 10_000
  await codeExecutionQueue.add(
    "code-execution",
    {
      submissionId: row.id,
      problemId: body.problemId,
      code: body.code,
      language: body.language,
    },
    {
      attempts: 2,
      backoff: { type: "fixed", delay: 2_000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 100 },
      timeout: jobTimeoutMs,
    },
  )

  return c.json({ id: row.id, status: "pending" }, 202)
})

// GET /submissions/:id
submissionsRouter.get("/:id", async (c) => {
  const id = c.req.param("id")
  const row = await db.query.submissions.findFirst({
    where: (s, { eq: eqFn }) => eqFn(s.id, id),
  })

  if (!row) return c.json({ error: "Not found" }, 404)
  return c.json({ data: row })
})
