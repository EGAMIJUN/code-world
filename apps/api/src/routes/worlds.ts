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

const SYSTEM_EMAIL = "system@code-world.internal"
const SYSTEM_USERNAME = "system"

async function getOrCreateSharedWorld() {
  let sysUser = await db.query.users.findFirst({
    where: (u, { eq: eqFn }) => eqFn(u.email, SYSTEM_EMAIL),
  })
  if (!sysUser) {
    const [inserted] = await db
      .insert(users)
      .values({ email: SYSTEM_EMAIL, username: SYSTEM_USERNAME, displayName: "CODE WORLD" })
      .returning()
    sysUser = inserted!
  }

  let world = await db.query.worlds.findFirst({
    where: (w, { eq: eqFn }) => eqFn(w.ownerId, sysUser!.id),
  })
  if (!world) {
    const [newWorld] = await db
      .insert(worlds)
      .values({ ownerId: sysUser!.id, name: "CODE WORLD — Shared", isPublic: true })
      .returning()
    world = newWorld!
  }

  return world
}

// GET /worlds/shared — shared world for all players
worldsRouter.get("/shared", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Unauthorized" }, 401)

  const world = await getOrCreateSharedWorld()
  return c.json({ data: world })
})

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

  // Verify world exists
  const world = await db.query.worlds.findFirst({
    where: (w, { eq: eqFn }) => eqFn(w.id, worldId),
  })
  if (!world) {
    return c.json({ error: "World not found" }, 404)
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

// DELETE /worlds/:id/blocks/:blockId — destroy own block
worldsRouter.delete("/:id/blocks/:blockId", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Unauthorized" }, 401)

  const user = await getOrCreateGameUser(session.user)
  const worldId = c.req.param("id")
  const blockId = c.req.param("blockId")

  const block = await db.query.blocks.findFirst({
    where: (b, { and: andFn, eq: eqFn }) =>
      andFn(eqFn(b.id, blockId), eqFn(b.worldId, worldId)),
  })
  if (!block) return c.json({ error: "Block not found" }, 404)
  if (block.placedBy !== user.id) return c.json({ error: "自分が設置したブロックのみ破壊できます" }, 403)

  await db.delete(blocks).where(eq(blocks.id, blockId))
  return c.json({ data: { deleted: true } })
})
