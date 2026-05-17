import { z } from "zod"

export const AchievementTypeSchema = z.enum(["first_ac", "ten_solved", "diamond_block", "level_5"])

export const AchievementSchema = z.object({
  id: z.string().uuid(),
  achievementType: AchievementTypeSchema,
  unlockedAt: z.coerce.date(),
})

export const ProfileSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  level: z.number().int().nonnegative(),
  xp: z.number().int().nonnegative(),
  problemsSolved: z.number().int().nonnegative(),
  totalSubmissions: z.number().int().nonnegative(),
  correctRate: z.number().min(0).max(100),
  totalBlocks: z.number().int().nonnegative(),
  achievements: z.array(AchievementSchema),
})

export type AchievementType = z.infer<typeof AchievementTypeSchema>
export type Achievement = z.infer<typeof AchievementSchema>
export type Profile = z.infer<typeof ProfileSchema>
