"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import * as THREE from "three"

// ── Constants ──────────────────────────────────────────────────────────────────
const MAP_SIZE = 32
const TILE_UNIT = 1
const BLOCK_HEIGHT = 0.5
const EYE_HEIGHT = 1.6
const MOVE_SPEED = 6
// biome-ignore lint/complexity/useLiteralKeys: bracket notation required per CLAUDE.md
const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

// ── Combat constants ───────────────────────────────────────────────────────────
const PLAYER_MAX_HP = 100
const MAX_AMMO = 30
const RELOAD_TIME = 2500
const BULLET_SPEED = 35
const BULLET_LIFETIME = 0.35
const RECOIL_STRENGTH = 0.1
const RECOIL_RECOVER = 8
const MUZZLE_FLASH_DURATION = 0.07
const PROBLEM_TIME = 30
const PLAYER_RADIUS = 0.35
const ENEMY_RADIUS = 0.4

// ── Map wall definitions [x, z, width, depth] ──────────────────────────────────
const WALL_DEFS: [number, number, number, number][] = [
  [3, 3, 4, 4], [9, 1, 3, 5], [14, 8, 5, 4], [22, 3, 4, 6],
  [5, 14, 2, 5], [20, 12, 4, 2], [7, 21, 4, 3], [17, 21, 5, 4],
  [25, 18, 3, 6], [10, 26, 5, 3], [2, 26, 3, 3], [27, 8, 2, 5],
  [5, 9, 1, 1], [12, 17, 1, 1], [18, 7, 1, 1], [24, 15, 1, 1],
]
type WallAABB = { x1: number; z1: number; x2: number; z2: number }
const WALL_AABBS: WallAABB[] = WALL_DEFS.map(([x, z, w, d]) => ({ x1: x, z1: z, x2: x + w, z2: z + d }))

function collidesWithWall(px: number, pz: number, radius: number): boolean {
  if (px - radius < 0 || px + radius > MAP_SIZE || pz - radius < 0 || pz + radius > MAP_SIZE)
    return true
  for (const w of WALL_AABBS) {
    if (px + radius > w.x1 && px - radius < w.x2 && pz + radius > w.z1 && pz - radius < w.z2)
      return true
  }
  return false
}

// ── Enemy type system ──────────────────────────────────────────────────────────
type EnemyType = "grunt" | "miniboss" | "boss"
type EnemyState = "patrol" | "alert" | "attack" | "search"

interface EnemyConfig {
  hp: number
  speed: number
  attackDamage: number
  attackInterval: number
  attackRange: number
  color: number
  emissive: number
  bodyW: number
  bodyH: number
  sightRange: number
  fovAngle: number
  score: number
  blockReward: number
}

const ENEMY_CONFIGS: Record<EnemyType, EnemyConfig> = {
  grunt: {
    hp: 3, speed: 2.0, attackDamage: 10, attackInterval: 2000, attackRange: 1.8,
    color: 0xff2222, emissive: 0x330000, bodyW: 0.65, bodyH: 1.7,
    sightRange: 12, fovAngle: Math.PI, score: 250, blockReward: 1,
  },
  miniboss: {
    hp: 5, speed: 1.6, attackDamage: 20, attackInterval: 1500, attackRange: 2.0,
    color: 0xff6600, emissive: 0x331100, bodyW: 0.85, bodyH: 2.1,
    sightRange: 16, fovAngle: Math.PI * 0.9, score: 600, blockReward: 3,
  },
  boss: {
    hp: 8, speed: 1.2, attackDamage: 35, attackInterval: 2500, attackRange: 2.5,
    color: 0xaa00ff, emissive: 0x220033, bodyW: 1.1, bodyH: 2.5,
    sightRange: 22, fovAngle: Math.PI * 0.8, score: 1500, blockReward: 8,
  },
}

interface EnemySpawnDef {
  x: number
  z: number
  type: EnemyType
  patrol: { x: number; z: number }[]
}

const ENEMY_SPAWN_DEFS: EnemySpawnDef[] = [
  { x: 2, z: 2, type: "grunt", patrol: [{ x: 2, z: 2 }, { x: 2, z: 8 }, { x: 7, z: 8 }] },
  { x: 13, z: 3, type: "grunt", patrol: [{ x: 13, z: 3 }, { x: 13, z: 7 }, { x: 8, z: 7 }] },
  { x: 26, z: 2, type: "grunt", patrol: [{ x: 26, z: 2 }, { x: 26, z: 8 }, { x: 22, z: 8 }] },
  { x: 1, z: 18, type: "grunt", patrol: [{ x: 1, z: 18 }, { x: 4, z: 18 }, { x: 4, z: 25 }] },
  { x: 11, z: 20, type: "miniboss", patrol: [{ x: 11, z: 20 }, { x: 11, z: 25 }, { x: 16, z: 25 }] },
  { x: 23, z: 24, type: "miniboss", patrol: [{ x: 23, z: 24 }, { x: 28, z: 24 }, { x: 28, z: 19 }] },
  { x: 16, z: 14, type: "boss", patrol: [{ x: 16, z: 14 }, { x: 16, z: 20 }, { x: 20, z: 20 }, { x: 20, z: 14 }] },
]

function enemyCanSee(
  facingX: number, facingZ: number,
  toDx: number, toDz: number,
  dist: number, cfg: EnemyConfig,
): boolean {
  if (dist > cfg.sightRange) return false
  const fLen = Math.sqrt(facingX * facingX + facingZ * facingZ)
  if (fLen < 0.001) return true
  const dot = (toDx / dist) * (facingX / fLen) + (toDz / dist) * (facingZ / fLen)
  return Math.acos(Math.max(-1, Math.min(1, dot))) < cfg.fovAngle / 2
}

// Canvas-space constants for WS backwards-compat
const TILE_W = 64
const TILE_H = 32
const ORIGIN_X = MAP_SIZE * (TILE_W / 2)
const ORIGIN_Y = 140

function tileToCanvas(tx: number, ty: number) {
  return {
    x: (tx - ty) * (TILE_W / 2) + ORIGIN_X,
    y: (tx + ty) * (TILE_H / 2) + ORIGIN_Y,
  }
}
function canvasToTile(x: number, y: number) {
  const relX = x - ORIGIN_X
  const relY = y - ORIGIN_Y
  const tx = Math.round((relX / (TILE_W / 2) + relY / (TILE_H / 2)) / 2)
  const ty = Math.round((relY / (TILE_H / 2) - relX / (TILE_W / 2)) / 2)
  return {
    tx: Math.max(0, Math.min(MAP_SIZE - 1, tx)),
    ty: Math.max(0, Math.min(MAP_SIZE - 1, ty)),
  }
}

// ── Zone definitions ───────────────────────────────────────────────────────────
const ZONES = [
  { startTX: 0, endTX: 9, color: 0x0d2545 },
  { startTX: 10, endTX: 21, color: 0x0d2e13 },
  { startTX: 22, endTX: 31, color: 0x1a0d38 },
]

// ── Block colors ───────────────────────────────────────────────────────────────
const BLOCK_COLORS: Record<string, number> = {
  wood_block: 0xa0522d,
  stone_block: 0x7a7a7a,
  diamond_block: 0x00cfff,
}

const BLOCK_INFO: Record<string, { label: string; color: string }> = {
  wood_block: { label: "木材ブロック", color: "#a0522d" },
  stone_block: { label: "石ブロック", color: "#8a8a8a" },
  diamond_block: { label: "ダイヤブロック", color: "#00cfff" },
}

// ── Combat problem pool ────────────────────────────────────────────────────────
interface CombatProblemDef {
  question: string
  choices: [string, string, string, string]
  correct: 0 | 1 | 2 | 3
}

const COMBAT_PROBLEMS: CombatProblemDef[] = [
  {
    question: "SELECT * FROM users WHERE age > 25 の結果は？",
    choices: ["25歳のみ", "26歳以上の全ユーザー", "25歳以下", "全ユーザー"],
    correct: 1,
  },
  {
    question: "LEFT JOIN と INNER JOIN の違いは？",
    choices: [
      "全く同じ",
      "LEFT JOINは左テーブルの全行を含む",
      "INNER JOINが遅い",
      "LEFT JOINはNULLを除外",
    ],
    correct: 1,
  },
  {
    question: "O(n log n) の計算量を持つソートは？",
    choices: ["バブルソート", "選択ソート", "マージソート", "挿入ソート"],
    correct: 2,
  },
  {
    question: "RESTful APIでリソース取得に使うHTTPメソッドは？",
    choices: ["POST", "PUT", "DELETE", "GET"],
    correct: 3,
  },
  {
    question: "SQLでNULL値を正しく比較する構文は？",
    choices: ["= NULL", "!= NULL", "IS NULL", "== NULL"],
    correct: 2,
  },
  {
    question: "インデックスの主な目的は？",
    choices: ["データ暗号化", "検索の高速化", "テーブル削除", "データ圧縮"],
    correct: 1,
  },
  {
    question: "スタック（Stack）のデータ取り出し順序は？",
    choices: ["FIFO", "LIFO", "ランダム", "優先度順"],
    correct: 1,
  },
  {
    question: "データベースのACIDのAは何の略？",
    choices: ["Availability", "Authority", "Atomicity", "Algorithm"],
    correct: 2,
  },
  {
    question: "SQL INJECTIONを防ぐ最善策は？",
    choices: ["文字エスケープのみ", "WAFのみ", "HTTPS使用", "プリペアドステートメント"],
    correct: 3,
  },
  {
    question: "GROUP BY句で使える集計関数は？",
    choices: ["WHERE", "JOIN", "COUNT", "LIMIT"],
    correct: 2,
  },
  {
    question: "二分探索の計算量は？",
    choices: ["O(n)", "O(n²)", "O(log n)", "O(1)"],
    correct: 2,
  },
  {
    question: "HTTPステータスコード404の意味は？",
    choices: ["認証エラー", "サーバーエラー", "リクエスト成功", "リソースが見つからない"],
    correct: 3,
  },
]

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
  positionZ: number
  placedBy: string
}

