import { z } from "zod"

export const BlockTypeSchema = z.enum([
  "wooden_house",
  "brick_house",
  "commercial_building",
  "power_plant",
  "subway_station",
  "hospital",
  "research_lab",
  "park",
  "road",
])

export const BlockSchema = z.object({
  id: z.string().uuid(),
  worldId: z.string().uuid(),
  placedBy: z.string().uuid(),
  blockType: BlockTypeSchema,
  positionX: z.number().int(),
  positionY: z.number().int(),
  positionZ: z.number().int(),
  meta: z.record(z.unknown()).nullable(),
  placedAt: z.coerce.date(),
})

export const PlaceBlockSchema = z.object({
  worldId: z.string().uuid(),
  blockType: BlockTypeSchema,
  positionX: z.number().int(),
  positionY: z.number().int(),
  positionZ: z.number().int(),
  meta: z.record(z.unknown()).optional(),
})

export type BlockType = z.infer<typeof BlockTypeSchema>
export type Block = z.infer<typeof BlockSchema>
export type PlaceBlock = z.infer<typeof PlaceBlockSchema>
