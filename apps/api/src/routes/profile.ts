import { db, inventory, submissions } from "@code-world/db"
import { and, count, eq } from "drizzle-orm"
import { Hono } from "hono"
import type { Context } from "hono"
import { auth } from "../lib/auth"

export const profileRouter = new Hono()

async function fetchProfile(playerId: string) {
  const user = await db.query.users.findFirst({
    where: (u, { eq: eqFn }) => eqFn(u.id, playerId),
  })
  if (!user) return null

  const [submissionStats] = await db
    .select({ total: count() })
    .from(submissions)
    .where(eq(submissions.playerId, playerId))

  const [acceptedStats] = await db
    .select({ total: count() })
    .from(submissions)
    .where(and(eq(submissions.playerId, playerId), eq(submissions.result, "accepted")))

  const invItems = await db.select().from(inventory).where(eq(inventory.playerId, playerId))
  const totalBlocks = invItems.reduce((sum, item) => sum + item.quantity, 0)

  const userAchievements = await db.query.achievements.findMany({
    where: (a, { eq: eqFn }) => eqFn(a.playerId, playerId),
  })

  const totalSubs = Number(submissionStats?.total ?? 0)
  const accepted = Number(acceptedStats?.total ?? 0)
  const correctRate = totalSubs > 0 ? Math.round((accepted / totalSubs) * 100) : 0

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    level: user.level,
    xp: user.xp,
    problemsSolved: accepted,
    totalSubmissions: totalSubs,
    correctRate,
    totalBlocks,
    achievements: userAchievements.map((a) => ({
      id: a.id,
      achievementType: a.achievementType,
      unlockedAt: a.unlockedAt,
    })),
  }
}

// GET /profile/me — authenticated user's profile
profileRouter.get("/me", async (c: Context) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Unauthorized" }, 401)

  const user = await db.query.users.findFirst({
    where: (u, { eq: eqFn }) => eqFn(u.email, session.user.email),
  })
  if (!user) return c.json({ error: "User not found" }, 404)

  const profile = await fetchProfile(user.id)
  if (!profile) return c.json({ error: "User not found" }, 404)

  return c.json({ data: profile })
})

// GET /profile/:id — any player's profile
profileRouter.get("/:id", async (c: Context) => {
  const id = c.req.param("id")
  const profile = await fetchProfile(id)
  if (!profile) return c.json({ error: "User not found" }, 404)
  return c.json({ data: profile })
})
