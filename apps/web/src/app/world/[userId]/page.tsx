import type { Metadata } from "next"
import { notFound } from "next/navigation"
import ReadonlyWorldClient from "./ReadonlyWorldClient"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

interface WorldOwner {
  id: string
  username: string
  displayName: string | null
}

interface WorldData {
  id: string
  name: string
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ userId: string }>
}): Promise<Metadata> {
  const { userId } = await params
  try {
    const res = await fetch(`${API_URL}/api/worlds/user/${userId}`, { cache: "no-store" })
    if (!res.ok) return { title: "ワールド閲覧 — CODE WORLD" }
    const json = (await res.json()) as { data: { owner: WorldOwner } }
    const name = json.data.owner.displayName ?? json.data.owner.username
    return { title: `${name}のワールド — CODE WORLD` }
  } catch {
    return { title: "ワールド閲覧 — CODE WORLD" }
  }
}

export default async function WorldUserPage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  const { userId } = await params

  let world: WorldData | null = null
  let owner: WorldOwner | null = null

  try {
    const res = await fetch(`${API_URL}/api/worlds/user/${userId}`, { cache: "no-store" })
    if (!res.ok) return notFound()
    const json = (await res.json()) as { data: { world: WorldData; owner: WorldOwner } }
    world = json.data.world
    owner = json.data.owner
  } catch {
    return notFound()
  }

  if (!world || !owner) return notFound()

  return <ReadonlyWorldClient worldId={world.id} owner={owner} />
}
