"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import * as THREE from "three"

// ── Constants ──────────────────────────────────────────────────────────────────
const MAP_SIZE = 100
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
// Death animation: 1.2s collapse → 1.8s lying on ground → 1.0s fade out.
const DEATH_ANIM_FALL = 1.2
const DEATH_ANIM_LIE = 1.8
const DEATH_ANIM_FADE = 1.0
const DEATH_ANIM_TOTAL = DEATH_ANIM_FALL + DEATH_ANIM_LIE + DEATH_ANIM_FADE

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
  // ── Additional cover (phase2 expansion to 100x100) ─────────────────────────
  // Outer perimeter ruins
  [90, 6, 4, 5, 0],
  [90, 24, 5, 4, 0],
  [91, 42, 4, 6, 0],
  [90, 60, 5, 5, 0],
  [91, 78, 4, 6, 0],
  [92, 91, 5, 5, 0],
  // Additional sandbag barricades
  [38, 25, 4, 0.5, 2],
  [50, 38, 0.5, 4, 2],
  [38, 50, 4, 0.5, 2],
  [50, 62, 0.5, 4, 2],
  [40, 75, 4, 0.5, 2],
  // Extra tanks and pipes in industrial
  [54, 16, 1.5, 1.5, 3],
  [54, 50, 1.5, 1.5, 3],
  [54, 80, 1.5, 1.5, 3],
  // Additional trenches in outdoor zone
  [72, 92, 14, 1, 5],
  [76, 76, 1, 8, 5],
  // Wrecked vehicles scattered
  [40, 28, 2, 1, 1],
  [55, 50, 1, 2, 1],
  [70, 30, 2, 1, 1],
  [80, 55, 1, 2, 1],
  // Extra rubble buildings outer ring
  [3, 90, 8, 6, 0],
  [15, 91, 7, 5, 0],
  [25, 92, 6, 5, 0],
]

