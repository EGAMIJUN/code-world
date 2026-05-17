import { boolean, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const preferredLanguageEnum = pgEnum("preferred_language", [
  "sql",
  "python",
  "javascript",
  "csharp",
])

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  githubId: text("github_id").unique(),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  level: integer("level").notNull().default(0),
  xp: integer("xp").notNull().default(0),
  hp: integer("hp").notNull().default(100),
  preferredLanguage: preferredLanguageEnum("preferred_language").notNull().default("sql"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
