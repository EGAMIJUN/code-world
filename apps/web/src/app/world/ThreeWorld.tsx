"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import * as THREE from "three"

// ── Constants ──────────────────────────────────────────────────────────────────
const MAP_SIZE = 96
const TILE_UNIT = 1
const EYE_HEIGHT = 1.6
const MOVE_SPEED = 6
// biome-ignore lint/complexity/useLiteralKeys: bracket notation required per CLAUDE.md
const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

// ── Combat constants ───────────────────────────────────────────────────────────
const PLAYER_MAX_HP = 100
const BULLET_SPEED = 40
const ENEMY_BULLET_SPEED = 16
const RECOIL_RECOVER = 8
const MUZZLE_FLASH_DURATION = 0.07
const PLAYER_RADIUS = 0.35
const ENEMY_RADIUS = 0.45
const ENEMY_NO_RESPAWN = 9999
const PARTICLE_COUNT = 12
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

// ── Map object definitions [x, z, width, depth, type]
// type: 0=building, 1=car, 2=barricade, 3=tank/pipe, 4=tree, 5=trench
const MAP_OBJECTS: [number, number, number, number, number][] = [
  // ── Urban zone (x: 3–28) ─────────────────────────────────────────────────
  // Buildings
  [3, 3, 7, 8, 0],
  [14, 3, 8, 6, 0],
  [3, 14, 6, 7, 0],
  [13, 13, 7, 6, 0],
  [24, 5, 5, 6, 0],
  [22, 14, 5, 7, 0],
  [3, 24, 7, 8, 0],
  [14, 24, 6, 7, 0],
  [24, 26, 5, 5, 0],
  [3, 35, 8, 6, 0],
  [15, 35, 7, 5, 0],
  [25, 35, 4, 8, 0],
  [3, 45, 6, 7, 0],
  [13, 44, 8, 6, 0],
  [24, 46, 5, 6, 0],
  [3, 56, 7, 8, 0],
  [14, 56, 6, 7, 0],
  [24, 58, 5, 5, 0],
  [3, 68, 8, 6, 0],
  [15, 68, 7, 5, 0],
  [3, 77, 7, 8, 0],
  [14, 78, 6, 6, 0],
  [24, 76, 5, 7, 0],
  // Cars
  [12, 11, 2, 1, 1],
  [20, 21, 2, 1, 1],
  [11, 32, 2, 1, 1],
  [23, 43, 1, 2, 1],
  [12, 54, 2, 1, 1],
  [22, 65, 2, 1, 1],
  // Barricades (low wide)
  [25, 22, 3, 0.4, 2],
  [10, 42, 3, 0.4, 2],
  [22, 52, 0.4, 3, 2],
  [10, 62, 3, 0.4, 2],
  [25, 72, 3, 0.4, 2],
  // ── Industrial zone (x: 33–64) ───────────────────────────────────────────
  // Warehouses / factory buildings
  [33, 5, 10, 9, 0],
  [47, 5, 12, 8, 0],
  [33, 18, 9, 10, 0],
  [46, 18, 11, 9, 0],
  [33, 32, 10, 8, 0],
  [47, 32, 10, 9, 0],
  [33, 44, 9, 10, 0],
  [46, 45, 11, 8, 0],
  [33, 58, 10, 9, 0],
  [47, 58, 10, 8, 0],
  [33, 71, 9, 8, 0],
  [46, 72, 11, 7, 0],
  // Tanks & pipes
  [60, 5, 2, 2, 3],
  [63, 10, 1, 10, 3],
  [60, 24, 2, 2, 3],
  [63, 28, 8, 1, 3],
  [60, 42, 2, 2, 3],
  [63, 46, 1, 10, 3],
  [60, 60, 2, 2, 3],
  [63, 65, 8, 1, 3],
  // ── Outdoor zone (x: 68–92) ──────────────────────────────────────────────
  // Trenches (long and thin)
  [68, 5, 16, 1, 5],
  [68, 13, 1, 12, 5],
  [83, 8, 1, 12, 5],
  [68, 28, 16, 1, 5],
  [68, 40, 1, 14, 5],
  [83, 34, 1, 14, 5],
  [68, 57, 16, 1, 5],
  [68, 68, 1, 14, 5],
  [83, 62, 1, 14, 5],
  [68, 85, 16, 1, 5],
  // Trees
  [70, 7, 1, 1, 4],
  [76, 9, 1, 1, 4],
  [82, 6, 1, 1, 4],
  [88, 9, 1, 1, 4],
  [72, 20, 1, 1, 4],
  [79, 22, 1, 1, 4],
  [87, 19, 1, 1, 4],
  [71, 35, 1, 1, 4],
  [80, 37, 1, 1, 4],
  [88, 32, 1, 1, 4],
  [73, 50, 1, 1, 4],
  [80, 52, 1, 1, 4],
  [87, 48, 1, 1, 4],
  [71, 65, 1, 1, 4],
  [78, 67, 1, 1, 4],
  [86, 63, 1, 1, 4],
  [73, 78, 1, 1, 4],
  [81, 80, 1, 1, 4],
  [88, 76, 1, 1, 4],
]

// WALL_DEFS for backward compat (minimap, cover AI)
const WALL_DEFS: [number, number, number, number][] = MAP_OBJECTS.map(([x, z, w, d]) => [
  x,
  z,
  w,
  d,
])
type WallAABB = { x1: number; z1: number; x2: number; z2: number }
const WALL_AABBS: WallAABB[] = WALL_DEFS.map(([x, z, w, d]) => ({
  x1: x,
  z1: z,
  x2: x + w,
  z2: z + d,
}))
const ALL_AABBS: WallAABB[] = WALL_AABBS

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
    speed: 2.0,
    attackDamage: 10,
    attackInterval: 2000,
    attackRange: 1.8,
    fireRange: 16,
    fireInterval: 2000,
    fireDamage: 10,
    color: 0x78704a, // khaki
    emissive: 0x0a0a00,
    bodyW: 0.55,
    bodyH: 1.8,
    sightRange: 18,
    fovAngle: Math.PI,
    score: 100,
    blockReward: 1,
  },
  miniboss: {
    hp: 150,
    speed: 1.5,
    attackDamage: 18,
    attackInterval: 2000,
    attackRange: 2.0,
    fireRange: 20,
    fireInterval: 1800,
    fireDamage: 18,
    color: 0x222222, // dark armored
    emissive: 0x050505,
    bodyW: 0.65,
    bodyH: 2.0,
    sightRange: 22,
    fovAngle: Math.PI * 0.9,
    score: 300,
    blockReward: 3,
  },
  boss: {
    hp: 400,
    speed: 1.2,
    attackDamage: 25,
    attackInterval: 2000,
    attackRange: 2.5,
    fireRange: 26,
    fireInterval: 1600,
    fireDamage: 25,
    color: 0x8b0000, // dark red
    emissive: 0x200000,
    bodyW: 0.85,
    bodyH: 2.4,
    sightRange: 30,
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
  { grunt: 6, miniboss: 0, boss: 0 },
  { grunt: 6, miniboss: 2, boss: 0 },
  { grunt: 4, miniboss: 2, boss: 0 },
  { grunt: 4, miniboss: 3, boss: 0 },
  { grunt: 3, miniboss: 2, boss: 1 },
]
const SPAWN_POINTS = [
  { x: 2, z: 2 },
  { x: 48, z: 2 },
  { x: 93, z: 2 },
  { x: 93, z: 48 },
  { x: 93, z: 93 },
  { x: 48, z: 93 },
  { x: 2, z: 93 },
  { x: 2, z: 48 },
  { x: 16, z: 16 },
  { x: 48, z: 16 },
  { x: 80, z: 16 },
  { x: 16, z: 48 },
  { x: 80, z: 48 },
  { x: 16, z: 80 },
  { x: 48, z: 80 },
  { x: 80, z: 80 },
]

