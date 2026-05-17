import { blocks, db, inventory, users, worlds } from "@code-world/db"
import { PlaceGameBlockSchema } from "@code-world/types"
import { zValidator } from "@hono/zod-validator"
import { and, eq } from "drizzle-orm"
import { Hono } from "hono"
import { auth } from "../lib/auth"

export const worldsRouter = new Hono()

interface AuthUser {
  id: string
  email: string
  name: string
  image?: string | null
}

async function getOrCreateGameUser(authUser: AuthUser) {
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

  return user!
}

// GET /worlds/user/:userId — get another player's world (public, read-only)
worldsRouter.get("/user/:userId", async (c) => {
  const userId = c.req.param("userId")

  const user = await db.query.users.findFirst({
    where: (u, { eq: eqFn }) => eqFn(u.id, userId),
  })
  if (!user) return c.json({ error: "User not found" }, 404)

  const world = await db.query.worlds.findFirst({
    where: (w, { eq: eqFn }) => eqFn(w.ownerId, userId),
  })
  if (!world) return c.json({ error: "World not found" }, 404)

  return c.json({
    data: {
      world,
      owner: { id: user.id, username: user.username, displayName: user.displayName },
    },
  })
})

// GET /worlds/my — get or create the authenticated player's world
worldsRouter.get("/my", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Unauthorized" }, 401)

  const user = await getOrCreateGameUser(session.user)

  let world = await db.query.worlds.findFirst({
    where: (w, { eq: eqFn }) => eqFn(w.ownerId, user.id),
  })

  if (!world) {
    const [newWorld] = await db
      .insert(worlds)
      .values({
        ownerId: user.id,
        name: `${user.displayName ?? user.username}'s World`,
      })
      .returning()
    world = newWorld!
  }

  return c.json({ data: world })
})

// GET /worlds/:id/blocks — list all blocks in a world
worldsRouter.get("/:id/blocks", async (c) => {
  const worldId = c.req.param("id")
  const rows = await db.select().from(blocks).where(eq(blocks.worldId, worldId))
  return c.json({ data: rows })
})

// POST /worlds/:id/blocks — place a block (requires inventory)
worldsRouter.post("/:id/blocks", zValidator("json", PlaceGameBlockSchema), async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Unauthorized" }, 401)

  const user = await getOrCreateGameUser(session.user)
  const worldId = c.req.param("id")
  const body = c.req.valid("json")

  // Verify world belongs to this user
  const world = await db.query.worlds.findFirst({
    where: (w, { eq: eqFn }) => eqFn(w.id, worldId),
  })
  if (!world || world.ownerId !== user.id) {
    return c.json({ error: "Forbidden" }, 403)
  }

  // Check inventory
  const invItem = await db.query.inventory.findFirst({
    where: (inv, { and: andFn, eq: eqFn }) =>
      andFn(eqFn(inv.playerId, user.id), eqFn(inv.blockType, body.blockType)),
  })
  if (!invItem || invItem.quantity <= 0) {
    return c.json({ error: "インベントリにブロックがありません" }, 400)
  }

  // Place block + decrement inventory atomically
  const block = await db.transaction(async (tx) => {
    const [placed] = await tx
      .insert(blocks)
      .values({
        worldId,
        placedBy: user.id,
        blockType: body.blockType,
        positionX: body.positionX,
        positionY: body.positionY,
        positionZ: body.positionZ,
        meta: body.meta ?? null,
      })
      .returning()

    await tx
      .update(inventory)
      .set({ quantity: invItem.quantity - 1, updatedAt: new Date() })
      .where(and(eq(inventory.playerId, user.id), eq(inventory.blockType, body.blockType)))

    return placed!
  })

  return c.json({ data: block }, 201)
})
