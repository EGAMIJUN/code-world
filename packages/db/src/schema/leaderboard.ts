import { integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core"
import { users } from "./users"

export const leaderboard = pgTable("leaderboard", {
  id: uuid("id").primaryKey().defaultRandom(),
  playerId: uuid("player_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  totalScore: integer("total_score").notNull().default(0),
  problemsSolved: integer("problems_solved").notNull().default(0),
  reviewsGiven: integer("reviews_given").notNull().default(0),
  blocksPlaced: integer("blocks_placed").notNull().default(0),
  rank: integer("rank"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export type Leaderboard = typeof leaderboard.$inferSelect
export type NewLeaderboard = typeof leaderboard.$inferInsert
