"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// ── Constants ──────────────────────────────────────────────────────────────────
const TILE_W = 64
const TILE_H = 32
const BLOCK_H = 24
const MAP_SIZE = 32
const ORIGIN_X = MAP_SIZE * (TILE_W / 2) // 1024 — horizontal center
const ORIGIN_Y = 140

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

// ── Isometric math ─────────────────────────────────────────────────────────────
function isoX(tx: number, ty: number): number {
  return (tx - ty) * (TILE_W / 2) + ORIGIN_X
}
function isoY(tx: number, ty: number): number {
  return (tx + ty) * (TILE_H / 2) + ORIGIN_Y
}
function toTile(canvasX: number, canvasY: number): { tx: number; ty: number } {
  const relX = canvasX - ORIGIN_X
  const relY = canvasY - ORIGIN_Y
  const tx = Math.round((relX / (TILE_W / 2) + relY / (TILE_H / 2)) / 2)
  const ty = Math.round((relY / (TILE_H / 2) - relX / (TILE_W / 2)) / 2)
  return {
    tx: Math.max(0, Math.min(MAP_SIZE - 1, tx)),
    ty: Math.max(0, Math.min(MAP_SIZE - 1, ty)),
  }
}

// ── Zone definitions ───────────────────────────────────────────────────────────
const ZONES = [
  {
    startTX: 0,
    endTX: 9,
    name: "SQL District",
    baseColor: 0x0d2545,
    altColor: 0x0a1d38,
    treeColor: 0x1a3a70,
    labelColor: "#6ab0ff",
  },
  {
    startTX: 10,
    endTX: 21,
    name: "Algorithm Forest",
    baseColor: 0x0d2e13,
    altColor: 0x0a2410,
    treeColor: 0x1a5225,
    labelColor: "#5aef5a",
  },
  {
    startTX: 22,
    endTX: 31,
    name: "System Design City",
    baseColor: 0x1a0d38,
    altColor: 0x150a2e,
    treeColor: 0x3a1a6e,
    labelColor: "#c06aff",
  },
]

function getZone(tx: number) {
  return ZONES.find((z) => tx >= z.startTX && tx <= z.endTX) ?? ZONES[0]!
}

// ── Color helpers ──────────────────────────────────────────────────────────────
function darken(color: number, factor: number): number {
  const r = Math.round(((color >> 16) & 0xff) * factor)
  const g = Math.round(((color >> 8) & 0xff) * factor)
  const b = Math.round((color & 0xff) * factor)
  return (r << 16) | (g << 8) | b
}
function lighten(color: number, factor: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor))
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * factor))
  const b = Math.min(255, Math.round((color & 0xff) * factor))
  return (r << 16) | (g << 8) | b
}

// ── Block definitions ──────────────────────────────────────────────────────────
const BLOCK_COLORS: Record<string, number> = {
  wood_block: 0xa0522d,
  stone_block: 0x7a7a7a,
  diamond_block: 0x00cfff,
}

