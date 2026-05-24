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
const BULLET_SPEED = 35
const ENEMY_BULLET_SPEED = 14
const RECOIL_RECOVER = 8
const MUZZLE_FLASH_DURATION = 0.07
const PLAYER_RADIUS = 0.35
const ENEMY_RADIUS = 0.4
const ENEMY_NO_RESPAWN = 9999
const PARTICLE_COUNT = 10
const PARTICLE_LIFETIME = 0.5
const SPRINT_MULTIPLIER = 1.5
const AUTO_RECOVER_DELAY = 5
const RECOVER_RATE = 2
const CAM_SHAKE_DECAY = 6

// ── Weapon definitions ─────────────────────────────────────────────────────────
interface WeaponDef {
  id: "pistol" | "shotgun" | "sniper"
  name: string
  maxAmmo: number // -1 = infinite
  hitDamage: number
  reloadTime: number
  spread: number
  pellets: number
  bulletLifetime: number
  bulletColor: number
  recoil: number
}

const WEAPONS: WeaponDef[] = [
  {
    id: "pistol",
    name: "PISTOL",
    maxAmmo: -1,
    hitDamage: 20,
    reloadTime: 0,
    spread: 0,
    pellets: 1,
    bulletLifetime: 0.38,
    bulletColor: 0xffff88,
    recoil: 0.08,
  },
  {
    id: "shotgun",
    name: "SHOTGUN",
    maxAmmo: 8,
    hitDamage: 55,
    reloadTime: 2500,
    spread: 0.09,
    pellets: 5,
    bulletLifetime: 0.14,
    bulletColor: 0xff8800,
    recoil: 0.2,
  },
  {
    id: "sniper",
    name: "SNIPER",
    maxAmmo: 5,
    hitDamage: 120,
    reloadTime: 3000,
    spread: 0,
    pellets: 1,
    bulletLifetime: 1.6,
    bulletColor: 0x00ffff,
    recoil: 0.28,
  },
]

// ── Sound system (Web Audio API) ───────────────────────────────────────────────
let _audioCtx: AudioContext | null = null
function _getCtx(): AudioContext {
  if (!_audioCtx) _audioCtx = new AudioContext()
  if (_audioCtx.state === "suspended") _audioCtx.resume().catch(() => {})
  return _audioCtx
}
function _noise(dur: number, gain: number, fType: BiquadFilterType, fFreq: number) {
  const ctx = _getCtx()
  const now = ctx.currentTime
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  src.buffer = buf
  const f = ctx.createBiquadFilter()
  f.type = fType
  f.frequency.value = fFreq
  const g = ctx.createGain()
  g.gain.setValueAtTime(gain, now)
  g.gain.exponentialRampToValueAtTime(0.001, now + dur)
  src.connect(f)
  f.connect(g)
  g.connect(ctx.destination)
  src.start()
}
function _tone(
  freq: number,
  dur: number,
  gain: number,
  type: OscillatorType = "sine",
  freqEnd?: number,
) {
  const ctx = _getCtx()
  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, now)
  if (freqEnd !== undefined) osc.frequency.linearRampToValueAtTime(freqEnd, now + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(gain, now)
  g.gain.exponentialRampToValueAtTime(0.001, now + dur)
  osc.connect(g)
  g.connect(ctx.destination)
  osc.start()
  osc.stop(now + dur)
}

const SOUNDS = {
  pistol() {
    _noise(0.12, 0.55, "bandpass", 1100)
    _tone(85, 0.1, 0.28, "sawtooth")
  },
  shotgun() {
    _noise(0.22, 0.8, "lowpass", 550)
    _tone(55, 0.18, 0.38, "sawtooth")
  },
  sniper() {
    _noise(0.07, 0.45, "highpass", 2800)
    _tone(180, 0.32, 0.22, "sine")
  },
  hit() {
    _tone(950, 0.07, 0.28, "square")
    _tone(620, 0.11, 0.18, "sine")
  },
  damage() {
    _noise(0.14, 0.5, "lowpass", 280)
    _tone(110, 0.14, 0.32, "sawtooth")
  },
  alert() {
    _tone(440, 0.3, 0.18, "square", 900)
  },
  clear() {
    const ctx = _getCtx()
    const now = ctx.currentTime
    ;[523, 659, 784, 1047].forEach((hz, i) => {
      const o = ctx.createOscillator()
      o.type = "sine"
      o.frequency.value = hz
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.28, now + i * 0.18)
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.38)
      o.connect(g)
      g.connect(ctx.destination)
      o.start(now + i * 0.18)
      o.stop(now + i * 0.18 + 0.38)
    })
  },
  gameover() {
    const ctx = _getCtx()
    const now = ctx.currentTime
    ;[440, 349, 277, 220].forEach((hz, i) => {
      const o = ctx.createOscillator()
      o.type = "sawtooth"
      o.frequency.value = hz
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.22, now + i * 0.24)
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.24 + 0.48)
      o.connect(g)
      g.connect(ctx.destination)
      o.start(now + i * 0.24)
      o.stop(now + i * 0.24 + 0.48)
    })
  },
}

// ── Map wall definitions [x, z, width, depth] ──────────────────────────────────
const WALL_DEFS: [number, number, number, number][] = [
  [3, 3, 4, 4],
  [9, 1, 3, 5],
  [14, 8, 5, 4],
  [22, 3, 4, 6],
  [5, 14, 2, 5],
  [20, 12, 4, 2],
  [7, 21, 4, 3],
  [17, 21, 5, 4],
  [25, 18, 3, 6],
  [10, 26, 5, 3],
  [2, 26, 3, 3],
  [27, 8, 2, 5],
  [5, 9, 1, 1],
  [12, 17, 1, 1],
  [18, 7, 1, 1],
  [24, 15, 1, 1],
]
type WallAABB = { x1: number; z1: number; x2: number; z2: number }
const WALL_AABBS: WallAABB[] = WALL_DEFS.map(([x, z, w, d]) => ({
  x1: x,
  z1: z,
  x2: x + w,
  z2: z + d,
}))

// ── Cover objects [x, z, width, depth, height] ─────────────────────────────────
const COVER_DEFS: [number, number, number, number, number][] = [
  // Wooden crates
  [6.0, 5.5, 1.0, 1.0, 0.9],
  [8.5, 12.0, 1.0, 1.0, 0.9],
  [13.0, 11.0, 1.0, 1.0, 0.9],
  [19.5, 4.5, 1.0, 1.0, 0.9],
  // Metal barriers (long low walls)
  [21.0, 10.0, 2.8, 0.4, 0.85],
  [15.0, 19.0, 0.4, 2.8, 0.85],
  [9.0, 17.0, 2.5, 0.4, 0.85],
  // Car-like hulks (wider, lower)
  [11.0, 5.0, 1.8, 0.9, 0.75],
  [24.0, 20.0, 1.8, 0.9, 0.75],
  [4.5, 20.5, 0.9, 1.8, 0.75],
]
const COVER_AABBS: WallAABB[] = COVER_DEFS.map(([x, z, w, d]) => ({
  x1: x,
  z1: z,
  x2: x + w,
  z2: z + d,
}))
const ALL_AABBS: WallAABB[] = [...WALL_AABBS, ...COVER_AABBS]

function collidesWithWall(px: number, pz: number, radius: number): boolean {
  if (px - radius < 0 || px + radius > MAP_SIZE || pz - radius < 0 || pz + radius > MAP_SIZE)
    return true
  for (const w of ALL_AABBS) {
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
  fireRange: number
  fireInterval: number
  fireDamage: number
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
    hp: 60,
    speed: 1.6,
    attackDamage: 8,
    attackInterval: 2500,
    attackRange: 1.8,
    fireRange: 10,
    fireInterval: 2500,
    fireDamage: 8,
    color: 0x0a0a1e,
    emissive: 0x220000,
    bodyW: 0.65,
    bodyH: 1.4,
    sightRange: 14,
    fovAngle: Math.PI,
    score: 100,
    blockReward: 1,
  },
  miniboss: {
    hp: 150,
    speed: 1.28,
    attackDamage: 12,
    attackInterval: 2500,
    attackRange: 2.0,
    fireRange: 14,
    fireInterval: 2200,
    fireDamage: 12,
    color: 0x0a1428,
    emissive: 0x001133,
    bodyW: 0.85,
    bodyH: 2.1,
    sightRange: 18,
    fovAngle: Math.PI * 0.9,
    score: 300,
    blockReward: 3,
  },
  boss: {
    hp: 400,
    speed: 0.96,
    attackDamage: 20,
    attackInterval: 2500,
    attackRange: 2.5,
    fireRange: 20,
    fireInterval: 2000,
    fireDamage: 20,
    color: 0x1a0030,
    emissive: 0x330055,
    bodyW: 1.1,
    bodyH: 2.5,
    sightRange: 24,
    fovAngle: Math.PI * 0.8,
    score: 500,
    blockReward: 8,
  },
}

// ── Wave system ────────────────────────────────────────────────────────────────
interface WaveDef {
  grunt: number
  miniboss: number
  boss: number
}
const WAVE_DEFS: WaveDef[] = [
  { grunt: 5, miniboss: 0, boss: 0 },
  { grunt: 5, miniboss: 2, boss: 0 },
  { grunt: 3, miniboss: 2, boss: 1 },
]
const SPAWN_POINTS = [
  { x: 1.5, z: 1.5 },
  { x: 16, z: 1.5 },
  { x: 30, z: 1.5 },
  { x: 30, z: 16 },
  { x: 30, z: 30 },
  { x: 16, z: 30 },
  { x: 1.5, z: 30 },
  { x: 1.5, z: 16 },
  { x: 8, z: 8 },
  { x: 24, z: 8 },
  { x: 8, z: 24 },
  { x: 24, z: 24 },
]

function enemyCanSee(
  facingX: number,
  facingZ: number,
  toDx: number,
  toDz: number,
  dist: number,
  cfg: EnemyConfig,
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
  { startTX: 0, endTX: 9, color: 0x05080f },
  { startTX: 10, endTX: 21, color: 0x080808 },
  { startTX: 22, endTX: 31, color: 0x0a0514 },
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
  lastFireTime: number
  facing: THREE.Vector3
  lastSeenPlayer: { x: number; z: number } | null
  searchTimer: number
  respawnTimer: number
  spawnX: number
  spawnZ: number
  dyingTimer: number // 2→0 during death anim, -1 when fully dead
}

