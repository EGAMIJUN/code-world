"use client"

import { useEffect, useRef, useState } from "react"

const TILE_SIZE = 32
const MAP_SIZE = 32
const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

const BLOCK_COLORS: Record<string, number> = {
  wood_block: 0xa0522d,
  stone_block: 0x8a8a8a,
  diamond_block: 0x00cfff,
}

const ZONES = [
  { startCol: 0, endCol: 9, bgColor: 0x0f1f3a },
  { startCol: 10, endCol: 21, bgColor: 0x0f280f },
  { startCol: 22, endCol: 31, bgColor: 0x1e0f3a },
]

interface PlacedBlock {
  id: string
  blockType: string
  positionX: number
  positionY: number
}

interface PhaserGameHandle {
  destroy: (removeCanvas: boolean) => void
}

interface Owner {
  id: string
  username: string
  displayName: string | null
}

export default function ReadonlyPhaserGame({
  worldId,
  owner,
}: {
  worldId: string
  owner: Owner
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const ownerName = owner.displayName ?? owner.username

  useEffect(() => {
    let cancelled = false
    let game: PhaserGameHandle | null = null

    async function initGame() {
      const blocksRes = await fetch(`${API_URL}/api/worlds/${worldId}/blocks`)
      const initialBlocks: PlacedBlock[] = blocksRes.ok
        ? ((await blocksRes.json()) as { data: PlacedBlock[] }).data
        : []

      if (cancelled || !containerRef.current) return
      setIsLoading(false)

      const PhaserModule = await import("phaser")
      const Phaser = PhaserModule.default

      if (cancelled || !containerRef.current) return

      class ViewScene extends Phaser.Scene {
        constructor() {
          super({ key: "ViewScene" })
        }

        create() {
          const W = MAP_SIZE * TILE_SIZE
          const H = MAP_SIZE * TILE_SIZE

          for (const zone of ZONES) {
            const bg = this.add.graphics()
            bg.fillStyle(zone.bgColor)
            bg.fillRect(
              zone.startCol * TILE_SIZE,
              0,
              (zone.endCol - zone.startCol + 1) * TILE_SIZE,
              H,
            )
          }

          const grid = this.add.graphics()
          grid.lineStyle(1, 0xffffff, 0.07)
          for (let x = 0; x <= MAP_SIZE; x++) {
            grid.lineBetween(x * TILE_SIZE, 0, x * TILE_SIZE, H)
          }
          for (let y = 0; y <= MAP_SIZE; y++) {
            grid.lineBetween(0, y * TILE_SIZE, W, y * TILE_SIZE)
          }

          const dividers = this.add.graphics()
          dividers.lineStyle(2, 0xffffff, 0.2)
          dividers.lineBetween(10 * TILE_SIZE, 0, 10 * TILE_SIZE, H)
          dividers.lineBetween(22 * TILE_SIZE, 0, 22 * TILE_SIZE, H)

          const blockLayer = this.add.graphics()
          blockLayer.setDepth(4)

          for (const block of initialBlocks) {
            const color = BLOCK_COLORS[block.blockType] ?? 0x888888
            const x = block.positionX * TILE_SIZE + 2
            const y = block.positionY * TILE_SIZE + 2
            const size = TILE_SIZE - 4
            blockLayer.fillStyle(color)
            blockLayer.fillRect(x, y, size, size)
            blockLayer.fillStyle(0xffffff, 0.18)
            blockLayer.fillRect(x, y, size, Math.floor(size * 0.18))
            blockLayer.fillRect(x, y, Math.floor(size * 0.18), size)
            blockLayer.lineStyle(1, 0x000000, 0.35)
            blockLayer.strokeRect(x, y, size, size)
          }

          this.cameras.main.setBounds(0, 0, W, H)
          this.cameras.main.centerOn(W / 2, H / 2)
        }
      }

      const container = containerRef.current
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: container,
        width: container.clientWidth || 800,
        height: container.clientHeight || 560,
        backgroundColor: "#0a0a0f",
        scene: [ViewScene],
        scale: {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
      }) as PhaserGameHandle
    }

    initGame().catch((err) => {
      console.error("[ReadonlyPhaserGame] init error:", err)
      if (!cancelled) setError("ワールドの読み込みに失敗しました")
    })

    return () => {
      cancelled = true
      if (game) game.destroy(true)
    }
  }, [worldId])

  return (
    <div className="flex flex-col" style={{ height: "100dvh" }}>
      {/* HUD */}
      <div className="flex shrink-0 items-center gap-4 bg-gray-900 border-b border-gray-700 px-4 py-2">
        <a href="/" className="text-white font-bold text-sm tracking-wide shrink-0">
          CODE WORLD
        </a>
        <span className="text-gray-300 text-sm">
          <span className="text-gray-500">閲覧中:</span>{" "}
          <span className="text-violet-400 font-semibold">{ownerName}</span>
          のワールド
        </span>
        <span className="text-gray-600 text-xs hidden sm:block">（読み取り専用）</span>
        <div className="ml-auto flex items-center gap-3">
          <a href="/world" className="text-gray-400 hover:text-gray-200 text-xs">
            自分のワールドへ
          </a>
          <a
            href={`/profile/${owner.id}`}
            className="text-gray-400 hover:text-gray-200 text-xs hidden sm:block"
          >
            プロフィール
          </a>
          <a
            href="/leaderboard"
            className="text-gray-400 hover:text-gray-200 text-xs hidden sm:block"
          >
            ランキング
          </a>
        </div>
      </div>

      {/* Phaser canvas */}
      <div className="relative flex-1 overflow-hidden bg-gray-950">
        <div ref={containerRef} className="w-full h-full" />

        {isLoading && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gray-950">
            <p className="text-white text-lg font-medium">ワールドをロード中...</p>
            <div className="h-1 w-48 overflow-hidden rounded-full bg-gray-700">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-violet-500" />
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gray-950">
            <p className="text-red-400 text-lg">{error}</p>
            <a href="/leaderboard" className="text-gray-400 text-sm hover:text-gray-200 underline">
              ランキングに戻る
            </a>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 bg-gray-900 border-t border-gray-700 px-4 py-2 flex items-center justify-center">
        <span className="text-gray-600 text-xs">
          このワールドは読み取り専用です。ブロックを設置するには
          <a href="/world" className="text-violet-400 hover:text-violet-300 ml-1 underline">
            自分のワールド
          </a>
          へ
        </span>
      </div>
    </div>
  )
}
