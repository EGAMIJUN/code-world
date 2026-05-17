import { pgEnum, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { users } from "./users"

export const friendshipStatusEnum = pgEnum("friendship_status", ["pending", "accepted"])

export const friendships = pgTable(
  "friendships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addresseeId: uuid("addressee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: friendshipStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("friendships_unique_pair").on(t.requesterId, t.addresseeId)],
)

export type Friendship = typeof friendships.$inferSelect
export type NewFriendship = typeof friendships.$inferInsert
