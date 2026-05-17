import { z } from "zod"

export const CityBlockTypeSchema = z.enum([
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

// Reward blocks earned by solving problems (difficulty-mapped)
export const GameBlockTypeSchema = z.enum([
  "wood_block", // difficulty 0-1 reward
  "stone_block", // difficulty 2 reward
  "diamond_block", // difficulty 3 reward
])

export const BlockTypeSchema = z.union([CityBlockTypeSchema, GameBlockTypeSchema])

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

// Schema for the game world block placement endpoint (worldId comes from URL)
export const PlaceGameBlockSchema = z.object({
  blockType: GameBlockTypeSchema,
  positionX: z.number().int().min(0).max(31),
  positionY: z.number().int().min(0).max(31),
  positionZ: z.number().int().default(0),
  meta: z.record(z.unknown()).optional(),
})

export type CityBlockType = z.infer<typeof CityBlockTypeSchema>
export type GameBlockType = z.infer<typeof GameBlockTypeSchema>
export type BlockType = z.infer<typeof BlockTypeSchema>
export type Block = z.infer<typeof BlockSchema>
export type PlaceBlock = z.infer<typeof PlaceBlockSchema>
export type PlaceGameBlock = z.infer<typeof PlaceGameBlockSchema>