// ── Mission system ─────────────────────────────────────────────────────────────
type MissionId =
  | "elimination"
  | "defense"
  | "sniper"
  | "breakthrough"
  | "rescue"
  | "destroy"
  | "stealth"
  | "capture"
  | "wave"
  | "boss"

interface MissionDef {
  id: MissionId
  name: string
  description: string
  objective: string
  goalCount: number
  spawnConfig: WaveDef
}

const MISSION_DEFS: MissionDef[] = [
  {
    id: "elimination",
    name: "01. 殲滅",
    description: "エリアの全敵を排除せよ",
    objective: "全敵を排除",
    goalCount: 15,
    spawnConfig: { grunt: 12, miniboss: 3, boss: 0 },
  },
  {
    id: "defense",
    name: "02. 防衛",
    description: "60秒間拠点を守れ",
    objective: "拠点を守る: {timer}秒",
    goalCount: 60,
    spawnConfig: { grunt: 10, miniboss: 3, boss: 0 },
  },
  {
    id: "sniper",
    name: "03. 狙撃",
    description: "スナイパーで敵5体を遠距離撃破",
    objective: "スナイパーキル: {progress}/5",
    goalCount: 5,
    spawnConfig: { grunt: 10, miniboss: 0, boss: 0 },
  },
  {
    id: "breakthrough",
    name: "04. 突破",
    description: "敵の包囲を突破してゴールへ到達",
    objective: "ゴールマーカーに到達せよ",
    goalCount: 1,
    spawnConfig: { grunt: 8, miniboss: 2, boss: 0 },
  },
  {
    id: "rescue",
    name: "05. 救出",
    description: "捕虜マーカーを3箇所回収",
    objective: "捕虜回収: {progress}/3",
    goalCount: 3,
    spawnConfig: { grunt: 8, miniboss: 1, boss: 0 },
  },
  {
    id: "destroy",
    name: "06. 破壊",
    description: "敵司令官を3名排除",
    objective: "司令官排除: {progress}/3",
    goalCount: 3,
    spawnConfig: { grunt: 6, miniboss: 3, boss: 0 },
  },
  {
    id: "stealth",
    name: "07. 潜入",
    description: "発見されずにゴールへ到達",
    objective: "ステルス侵入中 — 発見禁止",
    goalCount: 1,
    spawnConfig: { grunt: 8, miniboss: 0, boss: 0 },
  },
  {
    id: "capture",
    name: "08. 制圧",
    description: "3箇所のチェックポイントを順番に制圧",
    objective: "制圧: {progress}/3",
    goalCount: 3,
    spawnConfig: { grunt: 6, miniboss: 2, boss: 0 },
  },
  {
    id: "wave",
    name: "09. ウェーブ防衛",
    description: "5ウェーブを生き延びろ",
    objective: "WAVE {progress}/{goal}",
    goalCount: 5,
    spawnConfig: { grunt: 0, miniboss: 0, boss: 0 },
  },
  {
    id: "boss",
    name: "10. ボス討伐",
    description: "ボスを単独で討伐せよ",
    objective: "ボスを排除せよ",
    goalCount: 1,
    spawnConfig: { grunt: 5, miniboss: 0, boss: 1 },
  },
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

// ── Zone definitions (daytime battlefield) ─────────────────────────────────────
const ZONES = [
  { startTX: 0, endTX: 31, color: 0x6a7a4a }, // urban: olive ground
  { startTX: 32, endTX: 63, color: 0x7a7a6a }, // industrial: gray concrete
  { startTX: 64, endTX: 95, color: 0x8b7a5a }, // outdoor: sandy earth
]

// ── Types ──────────────────────────────────────────────────────────────────────
interface TagGameInfo {
  running: boolean
  itUsername: string
  remainingMs: number
  scores: { username: string; itMs: number }[]
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
  mesh: THREE.Group // humanoid root group
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
  dyingTimer: number
  animTime: number // walking animation phase
  leftArm: THREE.Object3D | null
  rightArm: THREE.Object3D | null
  leftLeg: THREE.Object3D | null
  rightLeg: THREE.Object3D | null
  isCommander: boolean // for destroy mission
}

interface Bullet {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  life: number
  isEnemy: boolean
  damage: number
}

interface GoalMarker {
  id: string
  mesh: THREE.Mesh
  x: number
  z: number
  collected: boolean
  order: number
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

// ── Three.js scene refs ────────────────────────────────────────────────────────
interface SceneRefs {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
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
  goalMarkers: GoalMarker[]
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
  const wsRef = useRef<WebSocket | null>(null)
  const usernameRef = useRef("Player")
  const remotePosRef = useRef<Record<string, RemotePlayer>>({})
  const msgIdRef = useRef(0)
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
  // Wave / mission refs
  const currentWaveRef = useRef(-1)
  const waveActiveRef = useRef(false)
  const missionCompleteRef = useRef(false)
  const spawnWaveRef = useRef<((waveIdx: number) => void) | null>(null)
  const selectedMissionRef = useRef<MissionId | null>(null)
  const missionProgressRef = useRef(0)
  const defenseTimerRef = useRef(60)
  const sniperKillsRef = useRef(0)
  const stealthDetectedRef = useRef(false)
  const killFeedRef = useRef<{ id: number; text: string; color: string }[]>([])
  const spawnMissionRef = useRef<((missionId: MissionId) => void) | null>(null)

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
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notification, setNotification] = useState<string | null>(null)
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
  // Mission / wave state
  const [showMissionSelect, setShowMissionSelect] = useState(true)
  const [selectedMission, setSelectedMission] = useState<MissionId | null>(null)
  const [currentWave, setCurrentWave] = useState(0)
  const [waveMessage, setWaveMessage] = useState<string | null>(null)
  const [missionComplete, setMissionComplete] = useState(false)
  const [missionObjective, setMissionObjective] = useState("")
  const [missionProgress, setMissionProgress] = useState(0)
  const [missionGoal, setMissionGoal] = useState(0)
  const [defenseTimer, setDefenseTimer] = useState(60)
  const [killFeed, setKillFeed] = useState<{ id: number; text: string; color: string }[]>([])
  const [aliveEnemyCount, setAliveEnemyCount] = useState(0)

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
    if (gamePhase === "gameover") {
      SOUNDS.gameover()
      fetch(`${API_URL}/api/profile/stats`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kills: killsRef.current,
          deaths: deathsRef.current,
          score: scoreRef.current,
        }),
      }).catch(() => {})
    }
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

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, { credentials: "include" })
      if (res.ok) {
        const json = (await res.json()) as { data?: { user?: { id?: string; username?: string } } }
        if (json.data?.user?.username) {
          usernameRef.current = json.data.user.username
          return
        }
      }
    } catch {
      /* ignore */
    }
    try {
      const guest = localStorage.getItem("cw_guest_nickname")
      usernameRef.current = guest && guest.length > 0 ? guest : "Player"
    } catch {
      usernameRef.current = "Player"
    }
  }, [])

  // ── Three.js init ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function init() {
      await fetchMe()

      if (cancelled || !mountRef.current) return
      setIsLoading(false)

      const container = mountRef.current

      // ── Scene ──────────────────────────────────────────────────────────────
      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x87ceeb) // daytime sky blue
      scene.fog = new THREE.Fog(0xc0d8f0, 80, 280)

      // ── Camera (FPS) ───────────────────────────────────────────────────────
      const camera = new THREE.PerspectiveCamera(
        75,
        container.clientWidth / container.clientHeight,
        0.1,
        300,
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

      // ── Lights (daytime battlefield) ───────────────────────────────────────
      scene.add(new THREE.AmbientLight(0xd4e8ff, 2.4)) // bright sky ambient
      const sun = new THREE.DirectionalLight(0xfff4cc, 3.5) // warm sunlight
      sun.position.set(60, 80, 40)
      sun.castShadow = true
      sun.shadow.mapSize.set(2048, 2048)
      sun.shadow.camera.near = 0.5
      sun.shadow.camera.far = 200
      sun.shadow.camera.left = -80
      sun.shadow.camera.right = 80
      sun.shadow.camera.bottom = -80
      sun.shadow.camera.top = 80
      scene.add(sun)
      // Fill light from opposite side
      const fillLight = new THREE.DirectionalLight(0xb0c8ff, 0.8)
      fillLight.position.set(-40, 30, -20)
      scene.add(fillLight)

      // ── Ground zones ───────────────────────────────────────────────────────
      for (const zone of ZONES) {
        const zw = (zone.endTX - zone.startTX + 1) * TILE_UNIT
        const geo = new THREE.PlaneGeometry(zw, MAP_SIZE * TILE_UNIT)
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

      const groundGeo = new THREE.PlaneGeometry(MAP_SIZE * TILE_UNIT, MAP_SIZE * TILE_UNIT)
      const groundMat = new THREE.MeshBasicMaterial({ visible: false })
      const groundPlane = new THREE.Mesh(groundGeo, groundMat)
      groundPlane.rotation.x = -Math.PI / 2
      groundPlane.position.set((MAP_SIZE / 2) * TILE_UNIT, 0, (MAP_SIZE / 2) * TILE_UNIT)
      scene.add(groundPlane)

      // ── War-zone buildings / obstacles ─────────────────────────────────────
      const wallMeshes: THREE.Mesh[] = []

      // Shared materials
      const concreteMat = new THREE.MeshLambertMaterial({ color: 0x8a8878 })
      const concreteRoofMat = new THREE.MeshLambertMaterial({ color: 0x7a7868 })
      const industrialMat = new THREE.MeshLambertMaterial({ color: 0x787878 })
      const industrialRoofMat = new THREE.MeshLambertMaterial({ color: 0x686868 })
      const windowMat = new THREE.MeshLambertMaterial({ color: 0x1a2833, emissive: 0x050a10 })
      const barricadeMat = new THREE.MeshLambertMaterial({ color: 0x888870 })
      const tankMat = new THREE.MeshLambertMaterial({ color: 0x6a7060 })
      const pipeMat = new THREE.MeshLambertMaterial({ color: 0x888878 })
      const trenchMat = new THREE.MeshLambertMaterial({ color: 0x706050 })
      const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4226 })
      const leavesMat = new THREE.MeshLambertMaterial({ color: 0x2d5a1b })
      const carColors = [0x4a6a8a, 0x8a6a4a, 0x4a6a4a, 0x6a4a4a]

      for (const [ox, oz, ow, od, otype] of MAP_OBJECTS) {
        const cx = ox + ow / 2
        const cz = oz + od / 2
        const area = ow * od
        const isUrban = ox < 32
        const isIndustrial = ox >= 32 && ox < 66

        if (otype === 4) {
          // Tree: trunk + leaves
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, 2.0, 6), trunkMat)
          trunk.position.set(cx, 1.0, cz)
          trunk.castShadow = true
          scene.add(trunk)
          const leaves = new THREE.Mesh(new THREE.SphereGeometry(1.1, 7, 6), leavesMat)
          leaves.position.set(cx, 3.1, cz)
          leaves.castShadow = true
          scene.add(leaves)
          const leaves2 = new THREE.Mesh(
            new THREE.SphereGeometry(0.75, 6, 5),
            new THREE.MeshLambertMaterial({ color: 0x3a7a22 }),
          )
          leaves2.position.set(cx + 0.5, 3.5, cz - 0.3)
          scene.add(leaves2)
          continue
        }

        if (otype === 5) {
          // Trench / sandbag fortification
          const trenchH = 0.85
          const geo = new THREE.BoxGeometry(ow, trenchH, od)
          const mesh = new THREE.Mesh(geo, trenchMat)
          mesh.position.set(cx, trenchH / 2, cz)
          mesh.castShadow = true
          mesh.receiveShadow = true
          scene.add(mesh)
          wallMeshes.push(mesh)
          // Sandbag texture strips
          const bagGeo = new THREE.BoxGeometry(ow * 0.9, 0.22, od * 0.9)
          const bagMat = new THREE.MeshLambertMaterial({ color: 0x9a8a6a })
          for (let bi = 0; bi < 2; bi++) {
            const bag = new THREE.Mesh(bagGeo, bagMat)
            bag.position.set(cx, trenchH - 0.11 - bi * 0.24, cz)
            scene.add(bag)
          }
          continue
        }

        if (otype === 1) {
          // Car: body + windshield + tires
          const carColor = carColors[Math.floor((ox + oz) % carColors.length)] ?? 0x4a6a8a
          const carBodyMat = new THREE.MeshLambertMaterial({ color: carColor })
          const carH = 0.75
          const body = new THREE.Mesh(new THREE.BoxGeometry(ow, carH, od), carBodyMat)
          body.position.set(cx, carH / 2, cz)
          body.castShadow = true
          body.receiveShadow = true
          scene.add(body)
          wallMeshes.push(body)
          // Windshield
          const windshield = new THREE.Mesh(new THREE.BoxGeometry(ow * 0.6, 0.38, 0.05), windowMat)
          windshield.position.set(cx, carH * 0.85, oz + od * 0.3)
          scene.add(windshield)
          // Tires (4 wheels)
          const tireMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a })
          const tireR = 0.22
          const tirePositions: [number, number][] =
            ow >= od
              ? [
                  [ox + ow * 0.2, oz],
                  [ox + ow * 0.8, oz],
                  [ox + ow * 0.2, oz + od],
                  [ox + ow * 0.8, oz + od],
                ]
              : [
                  [ox, oz + od * 0.2],
                  [ox + ow, oz + od * 0.2],
                  [ox, oz + od * 0.8],
                  [ox + ow, oz + od * 0.8],
                ]
          for (const [tx2, tz2] of tirePositions) {
            const tire = new THREE.Mesh(new THREE.CylinderGeometry(tireR, tireR, 0.14, 8), tireMat)
            tire.position.set(tx2, tireR, tz2)
            tire.rotation.z = Math.PI / 2
            scene.add(tire)
          }
          continue
        }

        if (otype === 2) {
          // Barricade (concrete barrier / jersey barrier)
          const bH = 0.85
          const bGeo = new THREE.BoxGeometry(ow, bH, od)
          const mesh = new THREE.Mesh(bGeo, barricadeMat)
          mesh.position.set(cx, bH / 2, cz)
          mesh.castShadow = true
          mesh.receiveShadow = true
          scene.add(mesh)
          wallMeshes.push(mesh)
          // Stripe markings
          const stripeMat = new THREE.MeshLambertMaterial({ color: 0xffaa00 })
          const stripeGeo = new THREE.BoxGeometry(ow, 0.08, od + 0.02)
          const stripe = new THREE.Mesh(stripeGeo, stripeMat)
          stripe.position.set(cx, bH * 0.6, cz)
          scene.add(stripe)
          continue
        }

        if (otype === 3) {
          // Tank or pipe
          const isTank = ow >= 2 && od >= 2
          if (isTank) {
            const tankH = 3.0
            const tankBody = new THREE.Mesh(
              new THREE.CylinderGeometry(1.1, 1.2, tankH, 10),
              tankMat,
            )
            tankBody.position.set(cx, tankH / 2, cz)
            tankBody.castShadow = true
            scene.add(tankBody)
            wallMeshes.push(new THREE.Mesh(new THREE.BoxGeometry(ow, tankH, od), tankMat))
            // Top dome
            const dome = new THREE.Mesh(
              new THREE.SphereGeometry(1.1, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2),
              tankMat,
            )
            dome.position.set(cx, tankH, cz)
            scene.add(dome)
          } else {
            // Pipe
            const pipeH = ow > od ? 0.45 : od * 0.7
            const pipeGeo = new THREE.BoxGeometry(ow, pipeH > 0 ? pipeH : 0.45, od)
            const pipe = new THREE.Mesh(pipeGeo, pipeMat)
            pipe.position.set(cx, pipeH / 2 + 0.4, cz)
            pipe.castShadow = true
            scene.add(pipe)
            wallMeshes.push(pipe)
          }
          continue
        }

        // otype === 0: Building
        const wallH = area > 60 ? 7.0 : area > 35 ? 5.5 : area > 12 ? 3.8 : 2.5
        const bldMat = isUrban ? concreteMat : isIndustrial ? industrialMat : concreteMat
        const roofBldMat = isUrban ? concreteRoofMat : industrialRoofMat

        // Main body
        const bodyGeo = new THREE.BoxGeometry(ow, wallH, od)
        const bodyMesh = new THREE.Mesh(bodyGeo, bldMat)
        bodyMesh.position.set(cx, wallH / 2, cz)
        bodyMesh.castShadow = true
        bodyMesh.receiveShadow = true
        scene.add(bodyMesh)
        wallMeshes.push(bodyMesh)

        // Roof
        const roofGeo = new THREE.BoxGeometry(ow + 0.2, 0.2, od + 0.2)
        const roof = new THREE.Mesh(roofGeo, roofBldMat)
        roof.position.set(cx, wallH + 0.1, cz)
        roof.castShadow = true
        scene.add(roof)

        // Windows on large buildings
        if (wallH >= 3.8 && ow >= 4) {
          const wCols = Math.max(1, Math.floor(ow / 2.5))
          const wRows = Math.max(1, Math.floor((wallH - 1.0) / 1.8))
          for (let wRow = 0; wRow < wRows; wRow++) {
            for (let wCol = 0; wCol < wCols; wCol++) {
              const winX = ox + (wCol + 0.5) * (ow / wCols)
              const winY = 1.0 + wRow * ((wallH - 1.0) / wRows)
              const winGeo = new THREE.BoxGeometry((ow / wCols) * 0.5, 0.7, 0.06)
              const winF = new THREE.Mesh(winGeo, windowMat)
              winF.position.set(winX, winY, oz - 0.04)
              scene.add(winF)
              const winB = winF.clone()
              winB.position.set(winX, winY, oz + od + 0.04)
              scene.add(winB)
            }
          }
        }

        // Rubble around base for urban ruins effect
        if (isUrban && wallH >= 3.0 && (ox + oz) % 3 === 0) {
          const rubbleMat2 = new THREE.MeshLambertMaterial({ color: 0x7a7a6a })
          for (let ri = 0; ri < 4; ri++) {
            const angle = (ri / 4) * Math.PI * 2
            const dist = 0.8 + (ri % 2) * 0.5
            const rubble = new THREE.Mesh(
              new THREE.BoxGeometry(
                0.3 + ri * 0.1,
                0.2 + (ri % 2) * 0.15,
                0.3 + ((ri + 1) % 2) * 0.2,
              ),
              rubbleMat2,
            )
            rubble.position.set(cx + Math.cos(angle) * dist, 0.1, cz + Math.sin(angle) * dist)
            rubble.rotation.y = angle
            scene.add(rubble)
          }
        }
      }

      // ── FPS camera state ───────────────────────────────────────────────────
      // Start in urban zone (x=8, z=48), facing east toward the battlefield
      const focalPoint = new THREE.Vector3(8, 0, 48)
      const camState = { yaw: -Math.PI / 2, pitch: 0 } // facing +X (east)

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

      // ── Humanoid enemy factory ─────────────────────────────────────────────
      let enemyIdCounter = 0
      function makeEnemy(type: EnemyType, x: number, z: number, isCommander = false): CombatEnemy {
        const cfg = ENEMY_CONFIGS[type]
        const scale = type === "boss" ? 1.25 : type === "miniboss" ? 1.05 : 1.0
        const bodyColor = isCommander ? 0xff6600 : cfg.color

        const group = new THREE.Group()
        group.position.set(x, 0, z)
        scene.add(group)

        const skinMat = new THREE.MeshLambertMaterial({ color: bodyColor, emissive: cfg.emissive })
        const darkMat = new THREE.MeshLambertMaterial({
          color: type === "grunt" ? 0x4a5240 : type === "miniboss" ? 0x111111 : 0x5a0000,
        })

        // Helper to tag each part with enemyId for raycasting
        function makePart(
          geo: THREE.BufferGeometry,
          mat: THREE.Material,
          px: number,
          py: number,
          pz: number,
          parent: THREE.Object3D = group,
        ): THREE.Mesh {
          const m = new THREE.Mesh(geo, mat)
          m.position.set(px * scale, py * scale, pz * scale)
          m.castShadow = true
          m.userData.enemyId = `enemy_${enemyIdCounter}`
          parent.add(m)
          return m
        }

        // Legs (animated groups, pivot at hip joint)
        const leftLegGrp = new THREE.Group()
        leftLegGrp.position.set(-0.12 * scale, 0.72 * scale, 0)
        group.add(leftLegGrp)
        // thigh
        makePart(
          new THREE.BoxGeometry(0.14 * scale, 0.34 * scale, 0.13 * scale),
          skinMat,
          0,
          -0.17,
          0,
          leftLegGrp,
        )
        // shin
        makePart(
          new THREE.BoxGeometry(0.11 * scale, 0.32 * scale, 0.11 * scale),
          skinMat,
          0,
          -0.49,
          0,
          leftLegGrp,
        )
        // boot
        makePart(
          new THREE.BoxGeometry(0.13 * scale, 0.1 * scale, 0.18 * scale),
          darkMat,
          0,
          -0.67,
          0.03,
          leftLegGrp,
        )

        const rightLegGrp = new THREE.Group()
        rightLegGrp.position.set(0.12 * scale, 0.72 * scale, 0)
        group.add(rightLegGrp)
        makePart(
          new THREE.BoxGeometry(0.14 * scale, 0.34 * scale, 0.13 * scale),
          skinMat,
          0,
          -0.17,
          0,
          rightLegGrp,
        )
        makePart(
          new THREE.BoxGeometry(0.11 * scale, 0.32 * scale, 0.11 * scale),
          skinMat,
          0,
          -0.49,
          0,
          rightLegGrp,
        )
        makePart(
          new THREE.BoxGeometry(0.13 * scale, 0.1 * scale, 0.18 * scale),
          darkMat,
          0,
          -0.67,
          0.03,
          rightLegGrp,
        )

        // Waist
        makePart(
          new THREE.BoxGeometry(0.38 * scale, 0.16 * scale, 0.22 * scale),
          darkMat,
          0,
          0.8,
          0,
        )

        // Torso (with vest or plate carrier)
        makePart(
          new THREE.BoxGeometry(0.44 * scale, 0.52 * scale, 0.24 * scale),
          skinMat,
          0,
          1.14,
          0,
        )
        // Vest / armor plate
        makePart(
          new THREE.BoxGeometry(0.46 * scale, 0.46 * scale, 0.06 * scale),
          darkMat,
          0,
          1.14,
          -0.15,
        )

        // Arms (animated groups, pivot at shoulder)
        const leftArmGrp = new THREE.Group()
        leftArmGrp.position.set(-0.27 * scale, 1.32 * scale, 0)
        group.add(leftArmGrp)
        makePart(
          new THREE.BoxGeometry(0.12 * scale, 0.3 * scale, 0.12 * scale),
          skinMat,
          0,
          -0.15,
          0,
          leftArmGrp,
        )
        makePart(
          new THREE.BoxGeometry(0.1 * scale, 0.27 * scale, 0.1 * scale),
          skinMat,
          0,
          -0.42,
          0,
          leftArmGrp,
        )
        // hand
        makePart(
          new THREE.BoxGeometry(0.09 * scale, 0.1 * scale, 0.09 * scale),
          darkMat,
          0,
          -0.58,
          0,
          leftArmGrp,
        )

        const rightArmGrp = new THREE.Group()
        rightArmGrp.position.set(0.27 * scale, 1.32 * scale, 0)
        group.add(rightArmGrp)
        makePart(
          new THREE.BoxGeometry(0.12 * scale, 0.3 * scale, 0.12 * scale),
          skinMat,
          0,
          -0.15,
          0,
          rightArmGrp,
        )
        makePart(
          new THREE.BoxGeometry(0.1 * scale, 0.27 * scale, 0.1 * scale),
          skinMat,
          0,
          -0.42,
          0,
          rightArmGrp,
        )
        makePart(
          new THREE.BoxGeometry(0.09 * scale, 0.1 * scale, 0.09 * scale),
          darkMat,
          0,
          -0.58,
          0,
          rightArmGrp,
        )

        // Shoulder pads (miniboss/boss only)
        if (type !== "grunt") {
          makePart(
            new THREE.BoxGeometry(0.2 * scale, 0.16 * scale, 0.28 * scale),
            darkMat,
            -0.28,
            1.38,
            0,
          )
          makePart(
            new THREE.BoxGeometry(0.2 * scale, 0.16 * scale, 0.28 * scale),
            darkMat,
            0.28,
            1.38,
            0,
          )
        }

        // Neck
        makePart(new THREE.BoxGeometry(0.1 * scale, 0.12 * scale, 0.1 * scale), skinMat, 0, 1.46, 0)

        // Head
        const headGeo = new THREE.SphereGeometry(0.165 * scale, 8, 7)
        const headMat = new THREE.MeshLambertMaterial({
          color: type === "boss" ? 0x700000 : 0xc8a878,
          emissive: cfg.emissive,
        })
        const headMesh = new THREE.Mesh(headGeo, headMat)
        headMesh.position.set(0, 1.635 * scale, 0)
        headMesh.castShadow = true
        headMesh.userData.enemyId = `enemy_${enemyIdCounter}`
        group.add(headMesh)

        // Helmet (grunt/miniboss)
        if (type === "grunt") {
          const helmetMat = new THREE.MeshLambertMaterial({ color: 0x3a4230 })
          const helmet = new THREE.Mesh(
            new THREE.SphereGeometry(0.19 * scale, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
            helmetMat,
          )
          helmet.position.set(0, 1.66 * scale, 0)
          helmet.userData.enemyId = `enemy_${enemyIdCounter}`
          group.add(helmet)
        }

        // Commander indicator (orange glowing halo)
        if (isCommander) {
          const haloGeo = new THREE.TorusGeometry(0.3 * scale, 0.04 * scale, 6, 12)
          const haloMat = new THREE.MeshBasicMaterial({ color: 0xff6600 })
          const halo = new THREE.Mesh(haloGeo, haloMat)
          halo.position.set(0, 2.1 * scale, 0)
          halo.userData.enemyId = `enemy_${enemyIdCounter}`
          group.add(halo)
          const glow = new THREE.PointLight(0xff6600, 1.0, 4)
          glow.position.set(0, 2.0 * scale, 0)
          group.add(glow)
        }

        const patrol = [
          { x, z },
          {
            x: Math.max(2, Math.min(MAP_SIZE - 2, x + 8)),
            z: Math.max(2, Math.min(MAP_SIZE - 2, z + 8)),
          },
          {
            x: Math.max(2, Math.min(MAP_SIZE - 2, x - 8)),
            z: Math.max(2, Math.min(MAP_SIZE - 2, z + 8)),
          },
          {
            x: Math.max(2, Math.min(MAP_SIZE - 2, x - 8)),
            z: Math.max(2, Math.min(MAP_SIZE - 2, z - 8)),
          },
        ]
        const eid = enemyIdCounter++
        return {
          id: `enemy_${eid}`,
          mesh: group,
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
          animTime: Math.random() * Math.PI * 2,
          leftArm: leftArmGrp,
          rightArm: rightArmGrp,
          leftLeg: leftLegGrp,
          rightLeg: rightLegGrp,
          isCommander,
        }
      }

      // ── Wave / mission spawner ─────────────────────────────────────────────
      const enemies: CombatEnemy[] = []
      const goalMarkers: GoalMarker[] = []

      function clearEnemies() {
        for (const e of enemies) scene.remove(e.mesh)
        enemies.length = 0
      }
      function clearGoalMarkers() {
        for (const m of goalMarkers) scene.remove(m.mesh)
        goalMarkers.length = 0
      }

      function spawnEnemiesFromDef(def: WaveDef, commanderCount = 0) {
        const types: EnemyType[] = [
          ...Array<EnemyType>(def.grunt).fill("grunt"),
          ...Array<EnemyType>(def.miniboss).fill("miniboss"),
          ...Array<EnemyType>(def.boss).fill("boss"),
        ]
        const shuffled = [...SPAWN_POINTS].sort(() => Math.random() - 0.5)
        let commandersSpawned = 0
        for (let i = 0; i < types.length; i++) {
          const sp = shuffled[i % shuffled.length] ?? shuffled[0]
          if (!sp) continue
          const type = types[i] ?? "grunt"
          const ex = Math.max(2, Math.min(MAP_SIZE - 2, sp.x + (Math.random() - 0.5) * 3))
          const ez = Math.max(2, Math.min(MAP_SIZE - 2, sp.z + (Math.random() - 0.5) * 3))
          const isCmd = commandersSpawned < commanderCount && type === "miniboss"
          if (isCmd) commandersSpawned++
          enemies.push(makeEnemy(type, ex, ez, isCmd))
        }
        setAliveEnemyCount(enemies.length)
        setEnemyStatus(
          enemies.map((e) => ({ id: e.id, hp: e.hp, maxHp: e.maxHp, type: e.type, alive: true })),
        )
      }

      function placeGoalMarker(mx: number, mz: number, markerOrder: number, color = 0xffcc00) {
        const markerMat = new THREE.MeshLambertMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.5,
        })
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.0, 6), markerMat)
        pole.position.set(mx, 1.5, mz)
        scene.add(pole)
        const top = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), markerMat)
        top.position.set(mx, 3.2, mz)
        scene.add(top)
        const light = new THREE.PointLight(color, 1.5, 8)
        light.position.set(mx, 3.2, mz)
        scene.add(light)
        // Use pole as the combined mesh for simplicity
        const marker: GoalMarker = {
          id: `marker_${markerOrder}`,
          mesh: pole,
          x: mx,
          z: mz,
          collected: false,
          order: markerOrder,
        }
        goalMarkers.push(marker)
        // Attach top as child for visibility toggling
        pole.add(top)
        return marker
      }

      function spawnMission(missionId: MissionId) {
        clearEnemies()
        clearGoalMarkers()
        selectedMissionRef.current = missionId
        missionProgressRef.current = 0
        sniperKillsRef.current = 0
        stealthDetectedRef.current = false
        missionCompleteRef.current = false
        setMissionComplete(false)
        setMissionProgress(0)

        const mdef = MISSION_DEFS.find((m) => m.id === missionId)
        if (!mdef) return
        setMissionGoal(mdef.goalCount)
        setMissionObjective(
          mdef.objective
            .replace("{progress}", "0")
            .replace("{goal}", String(mdef.goalCount))
            .replace("{timer}", "60"),
        )

        if (missionId === "wave") {
          currentWaveRef.current = 0
          setCurrentWave(1)
          setWaveMessage("WAVE 1 INCOMING")
          waveActiveRef.current = false
          spawnEnemiesFromDef(WAVE_DEFS[0] ?? { grunt: 6, miniboss: 0, boss: 0 })
          setTimeout(() => {
            setWaveMessage(null)
            waveActiveRef.current = true
          }, 3000)
          return
        }

        if (missionId === "defense") {
          defenseTimerRef.current = 60
          setDefenseTimer(60)
        }

        if (missionId === "breakthrough" || missionId === "stealth") {
          placeGoalMarker(90, 48, 0, 0x00ff88)
        }

        if (missionId === "rescue") {
          placeGoalMarker(48, 20, 0, 0xffcc00)
          placeGoalMarker(80, 60, 1, 0xffcc00)
          placeGoalMarker(40, 80, 2, 0xffcc00)
        }

        if (missionId === "capture") {
          placeGoalMarker(30, 48, 0, 0x44aaff)
          placeGoalMarker(60, 48, 1, 0x44aaff)
          placeGoalMarker(88, 48, 2, 0x44aaff)
        }

        const isCommander = missionId === "destroy"
        spawnEnemiesFromDef(mdef.spawnConfig, isCommander ? 3 : 0)
        waveActiveRef.current = true
      }

      spawnMissionRef.current = spawnMission

      function spawnWave(waveIdx: number) {
        clearEnemies()
        const def = WAVE_DEFS[waveIdx]
        if (!def) return
        spawnEnemiesFromDef(def)
      }
      spawnWaveRef.current = spawnWave

      const bullets: Bullet[] = []
      const bloodParticles: BloodParticle[] = []
      const explosionParticles: ExplosionParticle[] = []

      sceneRef.current = {
        scene,
        camera,
        renderer,
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
        goalMarkers,
      }

      setEnemyStatus([])

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
          damage: weapon.hitDamage,
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

        // Center-ray hit detection (recursive through humanoid groups)
        pointer.set(0, 0)
        raycaster.setFromCamera(pointer, camera)
        const aliveEnemies = enemies.filter((e) => e.hp > 0)
        const allEnemyParts: THREE.Object3D[] = []
        for (const e of aliveEnemies) {
          e.mesh.traverse((child) => {
            if (child instanceof THREE.Mesh && child.userData.enemyId) {
              allEnemyParts.push(child)
            }
          })
        }
        const enemyHits = raycaster.intersectObjects(allEnemyParts, false)
        if (enemyHits.length > 0) {
          const hitEnemyId = enemyHits[0]?.object.userData.enemyId as string | undefined
          const hitEnemy = aliveEnemies.find((e) => e.id === hitEnemyId)
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
                  ? "BOSS ELIMINATED"
                  : hitEnemy.type === "miniboss"
                    ? "MINIBOSS ELIMINATED"
                    : hitEnemy.isCommander
                      ? "COMMANDER ELIMINATED"
                      : "GRUNT ELIMINATED"
              showNotification(`${tag} +${hitEnemy.config.score}pt`)
              // Kill feed
              const feedColor =
                hitEnemy.type === "boss"
                  ? "#cc44ff"
                  : hitEnemy.type === "miniboss"
                    ? "#ff8800"
                    : "#ff5555"
              const feedEntry = { id: Date.now(), text: tag, color: feedColor }
              killFeedRef.current = [...killFeedRef.current, feedEntry].slice(-6)
              setKillFeed([...killFeedRef.current])
              setTimeout(() => {
                killFeedRef.current = killFeedRef.current.filter((e) => e.id !== feedEntry.id)
                setKillFeed([...killFeedRef.current])
              }, 4000)
              // Mission-specific progress
              const mission = selectedMissionRef.current
              if (mission === "sniper" && weapon.id === "sniper") {
                sniperKillsRef.current += 1
                missionProgressRef.current = sniperKillsRef.current
                setMissionProgress(sniperKillsRef.current)
              } else if (mission === "destroy" && hitEnemy.isCommander) {
                missionProgressRef.current += 1
                setMissionProgress(missionProgressRef.current)
              } else if (mission === "boss" && hitEnemy.type === "boss") {
                missionProgressRef.current = 1
                setMissionProgress(1)
              }
              // Check alive enemy count
              const stillAlive = enemies.filter((e) => e.hp > 0).length
              setAliveEnemyCount(stillAlive)
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
        }
      }
      function onMouseUp(e: MouseEvent) {
        if (e.button === 0) mouseDownRef.current = false
      }
      function onContextMenu(e: MouseEvent) {
        e.preventDefault()
      }

      // Mobile touch
      function onTouchStartLP(e: TouchEvent) {
        if (!e.touches[0]) return
        fire()
      }
      function onTouchEndLP() {
        if (longPressRef.current) {
          clearTimeout(longPressRef.current)
          longPressRef.current = null
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
                playerHpRef.current = Math.max(0, playerHpRef.current - b.damage)
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
              // Patrol walking animation
              enemy.animTime += dt * 5
              const swingP = Math.sin(enemy.animTime) * 0.3
              if (enemy.leftArm) enemy.leftArm.rotation.x = swingP
              if (enemy.rightArm) enemy.rightArm.rotation.x = -swingP
              if (enemy.leftLeg) enemy.leftLeg.rotation.x = -swingP * 0.8
              if (enemy.rightLeg) enemy.rightLeg.rotation.x = swingP * 0.8
              if (
                enemyCanSee(enemy.facing.x, enemy.facing.z, toPx, toPz, distToPlayer, enemy.config)
              ) {
                enemy.state = "alert"
                enemy.lastSeenPlayer = { x: fp.x, z: fp.z }
                // Stealth mission: detected = fail
                if (selectedMissionRef.current === "stealth" && !stealthDetectedRef.current) {
                  stealthDetectedRef.current = true
                  showNotification("⚠ 発見された！ミッション失敗")
                }
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
                  life: 2.2,
                  isEnemy: true,
                  damage: enemy.config.fireDamage,
                })
              }
              // Walking animation while alerting
              enemy.animTime += dt * 7
              const swingA = Math.sin(enemy.animTime) * 0.4
              if (enemy.leftArm) enemy.leftArm.rotation.x = swingA
              if (enemy.rightArm) enemy.rightArm.rotation.x = -swingA
              if (enemy.leftLeg) enemy.leftLeg.rotation.x = -swingA * 0.7
              if (enemy.rightLeg) enemy.rightLeg.rotation.x = swingA * 0.7
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
                  life: 2.2,
                  isEnemy: true,
                  damage: enemy.config.fireDamage,
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

        // ── Aimed enemy detection (crosshair highlight, recursive) ──────────
        {
          pointer.set(0, 0)
          raycaster.setFromCamera(pointer, camera)
          const aimParts: THREE.Object3D[] = []
          for (const e of refs.enemies.filter((e2) => e2.hp > 0)) {
            e.mesh.traverse((child) => {
              if (child instanceof THREE.Mesh && child.userData.enemyId) aimParts.push(child)
            })
          }
          const aimHits = raycaster.intersectObjects(aimParts, false)
          const newAimed =
            aimHits.length > 0
              ? ((aimHits[0]?.object.userData.enemyId as string | null) ?? null)
              : null
          if (newAimed !== refs.aimedEnemyId) {
            refs.aimedEnemyId = newAimed
            setAimedEnemyId(newAimed)
          }
        }

        // ── Goal marker collection ─────────────────────────────────────────
        if (waveActiveRef.current && !missionCompleteRef.current) {
          for (const marker of refs.goalMarkers) {
            if (marker.collected) continue
            const mdx = refs.focalPoint.x - marker.x
            const mdz = refs.focalPoint.z - marker.z
            if (Math.sqrt(mdx * mdx + mdz * mdz) < 2.5) {
              const mission = selectedMissionRef.current
              // Check ordering for capture mission
              if (mission === "capture") {
                const collected = refs.goalMarkers.filter((m) => m.collected).length
                if (marker.order !== collected) continue // must collect in order
              }
              marker.collected = true
              marker.mesh.visible = false
              missionProgressRef.current += 1
              setMissionProgress(missionProgressRef.current)
              const remaining = refs.goalMarkers.filter((m) => !m.collected).length
              showNotification(
                remaining > 0 ? `マーカー回収！残り${remaining}` : "全マーカー回収！",
              )
            }
          }
        }

        // ── Mission completion checks ─────────────────────────────────────
        if (waveActiveRef.current && !missionCompleteRef.current) {
          const mission = selectedMissionRef.current
          let complete = false
          if (mission === "wave") {
            const allDead = refs.enemies.every((e) => e.hp <= 0 && e.dyingTimer < 0)
            if (allDead) {
              waveActiveRef.current = false
              const nextWaveIdx = currentWaveRef.current + 1
              if (nextWaveIdx >= WAVE_DEFS.length) {
                complete = true
              } else {
                currentWaveRef.current = nextWaveIdx
                setCurrentWave(nextWaveIdx + 1)
                setMissionProgress(nextWaveIdx + 1)
                setWaveMessage(`WAVE ${nextWaveIdx + 1} INCOMING`)
                setTimeout(() => {
                  setWaveMessage(null)
                  spawnWaveRef.current?.(nextWaveIdx)
                  waveActiveRef.current = true
                }, 3000)
              }
            }
          } else if (mission === "elimination") {
            const allDead = refs.enemies.every((e) => e.hp <= 0 && e.dyingTimer < 0)
            if (allDead) complete = true
          } else if (mission === "sniper") {
            if (sniperKillsRef.current >= 5) complete = true
          } else if (mission === "destroy") {
            if (missionProgressRef.current >= 3) complete = true
          } else if (mission === "boss") {
            if (missionProgressRef.current >= 1) complete = true
          } else if (mission === "breakthrough" || mission === "stealth") {
            if (refs.goalMarkers.every((m) => m.collected)) complete = true
            if (mission === "stealth" && stealthDetectedRef.current) {
              // stealth fail: game over
              gamePhaseRef.current = "gameover"
              setGamePhase("gameover")
            }
          } else if (mission === "rescue" || mission === "capture") {
            if (refs.goalMarkers.every((m) => m.collected)) complete = true
          } else if (mission === "defense") {
            defenseTimerRef.current -= dt
            const secs = Math.max(0, Math.ceil(defenseTimerRef.current))
            setDefenseTimer(secs)
            if (defenseTimerRef.current <= 0) complete = true
          }
          if (complete && !missionCompleteRef.current) {
            missionCompleteRef.current = true
            setMissionComplete(true)
            SOUNDS.clear()
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
            // Draw walls on minimap
            // Zone colors on minimap
            ctx.fillStyle = "#3a4a2a"
            ctx.fillRect(0, 0, 32 * SCALE, W)
            ctx.fillStyle = "#3a3a2a"
            ctx.fillRect(32 * SCALE, 0, 32 * SCALE, W)
            ctx.fillStyle = "#4a3a1a"
            ctx.fillRect(64 * SCALE, 0, 32 * SCALE, W)
            ctx.fillStyle = "#555545"
            for (const [wx, wz, ww, wd] of WALL_DEFS) {
              ctx.fillRect(wx * SCALE, wz * SCALE, Math.max(1, ww * SCALE), Math.max(1, wd * SCALE))
            }
            // Goal markers
            for (const marker of refs.goalMarkers) {
              if (marker.collected) continue
              ctx.fillStyle = "#00ff88"
              ctx.beginPath()
              ctx.arc(marker.x * SCALE, marker.z * SCALE, 4, 0, Math.PI * 2)
              ctx.fill()
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
  }, [fetchMe, showNotification])

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
          roomId: "global",
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

        {/* ── Mission objective (top-left, COD style) ──────────────────── */}
        {!isLoading &&
          !error &&
          gamePhase === "playing" &&
          selectedMission &&
          !showMissionSelect && (
            <div
              style={{
                position: "absolute",
                top: "1rem",
                left: "1rem",
                zIndex: 20,
                pointerEvents: "none",
                fontFamily: "monospace",
              }}
            >
              <div
                style={{
                  color: "#88aaff",
                  fontSize: "0.55rem",
                  letterSpacing: "0.18em",
                  marginBottom: "0.2rem",
                }}
              >
                MISSION OBJECTIVE
              </div>
              <div
                style={{
                  color: "white",
                  fontSize: "0.72rem",
                  fontWeight: "bold",
                  letterSpacing: "0.06em",
                  marginBottom: "0.3rem",
                }}
              >
                {missionObjective
                  .replace("{progress}", String(missionProgress))
                  .replace("{goal}", String(missionGoal))
                  .replace("{timer}", String(defenseTimer))}
              </div>
              {selectedMission === "defense" && (
                <div
                  style={{
                    color: defenseTimer < 10 ? "#ff3333" : "#ffcc00",
                    fontSize: "1.4rem",
                    fontWeight: "bold",
                  }}
                >
                  {defenseTimer}s
                </div>
              )}
              {selectedMission !== "defense" && missionGoal > 1 && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  <div
                    style={{
                      height: "4px",
                      width: "120px",
                      background: "rgba(255,255,255,0.15)",
                      borderRadius: "2px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.min(100, (missionProgress / missionGoal) * 100)}%`,
                        background: "#88aaff",
                        transition: "width 0.3s",
                      }}
                    />
                  </div>
                  <span style={{ color: "#88aaff", fontSize: "0.55rem" }}>
                    {missionProgress}/{missionGoal}
                  </span>
                </div>
              )}
            </div>
          )}

        {/* ── Enemy count (top-center) ────────────────────────────────── */}
        {!isLoading && !error && gamePhase === "playing" && !showMissionSelect && (
          <div
            style={{
              position: "absolute",
              top: "0.6rem",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 20,
              pointerEvents: "none",
              fontFamily: "monospace",
              textAlign: "center",
            }}
          >
            <div
              style={{ color: "rgba(255,80,80,0.85)", fontSize: "0.62rem", letterSpacing: "0.2em" }}
            >
              ENEMIES REMAINING
            </div>
            <div
              style={{ color: "#ff5555", fontSize: "1.4rem", fontWeight: "bold", lineHeight: 1 }}
            >
              {aliveEnemyCount}
            </div>
          </div>
        )}

        {/* ── Kill feed (right side) ──────────────────────────────────── */}
        {!isLoading && !error && killFeed.length > 0 && (
          <div
            style={{
              position: "absolute",
              top: "8rem",
              right: "1rem",
              zIndex: 20,
              pointerEvents: "none",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: "3px",
              fontFamily: "monospace",
            }}
          >
            {killFeed.map((entry) => (
              <div
                key={entry.id}
                style={{
                  color: entry.color,
                  fontSize: "0.62rem",
                  fontWeight: "bold",
                  letterSpacing: "0.08em",
                  background: "rgba(0,0,0,0.5)",
                  padding: "2px 6px",
                  borderLeft: `2px solid ${entry.color}`,
                }}
              >
                {entry.text}
              </div>
            ))}
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

        {/* Mission selection screen */}
        {showMissionSelect && !isLoading && !error && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,5,15,0.96)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-start",
              paddingTop: "2rem",
              gap: "1rem",
              zIndex: 50,
              fontFamily: "monospace",
              overflowY: "auto",
            }}
          >
            <div style={{ color: "#88aacc", fontSize: "0.65rem", letterSpacing: "0.4em" }}>
              MODERN WARFARE
            </div>
            <div
              style={{
                color: "#ffffff",
                fontSize: "2rem",
                fontWeight: "bold",
                letterSpacing: "0.3em",
                textShadow: "0 2px 20px rgba(100,180,255,0.6)",
              }}
            >
              SELECT MISSION
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: "0.5rem",
                maxWidth: "680px",
                width: "100%",
                padding: "0 1rem",
              }}
            >
              {MISSION_DEFS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setSelectedMission(m.id)
                    setShowMissionSelect(false)
                    rendererDomRef.current?.requestPointerLock()
                    setMissionGoal(m.goalCount)
                    spawnMissionRef.current?.(m.id)
                  }}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: "0.2rem",
                    padding: "0.65rem 0.9rem",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    color: "white",
                    fontFamily: "monospace",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    ;(e.currentTarget as HTMLButtonElement).style.background =
                      "rgba(100,180,255,0.12)"
                    ;(e.currentTarget as HTMLButtonElement).style.borderColor =
                      "rgba(100,180,255,0.5)"
                  }}
                  onMouseLeave={(e) => {
                    ;(e.currentTarget as HTMLButtonElement).style.background =
                      "rgba(255,255,255,0.04)"
                    ;(e.currentTarget as HTMLButtonElement).style.borderColor =
                      "rgba(255,255,255,0.15)"
                  }}
                >
                  <span style={{ fontSize: "0.72rem", fontWeight: "bold", color: "#88aaff" }}>
                    {m.name}
                  </span>
                  <span style={{ fontSize: "0.6rem", color: "rgba(255,255,255,0.55)" }}>
                    {m.description}
                  </span>
                </button>
              ))}
            </div>
            <div
              style={{
                color: "rgba(255,255,255,0.2)",
                fontSize: "0.58rem",
                letterSpacing: "0.12em",
                marginTop: "0.5rem",
              }}
            >
              WASD: MOVE · SHIFT: SPRINT · LMB: FIRE · R: RELOAD · 1/2/3: WEAPON
            </div>
          </div>
        )}

        {/* CLICK TO PLAY overlay (after mission selected, pointer not locked) */}
        {!isMobile &&
          !isLoading &&
          !error &&
          !isPointerLocked &&
          !showMissionSelect &&
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
        {!isLoading &&
          !error &&
          !showMissionSelect &&
          gamePhase === "playing" &&
          currentWave > 0 && (
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
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
