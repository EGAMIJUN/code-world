import { z } from "zod"

export const SubmissionResultSchema = z.enum([
  "pending",
  "accepted",
  "wrong_answer",
  "runtime_error",
  "time_limit_exceeded",
])

export const SubmissionSchema = z.object({
  id: z.string().uuid(),
  playerId: z.string().uuid(),
  problemId: z.string().uuid(),
  code: z.string(),
  result: SubmissionResultSchema,
  score: z.number().int().nonnegative(),
  execTimeMs: z.number().int().nonnegative().nullable(),
  feedback: z.record(z.unknown()).nullable(),
  createdAt: z.coerce.date(),
})

export const CreateSubmissionSchema = z.object({
  problemId: z.string().uuid(),
  code: z.string().min(1).max(50_000),
  language: z.enum(["sql", "python", "javascript", "csharp"]).default("sql"),
})

export type SubmissionResult = z.infer<typeof SubmissionResultSchema>
export type Submission = z.infer<typeof SubmissionSchema>
export type CreateSubmission = z.infer<typeof CreateSubmissionSchema>
