import { pgEnum, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { users } from "./users"

export const achievementTypeEnum = pgEnum("achievement_type", [
  "first_ac",
  "ten_solved",
  "diamond_block",
  "level_5",
])

export const achievements = pgTable(
  "achievements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    achievementType: achievementTypeEnum("achievement_type").notNull(),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("unique_player_achievement").on(t.playerId, t.achievementType)],
)

export type Achievement = typeof achievements.$inferSelect
export type NewAchievement = typeof achievements.$inferInsert
