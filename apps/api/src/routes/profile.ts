import { db, matches, users } from "@code-world/db"
import { desc, eq } from "drizzle-orm"
import { Hono } from "hono"
import type { Context } from "hono"
import { getAuthUser } from "../lib/auth"
import { getCountryCode } from "../lib/geo"

export const profileRouter = new Hono()

async function fetchProfile(userId: string) {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      totalKills: users.totalKills,
      totalDeaths: users.totalDeaths,
      totalScore: users.totalScore,
      maxKillstreak: users.maxKillstreak,
      weaponKills: users.weaponKills,
      countryCode: users.countryCode,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  const user = rows[0]
  if (!user) return null

  const kdRaw = user.totalDeaths > 0 ? user.totalKills / user.totalDeaths : user.totalKills

  return {
    id: user.id,
    username: user.username,
    totalKills: user.totalKills,
    totalDeaths: user.totalDeaths,
    totalScore: user.totalScore,
    maxKillstreak: user.maxKillstreak,
    weaponKills: user.weaponKills,
    countryCode: user.countryCode,
    kd: Math.round(kdRaw * 100) / 100,
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

profileRouter.get("/me/matches", async (c: Context) => {
  const auth = await getAuthUser(c)
  if (!auth) return c.json({ error: "Unauthorized" }, 401)
  const rows = await db
    .select()
    .from(matches)
    .where(eq(matches.userId, auth.id))
    .orderBy(desc(matches.createdAt))
    .limit(10)
  return c.json({ data: rows })
})

profileRouter.get("/:id", async (c: Context) => {
  const id = c.req.param("id")
  const profile = await fetchProfile(id)
  if (!profile) return c.json({ error: "User not found" }, 404)
  return c.json({ data: profile })
})

profileRouter.get("/:id/matches", async (c: Context) => {
  const id = c.req.param("id")
  const rows = await db
    .select()
    .from(matches)
    .where(eq(matches.userId, id))
    .orderBy(desc(matches.createdAt))
    .limit(10)
  return c.json({ data: rows })
})

// "hunt" は HUNT モードの死亡時送信、"osaka" は大阪編クリア時の送信 (FINAL-E)。
const VALID_MODES = new Set(["wave_defense", "ffa", "tdm", "mission", "zombie", "hunt", "osaka"])
const VALID_MAPS = new Set(["urban", "desert", "snow", "sky", "osaka"])

profileRouter.post("/stats", async (c: Context) => {
  const auth = await getAuthUser(c)
  if (!auth) return c.json({ error: "Unauthorized" }, 401)
  const body = (await c.req.json().catch(() => null)) as {
    kills?: unknown
    deaths?: unknown
    score?: unknown
    killstreak?: unknown
    headshots?: unknown
    durationSec?: unknown
    mode?: unknown
    mapId?: unknown
    weaponKills?: Record<string, unknown> | null
    result?: unknown
  } | null

  const kills = clampInt(body?.kills, 0, 10_000)
  const deaths = clampInt(body?.deaths, 0, 10_000)
  const score = clampInt(body?.score, 0, 1_000_000)
  const killstreak = clampInt(body?.killstreak, 0, 10_000)
  const headshots = clampInt(body?.headshots, 0, 10_000)
  const durationSec = clampInt(body?.durationSec, 0, 60 * 60 * 4)
  const mode = VALID_MODES.has(String(body?.mode)) ? String(body?.mode) : "mission"
  const mapId = VALID_MAPS.has(String(body?.mapId)) ? String(body?.mapId) : "urban"
  const result = ["ended", "victory", "defeat"].includes(String(body?.result))
    ? String(body?.result)
    : "ended"

  const wkRaw = body?.weaponKills && typeof body.weaponKills === "object" ? body.weaponKills : {}
  const wkInput: Record<string, number> = {}
  for (const k of Object.keys(wkRaw).slice(0, 16)) {
    if (!/^[a-z_]{1,32}$/.test(k)) continue
    const v = Number(wkRaw[k])
    if (Number.isFinite(v) && v > 0) wkInput[k] = Math.min(10_000, Math.floor(v))
  }

  const rows = await db
    .select({
      totalKills: users.totalKills,
      totalDeaths: users.totalDeaths,
      totalScore: users.totalScore,
      maxKillstreak: users.maxKillstreak,
      weaponKills: users.weaponKills,
    })
    .from(users)
    .where(eq(users.id, auth.id))
    .limit(1)
  const cur = rows[0]
  if (!cur) return c.json({ error: "User not found" }, 404)

  const mergedWeaponKills: Record<string, number> = { ...(cur.weaponKills ?? {}) }
  for (const [k, v] of Object.entries(wkInput)) {
    mergedWeaponKills[k] = (mergedWeaponKills[k] ?? 0) + v
  }

  const country = getCountryCode(c)

  await db
    .update(users)
    .set({
      totalKills: cur.totalKills + kills,
      totalDeaths: cur.totalDeaths + deaths,
      totalScore: cur.totalScore + score,
      maxKillstreak: Math.max(cur.maxKillstreak, killstreak),
      weaponKills: mergedWeaponKills,
      ...(country ? { countryCode: country } : {}),
    })
    .where(eq(users.id, auth.id))

  await db.insert(matches).values({
    userId: auth.id,
    mode,
    mapId,
    kills,
    deaths,
    score,
    killstreak,
    headshots,
    durationSec,
    result,
  })

  return c.json({ data: { ok: true } })
})

function clampInt(v: unknown, lo: number, hi: number): number {
  const n = Math.floor(Number(v ?? 0))
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}