interface Bullet {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  life: number
  isEnemy: boolean
}

interface BloodParticle {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  life: number
  maxLife: number
}

interface ExplosionParticle {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  life: number
  maxLife: number
  isSpark: boolean
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
  bloodParticles: BloodParticle[]
  muzzleLight: THREE.PointLight
  aimedEnemyId: string | null
  explosionParticles: ExplosionParticle[]
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
  const lastDamageTimeRef = useRef<number>(Date.now())
  const cameraShakeRef = useRef({ intensity: 0 })
  const consecutiveKillsRef = useRef(0)
  const lastKillTimeRef = useRef(0)
  const killStreakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reloadStartTimeRef = useRef<number | null>(null)
  // Wave system refs
  const currentWaveRef = useRef(-1)
  const waveActiveRef = useRef(false)
  const missionCompleteRef = useRef(false)
  const spawnWaveRef = useRef<((waveIdx: number) => void) | null>(null)

  // Combat refs
  const recoilRef = useRef(0)
  const playerHpRef = useRef(PLAYER_MAX_HP)
  const gamePhaseRef = useRef<"playing" | "gameover">("playing")
  const ammoRef = useRef(-1) // -1 = infinite (pistol default)
  const reloadingRef = useRef(false)
  const scoreRef = useRef(0)
  const killsRef = useRef(0)
  const deathsRef = useRef(0)
  const muzzleFlashTimerRef = useRef(0)
  const mouseDownRef = useRef(false)
  const lastFireTimeRef = useRef(0)
  // Weapon refs
  const currentWeaponIdxRef = useRef(0)
  const weaponAmmoRef = useRef<[number, number, number]>([-1, 8, 5])

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
  const [ammo, setAmmo] = useState(-1) // -1 = infinite
  const [currentWeaponIdx, setCurrentWeaponIdx] = useState(0)
  const [unlockedWeapons, setUnlockedWeapons] = useState<Set<string>>(new Set(["pistol"]))
  const [score, setScore] = useState(0)
  const [kills, setKills] = useState(0)
  const [deaths, setDeaths] = useState(0)
  const [gamePhase, setGamePhase] = useState<"playing" | "gameover">("playing")
  const [enemyStatus, setEnemyStatus] = useState<
    Array<{ id: string; hp: number; maxHp: number; type: EnemyType; alive: boolean }>
  >([])
  const [aimedEnemyId, setAimedEnemyId] = useState<string | null>(null)
  const [isReloading, setIsReloading] = useState(false)
  const [damageFlash, setDamageFlash] = useState(false)
  const [killStreakMsg, setKillStreakMsg] = useState<string | null>(null)
  const [headshotMsg, setHeadshotMsg] = useState(false)
  // Cyberpunk / wave state
  const [showBriefing, setShowBriefing] = useState(true)
  const [currentWave, setCurrentWave] = useState(0)
  const [waveMessage, setWaveMessage] = useState<string | null>(null)
  const [missionComplete, setMissionComplete] = useState(false)

  useEffect(() => {
    selectedBlockRef.current = selectedBlock
  }, [selectedBlock])
  useEffect(() => {
    setIsMobile(navigator.maxTouchPoints > 0)
    try {
      const stored = localStorage.getItem("fps_unlocked_weapons")
      if (stored) {
        const list = JSON.parse(stored) as string[]
        setUnlockedWeapons(new Set(list))
      }
    } catch {
      /* ignore */
    }
  }, [])
  useEffect(() => {
    if (gamePhase === "gameover") SOUNDS.gameover()
  }, [gamePhase])
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
      scene.background = new THREE.Color(0x020208)
      scene.fog = new THREE.Fog(0x020208, 25, 70)

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

      // ── Cyberpunk ruins / buildings ────────────────────────────────────────
      const wallMeshes: THREE.Mesh[] = []
      const wallMatRuin = new THREE.MeshLambertMaterial({ color: 0x111118, emissive: 0x000011 })
      const wallMatServer = new THREE.MeshLambertMaterial({ color: 0x0a1020, emissive: 0x001122 })
      const wallMatPillar = new THREE.MeshLambertMaterial({ color: 0x150a22, emissive: 0x110033 })
      for (const [wx, wz, ww, wd] of WALL_DEFS) {
        const isPillar = ww === 1 && wd === 1
        const isServerRack = ww * wd <= 6 && !isPillar
        const wallH = isPillar ? 2.0 : ww * wd > 8 ? 4.5 : 3.2
        const mat = isPillar ? wallMatPillar : isServerRack ? wallMatServer : wallMatRuin
        const geo = new THREE.BoxGeometry(ww, wallH, wd)
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.set(wx + ww / 2, wallH / 2, wz + wd / 2)
        mesh.castShadow = true
        mesh.receiveShadow = true
        scene.add(mesh)
        wallMeshes.push(mesh)
        // Neon trim strip on large buildings
        if (!isPillar && ww * wd > 4) {
          const trimColor = isServerRack ? 0x0088ff : 0x00ffaa
          const trimGeo = new THREE.BoxGeometry(ww + 0.02, 0.06, wd + 0.02)
          const trimMat = new THREE.MeshBasicMaterial({ color: trimColor })
          const trim = new THREE.Mesh(trimGeo, trimMat)
          trim.position.set(wx + ww / 2, wallH - 0.03, wz + wd / 2)
          scene.add(trim)
        }
      }

