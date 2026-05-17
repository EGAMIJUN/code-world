import { db, dungeonRooms, dungeonRuns, dungeons, problems, users } from "@code-world/db"
import { StartDungeonRunSchema, UpdateDungeonRunSchema } from "@code-world/types"
import { zValidator } from "@hono/zod-validator"
import { and, asc, eq, sql } from "drizzle-orm"
import { Hono } from "hono"
import { auth } from "../lib/auth"

export const dungeonsRouter = new Hono()

// GET /dungeons — list all dungeons
dungeonsRouter.get("/", async (c) => {
  const rows = await db
    .select()
    .from(dungeons)
    .orderBy(asc(dungeons.language), asc(dungeons.levelRequired))
  return c.json({ data: rows })
})

// GET /dungeons/:id — dungeon with rooms and problems
dungeonsRouter.get("/:id", async (c) => {
  const id = c.req.param("id")

  const dungeon = await db.query.dungeons.findFirst({
    where: (d, { eq: eqFn }) => eqFn(d.id, id),
  })
  if (!dungeon) return c.json({ error: "Not found" }, 404)

  const rooms = await db
    .select({
      id: dungeonRooms.id,
      dungeonId: dungeonRooms.dungeonId,
      problemId: dungeonRooms.problemId,
      roomType: dungeonRooms.roomType,
      roomOrder: dungeonRooms.roomOrder,
      problem: {
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
      },
    })
    .from(dungeonRooms)
    .innerJoin(problems, eq(dungeonRooms.problemId, problems.id))
    .where(eq(dungeonRooms.dungeonId, id))
    .orderBy(asc(dungeonRooms.roomOrder))

  return c.json({ data: { ...dungeon, rooms } })
})

// POST /dungeons/runs — start a new dungeon run
dungeonsRouter.post("/runs", zValidator("json", StartDungeonRunSchema), async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Unauthorized" }, 401)

  const { dungeonId } = c.req.valid("json")

  const dungeon = await db.query.dungeons.findFirst({
    where: (d, { eq: eqFn }) => eqFn(d.id, dungeonId),
  })
  if (!dungeon) return c.json({ error: "Dungeon not found" }, 404)

  const user = await db.query.users.findFirst({
    where: (u, { eq: eqFn }) => eqFn(u.email, session.user.email),
  })
  if (!user) return c.json({ error: "Player not found" }, 404)

  if (user.level < dungeon.levelRequired) {
    return c.json({ error: `Level ${dungeon.levelRequired} required` }, 403)
  }

  // Abandon any existing in_progress run for this dungeon+user
  await db
    .update(dungeonRuns)
    .set({ status: "failed", completedAt: new Date() })
    .where(
      and(
        eq(dungeonRuns.userId, user.id),
        eq(dungeonRuns.dungeonId, dungeonId),
        eq(dungeonRuns.status, "in_progress"),
      ),
    )

  const playerMaxHp = 100 + user.level * 20

  const [run] = await db
    .insert(dungeonRuns)
    .values({
      userId: user.id,
      dungeonId,
      currentRoomOrder: 0,
      playerHp: playerMaxHp,
      bossHpRemaining: dungeon.bossHp,
      status: "in_progress",
    })
    .returning()

  return c.json({ data: run }, 201)
})

// GET /dungeons/runs/:runId — get run state
dungeonsRouter.get("/runs/:runId", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Unauthorized" }, 401)

  const runId = c.req.param("runId")
  const run = await db.query.dungeonRuns.findFirst({
    where: (r, { eq: eqFn }) => eqFn(r.id, runId),
  })
  if (!run) return c.json({ error: "Not found" }, 404)

  return c.json({ data: run })
})

// PATCH /dungeons/runs/:runId — update run state (damage, advance, complete)
dungeonsRouter.patch("/runs/:runId", zValidator("json", UpdateDungeonRunSchema), async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Unauthorized" }, 401)

  const runId = c.req.param("runId")
  const body = c.req.valid("json")

  const run = await db.query.dungeonRuns.findFirst({
    where: (r, { eq: eqFn }) => eqFn(r.id, runId),
  })
  if (!run) return c.json({ error: "Not found" }, 404)

  const updates: Partial<typeof run> = {}
  if (body.playerHp !== undefined) updates.playerHp = body.playerHp
  if (body.bossHpRemaining !== undefined) updates.bossHpRemaining = body.bossHpRemaining
  if (body.currentRoomOrder !== undefined) updates.currentRoomOrder = body.currentRoomOrder
  if (body.status !== undefined) updates.status = body.status
  if (body.completedAt !== undefined) updates.completedAt = body.completedAt

  // On failure, apply XP penalty (-10%)
  if (body.status === "failed") {
    const user = await db.query.users.findFirst({
      where: (u, { eq: eqFn }) => eqFn(u.id, run.userId),
    })
    if (user && user.xp > 0) {
      const penalty = Math.floor(user.xp * 0.1)
      await db
        .update(users)
        .set({ xp: sql`${users.xp} - ${penalty}`, updatedAt: new Date() })
        .where(eq(users.id, user.id))
    }
  }

  const [updated] = await db
    .update(dungeonRuns)
    .set(updates)
    .where(eq(dungeonRuns.id, runId))
    .returning()

  return c.json({ data: updated })
})