// WALL_DEFS for backward compat (minimap, cover AI)
const WALL_DEFS: [number, number, number, number][] = MAP_OBJECTS.map(([x, z, w, d]) => [
  x,
  z,
  w,
  d,
])
// Heights mirror what the renderer actually places (see the MAP_OBJECTS loop):
// type 0 building height scales with area, low cover is ~0.75–0.85, tanks ~3.
function wallHeightFor(type: number, w: number, d: number): number {
  if (type === 0) {
    const area = w * d
    return area > 60 ? 7.0 : area > 35 ? 5.5 : area > 12 ? 3.8 : 2.5
  }
  if (type === 1) return 0.75 // car
  if (type === 2) return 0.85 // barricade
  if (type === 3) return w >= 2 && d >= 2 ? 3.0 : 0.85 // tank vs pipe
  if (type === 5) return 0.85 // trench/sandbag
  return 0.6 // tree (rough trunk hitbox; lets shots pass over)
}
type WallAABB = { x1: number; z1: number; x2: number; z2: number; h: number }
const WALL_AABBS: WallAABB[] = MAP_OBJECTS.map(([x, z, w, d, type]) => ({
  x1: x,
  z1: z,
  x2: x + w,
  z2: z + d,
  h: wallHeightFor(type, w, d),
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

// True if a point is inside *any* wall's 3D AABB. Used for bullet-vs-wall:
// y is checked so a barricade doesn't stop a shot flying over it at eye height.
function pointInsideWall(px: number, py: number, pz: number): boolean {
  for (const w of ALL_AABBS) {
    if (px > w.x1 && px < w.x2 && pz > w.z1 && pz < w.z2 && py >= 0 && py <= w.h) return true
  }
  return false
}

// Spiral search for a clear (no-wall) position near (x, z). Returns the input
// when it's already clear; otherwise pushes outward in concentric rings.
function findSafeSpawnNear(x: number, z: number, radius: number): { x: number; z: number } {
  if (!collidesWithWall(x, z, radius)) return { x, z }
  const STEP = 0.9
  for (let ring = 1; ring <= 12; ring++) {
    const r = ring * STEP
    // 8 sample points per ring; first clear hit wins.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const nx = x + Math.cos(a) * r
      const nz = z + Math.sin(a) * r
      if (
        nx > radius &&
        nx < MAP_SIZE - radius &&
        nz > radius &&
        nz < MAP_SIZE - radius &&
        !collidesWithWall(nx, nz, radius)
      ) {
        return { x: nx, z: nz }
      }
    }
  }
  // Fallback: map center (always clear in our layouts).
  return { x: MAP_SIZE / 2, z: MAP_SIZE / 2 }
}

// ── Enemy type system ──────────────────────────────────────────────────────────
type EnemyType = "grunt" | "sniper" | "heavy"
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
  sniper: {
    hp: 90,
    speed: 1.6,
    attackDamage: 15,
    attackInterval: 2200,
    attackRange: 1.8,
    fireRange: 38,
    fireInterval: 2800,
    fireDamage: 32,
    color: 0x4a5532, // camo green-brown
    emissive: 0x080a05,
    bodyW: 0.55,
    bodyH: 1.85,
    sightRange: 36,
    fovAngle: Math.PI * 0.7,
    score: 220,
    blockReward: 2,
  },
  heavy: {
    hp: 320,
    speed: 1.0,
    attackDamage: 28,
    attackInterval: 2200,
    attackRange: 2.4,
    fireRange: 22,
    fireInterval: 1500,
    fireDamage: 22,
    color: 0x1a1a1a, // matte black
    emissive: 0x040404,
    bodyW: 0.8,
    bodyH: 2.1,
    sightRange: 24,
    fovAngle: Math.PI * 0.85,
    score: 480,
    blockReward: 6,
  },
}

// ── Wave system ────────────────────────────────────────────────────────────────
interface WaveDef {
  grunt: number
  sniper: number
  heavy: number
}
const WAVE_DEFS: WaveDef[] = [
  { grunt: 6, sniper: 0, heavy: 0 },
  { grunt: 6, sniper: 2, heavy: 0 },
  { grunt: 4, sniper: 2, heavy: 0 },
  { grunt: 4, sniper: 3, heavy: 0 },
  { grunt: 3, sniper: 2, heavy: 1 },
]
const SPAWN_POINTS = [
  { x: 3, z: 3 },
  { x: 50, z: 3 },
  { x: 97, z: 3 },
  { x: 97, z: 50 },
  { x: 97, z: 97 },
  { x: 50, z: 97 },
  { x: 3, z: 97 },
  { x: 3, z: 50 },
  { x: 18, z: 18 },
  { x: 50, z: 18 },
  { x: 82, z: 18 },
  { x: 18, z: 50 },
  { x: 82, z: 50 },
  { x: 18, z: 82 },
  { x: 50, z: 82 },
  { x: 82, z: 82 },
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
    spawnConfig: { grunt: 12, sniper: 3, heavy: 0 },
  },
  {
    id: "defense",
    name: "02. 防衛",
    description: "60秒間拠点を守れ",
    objective: "拠点を守る: {timer}秒",
    goalCount: 60,
    spawnConfig: { grunt: 10, sniper: 3, heavy: 0 },
  },
  {
    id: "sniper",
    name: "03. 狙撃",
    description: "スナイパーで敵5体を遠距離撃破",
    objective: "スナイパーキル: {progress}/5",
    goalCount: 5,
    spawnConfig: { grunt: 10, sniper: 0, heavy: 0 },
  },
  {
    id: "breakthrough",
    name: "04. 突破",
    description: "敵の包囲を突破してゴールへ到達",
    objective: "ゴールマーカーに到達せよ",
    goalCount: 1,
    spawnConfig: { grunt: 8, sniper: 2, heavy: 0 },
  },
  {
    id: "rescue",
    name: "05. 救出",
    description: "捕虜マーカーを3箇所回収",
    objective: "捕虜回収: {progress}/3",
    goalCount: 3,
    spawnConfig: { grunt: 8, sniper: 1, heavy: 0 },
  },
  {
    id: "destroy",
    name: "06. 破壊",
    description: "敵司令官を3名排除",
    objective: "司令官排除: {progress}/3",
    goalCount: 3,
    spawnConfig: { grunt: 6, sniper: 3, heavy: 0 },
  },
  {
    id: "stealth",
    name: "07. 潜入",
    description: "発見されずにゴールへ到達",
    objective: "ステルス侵入中 — 発見禁止",
    goalCount: 1,
    spawnConfig: { grunt: 8, sniper: 0, heavy: 0 },
  },
  {
    id: "capture",
    name: "08. 制圧",
    description: "3箇所のチェックポイントを順番に制圧",
    objective: "制圧: {progress}/3",
    goalCount: 3,
    spawnConfig: { grunt: 6, sniper: 2, heavy: 0 },
  },
  {
    id: "wave",
    name: "09. ウェーブ防衛",
    description: "5ウェーブを生き延びろ",
    objective: "WAVE {progress}/{goal}",
    goalCount: 5,
    spawnConfig: { grunt: 0, sniper: 0, heavy: 0 },
  },
  {
    id: "boss",
    name: "10. ボス討伐",
    description: "ボスを単独で討伐せよ",
    objective: "ボス（重装兵）を排除せよ",
    goalCount: 1,
    spawnConfig: { grunt: 5, sniper: 0, heavy: 1 },
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
  { startTX: 0, endTX: 32, color: 0x6a7a4a }, // urban: olive ground
  { startTX: 33, endTX: 65, color: 0x7a7a6a }, // industrial: gray concrete
  { startTX: 66, endTX: 99, color: 0x8b7a5a }, // outdoor: sandy earth
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
  team?: "red" | "blue" | "ffa"
  hp?: number
  alive?: boolean
  kills?: number
  deaths?: number
  countryCode?: string | null
}

interface ChatMessage {
  id: number
  from: string
  text: string
  isSystem?: boolean
}

// Per-joint smoothed pose. Each frame we compute targetPose from the current
// AI state, then exponentially interpolate currentPose toward it so direction
// changes look like a real body easing in/out of motion rather than snapping.
interface AnimPose {
  leftShoulder: number // rotation.x
  rightShoulder: number
  leftElbow: number
  rightElbow: number
  leftHip: number
  rightHip: number
  leftKnee: number
  rightKnee: number
  torsoLeanZ: number // strafe lean
  torsoPitchX: number // forward lean when sprinting
  torsoBreath: number // additive scale.y
  pelvisRotY: number // counter-rotate vs torso during walk
  headYaw: number // head rotation.y (relative to body)
  headPitch: number // head rotation.x (look up/down)
  eyeOpenness: number // 1 = wide, 0 = blinking
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
  // +1 = face-plant forward, -1 = fall on back. Computed from the shooter's
  // relative position at the moment of kill so the corpse falls *away* from
  // the bullet. Default 1 if unset (no shooter info, e.g. self-destruct).
  deathFallDir: number
  animTime: number // walking animation phase
  leftArm: THREE.Object3D | null
  rightArm: THREE.Object3D | null
  leftLeg: THREE.Object3D | null
  rightLeg: THREE.Object3D | null
  // Sub-joints for natural articulation (elbow / knee).
  leftForearm?: THREE.Object3D | null
  rightForearm?: THREE.Object3D | null
  leftShin?: THREE.Object3D | null
  rightShin?: THREE.Object3D | null
  // Torso (for breathing) and head (for look-at). Pelvis is enemy.mesh's child[0].
  torso?: THREE.Object3D | null
  head?: THREE.Object3D | null
  // Per-bot/enemy shadow plane for ground projection (set in spawnEnemiesFromDef).
  shadowMesh?: THREE.Mesh | null
  // Meshes that should hide when far (eyes / mouth / pouches / ghillie strips).
  lodDetails?: THREE.Object3D[]
  // Eye meshes for blink scaling (subset of lodDetails). Optional.
  leftEye?: THREE.Mesh
  rightEye?: THREE.Mesh
  // Smoothed walk velocity (world space). Lerps toward desired velocity each
  // frame so enemies accelerate and decelerate instead of teleporting around.
  velocity: { x: number; z: number }
  // Smoothed yaw — body turns toward facing direction over time, not instantly.
  smoothedYaw: number
  // Per-frame interpolated pose. Animation state machine writes a target pose
  // each tick; this `pose` lerps toward it (frame-independent exp blend).
  pose: AnimPose
  // Phase offsets so a crowd of enemies doesn't blink / breathe in lockstep.
  blinkPhase: number
  blinkTimer: number // seconds until next blink
  blinkActive: number // seconds remaining in current blink
  breathPhase: number
  microIdleSeed: number
  isCommander: boolean // for destroy mission
  // Bot fields (FFA/TDM): set only when this enemy is a bot player
  isBot?: boolean
  botName?: string
  botTeam?: "red" | "blue" | "ffa"
  botAccuracyMult?: number // 1.0 = stock; lower = worse aim spread
  botReactMult?: number // 1.0 = stock; higher = slower fire interval
  botRespawnMs?: number // ms between death and respawn
  nameSprite?: THREE.Sprite | null
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

export type BotDifficulty = "easy" | "normal" | "hard"

interface BotDifficultyTuning {
  hpMult: number
  accuracyMult: number // <1 = sloppier aim
  reactMult: number // >1 = slower fire cadence
  damageMult: number
  sightMult: number
  respawnMs: number
}

const BOT_DIFFICULTY_CONFIGS: Record<BotDifficulty, BotDifficultyTuning> = {
  easy: {
    hpMult: 0.65,
    accuracyMult: 0.45,
    reactMult: 1.6,
    damageMult: 0.6,
    sightMult: 0.85,
    respawnMs: 5000,
  },
  normal: {
    hpMult: 1.0,
    accuracyMult: 1.0,
    reactMult: 1.0,
    damageMult: 1.0,
    sightMult: 1.0,
    respawnMs: 4000,
  },
  hard: {
    hpMult: 1.3,
    accuracyMult: 1.6,
    reactMult: 0.7,
    damageMult: 1.3,
    sightMult: 1.2,
    respawnMs: 3000,
  },
}

const BOT_NAMES = ["Bot_α", "Bot_β", "Bot_γ", "Bot_δ", "Bot_ε", "Bot_ζ", "Bot_η", "Bot_θ", "Bot_ι"]

export interface ThreeWorldProps {
  mode?: "wave_defense" | "ffa" | "tdm"
  mapId?: "urban" | "desert" | "snow"
  botCount?: number
  botDifficulty?: BotDifficulty
  onExit?: () => void
}

export default function ThreeWorld({
  mode = "wave_defense",
  mapId = "urban",
  botCount = 0,
  botDifficulty = "normal",
  onExit,
}: ThreeWorldProps = {}) {
  const mountRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<SceneRefs | null>(null)
  const animFrameRef = useRef<number>(0)
  const keysRef = useRef<Set<string>>(new Set())
  const joystickRef = useRef({ vx: 0, vy: 0 })
  const joyContainerRef = useRef<HTMLDivElement>(null)
  const joyThumbRef = useRef<HTMLDivElement>(null)
  const lookJoyRef = useRef({ vx: 0, vy: 0 })
  const lookJoyContainerRef = useRef<HTMLDivElement>(null)
  const lookJoyThumbRef = useRef<HTMLDivElement>(null)
  // Low-pass filtered stick values — kills finger micro-jitter while staying
  // responsive. Mouse input intentionally stays raw (smoothing mice adds lag).
  const joySmoothRef = useRef({ vx: 0, vy: 0 })
  const lookSmoothRef = useRef({ vx: 0, vy: 0 })
  // Player movement velocity (smoothed). Position += vel * dt each frame so
  // there's a tiny accel/decel instead of an instant snap when input changes.
  const playerVelRef = useRef({ x: 0, z: 0 })
  // Walk-bob: vertical head sway phase, advances only while moving.
  const walkBobRef = useRef(0)
  // Pointer-locked mouse delta accumulates here per event, then drains in
  // the animate loop with a tiny low-pass blend. Decouples mouse-event rate
  // (which can spike >500Hz on gaming mice) from frame rate, and removes
  // sub-pixel jitter without adding perceivable input lag.
  const mouseDeltaRef = useRef({ x: 0, y: 0 })
  const wsRef = useRef<WebSocket | null>(null)
  const usernameRef = useRef("Player")
  const remotePosRef = useRef<Record<string, RemotePlayer>>({})
  const msgIdRef = useRef(0)
  const minimapRef = useRef<HTMLCanvasElement>(null)
  const tagGameRef = useRef<TagGameInfo | null>(null)
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

  // Phase 3: extended stat refs
  const maxKillstreakRef = useRef(0)
  const headshotsRef = useRef(0)
  const weaponKillsRef = useRef<Record<string, number>>({
    pistol: 0,
    shotgun: 0,
    sniper: 0,
    grenade: 0,
  })
  const matchStartRef = useRef(Date.now())
  const spawnInvulnUntilRef = useRef(0)
  const isAimingRef = useRef(false)
  const [, setIsAiming] = useState(false)
  const myTeamRef = useRef<"red" | "blue" | "ffa">("ffa")
  const [myTeam, setMyTeam] = useState<"red" | "blue" | "ffa">("ffa")
  const teamScoreRef = useRef<{ red: number; blue: number }>({ red: 0, blue: 0 })
  const [teamScore, setTeamScore] = useState<{ red: number; blue: number }>({ red: 0, blue: 0 })
  const [mvpName, setMvpName] = useState<string | null>(null)
  const [grenadeCooldownMs, setGrenadeCooldownMs] = useState(0)
  const lastGrenadeRef = useRef(0)
  // Last value pushed to setGrenadeCooldownMs — guards against re-renders
  // when the rounded display value hasn't changed (animate loop calls this
  // every frame).
  const prevGrenadeCdRef = useRef(0)
  // Mirror of `playerHp` (the rendered React state). Animate loop uses this
  // to bail out of setPlayerHp calls while regen is ticking sub-integer.
  const prevDisplayHpRef = useRef(PLAYER_MAX_HP)
  const requestGrenadeRef = useRef(false)
  const modeRef = useRef(mode)
  // initialize spawn invuln (3s grace at match start)
  if (spawnInvulnUntilRef.current === 0) {
    spawnInvulnUntilRef.current = Date.now() + 3000
  }

  // UI state
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [onlineCount, setOnlineCount] = useState(1)
  const [isMobile, setIsMobile] = useState(false)
  const [isLandscape, setIsLandscape] = useState(false)
  // CRT scanlines: default off (was too distracting). F8 toggles, persisted
  // in localStorage so the choice survives refresh.
  const [scanlinesOn, setScanlinesOn] = useState(false)
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
  const [showMissionSelect, setShowMissionSelect] = useState(mode === "wave_defense")
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
    const detectLandscape = () => setIsLandscape(window.innerWidth > window.innerHeight)
    detectLandscape()
    window.addEventListener("resize", detectLandscape)
    window.addEventListener("orientationchange", detectLandscape)
    try {
      const stored = localStorage.getItem("fps_unlocked_weapons")
      if (stored) {
        const list = JSON.parse(stored) as string[]
        setUnlockedWeapons(new Set(list))
      }
    } catch {
      /* ignore */
    }
    try {
      if (localStorage.getItem("fps_scanlines") === "1") setScanlinesOn(true)
    } catch {
      /* ignore */
    }
    return () => {
      window.removeEventListener("resize", detectLandscape)
      window.removeEventListener("orientationchange", detectLandscape)
    }
  }, [])
  useEffect(() => {
    if (gamePhase === "gameover") {
      SOUNDS.gameover()
      const durationSec = Math.max(0, Math.floor((Date.now() - matchStartRef.current) / 1000))
      // Determine MVP: compare against remote players' scores
      let bestName = usernameRef.current
      let bestKills = killsRef.current
      const remotes = remotePosRef.current
      for (const r of Object.values(remotes)) {
        const k = r.kills ?? 0
        if (k > bestKills) {
          bestKills = k
          bestName = r.username
        }
      }
      setMvpName(bestName)
      fetch(`${API_URL}/api/profile/stats`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kills: killsRef.current,
          deaths: deathsRef.current,
          score: scoreRef.current,
          killstreak: maxKillstreakRef.current,
          headshots: headshotsRef.current,
          durationSec,
          mode,
          mapId,
          weaponKills: weaponKillsRef.current,
          result: killsRef.current > deathsRef.current ? "victory" : "ended",
        }),
      }).catch(() => {})
    }
  }, [gamePhase, mode, mapId])
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: scene init reads mode/mapId on mount only
  useEffect(() => {
    let cancelled = false

    async function init() {
      await fetchMe()

      if (cancelled || !mountRef.current) return
      setIsLoading(false)

      const container = mountRef.current

      // ── Scene ──────────────────────────────────────────────────────────────
      const scene = new THREE.Scene()
      const theme =
        mapId === "desert"
          ? { sky: 0xf0c887, fog: 0xe6c89a, ambient: 0xffe9c0, sun: 0xffd58a }
          : mapId === "snow"
            ? { sky: 0xb4d6f0, fog: 0xd6e8f5, ambient: 0xe8f0ff, sun: 0xffffff }
            : { sky: 0x87ceeb, fog: 0xc0d8f0, ambient: 0xd4e8ff, sun: 0xfff4cc }
      scene.background = new THREE.Color(theme.sky)
      scene.fog = new THREE.Fog(theme.fog, 80, 280)

      // ── Camera (FPS) ───────────────────────────────────────────────────────
      const camera = new THREE.PerspectiveCamera(
        75,
        container.clientWidth / container.clientHeight,
        0.1,
        300,
      )
      camera.rotation.order = "YXZ"

      // ── Renderer ───────────────────────────────────────────────────────────
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "high-performance",
      })
      renderer.setSize(container.clientWidth, container.clientHeight)
      // Cap at 1.75 instead of 2 — on retina the extra 14% pixels rarely
      // shows visually but costs ~30% GPU. Keeps perf room for shadows.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
      // ACESFilmic + linear→sRGB output gives the "cinematic" desaturated
      // highlight rolloff that COD/Battlefield use; exposure < 1 keeps the
      // bright sky from blowing out against PBR-lit concrete.
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 0.95
      renderer.outputColorSpace = THREE.SRGBColorSpace
      container.appendChild(renderer.domElement)
      rendererDomRef.current = renderer.domElement
      // Max anisotropy is read once and reused for every procedural texture
      // below — saves repeated capability lookups.
      const maxAniso = renderer.capabilities.getMaxAnisotropy()

      // ── Lights (daytime battlefield) ───────────────────────────────────────
      // Ambient was 2.4 — washed out shadows entirely. Drop it to 0.45 and
      // let a HemisphereLight handle the sky-vs-ground gradient (gives
      // "outdoor day" feel without crushing shadow contrast).
      scene.add(new THREE.AmbientLight(theme.ambient, 0.45))
      const hemi = new THREE.HemisphereLight(theme.sky, 0x4a4030, 0.55)
      hemi.position.set(0, 50, 0)
      scene.add(hemi)
      const sun = new THREE.DirectionalLight(theme.sun, 2.8)
      sun.position.set(60, 80, 40)
      sun.castShadow = true
      sun.shadow.mapSize.set(2048, 2048)
      sun.shadow.camera.near = 0.5
      sun.shadow.camera.far = 200
      sun.shadow.camera.left = -80
      sun.shadow.camera.right = 80
      sun.shadow.camera.bottom = -80
      sun.shadow.camera.top = 80
      // Bias fights shadow acne on the flat building walls; normal bias
      // handles the bands where the sun grazes a vertical surface.
      sun.shadow.bias = -0.0005
      sun.shadow.normalBias = 0.04
      sun.shadow.radius = 2
      scene.add(sun)
      // Fill light from opposite side (gentle bounce-light proxy)
      const fillLight = new THREE.DirectionalLight(0xb0c8ff, 0.45)
      fillLight.position.set(-40, 30, -20)
      scene.add(fillLight)

      // ── Procedural noise textures ──────────────────────────────────────────
      // Pure flat-colored boxes shimmer at distance (moire from mipmap aliasing
      // of the constant color against fog). A subtle multi-octave noise
      // texture per material breaks up the surface, gives mipmaps something
      // to filter, and reads as "concrete/metal weathering".
      function makeNoiseTexture(
        size: number,
        baseHex: number,
        contrast: number,
        repeat: number,
      ): THREE.CanvasTexture {
        const canvas = document.createElement("canvas")
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext("2d")
        if (ctx) {
          const baseR = (baseHex >> 16) & 0xff
          const baseG = (baseHex >> 8) & 0xff
          const baseB = baseHex & 0xff
          const img = ctx.createImageData(size, size)
          for (let i = 0; i < size * size; i++) {
            // Mix two noise scales for fake fractal feel.
            const coarse = Math.random()
            const fine = Math.random()
            const n = (coarse * 0.7 + fine * 0.3 - 0.5) * 2 // [-1, 1]
            const k = 1 + n * contrast
            img.data[i * 4 + 0] = Math.max(0, Math.min(255, baseR * k))
            img.data[i * 4 + 1] = Math.max(0, Math.min(255, baseG * k))
            img.data[i * 4 + 2] = Math.max(0, Math.min(255, baseB * k))
            img.data[i * 4 + 3] = 255
          }
          ctx.putImageData(img, 0, 0)
        }
        const tex = new THREE.CanvasTexture(canvas)
        tex.wrapS = THREE.RepeatWrapping
        tex.wrapT = THREE.RepeatWrapping
        tex.repeat.set(repeat, repeat)
        tex.generateMipmaps = true
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.magFilter = THREE.LinearFilter
        tex.anisotropy = maxAniso
        tex.colorSpace = THREE.SRGBColorSpace
        return tex
      }
      const concreteNoise = makeNoiseTexture(128, 0xffffff, 0.12, 6)
      const industrialNoise = makeNoiseTexture(128, 0xffffff, 0.09, 5)
      const groundNoise = makeNoiseTexture(256, 0xffffff, 0.07, 24)

      // ── Ground zones ───────────────────────────────────────────────────────
      const zoneTint = (base: number): number => {
        if (mapId === "desert") {
          const r = ((base >> 16) & 0xff) * 0.6 + 0xb0 * 0.4
          const g = ((base >> 8) & 0xff) * 0.55 + 0x85 * 0.45
          const b = (base & 0xff) * 0.45 + 0x40 * 0.55
          return ((r | 0) << 16) | ((g | 0) << 8) | (b | 0)
        }
        if (mapId === "snow") {
          const r = ((base >> 16) & 0xff) * 0.35 + 0xe0 * 0.65
          const g = ((base >> 8) & 0xff) * 0.35 + 0xe8 * 0.65
          const b = (base & 0xff) * 0.4 + 0xf5 * 0.6
          return ((r | 0) << 16) | ((g | 0) << 8) | (b | 0)
        }
        return base
      }
      for (const zone of ZONES) {
        const zw = (zone.endTX - zone.startTX + 1) * TILE_UNIT
        const geo = new THREE.PlaneGeometry(zw, MAP_SIZE * TILE_UNIT)
        // Standard material + the shared ground noise texture so the floor
        // doesn't look like a flat painted plane under directional light.
        const mat = new THREE.MeshStandardMaterial({
          color: zoneTint(zone.color),
          map: groundNoise,
          roughness: 0.95,
          metalness: 0,
        })
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

      // Shared materials. Buildings use MeshStandardMaterial (PBR) with the
      // procedural noise as albedo so they read as weathered concrete/metal
      // under tone mapping. Roughness near 1 keeps the specular subtle.
      const concreteMat = new THREE.MeshStandardMaterial({
        color: 0x8a8878,
        map: concreteNoise,
        roughness: 0.92,
        metalness: 0,
      })
      const concreteRoofMat = new THREE.MeshStandardMaterial({
        color: 0x7a7868,
        map: concreteNoise,
        roughness: 0.95,
        metalness: 0,
      })
      const industrialMat = new THREE.MeshStandardMaterial({
        color: 0x787878,
        map: industrialNoise,
        roughness: 0.7,
        metalness: 0.25,
      })
      const industrialRoofMat = new THREE.MeshStandardMaterial({
        color: 0x686868,
        map: industrialNoise,
        roughness: 0.75,
        metalness: 0.25,
      })
      const windowMat = new THREE.MeshStandardMaterial({
        color: 0x1a2833,
        emissive: 0x050a10,
        roughness: 0.1,
        metalness: 0.6,
      })
      const barricadeMat = new THREE.MeshStandardMaterial({
        color: 0x888870,
        map: concreteNoise,
        roughness: 0.9,
        metalness: 0,
      })
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
          // Sandbag strips — stacked *on top of* the trench (previously
          // their geometry sat inside the trench body, z-fighting both
          // top and side faces of the parent box).
          const bagGeo = new THREE.BoxGeometry(ow * 0.9, 0.16, od * 0.9)
          const bagMat = new THREE.MeshStandardMaterial({
            color: 0x9a8a6a,
            roughness: 0.95,
            metalness: 0,
          })
          for (let bi = 0; bi < 2; bi++) {
            const bag = new THREE.Mesh(bagGeo, bagMat)
            bag.position.set(cx, trenchH + 0.08 + bi * 0.17, cz)
            bag.castShadow = true
            bag.receiveShadow = true
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
          // Windshield — sit it *on* the front face (z = oz, slight offset)
          // instead of buried inside the body (was at oz + od*0.3, fully
          // inside the box — flickered through the body's front face).
          const windshield = new THREE.Mesh(new THREE.BoxGeometry(ow * 0.6, 0.38, 0.05), windowMat)
          windshield.position.set(cx, carH * 0.85, oz - 0.03)
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
          // Stripe markings — protrude meaningfully on all 4 sides so no
          // face is coplanar with the parent barricade (was only +0.01 on
          // z and identical on x, which flickered at distance).
          const stripeMat = new THREE.MeshStandardMaterial({
            color: 0xffaa00,
            emissive: 0x301800,
            roughness: 0.6,
            metalness: 0,
          })
          const stripeGeo = new THREE.BoxGeometry(ow + 0.06, 0.08, od + 0.06)
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
            tankBody.receiveShadow = true
            scene.add(tankBody)
            // Was pushing a dummy box at position (0,0,0) — never matched
            // the real tank's location, so wall-occlusion raycasts and
            // bullet checks missed tanks entirely. Push the cylinder itself.
            wallMeshes.push(tankBody)
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

        // Roof — small upward offset so the roof's bottom face doesn't
        // sit *exactly* on the body's top face (used to z-fight at the
        // joint when viewed from a distance).
        const roofGeo = new THREE.BoxGeometry(ow + 0.2, 0.2, od + 0.2)
        const roof = new THREE.Mesh(roofGeo, roofBldMat)
        roof.position.set(cx, wallH + 0.12, cz)
        roof.castShadow = true
        roof.receiveShadow = true
        scene.add(roof)

        // Windows on large buildings
        if (wallH >= 3.8 && ow >= 4) {
          const wCols = Math.max(1, Math.floor(ow / 2.5))
          const wRows = Math.max(1, Math.floor((wallH - 1.0) / 1.8))
          for (let wRow = 0; wRow < wRows; wRow++) {
            for (let wCol = 0; wCol < wCols; wCol++) {
              const winX = ox + (wCol + 0.5) * (ow / wCols)
              const winY = 1.0 + wRow * ((wallH - 1.0) / wRows)
              const winGeo = new THREE.BoxGeometry((ow / wCols) * 0.5, 0.7, 0.08)
              // Centered ON the wall face (slight protrusion outward) so
              // the inner face is clearly inside the wall — eliminates the
              // earlier 0.01 hairline-gap z-fight.
              const winF = new THREE.Mesh(winGeo, windowMat)
              winF.position.set(winX, winY, oz - 0.02)
              scene.add(winF)
              const winB = winF.clone()
              winB.position.set(winX, winY, oz + od + 0.02)
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
      // West edge of map, facing east into the urban zone. (Previously (8, 48)
      // which sat *inside* building AABB [3,45,6,7] — collidesWithWall blocked
      // every step, so the player could never leave spawn.)
      const focalPoint = new THREE.Vector3(2, 0, 48)
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

      // Player ground shadow — circular planar decal that follows focalPoint.
      // Cheap stand-in for shadow mapping; visible at the player's feet always.
      const playerShadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.42, 18),
        new THREE.MeshBasicMaterial({
          color: 0x000000,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
        }),
      )
      playerShadow.rotation.x = -Math.PI / 2
      playerShadow.position.set(focalPoint.x, 0.02, focalPoint.z)
      scene.add(playerShadow)

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
        const scale = type === "heavy" ? 1.25 : type === "sniper" ? 1.03 : 1.0
        const bodyColor = isCommander ? 0xff6600 : cfg.color
        const eid = enemyIdCounter++
        const enemyIdStr = `enemy_${eid}`

        const root = new THREE.Group()
        // YXZ so death-anim's rotation.x tips around the *body's* lateral
        // axis (after yaw), giving a clean forward/backward fall regardless
        // of the direction the enemy was facing.
        root.rotation.order = "YXZ"
        root.position.set(x, 0, z)
        scene.add(root)

        // ── Materials ────────────────────────────────────────────────────────
        const bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor, emissive: cfg.emissive })
        const darkColor = type === "grunt" ? 0x2a3027 : type === "sniper" ? 0x18241b : 0x080808
        const darkMat = new THREE.MeshLambertMaterial({ color: darkColor })
        const skinMat = new THREE.MeshLambertMaterial({ color: 0xc8a878 })
        const gloveMat = new THREE.MeshLambertMaterial({ color: 0x141414 })
        // Eye glow varies by archetype (sniper green NV, grunt blue, heavy red).
        const eyeHex = type === "heavy" ? 0xff3333 : type === "sniper" ? 0x55ff99 : 0x88ddff
        const eyeMat = new THREE.MeshBasicMaterial({ color: eyeHex })

        const lodDetails: THREE.Object3D[] = []
        // Mark a mesh as hit-target (raycast uses userData.enemyId).
        function hit<T extends THREE.Object3D>(o: T): T {
          o.userData.enemyId = enemyIdStr
          return o
        }
        function cyl(rTop: number, rBot: number, h: number, seg = 8): THREE.CylinderGeometry {
          return new THREE.CylinderGeometry(rTop * scale, rBot * scale, h * scale, seg)
        }
        function box(w: number, h: number, d: number): THREE.BoxGeometry {
          return new THREE.BoxGeometry(w * scale, h * scale, d * scale)
        }
        function sph(r: number, ws = 10, hs = 8): THREE.SphereGeometry {
          return new THREE.SphereGeometry(r * scale, ws, hs)
        }

        // ── Pelvis (root of the rig; everything above hangs off it) ──────────
        const pelvis = new THREE.Group()
        pelvis.position.set(0, 0.92 * scale, 0)
        root.add(pelvis)
        const pelvisMesh = hit(new THREE.Mesh(box(0.42, 0.18, 0.26), darkMat))
        pelvisMesh.castShadow = true
        pelvis.add(pelvisMesh)

        // ── Legs (hip → knee → boot) ─────────────────────────────────────────
        const legSpread = type === "heavy" ? 0.16 : 0.13
        function buildLeg(side: -1 | 1): { hip: THREE.Group; knee: THREE.Group } {
          const hip = new THREE.Group()
          hip.position.set(side * legSpread * scale, 0, 0)
          pelvis.add(hip)
          const thigh = hit(new THREE.Mesh(cyl(0.085, 0.072, 0.36), bodyMat))
          thigh.position.y = -0.21 * scale
          thigh.castShadow = true
          hip.add(thigh)
          // Knee group pivots at end of thigh for natural bend
          const knee = new THREE.Group()
          knee.position.y = -0.39 * scale
          hip.add(knee)
          const shin = hit(new THREE.Mesh(cyl(0.07, 0.06, 0.34), darkMat))
          shin.position.y = -0.18 * scale
          shin.castShadow = true
          knee.add(shin)
          // Boot — chunkier toe-forward shape
          const boot = hit(new THREE.Mesh(box(0.14, 0.09, 0.24), darkMat))
          boot.position.set(0, -0.4 * scale, 0.05 * scale)
          knee.add(boot)
          // Knee cap detail (LOD)
          const kneeCap = new THREE.Mesh(sph(0.045, 6, 6), darkMat)
          kneeCap.position.set(0, 0, 0.05 * scale)
          knee.add(kneeCap)
          lodDetails.push(kneeCap)
          return { hip, knee }
        }
        const leftLeg = buildLeg(-1)
        const rightLeg = buildLeg(1)

        // ── Torso (above pelvis; scales subtly for breathing) ────────────────
        const torso = new THREE.Group()
        torso.position.set(0, 0.1 * scale, 0)
        pelvis.add(torso)
        const torsoW = type === "heavy" ? 0.56 : 0.48
        const torsoD = type === "heavy" ? 0.32 : 0.28
        // Lower torso (narrower — trapezoidal silhouette)
        const lowerTorso = hit(new THREE.Mesh(box(torsoW - 0.06, 0.24, torsoD - 0.02), bodyMat))
        lowerTorso.position.y = 0.16 * scale
        lowerTorso.castShadow = true
        torso.add(lowerTorso)
        // Upper torso (chest)
        const upperTorso = hit(new THREE.Mesh(box(torsoW, 0.3, torsoD), bodyMat))
        upperTorso.position.y = 0.42 * scale
        upperTorso.castShadow = true
        torso.add(upperTorso)
        // Vest plate (front)
        const vestFront = hit(new THREE.Mesh(box(torsoW + 0.02, 0.44, 0.06), darkMat))
        vestFront.position.set(0, 0.34 * scale, -(torsoD / 2 + 0.02) * scale)
        torso.add(vestFront)
        // Vest pouches (LOD)
        for (const sx of [-0.14, 0.14]) {
          const pouch = new THREE.Mesh(box(0.12, 0.1, 0.06), darkMat)
          pouch.position.set(sx * scale, 0.2 * scale, -(torsoD / 2 + 0.04) * scale)
          torso.add(pouch)
          lodDetails.push(pouch)
        }

        // ── Neck ─────────────────────────────────────────────────────────────
        const neck = new THREE.Mesh(cyl(0.06, 0.072, 0.13), skinMat)
        neck.position.y = 0.68 * scale
        torso.add(neck)

        // ── Head group (skull + jaw + eyes + mouth + helmet) ─────────────────
        const head = new THREE.Group()
        head.position.y = 0.84 * scale
        torso.add(head)
        const skull = hit(new THREE.Mesh(sph(0.17, 14, 12), skinMat))
        skull.castShadow = true
        head.add(skull)
        // Jaw — subtle box under skull
        const jaw = new THREE.Mesh(box(0.16, 0.06, 0.14), skinMat)
        jaw.position.set(0, -0.11 * scale, 0.02 * scale)
        head.add(jaw)
        // Glowing eyes (LOD-hidden when far). Keep handles for blink animation.
        const eyeGeo = sph(0.022, 6, 6)
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat)
        leftEye.position.set(-0.055 * scale, 0.02 * scale, -0.155 * scale)
        head.add(leftEye)
        lodDetails.push(leftEye)
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat)
        rightEye.position.set(0.055 * scale, 0.02 * scale, -0.155 * scale)
        head.add(rightEye)
        lodDetails.push(rightEye)
        // Mouth slit (LOD)
        const mouth = new THREE.Mesh(
          box(0.06, 0.012, 0.005),
          new THREE.MeshBasicMaterial({ color: 0x222222 }),
        )
        mouth.position.set(0, -0.06 * scale, -0.165 * scale)
        head.add(mouth)
        lodDetails.push(mouth)

        // ── Helmet / Visor (per archetype) ───────────────────────────────────
        const helmetColor = type === "grunt" ? 0x3a4230 : type === "sniper" ? 0x4a5535 : 0x101010
        const helmetMat = new THREE.MeshLambertMaterial({ color: helmetColor })
        if (type === "heavy") {
          const helmet = hit(new THREE.Mesh(box(0.36, 0.24, 0.34), helmetMat))
          helmet.position.y = 0.06 * scale
          helmet.castShadow = true
          head.add(helmet)
          // Translucent wraparound visor (LOD: keep but always visible since it ID's the unit)
          const visor = new THREE.Mesh(
            box(0.32, 0.08, 0.04),
            new THREE.MeshLambertMaterial({
              color: eyeHex,
              emissive: eyeHex,
              emissiveIntensity: 0.8,
              transparent: true,
              opacity: 0.75,
            }),
          )
          visor.position.set(0, 0.02 * scale, -0.18 * scale)
          head.add(visor)
        } else {
          const helmet = hit(
            new THREE.Mesh(
              new THREE.SphereGeometry(0.2 * scale, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
              helmetMat,
            ),
          )
          helmet.position.y = 0.04 * scale
          helmet.castShadow = true
          head.add(helmet)
          const brim = new THREE.Mesh(box(0.36, 0.04, 0.08), helmetMat)
          brim.position.set(0, 0.0, -0.17 * scale)
          head.add(brim)
          // Translucent visor band (snipers get a darker tint, grunts a faint glow)
          const visor = new THREE.Mesh(
            box(0.28, 0.06, 0.03),
            new THREE.MeshLambertMaterial({
              color: eyeHex,
              emissive: eyeHex,
              emissiveIntensity: type === "sniper" ? 0.4 : 0.6,
              transparent: true,
              opacity: 0.7,
            }),
          )
          visor.position.set(0, 0.0, -0.18 * scale)
          head.add(visor)
        }

        // ── Shoulders + Arms (upper arm → forearm → hand; rifle on right) ────
        const shoulderX = type === "heavy" ? 0.34 : 0.28
        const shoulderR = type === "heavy" ? 0.14 : 0.12
        function buildArm(side: -1 | 1): { shoulder: THREE.Group; elbow: THREE.Group } {
          const shoulder = new THREE.Group()
          shoulder.position.set(side * shoulderX * scale, 0.58 * scale, 0)
          torso.add(shoulder)
          // Rounded shoulder ball
          const ball = hit(new THREE.Mesh(sph(shoulderR, 10, 8), bodyMat))
          shoulder.add(ball)
          // Shoulder pad (placeholder; spawnBots may swap material for team color)
          const padW = type === "heavy" ? 0.22 : 0.18
          const padH = type === "heavy" ? 0.14 : 0.1
          const padD = type === "heavy" ? 0.28 : 0.22
          const pad = new THREE.Mesh(box(padW, padH, padD), darkMat)
          pad.position.set(side * 0.06 * scale, 0.04 * scale, 0)
          shoulder.add(pad)
          pad.userData.shoulderPad = true // tagged so spawnBots can find & recolor
          // Upper arm
          const upperArm = hit(new THREE.Mesh(cyl(0.07, 0.062, 0.3), bodyMat))
          upperArm.position.y = -0.18 * scale
          upperArm.castShadow = true
          shoulder.add(upperArm)
          // Elbow joint
          const elbow = new THREE.Group()
          elbow.position.y = -0.33 * scale
          shoulder.add(elbow)
          // Forearm
          const forearm = hit(new THREE.Mesh(cyl(0.06, 0.052, 0.28), bodyMat))
          forearm.position.y = -0.16 * scale
          forearm.castShadow = true
          elbow.add(forearm)
          // Hand
          const hand = hit(new THREE.Mesh(sph(0.058, 8, 6), gloveMat))
          hand.position.y = -0.32 * scale
          elbow.add(hand)
          return { shoulder, elbow }
        }
        const leftArm = buildArm(-1)
        const rightArm = buildArm(1)

        // ── Rifle (parented to right elbow so it tracks aim) ─────────────────
        const rifleMat = new THREE.MeshLambertMaterial({
          color: type === "sniper" ? 0x1a1812 : 0x2a2a2a,
        })
        const rifleLen = type === "sniper" ? 0.95 : type === "heavy" ? 0.7 : 0.55
        const rifleGrp = new THREE.Group()
        // Position rifle in front of forearm, slight outward offset
        rifleGrp.position.set(0.04 * scale, -0.3 * scale, -rifleLen * 0.3 * scale)
        rightArm.elbow.add(rifleGrp)
        const rifleBody = new THREE.Mesh(box(0.06, 0.08, rifleLen), rifleMat)
        rifleBody.castShadow = true
        rifleGrp.add(rifleBody)
        const rifleBarrel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.022 * scale, 0.022 * scale, rifleLen * 0.5 * scale, 6),
          rifleMat,
        )
        rifleBarrel.rotation.x = Math.PI / 2
        rifleBarrel.position.set(0, 0.02 * scale, -rifleLen * 0.42 * scale)
        rifleGrp.add(rifleBarrel)
        const rifleMag = new THREE.Mesh(box(0.05, 0.12, 0.08), rifleMat)
        rifleMag.position.y = -0.1 * scale
        rifleGrp.add(rifleMag)
        if (type === "sniper") {
          const scope = new THREE.Mesh(cyl(0.04, 0.04, 0.18), darkMat)
          scope.rotation.x = Math.PI / 2
          scope.position.set(0, 0.08 * scale, 0)
          rifleGrp.add(scope)
          lodDetails.push(scope)
          const bipodGeo = cyl(0.012, 0.012, 0.15, 6)
          const bipodL = new THREE.Mesh(bipodGeo, darkMat)
          bipodL.rotation.z = 0.3
          bipodL.position.set(-0.04 * scale, -0.1 * scale, -rifleLen * 0.4 * scale)
          rifleGrp.add(bipodL)
          const bipodR = new THREE.Mesh(bipodGeo, darkMat)
          bipodR.rotation.z = -0.3
          bipodR.position.set(0.04 * scale, -0.1 * scale, -rifleLen * 0.4 * scale)
          rifleGrp.add(bipodR)
        }
        if (type === "heavy") {
          const drum = new THREE.Mesh(cyl(0.07, 0.07, 0.06, 10), rifleMat)
          drum.position.y = -0.1 * scale
          rifleGrp.add(drum)
        }

        // Sniper ghillie strips (purely cosmetic; LOD-hidden when far)
        if (type === "sniper") {
          for (let i = 0; i < 8; i++) {
            const stripMat = new THREE.MeshLambertMaterial({
              color: i % 3 === 0 ? 0x5a6a3a : i % 3 === 1 ? 0x7a6a4a : 0x3a4a25,
            })
            const strip = new THREE.Mesh(box(0.06, 0.22, 0.03), stripMat)
            const colIdx = i % 4
            const rowIdx = Math.floor(i / 4)
            strip.position.set(
              (colIdx - 1.5) * 0.09 * scale,
              (0.5 - rowIdx * 0.18) * scale,
              (torsoD / 2 + 0.04) * scale,
            )
            torso.add(strip)
            lodDetails.push(strip)
          }
        }

        // Commander indicator (orange torus halo + point light)
        if (isCommander) {
          const halo = hit(
            new THREE.Mesh(
              new THREE.TorusGeometry(0.3 * scale, 0.04 * scale, 6, 14),
              new THREE.MeshBasicMaterial({ color: 0xff6600 }),
            ),
          )
          halo.position.y = 0.32 * scale
          head.add(halo)
          const glow = new THREE.PointLight(0xff6600, 1.0, 4)
          glow.position.y = 0.22 * scale
          head.add(glow)
        }

        // Per-enemy ground shadow (cheap planar decal)
        const shadow = new THREE.Mesh(
          new THREE.CircleGeometry(0.35 * scale, 14),
          new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
          }),
        )
        shadow.rotation.x = -Math.PI / 2
        shadow.position.y = 0.02
        root.add(shadow)

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
        return {
          id: enemyIdStr,
          mesh: root,
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
          deathFallDir: 1,
          animTime: Math.random() * Math.PI * 2,
          leftArm: leftArm.shoulder,
          rightArm: rightArm.shoulder,
          leftLeg: leftLeg.hip,
          rightLeg: rightLeg.hip,
          leftForearm: leftArm.elbow,
          rightForearm: rightArm.elbow,
          leftShin: leftLeg.knee,
          rightShin: rightLeg.knee,
          torso,
          head,
          shadowMesh: shadow,
          lodDetails,
          leftEye,
          rightEye,
          velocity: { x: 0, z: 0 },
          smoothedYaw: 0,
          pose: {
            leftShoulder: 0,
            rightShoulder: 0,
            leftElbow: 0,
            rightElbow: 0,
            leftHip: 0,
            rightHip: 0,
            leftKnee: 0,
            rightKnee: 0,
            torsoLeanZ: 0,
            torsoPitchX: 0,
            torsoBreath: 0,
            pelvisRotY: 0,
            headYaw: 0,
            headPitch: 0,
            eyeOpenness: 1,
          },
          blinkPhase: Math.random() * Math.PI * 2,
          blinkTimer: 2 + Math.random() * 5,
          blinkActive: 0,
          breathPhase: Math.random() * Math.PI * 2,
          microIdleSeed: Math.random() * 1000,
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
          ...Array<EnemyType>(def.sniper).fill("sniper"),
          ...Array<EnemyType>(def.heavy).fill("heavy"),
        ]
        const shuffled = [...SPAWN_POINTS].sort(() => Math.random() - 0.5)
        let commandersSpawned = 0
        for (let i = 0; i < types.length; i++) {
          const sp = shuffled[i % shuffled.length] ?? shuffled[0]
          if (!sp) continue
          const type = types[i] ?? "grunt"
          const rx = Math.max(2, Math.min(MAP_SIZE - 2, sp.x + (Math.random() - 0.5) * 3))
          const rz = Math.max(2, Math.min(MAP_SIZE - 2, sp.z + (Math.random() - 0.5) * 3))
          const safe = findSafeSpawnNear(rx, rz, ENEMY_RADIUS)
          const isCmd = commandersSpawned < commanderCount && type === "sniper"
          if (isCmd) commandersSpawned++
          enemies.push(makeEnemy(type, safe.x, safe.z, isCmd))
        }
        setAliveEnemyCount(enemies.length)
        setEnemyStatus(
          enemies.map((e) => ({ id: e.id, hp: e.hp, maxHp: e.maxHp, type: e.type, alive: true })),
        )
      }

      // ── Bot label sprite (name floats above head) ─────────────────────────
      function makeNameSprite(text: string, color: string): THREE.Sprite {
        const canvas = document.createElement("canvas")
        canvas.width = 256
        canvas.height = 64
        const ctx = canvas.getContext("2d")
        if (ctx) {
          ctx.fillStyle = "rgba(0,0,0,0.55)"
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          ctx.font = "bold 32px monospace"
          ctx.textAlign = "center"
          ctx.textBaseline = "middle"
          ctx.fillStyle = color
          ctx.fillText(text, canvas.width / 2, canvas.height / 2)
        }
        const tex = new THREE.CanvasTexture(canvas)
        tex.needsUpdate = true
        const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })
        const sprite = new THREE.Sprite(mat)
        sprite.scale.set(2.0, 0.5, 1)
        sprite.renderOrder = 1000
        return sprite
      }

      // Tint a bot's body/limb materials toward a team color while preserving shading.
      function tintBotMesh(group: THREE.Group, teamColor: number) {
        const target = new THREE.Color(teamColor)
        group.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return
          const m = child.material as THREE.Material
          if (m instanceof THREE.MeshLambertMaterial && m.color) {
            const c = m.color.clone()
            c.lerp(target, 0.45)
            const tintMat = m.clone()
            tintMat.color = c
            child.material = tintMat
          }
        })
      }

      // ── Bot spawner (FFA / TDM only) ──────────────────────────────────────
      function spawnBots(count: number, diff: BotDifficulty, gameMode: "ffa" | "tdm") {
        if (count <= 0) return
        const tuning = BOT_DIFFICULTY_CONFIGS[diff]
        const shuffled = [...SPAWN_POINTS].sort(() => Math.random() - 0.5)
        const myTeam = myTeamRef.current
        for (let i = 0; i < count; i++) {
          const sp = shuffled[i % shuffled.length] ?? shuffled[0]
          if (!sp) continue
          // 70% grunt, 20% sniper, 10% heavy
          const r = Math.random()
          const type: EnemyType = r < 0.7 ? "grunt" : r < 0.9 ? "sniper" : "heavy"
          const rx = Math.max(3, Math.min(MAP_SIZE - 3, sp.x + (Math.random() - 0.5) * 4))
          const rz = Math.max(3, Math.min(MAP_SIZE - 3, sp.z + (Math.random() - 0.5) * 4))
          const safe = findSafeSpawnNear(rx, rz, ENEMY_RADIUS)
          const bot = makeEnemy(type, safe.x, safe.z, false)

          // Per-bot config clone with difficulty applied (don't mutate shared ENEMY_CONFIGS)
          const baseCfg = bot.config
          bot.config = {
            ...baseCfg,
            hp: Math.round(baseCfg.hp * tuning.hpMult),
            fireDamage: Math.round(baseCfg.fireDamage * tuning.damageMult),
            attackDamage: Math.round(baseCfg.attackDamage * tuning.damageMult),
            fireInterval: Math.round(baseCfg.fireInterval * tuning.reactMult),
            sightRange: baseCfg.sightRange * tuning.sightMult,
          }
          bot.hp = bot.config.hp
          bot.maxHp = bot.config.hp

          bot.isBot = true
          bot.botName = BOT_NAMES[i % BOT_NAMES.length] ?? `Bot_${i}`
          bot.botAccuracyMult = tuning.accuracyMult
          bot.botReactMult = tuning.reactMult
          bot.botRespawnMs = tuning.respawnMs

          // Team assignment
          if (gameMode === "tdm") {
            // Roughly even split, but always opposite the player so there's someone to shoot
            const oppositeOfPlayer = myTeam === "red" ? "blue" : "red"
            bot.botTeam = i === 0 ? oppositeOfPlayer : i % 2 === 0 ? "red" : "blue"
            const teamColor = bot.botTeam === "red" ? 0xff3344 : 0x3388ff
            tintBotMesh(bot.mesh, teamColor)
            // Swap the shoulder pads to solid team color — most visible at a glance.
            const padMat = new THREE.MeshLambertMaterial({
              color: teamColor,
              emissive: teamColor,
              emissiveIntensity: 0.18,
            })
            bot.mesh.traverse((c) => {
              if (c instanceof THREE.Mesh && c.userData.shoulderPad) c.material = padMat
            })
            const halo = new THREE.Mesh(
              new THREE.TorusGeometry(0.34, 0.04, 6, 16),
              new THREE.MeshBasicMaterial({ color: teamColor }),
            )
            halo.position.set(0, 2.18, 0)
            bot.mesh.add(halo)
          } else {
            bot.botTeam = "ffa"
          }

          // Floating name label
          const labelColor =
            bot.botTeam === "red" ? "#ff6677" : bot.botTeam === "blue" ? "#66aaff" : "#ffd55a"
          const sprite = makeNameSprite(bot.botName, labelColor)
          sprite.position.set(0, 2.55, 0)
          bot.mesh.add(sprite)
          bot.nameSprite = sprite

          enemies.push(bot)
        }
        setAliveEnemyCount(enemies.filter((e) => e.hp > 0).length)
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
          spawnEnemiesFromDef(WAVE_DEFS[0] ?? { grunt: 6, sniper: 0, heavy: 0 })
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

      // Auto-spawn bots for FFA/TDM modes (wave_defense uses mission select).
      if ((modeRef.current === "ffa" || modeRef.current === "tdm") && botCount > 0) {
        spawnBots(botCount, botDifficulty, modeRef.current)
        showNotification(
          `${botCount} BOT${botCount === 1 ? "" : "S"} ENGAGED · ${botDifficulty.toUpperCase()}`,
        )
      }

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
        let enemyHits = raycaster.intersectObjects(allEnemyParts, false)
        // Wall occlusion: if a wall sits between the camera and the closest
        // enemy hit, the shot stops at the wall (no shooting through cover).
        const wallHits = raycaster.intersectObjects(wallMeshes, false)
        const nearestWall = wallHits[0]
        if (nearestWall && enemyHits[0] && nearestWall.distance < enemyHits[0].distance) {
          spawnExplosion(nearestWall.point.clone(), true)
          enemyHits = []
        } else if (nearestWall && enemyHits.length === 0) {
          // Pure miss into a wall — show an impact spark for feedback.
          spawnExplosion(nearestWall.point.clone(), true)
        }

        // PvP hit: check remote players
        const sceneRefsLocal = sceneRef.current
        if (sceneRefsLocal && (myTeamRef.current !== "ffa" || modeRef.current === "ffa")) {
          const remoteMeshList: THREE.Object3D[] = []
          const remoteIdMap = new Map<THREE.Object3D, string>()
          for (const [rid, rmesh] of sceneRefsLocal.remoteMeshes) {
            remoteMeshList.push(rmesh)
            remoteIdMap.set(rmesh, rid)
          }
          if (remoteMeshList.length > 0) {
            const pvpHits = raycaster.intersectObjects(remoteMeshList, false)
            // Same wall-occlusion rule as for AI enemies: a wall between
            // camera and remote player blocks the shot.
            const wallBlocks =
              nearestWall && pvpHits[0] && nearestWall.distance < pvpHits[0].distance
            if (!wallBlocks && pvpHits.length > 0 && pvpHits[0]) {
              const targetId = remoteIdMap.get(pvpHits[0].object)
              if (targetId) {
                const wpId = weapon.id
                const dmg = weapon.hitDamage
                const isHs = pvpHits[0].point.y > 0.8
                wsRef.current?.send(
                  JSON.stringify({
                    type: "pvp_hit",
                    targetId,
                    dmg: isHs ? dmg * 2 : dmg,
                    headshot: isHs,
                    weapon: wpId,
                  }),
                )
                SOUNDS.hit()
                spawnBlood(pvpHits[0].point)
              }
            }
          }
        }

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
              headshotsRef.current += 1
              setTimeout(() => setHeadshotMsg(false), 800)
            }
            hitEnemy.hp -= dmg
            scoreRef.current += Math.floor(dmg * 10)
            setScore(scoreRef.current)
            if (hitEnemy.hp <= 0) {
              hitEnemy.hp = 0
              hitEnemy.dyingTimer = DEATH_ANIM_TOTAL
              hitEnemy.state = "patrol"
              // Fall direction: project enemy→shooter onto the enemy's facing.
              // If the shooter is in front (dot > 0 means enemy looking at
              // shooter), the body tips backward (-1). Otherwise face-plant.
              {
                const dxs = hitEnemy.mesh.position.x - focalPoint.x
                const dzs = hitEnemy.mesh.position.z - focalPoint.z
                const fxs = Math.sin(hitEnemy.smoothedYaw)
                const fzs = Math.cos(hitEnemy.smoothedYaw)
                const dot = -dxs * fxs - dzs * fzs // >0 if shooter is in front
                hitEnemy.deathFallDir = dot > 0 ? -1 : 1
              }
              killsRef.current += 1
              setKills(killsRef.current)
              scoreRef.current += hitEnemy.config.score
              setScore(scoreRef.current)
              // TDM: opposite-team bot kill awards a point to the player's team locally.
              if (
                hitEnemy.isBot &&
                modeRef.current === "tdm" &&
                hitEnemy.botTeam &&
                hitEnemy.botTeam !== myTeamRef.current &&
                myTeamRef.current !== "ffa"
              ) {
                const team = myTeamRef.current
                const next = {
                  red: teamScoreRef.current.red + (team === "red" ? 1 : 0),
                  blue: teamScoreRef.current.blue + (team === "blue" ? 1 : 0),
                }
                teamScoreRef.current = next
                setTeamScore(next)
              }
              const tag = hitEnemy.isBot
                ? `${usernameRef.current} ▶ ${hitEnemy.botName}`
                : hitEnemy.type === "heavy"
                  ? "HEAVY ELIMINATED"
                  : hitEnemy.type === "sniper"
                    ? "SNIPER ELIMINATED"
                    : hitEnemy.isCommander
                      ? "COMMANDER ELIMINATED"
                      : "GRUNT ELIMINATED"
              showNotification(`${tag} +${hitEnemy.config.score}pt`)
              // Kill feed
              const feedColor = hitEnemy.isBot
                ? hitEnemy.botTeam === "red"
                  ? "#ff6677"
                  : hitEnemy.botTeam === "blue"
                    ? "#66aaff"
                    : "#ffd55a"
                : hitEnemy.type === "heavy"
                  ? "#cc44ff"
                  : hitEnemy.type === "sniper"
                    ? "#88cc44"
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
              } else if (mission === "boss" && hitEnemy.type === "heavy") {
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
              maxKillstreakRef.current = Math.max(
                maxKillstreakRef.current,
                consecutiveKillsRef.current,
              )
              const cs = consecutiveKillsRef.current
              if (cs >= 2) {
                const streakMsg =
                  cs >= 10
                    ? "GODLIKE!"
                    : cs >= 7
                      ? "UNSTOPPABLE!"
                      : cs >= 5
                        ? "RAMPAGE!"
                        : cs >= 3
                          ? "TRIPLE KILL!"
                          : "DOUBLE KILL!"
                if (killStreakTimerRef.current) clearTimeout(killStreakTimerRef.current)
                setKillStreakMsg(streakMsg)
                killStreakTimerRef.current = setTimeout(() => setKillStreakMsg(null), 2500)
              }
              // Per-weapon kill tracking
              const widx = currentWeaponIdxRef.current
              const wkey = widx === 0 ? "pistol" : widx === 1 ? "shotgun" : "sniper"
              weaponKillsRef.current[wkey] = (weaponKillsRef.current[wkey] ?? 0) + 1
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
        // Accumulate; the animate loop applies (and lightly smooths) it.
        mouseDeltaRef.current.x += e.movementX
        mouseDeltaRef.current.y += e.movementY
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
        } else if (e.button === 2) {
          isAimingRef.current = true
          setIsAiming(true)
        }
      }
      function onMouseUp(e: MouseEvent) {
        if (e.button === 0) mouseDownRef.current = false
        if (e.button === 2) {
          isAimingRef.current = false
          setIsAiming(false)
        }
      }
      function onContextMenu(e: MouseEvent) {
        e.preventDefault()
      }

      // Canvas swallows touch events with passive listeners so the page can't
      // scroll/zoom while playing, but all camera + fire input now comes from
      // the on-screen joysticks and buttons (the right stick handles look).
      const noopTouch = (e: TouchEvent) => {
        if (e.cancelable) e.preventDefault()
      }
      renderer.domElement.addEventListener("touchstart", noopTouch, { passive: false })
      renderer.domElement.addEventListener("touchmove", noopTouch, { passive: false })
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
        // Cap dt to 50ms so a tab refocus / long pause doesn't yank everything
        // (massive lerp blends + massive position deltas would look like
        // teleportation and could clip through walls).
        const dt = Math.min(clock.getDelta(), 0.05)
        const refs = sceneRef.current
        if (!refs) return

        // Low-pass filter the joystick inputs (finger jitter on glass).
        const joyBlend = 1 - Math.exp(-dt * 22)
        joySmoothRef.current.vx += (joystickRef.current.vx - joySmoothRef.current.vx) * joyBlend
        joySmoothRef.current.vy += (joystickRef.current.vy - joySmoothRef.current.vy) * joyBlend
        const lookBlend = 1 - Math.exp(-dt * 28)
        lookSmoothRef.current.vx += (lookJoyRef.current.vx - lookSmoothRef.current.vx) * lookBlend
        lookSmoothRef.current.vy += (lookJoyRef.current.vy - lookSmoothRef.current.vy) * lookBlend

        // Drain accumulated mouse delta with a light smoothing tail. We
        // apply ~75% of the buffered movement this frame and roll the
        // remainder into next frame — eliminates the spiky single-event
        // jumps on high-Hz mice without adding noticeable input lag.
        {
          const APPLY = 0.75
          const mdx = mouseDeltaRef.current.x * APPLY
          const mdy = mouseDeltaRef.current.y * APPLY
          mouseDeltaRef.current.x -= mdx
          mouseDeltaRef.current.y -= mdy
          if (mdx !== 0 || mdy !== 0) {
            camState.yaw -= mdx * 0.002
            camState.pitch = clampPitch(camState.pitch - mdy * 0.002)
            updateCamera()
          }
        }

        // ADS FOV interpolation
        const targetFov = isAimingRef.current ? (currentWeaponIdxRef.current === 2 ? 28 : 50) : 75
        if (Math.abs(camera.fov - targetFov) > 0.3) {
          camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12)
          camera.updateProjectionMatrix()
        }

        // Grenade request: AOE explosion ahead of player
        if (requestGrenadeRef.current) {
          requestGrenadeRef.current = false
          const fwd = new THREE.Vector3()
          camera.getWorldDirection(fwd)
          const origin = new THREE.Vector3(refs.focalPoint.x, EYE_HEIGHT, refs.focalPoint.z)
          const explosionPos = origin.clone().add(fwd.multiplyScalar(8))
          explosionPos.y = Math.max(0.5, explosionPos.y)
          spawnExplosion(explosionPos)
          for (const enemy of enemies) {
            if (enemy.hp <= 0) continue
            const dx = enemy.mesh.position.x - explosionPos.x
            const dz = enemy.mesh.position.z - explosionPos.z
            const d2 = dx * dx + dz * dz
            const RADIUS = 5
            if (d2 < RADIUS * RADIUS) {
              const dist = Math.sqrt(d2)
              const dmg = Math.max(20, Math.floor(120 * (1 - dist / RADIUS)))
              enemy.hp = Math.max(0, enemy.hp - dmg)
              if (enemy.hp === 0) {
                killsRef.current += 1
                setKills(killsRef.current)
                scoreRef.current += enemy.config.score
                setScore(scoreRef.current)
                weaponKillsRef.current.grenade = (weaponKillsRef.current.grenade ?? 0) + 1
                spawnExplosion(enemy.mesh.position.clone())
                scene.remove(enemy.mesh)
              }
            }
          }
        }
        // Tick grenade cooldown display. Rounded to 100ms; also gated by
        // an "only if changed" ref so React's setState isn't invoked at
        // 60Hz when the displayed value is unchanged for 6 frames.
        {
          const sinceG = Date.now() - lastGrenadeRef.current
          const cd = Math.max(0, Math.round((5000 - sinceG) / 100) * 100)
          if (cd !== prevGrenadeCdRef.current) {
            prevGrenadeCdRef.current = cd
            setGrenadeCooldownMs(cd)
          }
        }

        // Input → desired movement direction. Joystick is filtered; WASD
        // contributes raw ±1 components clamped to unit length.
        const sjoy = joySmoothRef.current
        let inVx = sjoy.vx
        let inVz = sjoy.vy
        if (keysRef.current.has("ArrowLeft") || keysRef.current.has("a")) inVx -= 1
        if (keysRef.current.has("ArrowRight") || keysRef.current.has("d")) inVx += 1
        if (keysRef.current.has("ArrowUp") || keysRef.current.has("w")) inVz -= 1
        if (keysRef.current.has("ArrowDown") || keysRef.current.has("s")) inVz += 1
        // Normalize once magnitude exceeds 1 so diagonal isn't √2 faster.
        const inMag = Math.hypot(inVx, inVz)
        if (inMag > 1) {
          inVx /= inMag
          inVz /= inMag
        }

        const fwdX = -Math.sin(camState.yaw)
        const fwdZ = -Math.cos(camState.yaw)
        const isSprinting = keysRef.current.has("Shift")
        const spd = MOVE_SPEED * (isSprinting ? SPRINT_MULTIPLIER : 1)
        // Desired world-space velocity from input.
        const desiredVx = (fwdX * -inVz + Math.cos(camState.yaw) * inVx) * spd
        const desiredVz = (fwdZ * -inVz + -Math.sin(camState.yaw) * inVx) * spd
        // Smooth player velocity toward desired (accel ~10/s, no input → decel).
        const moveBlend = 1 - Math.exp(-dt * 14)
        playerVelRef.current.x += (desiredVx - playerVelRef.current.x) * moveBlend
        playerVelRef.current.z += (desiredVz - playerVelRef.current.z) * moveBlend
        const pv = playerVelRef.current
        const playerSpeed = Math.hypot(pv.x, pv.z)
        if (playerSpeed > 0.01) {
          const nx = refs.focalPoint.x + pv.x * dt
          const nz = refs.focalPoint.z + pv.z * dt
          // Failsafe: if the player is somehow already inside a wall (bad
          // spawn, physics push-in), let any step through so they can escape
          // — otherwise the gate latches shut and they're stuck forever.
          const stuck = collidesWithWall(refs.focalPoint.x, refs.focalPoint.z, PLAYER_RADIUS)
          if (stuck || !collidesWithWall(nx, refs.focalPoint.z, PLAYER_RADIUS))
            refs.focalPoint.x = nx
          if (stuck || !collidesWithWall(refs.focalPoint.x, nz, PLAYER_RADIUS))
            refs.focalPoint.z = nz
          updateCamera()
        }

        // Look joystick: rotate the camera using the smoothed value. A mild
        // square-curve makes small inputs precise without losing top speed.
        const slook = lookSmoothRef.current
        if (Math.abs(slook.vx) > 0.001 || Math.abs(slook.vy) > 0.001) {
          const curveX = slook.vx * Math.abs(slook.vx)
          const curveY = slook.vy * Math.abs(slook.vy)
          camState.yaw -= curveX * 3.4 * dt
          camState.pitch = clampPitch(camState.pitch - curveY * 2.6 * dt)
          updateCamera()
        }

        // Walk-bob: subtle vertical head sway when actually moving. Phase
        // freezes when standing still so it doesn't bob while idle.
        if (playerSpeed > 0.5) {
          walkBobRef.current += dt * (4 + playerSpeed * 0.6)
          const bobAmp = isAimingRef.current ? 0.012 : 0.03
          camera.position.y = EYE_HEIGHT + Math.sin(walkBobRef.current * 2) * bobAmp
        } else {
          // Decay back to neutral so we don't snap.
          camera.position.y += (EYE_HEIGHT - camera.position.y) * (1 - Math.exp(-dt * 10))
        }

        // HP auto-recovery (5s no damage → 2 HP/s). Push to React state
        // only when the *rounded* HP changes — was firing setState every
        // frame during recovery (≈30 re-renders/sec for a 0.5 HP/frame tick).
        {
          const nowMs = Date.now()
          if (gamePhaseRef.current === "playing" && playerHpRef.current < PLAYER_MAX_HP) {
            if (nowMs - lastDamageTimeRef.current > AUTO_RECOVER_DELAY * 1000) {
              playerHpRef.current = Math.min(PLAYER_MAX_HP, playerHpRef.current + RECOVER_RATE * dt)
              const hpInt = Math.round(playerHpRef.current)
              if (hpInt !== prevDisplayHpRef.current) {
                prevDisplayHpRef.current = hpInt
                setPlayerHp(hpInt)
              }
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
          // Wall impact: if the bullet just entered a wall's 3D AABB, sink it
          // with a small spark instead of letting it punch through cover.
          if (
            b.life > 0 &&
            pointInsideWall(b.mesh.position.x, b.mesh.position.y, b.mesh.position.z)
          ) {
            spawnExplosion(b.mesh.position.clone(), true)
            refs.scene.remove(b.mesh)
            b.mesh.geometry.dispose()
            refs.bullets.splice(i, 1)
            continue
          }
          // Enemy bullet hits player
          if (b.isEnemy && b.life > 0) {
            const dx = b.mesh.position.x - refs.focalPoint.x
            const dy = b.mesh.position.y - EYE_HEIGHT
            const dz = b.mesh.position.z - refs.focalPoint.z
            if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.5) {
              refs.scene.remove(b.mesh)
              b.mesh.geometry.dispose()
              refs.bullets.splice(i, 1)
              if (gamePhaseRef.current === "playing" && Date.now() > spawnInvulnUntilRef.current) {
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
                // Death animation timeline:
                //   t∈[0, FALL]:        knees buckle, body rotates to prone.
                //   t∈[FALL, FALL+LIE]: corpse lies still on the ground.
                //   final FADE seconds: opacity fades to 0, then mesh hides.
                enemy.dyingTimer -= dt
                const tElapsed = DEATH_ANIM_TOTAL - Math.max(0, enemy.dyingTimer)
                const fallRaw = Math.min(1, tElapsed / DEATH_ANIM_FALL)
                // Ease-out (1 - (1-x)^2): fast collapse, gentle settle.
                const fallEased = 1 - (1 - fallRaw) * (1 - fallRaw)
                const tilt = fallEased * (Math.PI / 2)
                // Knees buckle slightly faster than the body tips.
                const buckle = Math.min(1, tElapsed / (DEATH_ANIM_FALL * 0.6))
                if (enemy.leftLeg) enemy.leftLeg.rotation.x = buckle * 0.45
                if (enemy.rightLeg) enemy.rightLeg.rotation.x = buckle * 0.35
                if (enemy.leftShin) enemy.leftShin.rotation.x = buckle * 1.1
                if (enemy.rightShin) enemy.rightShin.rotation.x = buckle * 0.95
                if (enemy.leftArm) enemy.leftArm.rotation.x = -buckle * 0.7
                if (enemy.rightArm) enemy.rightArm.rotation.x = -buckle * 0.45
                if (enemy.torso) {
                  enemy.torso.rotation.x = 0
                  enemy.torso.scale.y = 1
                }
                // YXZ rotation order means rotation.x tips the body around its
                // own lateral axis *after* yaw — clean forward/back fall.
                enemy.mesh.rotation.x = enemy.deathFallDir * tilt
                // Lift the root slightly as it lies flat so the prone torso
                // rests *on* the ground rather than half-buried in it.
                enemy.mesh.position.y = Math.sin(tilt) * 0.18
                // Fade only during the final FADE seconds.
                const fadeT = Math.max(0, tElapsed - (DEATH_ANIM_TOTAL - DEATH_ANIM_FADE))
                const opacity = fadeT > 0 ? Math.max(0, 1 - fadeT / DEATH_ANIM_FADE) : 1
                if (fadeT > 0) {
                  enemy.mesh.traverse((child) => {
                    if (child instanceof THREE.Mesh) {
                      const m = child.material as
                        | THREE.MeshLambertMaterial
                        | THREE.MeshBasicMaterial
                      m.transparent = true
                      m.opacity = opacity
                    }
                  })
                  if (enemy.shadowMesh) {
                    const sm = enemy.shadowMesh.material as THREE.MeshBasicMaterial
                    sm.opacity = 0.45 * opacity
                  }
                }
                if (enemy.dyingTimer <= 0) {
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
                  if (enemy.torso) enemy.torso.rotation.x = 0
                  // Reset joint rotations so the bot stands cleanly on respawn.
                  for (const j of [
                    enemy.leftArm,
                    enemy.rightArm,
                    enemy.leftLeg,
                    enemy.rightLeg,
                    enemy.leftForearm,
                    enemy.rightForearm,
                    enemy.leftShin,
                    enemy.rightShin,
                  ]) {
                    if (j) j.rotation.x = 0
                  }
                  // Bots respawn after a cooldown; mission enemies stay down.
                  enemy.respawnTimer = enemy.isBot
                    ? (enemy.botRespawnMs ?? 4000) / 1000
                    : ENEMY_NO_RESPAWN
                }
              } else if (
                enemy.isBot &&
                enemy.respawnTimer !== ENEMY_NO_RESPAWN &&
                enemy.respawnTimer > 0
              ) {
                // Bot respawn countdown (mesh is hidden during this phase).
                enemy.respawnTimer -= dt
                if (enemy.respawnTimer <= 0) {
                  const sp = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)] ?? {
                    x: enemy.spawnX,
                    z: enemy.spawnZ,
                  }
                  const rx = Math.max(3, Math.min(MAP_SIZE - 3, sp.x + (Math.random() - 0.5) * 4))
                  const rz = Math.max(3, Math.min(MAP_SIZE - 3, sp.z + (Math.random() - 0.5) * 4))
                  const safe = findSafeSpawnNear(rx, rz, ENEMY_RADIUS)
                  enemy.mesh.position.set(safe.x, 0, safe.z)
                  enemy.mesh.rotation.x = 0
                  enemy.mesh.visible = true
                  if (enemy.shadowMesh) {
                    const sm = enemy.shadowMesh.material as THREE.MeshBasicMaterial
                    sm.opacity = 0.45
                  }
                  if (enemy.torso) enemy.torso.rotation.x = 0
                  enemy.hp = enemy.maxHp
                  enemy.state = "patrol"
                  enemy.lastSeenPlayer = null
                  enemy.searchTimer = 0
                  enemy.dyingTimer = -1
                  enemy.respawnTimer = ENEMY_NO_RESPAWN
                  setAliveEnemyCount(enemies.filter((e2) => e2.hp > 0).length)
                }
              }
              continue
            }
            const ex = enemy.mesh.position.x
            const ez = enemy.mesh.position.z
            const prevX = ex
            const prevZ = ez
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
                const accInv = 1 / (enemy.botAccuracyMult ?? 1)
                fwd.x += (Math.random() - 0.5) * 0.06 * accInv
                fwd.z += (Math.random() - 0.5) * 0.06 * accInv
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
            } else if (enemy.state === "attack") {
              if (distToPlayer > 0.001) {
                enemy.facing.set(toPx / distToPlayer, 0, toPz / distToPlayer)
              }
              if (distToPlayer > enemy.config.attackRange * 1.5) {
                enemy.state = "alert"
              } else if (
                now - enemy.lastAttackTime > enemy.config.attackInterval &&
                Date.now() > spawnInvulnUntilRef.current
              ) {
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
                const baseSpread = enemy.type === "sniper" ? 0.005 : 0.03
                const spread = baseSpread / (enemy.botAccuracyMult ?? 1)
                fwd.x += (Math.random() - 0.5) * spread
                fwd.z += (Math.random() - 0.5) * spread
                fwd.normalize()
                const isSniper = enemy.type === "sniper"
                const bGeo = isSniper
                  ? new THREE.BoxGeometry(0.05, 0.05, 0.36)
                  : new THREE.BoxGeometry(0.04, 0.04, 0.22)
                const bMat = new THREE.MeshBasicMaterial({
                  color: isSniper ? 0x00ffcc : 0xff4400,
                })
                const bMesh = new THREE.Mesh(bGeo, bMat)
                bMesh.position.set(enemy.mesh.position.x, EYE_HEIGHT * 0.7, enemy.mesh.position.z)
                bMesh.lookAt(bMesh.position.clone().add(fwd))
                refs.scene.add(bMesh)
                refs.bullets.push({
                  mesh: bMesh,
                  velocity: fwd
                    .clone()
                    .multiplyScalar(isSniper ? ENEMY_BULLET_SPEED * 2.2 : ENEMY_BULLET_SPEED),
                  life: isSniper ? 2.8 : 2.2,
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

            // ── Unified animator ────────────────────────────────────────────
            // Compute actual velocity from this frame's position delta so the
            // animation reacts to real motion (including collision-clipping).
            const safeDt = Math.max(dt, 1e-4)
            enemy.velocity.x = (enemy.mesh.position.x - prevX) / safeDt
            enemy.velocity.z = (enemy.mesh.position.z - prevZ) / safeDt
            const speed = Math.hypot(enemy.velocity.x, enemy.velocity.z)
            const moving = speed > 0.05

            // Smooth body yaw — bodies don't snap to face a new direction, they
            // pivot over a short window. Wrap diff into [-π, π] for shortest arc.
            const targetYaw = Math.atan2(enemy.facing.x, enemy.facing.z)
            let dYaw = targetYaw - enemy.smoothedYaw
            while (dYaw > Math.PI) dYaw -= Math.PI * 2
            while (dYaw < -Math.PI) dYaw += Math.PI * 2
            const yawBlend = 1 - Math.exp(-dt * 7)
            enemy.smoothedYaw += dYaw * yawBlend
            enemy.mesh.rotation.y = enemy.smoothedYaw

            // Velocity decomposed against body-relative right vector → strafe lean
            const cosY = Math.cos(enemy.smoothedYaw)
            const sinY = Math.sin(enemy.smoothedYaw)
            const rightX = cosY
            const rightZ = -sinY
            const strafeVel = enemy.velocity.x * rightX + enemy.velocity.z * rightZ

            const aimMode =
              enemy.state === "attack" ||
              (enemy.state === "alert" && distToPlayer <= enemy.config.fireRange)

            // Cadence: advance walk phase only when actually moving so feet
            // don't slide while standing still. Faster phase when running.
            if (moving) {
              const cadenceMult =
                enemy.state === "alert" ? 1.7 : enemy.state === "search" ? 1.15 : 1
              const speedRatio = Math.min(1.6, speed / Math.max(0.4, enemy.config.speed * 0.45))
              enemy.animTime += dt * 5 * cadenceMult * speedRatio
            }

            // ── Build target pose for this state ─────────────────────────────
            const t = enemy.animTime
            let tgtLeftShoulder = 0
            let tgtRightShoulder = 0
            let tgtLeftElbow = -0.18
            let tgtRightElbow = -0.18
            let tgtLeftHip = 0
            let tgtRightHip = 0
            let tgtLeftKnee = 0
            let tgtRightKnee = 0
            let tgtPelvisRotY = 0
            let tgtTorsoPitchX = 0

            if (aimMode) {
              const recoilKick = Math.max(0, 0.25 - (now - enemy.lastFireTime) / 4000)
              tgtRightShoulder = -1.35 - recoilKick
              tgtLeftShoulder = -1.05 - recoilKick * 0.5
              tgtRightElbow = 0.55
              tgtLeftElbow = -0.65
              tgtTorsoPitchX = -0.04
            } else if (moving) {
              const amp = enemy.state === "alert" ? 0.55 : 0.32
              const sw = Math.sin(t) * amp
              tgtLeftShoulder = sw
              tgtRightShoulder = -sw
              tgtLeftElbow = -0.2 + sw * 0.5
              tgtRightElbow = -0.2 - sw * 0.5
              tgtLeftHip = -sw * 0.85
              tgtRightHip = sw * 0.85
              tgtLeftKnee = Math.max(0, sw) * 1.0
              tgtRightKnee = Math.max(0, -sw) * 1.0
              tgtPelvisRotY = -sw * 0.08
              tgtTorsoPitchX = enemy.state === "alert" ? 0.1 : 0.04
            } else {
              // Idle: shoulders relaxed, slight weight shift on alternating leg
              const w = Math.sin(now * 0.0012 + enemy.microIdleSeed)
              tgtPelvisRotY = w * 0.04
              tgtLeftHip = w * 0.04
              tgtRightHip = -w * 0.04
            }

            // Strafe lean: torso rolls into the strafe direction
            const tgtTorsoLeanZ = Math.max(-0.18, Math.min(0.18, -strafeVel * 0.07))

            // Head look-at: when aware, tracks the player; otherwise drifts
            let tgtHeadYaw: number
            let tgtHeadPitch: number
            if (enemy.state !== "patrol") {
              const desiredAbsYaw = Math.atan2(toPx, toPz)
              let headRel = desiredAbsYaw - enemy.smoothedYaw
              while (headRel > Math.PI) headRel -= Math.PI * 2
              while (headRel < -Math.PI) headRel += Math.PI * 2
              tgtHeadYaw = Math.max(-0.9, Math.min(0.9, headRel))
              tgtHeadPitch = Math.max(
                -0.5,
                Math.min(0.5, -Math.atan2(EYE_HEIGHT - 1.6, Math.max(0.5, distToPlayer))),
              )
            } else {
              tgtHeadYaw = Math.sin(now * 0.0005 + enemy.microIdleSeed) * 0.22
              tgtHeadPitch = Math.sin(now * 0.0008 + enemy.microIdleSeed * 1.3) * 0.05
            }

            // Always-on breathing (smaller when aiming)
            enemy.breathPhase += dt * (aimMode ? 0.9 : 1.4)
            const breathAmp = aimMode ? 0.014 : 0.026
            const tgtTorsoBreath = Math.sin(enemy.breathPhase) * breathAmp

            // Eye blink — close briefly every few seconds
            if (enemy.blinkActive > 0) {
              enemy.blinkActive -= dt
              if (enemy.blinkActive <= 0) {
                enemy.blinkActive = 0
                enemy.blinkTimer = 3 + Math.random() * 4
              }
            } else {
              enemy.blinkTimer -= dt
              if (enemy.blinkTimer <= 0) enemy.blinkActive = 0.12
            }
            const tgtEyeOpen = enemy.blinkActive > 0 ? 0.08 : 1

            // Frame-independent exp interpolation toward the target pose.
            const blend = 1 - Math.exp(-dt * 12)
            const p = enemy.pose
            p.leftShoulder += (tgtLeftShoulder - p.leftShoulder) * blend
            p.rightShoulder += (tgtRightShoulder - p.rightShoulder) * blend
            p.leftElbow += (tgtLeftElbow - p.leftElbow) * blend
            p.rightElbow += (tgtRightElbow - p.rightElbow) * blend
            p.leftHip += (tgtLeftHip - p.leftHip) * blend
            p.rightHip += (tgtRightHip - p.rightHip) * blend
            p.leftKnee += (tgtLeftKnee - p.leftKnee) * blend
            p.rightKnee += (tgtRightKnee - p.rightKnee) * blend
            p.pelvisRotY += (tgtPelvisRotY - p.pelvisRotY) * blend
            p.torsoLeanZ += (tgtTorsoLeanZ - p.torsoLeanZ) * blend
            p.torsoPitchX += (tgtTorsoPitchX - p.torsoPitchX) * blend
            p.torsoBreath = tgtTorsoBreath
            const headBlend = 1 - Math.exp(-dt * 6)
            p.headYaw += (tgtHeadYaw - p.headYaw) * headBlend
            p.headPitch += (tgtHeadPitch - p.headPitch) * headBlend
            const eyeBlend = 1 - Math.exp(-dt * 24)
            p.eyeOpenness += (tgtEyeOpen - p.eyeOpenness) * eyeBlend

            // ── Apply pose to all joints ────────────────────────────────────
            if (enemy.leftArm) enemy.leftArm.rotation.x = p.leftShoulder
            if (enemy.rightArm) enemy.rightArm.rotation.x = p.rightShoulder
            if (enemy.leftForearm) enemy.leftForearm.rotation.x = p.leftElbow
            if (enemy.rightForearm) enemy.rightForearm.rotation.x = p.rightElbow
            if (enemy.leftLeg) enemy.leftLeg.rotation.x = p.leftHip
            if (enemy.rightLeg) enemy.rightLeg.rotation.x = p.rightHip
            if (enemy.leftShin) enemy.leftShin.rotation.x = p.leftKnee
            if (enemy.rightShin) enemy.rightShin.rotation.x = p.rightKnee
            if (enemy.torso) {
              enemy.torso.rotation.x = p.torsoPitchX
              enemy.torso.rotation.z = p.torsoLeanZ
              enemy.torso.rotation.y = p.pelvisRotY
              enemy.torso.scale.y = 1 + p.torsoBreath
            }
            if (enemy.head) {
              enemy.head.rotation.y = p.headYaw
              enemy.head.rotation.x = p.headPitch
            }
            if (enemy.leftEye) enemy.leftEye.scale.y = p.eyeOpenness
            if (enemy.rightEye) enemy.rightEye.scale.y = p.eyeOpenness
          }
        }

        // ── Player ground shadow follows focal point ───────────────────────
        playerShadow.position.x = refs.focalPoint.x
        playerShadow.position.z = refs.focalPoint.z

        // ── Per-frame LOD: hide small details (eyes / mouth / pouches /
        // ghillie strips / scope / knee caps) on enemies farther than 25m
        // from the camera. Cheap O(n) distance check; toggling .visible is
        // free if it hasn't changed.
        const LOD_NEAR = 25 * 25
        for (const enemy of refs.enemies) {
          if (!enemy.lodDetails || enemy.lodDetails.length === 0) continue
          const ddx = enemy.mesh.position.x - camera.position.x
          const ddz = enemy.mesh.position.z - camera.position.z
          const showDetail = ddx * ddx + ddz * ddz < LOD_NEAR
          for (const d of enemy.lodDetails) {
            if (d.visible !== showDetail) d.visible = showDetail
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

        // Tag + team coloring
        const tg = tagGameRef.current
        for (const [rmId, rmesh] of refs.remoteMeshes) {
          const rstate = remotePosRef.current[rmId]
          const rmat = rmesh.material as THREE.MeshLambertMaterial
          let wantHex = 0xffcc00
          if (tg?.running && rstate?.username === tg.itUsername) wantHex = 0xff3333
          else if (rstate?.team === "red") wantHex = 0xff4444
          else if (rstate?.team === "blue") wantHex = 0x4488ff
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
            ctx.fillRect(0, 0, 33 * SCALE, W)
            ctx.fillStyle = "#3a3a2a"
            ctx.fillRect(33 * SCALE, 0, 33 * SCALE, W)
            ctx.fillStyle = "#4a3a1a"
            ctx.fillRect(66 * SCALE, 0, 34 * SCALE, W)
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
                enemy.type === "heavy"
                  ? "#cc44ff"
                  : enemy.type === "sniper"
                    ? "#88cc44"
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
        renderer.domElement.removeEventListener("touchstart", noopTouch)
        renderer.domElement.removeEventListener("touchmove", noopTouch)
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

    function isTypingInInput(): boolean {
      const a = document.activeElement
      if (!a) return false
      if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) return true
      if (a instanceof HTMLElement && a.isContentEditable) return true
      return false
    }

    const MOVEMENT_KEYS = new Set([
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "w",
      "a",
      "s",
      "d",
      "W",
      "A",
      "S",
      "D",
      " ",
    ])

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingInInput()) return
      // Prevent browser default (scroll / focus shift) for movement keys
      if (MOVEMENT_KEYS.has(e.key)) e.preventDefault()
      // Normalize so Shift+WASD still triggers movement
      const stored = e.key.length === 1 ? e.key.toLowerCase() : e.key
      keysRef.current.add(stored)
      if (e.key === "1") switchWeapon(0)
      if (e.key === "2") switchWeapon(1)
      if (e.key === "3") switchWeapon(2)
      if (e.key === "F8") {
        e.preventDefault()
        setScanlinesOn((prev) => {
          const next = !prev
          try {
            localStorage.setItem("fps_scanlines", next ? "1" : "0")
          } catch {
            /* ignore */
          }
          showNotification(next ? "CRT SCANLINES ON" : "CRT SCANLINES OFF")
          return next
        })
      }
      if (e.key === "g" || e.key === "G") {
        const now = Date.now()
        if (now - lastGrenadeRef.current > 5000) {
          lastGrenadeRef.current = now
          requestGrenadeRef.current = true
          setGrenadeCooldownMs(5000)
        }
      }
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
      const stored = e.key.length === 1 ? e.key.toLowerCase() : e.key
      keysRef.current.delete(stored)
      // Also drop the un-normalized variant in case it was added before this PR's normalization
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: WS connects once with initial mode/mapId
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
          roomId: `${mode}-${mapId}`,
          mode,
          mapId,
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
          team?: "red" | "blue" | "ffa"
          teamScore?: { red: number; blue: number }
          killer?: string
          victim?: string
          weapon?: string
          headshot?: boolean
          killerTeam?: "red" | "blue" | "ffa"
          dmg?: number
          hp?: number
          invulnMs?: number
        }
        if (msg.type === "joined") {
          if (msg.team) {
            myTeamRef.current = msg.team
            setMyTeam(msg.team)
          }
          if (msg.teamScore) {
            teamScoreRef.current = msg.teamScore
            setTeamScore(msg.teamScore)
          }
          spawnInvulnUntilRef.current = Date.now() + 3000
        } else if (msg.type === "sync" && msg.players) {
          remotePosRef.current = msg.players
          setOnlineCount(Object.keys(msg.players).length + 1)
          if (msg.teamScore) {
            teamScoreRef.current = msg.teamScore
            setTeamScore(msg.teamScore)
          }
        } else if (msg.type === "pvp_damage") {
          playerHpRef.current = msg.hp ?? playerHpRef.current
          setPlayerHp(playerHpRef.current)
          setDamageFlash(true)
          setTimeout(() => setDamageFlash(false), 200)
          if (playerHpRef.current <= 0 && gamePhaseRef.current === "playing") {
            deathsRef.current++
            setDeaths(deathsRef.current)
            consecutiveKillsRef.current = 0
            // wait for server respawn
          }
        } else if (msg.type === "pvp_respawn") {
          playerHpRef.current = msg.hp ?? PLAYER_MAX_HP
          setPlayerHp(playerHpRef.current)
          spawnInvulnUntilRef.current = Date.now() + (msg.invulnMs ?? 3000)
        } else if (msg.type === "pvp_kill") {
          if (msg.killer && msg.victim) {
            const headshotPrefix = msg.headshot ? "💥 " : ""
            const text = `${headshotPrefix}${msg.killer} ▶ ${msg.victim}`
            killFeedRef.current = [
              ...killFeedRef.current,
              {
                id: Math.random(),
                text,
                color:
                  msg.killerTeam === "red"
                    ? "#ff4444"
                    : msg.killerTeam === "blue"
                      ? "#4488ff"
                      : "#00ff41",
              },
            ].slice(-5)
            setKillFeed(killFeedRef.current)
          }
          if (msg.teamScore) {
            teamScoreRef.current = msg.teamScore
            setTeamScore(msg.teamScore)
          }
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

  // ── Twin joysticks: native touch events with per-stick identifier tracking ─
  // React's onTouch/onPointer handlers run through the synthetic event system
  // which is passive on touch inputs (preventDefault is a silent no-op) and on
  // some Android browsers the pointer events for canvas-adjacent elements get
  // swallowed. Binding addEventListener with passive:false dodges both bugs.
  useEffect(() => {
    if (!isMobile) return
    const moveEl = joyContainerRef.current
    const lookEl = lookJoyContainerRef.current
    if (!moveEl || !lookEl) return
    const MAX_DIST = 52

    function bindStick(
      el: HTMLDivElement,
      valueRef: { current: { vx: number; vy: number } },
      thumbRef: { current: HTMLDivElement | null },
    ): () => void {
      let activeId = -1
      let baseX = 0
      let baseY = 0
      const reset = () => {
        activeId = -1
        valueRef.current = { vx: 0, vy: 0 }
        if (thumbRef.current) thumbRef.current.style.transform = "translate(0px, 0px)"
      }
      const onStart = (e: TouchEvent) => {
        if (activeId !== -1) return
        const t = e.changedTouches[0]
        if (!t) return
        e.preventDefault()
        activeId = t.identifier
        baseX = t.clientX
        baseY = t.clientY
      }
      const onMove = (e: TouchEvent) => {
        if (activeId === -1) return
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches.item(i)
          if (!t || t.identifier !== activeId) continue
          e.preventDefault()
          const dx = t.clientX - baseX
          const dy = t.clientY - baseY
          const dist = Math.hypot(dx, dy)
          const clamped = Math.min(dist, MAX_DIST)
          const nx = dist > 0 ? (dx / dist) * clamped : 0
          const ny = dist > 0 ? (dy / dist) * clamped : 0
          valueRef.current = { vx: nx / MAX_DIST, vy: ny / MAX_DIST }
          if (thumbRef.current) {
            thumbRef.current.style.transform = `translate(${nx}px, ${ny}px)`
          }
        }
      }
      const onEnd = (e: TouchEvent) => {
        if (activeId === -1) return
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches.item(i)
          if (t && t.identifier === activeId) {
            reset()
            return
          }
        }
      }
      el.addEventListener("touchstart", onStart, { passive: false })
      el.addEventListener("touchmove", onMove, { passive: false })
      el.addEventListener("touchend", onEnd, { passive: false })
      el.addEventListener("touchcancel", onEnd, { passive: false })
      return () => {
        el.removeEventListener("touchstart", onStart)
        el.removeEventListener("touchmove", onMove)
        el.removeEventListener("touchend", onEnd)
        el.removeEventListener("touchcancel", onEnd)
        reset()
      }
    }

    const cleanupMove = bindStick(moveEl, joystickRef, joyThumbRef)
    const cleanupLook = bindStick(lookEl, lookJoyRef, lookJoyThumbRef)
    return () => {
      cleanupMove()
      cleanupLook()
    }
  }, [isMobile])

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

        {/* Team score (TDM) */}
        {mode === "tdm" && !isLoading && !error && (
          <div
            style={{
              position: "absolute",
              top: "0.5rem",
              left: "50%",
              transform: "translateX(-50%)",
              display: "flex",
              gap: "0.6rem",
              alignItems: "center",
              padding: "0.3rem 0.8rem",
              border: "1px solid #003300",
              background: "rgba(0,0,0,0.6)",
              backdropFilter: "blur(4px)",
              zIndex: 30,
              fontFamily: "monospace",
              letterSpacing: "0.15em",
            }}
          >
            <span style={{ color: "#ff4444", fontWeight: "bold", textShadow: "0 0 6px #ff4444" }}>
              RED {teamScore.red}
            </span>
            <span style={{ color: "#555" }}>vs</span>
            <span style={{ color: "#4488ff", fontWeight: "bold", textShadow: "0 0 6px #4488ff" }}>
              {teamScore.blue} BLUE
            </span>
            <span
              style={{
                marginLeft: "0.5rem",
                fontSize: "0.65rem",
                color: myTeam === "red" ? "#ff4444" : "#4488ff",
              }}
            >
              [YOU: {myTeam.toUpperCase()}]
            </span>
          </div>
        )}

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

        {/* ── Mobile top HUD: HP · SCORE · AMMO ────────────────────────── */}
        {!isLoading && !error && isMobile && gamePhase === "playing" && (
          <div
            style={{
              position: "absolute",
              top: "0.5rem",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 22,
              display: "flex",
              gap: "0.5rem",
              alignItems: "center",
              padding: "0.4rem 0.7rem",
              background: "rgba(0,0,0,0.55)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "8px",
              fontFamily: "monospace",
              pointerEvents: "none",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.55rem" }}>HP</span>
            <span
              style={{
                color: hpColor,
                fontSize: "1.05rem",
                fontWeight: "bold",
                textShadow: `0 0 6px ${hpColor}aa`,
                minWidth: "2.2ch",
                textAlign: "right",
              }}
            >
              {playerHp}
            </span>
            <span style={{ color: "rgba(255,255,255,0.2)" }}>·</span>
            <span style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.55rem" }}>SCORE</span>
            <span style={{ color: "#ffcc00", fontSize: "1.05rem", fontWeight: "bold" }}>
              {score}
            </span>
            <span style={{ color: "rgba(255,255,255,0.2)" }}>·</span>
            <span
              style={{
                color: "rgba(255,255,255,0.45)",
                fontSize: "0.55rem",
                letterSpacing: "0.1em",
              }}
            >
              {currentWeapon.name.slice(0, 4)}
            </span>
            <span
              style={{
                color: currentWeapon.maxAmmo !== -1 && ammo === 0 ? "#ff3333" : "white",
                fontSize: "1.05rem",
                fontWeight: "bold",
              }}
            >
              {currentWeapon.maxAmmo === -1 ? "∞" : ammo}
              {currentWeapon.maxAmmo !== -1 && (
                <span style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.7rem" }}>
                  /{currentWeapon.maxAmmo}
                </span>
              )}
            </span>
            {isReloading && (
              <span style={{ color: "#ffaa00", fontSize: "0.55rem", marginLeft: "0.2rem" }}>
                RELOAD
              </span>
            )}
          </div>
        )}

        {/* ── Bottom-left: HP bar (COD style, desktop only) ────────────── */}
        {!isLoading && !error && !isMobile && gamePhase === "playing" && (
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

        {/* ── Bottom-right: Ammo display (COD style, desktop only) ─────── */}
        {!isLoading && !error && !isMobile && gamePhase === "playing" && (
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

        {/* ── Circular Minimap (top-right, hidden on mobile to free room for buttons) */}
        {!isLoading && !error && !isMobile && (
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
        {/* Mobile keeps a hidden minimap canvas so the draw loop keeps running without errors */}
        {!isLoading && !error && isMobile && (
          <canvas ref={minimapRef} width={92} height={92} style={{ display: "none" }} aria-hidden />
        )}

        {/* Online count + tag (below minimap; hidden on mobile to make room for action buttons) */}
        {!isLoading && !error && !isMobile && (
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

        {/* ── Enemy / bot count (top-center; only when there's actually a count to show) */}
        {!isLoading &&
          !error &&
          gamePhase === "playing" &&
          !showMissionSelect &&
          !isMobile &&
          aliveEnemyCount > 0 && (
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
                style={{
                  color: "rgba(255,80,80,0.85)",
                  fontSize: "0.62rem",
                  letterSpacing: "0.2em",
                }}
              >
                {mode === "wave_defense" ? "ENEMIES REMAINING" : "BOTS ALIVE"}
              </div>
              <div
                style={{ color: "#ff5555", fontSize: "1.4rem", fontWeight: "bold", lineHeight: 1 }}
              >
                {aliveEnemyCount}
              </div>
            </div>
          )}

        {/* ── Kill feed (right side; shifted left on mobile so action buttons stay clear) */}
        {!isLoading && !error && killFeed.length > 0 && (
          <div
            style={{
              position: "absolute",
              top: isMobile ? "3.4rem" : "8rem",
              right: isMobile ? "7rem" : "1rem",
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

        {/* Weapon selector (compact, bottom-center-right; desktop only — mobile uses top-center buttons) */}
        {!isLoading && !error && !isMobile && gamePhase === "playing" && (
          <div
            style={{
              position: "absolute",
              bottom: "5.2rem",
              right: "1.4rem",
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

        {/* CRT scanline overlay — disabled by default; was distracting at
            full strength. Re-enable via the F8 toggle (sets `crtScanlines`
            in localStorage) if you want the retro look back. */}
        {!isLoading && !error && scanlinesOn && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.04) 3px, rgba(0,0,0,0.04) 4px)",
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
                e.type === "heavy" ? "#cc44ff" : e.type === "sniper" ? "#88cc44" : "#ff5555"
              const hpBarColor =
                e.type === "heavy" ? "#aa00ff" : e.type === "sniper" ? "#5fa030" : "#ff2222"
              const label = e.type === "heavy" ? "HVY" : e.type === "sniper" ? "SNP" : `E${i + 1}`
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

        {/* Move joystick (bottom-left; native touch listeners are attached in
            a useEffect to dodge React's passive-touch quirk on mobile). */}
        {isMobile && !isLoading && !error && (
          <div
            ref={joyContainerRef}
            style={{
              position: "absolute",
              bottom: isLandscape ? "0.6rem" : "1.2rem",
              left: isLandscape ? "0.6rem" : "1.2rem",
              width: isLandscape ? "108px" : "130px",
              height: isLandscape ? "108px" : "130px",
              borderRadius: "50%",
              background: "rgba(0,0,0,0.45)",
              border: "2px solid rgba(255,255,255,0.32)",
              boxShadow: "0 0 14px rgba(0,0,0,0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              touchAction: "none",
              WebkitTapHighlightColor: "transparent",
              zIndex: 30,
              userSelect: "none",
            }}
          >
            <div
              ref={joyThumbRef}
              style={{
                width: "50px",
                height: "50px",
                borderRadius: "50%",
                background: "rgba(255,255,255,0.32)",
                border: "1px solid rgba(255,255,255,0.55)",
                pointerEvents: "none",
                transition: "background 0.15s",
              }}
            />
          </div>
        )}

        {/* Look joystick (bottom-right symmetric; rotates the camera) */}
        {isMobile && !isLoading && !error && gamePhase === "playing" && (
          <div
            ref={lookJoyContainerRef}
            style={{
              position: "absolute",
              bottom: isLandscape ? "0.6rem" : "1.2rem",
              right: isLandscape ? "0.6rem" : "1.2rem",
              width: isLandscape ? "108px" : "130px",
              height: isLandscape ? "108px" : "130px",
              borderRadius: "50%",
              background: "rgba(0,40,80,0.35)",
              border: "2px solid rgba(120,180,255,0.45)",
              boxShadow: "0 0 14px rgba(0,80,160,0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              touchAction: "none",
              WebkitTapHighlightColor: "transparent",
              zIndex: 30,
              userSelect: "none",
            }}
          >
            <div
              ref={lookJoyThumbRef}
              style={{
                width: "50px",
                height: "50px",
                borderRadius: "50%",
                background: "rgba(120,180,255,0.35)",
                border: "1px solid rgba(160,210,255,0.65)",
                pointerEvents: "none",
                transition: "background 0.15s",
              }}
            />
          </div>
        )}

        {/* Mobile action buttons */}
        {isMobile && !isLoading && !error && gamePhase === "playing" && (
          <>
            {/* FIRE button — sits ABOVE the right look-stick so right thumb
                can stretch up to fire without leaving the stick. */}
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault()
                mouseDownRef.current = true
              }}
              onPointerUp={(e) => {
                e.preventDefault()
                mouseDownRef.current = false
              }}
              onPointerCancel={() => {
                mouseDownRef.current = false
              }}
              style={{
                position: "absolute",
                bottom: isLandscape ? "7.5rem" : "11rem",
                right: isLandscape ? "1rem" : "2rem",
                width: isLandscape ? "72px" : "86px",
                height: isLandscape ? "72px" : "86px",
                borderRadius: "50%",
                background: "rgba(255,40,40,0.32)",
                border: "3px solid rgba(255,80,80,0.85)",
                boxShadow: "0 0 16px rgba(255,40,40,0.45)",
                color: "#ffeaea",
                fontFamily: "monospace",
                fontSize: isLandscape ? "0.9rem" : "1.05rem",
                letterSpacing: "0.18em",
                fontWeight: "bold",
                textShadow: "0 0 10px #ff4040",
                touchAction: "none",
                userSelect: "none",
                zIndex: 32,
              }}
            >
              FIRE
            </button>

            {/* RELOAD button (bottom-center) */}
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault()
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
              }}
              style={{
                position: "absolute",
                bottom: isLandscape ? "1rem" : "2.5rem",
                left: "50%",
                transform: "translateX(-50%)",
                width: isLandscape ? "60px" : "72px",
                height: isLandscape ? "60px" : "72px",
                borderRadius: "50%",
                background: "rgba(0,0,0,0.6)",
                border: "2px solid rgba(255,200,0,0.6)",
                boxShadow: "0 0 10px rgba(255,200,0,0.25)",
                color: "#ffdf66",
                fontFamily: "monospace",
                fontSize: isLandscape ? "0.62rem" : "0.72rem",
                letterSpacing: "0.1em",
                fontWeight: "bold",
                touchAction: "none",
                userSelect: "none",
                zIndex: 30,
              }}
            >
              ↻
              <br />
              RELOAD
            </button>

            {/* ADS button (top-right) */}
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault()
                isAimingRef.current = true
                setIsAiming(true)
              }}
              onPointerUp={(e) => {
                e.preventDefault()
                isAimingRef.current = false
                setIsAiming(false)
              }}
              onPointerCancel={() => {
                isAimingRef.current = false
                setIsAiming(false)
              }}
              style={{
                position: "absolute",
                top: isLandscape ? "0.6rem" : "3.6rem",
                right: isLandscape ? "7.5rem" : "1.2rem",
                width: isLandscape ? "56px" : "64px",
                height: isLandscape ? "56px" : "64px",
                borderRadius: "50%",
                background: "rgba(0,0,0,0.6)",
                border: "2px solid rgba(0,200,255,0.6)",
                boxShadow: "0 0 10px rgba(0,200,255,0.2)",
                color: "#88e0ff",
                fontFamily: "monospace",
                fontSize: isLandscape ? "0.62rem" : "0.72rem",
                fontWeight: "bold",
                touchAction: "none",
                userSelect: "none",
                zIndex: 30,
              }}
            >
              ⊙
              <br />
              ADS
            </button>

            {/* GRENADE button (top-right, below ADS) */}
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault()
                const now = Date.now()
                if (now - lastGrenadeRef.current > 5000) {
                  lastGrenadeRef.current = now
                  requestGrenadeRef.current = true
                  setGrenadeCooldownMs(5000)
                }
              }}
              style={{
                position: "absolute",
                top: isLandscape ? "0.6rem" : "9rem",
                right: isLandscape ? "13.5rem" : "1.2rem",
                width: isLandscape ? "56px" : "64px",
                height: isLandscape ? "56px" : "64px",
                borderRadius: "50%",
                background: "rgba(0,0,0,0.6)",
                border:
                  grenadeCooldownMs > 0
                    ? "2px solid rgba(120,120,120,0.55)"
                    : "2px solid rgba(255,140,40,0.7)",
                boxShadow: grenadeCooldownMs > 0 ? "none" : "0 0 10px rgba(255,140,40,0.25)",
                color: grenadeCooldownMs > 0 ? "#888" : "#ffaa66",
                fontFamily: "monospace",
                fontSize: isLandscape ? "0.62rem" : "0.72rem",
                fontWeight: "bold",
                touchAction: "none",
                userSelect: "none",
                zIndex: 30,
              }}
            >
              {grenadeCooldownMs > 0 ? `${Math.ceil(grenadeCooldownMs / 1000)}s` : "🧨"}
              {grenadeCooldownMs === 0 && (
                <>
                  <br />
                  GRENADE
                </>
              )}
            </button>

            {/* Weapon swap row [1][2][3] (top-center, below HUD bar) */}
            <div
              style={{
                position: "absolute",
                top: "2.8rem",
                left: "50%",
                transform: "translateX(-50%)",
                display: "flex",
                gap: "0.45rem",
                zIndex: 22,
              }}
            >
              {[0, 1, 2].map((idx) => {
                const w = WEAPONS[idx]
                if (!w) return null
                const sel = currentWeaponIdxRef.current === idx
                const locked = !unlockedWeapons.has(w.id)
                return (
                  <button
                    type="button"
                    key={idx}
                    onPointerDown={(e) => {
                      e.preventDefault()
                      if (locked || reloadingRef.current) return
                      weaponAmmoRef.current[currentWeaponIdxRef.current] = ammoRef.current
                      currentWeaponIdxRef.current = idx
                      ammoRef.current = weaponAmmoRef.current[idx] ?? -1
                      setAmmo(ammoRef.current)
                      setCurrentWeaponIdx(idx)
                    }}
                    style={{
                      width: "60px",
                      height: "60px",
                      borderRadius: "10px",
                      background: sel ? "rgba(0,255,65,0.22)" : "rgba(0,0,0,0.55)",
                      border: `2px solid ${sel ? "#00ff41" : locked ? "#444" : "rgba(0,170,42,0.55)"}`,
                      boxShadow: sel ? "0 0 8px rgba(0,255,65,0.5)" : "none",
                      color: locked ? "#666" : sel ? "#00ff41" : "#00cc33",
                      fontFamily: "monospace",
                      fontSize: "0.72rem",
                      letterSpacing: "0.08em",
                      fontWeight: "bold",
                      textShadow: sel ? "0 0 6px #00ff41" : "none",
                      touchAction: "none",
                      userSelect: "none",
                    }}
                  >
                    [{idx + 1}]
                    <br />
                    {w.name.charAt(0)}
                  </button>
                )
              })}
            </div>
          </>
        )}

        {/* Chat (desktop only — mobile lacks an on-screen keyboard slot here) */}
        {!isLoading && !error && !isMobile && (
          <div
            style={{
              position: "absolute",
              bottom: "5.2rem",
              left: "1.4rem",
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
              <div
                style={{ color: "rgba(255,200,80,0.55)", fontSize: "0.65rem", marginTop: "0.4rem" }}
              >
                STREAK: {maxKillstreakRef.current} · HEADSHOTS: {headshotsRef.current}
              </div>
            </div>
            {mvpName && (
              <div
                style={{
                  border: "1px solid #ffd700",
                  padding: "0.7rem 2rem",
                  background: "rgba(40,30,0,0.6)",
                  color: "#ffd700",
                  letterSpacing: "0.25em",
                  textShadow: "0 0 12px #ffd700",
                  fontSize: "1.1rem",
                }}
              >
                ★ MVP: {mvpName} ★
              </div>
            )}
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
              {onExit && (
                <button
                  type="button"
                  onClick={onExit}
                  style={{
                    background: "rgba(0,40,0,0.5)",
                    border: "1px solid rgba(0,255,65,0.6)",
                    color: "#00ff41",
                    fontFamily: "monospace",
                    fontSize: "0.9rem",
                    letterSpacing: "0.2em",
                    padding: "0.6rem 1.8rem",
                    cursor: "pointer",
                  }}
                >
                  ◀ MODE SELECT
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
