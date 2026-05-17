import { z } from "zod"

export const LeaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  playerId: z.string().uuid(),
  username: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  level: z.number().int().nonnegative(),
  totalScore: z.number().int().nonnegative(),
  problemsSolved: z.number().int().nonnegative(),
})

export const LeaderboardSchema = z.object({
  entries: z.array(LeaderboardEntrySchema),
  updatedAt: z.coerce.date(),
})

export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>
export type Leaderboard = z.infer<typeof LeaderboardSchema>
