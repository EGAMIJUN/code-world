import { z } from "zod"
import { ProblemSchema } from "./problem"

export const DungeonLanguageSchema = z.enum(["sql", "python", "javascript", "csharp"])
export const DungeonRoomTypeSchema = z.enum(["minion", "miniboss", "boss"])
export const DungeonRunStatusSchema = z.enum(["in_progress", "completed", "failed"])

export const DungeonSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  language: DungeonLanguageSchema,
  levelRequired: z.number().int().nonnegative(),
  bossName: z.string(),
  bossHp: z.number().int().positive(),
  createdAt: z.coerce.date(),
})

export const DungeonRoomSchema = z.object({
  id: z.string().uuid(),
  dungeonId: z.string().uuid(),
  problemId: z.string().uuid(),
  roomType: DungeonRoomTypeSchema,
  roomOrder: z.number().int().nonnegative(),
})

export const DungeonRoomWithProblemSchema = DungeonRoomSchema.extend({
  problem: ProblemSchema,
})

export const DungeonWithRoomsSchema = DungeonSchema.extend({
  rooms: z.array(DungeonRoomWithProblemSchema),
})

export const DungeonRunSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  dungeonId: z.string().uuid(),
  currentRoomOrder: z.number().int().nonnegative(),
  playerHp: z.number().int(),
  bossHpRemaining: z.number().int(),
  status: DungeonRunStatusSchema,
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
})

export const StartDungeonRunSchema = z.object({
  dungeonId: z.string().uuid(),
})

export const UpdateDungeonRunSchema = z.object({
  playerHp: z.number().int().optional(),
  bossHpRemaining: z.number().int().optional(),
  currentRoomOrder: z.number().int().optional(),
  status: DungeonRunStatusSchema.optional(),
  completedAt: z.coerce.date().optional(),
})

export type DungeonLanguage = z.infer<typeof DungeonLanguageSchema>
export type DungeonRoomType = z.infer<typeof DungeonRoomTypeSchema>
export type DungeonRunStatus = z.infer<typeof DungeonRunStatusSchema>
export type Dungeon = z.infer<typeof DungeonSchema>
export type DungeonRoom = z.infer<typeof DungeonRoomSchema>
export type DungeonRoomWithProblem = z.infer<typeof DungeonRoomWithProblemSchema>
export type DungeonWithRooms = z.infer<typeof DungeonWithRoomsSchema>
export type DungeonRun = z.infer<typeof DungeonRunSchema>
export type StartDungeonRun = z.infer<typeof StartDungeonRunSchema>
export type UpdateDungeonRun = z.infer<typeof UpdateDungeonRunSchema>
