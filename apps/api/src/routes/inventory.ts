import { db, inventory, users } from "@code-world/db"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { auth } from "../lib/auth"

export const inventoryRouter = new Hono()

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

// GET /inventory — return authenticated player's block inventory
inventoryRouter.get("/", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Unauthorized" }, 401)

  const user = await getOrCreateGameUser(session.user)
  const items = await db.select().from(inventory).where(eq(inventory.playerId, user.id))

  return c.json({ data: items })
})
