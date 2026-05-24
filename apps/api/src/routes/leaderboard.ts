import { db, matches, users } from "@code-world/db"
import { desc, eq, gte, sql } from "drizzle-orm"
import { Hono } from "hono"

export const leaderboardRouter = new Hono()

type Window = "all" | "week" | "month"
type SortKey = "score" | "kills" | "kd"

type LbRow = {
  id: string
  username: string
  countryCode: string | null
  totalKills: number
  totalDeaths: number
  totalScore: number
}

function windowSince(w: Window): Date | null {
  if (w === "week") return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  if (w === "month") return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  return null
}

function kd(r: { totalKills: number; totalDeaths: number }): number {
  const v = r.totalDeaths > 0 ? r.totalKills / r.totalDeaths : r.totalKills
  return Math.round(v * 100) / 100
}

function sortRows(rows: LbRow[], key: SortKey): LbRow[] {
  const copy = [...rows]
  if (key === "kills") {
    copy.sort((a, b) => b.totalKills - a.totalKills || b.totalScore - a.totalScore)
  } else if (key === "kd") {
    copy.sort((a, b) => kd(b) - kd(a) || b.totalScore - a.totalScore)
  } else {
    copy.sort((a, b) => b.totalScore - a.totalScore || b.totalKills - a.totalKills)
  }
  return copy
}

leaderboardRouter.get("/", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? "50") || 50, 100)
  const windowParam = (c.req.query("window") ?? "all") as Window
  const sortParam = (c.req.query("sort") ?? "score") as SortKey
  const sortKey: SortKey = ["score", "kills", "kd"].includes(sortParam) ? sortParam : "score"
  const since = windowSince(windowParam)

  let rows: LbRow[]
  if (since) {
    rows = await db
      .select({
        id: users.id,
        username: users.username,
        countryCode: users.countryCode,
        totalKills: sql<number>`coalesce(sum(${matches.kills}), 0)::int`,
        totalDeaths: sql<number>`coalesce(sum(${matches.deaths}), 0)::int`,
        totalScore: sql<number>`coalesce(sum(${matches.score}), 0)::int`,
      })
      .from(users)
      .innerJoin(matches, eq(matches.userId, users.id))
      .where(gte(matches.createdAt, since))
      .groupBy(users.id, users.username, users.countryCode)
      .limit(limit * 3)
  } else {
    rows = await db
      .select({
        id: users.id,
        username: users.username,
        countryCode: users.countryCode,
        totalKills: users.totalKills,
        totalDeaths: users.totalDeaths,
        totalScore: users.totalScore,
      })
      .from(users)
      .orderBy(desc(users.totalScore), desc(users.totalKills))
      .limit(limit * 3)
  }

  const sorted = sortRows(rows, sortKey).slice(0, limit)
  const entries = sorted.map((row, i) => ({ rank: i + 1, ...row, kd: kd(row) }))
  return c.json({ data: { entries, updatedAt: new Date(), window: windowParam, sort: sortKey } })
})

leaderboardRouter.get("/me-rank", async (c) => {
  const userId = c.req.query("userId")
  if (!userId) return c.json({ data: null })
  const all = await db
    .select({
      id: users.id,
      username: users.username,
      countryCode: users.countryCode,
      totalKills: users.totalKills,
      totalDeaths: users.totalDeaths,
      totalScore: users.totalScore,
    })
    .from(users)
    .orderBy(desc(users.totalScore), desc(users.totalKills))
  const idx = all.findIndex((r) => r.id === userId)
  if (idx < 0) return c.json({ data: null })
  const row = all[idx]
  if (!row) return c.json({ data: null })
  return c.json({ data: { rank: idx + 1, total: all.length, ...row, kd: kd(row) } })
})
