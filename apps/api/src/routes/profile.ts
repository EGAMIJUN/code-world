import { db, users } from "@code-world/db"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import type { Context } from "hono"
import { getAuthUser } from "../lib/auth"

export const profileRouter = new Hono()

async function fetchProfile(userId: string) {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      totalKills: users.totalKills,
      totalDeaths: users.totalDeaths,
      totalScore: users.totalScore,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  const user = rows[0]
  if (!user) return null

  const kd = user.totalDeaths > 0 ? user.totalKills / user.totalDeaths : user.totalKills

  return {
    id: user.id,
    username: user.username,
    totalKills: user.totalKills,
    totalDeaths: user.totalDeaths,
    totalScore: user.totalScore,
    kd: Math.round(kd * 100) / 100,
    createdAt: user.createdAt,
  }
}

profileRouter.get("/me", async (c: Context) => {
  const auth = await getAuthUser(c)
  if (!auth) return c.json({ error: "Unauthorized" }, 401)
  const profile = await fetchProfile(auth.id)
  if (!profile) return c.json({ error: "User not found" }, 404)
  return c.json({ data: profile })
})

profileRouter.get("/:id", async (c: Context) => {
  const id = c.req.param("id")
  const profile = await fetchProfile(id)
  if (!profile) return c.json({ error: "User not found" }, 404)
  return c.json({ data: profile })
})

profileRouter.post("/stats", async (c: Context) => {
  const auth = await getAuthUser(c)
  if (!auth) return c.json({ error: "Unauthorized" }, 401)
  const body = (await c.req.json().catch(() => null)) as {
    kills?: unknown
    deaths?: unknown
    score?: unknown
  } | null
  const kills = Math.max(0, Math.min(10000, Number(body?.kills ?? 0) | 0))
  const deaths = Math.max(0, Math.min(10000, Number(body?.deaths ?? 0) | 0))
  const score = Math.max(0, Math.min(1_000_000, Number(body?.score ?? 0) | 0))

  const rows = await db
    .select({
      totalKills: users.totalKills,
      totalDeaths: users.totalDeaths,
      totalScore: users.totalScore,
    })
    .from(users)
    .where(eq(users.id, auth.id))
    .limit(1)
  const cur = rows[0]
  if (!cur) return c.json({ error: "User not found" }, 404)

  await db
    .update(users)
    .set({
      totalKills: cur.totalKills + kills,
      totalDeaths: cur.totalDeaths + deaths,
      totalScore: cur.totalScore + score,
    })
    .where(eq(users.id, auth.id))

  return c.json({ data: { ok: true } })
})
