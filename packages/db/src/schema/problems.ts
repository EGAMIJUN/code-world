import { boolean, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { users } from "./users"

export const problemCategoryEnum = pgEnum("problem_category", ["sql", "debug", "design", "review"])
export const problemStatusEnum = pgEnum("problem_status", ["pending", "approved", "rejected"])

export const problems = pgTable("problems", {
  id: uuid("id").primaryKey().defaultRandom(),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  category: problemCategoryEnum("category").notNull(),
  // 0=beginner, 1=elementary, 2=intermediate, 3=advanced
  difficulty: integer("difficulty").notNull(),
  body: jsonb("body").notNull(),
  isOfficial: boolean("is_official").notNull().default(false),
  status: problemStatusEnum("status").notNull().default("pending"),
  playCount: integer("play_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export type Problem = typeof problems.$inferSelect
export type NewProblem = typeof problems.$inferInsert
