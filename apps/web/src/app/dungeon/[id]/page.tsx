import { notFound } from "next/navigation"
import BattleClient from "./BattleClient"

interface ProblemBody {
  description: string
  setup?: string
  hints?: Array<{ level: number; text: string }>
}

interface Problem {
  id: string
  title: string
  category: string
  difficulty: number
  body: ProblemBody
}

interface DungeonRoom {
  id: string
  dungeonId: string
  problemId: string
  roomType: "minion" | "miniboss" | "boss"
  roomOrder: number
  problem: Problem
}

interface DungeonWithRooms {
  id: string
  name: string
  description: string
  language: string
  levelRequired: number
  bossName: string
  bossHp: number
  rooms: DungeonRoom[]
}

async function getDungeon(id: string): Promise<DungeonWithRooms | null> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"
  try {
    const res = await fetch(`${apiUrl}/api/dungeons/${id}`, { cache: "no-store" })
    if (!res.ok) return null
    const json = (await res.json()) as { data: DungeonWithRooms }
    return json.data
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const dungeon = await getDungeon(id)
  return { title: dungeon ? `${dungeon.name} | DUNGEON` : "DUNGEON" }
}

export default async function DungeonBattlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const dungeon = await getDungeon(id)
  if (!dungeon || dungeon.rooms.length === 0) notFound()

  return <BattleClient dungeon={dungeon} />
}
