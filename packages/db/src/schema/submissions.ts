import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { problems } from "./problems"
import { users } from "./users"

export const submissionResultEnum = pgEnum("submission_result", [
  "pending",
  "accepted",
  "wrong_answer",
  "runtime_error",
  "time_limit_exceeded",
])

export const submissions = pgTable("submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  playerId: uuid("player_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  problemId: uuid("problem_id")
    .notNull()
    .references(() => problems.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  result: submissionResultEnum("result").notNull().default("pending"),
  score: integer("score").notNull().default(0),
  execTimeMs: integer("exec_time_ms"),
  feedback: jsonb("feedback"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export type Submission = typeof submissions.$inferSelect
export type NewSubmission = typeof submissions.$inferInsert
