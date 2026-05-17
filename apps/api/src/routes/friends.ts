import { db, friendships, users } from "@code-world/db"
import { and, eq, or } from "drizzle-orm"
import { Hono } from "hono"
import { auth } from "../lib/auth"

export const friendsRouter = new Hono()

async function getGameUserId(email: string): Promise<string | null> {
  const user = await db.query.users.findFirst({
    where: (u, { eq: eqFn }) => eqFn(u.email, email),
  })
  return user?.id ?? null
}

// GET /api/friends — list accepted friends
friendsRouter.get("/", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Unauthorized" }, 401)

  const userId = await getGameUserId(session.user.email)
  if (!userId) return c.json({ error: "User not found" }, 404)

  const rows = await db
    .select({
      id: friendships.id,
      status: friendships.status,
      createdAt: friendships.createdAt,
      friendId: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      level: users.level,
    })
    .from(friendships)
    .innerJoin(
      users,
      or(
        and(eq(friendships.requesterId, userId), eq(users.id, friendships.addresseeId)),
        and(eq(friendships.addresseeId, userId), eq(users.id, friendships.requesterId)),
      ),
    )
    .where(
      and(
        eq(friendships.status, "accepted"),
        or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId)),
      ),
    )

  return c.json({ data: rows })
})

// GET /api/friends/pending — incoming friend requests
friendsRouter.get("/pending", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Unauthorized" }, 401)

  const userId = await getGameUserId(session.user.email)
  if (!userId) return c.json({ error: "User not found" }, 404)

  const rows = await db
    .select({
      id: friendships.id,
      requesterId: friendships.requesterId,
      createdAt: friendships.createdAt,
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    })
    .from(friendships)
    .innerJoin(users, eq(users.id, friendships.requesterId))
    .where(and(eq(friendships.addresseeId, userId), eq(friendships.status, "pending")))

  return c.json({ data: rows })
})

// POST /api/friends/request/:userId — send friend request
friendsRouter.post("/request/:userId", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Unauthorized" }, 401)

  const requesterId = await getGameUserId(session.user.email)
  if (!requesterId) return c.json({ error: "User not found" }, 404)

  const addresseeId = c.req.param("userId")
  if (requesterId === addresseeId) return c.json({ error: "Cannot friend yourself" }, 400)

  const addressee = await db.query.users.findFirst({
    where: (u, { eq: eqFn }) => eqFn(u.id, addresseeId),
  })
  if (!addressee) return c.json({ error: "Target user not found" }, 404)

  const existing = await db.query.friendships.findFirst({
    where: (f, { or: orFn, and: andFn, eq: eqFn }) =>
      orFn(
        andFn(eqFn(f.requesterId, requesterId), eqFn(f.addresseeId, addresseeId)),
        andFn(eqFn(f.requesterId, addresseeId), eqFn(f.addresseeId, requesterId)),
      ),
  })
  if (existing) return c.json({ error: "Request already exists" }, 409)

  const [row] = await db
    .insert(friendships)
    .values({ requesterId, addresseeId, status: "pending" })
    .returning()

  return c.json({ data: row }, 201)
})

// POST /api/friends/accept/:userId — accept request from userId
friendsRouter.post("/accept/:userId", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Unauthorized" }, 401)

  const userId = await getGameUserId(session.user.email)
  if (!userId) return c.json({ error: "User not found" }, 404)

  const requesterId = c.req.param("userId")

  const [updated] = await db
    .update(friendships)
    .set({ status: "accepted" })
    .where(
      and(
        eq(friendships.requesterId, requesterId),
        eq(friendships.addresseeId, userId),
        eq(friendships.status, "pending"),
      ),
    )
    .returning()

  if (!updated) return c.json({ error: "Request not found" }, 404)
  return c.json({ data: updated })
})

// DELETE /api/friends/:userId — remove friendship
friendsRouter.delete("/:userId", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Unauthorized" }, 401)

  const userId = await getGameUserId(session.user.email)
  if (!userId) return c.json({ error: "User not found" }, 404)

  const otherId = c.req.param("userId")

  await db
    .delete(friendships)
    .where(
      or(
        and(eq(friendships.requesterId, userId), eq(friendships.addresseeId, otherId)),
        and(eq(friendships.requesterId, otherId), eq(friendships.addresseeId, userId)),
      ),
    )

  return c.json({ data: { ok: true } })
})
