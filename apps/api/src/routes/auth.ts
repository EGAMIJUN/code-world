import { db, users } from "@code-world/db"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import {
  type AuthUser,
  clearSessionCookie,
  createSession,
  deleteSession,
  getAuthUser,
  getSessionToken,
  hashPassword,
  isValidPassword,
  isValidUsername,
  setSessionCookie,
  verifyPassword,
} from "../lib/auth"

export const authRouter = new Hono()

authRouter.post("/signup", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    username?: unknown
    password?: unknown
  } | null
  const username = typeof body?.username === "string" ? body.username : ""
  const password = typeof body?.password === "string" ? body.password : ""

  if (!isValidUsername(username)) {
    return c.json({ error: "ユーザーIDは英数字4〜16文字で入力してください" }, 400)
  }
  if (!isValidPassword(password)) {
    return c.json({ error: "パスワードは8文字以上で入力してください" }, 400)
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1)
  if (existing.length > 0) {
    return c.json({ error: "そのユーザーIDは既に使われています" }, 409)
  }

  const passwordHash = await hashPassword(password)
  const inserted = await db
    .insert(users)
    .values({ username, passwordHash })
    .returning({ id: users.id, username: users.username })
  const user = inserted[0]
  if (!user) {
    return c.json({ error: "登録に失敗しました" }, 500)
  }
  const token = await createSession(user.id)
  setSessionCookie(c, token)
  const authUser: AuthUser = { id: user.id, username: user.username }
  return c.json({ data: { user: authUser } })
})

authRouter.post("/login", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    username?: unknown
    password?: unknown
  } | null
  const username = typeof body?.username === "string" ? body.username : ""
  const password = typeof body?.password === "string" ? body.password : ""

  if (!isValidUsername(username) || !isValidPassword(password)) {
    return c.json({ error: "ユーザーIDまたはパスワードが正しくありません" }, 401)
  }

  const rows = await db
    .select({ id: users.id, username: users.username, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.username, username))
    .limit(1)
  const user = rows[0]
  if (!user) {
    return c.json({ error: "ユーザーIDまたはパスワードが正しくありません" }, 401)
  }
  const ok = await verifyPassword(password, user.passwordHash)
  if (!ok) {
    return c.json({ error: "ユーザーIDまたはパスワードが正しくありません" }, 401)
  }
  const token = await createSession(user.id)
  setSessionCookie(c, token)
  const authUser: AuthUser = { id: user.id, username: user.username }
  return c.json({ data: { user: authUser } })
})

authRouter.post("/logout", async (c) => {
  const token = getSessionToken(c)
  if (token) await deleteSession(token)
  clearSessionCookie(c)
  return c.json({ data: { ok: true } })
})

authRouter.get("/me", async (c) => {
  const user = await getAuthUser(c)
  if (!user) return c.json({ error: "Unauthorized" }, 401)
  return c.json({ data: { user } })
})
