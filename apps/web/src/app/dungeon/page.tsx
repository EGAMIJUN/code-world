import DungeonSelectClient from "./DungeonSelectClient"

export const metadata = {
  title: "DUNGEON | CODE WORLD",
}

interface DungeonRow {
  id: string
  name: string
  description: string
  language: string
  levelRequired: number
  bossName: string
  bossHp: number
}

async function getDungeons(): Promise<DungeonRow[]> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"
  try {
    const res = await fetch(`${apiUrl}/api/dungeons`, { cache: "no-store" })
    if (!res.ok) return []
    const json = (await res.json()) as { data: DungeonRow[] }
    return json.data
  } catch {
    return []
  }
}

export default async function DungeonPage() {
  const dungeons = await getDungeons()
  return <DungeonSelectClient dungeons={dungeons} />
}
