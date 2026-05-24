import { db, users } from "@code-world/db"
import { desc } from "drizzle-orm"
import { Hono } from "hono"

export const leaderboardRouter = new Hono()

leaderboardRouter.get("/", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? "50") || 50, 100)
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      totalKills: users.totalKills,
      totalDeaths: users.totalDeaths,
      totalScore: users.totalScore,
    })
    .from(users)
    .orderBy(desc(users.totalScore), desc(users.totalKills))
    .limit(limit)

  const entries = rows.map((row, i) => ({ rank: i + 1, ...row }))
  return c.json({ data: { entries, updatedAt: new Date() } })
})
