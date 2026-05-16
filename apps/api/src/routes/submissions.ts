import { db, submissions } from "@code-world/db"
import { CreateSubmissionSchema } from "@code-world/types"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { codeExecutionQueue } from "../lib/queue"

export const submissionsRouter = new Hono()

// POST /submissions — submit code for a problem
submissionsRouter.post(
  "/",
  zValidator("json", CreateSubmissionSchema),
  async (c) => {
    const body = c.req.valid("json")

    // TODO: get playerId from session once auth is fully wired
    const playerId = c.req.header("x-player-id") ?? "00000000-0000-0000-0000-000000000000"

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
    await codeExecutionQueue.add("code-execution", {
      submissionId: row.id,
      problemId: body.problemId,
      code: body.code,
      language: "sql",
    })

    return c.json({ id: row.id, status: "pending" }, 202)
  },
)

// GET /submissions/:id
submissionsRouter.get("/:id", async (c) => {
  const id = c.req.param("id")
  const row = await db.query.submissions.findFirst({
    where: (s, { eq: eqFn }) => eqFn(s.id, id),
  })

  if (!row) return c.json({ error: "Not found" }, 404)
  return c.json({ data: row })
})