      // ── Cyberpunk cover: server racks / wrecked vehicles / barriers ────────
      const serverRackMat = new THREE.MeshLambertMaterial({ color: 0x0a0f1a, emissive: 0x001133 })
      const vehicleMat = new THREE.MeshLambertMaterial({ color: 0x1a1008, emissive: 0x110500 })
      const barrierMat = new THREE.MeshLambertMaterial({ color: 0x0d1520, emissive: 0x002233 })
      for (const [cx, cz, cw, cd, ch] of COVER_DEFS) {
        const isCar = cw >= 1.5 || cd >= 1.5
        const isBarrier = (cw >= 2.0 || cd >= 2.0) && ch < 0.9
        const coverMeshMat = isCar ? vehicleMat : isBarrier ? barrierMat : serverRackMat
        const geo = new THREE.BoxGeometry(cw, ch, cd)
        const mesh = new THREE.Mesh(geo, coverMeshMat)
        mesh.position.set(cx + cw / 2, ch / 2, cz + cd / 2)
        mesh.castShadow = true
        mesh.receiveShadow = true
        scene.add(mesh)
        wallMeshes.push(mesh)
        // Server rack: LED indicator strip
        if (!isCar && !isBarrier) {
          const ledGeo = new THREE.BoxGeometry(cw * 0.6, 0.04, 0.02)
          const ledMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 })
          const led = new THREE.Mesh(ledGeo, ledMat)
          led.position.set(cx + cw / 2, ch * 0.8, cz + cd + 0.01)
          scene.add(led)
        }
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

      // ── Cyberpunk enemy factory ────────────────────────────────────────────
      let enemyIdCounter = 0
      function makeEnemy(type: EnemyType, x: number, z: number): CombatEnemy {
        const cfg = ENEMY_CONFIGS[type]
        const bodyDepth = type === "grunt" ? cfg.bodyW * 0.55 : cfg.bodyW
        const bodyGeo = new THREE.BoxGeometry(cfg.bodyW, cfg.bodyH, bodyDepth)
        const bodyMat = new THREE.MeshLambertMaterial({ color: cfg.color, emissive: cfg.emissive })
        const mesh = new THREE.Mesh(bodyGeo, bodyMat)
        mesh.position.set(x, cfg.bodyH / 2, z)
        mesh.castShadow = true
        scene.add(mesh)

        if (type === "grunt") {
          // AI Drone: 4 legs + red LED eye
          const legMat = new THREE.MeshLambertMaterial({ color: 0x080810, emissive: 0x110000 })
          for (let li = 0; li < 4; li++) {
            const legGeo = new THREE.BoxGeometry(0.04, 0.42, 0.04)
            const leg = new THREE.Mesh(legGeo, legMat)
            leg.position.set(
              (li < 2 ? -1 : 1) * 0.22,
              -cfg.bodyH * 0.4,
              (li % 2 === 0 ? 1 : -1) * 0.14,
            )
            mesh.add(leg)
          }
          const eyeGeo = new THREE.BoxGeometry(cfg.bodyW * 0.68, 0.05, 0.03)
          const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 })
          const eye = new THREE.Mesh(eyeGeo, eyeMat)
          eye.position.set(0, cfg.bodyH * 0.23, bodyDepth / 2 + 0.02)
          mesh.add(eye)
          const glow = new THREE.PointLight(0xff0000, 0.5, 2.5)
          mesh.add(glow)
        } else if (type === "miniboss") {
          // Heavy Robot: shoulder pads + blue visor
          const shoulderMat = new THREE.MeshLambertMaterial({ color: 0x1a2535, emissive: 0x001133 })
          for (const sx of [-cfg.bodyW * 0.62, cfg.bodyW * 0.62]) {
            const s = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.28, 0.5), shoulderMat)
            s.position.set(sx, cfg.bodyH * 0.28, 0)
            mesh.add(s)
          }
          const visor = new THREE.Mesh(
            new THREE.BoxGeometry(cfg.bodyW * 0.72, 0.07, 0.03),
            new THREE.MeshBasicMaterial({ color: 0x00aaff }),
          )
          visor.position.set(0, cfg.bodyH * 0.27, cfg.bodyW / 2 + 0.02)
          mesh.add(visor)
          const glow = new THREE.PointLight(0x0066ff, 0.7, 4)
          mesh.add(glow)
        } else {
          // Boss: AI Core with tentacle arms + spine shards + magenta eye
          const armMat = new THREE.MeshLambertMaterial({ color: 0x2a0050, emissive: 0x220044 })
          for (let ai = 0; ai < 4; ai++) {
            const angle = (ai / 4) * Math.PI * 2
            const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.95), armMat)
            arm.position.set(Math.cos(angle) * 0.75, cfg.bodyH * 0.06, Math.sin(angle) * 0.75)
            arm.rotation.y = angle
            mesh.add(arm)
          }
          const spineMat = new THREE.MeshLambertMaterial({ color: 0x440088, emissive: 0x330066 })
          for (let si = 0; si < 4; si++) {
            const angle = (si / 4) * Math.PI * 2 + Math.PI / 4
            const spine = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.38, 0.1), spineMat)
            spine.position.set(Math.cos(angle) * 0.5, cfg.bodyH * 0.26, Math.sin(angle) * 0.5)
            mesh.add(spine)
          }
          const eye = new THREE.Mesh(
            new THREE.BoxGeometry(cfg.bodyW * 0.52, 0.07, 0.03),
            new THREE.MeshBasicMaterial({ color: 0xff00ff }),
          )
          eye.position.set(0, cfg.bodyH * 0.18, cfg.bodyW / 2 + 0.02)
          mesh.add(eye)
          const glow = new THREE.PointLight(0xaa00ff, 1.2, 6)
          mesh.add(glow)
        }

        const patrol = [
          { x, z },
          {
            x: Math.max(2, Math.min(MAP_SIZE - 2, x + 5)),
            z: Math.max(2, Math.min(MAP_SIZE - 2, z + 5)),
          },
          {
            x: Math.max(2, Math.min(MAP_SIZE - 2, x - 5)),
            z: Math.max(2, Math.min(MAP_SIZE - 2, z + 5)),
          },
          {
            x: Math.max(2, Math.min(MAP_SIZE - 2, x - 5)),
            z: Math.max(2, Math.min(MAP_SIZE - 2, z - 5)),
          },
        ]
        return {
          id: `enemy_${enemyIdCounter++}`,
          mesh,
          hp: cfg.hp,
          maxHp: cfg.hp,
          type,
          config: cfg,
          state: "patrol" as EnemyState,
          patrolWaypoints: patrol,
          patrolIndex: 0,
          lastAttackTime: 0,
          lastFireTime: 0,
          facing: new THREE.Vector3(0, 0, 1),
          lastSeenPlayer: null,
          searchTimer: 0,
          respawnTimer: ENEMY_NO_RESPAWN,
          spawnX: x,
          spawnZ: z,
          dyingTimer: -1,
        }
      }

      // ── Wave spawner ───────────────────────────────────────────────────────
      const enemies: CombatEnemy[] = []
      function spawnWave(waveIdx: number) {
        for (const e of enemies) scene.remove(e.mesh)
        enemies.length = 0
        const def = WAVE_DEFS[waveIdx]
        if (!def) return
        const types: EnemyType[] = [
          ...Array<EnemyType>(def.grunt).fill("grunt"),
          ...Array<EnemyType>(def.miniboss).fill("miniboss"),
          ...Array<EnemyType>(def.boss).fill("boss"),
        ]
        const shuffled = [...SPAWN_POINTS].sort(() => Math.random() - 0.5)
        for (let i = 0; i < types.length; i++) {
          const sp = shuffled[i % shuffled.length] ?? shuffled[0]
          if (!sp) continue
          const type = types[i] ?? "grunt"
          const x = Math.max(1.5, Math.min(MAP_SIZE - 1.5, sp.x + (Math.random() - 0.5) * 2))
          const z = Math.max(1.5, Math.min(MAP_SIZE - 1.5, sp.z + (Math.random() - 0.5) * 2))
          enemies.push(makeEnemy(type, x, z))
        }
        setEnemyStatus(
          enemies.map((e) => ({ id: e.id, hp: e.hp, maxHp: e.maxHp, type: e.type, alive: true })),
        )
      }
      spawnWaveRef.current = spawnWave

      const bullets: Bullet[] = []
      const bloodParticles: BloodParticle[] = []
      const explosionParticles: ExplosionParticle[] = []

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
        bloodParticles,
        muzzleLight,
        aimedEnemyId: null,
        explosionParticles,
      }

      setEnemyStatus([])

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

      // ── Create bullet (weapon-aware) ───────────────────────────────────────
      function createBullet(weapon: WeaponDef, spreadX = 0, spreadY = 0) {
        const fwd = new THREE.Vector3()
        camera.getWorldDirection(fwd)
        if (spreadX !== 0 || spreadY !== 0) {
          const right = new THREE.Vector3()
            .crossVectors(fwd, new THREE.Vector3(0, 1, 0))
            .normalize()
          const up = new THREE.Vector3().crossVectors(right, fwd).normalize()
          fwd.addScaledVector(right, spreadX).addScaledVector(up, spreadY).normalize()
        }
        const bulletGeo = new THREE.BoxGeometry(0.022, 0.022, 0.28)
        const bulletMat = new THREE.MeshBasicMaterial({
          color: weapon.bulletColor,
          depthTest: false,
        })
        const bulletMesh = new THREE.Mesh(bulletGeo, bulletMat)
        bulletMesh.renderOrder = 998
        bulletMesh.position.copy(camera.position).addScaledVector(fwd, 0.55)
        bulletMesh.lookAt(bulletMesh.position.clone().add(fwd))
        scene.add(bulletMesh)
        bullets.push({
          mesh: bulletMesh,
          velocity: fwd.clone().multiplyScalar(BULLET_SPEED),
          life: weapon.bulletLifetime,
          isEnemy: false,
        })
        muzzleFlashTimerRef.current = MUZZLE_FLASH_DURATION
      }

      // ── Reload helper ──────────────────────────────────────────────────────
      function startReload(weapon: WeaponDef) {
        if (reloadingRef.current || weapon.maxAmmo === -1) return
        reloadingRef.current = true
        reloadStartTimeRef.current = Date.now()
        setIsReloading(true)
        showNotification(`RELOADING ${weapon.name}...`)
        setTimeout(() => {
          const idx = currentWeaponIdxRef.current
          const reloadedWeapon = WEAPONS[idx]
          if (!reloadedWeapon) return
          weaponAmmoRef.current[idx] = reloadedWeapon.maxAmmo
          ammoRef.current = reloadedWeapon.maxAmmo
          setAmmo(reloadedWeapon.maxAmmo)
          reloadingRef.current = false
          reloadStartTimeRef.current = null
          setIsReloading(false)
        }, weapon.reloadTime)
      }

      // ── Spawn blood particles ──────────────────────────────────────────────
      function spawnBlood(pos: THREE.Vector3) {
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const geo = new THREE.SphereGeometry(0.04 + Math.random() * 0.04, 4, 4)
          const mat = new THREE.MeshBasicMaterial({ color: 0xcc0000 })
          const mesh = new THREE.Mesh(geo, mat)
          mesh.position.copy(pos)
          scene.add(mesh)
          const vel = new THREE.Vector3(
            (Math.random() - 0.5) * 4,
            Math.random() * 3 + 1,
            (Math.random() - 0.5) * 4,
          )
          bloodParticles.push({
            mesh,
            velocity: vel,
            life: PARTICLE_LIFETIME,
            maxLife: PARTICLE_LIFETIME,
          })
        }
      }

      // ── Spawn explosion / spark particles ─────────────────────────────────
      function spawnExplosion(pos: THREE.Vector3, isSpark = false) {
        const refs = sceneRef.current
        if (!refs) return
        const count = isSpark ? 6 : 18
        const lifetime = isSpark ? 0.28 : 0.75
        const speed = isSpark ? 5 : 3.5
        for (let i = 0; i < count; i++) {
          const size = isSpark ? 0.03 : 0.06 + Math.random() * 0.1
          const color = isSpark ? 0xffaa00 : i % 2 === 0 ? 0xff6600 : 0xffcc00
          const geo = new THREE.BoxGeometry(size, size, size)
          const mat = new THREE.MeshBasicMaterial({ color })
          const mesh = new THREE.Mesh(geo, mat)
          mesh.position.copy(pos)
          scene.add(mesh)
          const vel = new THREE.Vector3(
            (Math.random() - 0.5) * speed * 2,
            Math.random() * speed + 1,
            (Math.random() - 0.5) * speed * 2,
          )
          refs.explosionParticles.push({
            mesh,
            velocity: vel,
            life: lifetime * (0.5 + Math.random() * 0.5),
            maxLife: lifetime,
            isSpark,
          })
        }
      }

      // ── Fire weapon ────────────────────────────────────────────────────────
      function fire() {
        if (gamePhaseRef.current !== "playing") return
        const weapon = WEAPONS[currentWeaponIdxRef.current]
        if (!weapon) return
        if (reloadingRef.current) return
        if (weapon.maxAmmo !== -1 && ammoRef.current <= 0) {
          startReload(weapon)
          return
        }

        // Rate-limit pistol (auto-fire)
        const now = Date.now()
        if (weapon.id === "pistol" && now - lastFireTimeRef.current < 120) return
        lastFireTimeRef.current = now

        // Consume ammo
        if (weapon.maxAmmo !== -1) {
          ammoRef.current -= 1
          weaponAmmoRef.current[currentWeaponIdxRef.current] = ammoRef.current
          setAmmo(ammoRef.current)
        }

        recoilRef.current = weapon.recoil

        // Spawn visual bullets (spread for shotgun)
        for (let p = 0; p < weapon.pellets; p++) {
          const sx = weapon.spread > 0 ? (Math.random() - 0.5) * weapon.spread * 2 : 0
          const sy = weapon.spread > 0 ? (Math.random() - 0.5) * weapon.spread * 2 : 0
          createBullet(weapon, sx, sy)
        }

        // Play shot sound
        SOUNDS[weapon.id]()

        // Center-ray hit detection
        pointer.set(0, 0)
        raycaster.setFromCamera(pointer, camera)
        const aliveEnemies = enemies.filter((e) => e.hp > 0)
        const enemyHits = raycaster.intersectObjects(
          aliveEnemies.map((e) => e.mesh),
          false,
        )
        if (enemyHits.length > 0) {
          const hitEnemy = aliveEnemies.find((e) => e.mesh === enemyHits[0]?.object)
          if (hitEnemy && enemyHits[0]) {
            SOUNDS.hit()
            spawnBlood(enemyHits[0].point)
            const bodyH = hitEnemy.config.bodyH
            const enemyBottomY = hitEnemy.mesh.position.y - bodyH / 2
            const isHeadshot = enemyHits[0].point.y >= enemyBottomY + bodyH * 0.67
            const dmg = isHeadshot ? weapon.hitDamage * 2 : weapon.hitDamage
            if (isHeadshot) {
              setHeadshotMsg(true)
              setTimeout(() => setHeadshotMsg(false), 800)
            }
            hitEnemy.hp -= dmg
            scoreRef.current += Math.floor(dmg * 10)
            setScore(scoreRef.current)
            if (hitEnemy.hp <= 0) {
              hitEnemy.hp = 0
              hitEnemy.dyingTimer = 2.0
              hitEnemy.state = "patrol"
              killsRef.current += 1
              setKills(killsRef.current)
              scoreRef.current += hitEnemy.config.score
              setScore(scoreRef.current)
              const tag =
                hitEnemy.type === "boss"
                  ? "BOSS撃破！"
                  : hitEnemy.type === "miniboss"
                    ? "ミニボス撃破！"
                    : "KILL!"
              showNotification(`${tag} +${hitEnemy.config.score}pt`)
              // Kill streak tracking
              const nowKill = Date.now()
              if (nowKill - lastKillTimeRef.current < 4000) {
                consecutiveKillsRef.current += 1
              } else {
                consecutiveKillsRef.current = 1
              }
              lastKillTimeRef.current = nowKill
              if (consecutiveKillsRef.current >= 3) {
                const streakMsg =
                  consecutiveKillsRef.current >= 5 ? "KILLING SPREE!" : "TRIPLE KILL!"
                if (killStreakTimerRef.current) clearTimeout(killStreakTimerRef.current)
                setKillStreakMsg(streakMsg)
                killStreakTimerRef.current = setTimeout(() => setKillStreakMsg(null), 2500)
              }
            }
            setEnemyStatus(
              enemies.map((e) => ({
                id: e.id,
                hp: e.hp,
                maxHp: e.maxHp,
                type: e.type,
                alive: e.hp > 0,
              })),
            )
          }
        } else if (selectedBlockRef.current) {
          placeAtCenter()
        }

        if (weapon.maxAmmo !== -1 && ammoRef.current <= 0) startReload(weapon)
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
        if (e.button === 0) {
          mouseDownRef.current = true
          fire()
        } else if (e.button === 2) destroyAtCenter()
      }
      function onMouseUp(e: MouseEvent) {
        if (e.button === 0) mouseDownRef.current = false
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
      document.addEventListener("mouseup", onMouseUp)
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
          const isSprinting = keysRef.current.has("Shift")
          const spd = MOVE_SPEED * (isSprinting ? SPRINT_MULTIPLIER : 1)
          const dx = (fwdX * -vz + Math.cos(camState.yaw) * vx) * spd * dt
          const dz = (fwdZ * -vz + -Math.sin(camState.yaw) * vx) * spd * dt
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

        // HP auto-recovery (5s no damage → 2 HP/s)
        {
          const nowMs = Date.now()
          if (gamePhaseRef.current === "playing" && playerHpRef.current < PLAYER_MAX_HP) {
            if (nowMs - lastDamageTimeRef.current > AUTO_RECOVER_DELAY * 1000) {
              playerHpRef.current = Math.min(PLAYER_MAX_HP, playerHpRef.current + RECOVER_RATE * dt)
              setPlayerHp(Math.round(playerHpRef.current))
            }
          }
        }

        // Camera shake (applied directly, not baked into camState)
        if (cameraShakeRef.current.intensity > 0) {
          const shk = cameraShakeRef.current.intensity
          const t = Date.now() * 0.05
          camera.rotation.y += Math.sin(t) * shk * 0.008
          camera.rotation.x += Math.cos(t * 1.3) * shk * 0.006
          cameraShakeRef.current.intensity = Math.max(0, shk - CAM_SHAKE_DECAY * dt)
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
        if (reloadStartTimeRef.current !== null) {
          const wDef = WEAPONS[currentWeaponIdxRef.current]
          const reloadDur = wDef?.reloadTime ?? 1
          const progress = Math.min((Date.now() - reloadStartTimeRef.current) / reloadDur, 1)
          refs.gunGroup.position.y -= Math.sin(progress * Math.PI) * 0.15
        }
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

        // Continuous fire
        if (mouseDownRef.current && gamePhaseRef.current === "playing") fire()

        // ── Bullets ────────────────────────────────────────────────────────
        for (let i = refs.bullets.length - 1; i >= 0; i--) {
          const b = refs.bullets[i]
          if (!b) continue
          b.mesh.position.addScaledVector(b.velocity, dt)
          b.life -= dt
          // Enemy bullet hits player
          if (b.isEnemy && b.life > 0) {
            const dx = b.mesh.position.x - refs.focalPoint.x
            const dy = b.mesh.position.y - EYE_HEIGHT
            const dz = b.mesh.position.z - refs.focalPoint.z
            if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.5) {
              refs.scene.remove(b.mesh)
              b.mesh.geometry.dispose()
              refs.bullets.splice(i, 1)
              if (gamePhaseRef.current === "playing") {
                playerHpRef.current = Math.max(0, playerHpRef.current - 5)
                setPlayerHp(playerHpRef.current)
                lastDamageTimeRef.current = Date.now()
                cameraShakeRef.current.intensity = 4
                setDamageFlash(true)
                SOUNDS.damage()
                setTimeout(() => setDamageFlash(false), 300)
                if (playerHpRef.current <= 0) {
                  gamePhaseRef.current = "gameover"
                  setGamePhase("gameover")
                  deathsRef.current += 1
                  setDeaths(deathsRef.current)
                }
              }
              continue
            }
          }
          if (b.life <= 0) {
            if (!b.isEnemy) spawnExplosion(b.mesh.position.clone(), true)
            refs.scene.remove(b.mesh)
            b.mesh.geometry.dispose()
            refs.bullets.splice(i, 1)
          }
        }

        // ── Explosion particles ────────────────────────────────────────────
        for (let i = refs.explosionParticles.length - 1; i >= 0; i--) {
          const p = refs.explosionParticles[i]
          if (!p) continue
          p.velocity.y -= 12 * dt
          p.mesh.position.addScaledVector(p.velocity, dt)
          p.life -= dt
          const alpha = Math.max(0, p.life / p.maxLife)
          const mat = p.mesh.material as THREE.MeshBasicMaterial
          mat.transparent = true
          mat.opacity = alpha
          if (!p.isSpark) p.mesh.scale.setScalar(0.4 + (1 - alpha) * 1.2)
          if (p.life <= 0) {
            refs.scene.remove(p.mesh)
            p.mesh.geometry.dispose()
            refs.explosionParticles.splice(i, 1)
          }
        }

        // ── Blood particles ────────────────────────────────────────────────
        for (let i = refs.bloodParticles.length - 1; i >= 0; i--) {
          const p = refs.bloodParticles[i]
          if (!p) continue
          p.velocity.y -= 9.8 * dt
          p.mesh.position.addScaledVector(p.velocity, dt)
          p.life -= dt
          const alpha = p.life / p.maxLife
          ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = alpha
          ;(p.mesh.material as THREE.MeshBasicMaterial).transparent = true
          if (p.life <= 0) {
            refs.scene.remove(p.mesh)
            p.mesh.geometry.dispose()
            refs.bloodParticles.splice(i, 1)
          }
        }

        // ── Enemy AI state machine ─────────────────────────────────────────
        if (gamePhaseRef.current === "playing") {
          const now = Date.now()
          const fp = refs.focalPoint
          for (const enemy of refs.enemies) {
            // Respawn dead enemies (with death animation)
            if (enemy.hp <= 0) {
              if (enemy.dyingTimer >= 0) {
                // Death fall animation
                enemy.dyingTimer -= dt
                const progress = Math.max(0, 1 - enemy.dyingTimer / 2.0)
                enemy.mesh.rotation.x = progress * (Math.PI / 2)
                enemy.mesh.position.y =
                  (enemy.config.bodyH / 2) * Math.cos((progress * Math.PI) / 2)
                const opacity = enemy.dyingTimer < 1.0 ? enemy.dyingTimer : 1.0
                enemy.mesh.traverse((child) => {
                  if (child instanceof THREE.Mesh) {
                    const m = child.material as THREE.MeshLambertMaterial | THREE.MeshBasicMaterial
                    m.transparent = true
                    m.opacity = opacity
                  }
                })
                if (enemy.dyingTimer <= 0) {
                  spawnExplosion(enemy.mesh.position.clone())
                  enemy.dyingTimer = -1
                  enemy.mesh.visible = false
                  enemy.mesh.traverse((child) => {
                    if (child instanceof THREE.Mesh) {
                      const m = child.material as
                        | THREE.MeshLambertMaterial
                        | THREE.MeshBasicMaterial
                      m.opacity = 1
                      m.transparent = false
                    }
                  })
                  enemy.mesh.rotation.x = 0
                  enemy.respawnTimer = ENEMY_NO_RESPAWN
                }
              }
              continue
            }
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
              if (
                enemyCanSee(enemy.facing.x, enemy.facing.z, toPx, toPz, distToPlayer, enemy.config)
              ) {
                enemy.state = "alert"
                enemy.lastSeenPlayer = { x: fp.x, z: fp.z }
                const alertNow = Date.now()
                if (alertNow - lastAlertTimeRef.current > 4000) {
                  lastAlertTimeRef.current = alertNow
                  SOUNDS.alert()
                  showNotification("⚠ エネミーに発見された！")
                }
              }
            } else if (enemy.state === "alert") {
              enemy.lastSeenPlayer = { x: fp.x, z: fp.z }
              if (distToPlayer <= enemy.config.attackRange) {
                enemy.state = "attack"
              } else {
                // Cover AI: stop moving and only shoot when near a wall/cover
                const nearCover = ALL_AABBS.some((w) => {
                  const cx2 = (w.x1 + w.x2) / 2
                  const cz2 = (w.z1 + w.z2) / 2
                  const ddx = ex - cx2
                  const ddz = ez - cz2
                  return Math.sqrt(ddx * ddx + ddz * ddz) < 2.5
                })
                if (!nearCover || distToPlayer > enemy.config.fireRange) {
                  const spd = enemy.config.speed * dt
                  const nx = ex + (toPx / distToPlayer) * spd
                  const nz = ez + (toPz / distToPlayer) * spd
                  if (!collidesWithWall(nx, ez, ENEMY_RADIUS)) enemy.mesh.position.x = nx
                  if (!collidesWithWall(ex, nz, ENEMY_RADIUS)) enemy.mesh.position.z = nz
                }
                enemy.facing.set(toPx / distToPlayer, 0, toPz / distToPlayer)
                enemy.mesh.rotation.y = Math.atan2(enemy.facing.x, enemy.facing.z)
                if (
                  !enemyCanSee(
                    enemy.facing.x,
                    enemy.facing.z,
                    toPx,
                    toPz,
                    distToPlayer,
                    enemy.config,
                  )
                ) {
                  enemy.state = "search"
                  enemy.searchTimer = 3.5
                }
              }
              // Shoot while chasing (alert range fire)
              if (
                distToPlayer <= enemy.config.fireRange &&
                now - enemy.lastFireTime > enemy.config.fireInterval * 1.5
              ) {
                enemy.lastFireTime = now
                const fwd = new THREE.Vector3(toPx / distToPlayer, 0, toPz / distToPlayer)
                fwd.x += (Math.random() - 0.5) * 0.06
                fwd.z += (Math.random() - 0.5) * 0.06
                fwd.normalize()
                const bGeo = new THREE.BoxGeometry(0.04, 0.04, 0.22)
                const bMat = new THREE.MeshBasicMaterial({ color: 0xff4400 })
                const bMesh = new THREE.Mesh(bGeo, bMat)
                bMesh.position.set(enemy.mesh.position.x, EYE_HEIGHT * 0.7, enemy.mesh.position.z)
                bMesh.lookAt(bMesh.position.clone().add(fwd))
                refs.scene.add(bMesh)
                refs.bullets.push({
                  mesh: bMesh,
                  velocity: fwd.clone().multiplyScalar(ENEMY_BULLET_SPEED),
                  life: 1.8,
                  isEnemy: true,
                })
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
                lastDamageTimeRef.current = Date.now()
                cameraShakeRef.current.intensity = 4
                setDamageFlash(true)
                SOUNDS.damage()
                setTimeout(() => setDamageFlash(false), 300)
                if (playerHpRef.current <= 0 && gamePhaseRef.current === "playing") {
                  gamePhaseRef.current = "gameover"
                  setGamePhase("gameover")
                  deathsRef.current += 1
                  setDeaths(deathsRef.current)
                }
              }
              // Enemy ranged fire
              if (
                distToPlayer <= enemy.config.fireRange &&
                now - enemy.lastFireTime > enemy.config.fireInterval
              ) {
                enemy.lastFireTime = now
                const fwd = new THREE.Vector3(toPx / distToPlayer, 0, toPz / distToPlayer)
                const spread = 0.03
                fwd.x += (Math.random() - 0.5) * spread
                fwd.z += (Math.random() - 0.5) * spread
                fwd.normalize()
                const bGeo = new THREE.BoxGeometry(0.04, 0.04, 0.22)
                const bMat = new THREE.MeshBasicMaterial({ color: 0xff4400 })
                const bMesh = new THREE.Mesh(bGeo, bMat)
                bMesh.position.set(enemy.mesh.position.x, EYE_HEIGHT * 0.7, enemy.mesh.position.z)
                bMesh.lookAt(bMesh.position.clone().add(fwd))
                refs.scene.add(bMesh)
                refs.bullets.push({
                  mesh: bMesh,
                  velocity: fwd.clone().multiplyScalar(ENEMY_BULLET_SPEED),
                  life: 1.8,
                  isEnemy: true,
                })
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
              if (
                enemyCanSee(enemy.facing.x, enemy.facing.z, toPx, toPz, distToPlayer, enemy.config)
              ) {
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

        // ── Wave completion check ──────────────────────────────────────────
        if (waveActiveRef.current && !missionCompleteRef.current && refs.enemies.length > 0) {
          const allDead = refs.enemies.every((e) => e.hp <= 0 && e.dyingTimer < 0)
          if (allDead) {
            waveActiveRef.current = false
            const nextIdx = currentWaveRef.current + 1
            if (nextIdx >= WAVE_DEFS.length) {
              missionCompleteRef.current = true
              setMissionComplete(true)
              SOUNDS.clear()
            } else {
              currentWaveRef.current = nextIdx
              setCurrentWave(nextIdx + 1)
              setWaveMessage(`WAVE ${nextIdx + 1} INCOMING`)
              setTimeout(() => {
                setWaveMessage(null)
                spawnWaveRef.current?.(nextIdx)
                waveActiveRef.current = true
              }, 3000)
            }
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
                enemy.type === "boss"
                  ? "#cc44ff"
                  : enemy.type === "miniboss"
                    ? "#ff8800"
                    : enemy.state === "alert" || enemy.state === "attack"
                      ? "#ff2222"
                      : "#ff6666"
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
        document.removeEventListener("mouseup", onMouseUp)
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
    function switchWeapon(idx: number) {
      const unlocked = unlockedWeapons
      const weapon = WEAPONS[idx]
      if (!weapon || !unlocked.has(weapon.id)) {
        showNotification(`${WEAPONS[idx]?.name ?? ""} はロック中`)
        return
      }
      if (reloadingRef.current) return
      // Save current weapon ammo
      weaponAmmoRef.current[currentWeaponIdxRef.current] = ammoRef.current
      // Switch
      currentWeaponIdxRef.current = idx
      ammoRef.current = weaponAmmoRef.current[idx] ?? -1
      setAmmo(ammoRef.current)
      setCurrentWeaponIdx(idx)
    }

    function onKeyDown(e: KeyboardEvent) {
      keysRef.current.add(e.key)
      if (e.key === "Escape") setSelectedBlock(null)
      if (e.key === "1") switchWeapon(0)
      if (e.key === "2") switchWeapon(1)
      if (e.key === "3") switchWeapon(2)
      if (e.key === "r" || e.key === "R") {
        const weapon = WEAPONS[currentWeaponIdxRef.current]
        if (
          weapon &&
          weapon.maxAmmo !== -1 &&
          !reloadingRef.current &&
          ammoRef.current < weapon.maxAmmo
        ) {
          reloadingRef.current = true
          setIsReloading(true)
          showNotification(`RELOADING ${weapon.name}...`)
          setTimeout(() => {
            const idx = currentWeaponIdxRef.current
            const kbWeapon = WEAPONS[idx]
            if (!kbWeapon) return
            weaponAmmoRef.current[idx] = kbWeapon.maxAmmo
            ammoRef.current = kbWeapon.maxAmmo
            setAmmo(kbWeapon.maxAmmo)
            reloadingRef.current = false
            setIsReloading(false)
          }, weapon.reloadTime)
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
  }, [showNotification, unlockedWeapons])

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
  const currentWeapon: WeaponDef = WEAPONS[currentWeaponIdx] ??
    WEAPONS[0] ?? {
      id: "pistol",
      name: "PISTOL",
      maxAmmo: -1,
      hitDamage: 20,
      reloadTime: 0,
      spread: 0,
      pellets: 1,
      bulletLifetime: 0.38,
      bulletColor: 0xffff88,
      recoil: 0.08,
    }
  const ammoPct =
    currentWeapon.maxAmmo === -1 ? 100 : Math.round((ammo / currentWeapon.maxAmmo) * 100)
  const ammoDisplay = currentWeapon.maxAmmo === -1 ? "∞" : `${ammo}/${currentWeapon.maxAmmo}`
  const hpColor = playerHp > 60 ? "#00ff41" : playerHp > 30 ? "#ffaa00" : "#ff3333"

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: "#000",
        fontFamily: "monospace",
      }}
    >
      {/* ── REMOVED: old top HUD bar replaced by in-canvas overlays ─────── */}
      <div style={{ display: "none" }}>
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

        {/* Weapon + Ammo */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <span style={{ color: "#8888ff", fontSize: "0.6rem", letterSpacing: "0.1em" }}>
            {currentWeapon.name}
          </span>
          <div
            style={{
              width: "36px",
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
                transition: isReloading
                  ? `width ${currentWeapon.reloadTime}ms linear`
                  : "width 0.1s",
              }}
            />
          </div>
          <span
            style={{
              color: isReloading ? "#ffaa00" : "#8888ff",
              fontSize: "0.65rem",
              minWidth: "28px",
            }}
          >
            {isReloading ? "REL" : ammoDisplay}
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

        {/* Kill / Death counter */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ color: "#ff5555", fontSize: "0.65rem", letterSpacing: "0.1em" }}>
            K <span style={{ color: "#ff8888", fontWeight: "bold" }}>{kills}</span>
          </span>
          <span style={{ color: "#555", fontSize: "0.55rem" }}>/</span>
          <span style={{ color: "#aaaaaa", fontSize: "0.65rem", letterSpacing: "0.1em" }}>
            D <span style={{ color: "#cccccc", fontWeight: "bold" }}>{deaths}</span>
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
      </div>

      {/* ── Canvas + COD-style overlays ───────────────────────────────────── */}
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        <div ref={mountRef} style={{ width: "100%", height: "100%" }} />

        {/* Permanent dark vignette */}
        {!isLoading && !error && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.6) 100%)",
              pointerEvents: "none",
              zIndex: 5,
            }}
          />
        )}

        {/* Damage vignette (red flash on hit) */}
        {damageFlash && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(ellipse at center, transparent 35%, rgba(220,0,0,0.72) 100%)",
              pointerEvents: "none",
              zIndex: 6,
            }}
          />
        )}

        {/* ── Top-center: Score / Kills ─────────────────────────────────── */}
        {!isLoading && !error && gamePhase === "playing" && (
          <div
            style={{
              position: "absolute",
              top: "1rem",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 20,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0.2rem",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                color: "#ffcc00",
                fontSize: "1.8rem",
                fontWeight: "bold",
                letterSpacing: "0.12em",
                textShadow: "0 2px 12px rgba(255,180,0,0.7)",
                lineHeight: 1,
              }}
            >
              {score.toString().padStart(6, "0")}
            </div>
            <div
              style={{
                display: "flex",
                gap: "1.2rem",
                fontSize: "0.72rem",
                color: "rgba(255,255,255,0.75)",
                letterSpacing: "0.1em",
              }}
            >
              <span>
                KILLS{" "}
                <span style={{ color: "#ff5555", fontWeight: "bold", marginLeft: "0.2rem" }}>
                  {kills}
                </span>
              </span>
              <span>
                DEATHS{" "}
                <span style={{ color: "#aaa", fontWeight: "bold", marginLeft: "0.2rem" }}>
                  {deaths}
                </span>
              </span>
            </div>
          </div>
        )}

        {/* Headshot message */}
        {headshotMsg && (
          <div
            style={{
              position: "absolute",
              top: "36%",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 36,
              pointerEvents: "none",
              fontSize: "1.6rem",
              fontWeight: "bold",
              color: "#ff4444",
              letterSpacing: "0.2em",
              textShadow: "0 0 18px rgba(255,0,0,0.9)",
              whiteSpace: "nowrap",
            }}
          >
            HEADSHOT!
          </div>
        )}

        {/* Kill streak message (center screen) */}
        {killStreakMsg && (
          <div
            style={{
              position: "absolute",
              top: "28%",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 35,
              pointerEvents: "none",
              fontSize: "2.2rem",
              fontWeight: "bold",
              color: "#ffcc00",
              letterSpacing: "0.25em",
              textShadow: "0 0 24px rgba(255,200,0,0.9), 0 0 48px rgba(255,80,0,0.5)",
              whiteSpace: "nowrap",
            }}
          >
            {killStreakMsg}
          </div>
        )}

        {/* Notification */}
        {notification && (
          <div
            style={{
              position: "absolute",
              top: "5.5rem",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 25,
              pointerEvents: "none",
              fontSize: "0.78rem",
              color: "#fff",
              background: "rgba(0,0,0,0.72)",
              border: "1px solid rgba(255,255,255,0.2)",
              padding: "0.25rem 0.8rem",
              letterSpacing: "0.08em",
              whiteSpace: "nowrap",
              borderRadius: "2px",
            }}
          >
            {notification}
          </div>
        )}

        {/* ── COD-style Crosshair ───────────────────────────────────────── */}
        {!isLoading && !error && (isPointerLocked || isMobile) && gamePhase === "playing" && (
          <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
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
              x1="9"
              y1="1"
              x2="9"
              y2="6"
              stroke={aimedEnemyId ? "#ff2222" : "rgba(255,255,255,0.92)"}
              strokeWidth="1.5"
            />
            <line
              x1="9"
              y1="12"
              x2="9"
              y2="17"
              stroke={aimedEnemyId ? "#ff2222" : "rgba(255,255,255,0.92)"}
              strokeWidth="1.5"
            />
            <line
              x1="1"
              y1="9"
              x2="6"
              y2="9"
              stroke={aimedEnemyId ? "#ff2222" : "rgba(255,255,255,0.92)"}
              strokeWidth="1.5"
            />
            <line
              x1="12"
              y1="9"
              x2="17"
              y2="9"
              stroke={aimedEnemyId ? "#ff2222" : "rgba(255,255,255,0.92)"}
              strokeWidth="1.5"
            />
          </svg>
        )}

        {/* ── Bottom-left: HP bar (COD style) ──────────────────────────── */}
        {!isLoading && !error && gamePhase === "playing" && (
          <div
            style={{
              position: "absolute",
              bottom: "1.4rem",
              left: "1.4rem",
              zIndex: 20,
              width: "230px",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "0.4rem",
                marginBottom: "0.3rem",
              }}
            >
              <span
                style={{
                  color: "rgba(255,255,255,0.45)",
                  fontSize: "0.68rem",
                  letterSpacing: "0.18em",
                }}
              >
                HP
              </span>
              <span
                style={{
                  color: hpColor,
                  fontSize: "2.4rem",
                  fontWeight: "bold",
                  lineHeight: 1,
                  textShadow: `0 0 14px ${hpColor}80`,
                }}
              >
                {playerHp}
              </span>
              <span style={{ color: "rgba(255,255,255,0.25)", fontSize: "0.72rem" }}>/ 100</span>
            </div>
            <div
              style={{
                height: "8px",
                background: "rgba(0,0,0,0.55)",
                border: "1px solid rgba(255,255,255,0.18)",
                borderRadius: "2px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${hpPct}%`,
                  background: hpColor,
                  boxShadow: `0 0 8px ${hpColor}88`,
                  transition: "width 0.3s ease, background 0.3s",
                  borderRadius: "2px",
                }}
              />
            </div>
            <div
              style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.35rem" }}
            >
              <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.58rem" }}>
                LV.{level}
              </span>
              <div
                style={{
                  flex: 1,
                  height: "3px",
                  background: "rgba(0,0,0,0.5)",
                  border: "1px solid rgba(0,255,65,0.18)",
                  borderRadius: "2px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${xpPct}%`,
                    background: "#00ff41",
                    transition: "width 0.7s",
                    borderRadius: "2px",
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Bottom-right: Ammo display (COD style) ───────────────────── */}
        {!isLoading && !error && gamePhase === "playing" && (
          <div
            style={{
              position: "absolute",
              bottom: "1.4rem",
              right: "1.4rem",
              zIndex: 20,
              textAlign: "right",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                color: "rgba(255,255,255,0.45)",
                fontSize: "0.65rem",
                letterSpacing: "0.2em",
                marginBottom: "0.15rem",
              }}
            >
              {currentWeapon.name}
              {isReloading && (
                <span style={{ color: "#ffaa00", marginLeft: "0.5rem" }}>RELOADING</span>
              )}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "0.25rem",
                justifyContent: "flex-end",
              }}
            >
              <span
                style={{
                  color: currentWeapon.maxAmmo !== -1 && ammo === 0 ? "#ff3333" : "white",
                  fontSize: "3rem",
                  fontWeight: "bold",
                  lineHeight: 1,
                  letterSpacing: "0.04em",
                  textShadow: "0 0 10px rgba(255,255,255,0.25)",
                }}
              >
                {currentWeapon.maxAmmo === -1 ? "∞" : ammo}
              </span>
              <span
                style={{ color: "rgba(255,255,255,0.35)", fontSize: "1.3rem", fontWeight: "bold" }}
              >
                / {currentWeapon.maxAmmo === -1 ? "∞" : currentWeapon.maxAmmo}
              </span>
            </div>
            {currentWeapon.maxAmmo !== -1 && (
              <div
                style={{
                  height: "3px",
                  background: "rgba(0,0,0,0.55)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: "2px",
                  overflow: "hidden",
                  marginTop: "0.25rem",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: isReloading ? "100%" : `${ammoPct}%`,
                    background: isReloading ? "#ffaa00" : "rgba(255,255,255,0.7)",
                    transition: isReloading
                      ? `width ${currentWeapon.reloadTime}ms linear`
                      : "width 0.1s",
                    borderRadius: "2px",
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* ── Circular Minimap (top-right) ─────────────────────────────── */}
        {!isLoading && !error && (
          <div
            style={{
              position: "absolute",
              top: "1rem",
              right: "1rem",
              zIndex: 20,
              width: "92px",
              height: "92px",
              borderRadius: "50%",
              overflow: "hidden",
              border: "2px solid rgba(255,255,255,0.28)",
              boxShadow: "0 0 12px rgba(0,0,0,0.7)",
            }}
          >
            <canvas
              ref={minimapRef}
              width={92}
              height={92}
              style={{ display: "block", imageRendering: "pixelated" }}
            />
          </div>
        )}

        {/* Online count + tag (below minimap) */}
        {!isLoading && !error && (
          <div
            style={{
              position: "absolute",
              top: "6.5rem",
              right: "1rem",
              zIndex: 20,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: "0.25rem",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.3rem",
                fontSize: "0.58rem",
                color: "rgba(255,255,255,0.35)",
                fontFamily: "monospace",
              }}
            >
              <span
                style={{
                  width: "5px",
                  height: "5px",
                  borderRadius: "50%",
                  background: "#00ff41",
                  display: "inline-block",
                }}
              />
              {onlineCount} ONLINE
            </div>
            {tagGame?.running ? (
              <div
                style={{
                  color: "#ff4444",
                  fontSize: "0.58rem",
                  fontFamily: "monospace",
                  background: "rgba(0,0,0,0.65)",
                  border: "1px solid rgba(255,0,0,0.3)",
                  padding: "0.15rem 0.35rem",
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
                  background: "rgba(0,0,0,0.55)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "rgba(255,255,255,0.25)",
                  fontFamily: "monospace",
                  fontSize: "0.55rem",
                  padding: "0.15rem 0.35rem",
                  cursor: "pointer",
                  letterSpacing: "0.05em",
                }}
              >
                TAG GAME
              </button>
            )}
          </div>
        )}

        {/* Enemy status (top-left, compact) */}
        {!isLoading && !error && gamePhase === "playing" && (
          <div
            style={{
              position: "absolute",
              top: "1rem",
              left: "1rem",
              zIndex: 20,
              display: "flex",
              flexDirection: "column",
              gap: "3px",
              fontFamily: "monospace",
              pointerEvents: "none",
            }}
          >
            {enemyStatus.map((e, i) => {
              const typeColor =
                e.type === "boss" ? "#cc44ff" : e.type === "miniboss" ? "#ff8800" : "#ff5555"
              const label =
                e.type === "boss" ? "BOSS" : e.type === "miniboss" ? "MINI" : `E${i + 1}`
              const hpPctEnemy = e.maxHp > 0 ? Math.round((e.hp / e.maxHp) * 100) : 0
              return (
                <div
                  key={e.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    opacity: e.alive ? 1 : 0.3,
                  }}
                >
                  <span
                    style={{
                      color: e.alive ? typeColor : "#444",
                      fontSize: "0.5rem",
                      minWidth: "24px",
                    }}
                  >
                    {label}
                  </span>
                  <div
                    style={{
                      width: "34px",
                      height: "4px",
                      background: "rgba(0,0,0,0.6)",
                      border: `1px solid ${e.alive ? typeColor : "#333"}44`,
                      overflow: "hidden",
                      borderRadius: "1px",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${hpPctEnemy}%`,
                        background: e.alive ? typeColor : "#333",
                        transition: "width 0.3s",
                        borderRadius: "1px",
                      }}
                    />
                  </div>
                  <span style={{ color: e.alive ? typeColor : "#444", fontSize: "0.48rem" }}>
                    {e.alive ? e.hp : "↺"}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* Weapon selector (compact, bottom-center-right) */}
        {!isLoading && !error && gamePhase === "playing" && (
          <div
            style={{
              position: "absolute",
              bottom: isMobile ? "7.5rem" : "5.2rem",
              right: isMobile ? "7.5rem" : "1.4rem",
              zIndex: 20,
              display: "flex",
              flexDirection: "column",
              gap: "2px",
              fontFamily: "monospace",
            }}
          >
            {WEAPONS.map((w, i) => {
              const isSelected = i === currentWeaponIdx
              const isUnlocked = unlockedWeapons.has(w.id)
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => {
                    if (!isUnlocked) {
                      showNotification(`${w.name} はロック中`)
                      return
                    }
                    if (reloadingRef.current) return
                    weaponAmmoRef.current[currentWeaponIdxRef.current] = ammoRef.current
                    currentWeaponIdxRef.current = i
                    ammoRef.current = weaponAmmoRef.current[i] ?? -1
                    setAmmo(ammoRef.current)
                    setCurrentWeaponIdx(i)
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    padding: "0.18rem 0.45rem",
                    fontFamily: "monospace",
                    fontSize: "0.58rem",
                    letterSpacing: "0.07em",
                    border: isSelected
                      ? "1px solid rgba(255,255,255,0.55)"
                      : "1px solid rgba(255,255,255,0.12)",
                    background: isSelected ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.62)",
                    color: isUnlocked
                      ? isSelected
                        ? "white"
                        : "rgba(255,255,255,0.38)"
                      : "rgba(255,255,255,0.12)",
                    cursor: isUnlocked ? "pointer" : "not-allowed",
                  }}
                >
                  <span
                    style={{
                      color: isSelected ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.25)",
                    }}
                  >
                    [{i + 1}]
                  </span>
                  <span>{w.name}</span>
                  {!isUnlocked && <span style={{ fontSize: "0.5rem" }}>🔒</span>}
                </button>
              )
            })}
          </div>
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
              background: "#000",
              zIndex: 50,
            }}
          >
            <div
              style={{
                color: "#fff",
                fontSize: "1rem",
                letterSpacing: "0.4em",
                fontFamily: "monospace",
                opacity: 0.8,
              }}
            >
              LOADING...
            </div>
          </div>
        )}

        {/* Error */}
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
              background: "#000",
              zIndex: 50,
              fontFamily: "monospace",
            }}
          >
            <p style={{ color: "#ff3333", fontSize: "1rem", letterSpacing: "0.2em" }}>⚠ {error}</p>
            <a
              href="/login"
              style={{
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.4)",
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

        {/* CRT scanline overlay */}
        {!isLoading && !error && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.18) 3px, rgba(0,0,0,0.18) 4px)",
              pointerEvents: "none",
              zIndex: 4,
            }}
          />
        )}

        {/* Briefing screen */}
        {showBriefing && !isLoading && !error && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.92)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "1.6rem",
              zIndex: 50,
              fontFamily: "monospace",
            }}
          >
            <div
              style={{ color: "#00ffaa", fontSize: "0.7rem", letterSpacing: "0.4em", opacity: 0.7 }}
            >
              CLASSIFIED {/* RESISTANCE OPS */}
            </div>
            <div
              style={{
                color: "#ff3333",
                fontSize: "1.8rem",
                fontWeight: "bold",
                letterSpacing: "0.3em",
                textShadow: "0 0 30px rgba(255,0,80,0.8)",
              }}
            >
              MISSION BRIEFING
            </div>
            <div
              style={{
                maxWidth: "480px",
                textAlign: "center",
                lineHeight: 2,
                color: "rgba(255,255,255,0.82)",
                fontSize: "0.82rem",
                letterSpacing: "0.06em",
                border: "1px solid rgba(0,255,170,0.2)",
                padding: "1.2rem 1.8rem",
                background: "rgba(0,255,170,0.03)",
              }}
            >
              <span style={{ color: "#00ffaa" }}>2087年。</span>巨大企業 AI
              コーポレーションが世界を支配している。
              <br />
              あなたはレジスタンスの特殊工作員。
              <br />
              AI コーポレーションの軍事 AI ドローンを撃破し、
              <br />
              <span style={{ color: "#ff3333" }}>データセンターを解放せよ。</span>
            </div>
            <div
              style={{
                color: "rgba(255,255,255,0.35)",
                fontSize: "0.62rem",
                letterSpacing: "0.15em",
              }}
            >
              WAVE 1 → grunt ×5 &nbsp;|&nbsp; WAVE 2 → grunt ×5 + miniboss ×2 &nbsp;|&nbsp; WAVE 3 →
              grunt ×3 + miniboss ×2 + boss ×1
            </div>
            <button
              type="button"
              onClick={() => {
                rendererDomRef.current?.requestPointerLock()
                setShowBriefing(false)
                currentWaveRef.current = 0
                setCurrentWave(1)
                setWaveMessage("WAVE 1 INCOMING")
                setTimeout(() => {
                  setWaveMessage(null)
                  spawnWaveRef.current?.(0)
                  waveActiveRef.current = true
                }, 3000)
              }}
              style={{
                background: "rgba(255,0,80,0.12)",
                border: "1px solid rgba(255,0,80,0.7)",
                color: "#ff3355",
                fontFamily: "monospace",
                fontSize: "1rem",
                letterSpacing: "0.3em",
                padding: "0.7rem 2.5rem",
                cursor: "pointer",
                textShadow: "0 0 12px rgba(255,0,80,0.6)",
              }}
            >
              BEGIN MISSION
            </button>
            <div
              style={{
                color: "rgba(255,255,255,0.2)",
                fontSize: "0.58rem",
                letterSpacing: "0.12em",
              }}
            >
              WASD: MOVE · SHIFT: SPRINT · LMB: FIRE · R: RELOAD · 1/2/3: WEAPON
            </div>
          </div>
        )}

        {/* CLICK TO PLAY overlay (after briefing dismissed, pointer not locked) */}
        {!isMobile &&
          !isLoading &&
          !error &&
          !isPointerLocked &&
          !showBriefing &&
          gamePhase !== "gameover" &&
          !missionComplete && (
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
                background: "rgba(0,0,0,0.62)",
                cursor: "pointer",
                border: "none",
                fontFamily: "monospace",
                zIndex: 40,
              }}
            >
              <div
                style={{
                  color: "#00ffaa",
                  fontSize: "1.6rem",
                  fontWeight: "bold",
                  letterSpacing: "0.4em",
                  textShadow: "0 0 20px rgba(0,255,170,0.6)",
                }}
              >
                CLICK TO RESUME
              </div>
              <div
                style={{
                  color: "rgba(255,255,255,0.35)",
                  fontSize: "0.62rem",
                  letterSpacing: "0.15em",
                }}
              >
                WAVE {currentWave} / {WAVE_DEFS.length}
              </div>
            </button>
          )}

        {/* Wave message */}
        {waveMessage && (
          <div
            style={{
              position: "absolute",
              top: "38%",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 45,
              pointerEvents: "none",
              fontFamily: "monospace",
              fontSize: "2.4rem",
              fontWeight: "bold",
              color: "#ff3333",
              letterSpacing: "0.25em",
              textShadow: "0 0 30px rgba(255,0,0,0.9), 0 0 60px rgba(255,0,0,0.4)",
              whiteSpace: "nowrap",
            }}
          >
            {waveMessage}
          </div>
        )}

        {/* Current wave indicator (top-center, small) */}
        {!isLoading && !error && !showBriefing && gamePhase === "playing" && currentWave > 0 && (
          <div
            style={{
              position: "absolute",
              top: "0.4rem",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 22,
              pointerEvents: "none",
              fontFamily: "monospace",
              fontSize: "0.6rem",
              letterSpacing: "0.2em",
              color: "rgba(255,50,50,0.6)",
            }}
          >
            WAVE {currentWave} / {WAVE_DEFS.length}
          </div>
        )}

        {/* Mission Complete */}
        {missionComplete && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.92)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "1.5rem",
              zIndex: 60,
              fontFamily: "monospace",
            }}
          >
            <div
              style={{
                color: "#00ffaa",
                fontSize: "3rem",
                fontWeight: "bold",
                letterSpacing: "0.3em",
                textShadow: "0 0 40px rgba(0,255,170,0.8)",
              }}
            >
              MISSION COMPLETE
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "0.4rem",
                border: "1px solid rgba(0,255,170,0.3)",
                padding: "1rem 2.5rem",
              }}
            >
              <div
                style={{
                  color: "rgba(0,255,170,0.7)",
                  fontSize: "0.72rem",
                  letterSpacing: "0.22em",
                }}
              >
                FINAL SCORE
              </div>
              <div
                style={{
                  color: "#ffcc00",
                  fontSize: "2.8rem",
                  fontWeight: "bold",
                  letterSpacing: "0.15em",
                }}
              >
                {score.toString().padStart(6, "0")}
              </div>
              <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.7rem" }}>
                KILLS: {kills} · WAVES CLEARED: {WAVE_DEFS.length}
              </div>
            </div>
            <div style={{ display: "flex", gap: "1rem" }}>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  background: "rgba(0,255,170,0.1)",
                  border: "1px solid rgba(0,255,170,0.6)",
                  color: "#00ffaa",
                  fontFamily: "monospace",
                  fontSize: "0.9rem",
                  letterSpacing: "0.2em",
                  padding: "0.6rem 1.8rem",
                  cursor: "pointer",
                }}
              >
                PLAY AGAIN
              </button>
              <a
                href="/dungeon"
                style={{
                  border: "1px solid rgba(255,255,255,0.15)",
                  color: "rgba(255,255,255,0.38)",
                  fontFamily: "monospace",
                  fontSize: "0.9rem",
                  letterSpacing: "0.2em",
                  padding: "0.6rem 1.8rem",
                  textDecoration: "none",
                }}
              >
                DUNGEON
              </a>
            </div>
          </div>
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
              const typeColor =
                e.type === "boss" ? "#cc44ff" : e.type === "miniboss" ? "#ff8800" : "#ff5555"
              const hpBarColor =
                e.type === "boss" ? "#aa00ff" : e.type === "miniboss" ? "#ff6600" : "#ff2222"
              const label =
                e.type === "boss" ? "BOSS" : e.type === "miniboss" ? "MINI" : `E${i + 1}`
              const hpPctEnemy = e.maxHp > 0 ? Math.round((e.hp / e.maxHp) * 100) : 0
              return (
                <div
                  key={e.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    opacity: e.alive ? 1 : 0.4,
                  }}
                >
                  <span
                    style={{
                      color: e.alive ? typeColor : "#444",
                      fontSize: "0.55rem",
                      minWidth: "26px",
                    }}
                  >
                    {label}
                  </span>
                  <div
                    style={{
                      width: "40px",
                      height: "6px",
                      background: "#1a0000",
                      border: `1px solid ${e.alive ? typeColor : "#333"}33`,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${hpPctEnemy}%`,
                        background: e.alive ? hpBarColor : "#333",
                        transition: "width 0.3s",
                      }}
                    />
                  </div>
                  <span
                    style={{
                      color: e.alive ? typeColor : "#444",
                      fontSize: "0.55rem",
                      minWidth: "24px",
                    }}
                  >
                    {e.alive ? `${e.hp}/${e.maxHp}` : "↺"}
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

        {/* Weapon selector (bottom-right) */}
        {!isLoading && !error && gamePhase === "playing" && (
          <div
            style={{
              position: "absolute",
              bottom: isMobile ? "7.5rem" : "1rem",
              right: isMobile ? "7.5rem" : "0.5rem",
              zIndex: 20,
              display: "flex",
              flexDirection: "column",
              gap: "3px",
              fontFamily: "monospace",
            }}
          >
            {WEAPONS.map((w, i) => {
              const isSelected = i === currentWeaponIdx
              const isUnlocked = unlockedWeapons.has(w.id)
              const wAmmo = i === currentWeaponIdx ? ammo : (weaponAmmoRef.current[i] ?? -1)
              const wAmmoStr = w.maxAmmo === -1 ? "∞" : `${wAmmo}/${w.maxAmmo}`
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => {
                    if (!isUnlocked) {
                      showNotification(`${w.name} はロック中`)
                      return
                    }
                    if (reloadingRef.current) return
                    weaponAmmoRef.current[currentWeaponIdxRef.current] = ammoRef.current
                    currentWeaponIdxRef.current = i
                    ammoRef.current = weaponAmmoRef.current[i] ?? -1
                    setAmmo(ammoRef.current)
                    setCurrentWeaponIdx(i)
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    padding: "0.2rem 0.5rem",
                    fontFamily: "monospace",
                    fontSize: "0.62rem",
                    letterSpacing: "0.08em",
                    border: isSelected ? "1px solid #8888ff" : "1px solid #222233",
                    background: isSelected ? "rgba(136,136,255,0.12)" : "rgba(0,0,0,0.75)",
                    color: isUnlocked ? (isSelected ? "#aaaaff" : "#445566") : "#222233",
                    cursor: isUnlocked ? "pointer" : "not-allowed",
                    opacity: isUnlocked ? 1 : 0.5,
                  }}
                >
                  <span style={{ color: isSelected ? "#8888ff" : "#334455" }}>[{i + 1}]</span>
                  <span>{w.name}</span>
                  <span
                    style={{
                      color: isSelected ? "#aaaaff" : "#334455",
                      marginLeft: "auto",
                      paddingLeft: "0.4rem",
                    }}
                  >
                    {isUnlocked ? wAmmoStr : "🔒"}
                  </span>
                </button>
              )
            })}
          </div>
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
              background: "rgba(255,255,255,0.06)",
              border: "2px solid rgba(255,255,255,0.18)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              touchAction: "none",
              zIndex: 20,
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
                background: "rgba(255,255,255,0.25)",
                border: "1px solid rgba(255,255,255,0.4)",
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
              right: "6rem",
              width: "96px",
              height: "96px",
              borderRadius: "50%",
              background: "rgba(100,150,255,0.06)",
              border: "2px solid rgba(100,150,255,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              touchAction: "none",
              zIndex: 20,
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
                background: "rgba(100,150,255,0.3)",
                border: "1px solid rgba(100,150,255,0.5)",
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
              bottom: isMobile ? "7.5rem" : "5.2rem",
              left: isMobile ? "7.5rem" : "1.4rem",
              width: "190px",
              zIndex: 20,
              fontFamily: "monospace",
              display: "flex",
              flexDirection: "column",
              gap: "3px",
            }}
          >
            <div
              style={{
                maxHeight: "80px",
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
                    fontSize: "0.6rem",
                    color: m.isSystem ? "#55aaff" : "rgba(255,255,255,0.78)",
                    background: "rgba(0,0,0,0.72)",
                    padding: "1px 5px",
                    wordBreak: "break-all",
                  }}
                >
                  <span style={{ color: m.isSystem ? "#3366aa" : "rgba(255,255,255,0.35)" }}>
                    {m.from}:{" "}
                  </span>
                  {m.text}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={sendChat} style={{ display: "flex", gap: "3px" }}>
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="CHAT..."
                maxLength={100}
                style={{
                  flex: 1,
                  background: "rgba(0,0,0,0.72)",
                  border: "1px solid rgba(255,255,255,0.14)",
                  color: "white",
                  fontFamily: "monospace",
                  fontSize: "0.6rem",
                  padding: "2px 5px",
                  outline: "none",
                  minWidth: 0,
                }}
              />
              <button
                type="submit"
                style={{
                  background: "rgba(0,0,0,0.72)",
                  border: "1px solid rgba(255,255,255,0.14)",
                  color: "rgba(255,255,255,0.45)",
                  fontFamily: "monospace",
                  fontSize: "0.6rem",
                  padding: "2px 6px",
                  cursor: "pointer",
                }}
              >
                ▶
              </button>
            </form>
          </div>
        )}

        {/* ── Game Over ─────────────────────────────────────────────────── */}
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
              background: "rgba(0,0,0,0.93)",
              zIndex: 60,
              fontFamily: "monospace",
            }}
          >
            <div
              style={{
                color: "#ff3333",
                fontSize: "3rem",
                fontWeight: "bold",
                letterSpacing: "0.3em",
                textShadow: "0 0 40px rgba(255,0,0,0.8)",
              }}
            >
              YOU DIED
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "0.4rem",
                border: "1px solid rgba(255,50,50,0.25)",
                padding: "1rem 2rem",
              }}
            >
              <div style={{ color: "#ffcc00", fontSize: "0.78rem", letterSpacing: "0.22em" }}>
                FINAL SCORE
              </div>
              <div
                style={{
                  color: "#ffcc00",
                  fontSize: "2.8rem",
                  fontWeight: "bold",
                  letterSpacing: "0.15em",
                }}
              >
                {score.toString().padStart(6, "0")}
              </div>
              <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.7rem" }}>
                KILLS: {kills} · DEATHS: {deaths}
              </div>
            </div>
            <div style={{ display: "flex", gap: "1rem" }}>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  background: "rgba(255,40,40,0.14)",
                  border: "1px solid rgba(255,50,50,0.6)",
                  color: "#ff5555",
                  fontFamily: "monospace",
                  fontSize: "0.9rem",
                  letterSpacing: "0.2em",
                  padding: "0.6rem 1.8rem",
                  cursor: "pointer",
                }}
              >
                RESPAWN
              </button>
              <a
                href="/dungeon"
                style={{
                  border: "1px solid rgba(255,255,255,0.15)",
                  color: "rgba(255,255,255,0.38)",
                  fontFamily: "monospace",
                  fontSize: "0.9rem",
                  letterSpacing: "0.2em",
                  padding: "0.6rem 1.8rem",
                  textDecoration: "none",
                }}
              >
                DUNGEON
              </a>
            </div>
          </div>
        )}
      </div>

      {/* ── Inventory bar ─────────────────────────────────────────────────── */}
      <div
        style={{
          flexShrink: 0,
          padding: "0.4rem 1rem",
          background: "rgba(0,0,0,0.95)",
          borderTop: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <div
          style={{
            fontSize: "0.55rem",
            color: "rgba(255,255,255,0.18)",
            letterSpacing: "0.1em",
            marginBottom: "0.22rem",
          }}
        >
          LMB: FIRE · RMB: DESTROY · R: RELOAD · 1/2/3: WEAPON · SHIFT: SPRINT
          <a
            href="/dungeon"
            style={{
              color: "rgba(0,200,80,0.6)",
              marginLeft: "0.5rem",
              textDecoration: "underline",
            }}
          >
            DUNGEON
          </a>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <span
            style={{
              flexShrink: 0,
              color: "rgba(255,255,255,0.18)",
              fontSize: "0.55rem",
              letterSpacing: "0.15em",
            }}
          >
            INV
          </span>
          <div
            style={{
              display: "flex",
              flex: 1,
              alignItems: "center",
              gap: "0.4rem",
              overflowX: "auto",
            }}
          >
            {inventory.filter((i) => i.quantity > 0).length === 0 ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  fontSize: "0.65rem",
                }}
              >
                <span style={{ color: "rgba(255,255,255,0.2)", letterSpacing: "0.08em" }}>
                  NO BLOCKS
                </span>
                <a
                  href="/problems"
                  style={{
                    color: "rgba(0,200,80,0.7)",
                    letterSpacing: "0.08em",
                    textDecoration: "underline",
                  }}
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
                        gap: "0.3rem",
                        padding: "0.15rem 0.5rem",
                        fontFamily: "monospace",
                        fontSize: "0.65rem",
                        letterSpacing: "0.07em",
                        border: isSelected
                          ? `1px solid ${info.color}`
                          : "1px solid rgba(255,255,255,0.1)",
                        background: isSelected ? "rgba(255,255,255,0.05)" : "transparent",
                        color: isSelected ? "white" : "rgba(255,255,255,0.38)",
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          width: "6px",
                          height: "6px",
                          flexShrink: 0,
                          background: info.color,
                          borderRadius: "1px",
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
            <button
              type="button"
              onClick={() => setSelectedBlock(null)}
              style={{
                flexShrink: 0,
                color: "rgba(255,255,255,0.28)",
                fontSize: "0.55rem",
                border: "1px solid rgba(255,255,255,0.1)",
                padding: "0.1rem 0.3rem",
                background: "transparent",
                fontFamily: "monospace",
                cursor: "pointer",
              }}
            >
              ESC
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
