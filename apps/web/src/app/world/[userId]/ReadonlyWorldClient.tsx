"use client"

import dynamic from "next/dynamic"

const ReadonlyPhaserGame = dynamic(() => import("./ReadonlyPhaserGame"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center bg-gray-950">
      <div className="text-white text-lg">ロード中...</div>
    </div>
  ),
})

interface Owner {
  id: string
  username: string
  displayName: string | null
}

export default function ReadonlyWorldClient({
  worldId,
  owner,
}: {
  worldId: string
  owner: Owner
}) {
  return <ReadonlyPhaserGame worldId={worldId} owner={owner} />
}
