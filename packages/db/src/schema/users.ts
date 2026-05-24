import { integer, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core"

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  totalKills: integer("total_kills").notNull().default(0),
  totalDeaths: integer("total_deaths").notNull().default(0),
  totalScore: integer("total_score").notNull().default(0),
  maxKillstreak: integer("max_killstreak").notNull().default(0),
  weaponKills: jsonb("weapon_kills").$type<Record<string, number>>().notNull().default({}),
  countryCode: varchar("country_code", { length: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const matches = pgTable("matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  mode: varchar("mode", { length: 32 }).notNull(),
  mapId: varchar("map_id", { length: 32 }).notNull(),
  kills: integer("kills").notNull().default(0),
  deaths: integer("deaths").notNull().default(0),
  score: integer("score").notNull().default(0),
  killstreak: integer("killstreak").notNull().default(0),
  headshots: integer("headshots").notNull().default(0),
  durationSec: integer("duration_sec").notNull().default(0),
  result: varchar("result", { length: 16 }).notNull().default("ended"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Match = typeof matches.$inferSelect
export type NewMatch = typeof matches.$inferInsert
