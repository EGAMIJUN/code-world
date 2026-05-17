import { db, leaderboard, users } from "@code-world/db"
import { desc, eq } from "drizzle-orm"
import { Hono } from "hono"

export const leaderboardRouter = new Hono()

// GET /leaderboard — top 10 players by total score
leaderboardRouter.get("/", async (c) => {
  const rows = await db
    .select({
      playerId: leaderboard.playerId,
      totalScore: leaderboard.totalScore,
      problemsSolved: leaderboard.problemsSolved,
      updatedAt: leaderboard.updatedAt,
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      level: users.level,
    })
    .from(leaderboard)
    .innerJoin(users, eq(leaderboard.playerId, users.id))
    .orderBy(desc(leaderboard.totalScore))
    .limit(10)

  const entries = rows.map((row, i) => ({
    rank: i + 1,
    playerId: row.playerId,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    level: row.level,
    totalScore: row.totalScore,
    problemsSolved: row.problemsSolved,
  }))

  return c.json({ data: { entries, updatedAt: new Date() } })
})
