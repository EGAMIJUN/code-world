import { db, submissions } from "@code-world/db"
import { CreateSubmissionSchema } from "@code-world/types"
import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"

export const submissionsRouter = new Hono()

// POST /submissions — submit code for a problem
submissionsRouter.post(
  "/",
  zValidator("json", CreateSubmissionSchema),
  async (c) => {
    const body = c.req.valid("json")

    // TODO: get playerId from session
    const playerId = c.req.header("x-player-id") ?? "anonymous"

    const [row] = await db
      .insert(submissions)
      .values({
        playerId,
        problemId: body.problemId,
        code: body.code,
        result: "pending",
      })
      .returning()

    // TODO: enqueue to executor via BullMQ

    return c.json({ data: row }, 202)
  },
)

// GET /submissions/:id
submissionsRouter.get("/:id", async (c) => {
  const id = c.req.param("id")
  const row = await db.query.submissions.findFirst({
    where: (s, { eq }) => eq(s.id, id),
  })

  if (!row) return c.json({ error: "Not found" }, 404)
  return c.json({ data: row })
})