interface TagGameInfo {
  running: boolean
  itUsername: string
  remainingMs: number
  scores: { username: string; itMs: number }[]
}

interface WorldData {
  id: string
  name: string
}

interface PlayerStats {
  level: number
  xp: number
  username?: string
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
  isSystem?: boolean
}

interface CombatEnemy {
  id: string
  mesh: THREE.Mesh
  hp: number
  maxHp: number
  type: EnemyType
  config: EnemyConfig
  state: EnemyState
  patrolWaypoints: { x: number; z: number }[]
  patrolIndex: number
  lastAttackTime: number
  facing: THREE.Vector3
  lastSeenPlayer: { x: number; z: number } | null
  searchTimer: number
}

interface Bullet {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  life: number
}

interface ActiveProblem {
  def: CombatProblemDef
  enemyId: string
}

// ── XP helper ─────────────────────────────────────────────────────────────────
function computeXpProgress(totalXp: number) {
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

// ── Three.js scene refs ────────────────────────────────────────────────────────
interface SceneRefs {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  blockMeshes: Map<string, THREE.Mesh>
  blocksGrid: Map<string, number>
  remoteMeshes: Map<string, THREE.Mesh>
  wallMeshes: THREE.Mesh[]
  focalPoint: THREE.Vector3
  groundPlane: THREE.Mesh
  raycaster: THREE.Raycaster
  pointer: THREE.Vector2
  playerMesh: THREE.Mesh
  gunGroup: THREE.Group
  enemies: CombatEnemy[]
  bullets: Bullet[]
  muzzleLight: THREE.PointLight
  aimedEnemyId: string | null
}

export default function ThreeWorld() {
  const mountRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<SceneRefs | null>(null)
  const animFrameRef = useRef<number>(0)
  const keysRef = useRef<Set<string>>(new Set())
  const joystickRef = useRef({ vx: 0, vy: 0 })
  const joyBaseRef = useRef<{ x: number; y: number } | null>(null)
  const joyThumbRef = useRef<HTMLDivElement>(null)
  const lookJoyRef = useRef({ vx: 0, vy: 0 })
  const lookJoyBaseRef = useRef<{ x: number; y: number } | null>(null)
  const lookJoyThumbRef = useRef<HTMLDivElement>(null)
  const worldIdRef = useRef<string | null>(null)
  const selectedBlockRef = useRef<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const usernameRef = useRef("Player")
  const remotePosRef = useRef<Record<string, RemotePlayer>>({})
  const msgIdRef = useRef(0)
  const pendingPlaceRef = useRef(false)
  const userIdRef = useRef<string | null>(null)
  const minimapRef = useRef<HTMLCanvasElement>(null)
  const tagGameRef = useRef<TagGameInfo | null>(null)
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rendererDomRef = useRef<HTMLCanvasElement | null>(null)
  const lastAlertTimeRef = useRef(0)

  // Combat refs
  const recoilRef = useRef(0)
  const playerHpRef = useRef(PLAYER_MAX_HP)
  const gamePhaseRef = useRef<"playing" | "gameover" | "clear">("playing")
  const activeProblemRef = useRef<ActiveProblem | null>(null)
  const ammoRef = useRef(MAX_AMMO)
  const reloadingRef = useRef(false)
  const scoreRef = useRef(0)
  const muzzleFlashTimerRef = useRef(0)
  const earnedBlocksRef = useRef(0)

  // UI state
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [playerStats, setPlayerStats] = useState<PlayerStats>({ level: 0, xp: 0 })
  const [onlineCount, setOnlineCount] = useState(1)
  const [isMobile, setIsMobile] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState("")
  const chatEndRef = useRef<HTMLDivElement>(null)
  const [tagGame, setTagGame] = useState<TagGameInfo | null>(null)
  const [isPointerLocked, setIsPointerLocked] = useState(false)

  // Combat state
  const [playerHp, setPlayerHp] = useState(PLAYER_MAX_HP)
  const [ammo, setAmmo] = useState(MAX_AMMO)
  const [score, setScore] = useState(0)
  const [gamePhase, setGamePhase] = useState<"playing" | "gameover" | "clear">("playing")
  const [activeProblem, setActiveProblem] = useState<ActiveProblem | null>(null)
  const [problemTimeLeft, setProblemTimeLeft] = useState(PROBLEM_TIME)
  const [enemyStatus, setEnemyStatus] = useState<
    Array<{ id: string; hp: number; maxHp: number; type: EnemyType }>
  >([])
  const [aimedEnemyId, setAimedEnemyId] = useState<string | null>(null)
  const [earnedBlocks, setEarnedBlocks] = useState(0)
  const [isReloading, setIsReloading] = useState(false)
  const [damageFlash, setDamageFlash] = useState(false)

  useEffect(() => {
    selectedBlockRef.current = selectedBlock
  }, [selectedBlock])
  useEffect(() => {
    setIsMobile(navigator.maxTouchPoints > 0)
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: chatEndRef is a stable ref, no need in deps
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [chatMessages])

  const showNotification = useCallback((msg: string) => {
    setNotification(msg)
    const t = setTimeout(() => setNotification(null), 2500)
    return () => clearTimeout(t)
  }, [])

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
      const json = (await res.json()) as { data: PlayerStats }
      setPlayerStats({ level: json.data.level, xp: json.data.xp })
      if (json.data.username) usernameRef.current = json.data.username
    }
  }, [])

  // ── Spawn block mesh ───────────────────────────────────────────────────────
  const spawnBlock = useCallback(
    (
      tx: number,
      ty: number,
      tz: number,
      blockType: string,
      blockId?: string,
      placedBy?: string,
    ) => {
      const refs = sceneRef.current
      if (!refs) return
      const key = `${tx},${ty},${tz}`
      const existing = refs.blockMeshes.get(key)
      if (existing) {
        refs.scene.remove(existing)
        existing.geometry.dispose()
      }
      const color = BLOCK_COLORS[blockType] ?? 0x888888
      const geo = new THREE.BoxGeometry(TILE_UNIT * 0.95, BLOCK_HEIGHT, TILE_UNIT * 0.95)
      const mat = new THREE.MeshLambertMaterial({ color })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(
        tx * TILE_UNIT + TILE_UNIT / 2,
        tz * BLOCK_HEIGHT + BLOCK_HEIGHT / 2,
        ty * TILE_UNIT + TILE_UNIT / 2,
      )
      mesh.castShadow = true
      mesh.userData = { blockId: blockId ?? null, placedBy: placedBy ?? null }
      refs.scene.add(mesh)
      refs.blockMeshes.set(key, mesh)
      const gridKey = `${tx},${ty}`
      refs.blocksGrid.set(gridKey, Math.max(refs.blocksGrid.get(gridKey) ?? -1, tz))
    },
    [],
  )

  // ── Place block via API ────────────────────────────────────────────────────
  const placeBlock = useCallback(
    async (tx: number, ty: number) => {
      const blockType = selectedBlockRef.current
      const wId = worldIdRef.current
      if (!blockType || !wId || pendingPlaceRef.current) return
      const refs = sceneRef.current
      const nextZ = (refs?.blocksGrid.get(`${tx},${ty}`) ?? -1) + 1
      pendingPlaceRef.current = true
      try {
        const res = await fetch(`${API_URL}/api/worlds/${wId}/blocks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ blockType, positionX: tx, positionY: ty, positionZ: nextZ }),
        })
        if (res.ok) {
          const placed = (await res.json()) as { data: PlacedBlock }
          spawnBlock(tx, ty, nextZ, blockType, placed.data.id, placed.data.placedBy)
          await fetchInventory()
          showNotification(`${BLOCK_INFO[blockType]?.label ?? blockType} を設置しました！`)
        } else {
          const json = (await res.json()) as { error?: string }
          showNotification(json.error ?? "設置に失敗しました")
        }
      } finally {
        pendingPlaceRef.current = false
      }
    },
    [spawnBlock, fetchInventory, showNotification],
  )

  // ── Destroy block via API ──────────────────────────────────────────────────
  const destroyBlock = useCallback(
    async (blockId: string) => {
      const wId = worldIdRef.current
      const refs = sceneRef.current
      if (!wId || !refs) return
      let foundKey: string | null = null
      let foundMesh: THREE.Mesh | null = null
      for (const [key, mesh] of refs.blockMeshes) {
        if (mesh.userData.blockId === blockId) {
          foundKey = key
          foundMesh = mesh
          break
        }
      }
      if (!foundKey || !foundMesh) return
      try {
        const res = await fetch(`${API_URL}/api/worlds/${wId}/blocks/${blockId}`, {
          method: "DELETE",
          credentials: "include",
        })
        if (res.ok) {
          refs.scene.remove(foundMesh)
          foundMesh.geometry.dispose()
          refs.blockMeshes.delete(foundKey)
          const [txStr, tyStr] = foundKey.split(",")
          const gridKey = `${txStr},${tyStr}`
          let maxZ = -1
          for (const [k] of refs.blockMeshes) {
            const parts = k.split(",")
            if (parts[0] === txStr && parts[1] === tyStr) maxZ = Math.max(maxZ, Number(parts[2]))
          }
          if (maxZ === -1) refs.blocksGrid.delete(gridKey)
          else refs.blocksGrid.set(gridKey, maxZ)
          showNotification("ブロックを破壊しました")
        } else {
          const json = (await res.json().catch(() => ({}))) as { error?: string }
          showNotification(json.error ?? "破壊に失敗しました")
        }
      } catch {
        showNotification("エラーが発生しました")
      }
    },
    [showNotification],
  )

  // ── Answer combat problem ──────────────────────────────────────────────────
  const answerProblem = useCallback(
    (correct: boolean) => {
      const problem = activeProblemRef.current
      activeProblemRef.current = null
      setActiveProblem(null)
      if (!problem) return

      if (correct) {
        const refs = sceneRef.current
        if (!refs) return
        const enemy = refs.enemies.find((e) => e.id === problem.enemyId)
        if (enemy && enemy.hp > 0) {
          enemy.hp -= 1
          scoreRef.current += 50
          setScore(scoreRef.current)
          if (enemy.hp <= 0) {
            refs.scene.remove(enemy.mesh)
            enemy.mesh.geometry.dispose()
            scoreRef.current += enemy.config.score
            setScore(scoreRef.current)
            earnedBlocksRef.current += enemy.config.blockReward
            setEarnedBlocks(earnedBlocksRef.current)
            const tag = enemy.type === "boss" ? "BOSS撃破！" : enemy.type === "miniboss" ? "ミニボス撃破！" : "エネミー撃破！"
            showNotification(`${tag} +${enemy.config.score}pt ブロック×${enemy.config.blockReward}獲得！`)
            const allDead = refs.enemies.every((e) => e.hp <= 0)
            if (allDead) {
              gamePhaseRef.current = "clear"
              setGamePhase("clear")
            }
          } else {
            showNotification(`正解！ダメージを与えた！(HP: ${enemy.hp}/${enemy.maxHp})`)
          }
          setEnemyStatus(refs.enemies.map((e) => ({ id: e.id, hp: e.hp, maxHp: e.maxHp, type: e.type })))
        }
      } else {
        playerHpRef.current = Math.max(0, playerHpRef.current - 20)
        setPlayerHp(playerHpRef.current)
        setDamageFlash(true)
        setTimeout(() => setDamageFlash(false), 300)
        showNotification("不正解！ -20 HP")
        if (playerHpRef.current <= 0 && gamePhaseRef.current === "playing") {
          gamePhaseRef.current = "gameover"
          setGamePhase("gameover")
        }
      }
    },
    [showNotification],
  )

  // Problem countdown timer
  useEffect(() => {
    if (!activeProblem) return
    setProblemTimeLeft(PROBLEM_TIME)
    const interval = setInterval(() => {
      setProblemTimeLeft((prev) => {
        if (prev <= 1) {
          answerProblem(false)
          return PROBLEM_TIME
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [activeProblem, answerProblem])

  // ── Three.js init ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function init() {
      const worldRes = await fetch(`${API_URL}/api/worlds/shared`, { credentials: "include" })
      if (!worldRes.ok) {
        if (!cancelled)
          setError(worldRes.status === 401 ? "ログインが必要です" : "ワールドの取得に失敗しました")
        return
      }
      const worldJson = (await worldRes.json()) as { data: WorldData }
      worldIdRef.current = worldJson.data.id

      const blocksRes = await fetch(`${API_URL}/api/worlds/${worldJson.data.id}/blocks`, {
        credentials: "include",
      })
      const initialBlocks: PlacedBlock[] = blocksRes.ok
        ? ((await blocksRes.json()) as { data: PlacedBlock[] }).data
        : []

      await fetchInventory()
      await fetchPlayerStats()

      if (cancelled || !mountRef.current) return
      setIsLoading(false)

      const container = mountRef.current

      // ── Scene ──────────────────────────────────────────────────────────────
      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x050510)
      scene.fog = new THREE.Fog(0x050510, 30, 80)

      // ── Camera (FPS) ───────────────────────────────────────────────────────
      const camera = new THREE.PerspectiveCamera(
        75,
        container.clientWidth / container.clientHeight,
        0.1,
        200,
      )
      camera.rotation.order = "YXZ"

      // ── Renderer ───────────────────────────────────────────────────────────
      const renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setSize(container.clientWidth, container.clientHeight)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
      container.appendChild(renderer.domElement)
      rendererDomRef.current = renderer.domElement

      // ── Lights ─────────────────────────────────────────────────────────────
      scene.add(new THREE.AmbientLight(0x334466, 0.8))
      const sun = new THREE.DirectionalLight(0xffffff, 1.2)
      sun.position.set(20, 40, 10)
      sun.castShadow = true
      sun.shadow.mapSize.set(2048, 2048)
      sun.shadow.camera.near = 0.5
      sun.shadow.camera.far = 100
      ;[-40, 40, -40, 40].forEach((v, i) => {
        if (i === 0) sun.shadow.camera.left = v
        else if (i === 1) sun.shadow.camera.right = v
        else if (i === 2) sun.shadow.camera.bottom = v
        else sun.shadow.camera.top = v
      })
      scene.add(sun)

      // ── Ground zones ───────────────────────────────────────────────────────
      for (const zone of ZONES) {
        const w = (zone.endTX - zone.startTX + 1) * TILE_UNIT
        const geo = new THREE.PlaneGeometry(w, MAP_SIZE * TILE_UNIT)
        const mat = new THREE.MeshLambertMaterial({ color: zone.color })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.rotation.x = -Math.PI / 2
        mesh.position.set(
          (zone.startTX + (zone.endTX - zone.startTX + 1) / 2) * TILE_UNIT,
          0,
          (MAP_SIZE / 2) * TILE_UNIT,
        )
        mesh.receiveShadow = true
        scene.add(mesh)
      }
      const gridHelper = new THREE.GridHelper(MAP_SIZE, MAP_SIZE, 0x112233, 0x112233)
      gridHelper.position.set((MAP_SIZE / 2) * TILE_UNIT, 0.01, (MAP_SIZE / 2) * TILE_UNIT)
      scene.add(gridHelper)

      const groundGeo = new THREE.PlaneGeometry(MAP_SIZE * TILE_UNIT, MAP_SIZE * TILE_UNIT)
      const groundMat = new THREE.MeshBasicMaterial({ visible: false })
      const groundPlane = new THREE.Mesh(groundGeo, groundMat)
      groundPlane.rotation.x = -Math.PI / 2
      groundPlane.position.set((MAP_SIZE / 2) * TILE_UNIT, 0, (MAP_SIZE / 2) * TILE_UNIT)
      scene.add(groundPlane)

      // ── Map walls ──────────────────────────────────────────────────────────────
      const wallMeshes: THREE.Mesh[] = []
      const wallMat = new THREE.MeshLambertMaterial({ color: 0x445566 })
      const wallMatAccent = new THREE.MeshLambertMaterial({ color: 0x334455 })
      for (const [wx, wz, ww, wd] of WALL_DEFS) {
        const wallH = ww === 1 && wd === 1 ? 1.2 : 3.0
        const geo = new THREE.BoxGeometry(ww, wallH, wd)
        const mesh = new THREE.Mesh(geo, ww * wd > 4 ? wallMat : wallMatAccent)
        mesh.position.set(wx + ww / 2, wallH / 2, wz + wd / 2)
        mesh.castShadow = true
        mesh.receiveShadow = true
        scene.add(mesh)
        wallMeshes.push(mesh)
      }

      // ── FPS camera state ───────────────────────────────────────────────────
      const focalPoint = new THREE.Vector3(
        (MAP_SIZE / 2) * TILE_UNIT,
        0,
        (MAP_SIZE / 2) * TILE_UNIT,
      )
      const camState = { yaw: Math.PI, pitch: 0 }

      function clampPitch(p: number) {
        return Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, p))
      }

      function updateCamera() {
        camera.position.set(focalPoint.x, EYE_HEIGHT, focalPoint.z)
        camera.rotation.y = camState.yaw
        camera.rotation.x = camState.pitch
      }
      updateCamera()

      const raycaster = new THREE.Raycaster()
      const pointer = new THREE.Vector2()
      const blockMeshes = new Map<string, THREE.Mesh>()
      const blocksGrid = new Map<string, number>()
      const remoteMeshes = new Map<string, THREE.Mesh>()

      // Hidden player mesh (FPS - position used by WS)
      const playerGeo = new THREE.CapsuleGeometry(0.22, 0.5, 4, 8)
      const playerMesh = new THREE.Mesh(
        playerGeo,
        new THREE.MeshLambertMaterial({ color: 0x00ff41 }),
      )
      playerMesh.visible = false
      scene.add(playerMesh)

      // ── Weapon (FPS gun) ───────────────────────────────────────────────────
      const gunGroup = new THREE.Group()
      const gunMatColor = 0x445566
      function makePart(w: number, h: number, d: number, ox: number, oy: number, oz: number) {
        const geo = new THREE.BoxGeometry(w, h, d)
        const mat = new THREE.MeshLambertMaterial({ color: gunMatColor, depthTest: false })
        const m = new THREE.Mesh(geo, mat)
        m.position.set(ox, oy, oz)
        m.renderOrder = 999
        return m
      }
      gunGroup.add(makePart(0.08, 0.055, 0.28, 0, 0, 0)) // body
      gunGroup.add(makePart(0.032, 0.032, 0.22, 0, 0.016, -0.18)) // barrel
      gunGroup.add(makePart(0.055, 0.1, 0.058, 0, -0.075, 0.065)) // grip
      gunGroup.add(makePart(0.065, 0.012, 0.12, 0, 0.035, 0.04)) // slide top
      gunGroup.renderOrder = 999
      scene.add(gunGroup)

      // Muzzle flash light
      const muzzleLight = new THREE.PointLight(0xffee44, 0, 5)
      scene.add(muzzleLight)

      // ── AI Enemies ─────────────────────────────────────────────────────────
      const enemies: CombatEnemy[] = ENEMY_SPAWN_DEFS.map((def, i) => {
        const cfg = ENEMY_CONFIGS[def.type]
        const geo = new THREE.BoxGeometry(cfg.bodyW, cfg.bodyH, cfg.bodyW)
        const mat = new THREE.MeshLambertMaterial({ color: cfg.color, emissive: cfg.emissive })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.set(def.x, cfg.bodyH / 2, def.z)
        mesh.castShadow = true
        scene.add(mesh)
        const eyeGeo = new THREE.BoxGeometry(cfg.bodyW * 0.44, cfg.bodyH * 0.036, 0.05)
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff8800 })
        const eyes = new THREE.Mesh(eyeGeo, eyeMat)
        eyes.position.set(0, cfg.bodyH * 0.27, cfg.bodyW / 2 + 0.01)
        mesh.add(eyes)
        return {
          id: `enemy_${i}`,
          mesh,
          hp: cfg.hp,
          maxHp: cfg.hp,
          type: def.type,
          config: cfg,
          state: "patrol" as EnemyState,
          patrolWaypoints: def.patrol,
          patrolIndex: 0,
          lastAttackTime: 0,
          facing: new THREE.Vector3(0, 0, 1),
          lastSeenPlayer: null,
          searchTimer: 0,
        }
      })

      const bullets: Bullet[] = []

      sceneRef.current = {
        scene,
        camera,
        renderer,
        blockMeshes,
        blocksGrid,
        remoteMeshes,
        wallMeshes,
        focalPoint,
        groundPlane,
        raycaster,
        pointer,
        playerMesh,
        gunGroup,
        enemies,
        bullets,
        muzzleLight,
        aimedEnemyId: null,
      }

      setEnemyStatus(enemies.map((e) => ({ id: e.id, hp: e.hp, maxHp: e.maxHp, type: e.type })))

      fetch(`${API_URL}/api/me`, { credentials: "include" })
        .then((r) => r.json() as Promise<{ data?: { user?: { id?: string } } }>)
        .then((json) => {
          userIdRef.current = json.data?.user?.id ?? null
        })
        .catch(() => {})

      for (const block of initialBlocks) {
        spawnBlock(
          block.positionX,
          block.positionY,
          block.positionZ,
          block.blockType,
          block.id,
          block.placedBy,
        )
      }

      // ── Center-screen raycasting helpers ───────────────────────────────────
      function placeAtCenter() {
        if (!selectedBlockRef.current || pendingPlaceRef.current) return
        pointer.set(0, 0)
        raycaster.setFromCamera(pointer, camera)
        const blockHits = raycaster.intersectObjects([...blockMeshes.values()], false)
        if (blockHits.length > 0) {
          const hit = blockHits[0]
          if (hit?.face && hit.face.normal.y > 0.5) {
            const tx = Math.floor((hit.point.x + 0.001) / TILE_UNIT)
            const ty = Math.floor((hit.point.z + 0.001) / TILE_UNIT)
            if (tx >= 0 && tx < MAP_SIZE && ty >= 0 && ty < MAP_SIZE) {
              placeBlock(tx, ty).catch(() => {})
            }
            return
          }
        }
        const groundHits = raycaster.intersectObject(groundPlane)
        if (groundHits.length > 0) {
          const p = groundHits[0]?.point
          if (!p) return
          const tx = Math.floor(p.x / TILE_UNIT)
          const ty = Math.floor(p.z / TILE_UNIT)
          if (tx >= 0 && tx < MAP_SIZE && ty >= 0 && ty < MAP_SIZE) {
            placeBlock(tx, ty).catch(() => {})
          }
        }
      }

      function destroyAtCenter() {
        pointer.set(0, 0)
        raycaster.setFromCamera(pointer, camera)
        const hits = raycaster.intersectObjects([...blockMeshes.values()], false)
        if (hits.length > 0) {
          const mesh = hits[0]?.object as THREE.Mesh
          const bId = mesh?.userData.blockId as string | null
          if (!bId) return
          if (mesh?.userData.placedBy !== userIdRef.current) {
            showNotification("自分が設置したブロックのみ破壊できます")
            return
          }
          destroyBlock(bId).catch(() => {})
        }
      }

      // ── Create bullet ──────────────────────────────────────────────────────
      function createBullet() {
        const bulletGeo = new THREE.BoxGeometry(0.022, 0.022, 0.32)
        const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffff88, depthTest: false })
        const bulletMesh = new THREE.Mesh(bulletGeo, bulletMat)
        bulletMesh.renderOrder = 998
        const fwd = new THREE.Vector3()
        camera.getWorldDirection(fwd)
        bulletMesh.position.copy(camera.position).addScaledVector(fwd, 0.55)
        bulletMesh.quaternion.copy(camera.quaternion)
        scene.add(bulletMesh)
        bullets.push({
          mesh: bulletMesh,
          velocity: fwd.clone().multiplyScalar(BULLET_SPEED),
          life: BULLET_LIFETIME,
        })
        muzzleFlashTimerRef.current = MUZZLE_FLASH_DURATION
      }

      // ── Fire weapon ────────────────────────────────────────────────────────
      function fire() {
        if (gamePhaseRef.current !== "playing") return
        if (activeProblemRef.current !== null) return
        if (ammoRef.current <= 0) {
          if (!reloadingRef.current) {
            reloadingRef.current = true
            setIsReloading(true)
            showNotification("RELOADING...")
            setTimeout(() => {
              ammoRef.current = MAX_AMMO
              setAmmo(MAX_AMMO)
              reloadingRef.current = false
              setIsReloading(false)
            }, RELOAD_TIME)
          }
          return
        }
        ammoRef.current -= 1
        setAmmo(ammoRef.current)
        recoilRef.current = RECOIL_STRENGTH
        createBullet()

        // Hit detection
        pointer.set(0, 0)
        raycaster.setFromCamera(pointer, camera)
        const aliveEnemies = enemies.filter((e) => e.hp > 0)
        const enemyHits = raycaster.intersectObjects(
          aliveEnemies.map((e) => e.mesh),
          false,
        )
        if (enemyHits.length > 0) {
          const hitEnemy = aliveEnemies.find((e) => e.mesh === enemyHits[0]?.object)
          if (hitEnemy) {
            const probIdx = Math.floor(Math.random() * COMBAT_PROBLEMS.length)
            const def = COMBAT_PROBLEMS[probIdx]
            if (!def) return
            const ap: ActiveProblem = { def, enemyId: hitEnemy.id }
            activeProblemRef.current = ap
            setActiveProblem(ap)
          }
        } else if (selectedBlockRef.current) {
          placeAtCenter()
        }

        if (ammoRef.current <= 0 && !reloadingRef.current) {
          reloadingRef.current = true
          setIsReloading(true)
          setTimeout(() => {
            ammoRef.current = MAX_AMMO
            setAmmo(MAX_AMMO)
            reloadingRef.current = false
            setIsReloading(false)
          }, RELOAD_TIME)
        }
      }

      // ── PointerLock ────────────────────────────────────────────────────────
      function onDocMouseMove(e: MouseEvent) {
        if (document.pointerLockElement !== renderer.domElement) return
        camState.yaw -= e.movementX * 0.002
        camState.pitch = clampPitch(camState.pitch - e.movementY * 0.002)
        updateCamera()
      }
      function onPointerLockChange() {
        setIsPointerLocked(document.pointerLockElement === renderer.domElement)
      }
      function onMouseDown(e: MouseEvent) {
        if (document.pointerLockElement !== renderer.domElement) {
          renderer.domElement.requestPointerLock()
          return
        }
        if (e.button === 0) fire()
        else if (e.button === 2) destroyAtCenter()
      }
      function onContextMenu(e: MouseEvent) {
        e.preventDefault()
      }

      // Mobile touch
      let touchStartTime = 0
      function onTouchStartLP(e: TouchEvent) {
        if (!e.touches[0]) return
        touchStartTime = Date.now()
        longPressRef.current = setTimeout(() => {
          longPressRef.current = null
          destroyAtCenter()
        }, 600)
      }
      function onTouchEndLP() {
        if (longPressRef.current) {
          clearTimeout(longPressRef.current)
          longPressRef.current = null
          if (Date.now() - touchStartTime < 600) fire()
        }
      }
      function onTouchMoveLP() {
        if (longPressRef.current) {
          clearTimeout(longPressRef.current)
          longPressRef.current = null
        }
      }

      renderer.domElement.addEventListener("touchstart", onTouchStartLP, { passive: true })
      renderer.domElement.addEventListener("touchend", onTouchEndLP)
      renderer.domElement.addEventListener("touchmove", onTouchMoveLP, { passive: true })
      renderer.domElement.addEventListener("touchcancel", onTouchMoveLP)
      renderer.domElement.addEventListener("mousedown", onMouseDown)
      renderer.domElement.addEventListener("contextmenu", onContextMenu)
      document.addEventListener("mousemove", onDocMouseMove)
      document.addEventListener("pointerlockchange", onPointerLockChange)

      function onResize() {
        camera.aspect = container.clientWidth / container.clientHeight
        camera.updateProjectionMatrix()
        renderer.setSize(container.clientWidth, container.clientHeight)
      }
      window.addEventListener("resize", onResize)

      // ── Animation loop ─────────────────────────────────────────────────────
      const clock = new THREE.Clock()
      const fwd3 = new THREE.Vector3()
      const right3 = new THREE.Vector3()

      function animate() {
        animFrameRef.current = requestAnimationFrame(animate)
        const dt = clock.getDelta()
        const refs = sceneRef.current
        if (!refs) return

        // WASD + move joystick
        const joy = joystickRef.current
        let vx = joy.vx
        let vz = joy.vy
        if (keysRef.current.has("ArrowLeft") || keysRef.current.has("a")) vx -= 1
        if (keysRef.current.has("ArrowRight") || keysRef.current.has("d")) vx += 1
        if (keysRef.current.has("ArrowUp") || keysRef.current.has("w")) vz -= 1
        if (keysRef.current.has("ArrowDown") || keysRef.current.has("s")) vz += 1

        if (vx !== 0 || vz !== 0) {
          const fwdX = -Math.sin(camState.yaw)
          const fwdZ = -Math.cos(camState.yaw)
          const dx = (fwdX * -vz + Math.cos(camState.yaw) * vx) * MOVE_SPEED * dt
          const dz = (fwdZ * -vz + -Math.sin(camState.yaw) * vx) * MOVE_SPEED * dt
          const nx = refs.focalPoint.x + dx
          const nz = refs.focalPoint.z + dz
          if (!collidesWithWall(nx, refs.focalPoint.z, PLAYER_RADIUS)) refs.focalPoint.x = nx
          if (!collidesWithWall(refs.focalPoint.x, nz, PLAYER_RADIUS)) refs.focalPoint.z = nz
          updateCamera()
        }

        // Mobile look joystick
        const lJoy = lookJoyRef.current
        if (lJoy.vx !== 0 || lJoy.vy !== 0) {
          camState.yaw -= lJoy.vx * 2.5 * dt
          camState.pitch = clampPitch(camState.pitch - lJoy.vy * 2 * dt)
          updateCamera()
        }

        // ── Weapon update ──────────────────────────────────────────────────
        camera.getWorldDirection(fwd3)
        right3.crossVectors(fwd3, new THREE.Vector3(0, 1, 0)).normalize()
        refs.gunGroup.position
          .copy(camera.position)
          .addScaledVector(fwd3, 0.4)
          .addScaledVector(right3, 0.17)
          .addScaledVector(new THREE.Vector3(0, 1, 0), -0.22)
          .addScaledVector(fwd3, -recoilRef.current)
        refs.gunGroup.quaternion.copy(camera.quaternion)
        if (recoilRef.current > 0) {
          recoilRef.current = Math.max(0, recoilRef.current - RECOIL_RECOVER * dt)
        }

        // Muzzle flash
        if (muzzleFlashTimerRef.current > 0) {
          refs.muzzleLight.intensity = 6
          refs.muzzleLight.position.copy(camera.position).addScaledVector(fwd3, 0.6)
          muzzleFlashTimerRef.current -= dt
        } else {
          refs.muzzleLight.intensity = 0
        }

        // ── Bullets ────────────────────────────────────────────────────────
        for (let i = refs.bullets.length - 1; i >= 0; i--) {
          const b = refs.bullets[i]
          if (!b) continue
          b.mesh.position.addScaledVector(b.velocity, dt)
          b.life -= dt
          if (b.life <= 0) {
            refs.scene.remove(b.mesh)
            b.mesh.geometry.dispose()
            refs.bullets.splice(i, 1)
          }
        }

        // ── Enemy AI state machine ─────────────────────────────────────────
        if (gamePhaseRef.current === "playing" && activeProblemRef.current === null) {
          const now = Date.now()
          const fp = refs.focalPoint
          for (const enemy of refs.enemies) {
            if (enemy.hp <= 0) continue
            const ex = enemy.mesh.position.x
            const ez = enemy.mesh.position.z
            const toPx = fp.x - ex
            const toPz = fp.z - ez
            const distToPlayer = Math.sqrt(toPx * toPx + toPz * toPz)

            if (enemy.state === "patrol") {
              const wp = enemy.patrolWaypoints[enemy.patrolIndex % enemy.patrolWaypoints.length]
              if (wp) {
                const wpDx = wp.x - ex
                const wpDz = wp.z - ez
                const wpDist = Math.sqrt(wpDx * wpDx + wpDz * wpDz)
                if (wpDist < 0.4) {
                  enemy.patrolIndex = (enemy.patrolIndex + 1) % enemy.patrolWaypoints.length
                } else {
                  const spd = enemy.config.speed * 0.45 * dt
                  const nx = ex + (wpDx / wpDist) * spd
                  const nz = ez + (wpDz / wpDist) * spd
                  if (!collidesWithWall(nx, ez, ENEMY_RADIUS)) enemy.mesh.position.x = nx
                  if (!collidesWithWall(ex, nz, ENEMY_RADIUS)) enemy.mesh.position.z = nz
                  enemy.facing.set(wpDx / wpDist, 0, wpDz / wpDist)
                }
              }
              enemy.mesh.rotation.y = Math.atan2(enemy.facing.x, enemy.facing.z)
              if (enemyCanSee(enemy.facing.x, enemy.facing.z, toPx, toPz, distToPlayer, enemy.config)) {
                enemy.state = "alert"
                enemy.lastSeenPlayer = { x: fp.x, z: fp.z }
                const alertNow = Date.now()
                if (alertNow - lastAlertTimeRef.current > 4000) {
                  lastAlertTimeRef.current = alertNow
                  showNotification("⚠ エネミーに発見された！")
                }
              }

            } else if (enemy.state === "alert") {
              enemy.lastSeenPlayer = { x: fp.x, z: fp.z }
              if (distToPlayer <= enemy.config.attackRange) {
                enemy.state = "attack"
              } else {
                const spd = enemy.config.speed * dt
                const nx = ex + (toPx / distToPlayer) * spd
                const nz = ez + (toPz / distToPlayer) * spd
                if (!collidesWithWall(nx, ez, ENEMY_RADIUS)) enemy.mesh.position.x = nx
                if (!collidesWithWall(ex, nz, ENEMY_RADIUS)) enemy.mesh.position.z = nz
                enemy.facing.set(toPx / distToPlayer, 0, toPz / distToPlayer)
                enemy.mesh.rotation.y = Math.atan2(enemy.facing.x, enemy.facing.z)
                if (!enemyCanSee(enemy.facing.x, enemy.facing.z, toPx, toPz, distToPlayer, enemy.config)) {
                  enemy.state = "search"
                  enemy.searchTimer = 3.5
                }
              }
              enemy.mesh.position.y = enemy.config.bodyH / 2 + Math.sin(now * 0.006) * 0.04

            } else if (enemy.state === "attack") {
              if (distToPlayer > 0.001) {
                enemy.facing.set(toPx / distToPlayer, 0, toPz / distToPlayer)
                enemy.mesh.rotation.y = Math.atan2(enemy.facing.x, enemy.facing.z)
              }
              if (distToPlayer > enemy.config.attackRange * 1.5) {
                enemy.state = "alert"
              } else if (now - enemy.lastAttackTime > enemy.config.attackInterval) {
                enemy.lastAttackTime = now
                playerHpRef.current = Math.max(0, playerHpRef.current - enemy.config.attackDamage)
                setPlayerHp(playerHpRef.current)
                setDamageFlash(true)
                setTimeout(() => setDamageFlash(false), 250)
                if (playerHpRef.current <= 0 && gamePhaseRef.current === "playing") {
                  gamePhaseRef.current = "gameover"
                  setGamePhase("gameover")
                }
              }

            } else if (enemy.state === "search") {
              enemy.searchTimer -= dt
              if (enemy.searchTimer <= 0) {
                enemy.state = "patrol"
                enemy.lastSeenPlayer = null
              } else if (enemy.lastSeenPlayer) {
                const lx = enemy.lastSeenPlayer.x - ex
                const lz = enemy.lastSeenPlayer.z - ez
                const ld = Math.sqrt(lx * lx + lz * lz)
                if (ld > 0.4) {
                  const spd = enemy.config.speed * 0.7 * dt
                  const nx = ex + (lx / ld) * spd
                  const nz = ez + (lz / ld) * spd
                  if (!collidesWithWall(nx, ez, ENEMY_RADIUS)) enemy.mesh.position.x = nx
                  if (!collidesWithWall(ex, nz, ENEMY_RADIUS)) enemy.mesh.position.z = nz
                  enemy.facing.set(lx / ld, 0, lz / ld)
                  enemy.mesh.rotation.y = Math.atan2(enemy.facing.x, enemy.facing.z)
                } else {
                  enemy.lastSeenPlayer = null
                }
              }
              if (enemyCanSee(enemy.facing.x, enemy.facing.z, toPx, toPz, distToPlayer, enemy.config)) {
                enemy.state = "alert"
                enemy.lastSeenPlayer = { x: fp.x, z: fp.z }
              }
            }
          }
        }

        // ── Aimed enemy detection (crosshair highlight) ────────────────────
        {
          pointer.set(0, 0)
          raycaster.setFromCamera(pointer, camera)
          const aliveEnemyMeshes = refs.enemies.filter((e) => e.hp > 0).map((e) => e.mesh)
          const aimHits = raycaster.intersectObjects(aliveEnemyMeshes, false)
          const newAimed =
            aimHits.length > 0
              ? (refs.enemies.find((e) => e.mesh === aimHits[0]?.object)?.id ?? null)
              : null
          if (newAimed !== refs.aimedEnemyId) {
            refs.aimedEnemyId = newAimed
            setAimedEnemyId(newAimed)
          }
        }

        // Player mesh sync (WS position)
        refs.playerMesh.position.set(refs.focalPoint.x, EYE_HEIGHT, refs.focalPoint.z)

        // Remote players
        const snapshot = remotePosRef.current
        const liveIds = new Set(Object.keys(snapshot))
        for (const [id, mesh] of refs.remoteMeshes) {
          if (!liveIds.has(id)) {
            refs.scene.remove(mesh)
            refs.remoteMeshes.delete(id)
          }
        }
        for (const [id, pos] of Object.entries(snapshot)) {
          const { tx, ty } = canvasToTile(pos.x, pos.y)
          const wx = tx * TILE_UNIT + TILE_UNIT / 2
          const wz = ty * TILE_UNIT + TILE_UNIT / 2
          const existing = refs.remoteMeshes.get(id)
          if (existing) {
            existing.position.set(wx, 0.5, wz)
          } else {
            const geo = new THREE.CapsuleGeometry(0.18, 0.4, 4, 8)
            const mat = new THREE.MeshLambertMaterial({ color: 0xffcc00 })
            const mesh = new THREE.Mesh(geo, mat)
            mesh.position.set(wx, 0.5, wz)
            refs.scene.add(mesh)
            refs.remoteMeshes.set(id, mesh)
          }
        }

        // Tag coloring
        const tg = tagGameRef.current
        for (const [rmId, rmesh] of refs.remoteMeshes) {
          const rstate = remotePosRef.current[rmId]
          const rmat = rmesh.material as THREE.MeshLambertMaterial
          const wantHex = tg?.running && rstate?.username === tg.itUsername ? 0xff3333 : 0xffcc00
          if (rmat.color.getHex() !== wantHex) rmat.color.setHex(wantHex)
        }

        // Minimap
        const mcanvas = minimapRef.current
        if (mcanvas) {
          const ctx = mcanvas.getContext("2d")
          if (ctx) {
            const W = mcanvas.width
            const SCALE = W / (MAP_SIZE * TILE_UNIT)
            ctx.fillStyle = "rgba(0,0,0,0.85)"
            ctx.fillRect(0, 0, W, W)
            ctx.fillStyle = "#224466"
            for (const [key] of refs.blockMeshes) {
              const p = key.split(",")
              ctx.fillRect(Number(p[0]) * SCALE * TILE_UNIT, Number(p[1]) * SCALE * TILE_UNIT, 2, 2)
            }
            // Draw walls on minimap
            ctx.fillStyle = "#334455"
            for (const [wx, wz, ww, wd] of WALL_DEFS) {
              ctx.fillRect(wx * SCALE, wz * SCALE, ww * SCALE, wd * SCALE)
            }
            // Draw enemies on minimap (color by type/state)
            for (const enemy of refs.enemies) {
              if (enemy.hp <= 0) continue
              ctx.fillStyle =
                enemy.type === "boss" ? "#cc44ff" :
                enemy.type === "miniboss" ? "#ff8800" :
                enemy.state === "alert" || enemy.state === "attack" ? "#ff2222" : "#ff6666"
              ctx.beginPath()
              ctx.arc(
                enemy.mesh.position.x * SCALE,
                enemy.mesh.position.z * SCALE,
                3,
                0,
                Math.PI * 2,
              )
              ctx.fill()
            }
            for (const rp of Object.values(snapshot)) {
              const { tx: rtx, ty: rty } = canvasToTile(rp.x, rp.y)
              ctx.fillStyle = "#ffcc00"
              ctx.beginPath()
              ctx.arc(
                (rtx * TILE_UNIT + TILE_UNIT / 2) * SCALE,
                (rty * TILE_UNIT + TILE_UNIT / 2) * SCALE,
                2.5,
                0,
                Math.PI * 2,
              )
              ctx.fill()
            }
            ctx.fillStyle = "#00ff41"
            ctx.beginPath()
            ctx.arc(refs.focalPoint.x * SCALE, refs.focalPoint.z * SCALE, 3, 0, Math.PI * 2)
            ctx.fill()
          }
        }

        renderer.render(scene, camera)
      }
      animate()

      return () => {
        document.removeEventListener("mousemove", onDocMouseMove)
        document.removeEventListener("pointerlockchange", onPointerLockChange)
        if (document.pointerLockElement === renderer.domElement) document.exitPointerLock()
        renderer.domElement.removeEventListener("mousedown", onMouseDown)
        renderer.domElement.removeEventListener("contextmenu", onContextMenu)
        renderer.domElement.removeEventListener("touchstart", onTouchStartLP)
        renderer.domElement.removeEventListener("touchend", onTouchEndLP)
        renderer.domElement.removeEventListener("touchmove", onTouchMoveLP)
        renderer.domElement.removeEventListener("touchcancel", onTouchMoveLP)
        window.removeEventListener("resize", onResize)
      }
    }

    let cleanup: (() => void) | undefined
    init()
      .then((fn) => {
        cleanup = fn
      })
      .catch((err) => {
        console.error("[ThreeWorld] init error:", err)
        if (!cancelled) setError("ゲームの初期化に失敗しました")
      })

    return () => {
      cancelled = true
      cancelAnimationFrame(animFrameRef.current)
      if (sceneRef.current) {
        sceneRef.current.renderer.dispose()
        const canvas = sceneRef.current.renderer.domElement
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
        sceneRef.current = null
      }
      rendererDomRef.current = null
      cleanup?.()
    }
  }, [spawnBlock, placeBlock, destroyBlock, fetchInventory, fetchPlayerStats, showNotification])

  // ── Keyboard events ────────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      keysRef.current.add(e.key)
      if (e.key === "Escape") setSelectedBlock(null)
      if (e.key === "r" || e.key === "R") {
        if (!reloadingRef.current && ammoRef.current < MAX_AMMO) {
          reloadingRef.current = true
          setIsReloading(true)
          showNotification("RELOADING...")
          setTimeout(() => {
            ammoRef.current = MAX_AMMO
            setAmmo(MAX_AMMO)
            reloadingRef.current = false
            setIsReloading(false)
          }, RELOAD_TIME)
        }
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      keysRef.current.delete(e.key)
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [showNotification])

  // ── WebSocket ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isLoading) return
    // biome-ignore lint/complexity/useLiteralKeys: bracket notation required per CLAUDE.md
    const WS_URL = (process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001").replace(
      /^http/,
      "ws",
    )
    const ws = new WebSocket(`${WS_URL}/ws`)
    wsRef.current = ws

    ws.onopen = () => {
      const refs = sceneRef.current
      const fp = refs?.focalPoint ?? { x: MAP_SIZE / 2, z: MAP_SIZE / 2 }
      const tx = Math.round(fp.x / TILE_UNIT)
      const ty = Math.round((fp as THREE.Vector3).z / TILE_UNIT)
      const { x, y } = tileToCanvas(tx, ty)
      ws.send(
        JSON.stringify({
          type: "join",
          worldId: worldIdRef.current,
          username: usernameRef.current,
          x,
          y,
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
          itUsername?: string
          remainingMs?: number
          scores?: { username: string; itMs: number }[]
          winner?: string
        }
        if (msg.type === "sync" && msg.players) {
          remotePosRef.current = msg.players
          setOnlineCount(Object.keys(msg.players).length + 1)
        } else if (msg.type === "chat" && msg.text) {
          const isSystem = msg.from === "SYSTEM"
          setChatMessages((prev) =>
            [
              ...prev,
              { id: ++msgIdRef.current, from: msg.from ?? "?", text: msg.text ?? "", isSystem },
            ].slice(-20),
          )
        } else if (msg.type === "tag_state") {
          const tg: TagGameInfo = {
            running: true,
            itUsername: msg.itUsername ?? "?",
            remainingMs: msg.remainingMs ?? 0,
            scores: msg.scores ?? [],
          }
          tagGameRef.current = tg
          setTagGame(tg)
        } else if (msg.type === "tag_end") {
          tagGameRef.current = null
          setTagGame(null)
          setChatMessages((prev) =>
            [
              ...prev,
              {
                id: ++msgIdRef.current,
                from: "SYSTEM",
                text: `鬼ごっこ終了！最も逃げた: ${msg.winner ?? "?"}`,
                isSystem: true,
              },
            ].slice(-20),
          )
        }
      } catch {
        /* ignore */
      }
    }

    ws.onclose = () => {
      remotePosRef.current = {}
      setOnlineCount(1)
    }

    const moveInterval = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return
      const refs = sceneRef.current
      if (!refs) return
      const tx = Math.round(refs.focalPoint.x / TILE_UNIT)
      const ty = Math.round(refs.focalPoint.z / TILE_UNIT)
      const { x, y } = tileToCanvas(tx, ty)
      ws.send(JSON.stringify({ type: "move", x, y }))
    }, 100)

    return () => {
      clearInterval(moveInterval)
      ws.close()
      wsRef.current = null
      remotePosRef.current = {}
    }
  }, [isLoading])

  // Tag game countdown
  useEffect(() => {
    if (!tagGame?.running) return
    const interval = setInterval(() => {
      setTagGame((prev) => {
        if (!prev?.running) return prev
        const next = { ...prev, remainingMs: Math.max(0, prev.remainingMs - 1000) }
        tagGameRef.current = next
        return next
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [tagGame?.running])

  // ── Move joystick ──────────────────────────────────────────────────────────
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
    if (joyThumbRef.current) joyThumbRef.current.style.transform = `translate(${nx}px, ${ny}px)`
  }, [])
  const handleJoyEnd = useCallback(() => {
    joyBaseRef.current = null
    joystickRef.current = { vx: 0, vy: 0 }
    if (joyThumbRef.current) joyThumbRef.current.style.transform = "translate(0px, 0px)"
  }, [])

  // ── Look joystick ──────────────────────────────────────────────────────────
  const handleLookJoyStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    const t = e.touches[0]
    if (!t) return
    lookJoyBaseRef.current = { x: t.clientX, y: t.clientY }
  }, [])
  const handleLookJoyMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    if (!lookJoyBaseRef.current) return
    const t = e.touches[0]
    if (!t) return
    const dx = t.clientX - lookJoyBaseRef.current.x
    const dy = t.clientY - lookJoyBaseRef.current.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    const maxDist = 40
    const clamped = Math.min(dist, maxDist)
    const nx = dist > 0 ? (dx / dist) * clamped : 0
    const ny = dist > 0 ? (dy / dist) * clamped : 0
    lookJoyRef.current = { vx: nx / maxDist, vy: ny / maxDist }
    if (lookJoyThumbRef.current)
      lookJoyThumbRef.current.style.transform = `translate(${nx}px, ${ny}px)`
  }, [])
  const handleLookJoyEnd = useCallback(() => {
    lookJoyBaseRef.current = null
    lookJoyRef.current = { vx: 0, vy: 0 }
    if (lookJoyThumbRef.current) lookJoyThumbRef.current.style.transform = "translate(0px, 0px)"
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

  // ── Derived values ─────────────────────────────────────────────────────────
  const { level, xpInLevel, xpForNext } = computeXpProgress(playerStats.xp)
  const xpPct = xpForNext > 0 ? Math.round((xpInLevel / xpForNext) * 100) : 0
  const hpPct = Math.round((playerHp / PLAYER_MAX_HP) * 100)
  const ammoPct = Math.round((ammo / MAX_AMMO) * 100)
  const hpColor = playerHp > 60 ? "#00ff41" : playerHp > 30 ? "#ffaa00" : "#ff3333"
  const aliveEnemies = enemyStatus.filter((e) => e.hp > 0).length

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
      {/* ── HUD bar ───────────────────────────────────────────────────────── */}
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.4rem 0.75rem",
          background: "#000000",
          borderBottom: "1px solid #003300",
          flexWrap: "wrap",
        }}
      >
        {/* HP bar */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", minWidth: "130px" }}>
          <span
            style={{ color: "#ff3333", fontSize: "0.65rem", letterSpacing: "0.1em", flexShrink: 0 }}
          >
            HP
          </span>
          <div
            style={{
              flex: 1,
              height: "8px",
              background: "#1a0000",
              border: "1px solid #550000",
              overflow: "hidden",
              minWidth: "60px",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${hpPct}%`,
                background: hpColor,
                boxShadow: `0 0 6px ${hpColor}`,
                transition: "width 0.3s ease, background 0.3s",
              }}
            />
          </div>
          <span style={{ color: hpColor, fontSize: "0.65rem", flexShrink: 0 }}>{playerHp}</span>
        </div>

        {/* XP bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
            border: "1px solid #003300",
            padding: "0.2rem 0.5rem",
          }}
        >
          <span style={{ color: "#00ff41", fontSize: "0.65rem", letterSpacing: "0.1em" }}>
            LV.{level}
          </span>
          <div
            style={{
              width: "50px",
              height: "5px",
              background: "#001100",
              border: "1px solid #002200",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${xpPct}%`,
                background: "#00ff41",
                transition: "width 0.7s",
              }}
            />
          </div>
        </div>

        {/* Ammo */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <span style={{ color: "#8888ff", fontSize: "0.6rem", letterSpacing: "0.1em" }}>AMMO</span>
          <div
            style={{
              width: "40px",
              height: "5px",
              background: "#001133",
              border: "1px solid #223366",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: isReloading ? "100%" : `${ammoPct}%`,
                background: isReloading ? "#ffaa00" : "#8888ff",
                transition: isReloading ? `width ${RELOAD_TIME}ms linear` : "width 0.1s",
              }}
            />
          </div>
          <span
            style={{
              color: isReloading ? "#ffaa00" : "#8888ff",
              fontSize: "0.65rem",
              minWidth: "32px",
            }}
          >
            {isReloading ? "REL" : `${ammo}/${MAX_AMMO}`}
          </span>
        </div>

        {/* Score */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.35rem",
            border: "1px solid #222244",
            padding: "0.2rem 0.5rem",
          }}
        >
          <span style={{ color: "#ffcc00", fontSize: "0.65rem", letterSpacing: "0.1em" }}>
            SCORE
          </span>
          <span style={{ color: "#ffcc00", fontSize: "0.7rem", fontWeight: "bold" }}>
            {score.toString().padStart(5, "0")}
          </span>
        </div>

        {/* Enemies remaining */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <span style={{ color: "#ff5555", fontSize: "0.6rem", letterSpacing: "0.1em" }}>
            ENEMIES
          </span>
          <span style={{ color: "#ff5555", fontSize: "0.7rem", fontWeight: "bold" }}>
            {aliveEnemies}
          </span>
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
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
          <span style={{ color: "#00ff41", fontSize: "0.65rem" }}>{onlineCount} ONLINE</span>
        </div>

        {!isLoading &&
          !error &&
          (tagGame?.running ? (
            <div
              style={{
                color: "#ff3333",
                fontSize: "0.65rem",
                border: "1px solid #550000",
                padding: "0.2rem 0.5rem",
                whiteSpace: "nowrap",
              }}
            >
              IT: {tagGame.itUsername} · {Math.ceil(tagGame.remainingMs / 1000)}s
            </div>
          ) : (
            <button
              type="button"
              onClick={() =>
                wsRef.current?.readyState === WebSocket.OPEN &&
                wsRef.current.send(JSON.stringify({ type: "tag_start" }))
              }
              style={{
                background: "transparent",
                border: "1px solid #003300",
                color: "#005500",
                fontFamily: "monospace",
                fontSize: "0.6rem",
                letterSpacing: "0.08em",
                padding: "0.2rem 0.5rem",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              TAG
            </button>
          ))}

        {notification && (
          <span
            style={{
              fontSize: "0.7rem",
              color: "#00ff41",
              border: "1px solid #00ff41",
              padding: "0.15rem 0.6rem",
              textShadow: "0 0 8px #00ff41",
              whiteSpace: "nowrap",
            }}
          >
            {notification}
          </span>
        )}
      </div>

      {/* ── Canvas + overlays ─────────────────────────────────────────────── */}
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        <div ref={mountRef} style={{ width: "100%", height: "100%" }} />

        {/* Damage flash */}
        {damageFlash && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(255,0,0,0.25)",
              pointerEvents: "none",
              zIndex: 25,
            }}
          />
        )}

        {/* Loading */}
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
              LOADING 3D WORLD...
            </div>
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
              LOGIN
            </a>
          </div>
        )}

        {/* ENTER WORLD overlay */}
        {!isMobile && !isLoading && !error && !isPointerLocked && gamePhase === "playing" && (
          <button
            type="button"
            onClick={() => rendererDomRef.current?.requestPointerLock()}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "1rem",
              background: "rgba(0,0,0,0.6)",
              cursor: "pointer",
              border: "none",
              fontFamily: "monospace",
            }}
          >
            <div
              style={{
                color: "#00ff41",
                fontSize: "1.5rem",
                letterSpacing: "0.4em",
                textShadow: "0 0 30px #00ff41",
              }}
            >
              ENTER WORLD
            </div>
            <div style={{ color: "#005500", fontSize: "0.75rem", letterSpacing: "0.2em" }}>
              CLICK TO LOCK MOUSE · WASD: MOVE · MOUSE: AIM · LMB: FIRE · RMB: DESTROY
            </div>
          </button>
        )}

        {/* Crosshair */}
        {!isLoading && !error && (isPointerLocked || isMobile) && gamePhase === "playing" && (
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            aria-label="crosshair"
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              pointerEvents: "none",
              zIndex: 30,
            }}
          >
            <title>crosshair</title>
            <line
              x1="12"
              y1="2"
              x2="12"
              y2="9"
              stroke={aimedEnemyId ? "#ff3333" : "#00ff41"}
              strokeWidth="1.5"
              opacity="0.9"
            />
            <line
              x1="12"
              y1="15"
              x2="12"
              y2="22"
              stroke={aimedEnemyId ? "#ff3333" : "#00ff41"}
              strokeWidth="1.5"
              opacity="0.9"
            />
            <line
              x1="2"
              y1="12"
              x2="9"
              y2="12"
              stroke={aimedEnemyId ? "#ff3333" : "#00ff41"}
              strokeWidth="1.5"
              opacity="0.9"
            />
            <line
              x1="15"
              y1="12"
              x2="22"
              y2="12"
              stroke={aimedEnemyId ? "#ff3333" : "#00ff41"}
              strokeWidth="1.5"
              opacity="0.9"
            />
            <circle
              cx="12"
              cy="12"
              r="1.2"
              fill={aimedEnemyId ? "#ff3333" : "#00ff41"}
              opacity="0.8"
            />
            {aimedEnemyId && (
              <circle
                cx="12"
                cy="12"
                r="5"
                stroke="#ff3333"
                strokeWidth="0.8"
                fill="none"
                opacity="0.5"
              />
            )}
          </svg>
        )}

        {/* Enemy status (top-right) */}
        {!isLoading && !error && gamePhase === "playing" && (
          <div
            style={{
              position: "absolute",
              top: "0.5rem",
              right: "5.5rem",
              zIndex: 20,
              fontFamily: "monospace",
              display: "flex",
              flexDirection: "column",
              gap: "4px",
            }}
          >
            {enemyStatus.map((e, i) => {
              const typeColor = e.type === "boss" ? "#cc44ff" : e.type === "miniboss" ? "#ff8800" : "#ff5555"
              const hpBarColor = e.type === "boss" ? "#aa00ff" : e.type === "miniboss" ? "#ff6600" : "#ff2222"
              const label = e.type === "boss" ? "BOSS" : e.type === "miniboss" ? "MINI" : `E${i + 1}`
              const hpPctEnemy = e.maxHp > 0 ? Math.round((e.hp / e.maxHp) * 100) : 0
              return (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ color: typeColor, fontSize: "0.55rem", minWidth: "26px" }}>{label}</span>
                  <div style={{ width: "40px", height: "6px", background: "#1a0000", border: `1px solid ${typeColor}33`, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${hpPctEnemy}%`, background: hpBarColor, transition: "width 0.3s", boxShadow: e.hp > 0 ? `0 0 4px ${hpBarColor}` : "none" }} />
                  </div>
                  <span style={{ color: typeColor, fontSize: "0.55rem", minWidth: "24px" }}>
                    {e.hp}/{e.maxHp}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* Minimap */}
        {!isLoading && !error && (
          <canvas
            ref={minimapRef}
            width={80}
            height={80}
            style={{
              position: "absolute",
              top: "0.5rem",
              right: "0.5rem",
              border: "1px solid #003300",
              zIndex: 20,
              imageRendering: "pixelated",
            }}
          />
        )}

        {/* Move joystick */}
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
                pointerEvents: "none",
              }}
            />
          </div>
        )}

        {/* Look joystick */}
        {isMobile && !isLoading && !error && (
          <div
            style={{
              position: "absolute",
              bottom: "1rem",
              right: "1rem",
              width: "96px",
              height: "96px",
              borderRadius: "50%",
              background: "rgba(0,100,255,0.08)",
              border: "2px solid rgba(0,100,255,0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              touchAction: "none",
              zIndex: 20,
              userSelect: "none",
            }}
            onTouchStart={handleLookJoyStart}
            onTouchMove={handleLookJoyMove}
            onTouchEnd={handleLookJoyEnd}
          >
            <div
              ref={lookJoyThumbRef}
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "50%",
                background: "rgba(0,100,255,0.4)",
                border: "1px solid #0064ff",
                pointerEvents: "none",
              }}
            />
          </div>
        )}

        {/* Chat */}
        {!isLoading && !error && (
          <div
            style={{
              position: "absolute",
              bottom: isMobile ? "7.5rem" : "1rem",
              left: isMobile ? "7.5rem" : "1rem",
              width: "200px",
              zIndex: 20,
              fontFamily: "monospace",
              display: "flex",
              flexDirection: "column",
              gap: "4px",
            }}
          >
            <div
              style={{
                maxHeight: "90px",
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
                    fontSize: "0.65rem",
                    color: m.isSystem ? "#00aaff" : "#00ff41",
                    background: "rgba(0,0,0,0.75)",
                    padding: "2px 6px",
                    wordBreak: "break-all",
                  }}
                >
                  <span style={{ color: m.isSystem ? "#005588" : "#005500" }}>{m.from}: </span>
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
                  fontSize: "0.65rem",
                  padding: "3px 6px",
                  outline: "none",
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
                }}
              >
                ▶
              </button>
            </form>
          </div>
        )}

        {/* ── Combat Problem Modal ─────────────────────────────────────────── */}
        {activeProblem && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.88)",
              zIndex: 50,
              fontFamily: "monospace",
            }}
          >
            <div
              style={{
                width: "min(500px, 92vw)",
                border: "1px solid #ff3333",
                background: "#050505",
                padding: "1.5rem",
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
              }}
            >
              {/* Header */}
              <div
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <div style={{ color: "#ff3333", fontSize: "0.7rem", letterSpacing: "0.3em" }}>
                  ENEMY HIT — ANSWER TO DEAL DAMAGE
                </div>
                <div
                  style={{
                    color: problemTimeLeft <= 10 ? "#ff3333" : "#ffaa00",
                    fontSize: "1rem",
                    fontWeight: "bold",
                    letterSpacing: "0.1em",
                    border: `1px solid ${problemTimeLeft <= 10 ? "#550000" : "#553300"}`,
                    padding: "0.1rem 0.5rem",
                    minWidth: "3rem",
                    textAlign: "center",
                    animation:
                      problemTimeLeft <= 10 ? "pulse 0.5s ease-in-out infinite alternate" : "none",
                  }}
                >
                  {problemTimeLeft}s
                </div>
              </div>

              {/* Timer bar */}
              <div
                style={{
                  height: "3px",
                  background: "#1a0000",
                  border: "1px solid #330000",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${(problemTimeLeft / PROBLEM_TIME) * 100}%`,
                    background: problemTimeLeft <= 10 ? "#ff3333" : "#ffaa00",
                    transition: "width 1s linear",
                  }}
                />
              </div>

              {/* Question */}
              <div
                style={{
                  color: "#00ff41",
                  fontSize: "0.88rem",
                  letterSpacing: "0.05em",
                  lineHeight: 1.6,
                  padding: "0.75rem",
                  border: "1px solid #003300",
                  background: "rgba(0,20,0,0.5)",
                }}
              >
                {activeProblem.def.question}
              </div>

              {/* Choices */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                {activeProblem.def.choices.map((choice, i) => (
                  <button
                    key={choice}
                    type="button"
                    onClick={() => answerProblem(i === activeProblem.def.correct)}
                    style={{
                      background: "transparent",
                      border: "1px solid #225522",
                      color: "#00cc33",
                      fontFamily: "monospace",
                      fontSize: "0.78rem",
                      padding: "0.6rem 0.75rem",
                      cursor: "pointer",
                      textAlign: "left",
                      letterSpacing: "0.04em",
                      lineHeight: 1.4,
                    }}
                    onMouseEnter={(e) => {
                      ;(e.currentTarget as HTMLButtonElement).style.background =
                        "rgba(0,255,65,0.08)"
                      ;(e.currentTarget as HTMLButtonElement).style.borderColor = "#00ff41"
                    }}
                    onMouseLeave={(e) => {
                      ;(e.currentTarget as HTMLButtonElement).style.background = "transparent"
                      ;(e.currentTarget as HTMLButtonElement).style.borderColor = "#225522"
                    }}
                  >
                    <span style={{ color: "#005500", marginRight: "0.4rem" }}>
                      {["A", "B", "C", "D"][i]}.
                    </span>
                    {choice}
                  </button>
                ))}
              </div>

              <div
                style={{
                  color: "#334433",
                  fontSize: "0.6rem",
                  letterSpacing: "0.08em",
                  textAlign: "center",
                }}
              >
                正解: +50pt · 不正解: -20 HP · 時間切れ: -20 HP
              </div>
            </div>
          </div>
        )}

        {/* ── Game Over ────────────────────────────────────────────────────── */}
        {gamePhase === "gameover" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "1.5rem",
              background: "rgba(0,0,0,0.92)",
              zIndex: 60,
              fontFamily: "monospace",
            }}
          >
            <div
              style={{
                color: "#ff3333",
                fontSize: "2.5rem",
                fontWeight: "bold",
                letterSpacing: "0.4em",
                textShadow: "0 0 40px #ff3333",
              }}
            >
              GAME OVER
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "0.5rem",
                border: "1px solid #330000",
                padding: "1rem 2rem",
              }}
            >
              <div style={{ color: "#ffcc00", fontSize: "1rem", letterSpacing: "0.2em" }}>
                FINAL SCORE
              </div>
              <div
                style={{
                  color: "#ffcc00",
                  fontSize: "2rem",
                  fontWeight: "bold",
                  letterSpacing: "0.3em",
                }}
              >
                {score.toString().padStart(5, "0")}
              </div>
              <div style={{ color: "#554400", fontSize: "0.75rem" }}>
                ENEMIES DEFEATED: {enemyStatus.length - aliveEnemies}/{enemyStatus.length}
              </div>
              <div style={{ color: "#554400", fontSize: "0.75rem" }}>
                BLOCKS EARNED: {earnedBlocks}
              </div>
            </div>
            <div
              style={{ display: "flex", gap: "1rem", flexWrap: "wrap", justifyContent: "center" }}
            >
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  background: "transparent",
                  border: "1px solid #ff3333",
                  color: "#ff3333",
                  fontFamily: "monospace",
                  fontSize: "0.85rem",
                  letterSpacing: "0.2em",
                  padding: "0.6rem 1.5rem",
                  cursor: "pointer",
                }}
              >
                RETRY
              </button>
              <a
                href="/dungeon"
                style={{
                  border: "1px solid #003300",
                  color: "#005500",
                  fontFamily: "monospace",
                  fontSize: "0.85rem",
                  letterSpacing: "0.2em",
                  padding: "0.6rem 1.5rem",
                  textDecoration: "none",
                }}
              >
                DUNGEON
              </a>
            </div>
          </div>
        )}

        {/* ── Stage Clear ──────────────────────────────────────────────────── */}
        {gamePhase === "clear" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "1.5rem",
              background: "rgba(0,0,0,0.9)",
              zIndex: 60,
              fontFamily: "monospace",
            }}
          >
            <div
              style={{
                color: "#00ff41",
                fontSize: "2rem",
                fontWeight: "bold",
                letterSpacing: "0.4em",
                textShadow: "0 0 40px #00ff41",
              }}
            >
              STAGE CLEAR!
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "0.75rem",
                border: "1px solid #003300",
                padding: "1.25rem 2.5rem",
                background: "rgba(0,10,0,0.8)",
              }}
            >
              <div style={{ color: "#ffcc00", fontSize: "0.8rem", letterSpacing: "0.3em" }}>
                RESULT
              </div>
              <div
                style={{ display: "flex", gap: "2rem", flexWrap: "wrap", justifyContent: "center" }}
              >
                <div style={{ textAlign: "center" }}>
                  <div style={{ color: "#446644", fontSize: "0.65rem", letterSpacing: "0.2em" }}>
                    SCORE
                  </div>
                  <div style={{ color: "#ffcc00", fontSize: "1.5rem", fontWeight: "bold" }}>
                    {score.toString().padStart(5, "0")}
                  </div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ color: "#446644", fontSize: "0.65rem", letterSpacing: "0.2em" }}>
                    BLOCKS EARNED
                  </div>
                  <div style={{ color: "#00cfff", fontSize: "1.5rem", fontWeight: "bold" }}>
                    {earnedBlocks}
                  </div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ color: "#446644", fontSize: "0.65rem", letterSpacing: "0.2em" }}>
                    SURVIVORS
                  </div>
                  <div style={{ color: "#00ff41", fontSize: "1.5rem", fontWeight: "bold" }}>
                    {playerHp} HP
                  </div>
                </div>
              </div>
            </div>
            <div
              style={{ display: "flex", gap: "1rem", flexWrap: "wrap", justifyContent: "center" }}
            >
              <a
                href="/world"
                style={{
                  border: "1px solid #00ff41",
                  color: "#00ff41",
                  fontFamily: "monospace",
                  fontSize: "0.85rem",
                  letterSpacing: "0.2em",
                  padding: "0.6rem 1.5rem",
                  textDecoration: "none",
                  textShadow: "0 0 8px #00ff41",
                }}
              >
                BUILD WORLD
              </a>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  background: "transparent",
                  border: "1px solid #003300",
                  color: "#005500",
                  fontFamily: "monospace",
                  fontSize: "0.85rem",
                  letterSpacing: "0.2em",
                  padding: "0.6rem 1.5rem",
                  cursor: "pointer",
                }}
              >
                PLAY AGAIN
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Inventory bar ─────────────────────────────────────────────────── */}
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
            letterSpacing: "0.1em",
            marginBottom: "0.3rem",
          }}
        >
          LMB: FIRE / PLACE BLOCK · RMB: DESTROY · R: RELOAD · ESC: DESELECT
          <a
            href="/dungeon"
            style={{ color: "#00aa2a", marginLeft: "0.5rem", textDecoration: "underline" }}
          >
            DUNGEON
          </a>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span
            style={{ flexShrink: 0, color: "#003300", fontSize: "0.6rem", letterSpacing: "0.15em" }}
          >
            INV
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
                  fontSize: "0.72rem",
                }}
              >
                <span style={{ color: "#003300", letterSpacing: "0.08em" }}>NO BLOCKS</span>
                <a
                  href="/problems"
                  style={{ color: "#00aa2a", letterSpacing: "0.08em", textDecoration: "underline" }}
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
                        gap: "0.4rem",
                        padding: "0.2rem 0.6rem",
                        fontFamily: "monospace",
                        fontSize: "0.72rem",
                        letterSpacing: "0.08em",
                        border: isSelected ? `1px solid ${info.color}` : "1px solid #003300",
                        background: isSelected ? "rgba(0,255,65,0.05)" : "transparent",
                        color: isSelected ? "#00ff41" : "#005500",
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          width: "7px",
                          height: "7px",
                          flexShrink: 0,
                          background: info.color,
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
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <span style={{ color: "#00ff41", fontSize: "0.65rem", letterSpacing: "0.1em" }}>
                SEL
              </span>
              <button
                type="button"
                onClick={() => setSelectedBlock(null)}
                style={{
                  color: "#003300",
                  fontSize: "0.6rem",
                  border: "1px solid #003300",
                  padding: "0.1rem 0.35rem",
                  background: "transparent",
                  fontFamily: "monospace",
                  cursor: "pointer",
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
