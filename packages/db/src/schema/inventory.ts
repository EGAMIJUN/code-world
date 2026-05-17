import { integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { users } from "./users"

export const inventory = pgTable(
  "inventory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockType: text("block_type").notNull(),
    quantity: integer("quantity").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("inventory_player_block_unique").on(t.playerId, t.blockType)],
)

export type Inventory = typeof inventory.$inferSelect
export type NewInventory = typeof inventory.$inferInsert