const BLOCK_INFO: Record<string, { label: string; color: string; icon: string }> = {
  wood_block: { label: "木材ブロック", color: "#a0522d", icon: "🪵" },
  stone_block: { label: "石ブロック", color: "#8a8a8a", icon: "🪨" },
  diamond_block: { label: "ダイヤブロック", color: "#00cfff", icon: "💎" },
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface InventoryItem {
  blockType: string
  quantity: number
}

interface PlacedBlock {
  id: string
  blockType: string
  positionX: number
  positionY: number
}

interface WorldData {
  id: string
  name: string
}

interface PlayerStats {
  level: number
  xp: number
}

interface RemotePlayer {
  username: string
  x: number
  y: number
}

interface ChatMessage {
  id: number
  from: string
  text: string
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  color: number
  size: number
}

// ── XP helper ─────────────────────────────────────────────────────────────────
function computeXpProgress(totalXp: number): {
  level: number
  xpInLevel: number
  xpForNext: number
} {
  let level = 0
  let consumed = 0
  for (;;) {
    const needed = 100 * (level + 1)
    if (consumed + needed > totalXp)
      return { level, xpInLevel: totalXp - consumed, xpForNext: needed }
    consumed += needed
    level++
  }
}

interface PhaserGameHandle {
  destroy: (removeCanvas: boolean) => void
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PhaserGame() {
  const containerRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<PhaserGameHandle | null>(null)
  const selectedBlockRef = useRef<string | null>(null)
  const worldIdRef = useRef<string | null>(null)
  const playerPosRef = useRef<{ x: number; y: number }>({ x: isoX(5, 5), y: isoY(5, 5) })
  const remotePosRef = useRef<Record<string, RemotePlayer>>({})
  const usernameRef = useRef<string>("Player")
  const wsRef = useRef<WebSocket | null>(null)

  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [playerStats, setPlayerStats] = useState<PlayerStats>({ level: 0, xp: 0 })
  const [onlineCount, setOnlineCount] = useState(1)
  const [timeOfDay, setTimeOfDay] = useState<"day" | "dusk" | "night" | "dawn">("day")

  const joystickRef = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 })
  const joyBaseRef = useRef<{ x: number; y: number } | null>(null)
  const joyThumbRef = useRef<HTMLDivElement>(null)
  const msgIdRef = useRef(0)
  const [isMobile, setIsMobile] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState("")
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    selectedBlockRef.current = selectedBlock
  }, [selectedBlock])

  const showNotification = useCallback((msg: string) => {
    setNotification(msg)
    const t = setTimeout(() => setNotification(null), 2500)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    setIsMobile("ontouchstart" in window || navigator.maxTouchPoints > 0)
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [chatMessages])

  const handleJoyStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    const t = e.touches[0]
    if (!t) return
    joyBaseRef.current = { x: t.clientX, y: t.clientY }
  }, [])

  const handleJoyMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    if (!joyBaseRef.current) return
    const t = e.touches[0]
    if (!t) return
    const dx = t.clientX - joyBaseRef.current.x
    const dy = t.clientY - joyBaseRef.current.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    const maxDist = 40
    const clamped = Math.min(dist, maxDist)
    const nx = dist > 0 ? (dx / dist) * clamped : 0
    const ny = dist > 0 ? (dy / dist) * clamped : 0
    joystickRef.current = { vx: nx / maxDist, vy: ny / maxDist }
    if (joyThumbRef.current) {
      joyThumbRef.current.style.transform = `translate(${nx}px, ${ny}px)`
    }
  }, [])

  const handleJoyEnd = useCallback(() => {
    joyBaseRef.current = null
    joystickRef.current = { vx: 0, vy: 0 }
    if (joyThumbRef.current) {
      joyThumbRef.current.style.transform = "translate(0px, 0px)"
    }
  }, [])

  const sendChat = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const text = chatInput.trim()
      if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
      wsRef.current.send(JSON.stringify({ type: "chat", from: usernameRef.current, text }))
      setChatInput("")
    },
    [chatInput],
  )

  const fetchInventory = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/inventory`, { credentials: "include" })
    if (res.ok) {
      const json = (await res.json()) as { data: InventoryItem[] }
      setInventory(json.data)
    }
  }, [])

  const fetchPlayerStats = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/profile/me`, { credentials: "include" })
    if (res.ok) {
      const json = (await res.json()) as { data: { level: number; xp: number } }
      setPlayerStats({ level: json.data.level, xp: json.data.xp })
    }
  }, [])

  const placeBlock = useCallback(
    async (tileX: number, tileY: number, renderFn: (blockType: string) => void) => {
      const blockType = selectedBlockRef.current
      const wId = worldIdRef.current
      if (!blockType || !wId) return

      const res = await fetch(`${API_URL}/api/worlds/${wId}/blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ blockType, positionX: tileX, positionY: tileY, positionZ: 0 }),
      })

      if (res.ok) {
        renderFn(blockType)
        await fetchInventory()
        await fetchPlayerStats()
        showNotification(`${BLOCK_INFO[blockType]?.label ?? blockType} を設置しました！`)
      } else {
        const json = (await res.json()) as { error?: string }
        showNotification(json.error ?? "設置に失敗しました")
      }
    },
    [fetchInventory, fetchPlayerStats, showNotification],
  )

  // ── Phaser init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    let game: PhaserGameHandle | null = null

    async function initGame() {
      const worldRes = await fetch(`${API_URL}/api/worlds/my`, { credentials: "include" })
      if (!worldRes.ok) {
        if (!cancelled)
          setError(worldRes.status === 401 ? "ログインが必要です" : "ワールドの取得に失敗しました")
        return
      }
      const worldJson = (await worldRes.json()) as { data: WorldData }
      const world = worldJson.data
      worldIdRef.current = world.id

      const blocksRes = await fetch(`${API_URL}/api/worlds/${world.id}/blocks`, {
        credentials: "include",
      })
      const initialBlocks: PlacedBlock[] = blocksRes.ok
        ? ((await blocksRes.json()) as { data: PlacedBlock[] }).data
        : []

      const invRes = await fetch(`${API_URL}/api/inventory`, { credentials: "include" })
      if (invRes.ok && !cancelled) {
        const invJson = (await invRes.json()) as { data: InventoryItem[] }
        setInventory(invJson.data)
      }

      const statsRes = await fetch(`${API_URL}/api/profile/me`, { credentials: "include" })
      if (statsRes.ok && !cancelled) {
        const statsJson = (await statsRes.json()) as {
          data: { level: number; xp: number; username: string }
        }
        setPlayerStats({ level: statsJson.data.level, xp: statsJson.data.xp })
        usernameRef.current = statsJson.data.username
      }

      if (cancelled || !containerRef.current) return
      setIsLoading(false)

      const PhaserModule = await import("phaser")
      const Phaser = PhaserModule.default

      if (cancelled || !containerRef.current) return

      // ── World Scene ──────────────────────────────────────────────────────────
      class WorldScene extends Phaser.Scene {
        // Terrain
        private terrainG!: Phaser.GameObjects.Graphics
        // Blocks: keyed by "tx,ty"
        private blockObjects = new Map<string, Phaser.GameObjects.Graphics>()
        // Player
        private playerX = isoX(5, 5)
        private playerY = isoY(5, 5)
        private playerG!: Phaser.GameObjects.Graphics
        private walkCycle = 0
        // Particles
        private particles: Particle[] = []
        private particleG!: Phaser.GameObjects.Graphics
        // Hover
        private hoverG!: Phaser.GameObjects.Graphics
        // Day/night
        private nightOverlay!: Phaser.GameObjects.Graphics
        private dayTime = 0
        // Minimap
        private minimapG!: Phaser.GameObjects.Graphics
        private minimapLabel!: Phaser.GameObjects.Text
        // Remote players
        private remoteSprites = new Map<
          string,
          { g: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text }
        >()
        // Input
        private keys!: {
          W: Phaser.Input.Keyboard.Key
          A: Phaser.Input.Keyboard.Key
          S: Phaser.Input.Keyboard.Key
          D: Phaser.Input.Keyboard.Key
          UP: Phaser.Input.Keyboard.Key
          LEFT: Phaser.Input.Keyboard.Key
          DOWN: Phaser.Input.Keyboard.Key
          RIGHT: Phaser.Input.Keyboard.Key
        }
        // Follow target
        private followTarget!: Phaser.GameObjects.Rectangle

        constructor() {
          super({ key: "WorldScene" })
        }

        // ── create ──────────────────────────────────────────────────────────────
        create() {
          const WORLD_W = ORIGIN_X * 2 + TILE_W + 100
          const WORLD_H = ORIGIN_Y + MAP_SIZE * TILE_H + BLOCK_H * 4 + 100

          // ── Ground tiles (back→front render order) ───────────────────────────
          this.terrainG = this.add.graphics()
          this.terrainG.setDepth(0)

          for (let s = 0; s <= (MAP_SIZE - 1) * 2; s++) {
            for (let tx = 0; tx < MAP_SIZE; tx++) {
              const ty = s - tx
              if (ty < 0 || ty >= MAP_SIZE) continue
              this.drawTile(this.terrainG, tx, ty)
            }
          }

          // ── Zone border lines ────────────────────────────────────────────────
          const divG = this.add.graphics()
          divG.setDepth(1)
          divG.lineStyle(2, 0xffffff, 0.12)
          // Divider at tx=10 and tx=22 (run along ty axis)
          for (const borderTX of [10, 22]) {
            divG.beginPath()
            divG.moveTo(isoX(borderTX, 0) - TILE_W / 2, isoY(borderTX, 0))
            divG.lineTo(isoX(borderTX, MAP_SIZE - 1) - TILE_W / 2, isoY(borderTX, MAP_SIZE - 1))
            divG.strokePath()
          }

          // ── Zone labels ──────────────────────────────────────────────────────
          for (const zone of ZONES) {
            const midTX = Math.floor((zone.startTX + zone.endTX) / 2)
            const midTY = Math.floor(MAP_SIZE / 2)
            const lx = isoX(midTX, midTY)
            const ly = isoY(midTX, midTY) - 45
            this.add
              .text(lx, ly, zone.name, {
                fontSize: "13px",
                color: zone.labelColor,
                fontStyle: "bold",
                shadow: { color: "#000000", blur: 6, fill: true },
              })
              .setOrigin(0.5, 1)
              .setDepth(5)
              .setAlpha(0.9)
          }

          // ── Initial blocks ───────────────────────────────────────────────────
          for (const block of initialBlocks) {
            this.spawnBlock(block.positionX, block.positionY, block.blockType)
          }

          // ── Hover graphic ────────────────────────────────────────────────────
          this.hoverG = this.add.graphics()
          this.hoverG.setDepth(500)
          this.hoverG.setVisible(false)

          // ── Player ───────────────────────────────────────────────────────────
          this.playerG = this.add.graphics()
          this.playerG.setDepth(300)

          // Follow target for smooth camera
          this.followTarget = this.add.rectangle(this.playerX, this.playerY, 1, 1, 0x000000, 0)
          this.cameras.main.startFollow(this.followTarget, false, 0.08, 0.08)
          this.cameras.main.setBounds(-TILE_W * 2, -TILE_H * 2, WORLD_W, WORLD_H)

          // ── Particle graphic ─────────────────────────────────────────────────
          this.particleG = this.add.graphics()
          this.particleG.setDepth(400)

          // ── Night overlay (fixed to screen) ──────────────────────────────────
          this.nightOverlay = this.add.graphics()
          this.nightOverlay.setScrollFactor(0)
          this.nightOverlay.setDepth(1000)
          this.refreshOverlay()

          // ── Minimap ──────────────────────────────────────────────────────────
          this.minimapG = this.add.graphics()
          this.minimapG.setScrollFactor(0)
          this.minimapG.setDepth(1100)
          this.minimapLabel = this.add
            .text(0, 0, "", { fontSize: "7px", color: "#999999" })
            .setScrollFactor(0)
            .setDepth(1101)

          // ── Input ────────────────────────────────────────────────────────────
          const kb = this.input.keyboard!
          this.keys = {
            W: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
            A: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
            S: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
            D: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
            UP: kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
            LEFT: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
            DOWN: kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
            RIGHT: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
          }

          // ── Hover highlight ──────────────────────────────────────────────────
          this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
            if (!selectedBlockRef.current) {
              this.hoverG.setVisible(false)
              return
            }
            const wx = this.cameras.main.scrollX + pointer.x
            const wy = this.cameras.main.scrollY + pointer.y
            const { tx, ty } = toTile(wx, wy)
            const color = BLOCK_COLORS[selectedBlockRef.current] ?? 0xffffff
            this.hoverG.clear()
            this.drawBlockHover(this.hoverG, isoX(tx, ty), isoY(tx, ty), color)
            this.hoverG.setVisible(true)
          })

          // ── Click to place ───────────────────────────────────────────────────
          this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            if (!selectedBlockRef.current) return
            const wx = this.cameras.main.scrollX + pointer.x
            const wy = this.cameras.main.scrollY + pointer.y
            const { tx, ty } = toTile(wx, wy)

            placeBlock(tx, ty, (blockType) => {
              this.spawnBlock(tx, ty, blockType)
              this.emitGoldBurst(isoX(tx, ty), isoY(tx, ty) - BLOCK_H)
            }).catch(() => {})
          })

          // Resize: refresh overlay
          this.scale.on("resize", () => this.refreshOverlay())

          // Spawn welcome burst
          this.emitGoldBurst(this.playerX, this.playerY - BLOCK_H, 15)
        }

        // ── Draw ground tile (isometric diamond) ─────────────────────────────
        drawTile(g: Phaser.GameObjects.Graphics, tx: number, ty: number) {
          const zone = getZone(tx)
          const cx = isoX(tx, ty)
          const cy = isoY(tx, ty)
          const isAlt = (tx + ty) % 2 === 0
          const baseColor = isAlt ? zone.baseColor : zone.altColor

          g.fillStyle(baseColor)
          g.beginPath()
          g.moveTo(cx, cy - TILE_H / 2)
          g.lineTo(cx + TILE_W / 2, cy)
          g.lineTo(cx, cy + TILE_H / 2)
          g.lineTo(cx - TILE_W / 2, cy)
          g.closePath()
          g.fillPath()

          // Subtle edge shading
          g.lineStyle(0.5, isAlt ? lighten(baseColor, 1.4) : 0xffffff, 0.06)
          g.beginPath()
          g.moveTo(cx, cy - TILE_H / 2)
          g.lineTo(cx + TILE_W / 2, cy)
          g.strokePath()

          // Algorithm Forest: occasional tree decoration
          if (zone.name === "Algorithm Forest" && (tx * 7 + ty * 13) % 11 < 2) {
            this.drawTreeDecal(g, cx, cy, zone)
          }
          // System Design City: road lines on even tiles
          if (zone.name === "System Design City" && tx % 3 === 0 && ty % 3 === 0) {
            g.lineStyle(1, 0x6040a0, 0.25)
            g.beginPath()
            g.moveTo(cx - TILE_W / 4, cy - TILE_H / 4)
            g.lineTo(cx + TILE_W / 4, cy + TILE_H / 4)
            g.strokePath()
          }
        }

        drawTreeDecal(
          g: Phaser.GameObjects.Graphics,
          cx: number,
          cy: number,
          zone: (typeof ZONES)[number],
        ) {
          g.fillStyle(zone.treeColor, 0.7)
          g.fillTriangle(
            cx,
            cy - TILE_H * 1.2,
            cx - 6,
            cy - TILE_H * 0.5,
            cx + 6,
            cy - TILE_H * 0.5,
          )
          g.fillStyle(darken(zone.treeColor, 0.6), 0.7)
          g.fillRect(cx - 2, cy - TILE_H * 0.5, 4, 5)
        }

        // ── Spawn 3D isometric block ─────────────────────────────────────────
        spawnBlock(tx: number, ty: number, blockType: string) {
          const key = `${tx},${ty}`
          const existing = this.blockObjects.get(key)
          if (existing) existing.destroy()

          const g = this.add.graphics()
          g.setDepth((tx + ty) * 100 + 10)
          this.drawIsoBlock(g, isoX(tx, ty), isoY(tx, ty), BLOCK_COLORS[blockType] ?? 0x888888)
          this.blockObjects.set(key, g)
        }

        // ── Isometric 3D block: top + left + right faces ─────────────────────
        drawIsoBlock(g: Phaser.GameObjects.Graphics, cx: number, cy: number, base: number) {
          const top = lighten(base, 1.15)
          const left = darken(base, 0.68)
          const right = darken(base, 0.45)

          // Right face
          g.fillStyle(right)
          g.beginPath()
          g.moveTo(cx, cy + TILE_H / 2 - BLOCK_H)
          g.lineTo(cx + TILE_W / 2, cy - BLOCK_H)
          g.lineTo(cx + TILE_W / 2, cy)
          g.lineTo(cx, cy + TILE_H / 2)
          g.closePath()
          g.fillPath()

          // Left face
          g.fillStyle(left)
          g.beginPath()
          g.moveTo(cx - TILE_W / 2, cy - BLOCK_H)
          g.lineTo(cx, cy + TILE_H / 2 - BLOCK_H)
          g.lineTo(cx, cy + TILE_H / 2)
          g.lineTo(cx - TILE_W / 2, cy)
          g.closePath()
          g.fillPath()

          // Top face
          g.fillStyle(top)
          g.beginPath()
          g.moveTo(cx, cy - TILE_H / 2 - BLOCK_H)
          g.lineTo(cx + TILE_W / 2, cy - BLOCK_H)
          g.lineTo(cx, cy + TILE_H / 2 - BLOCK_H)
          g.lineTo(cx - TILE_W / 2, cy - BLOCK_H)
          g.closePath()
          g.fillPath()

          // Top edge highlight
          g.lineStyle(1, 0xffffff, 0.25)
          g.beginPath()
          g.moveTo(cx, cy - TILE_H / 2 - BLOCK_H)
          g.lineTo(cx + TILE_W / 2, cy - BLOCK_H)
          g.moveTo(cx, cy - TILE_H / 2 - BLOCK_H)
          g.lineTo(cx - TILE_W / 2, cy - BLOCK_H)
          g.strokePath()
        }

        // ── Hover outline for block placement ────────────────────────────────
        drawBlockHover(g: Phaser.GameObjects.Graphics, cx: number, cy: number, color: number) {
          const pulse = 0.35 + Math.sin(this.time.now * 0.005) * 0.1
          g.fillStyle(color, pulse * 0.5)
          g.beginPath()
          g.moveTo(cx, cy - TILE_H / 2 - BLOCK_H)
          g.lineTo(cx + TILE_W / 2, cy - BLOCK_H)
          g.lineTo(cx, cy + TILE_H / 2 - BLOCK_H)
          g.lineTo(cx - TILE_W / 2, cy - BLOCK_H)
          g.closePath()
          g.fillPath()
          g.lineStyle(2, color, 0.8)
          g.strokePath()
        }

        // ── Gold burst particles ─────────────────────────────────────────────
        emitGoldBurst(cx: number, cy: number, count = 24) {
          for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2
            const speed = 1.5 + Math.random() * 4
            this.particles.push({
              x: cx,
              y: cy,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed - 2.5,
              life: 1,
              maxLife: 1,
              color: [0xffd700, 0xffa500, 0xffec5e][Math.floor(Math.random() * 3)] ?? 0xffd700,
              size: 2 + Math.random() * 4,
            })
          }
        }

        // ── Footstep dust ────────────────────────────────────────────────────
        private footstepTimer = 0
        emitFootstep(cx: number, cy: number) {
          this.particles.push({
            x: cx + (Math.random() - 0.5) * 10,
            y: cy + (Math.random() - 0.5) * 4,
            vx: (Math.random() - 0.5) * 0.6,
            vy: -Math.random() * 0.4,
            life: 0.4,
            maxLife: 0.4,
            color: 0x665544,
            size: 1.5 + Math.random() * 2,
          })
        }

        // ── Player character drawing ─────────────────────────────────────────
        drawPlayer(g: Phaser.GameObjects.Graphics, x: number, y: number, moving: boolean) {
          g.clear()
          const bob = moving ? Math.sin(this.walkCycle * 10) * 2 : 0
          const legSwing = moving ? Math.sin(this.walkCycle * 10) * 3 : 0

          // Shadow ellipse on ground
          g.fillStyle(0x000000, 0.3)
          g.fillEllipse(x, y + TILE_H / 2 - 2, 28, 10)

          // Body
          g.fillStyle(0xffcc00)
          g.fillEllipse(x, y - BLOCK_H + bob, 20, 22)

          // Shirt stripe
          g.fillStyle(0xdd9900)
          g.fillRect(x - 7, y - BLOCK_H + 2 + bob, 14, 5)

          // Legs
          g.fillStyle(0x334477)
          g.fillRect(x - 6 + legSwing, y - BLOCK_H + 10 + bob, 5, 8)
          g.fillRect(x + 1 - legSwing, y - BLOCK_H + 10 + bob, 5, 8)

          // Head
          g.fillStyle(0xffd5a0)
          g.fillEllipse(x, y - BLOCK_H - 14 + bob, 14, 14)

          // Eyes (always facing camera-right)
          g.fillStyle(0x222233)
          g.fillCircle(x + 2, y - BLOCK_H - 14 + bob, 1.8)
          g.fillCircle(x - 2, y - BLOCK_H - 14 + bob, 1.8)

          // Outline
          g.lineStyle(1, 0x000000, 0.4)
          g.strokeEllipse(x, y - BLOCK_H + bob, 20, 22)
          g.strokeEllipse(x, y - BLOCK_H - 14 + bob, 14, 14)
        }

        // ── Night overlay (full-screen) ──────────────────────────────────────
        refreshOverlay() {
          this.nightOverlay.clear()
          this.nightOverlay.fillStyle(0x05051a)
          this.nightOverlay.fillRect(0, 0, this.scale.width, this.scale.height)
        }

        // ── Minimap ──────────────────────────────────────────────────────────
        drawMinimap(playerTX: number, playerTY: number) {
          const g = this.minimapG
          g.clear()
          const W = this.scale.width
          const mmW = 110
          const mmH = 56
          const mmX = W - mmW - 8
          const mmY = 8
          const sx = mmW / MAP_SIZE
          const sy = mmH / MAP_SIZE

          // Background
          g.fillStyle(0x000000, 0.75)
          g.fillRoundedRect(mmX - 2, mmY - 2, mmW + 4, mmH + 4, 4)
          g.lineStyle(1, 0x333355)
          g.strokeRoundedRect(mmX - 2, mmY - 2, mmW + 4, mmH + 4, 4)

          // Zone bands
          for (const zone of ZONES) {
            const zx = mmX + zone.startTX * sx
            const zw = (zone.endTX - zone.startTX + 1) * sx
            g.fillStyle(zone.baseColor, 0.9)
            g.fillRect(zx, mmY, zw, mmH)
          }

          // Blocks
          for (const [key] of this.blockObjects) {
            const [btx, bty] = key.split(",").map(Number)
            g.fillStyle(0xffffff, 0.6)
            g.fillRect(
              mmX + btx! * sx,
              mmY + bty! * sy,
              Math.max(1, sx - 0.5),
              Math.max(1, sy - 0.5),
            )
          }

          // Player dot (yellow)
          g.fillStyle(0xffff00)
          g.fillCircle(mmX + playerTX * sx + sx / 2, mmY + playerTY * sy + sy / 2, 2.5)

          // Border
          g.lineStyle(1, 0x444466, 0.8)
          g.strokeRect(mmX, mmY, mmW, mmH)

          // Label
          this.minimapLabel.setPosition(mmX, mmY + mmH + 3)
          this.minimapLabel.setText("MAP")
        }

        // ── update ──────────────────────────────────────────────────────────
        override update(_time: number, delta: number) {
          const dt = delta / 1000
          const speed = 130

          let vx = 0
          let vy = 0
          if (this.keys.A.isDown || this.keys.LEFT.isDown) vx = -speed
          if (this.keys.D.isDown || this.keys.RIGHT.isDown) vx = speed
          if (this.keys.W.isDown || this.keys.UP.isDown) vy = -speed
          if (this.keys.S.isDown || this.keys.DOWN.isDown) vy = speed
          if (vx !== 0 && vy !== 0) {
            vx *= 0.707
            vy *= 0.707
          }

          // Joystick (touch) input — overrides keyboard when active
          const joy = joystickRef.current
          if (joy.vx !== 0 || joy.vy !== 0) {
            vx = joy.vx * speed
            vy = joy.vy * speed
          }

          this.playerX += vx * dt
          this.playerY += vy * dt

          // Clamp to world
          const minX = isoX(0, MAP_SIZE - 1) + TILE_W / 2
          const maxX = isoX(MAP_SIZE - 1, 0) - TILE_W / 2
          const minY = ORIGIN_Y
          const maxY = isoY(MAP_SIZE - 1, MAP_SIZE - 1)
          this.playerX = Phaser.Math.Clamp(this.playerX, minX, maxX)
          this.playerY = Phaser.Math.Clamp(this.playerY, minY, maxY)

          const moving = Math.abs(vx) > 0 || Math.abs(vy) > 0
          if (moving) this.walkCycle += dt

          // Footstep particles
          if (moving) {
            this.footstepTimer += dt
            if (this.footstepTimer > 0.18) {
              this.footstepTimer = 0
              this.emitFootstep(this.playerX, this.playerY + TILE_H / 4)
            }
          }

          // Follow target
          this.followTarget.setPosition(this.playerX, this.playerY)

          // Player depth based on tile
          const { tx: ptx, ty: pty } = toTile(this.playerX, this.playerY)
          this.playerG.setDepth((ptx + pty) * 100 + 50)
          this.drawPlayer(this.playerG, this.playerX, this.playerY, moving)

          // ── Particles ──────────────────────────────────────────────────────
          this.particleG.clear()
          this.particles = this.particles.filter((p) => p.life > 0)
          for (const p of this.particles) {
            p.x += p.vx
            p.y += p.vy
            p.vy += 0.1
            p.life -= dt * 1.8
            const a = Math.max(0, p.life / p.maxLife)
            this.particleG.fillStyle(p.color, a)
            this.particleG.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)
          }

          // ── Day/night cycle (120s) ─────────────────────────────────────────
          this.dayTime += dt
          const cycle = (this.dayTime % 120) / 120
          let nightAlpha = 0
          let tod: "day" | "dusk" | "night" | "dawn" = "day"
          if (cycle < 0.38) {
            nightAlpha = 0
            tod = "day"
          } else if (cycle < 0.5) {
            nightAlpha = ((cycle - 0.38) / 0.12) * 0.5
            tod = "dusk"
          } else if (cycle < 0.88) {
            nightAlpha = 0.5
            tod = "night"
          } else {
            nightAlpha = ((1 - cycle) / 0.12) * 0.5
            tod = "dawn"
          }
          this.nightOverlay.setAlpha(nightAlpha)
          setTimeOfDay(tod)

          // ── Minimap ────────────────────────────────────────────────────────
          this.drawMinimap(ptx, pty)

          // ── Remote players ─────────────────────────────────────────────────
          const snapshot = remotePosRef.current
          const liveIds = new Set(Object.keys(snapshot))

          for (const [id, obj] of this.remoteSprites) {
            if (!liveIds.has(id)) {
              obj.g.destroy()
              obj.label.destroy()
              this.remoteSprites.delete(id)
            }
          }

          for (const [id, pos] of Object.entries(snapshot)) {
            const { tx: rtx, ty: rty } = toTile(pos.x, pos.y)
            const depth = (rtx + rty) * 100 + 45
            const existing = this.remoteSprites.get(id)
            if (existing) {
              existing.g.clear()
              this.drawPlayer(existing.g, pos.x, pos.y, false)
              existing.g.setDepth(depth)
              existing.label.setPosition(pos.x, pos.y - BLOCK_H - 22)
              existing.label.setDepth(depth + 1)
            } else {
              const g = this.add.graphics()
              g.setDepth(depth)
              this.drawPlayer(g, pos.x, pos.y, false)
              const label = this.add.text(pos.x, pos.y - BLOCK_H - 22, pos.username, {
                fontSize: "9px",
                color: "#00ff88",
                backgroundColor: "#000000aa",
                padding: { x: 3, y: 1 },
              })
              label.setOrigin(0.5, 1).setDepth(depth + 1)
              this.remoteSprites.set(id, { g, label })
            }
          }

          // Expose player position for WebSocket
          playerPosRef.current = { x: this.playerX, y: this.playerY }
        }
      }

      const container = containerRef.current
      if (!container) return

      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: container,
        width: container.clientWidth || 800,
        height: container.clientHeight || 560,
        backgroundColor: "#0a0a0f",
        scene: [WorldScene],
        scale: {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        render: {
          antialias: false,
          pixelArt: false,
        },
      }) as PhaserGameHandle

      gameRef.current = game
    }

    initGame().catch((err) => {
      console.error("[PhaserGame] init error:", err)
      if (!cancelled) setError("ゲームの初期化に失敗しました")
    })

    return () => {
      cancelled = true
      if (game) {
        game.destroy(true)
        gameRef.current = null
      }
    }
  }, [placeBlock])

  // ESC deselects block
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedBlock(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // WebSocket position sync
  useEffect(() => {
    if (isLoading) return

    const WS_URL = (process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001").replace(
      /^http/,
      "ws",
    )
    const ws = new WebSocket(`${WS_URL}/ws`)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "join",
          worldId: worldIdRef.current,
          username: usernameRef.current,
          x: playerPosRef.current.x,
          y: playerPosRef.current.y,
        }),
      )
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          type: string
          players?: Record<string, RemotePlayer>
          from?: string
          text?: string
        }
        if (msg.type === "sync" && msg.players) {
          remotePosRef.current = msg.players
          setOnlineCount(Object.keys(msg.players).length + 1)
        } else if (msg.type === "chat" && msg.text) {
          setChatMessages((prev) => {
            const next = [
              ...prev,
              { id: ++msgIdRef.current, from: msg.from ?? "?", text: msg.text ?? "" },
            ]
            return next.slice(-20)
          })
        }
      } catch {
        // ignore
      }
    }

    ws.onclose = () => {
      remotePosRef.current = {}
      setOnlineCount(1)
    }

    const moveInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "move",
            x: playerPosRef.current.x,
            y: playerPosRef.current.y,
          }),
        )
      }
    }, 100)

    return () => {
      clearInterval(moveInterval)
      ws.close()
      wsRef.current = null
      remotePosRef.current = {}
    }
  }, [isLoading])

  // ── HUD rendering ────────────────────────────────────────────────────────────
  const { level, xpInLevel, xpForNext } = computeXpProgress(playerStats.xp)
  const xpPct = xpForNext > 0 ? Math.round((xpInLevel / xpForNext) * 100) : 0

  const TOD_ICONS: Record<typeof timeOfDay, string> = {
    day: "☀️",
    dusk: "🌅",
    night: "🌙",
    dawn: "🌄",
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: "#000000",
        fontFamily: "monospace",
        color: "#00ff41",
      }}
    >
      {/* ── Matrix HUD ────────────────────────────────────────────────────────── */}
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          padding: "0.5rem 1rem",
          background: "#000000",
          borderBottom: "1px solid #003300",
        }}
      >
        {/* Level badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            flexShrink: 0,
            border: "1px solid #003300",
            padding: "0.25rem 0.75rem",
          }}
        >
          <span style={{ color: "#00ff41", fontSize: "0.75rem", letterSpacing: "0.15em" }}>
            LV.{level}
          </span>
          <div
            style={{
              width: "80px",
              height: "6px",
              background: "#001100",
              border: "1px solid #003300",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${xpPct}%`,
                background: "#00ff41",
                boxShadow: "0 0 6px #00ff41",
                transition: "width 0.7s ease",
              }}
            />
          </div>
          <span style={{ color: "#005500", fontSize: "0.7rem" }}>
            {xpInLevel}/{xpForNext}
          </span>
        </div>

        {/* Controls hint */}
        <span
          style={{ color: "#003300", fontSize: "0.7rem", letterSpacing: "0.1em", flexShrink: 0 }}
          className="hidden sm:block"
        >
          WASD: MOVE &nbsp;·&nbsp; CLICK: PLACE
        </span>

        <div style={{ flex: 1 }} />

        {/* Time of day */}
        <span style={{ fontSize: "0.75rem", flexShrink: 0 }} title={timeOfDay}>
          {TOD_ICONS[timeOfDay]}
        </span>

        {/* Online count */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
          <span
            style={{
              height: "6px",
              width: "6px",
              borderRadius: "50%",
              background: "#00ff41",
              boxShadow: "0 0 6px #00ff41",
              display: "inline-block",
            }}
          />
          <span style={{ color: "#00ff41", fontSize: "0.7rem", letterSpacing: "0.1em" }}>
            {onlineCount} ONLINE
          </span>
        </div>

        {/* Notification */}
        {notification && (
          <span
            style={{
              flexShrink: 0,
              fontSize: "0.75rem",
              letterSpacing: "0.1em",
              color: "#00ff41",
              border: "1px solid #00ff41",
              padding: "0.2rem 0.75rem",
              textShadow: "0 0 8px #00ff41",
            }}
          >
            ✓ {notification}
          </span>
        )}
      </div>

      {/* ── Phaser canvas area ───────────────────────────────────────────────── */}
      <div style={{ position: "relative", flex: 1, overflow: "hidden", background: "#000000" }}>
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

        {isLoading && !error && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "1.5rem",
              background: "#000000",
              fontFamily: "monospace",
            }}
          >
            <div
              style={{
                color: "#00ff41",
                fontSize: "1.1rem",
                letterSpacing: "0.3em",
                textShadow: "0 0 20px #00ff41",
              }}
            >
              LOADING WORLD...
            </div>
            <div
              style={{
                width: "208px",
                height: "4px",
                background: "#001100",
                border: "1px solid #003300",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: "65%",
                  background: "#00ff41",
                  boxShadow: "0 0 8px #00ff41",
                  animation: "matrixPulse 1.2s ease-in-out infinite alternate",
                }}
              />
            </div>
            <style>{`
              @keyframes matrixPulse {
                from { opacity: 0.4; }
                to { opacity: 1; }
              }
            `}</style>
          </div>
        )}

        {error && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "1.5rem",
              background: "#000000",
              fontFamily: "monospace",
            }}
          >
            <p style={{ color: "#ff3333", fontSize: "1rem", letterSpacing: "0.2em" }}>⚠ {error}</p>
            <a
              href="/login"
              style={{
                color: "#00ff41",
                border: "1px solid #00ff41",
                padding: "0.5rem 1.5rem",
                textDecoration: "none",
                fontSize: "0.85rem",
                letterSpacing: "0.2em",
              }}
            >
              ▶ LOGIN
            </a>
            <a
              href="/problems"
              style={{
                color: "#005500",
                fontSize: "0.8rem",
                letterSpacing: "0.1em",
                textDecoration: "underline",
              }}
            >
              SOLVE PROBLEMS →
            </a>
          </div>
        )}

        {/* ── Virtual joystick ─────────────────────────────────────────────── */}
        {isMobile && !isLoading && !error && (
          <div
            style={{
              position: "absolute",
              bottom: "1rem",
              left: "1rem",
              width: "96px",
              height: "96px",
              borderRadius: "50%",
              background: "rgba(0,255,65,0.08)",
              border: "2px solid rgba(0,255,65,0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              touchAction: "none",
              zIndex: 20,
              userSelect: "none",
            }}
            onTouchStart={handleJoyStart}
            onTouchMove={handleJoyMove}
            onTouchEnd={handleJoyEnd}
          >
            <div
              ref={joyThumbRef}
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "50%",
                background: "rgba(0,255,65,0.35)",
                border: "1px solid #00ff41",
                boxShadow: "0 0 8px rgba(0,255,65,0.4)",
                pointerEvents: "none",
              }}
            />
          </div>
        )}

        {/* ── World chat ───────────────────────────────────────────────────── */}
        {!isLoading && !error && (
          <div
            style={{
              position: "absolute",
              bottom: "1rem",
              left: isMobile ? "7.5rem" : "1rem",
              width: "220px",
              zIndex: 20,
              fontFamily: "monospace",
              display: "flex",
              flexDirection: "column",
              gap: "4px",
            }}
          >
            <div
              style={{
                maxHeight: "120px",
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: "2px",
              }}
            >
              {chatMessages.map((m) => (
                <div
                  key={m.id}
                  style={{
                    fontSize: "0.68rem",
                    color: "#00ff41",
                    background: "rgba(0,0,0,0.75)",
                    padding: "2px 6px",
                    letterSpacing: "0.04em",
                    wordBreak: "break-all",
                    lineHeight: 1.4,
                  }}
                >
                  <span style={{ color: "#005500" }}>{m.from}: </span>
                  {m.text}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={sendChat} style={{ display: "flex", gap: "4px" }}>
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="CHAT..."
                maxLength={100}
                style={{
                  flex: 1,
                  background: "rgba(0,0,0,0.8)",
                  border: "1px solid #003300",
                  color: "#00ff41",
                  fontFamily: "monospace",
                  fontSize: "0.68rem",
                  padding: "3px 6px",
                  outline: "none",
                  letterSpacing: "0.05em",
                  minWidth: 0,
                }}
              />
              <button
                type="submit"
                style={{
                  background: "transparent",
                  border: "1px solid #003300",
                  color: "#005500",
                  fontFamily: "monospace",
                  fontSize: "0.65rem",
                  padding: "3px 8px",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                  flexShrink: 0,
                }}
              >
                ▶
              </button>
            </form>
          </div>
        )}
      </div>

      {/* ── Inventory bar ────────────────────────────────────────────────────── */}
      <div
        style={{
          flexShrink: 0,
          padding: "0.5rem 1rem",
          background: "#000000",
          borderTop: "1px solid #003300",
        }}
      >
        <div
          style={{
            fontSize: "0.6rem",
            color: "#003300",
            letterSpacing: "0.12em",
            marginBottom: "0.35rem",
          }}
        >
          ダンジョンで問題を解く → ブロック獲得 → ここに建設
          <a href="/dungeon" style={{ color: "#00aa2a", marginLeft: "0.5rem", textDecoration: "underline" }}>
            /dungeon へ
          </a>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span
            style={{
              flexShrink: 0,
              color: "#003300",
              fontSize: "0.65rem",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
            }}
          >
            INVENTORY
          </span>

          <div
            style={{
              display: "flex",
              flex: 1,
              alignItems: "center",
              gap: "0.5rem",
              overflowX: "auto",
            }}
          >
            {inventory.filter((i) => i.quantity > 0).length === 0 ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  fontSize: "0.75rem",
                }}
              >
                <span style={{ color: "#003300", letterSpacing: "0.1em" }}>NO BLOCKS</span>
                <a
                  href="/problems"
                  style={{ color: "#00aa2a", letterSpacing: "0.1em", textDecoration: "underline" }}
                >
                  SOLVE PROBLEMS →
                </a>
              </div>
            ) : (
              inventory
                .filter((i) => i.quantity > 0)
                .map((item) => {
                  const info = BLOCK_INFO[item.blockType] ?? {
                    label: item.blockType,
                    color: "#888",
                    icon: "📦",
                  }
                  const isSelected = selectedBlock === item.blockType
                  return (
                    <button
                      key={item.blockType}
                      type="button"
                      onClick={() => setSelectedBlock(isSelected ? null : item.blockType)}
                      style={{
                        display: "flex",
                        flexShrink: 0,
                        alignItems: "center",
                        gap: "0.5rem",
                        padding: "0.25rem 0.75rem",
                        fontFamily: "monospace",
                        fontSize: "0.75rem",
                        letterSpacing: "0.1em",
                        border: isSelected ? `1px solid ${info.color}` : "1px solid #003300",
                        background: isSelected ? "rgba(0,255,65,0.05)" : "transparent",
                        color: isSelected ? "#00ff41" : "#005500",
                        cursor: "pointer",
                        boxShadow: isSelected ? `0 0 8px ${info.color}40` : "none",
                      }}
                    >
                      <span
                        style={{
                          width: "8px",
                          height: "8px",
                          flexShrink: 0,
                          background: info.color,
                          boxShadow: isSelected ? `0 0 4px ${info.color}` : "none",
                        }}
                      />
                      <span style={{ whiteSpace: "nowrap" }}>{info.label}</span>
                      <span style={{ color: "#00ff41", fontWeight: "bold" }}>×{item.quantity}</span>
                    </button>
                  )
                })
            )}
          </div>

          {selectedBlock && (
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ color: "#00ff41", fontSize: "0.7rem", letterSpacing: "0.1em" }}>
                ▶ SELECTED
              </span>
              <button
                type="button"
                onClick={() => setSelectedBlock(null)}
                style={{
                  color: "#003300",
                  fontSize: "0.65rem",
                  border: "1px solid #003300",
                  padding: "0.15rem 0.4rem",
                  background: "transparent",
                  fontFamily: "monospace",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                }}
              >
                ESC
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
