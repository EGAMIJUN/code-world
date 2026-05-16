import { z } from "zod"

export const WorldSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable(),
  isPublic: z.boolean(),
  population: z.number().int().nonnegative(),
  taxIncome: z.number().int().nonnegative(),
  meta: z.record(z.unknown()).nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

export const CreateWorldSchema = WorldSchema.pick({
  name: true,
  description: true,
  isPublic: true,
})

export type World = z.infer<typeof WorldSchema>
export type CreateWorld = z.infer<typeof CreateWorldSchema>
