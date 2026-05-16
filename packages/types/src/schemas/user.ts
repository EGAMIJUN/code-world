import { z } from "zod"

export const UserLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
])

export const UserSchema = z.object({
  id: z.string().uuid(),
  githubId: z.string().nullable(),
  email: z.string().email(),
  username: z.string().min(3).max(32),
  displayName: z.string().max(64).nullable(),
  avatarUrl: z.string().url().nullable(),
  level: UserLevelSchema,
  xp: z.number().int().nonnegative(),
  isActive: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

export const CreateUserSchema = UserSchema.pick({
  email: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  githubId: true,
})

export const UpdateUserSchema = UserSchema.pick({
  displayName: true,
  avatarUrl: true,
}).partial()

export type UserLevel = z.infer<typeof UserLevelSchema>
export type User = z.infer<typeof UserSchema>
export type CreateUser = z.infer<typeof CreateUserSchema>
export type UpdateUser = z.infer<typeof UpdateUserSchema>
