import { z } from "zod"

export const ProblemCategorySchema = z.enum(["sql", "debug", "design", "review", "algorithm"])
export const ProblemStatusSchema = z.enum(["pending", "approved", "rejected"])
export const ProblemDifficultySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
])

export const ProblemBodySchema = z.object({
  description: z.string(),
  setup: z.string().optional(),
  expectedOutput: z.unknown().optional(),
  hints: z.array(
    z.object({
      level: z.number().int().min(1).max(3),
      text: z.string(),
    }),
  ),
  explanation: z.string().optional(),
})

export const ProblemSchema = z.object({
  id: z.string().uuid(),
  authorId: z.string().uuid().nullable(),
  title: z.string().min(1).max(200),
  category: ProblemCategorySchema,
  difficulty: ProblemDifficultySchema,
  body: ProblemBodySchema,
  isOfficial: z.boolean(),
  status: ProblemStatusSchema,
  playCount: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

export const CreateProblemSchema = ProblemSchema.pick({
  title: true,
  category: true,
  difficulty: true,
  body: true,
})

export type ProblemCategory = z.infer<typeof ProblemCategorySchema>
export type ProblemStatus = z.infer<typeof ProblemStatusSchema>
export type ProblemDifficulty = z.infer<typeof ProblemDifficultySchema>
export type Problem = z.infer<typeof ProblemSchema>
export type CreateProblem = z.infer<typeof CreateProblemSchema>
