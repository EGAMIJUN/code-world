import { integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { problems } from "./problems"
import { users } from "./users"

export const dungeonLanguageEnum = pgEnum("dungeon_language", [
  "sql",
  "python",
  "javascript",
  "csharp",
])

export const dungeonRoomTypeEnum = pgEnum("dungeon_room_type", ["minion", "miniboss", "boss"])

export const dungeonRunStatusEnum = pgEnum("dungeon_run_status", [
  "in_progress",
  "completed",
  "failed",
])

export const dungeons = pgTable("dungeons", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  language: dungeonLanguageEnum("language").notNull(),
  levelRequired: integer("level_required").notNull().default(0),
  bossName: text("boss_name").notNull(),
  bossHp: integer("boss_hp").notNull().default(250),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const dungeonRooms = pgTable("dungeon_rooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  dungeonId: uuid("dungeon_id")
    .notNull()
    .references(() => dungeons.id, { onDelete: "cascade" }),
  problemId: uuid("problem_id")
    .notNull()
    .references(() => problems.id, { onDelete: "cascade" }),
  roomType: dungeonRoomTypeEnum("room_type").notNull().default("minion"),
  roomOrder: integer("room_order").notNull(),
})

export const dungeonRuns = pgTable("dungeon_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  dungeonId: uuid("dungeon_id")
    .notNull()
    .references(() => dungeons.id, { onDelete: "cascade" }),
  currentRoomOrder: integer("current_room_order").notNull().default(0),
  playerHp: integer("player_hp").notNull().default(100),
  bossHpRemaining: integer("boss_hp_remaining").notNull(),
  status: dungeonRunStatusEnum("status").notNull().default("in_progress"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
})

export type Dungeon = typeof dungeons.$inferSelect
export type NewDungeon = typeof dungeons.$inferInsert
export type DungeonRoom = typeof dungeonRooms.$inferSelect
export type NewDungeonRoom = typeof dungeonRooms.$inferInsert
export type DungeonRun = typeof dungeonRuns.$inferSelect
export type NewDungeonRun = typeof dungeonRuns.$inferInsert
