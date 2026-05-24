import { db, sessions, users } from "@code-world/db"
import { and, eq, gt } from "drizzle-orm"
import type { Context } from "hono"

const SESSION_COOKIE = "cw_session"
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const USERNAME_RE = /^[a-zA-Z0-9_]{4,16}$/

export interface AuthUser {
  id: string
  username: string
}

export function isValidUsername(u: string): boolean {
  return USERNAME_RE.test(u)
}

export function isValidPassword(p: string): boolean {
  return typeof p === "string" && p.length >= 8 && p.length <= 128
}

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 })
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(password, hash)
  } catch {
    return false
  }
}

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

export async function createSession(userId: string): Promise<string> {
  const token = generateToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.insert(sessions).values({ token, userId, expiresAt })
  return token
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, token))
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const part of header.split(";")) {
    const idx = part.indexOf("=")
    if (idx === -1) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) out[k] = decodeURIComponent(v)
  }
  return out
}

export function getSessionToken(c: Context): string | null {
  const cookies = parseCookies(c.req.header("cookie") ?? null)
  return cookies[SESSION_COOKIE] ?? null
}

export async function getAuthUser(c: Context): Promise<AuthUser | null> {
  const token = getSessionToken(c)
  if (!token) return null
  const rows = await db
    .select({ id: users.id, username: users.username })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1)
  return rows[0] ?? null
}

export function setSessionCookie(c: Context, token: string): void {
  // biome-ignore lint/complexity/useLiteralKeys: bracket notation required per CLAUDE.md
  const secure = process.env["NODE_ENV"] === "production"
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    "HttpOnly",
    `SameSite=${secure ? "None" : "Lax"}`,
  ]
  if (secure) attrs.push("Secure")
  c.header("Set-Cookie", attrs.join("; "), { append: true })
}

export function clearSessionCookie(c: Context): void {
  // biome-ignore lint/complexity/useLiteralKeys: bracket notation required per CLAUDE.md
  const secure = process.env["NODE_ENV"] === "production"
  const attrs = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    `SameSite=${secure ? "None" : "Lax"}`,
  ]
  if (secure) attrs.push("Secure")
  c.header("Set-Cookie", attrs.join("; "), { append: true })
}
