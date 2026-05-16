import { integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worlds } from "./worlds"

export const blocks = pgTable(
  "blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.id, { onDelete: "cascade" }),
    placedBy: uuid("placed_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockType: text("block_type").notNull(),
    positionX: integer("position_x").notNull(),
    positionY: integer("position_y").notNull(),
    positionZ: integer("position_z").notNull(),
    meta: jsonb("meta"),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("blocks_world_position_unique").on(t.worldId, t.positionX, t.positionY, t.positionZ)],
)

export type Block = typeof blocks.$inferSelect
export type NewBlock = typeof blocks.$inferInsert
