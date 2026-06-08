"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import * as THREE from "three"

// ── Constants ──────────────────────────────────────────────────────────────────
// MAP_SIZE stays at 100: it is the original *city* grid (0–100) that every
// building / spawn / AABB is authored against. The GTA-style open world is
// built *around* that city by extending the walkable bounds outward — see
// WORLD_* below. Keeping MAP_SIZE intact means none of the thousands of
// city-relative coordinates have to move.
const MAP_SIZE = 100
const TILE_UNIT = 1
// ── Open-world bounds ──────────────────────────────────────────────────────
// The city (0–100) sits in the *center* of a 600×600 world. WORLD_HALF is the
// reach from the city center (50,50) to each edge, so the world spans
// WORLD_MIN..WORLD_MAX on both axes, 6× the old playable size.
const WORLD_HALF = 300
const WORLD_CENTER = 50 // = MAP_SIZE / 2 (city center)
const WORLD_MIN = WORLD_CENTER - WORLD_HALF // -250
const WORLD_MAX = WORLD_CENTER + WORLD_HALF // 350
const WORLD_SIZE = WORLD_HALF * 2 // 600
// Area bands (north = -z INDUSTRIAL, center = CITY, south = +z HARBOR). The
// city occupies z 0–100; the band thresholds sit just outside it.
type AreaId = "INDUSTRIAL" | "CITY" | "HARBOR"
const AREA_NORTH_EDGE = -10 // z below this → INDUSTRIAL
const AREA_SOUTH_EDGE = 110 // z above this → HARBOR
function areaForPos(z: number): AreaId {
  if (z < AREA_NORTH_EDGE) return "INDUSTRIAL"
  if (z > AREA_SOUTH_EDGE) return "HARBOR"
  return "CITY"
}
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
// ── Vehicle (drivable car) ───────────────────────────────────────────────────
// First-pass vehicle system: enter / drive / exit only. No run-over, no AI
// drivers, no destruction (those are explicitly out of scope for this PR).
const VEHICLE_RADIUS = 1.15 // collision circle (car is ~2.4 long × 1.2 wide)
const VEHICLE_MAX_SPEED = 16 // m/s forward
const VEHICLE_REVERSE_SPEED = 6 // m/s backward
const VEHICLE_ACCEL = 14 // throttle response (m/s²)
const VEHICLE_BRAKE_DRAG = 1.6 // engine-braking decay per second when coasting
const VEHICLE_TURN_RATE = 1.9 // rad/s steering at speed
const VEHICLE_ENTER_RADIUS = 3.4 // how close on foot to board
const VEHICLE_CAM_DIST = 7.5 // third-person camera trail distance
const VEHICLE_CAM_HEIGHT = 4.0 // third-person camera height
const VEHICLE_CAR_HP = 250 // cars are fragile (all damage counts)
const VEHICLE_EJECT_DAMAGE = 60 // dealt to the player when their ride explodes
// Auto-recenter the chase cam behind the hull after this idle (no aim input).
const VEHICLE_CAM_RECENTER_MS = 600
// ── Tank (drivable, armored, main cannon) ──────────────────────────────────
const VEHICLE_TANK_HP = 1200 // heavy armor, but nerfed from 2000 (was too cheaty)
const VEHICLE_TANK_RADIUS = 1.7 // bigger collision body than a car
const VEHICLE_TANK_MAX_SPEED = 8.1 // slow & heavy; nerfed 10% from 9
const VEHICLE_TANK_REVERSE = 3.6 // nerfed 10% from 4
const VEHICLE_TANK_ACCEL = 8 // sluggish throttle response
const VEHICLE_TANK_TURN = 1.05 // ponderous hull steering (car is 1.9)
// ── Motorcycle (drivable; also ridden by terraformers for swarm charges) ────
// Light, nimble, fast: quicker accel + higher top speed + tighter turning than
// a car, but fragile.
const VEHICLE_BIKE_RADIUS = 0.7 // small collision body (slips through gaps)
const VEHICLE_BIKE_HP = 90 // very fragile
const VEHICLE_BIKE_MAX_SPEED = 22 // top speed (faster than the car's 16)
const VEHICLE_BIKE_REVERSE = 5
const VEHICLE_BIKE_ACCEL = 24 // snappy throttle response (car is 14)
const VEHICLE_BIKE_TURN = 2.6 // tight steering (car is 1.9)
// Terraformer bike-charge tuning.
const BIKE_MOUNT_SEEK_RANGE = 30 // a free bike within this → a terraformer goes for it
const BIKE_MOUNT_RADIUS = 2.6 // close enough to actually climb aboard
const BIKE_PLAYER_FAR = 50 // …but only when the player is at least this far off
const BIKE_RIDER_RAM_DMG = 22 // per swarm bike (low; the threat is volume)
const BIKE_RIDER_SEAT_Y = 0.9 // rider mesh sits this high on the bike
const BIKE_RESPAWN_MS = 20000 // a taken / destroyed bike refills its slot after this
// Small-arms (bullets / claws) only chip the tank; explosives hit full.
// Bumped from 0.12 → 0.25 so sustained enemy fire actually wears it down.
const TANK_ARMOR_BULLET = 0.25
// Main cannon: slow AOE shell on a cooldown, unlimited ammo.
const CANNON_COOLDOWN_MS = 3750 // nerfed 1.5x from 2500
// Enemy heavy grenades hit a tank for 3x (anti-tank rounds) so dismounting
// under grenade pressure is a real decision, not a free win.
const TANK_GRENADE_MULT = 3
// After dismounting, the player can't fire for this long (mount/dismount
// vulnerability window — you're exposed the instant you hop out).
const VEHICLE_EXIT_FIRE_LOCK_MS = 500
const CANNON_RADIUS = 6 // AOE blast radius
const CANNON_SHELL_SPEED = 36 // fast enough to read fairly flat
const CANNON_BARREL_MIN_PITCH = -0.25
const CANNON_BARREL_MAX_PITCH = 0.6
// Run-over: driving into enemies above a speed threshold hurts them. Tanks
// crush almost anything; cars need real speed and scale damage with it.
const RUNOVER_MIN_SPEED_CAR = 4 // m/s before a car does any damage
const RUNOVER_MIN_SPEED_TANK = 1.5 // tanks crush even at a crawl
const RUNOVER_CAR_DMG_PER_SPEED = 16 // car contact damage = speed × this
const RUNOVER_TANK_DAMAGE = 9999 // tanks instakill on contact
// Enemy-driven vehicles are tuned to be a destroyable threat (lower than the
// player's own ride): explosives are the intended counter, bullets chip.
const ENEMY_VEH_CAR_HP = 200
const ENEMY_VEH_TANK_HP = 600
// ── Fighter jet (drivable; taxis, takes off, flies, lands) ──────────────────
const VEHICLE_JET_RADIUS = 1.5 // fuselage collision circle
const VEHICLE_JET_HP = 700 // player jet — tankier than enemy jets (150)
const JET_ACCEL = 16 // throttle response (m/s²)
const JET_MAX_SPEED = 48 // top speed (fastest vehicle by far)
const JET_DRAG = 2.2 // passive decel when off-throttle
const JET_TAKEOFF_SPEED = 22 // ground speed needed to rotate + lift off
const JET_MIN_FLY_SPEED = 16 // below this in the air → stall + sink
const JET_STALL_SINK = 11 // m/s downward pull while stalled
const JET_PITCH_RATE = 1.1 // rad/s nose pitch from the stick (mobile)
const JET_TURN_RATE = 1.5 // rad/s yaw/roll from the stick (mobile)
const JET_CAM_DIST = 12 // chase-cam trail distance (further than ground rides)
const JET_CAM_HEIGHT = 4.5
const JET_GUN_COOLDOWN_MS = 90 // nose machine-gun cadence
const JET_GUN_DAMAGE = 22
const JET_GUN_RANGE = 220
const JET_MISSILE_COOLDOWN_MS = 3000
const JET_MISSILE_RADIUS = 9 // AOE blast radius
const JET_MISSILE_SPEED = 60
const JET_CRASH_DAMAGE = 80 // dealt to the player when the jet smashes in
// ── PR-F2: anti-air guns, enemy jets, parachute ────────────────────────────
const AA_GUN_HP = 80
const AA_RANGE = 150 // engages the player jet within this 3D distance
const AA_MIN_ALT = 5 // only fires at a jet this far off the ground
const AA_FIRE_INTERVAL_MIN = 2000
const AA_FIRE_INTERVAL_VAR = 1000
const AA_SHELL_SPEED = 70
const AA_SHELL_DIRECT = 30 // direct-hit damage to the jet
const AA_SHELL_SPLASH = 10 // near-miss splash damage
const AA_DIRECT_RADIUS = 4
const AA_SPLASH_RADIUS = 10
const ENEMY_JET_HP = 150
const ENEMY_JET_SPEED = 30
const ENEMY_JET_CHASE_RANGE = 200
const ENEMY_JET_ATTACK_RANGE = 100
const ENEMY_JET_GUN_COOLDOWN_MS = 150
const ENEMY_JET_GUN_DAMAGE = 6
const ENEMY_JET_TURN = 0.7 // rad/s steering toward the target
// Ground-strafe runs: when the player is on foot, bandits occasionally dive and
// machine-gun the ground before pulling back up.
const ENEMY_JET_STRAFE_INTERVAL_MS = 20000 // ~one strafing run per jet per 20s
const ENEMY_JET_STRAFE_DAMAGE = 15 // per strafing hit on the on-foot player
const ENEMY_JET_STRAFE_DIVE_ALT = 12 // dive target altitude (noses down at the player)
const ENEMY_JET_STRAFE_PULLUP_ALT = 24 // break off + climb once this low
const ENEMY_JET_STRAFE_RANGE = 260 // only begins a run if the player is within this
// ── PR-G1: ground anti-air (jet hitscan fix, mountable AA gun, RPG) ──────────
// Ground weapons engage jets out to here. The fire() raycaster is otherwise
// unbounded, but jets are small, fast aerial targets — a pixel-perfect centre
// ray rarely connects. So we add a ray-vs-sphere aim assist within this range.
const JET_GROUND_RANGE = 600 // max ground→jet engagement distance (m)
const JET_AIM_ASSIST_RADIUS = 5 // perpendicular ray-miss tolerance (m), base
const JET_AIM_ASSIST_SNIPER_MULT = 2.4 // sniper is far more forgiving (scoped)
// Player-mounted AA gun (board an existing aaGun and fire it yourself).
const AA_MOUNT_RADIUS = 3.4 // how close on foot to board the AA gun
const AA_MOUNT_MANUAL_AIM = Math.PI / 6 // ±30° manual barrel correction
const AA_MOUNT_FIRE_INTERVAL_MS = 1500 // player AA cadence
const AA_MOUNT_SHELL_DIRECT = 40 // direct-hit damage (stronger than AI's 30)
const AA_MOUNT_SHELL_SPLASH = 15 // near-miss splash (vs AI's 10)
const AA_MOUNT_CAM_DIST = 7.0 // third-person trail behind the turret
const AA_MOUNT_CAM_HEIGHT = 4.5
const AA_MOUNT_DMG_MULT = 0.5 // the turret shields the gunner (half damage)
const AA_MOUNT_SHELL_SPEED = 120 // faster than AI shells so leading is easier
// RPG rocket launcher (handheld anti-air; also hits ground targets).
const RPG_RELOAD_MS = 8000
const RPG_SPEED = 55
const RPG_RADIUS = 9 // AOE blast radius
const RPG_DIRECT = 60 // direct-hit damage
const RPG_SPLASH = 25 // splash damage at the rim
const RPG_HOMING_TURN = 1.6 // rad/s steering toward the locked target (medium)
const RPG_LIFE = 5.0 // seconds before self-detonate
const RPG_DIRECT_RADIUS = 4 // proximity-fuse radius around the locked target
// Half-angle of the launch lock-on cone: at fire time the nearest enemy of any
// type within this cone of the aim direction becomes the homing target.
const RPG_LOCK_COS = Math.cos((20 * Math.PI) / 180)
// Aim-assist sphere radius for the jet nose gun firing at ground targets — the
// jet is fast, so a small forgiveness keeps air-to-ground strafing usable.
const JET_GROUND_ASSIST = 3.5
const PARACHUTE_GRAVITY = 11 // descent ≈ GRAVITY/2 (was /6 — too floaty)
const PARACHUTE_MAX_SINK = 12 // terminal descent speed under canopy (3× faster)
const PARACHUTE_OPEN_DELAY_MS = 1000 // free-fall before the canopy deploys
const EJECT_UP_SPEED = 9 // upward pop when ejecting
// ── Vertical movement ──────────────────────────────────────────────────────────
// Real gravity in m/s². Picked to feel snappy (a 4m drop = ~0.6s in air),
// not a perfect-physics simulation. Tuned by feel under EYE_HEIGHT.
const GRAVITY = 22
// Auto step-up: when the new floor below the player is at most this many
// metres higher than the current foot position, we silently snap up (small
// curbs, low stairs). Larger climbs require an E-key climb zone.
const STEP_UP_MAX = 0.4
// Fall damage is keyed off the *drop height* (start-Y minus landing-Y), not
// impact speed — a single cheap Y comparison per landing, no raycasts. Below
// MIN_DROP: harmless. From MIN_DROP up to LETHAL_DROP: damage ramps linearly
// from DMG_AT_MIN to DMG_MAX. At/above LETHAL_DROP: instant death.
const FALL_MIN_DROP = 8 // metres before any damage
const FALL_LETHAL_DROP = 20 // metres = guaranteed death
const FALL_DMG_AT_MIN = 30 // damage at exactly MIN_DROP
const FALL_DMG_MAX = 90 // damage approaching LETHAL_DROP
// ── Enemy elevator-chase AI (PR-C) ──────────────────────────────────────────
// When the player is up on a tower deck, nearby grounded enemies ride the
// elevator up to engage. Caps keep the lift from jamming.
const PLAYER_ROOF_MIN_Y = 5 // player Y above this = "on a rooftop"
const ELEVATOR_CHASE_RANGE = 60 // enemies within this of the base will commit
const MAX_ELEVATOR_RIDERS = 2 // concurrent enemies riding the lift
const MAX_ELEVATOR_COMMIT = 3 // total committed (riders + queued at the base)
const ENEMY_RIDE_TIME = 2.2 // seconds for an enemy to ride up / down
// How close the player has to be to a climb zone for E to lift them up.
// Radius around the zone's center.
const CLIMB_INTERACT_PAD = 0.2 // extra slack on the climb-zone AABB
// Death animation: 1.2s collapse → 1.8s lying on ground → 1.0s fade out.
const DEATH_ANIM_FALL = 1.2
const DEATH_ANIM_LIE = 1.8
const DEATH_ANIM_FADE = 1.0
const DEATH_ANIM_TOTAL = DEATH_ANIM_FALL + DEATH_ANIM_LIE + DEATH_ANIM_FADE

// ── Weapon definitions ─────────────────────────────────────────────────────────
interface WeaponDef {
  id: "pistol" | "shotgun" | "sniper" | "knife" | "rpg"
  name: string
  maxAmmo: number // -1 = infinite
  hitDamage: number
  reloadTime: number
  spread: number
  pellets: number
  bulletLifetime: number
  bulletColor: number
  recoil: number
  // Melee weapon (knife): no projectiles. fire() routes to a forward-cone
  // melee swing instead of spawning bullets. Optional so the existing ranged
  // weapon literals stay untouched.
  melee?: boolean
  // Rocket weapon (RPG): fire() launches a single homing rocket that AOE-
  // explodes. Locked until picked up off the map. PR-G1.
  rocket?: boolean
}

// Knife melee tuning — forward fan-shaped hitbox.
const KNIFE_RANGE = 1.8
const KNIFE_HALF_ANGLE = Math.PI / 6 // ±30°
const KNIFE_DAMAGE = 80
const KNIFE_SWING_TIME = 0.3 // seconds of swing animation
const KNIFE_COOLDOWN_MS = 480 // swing + recovery; blocks re-input during anim

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
  {
    id: "knife",
    name: "KNIFE",
    maxAmmo: -1, // infinite (∞) — no ammo / reload
    hitDamage: KNIFE_DAMAGE,
    reloadTime: 0,
    spread: 0,
    pellets: 0,
    bulletLifetime: 0,
    bulletColor: 0xcccccc,
    recoil: 0.05,
    melee: true,
  },
  {
    id: "rpg",
    name: "RPG",
    maxAmmo: 1, // single rocket; reloads one round
    hitDamage: RPG_DIRECT,
    reloadTime: RPG_RELOAD_MS,
    spread: 0,
    pellets: 1,
    bulletLifetime: RPG_LIFE,
    bulletColor: 0xff6622,
    recoil: 0.3,
    rocket: true,
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
  // Knife swing — fast airy whoosh (high-passed noise sweep).
  knife() {
    _noise(0.16, 0.4, "highpass", 1800)
    _tone(620, 0.1, 0.14, "sine", 220)
  },
  // RPG launch — deep whoosh + low thump (the rocket's own AOE blast reuses
  // the explosion SFX). Also keeps SOUNDS indexable by every WeaponDef.id.
  rpg() {
    _noise(0.3, 0.7, "lowpass", 420)
    _tone(48, 0.26, 0.4, "sawtooth")
  },
  // Distant zombie groan — low growl + filtered noise rumble. Used as the
  // sparse ambient sting at the start of each zombie wave.
  zombieGroan() {
    const ctx = _getCtx()
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = "sawtooth"
    osc.frequency.setValueAtTime(70, now)
    osc.frequency.linearRampToValueAtTime(48, now + 0.9)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(0.16, now + 0.25)
    g.gain.exponentialRampToValueAtTime(0.001, now + 1.1)
    const f = ctx.createBiquadFilter()
    f.type = "lowpass"
    f.frequency.value = 320
    osc.connect(f)
    f.connect(g)
    g.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 1.15)
    _noise(0.9, 0.12, "bandpass", 240)
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
  // HUNT — original glitchy electronic jingle played when the black orb opens
  // (a rising arpeggio over a square-wave bass blip).
  huntJingle() {
    const ctx = _getCtx()
    const now = ctx.currentTime
    ;[392, 523, 659, 880, 1175].forEach((hz, i) => {
      const o = ctx.createOscillator()
      o.type = i % 2 === 0 ? "square" : "triangle"
      o.frequency.setValueAtTime(hz, now + i * 0.11)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, now + i * 0.11)
      g.gain.exponentialRampToValueAtTime(0.22, now + i * 0.11 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.11 + 0.26)
      o.connect(g)
      g.connect(ctx.destination)
      o.start(now + i * 0.11)
      o.stop(now + i * 0.11 + 0.3)
    })
    _tone(98, 0.5, 0.18, "square")
  },
  // HUNT — sharp mechanical "bang" the instant the orb shells split open
  // (a hard low thunk + a metallic noise crack).
  huntOrbOpen() {
    _tone(70, 0.18, 0.5, "square", 40)
    _noise(0.14, 0.5, "highpass", 2600)
    _tone(220, 0.1, 0.22, "sawtooth", 90)
  },
  // HUNT — tense out-of-bounds warning beep.
  huntWarn() {
    _tone(880, 0.16, 0.26, "square", 660)
  },
  // HUNT — teleport whoosh (white-flash warp into / out of a mission).
  huntWarp() {
    _noise(0.5, 0.5, "highpass", 1200)
    _tone(180, 0.45, 0.3, "sine", 1400)
  },
  // HUNT — single accounting blip used while the orb tallies the score list.
  huntTally() {
    _tone(1320, 0.06, 0.2, "square")
  },
  // Big Cockroach boss: a guttural descending roar.
  bossRoar() {
    const ctx = _getCtx()
    const now = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = "sawtooth"
    o.frequency.setValueAtTime(120, now)
    o.frequency.exponentialRampToValueAtTime(38, now + 1.4)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(0.4, now + 0.2)
    g.gain.exponentialRampToValueAtTime(0.001, now + 1.6)
    const f = ctx.createBiquadFilter()
    f.type = "lowpass"
    f.frequency.value = 400
    o.connect(f)
    f.connect(g)
    g.connect(ctx.destination)
    o.start(now)
    o.stop(now + 1.7)
    _noise(1.4, 0.18, "lowpass", 180)
  },
  // Heavy stomp / building collapse — deep boom + crumbling noise.
  bossStomp() {
    _tone(46, 0.4, 0.55, "sawtooth")
    _noise(0.5, 0.4, "lowpass", 300)
  },
  collapse() {
    _noise(0.7, 0.45, "lowpass", 500)
    _tone(70, 0.3, 0.3, "square", 40)
  },
}

// ══ HUNT mode data (transfer missions) — PR-Z1 ═══════════════════════════════
// An original "transfer to a hunting ground" mode (mechanics only — no existing
// IP names/designs). The player spawns in a dark windowless room with a black
// orb that briefs the target, then warps into a night version of the urban map
// to wipe out themed minions + a boss under a time limit.
const HUNT_TOTAL_KEY = "hunt_total_score" // cumulative score (localStorage)
// Transfer-room centre — kept well inside world bounds and far from the arena so
// the two never overlap. The player is clamped inside the room until the warp.
const HUNT_ROOM = { x: 300, z: -200 }
const HUNT_ROOM_HALF = 5 // interior half-extent (m) the player is clamped within
const HUNT_ARENA = { x: 50, z: 50 } // mission arena centre (urban core)
const HUNT_BASE_RADIUS = 250 // transfer-zone boundary radius (m)
const HUNT_MIN_RADIUS = 80 // Lv3 fully-shrunk radius
const HUNT_SHRINK_SEC = 600 // Lv3 shrink duration (250m → 80m over 10 min)
const HUNT_OOB_GRACE_MS = 3000 // time outside the ring before the head pops
const HUNT_QUOTA_MISS = 15 // quota set on the next mission after a time-out
// A ranged_summon boss stops summoning once this many minions are alive — so
// the field can be cleared (and the mission can end) instead of growing forever.
const HUNT_SUMMON_CAP = 16
// Weird greetings: stiff politeness clashing with crude threats (original).
const HUNT_GREETINGS = [
  "ようこそおいで下さいました。てめえ達の命、私が有効に使わせて頂きます。",
  "ご機嫌よう狩人さん。つべこべ言わず、さっさと標的をブチ殺して下さいまし。",
  "本日はご足労いただき恐悦至極。さあ、薄汚い仕事の時間ですよクソ野郎共。",
]
interface HuntTarget {
  name: string
  trait: string // 特徴
  likes: string // 好きなもの
  phrase: string // 口癖
}
type HuntTheme = "A" | "B" | "C"
interface HuntLevel {
  level: number
  timeLimitSec: number | null // null = no limit (shrinking arena instead)
  theme: HuntTheme
  zakoCount: number
  bossHp: number
  bossScale: number
  bossScore: number
  boss: "charge" | "ranged_summon" | "aoe_fast"
  // Dedicated original boss shape for this level (distinct from the theme's
  // minion creature). Falls back to the minion creature if omitted.
  bossCreature: HuntCreatureKind
  shrink: boolean
  target: HuntTarget
}
// Per-theme minion spec — reuse an existing enemy model with a colour/scale
// tweak. base = model, tint = body recolour, eyes = eye-glow colour.
type HuntCreatureKind =
  | "leek"
  | "fleshball"
  | "tall"
  | "multihead"
  // PR boss-designs: dedicated original boss shapes (one per HUNT level).
  | "multihead_boss"
  | "splitskin_boss"
  | "amalgam_boss"
const HUNT_THEMES: Record<
  HuntTheme,
  {
    base: "grunt" | "terraformer"
    creature: HuntCreatureKind
    tint: number
    eyes: number
    scale: number
    points: number
    hp: number
    speed: number
  }
> = {
  // PR-Z3: every HUNT enemy is now an original monster creature (the `base`
  // model is still built underneath to drive the AI/animation skeleton, but is
  // hidden — the creature rides the root). A: fleshball (eyed meat, medium).
  // B: tall blank-faced creeper (fast). C: multi-headed beast (big, tanky).
  A: {
    base: "grunt",
    creature: "leek",
    tint: 0xf5f5f5, // white bulb body
    eyes: 0xff0000, // glowing red eyes
    scale: 1.0,
    points: 2,
    hp: 70,
    speed: 2.4,
  },
  B: {
    base: "terraformer",
    creature: "tall",
    tint: 0xc9c2b4,
    eyes: 0xff4a2a,
    scale: 0.62,
    points: 3,
    hp: 60,
    speed: 7.0,
  },
  C: {
    base: "grunt",
    creature: "multihead",
    tint: 0x3a2a3e,
    eyes: 0xffcf50,
    scale: 2.0,
    points: 5,
    hp: 260,
    speed: 1.4,
  },
}
const HUNT_LEVELS: HuntLevel[] = [
  {
    level: 1,
    timeLimitSec: 720, // 12 min — fewer minions, so leave room for the boss fight
    theme: "A",
    zakoCount: 8, // lighter wave of leek-aliens
    bossHp: 1500,
    bossScale: 3.0,
    bossScore: 30,
    boss: "charge",
    bossCreature: "multihead_boss",
    shrink: false,
    target: {
      name: "白葱の主 ネブロ",
      trait: "白い球根の胴・揺れる長い緑葉",
      likes: "湿った畑と夜の静寂",
      phrase: "「刈り取りの時間だ」",
    },
  },
  {
    level: 2,
    timeLimitSec: 600,
    theme: "B",
    zakoCount: 20,
    bossHp: 3000,
    bossScale: 3.2,
    bossScore: 45,
    boss: "ranged_summon",
    bossCreature: "splitskin_boss",
    shrink: false,
    target: {
      name: "女王 セレネ",
      trait: "群れを率いる痩躯・蒼白い肌",
      likes: "従順な虫と静寂",
      phrase: "「お黙りなさい」",
    },
  },
  {
    level: 3,
    timeLimitSec: null,
    theme: "C",
    zakoCount: 10,
    bossHp: 6000,
    bossScale: 4.0,
    bossScore: 60,
    boss: "aoe_fast",
    bossCreature: "amalgam_boss",
    shrink: true,
    target: {
      name: "巨像 ガレオ",
      trait: "石像のごとき巨躯・無表情",
      likes: "崩落と沈黙",
      phrase: "「……」",
    },
  },
]

// ══ HUNT mode equipment (PR-Z2) ══════════════════════════════════════════════
// Suit + four dedicated weapons + the rewards bought at the 100-pt menu. All of
// this only exists while modeRef === "hunt"; the normal weapon system is left
// untouched (HUNT weapons run on a parallel set of refs).
const HUNT_SUIT_MAX = 300 // suit durability (absorbs hits before HP)
const HUNT_SUIT_CUT = 0.3 // fraction of damage that reaches HP while suited
const HUNT_SUIT_SPEED = 1.5 // movement multiplier while suited
const HUNT_JUMP_SPEED = 6 // base jump impulse (HUNT only); suit ×3
const HUNT_PUNCH_DAMAGE = 150 // suit melee
const HUNT_PUNCH_RANGE = 2.2
const HUNT_STEALTH_SIGHT = 15 // enemies only notice the player within this (m)
const HUNT_TOTAL_KEY2 = "hunt_total_score" // (shared with PR-Z1)
const HUNT_TICKETS_KEY = "hunt_revive_tickets"
const HUNT_GRAVITY_KEY = "hunt_gravity_unlocked"
const HUNT_CLEARS_KEY = "hunt_clears"
const HUNT_REWARD_COST = 100
const HUNT_MAX_TICKETS = 3
// Pulse-weapon delayed in-body burst (seconds from hit to detonation).
const HUNT_BURST_DELAY = 1.0
type HuntWeaponId = "pulsegun" | "pulseshotgun" | "capturegun" | "blade" | "gravitycannon"
interface HuntWeaponDef {
  id: HuntWeaponId
  name: string
  slot: number // number key (6-9, 0 for gravity)
  mag: number // -1 = melee/infinite
  reloadMs: number
  reward?: boolean // true → only from the 100-pt "gravity cannon" reward
}
const HUNT_WEAPONS: HuntWeaponDef[] = [
  { id: "pulsegun", name: "PULSE GUN", slot: 6, mag: 8, reloadMs: 2000 },
  { id: "pulseshotgun", name: "PULSE SG", slot: 7, mag: 6, reloadMs: 3000 },
  { id: "capturegun", name: "CAPTURE GUN", slot: 8, mag: 3, reloadMs: 5000 },
  { id: "blade", name: "BLADE", slot: 9, mag: -1, reloadMs: 0 },
  { id: "gravitycannon", name: "GRAVITY CANNON", slot: 0, mag: 2, reloadMs: 10000, reward: true },
]
const HUNT_WEAPON_BY_ID: Record<HuntWeaponId, HuntWeaponDef> = Object.fromEntries(
  HUNT_WEAPONS.map((w) => [w.id, w]),
) as Record<HuntWeaponId, HuntWeaponDef>

// ── Map object definitions [x, z, width, depth, type]
// type: 0=building, 1=car, 2=barricade, 3=tank/pipe, 4=tree, 5=trench
//
// Urban-zone buildings (x < 32, type 0) used to live here as solid boxes
// that the player could only hide *behind*. They've been pulled out and
// replaced with proper hollow buildings — see BATTLE_CITY_BUILDINGS at
// the bottom of this module + the makeHollowBuilding pass in init().
const MAP_OBJECTS: [number, number, number, number, number][] = [
  // ── Urban zone (x: 3–28) ─ buildings now in BATTLE_CITY_BUILDINGS ──
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
  // All warehouse / factory buildings have been moved out of MAP_OBJECTS
  // and into BATTLE_CITY_BUILDINGS-style hollow shells (see the
  // INDUSTRIAL_HOLLOW_BUILDINGS pass in init). The avenue terminus
  // building covers the z≈44–55 strip; the 6 industrial buildings here
  // (z=5–28, z=71–79) are now enterable cover beyond the main flanks.
  // Tanks & pipes. Pipe at [63, 46, 1, 10, 3] removed — it was a tall
  // 1m-wide 7m-tall slab sitting in the middle of the central avenue,
  // blocking the spawn-to-terminus walking path. Three more thin pipe slabs
  // ([63,10,1,10] / [63,28,8,1] / [63,65,8,1]) removed for the same reason:
  // each was a 1m-thin wall (one rendered 7m tall, two 8m long) that solidly
  // blocked the x≈63 industrial crossing. The 2×2 tanks below stay as cover.
  [60, 5, 2, 2, 3],
  [60, 24, 2, 2, 3],
  [60, 42, 2, 2, 3],
  [60, 60, 2, 2, 3],
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
  // Trees ([70,7] and [76,9] removed — they fell inside the relocated
  // outdoor-NE mansion footprint at x70–82, z7–19).
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
  // Extra rubble buildings outer ring. Three south-urban entries
  // ([3,90], [15,91], [25,92]) were removed — they intersected the
  // existing hollow buildings + roof towers (16,86) / (28,86) / (43,85)
  // / (60,86), creating "solid box jutting through hollow shell" visual
  // glitches.
]

// WALL_DEFS — formerly used by the minimap draw loop. Now superseded by
// ALL_AABBS sweeping (picks up dynamic walls / hollow buildings), but left
// here so any external reference (debug overlays etc.) keeps compiling.
const _WALL_DEFS: [number, number, number, number][] = MAP_OBJECTS.map(([x, z, w, d]) => [
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
// `h` is the top of the box; `y0` (default 0) is its bottom. Most walls sit on
// the ground (y0=0), but railings/parapets float up on a deck — giving them a
// real bottom lets a ground-level mover walk *underneath* them (e.g. into a
// tower's central elevator pad) while they still block anyone up on the deck.
// `disabled` is set when the Big Cockroach boss stomps a building flat. It's a
// per-game runtime flag (reset on each mount) — collision + bullet checks skip
// disabled walls so the rubble is walkable / shoot-through.
type WallAABB = {
  x1: number
  z1: number
  x2: number
  z2: number
  h: number
  y0?: number
  disabled?: boolean
}
const WALL_AABBS: WallAABB[] = MAP_OBJECTS.map(([x, z, w, d, type]) => ({
  x1: x,
  z1: z,
  x2: x + w,
  z2: z + d,
  h: wallHeightFor(type, w, d),
}))
const ALL_AABBS: WallAABB[] = WALL_AABBS

// Height-aware AABB sweep. `feetY` is the mover's foot altitude (default 0 =
// ground). A wall only blocks if its top rises more than a step above the
// feet — so a player standing ON a rooftop (feetY ≈ roof Y) is no longer
// blocked by the building's own footprint and can walk across it. Ground
// movers (enemies, spawn search) pass feetY=0 and, since every wall here is
// ≥0.6m tall (> STEP_UP_MAX), behave exactly as the old 2D check did.
function collidesWithWall(px: number, pz: number, radius: number, feetY = 0): boolean {
  if (
    px - radius < WORLD_MIN ||
    px + radius > WORLD_MAX ||
    pz - radius < WORLD_MIN ||
    pz + radius > WORLD_MAX
  )
    return true
  for (const w of ALL_AABBS) {
    if (w.disabled) continue
    if (
      px + radius > w.x1 &&
      px - radius < w.x2 &&
      pz + radius > w.z1 &&
      pz - radius < w.z2 &&
      w.h > feetY + STEP_UP_MAX &&
      (w.y0 ?? 0) <= feetY + STEP_UP_MAX
    )
      return true
  }
  return false
}

// True if a point is inside *any* wall's 3D AABB. Used for bullet-vs-wall:
// y is checked so a barricade doesn't stop a shot flying over it at eye height.
function pointInsideWall(px: number, py: number, pz: number): boolean {
  for (const w of ALL_AABBS) {
    if (w.disabled) continue
    if (px > w.x1 && px < w.x2 && pz > w.z1 && pz < w.z2 && py >= (w.y0 ?? 0) && py <= w.h)
      return true
  }
  return false
}

// ══ Big Cockroach final boss (invasion Wave-5 boss) — PR-B1 ══════════════════
// A Godzilla-scale roach (~60m long, ~25m tall) built from primitives. One
// instance only, so per-boss materials are fine (still shared across its own
// parts). Forward = -z (same convention as vehicles/enemies).
const BOSS_HP = 50000
const BOSS_SPEED = 3 // advance m/s (×1.5 in rage)
const BOSS_STOMP_RANGE = 30 // player within this → can stomp
const BOSS_STOMP_AOE = 12 // stomp blast radius (player + buildings)
const BOSS_STOMP_DMG = 80
const BOSS_BEAM_SECONDS = 5
const BOSS_BEAM_DPS = 20
const BOSS_POOL_RADIUS = 6 // poison pool radius
const BOSS_POOL_DPS = 10
const BOSS_POOL_LIFE = 10 // seconds the pool lingers
const BOSS_SPAWN_COUNT = 8 // small roaches per SPAWN
const BOSS_SMALL_MAX = 16 // cap of small roaches on the field
const BOSS_SMALL_SCORE = 5
const BOSS_KILL_SCORE = 5000
const BOSS_RAGE_FRACTION = 0.5 // HP fraction that triggers rage
const BOSS_EYE_HIT_RADIUS = 7 // weak-point sphere radius around the eyes (2× dmg)
// The 60m body approximated as three circles (head / thorax / abdomen) along the
// local forward (-z) axis — `lz` = local z offset, `r` = horizontal radius. Used
// for AOE + AA hit tests so explosions near the head or tail still connect.
const BOSS_HIT_PARTS: { lz: number; r: number }[] = [
  { lz: -20, r: 9 }, // head (front)
  { lz: -6, r: 12 }, // thorax
  { lz: 16, r: 16 }, // abdomen (rear)
]

interface BigBoss {
  group: THREE.Group
  x: number
  z: number
  heading: number // yaw; forward = (-sin, -cos)
  hp: number
  state: "intro" | "advance" | "stomp" | "beam" | "spawn"
  stateUntil: number // ms timestamp the current state ends
  nextDecisionAt: number
  rage: boolean
  walkPhase: number
  dyingStage: number // >0 once defeated: counts the explosion chain
  dyingNextAt: number
  introY: number // current drop-in height during the intro
  legs: THREE.Object3D[]
  antennae: THREE.Object3D[]
  eyeMat: THREE.MeshStandardMaterial
  wingL: THREE.Object3D
  wingR: THREE.Object3D
  headGroup: THREE.Object3D
  beam: THREE.Mesh
  // Transient attack state.
  stompDone: boolean // stomp impact already applied this STOMP
  spawnDone: boolean // roaches already released this SPAWN
  beamTargetX: number // slowly-tracking beam aim point
  beamTargetZ: number
  poolDropAt: number // ms timestamp for the next beam poison pool
  wingOpen: number // 0..1 elytra open amount
}

// Build the boss mesh hierarchy. Returns the group + the handles the AI needs
// to animate (legs/antennae) and the shared emissive eye material (weak point /
// rage glow). The beam cylinder is created by the caller (lives in the scene,
// oriented per-frame).
function makeBigCockroach(): {
  group: THREE.Group
  legs: THREE.Object3D[]
  antennae: THREE.Object3D[]
  eyeMat: THREE.MeshStandardMaterial
  wingL: THREE.Object3D
  wingR: THREE.Object3D
  headGroup: THREE.Group
} {
  const group = new THREE.Group()
  const chitinMat = new THREE.MeshStandardMaterial({
    color: 0x3a2418,
    roughness: 0.3,
    metalness: 0.55,
  })
  const legMat = new THREE.MeshStandardMaterial({
    color: 0x2a1810,
    roughness: 0.4,
    metalness: 0.5,
  })
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0xff2200,
    emissive: 0xff1500,
    emissiveIntensity: 2.0,
  })
  const sphere = new THREE.SphereGeometry(1, 18, 14)
  const BODY_Y = 14 // body centre height (legs lift it off the ground)
  // Abdomen (big rear ellipsoid).
  const abdomen = new THREE.Mesh(sphere, chitinMat)
  abdomen.scale.set(15, 9, 26)
  abdomen.position.set(0, BODY_Y, 16)
  abdomen.castShadow = true
  group.add(abdomen)
  // Thorax (mid).
  const thorax = new THREE.Mesh(sphere, chitinMat)
  thorax.scale.set(12, 8, 11)
  thorax.position.set(0, BODY_Y, -6)
  thorax.castShadow = true
  group.add(thorax)
  // Head group (front, -z) carrying eyes + mandibles + beam origin.
  const headGroup = new THREE.Group()
  headGroup.position.set(0, BODY_Y - 1, -20)
  group.add(headGroup)
  const head = new THREE.Mesh(sphere, chitinMat)
  head.scale.set(9, 7, 8)
  head.castShadow = true
  headGroup.add(head)
  // Two glowing compound eyes (the weak point).
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(sphere, eyeMat)
    eye.scale.set(2.6, 3.2, 2.2)
    eye.position.set(sx * 5, 1.5, -5)
    headGroup.add(eye)
  }
  // Mandibles (two angled cones at the mouth).
  for (const sx of [-1, 1]) {
    const mand = new THREE.Mesh(new THREE.ConeGeometry(1.2, 6, 8), legMat)
    mand.position.set(sx * 2.5, -3, -8)
    mand.rotation.set(-1.4, 0, sx * 0.4)
    headGroup.add(mand)
  }
  // Antennae (long thin cylinders sweeping forward from the head; pivot groups
  // so the AI can sway them).
  const antennae: THREE.Object3D[] = []
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group()
    pivot.position.set(sx * 3, 4, -7)
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.15, 26, 6), legMat)
    ant.position.set(sx * 3, 6, -10)
    ant.rotation.set(-1.1, 0, sx * 0.3)
    pivot.add(ant)
    headGroup.add(pivot)
    antennae.push(pivot)
  }
  // Six legs (3 per side). Each is a pivot group at the body; an upper + lower
  // segment reach out and down to a foot near the ground. Pivot.rotation.x
  // swings the leg for the walk cycle.
  const legs: THREE.Object3D[] = []
  const legZ = [-8, 2, 14]
  for (const side of [-1, 1]) {
    for (const lz of legZ) {
      const pivot = new THREE.Group()
      pivot.position.set(side * 11, BODY_Y - 1, lz)
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.8, 14, 7), legMat)
      // angle the upper segment out + down
      upper.position.set(side * 5, -3, 0)
      upper.rotation.z = side * 1.0
      pivot.add(upper)
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.4, 14, 7), legMat)
      lower.position.set(side * 9, -10, 0)
      lower.rotation.z = side * 0.3
      lower.castShadow = true
      pivot.add(lower)
      group.add(pivot)
      legs.push(pivot)
    }
  }
  // Wing covers (elytra) on top of the abdomen — two flattened shells with an
  // inner-edge pivot so they hinge open during the SPAWN attack.
  const makeWing = (side: number) => {
    const pivot = new THREE.Group()
    pivot.position.set(0, BODY_Y + 8, 16)
    const shell = new THREE.Mesh(sphere, chitinMat)
    shell.scale.set(7, 2, 22)
    shell.position.set(side * 7, 0, 0)
    shell.castShadow = true
    pivot.add(shell)
    group.add(pivot)
    return pivot
  }
  const wingL = makeWing(-1)
  const wingR = makeWing(1)
  return { group, legs, antennae, eyeMat, wingL, wingR, headGroup }
}

// True if a torso-height wall sits between two ground points. Sampled at
// y=1.0 so it ignores low cover (sandbags / pipes ≤ ~0.85) but blocks on real
// walls and buildings. Used to stop enemy melee from reaching through walls.
function wallBetween(x1: number, z1: number, x2: number, z2: number): boolean {
  const dx = x2 - x1
  const dz = z2 - z1
  const dist = Math.hypot(dx, dz)
  if (dist < 0.001) return false
  const steps = Math.max(2, Math.ceil(dist / 0.4))
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    if (pointInsideWall(x1 + dx * t, 1.0, z1 + dz * t)) return true
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
        nx > WORLD_MIN + radius &&
        nx < WORLD_MAX - radius &&
        nz > WORLD_MIN + radius &&
        nz < WORLD_MAX - radius &&
        !collidesWithWall(nx, nz, radius)
      ) {
        return { x: nx, z: nz }
      }
    }
  }
  // Fallback: world center (= city center, always clear in our layouts).
  return { x: WORLD_CENTER, z: WORLD_CENTER }
}

// ── Enemy type system ──────────────────────────────────────────────────────────
type EnemyType = "grunt" | "sniper" | "heavy" | "zombie" | "terraformer"
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
  // ── Zombie (ZOMBIE mode only) ──────────────────────────────────────────────
  // Unarmed, super-agile melee chaser. fireRange 0 → never shoots (the AI
  // ranged-fire blocks gate on distToPlayer <= fireRange). Huge sightRange +
  // 360° FOV → always homes on the player (LOS isn't wall-checked, matching
  // the "always takes the shortest path" spec). The actual per-zombie move
  // speed is overridden per wave in spawnZombieWave (this base is a fallback).
  zombie: {
    hp: 40,
    speed: 9.0,
    attackDamage: 12,
    attackInterval: 1100,
    attackRange: 1.9,
    fireRange: 0,
    fireInterval: 999999,
    fireDamage: 0,
    color: 0x9fb4c8, // pale, sickly blue-white
    emissive: 0x1c2838,
    bodyW: 0.52,
    bodyH: 1.8,
    sightRange: 200,
    fovAngle: Math.PI * 2,
    score: 120,
    blockReward: 1,
  },
  // ── Terraformer (INVASION mode) ────────────────────────────────────────────
  // A towering, armoured roach-humanoid. Brutal melee bruiser — no ranged, very
  // high HP, fast, hits like a truck. Relentless (huge sight + 360° FOV).
  terraformer: {
    hp: 600,
    speed: 6.0,
    attackDamage: 34,
    attackInterval: 950,
    attackRange: 2.5,
    fireRange: 0,
    fireInterval: 999999,
    fireDamage: 0,
    color: 0x241f1b, // dark chitin
    emissive: 0x140707,
    bodyW: 0.85,
    bodyH: 2.4,
    sightRange: 220,
    fovAngle: Math.PI * 2,
    score: 700,
    blockReward: 8,
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
  // Interior spawn points — pick the geometric centers of a handful of
  // hollow buildings so a fraction of bots spawn *inside* and the player
  // has to "clear rooms" instead of just battling on the street. Position
  // values match the BATTLE_CITY / INDUSTRIAL_HOLLOW layouts above.
  { x: 16, z: 37 }, // BATTLE N1 interior
  { x: 51, z: 37 }, // BATTLE N3 interior
  { x: 17, z: 63 }, // BATTLE S1 interior
  { x: 53, z: 63 }, // BATTLE S3 interior
  { x: 80, z: 51 }, // Avenue terminus interior
  { x: 38, z: 9 }, // Industrial north-row interior
  { x: 38, z: 75 }, // Industrial south-row interior
  // Mansion interiors (ground floor) — 2 each so bots "occupy" the buildings
  // and the player clears rooms before heading upstairs. Match makeMansion
  // footprints: A (70,7) / B (0.5,59) / C (0.5,31).
  { x: 74, z: 11 }, // Mansion A
  { x: 76, z: 15 }, // Mansion A
  { x: 3, z: 64 }, // Mansion B
  { x: 5, z: 68 }, // Mansion B
  { x: 3, z: 35 }, // Mansion C
  { x: 5, z: 40 }, // Mansion C
  // ── Open-world district spawns (PR-B) ──────────────────────────────────
  // HARBOR (south): in the open apron between the container yards and
  // warehouses (on land, north of the waterline at z≈265). Kept clear of
  // building footprints so a spawn never lands sealed inside a shed.
  { x: 30, z: 178 }, // HARBOR container yard (west)
  { x: 66, z: 180 }, // HARBOR container yard (east)
  { x: 50, z: 212 }, // HARBOR central apron
  { x: 60, z: 248 }, // HARBOR warehouse row
  // INDUSTRIAL (north): in the yards beside the factory halls / tank farm.
  { x: 26, z: -136 }, // INDUSTRIAL west hall (south face)
  { x: 76, z: -142 }, // INDUSTRIAL east hall (south face)
  { x: 50, z: -185 }, // INDUSTRIAL central yard
  { x: 18, z: -202 }, // INDUSTRIAL south yard
]

// ── Battle-city building layout ────────────────────────────────────────────────
// Replaces the 23 solid urban boxes deleted from MAP_OBJECTS. A central
// east–west avenue runs through z ≈ 44–58; buildings flank it on the
// north side (z < 44) and south side (z > 58), so running east from the
// west-edge spawn always leads past explorable interiors.
//   doorSide is *outward-facing* toward the avenue.
//   bldKind chooses material at render time (concrete vs industrial).
interface BattleCityBuilding {
  x: number
  z: number
  w: number
  d: number
  h?: number
  doorSide: "north" | "south" | "east" | "west"
  bldKind: "concrete" | "industrial"
}
const BATTLE_CITY_BUILDINGS: BattleCityBuilding[] = [
  // North flank — buildings ride right against the avenue (z2 reaches
  // ≈44) so they read as the *wall* of the street, not distant scenery.
  // Doors face +z (south) so the player sees them while walking down
  // the avenue. The first building is intentionally close to spawn so
  // it's visible the instant the camera unlocks.
  { x: 10, z: 32, w: 12, d: 11, h: 4.5, doorSide: "south", bldKind: "concrete" },
  { x: 26, z: 30, w: 14, d: 13, h: 5.5, doorSide: "south", bldKind: "concrete" },
  { x: 44, z: 32, w: 14, d: 11, h: 5.0, doorSide: "south", bldKind: "industrial" },
  { x: 62, z: 30, w: 14, d: 13, h: 4.5, doorSide: "south", bldKind: "concrete" },
  // South flank — mirror image; doors face -z (north toward the avenue).
  { x: 10, z: 57, w: 12, d: 12, h: 4.5, doorSide: "north", bldKind: "concrete" },
  { x: 26, z: 57, w: 14, d: 13, h: 5.0, doorSide: "north", bldKind: "concrete" },
  { x: 46, z: 57, w: 14, d: 13, h: 5.5, doorSide: "north", bldKind: "industrial" },
  { x: 64, z: 57, w: 14, d: 13, h: 4.5, doorSide: "north", bldKind: "concrete" },
  // ── Avenue terminus ─────────────────────────────────────────────────
  // A 9th building positioned across the east end of the avenue with a
  // door on the *west* face. Walking straight east from spawn now ends
  // at a clearly visible building — no more "endless empty road".
  // Sized + positioned to clear the outdoor-zone perimeter ruin at x≈91.
  { x: 74, z: 45, w: 12, d: 12, h: 5.5, doorSide: "west", bldKind: "industrial" },
]

// ── Industrial zone hollow buildings ───────────────────────────────────────
// The six warehouses that used to live in MAP_OBJECTS as solid boxes. Moved
// here so they go through makeHollowBuilding (door + interior + ENTER decal
// + AABB + minimap entry). Positions match the original layout — the player
// still finds factories where they always were, but can now go inside.
//   - North row (z=5–28): doors face south, toward the avenue.
//   - South row (z=71–79): doors face north, toward the avenue.
const INDUSTRIAL_HOLLOW_BUILDINGS: BattleCityBuilding[] = [
  { x: 33, z: 5, w: 10, d: 9, h: 5.5, doorSide: "south", bldKind: "industrial" },
  { x: 47, z: 5, w: 12, d: 8, h: 5.0, doorSide: "south", bldKind: "industrial" },
  { x: 33, z: 18, w: 9, d: 10, h: 5.0, doorSide: "south", bldKind: "industrial" },
  { x: 46, z: 18, w: 11, d: 9, h: 5.5, doorSide: "south", bldKind: "industrial" },
  { x: 33, z: 71, w: 9, d: 8, h: 5.0, doorSide: "north", bldKind: "industrial" },
  { x: 46, z: 72, w: 11, d: 7, h: 5.5, doorSide: "north", bldKind: "industrial" },
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

// PR boss-designs: per-frame animation handles for the dedicated HUNT boss
// shapes. Only the fields relevant to a given boss kind are populated.
interface HuntBossParts {
  kind: "multihead_boss" | "splitskin_boss" | "amalgam_boss"
  eyeballs: THREE.Object3D[] // multihead: pulsating eyeballs
  body?: THREE.Object3D // splitskin: torso (breathing scale.y)
  faceMats: THREE.MeshLambertMaterial[] // splitskin: inner-face emissive flicker
  faceEyeMats: THREE.MeshLambertMaterial[] // splitskin/amalgam: red eyes (rage glow)
  armFaces: THREE.Object3D[] // splitskin: arm-tip faces tracking the player
  core?: THREE.Object3D // amalgam: central blob (scale pulse)
  coreMat?: THREE.MeshLambertMaterial // amalgam: core colour (rage shift)
  arms: THREE.Object3D[] // amalgam: tendril arms (vertical bob)
  armBaseY: number[] // amalgam: rest Y per arm
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
  // Jaw mesh — animated into a gnashing chomp for zombies.
  jaw?: THREE.Object3D | null
  // Cached local-steering detour heading (zombie wall avoidance) + the time
  // it stays committed, so they don't jitter at corners. Optional / zombie-only.
  steerX?: number
  steerZ?: number
  steerUntil?: number
  // Per-bot/enemy shadow plane for ground projection (set in spawnEnemiesFromDef).
  shadowMesh?: THREE.Mesh | null
  // Meshes that should hide when far (eyes / mouth / pouches / ghillie strips).
  lodDetails?: THREE.Object3D[]
  // Eye meshes for blink scaling (subset of lodDetails). Optional.
  leftEye?: THREE.Mesh
  rightEye?: THREE.Mesh
  // ── Terraformer gross-out animation state (set only for terraformers) ──
  // Throbbing pustule meshes (parented to torso/head/arms) + a per-instance
  // phase so a crowd writhes out of sync. eyeGlowMat is the shared-per-enemy
  // eye material whose emissiveIntensity is pulsed for that dead-glow stare.
  pustules?: THREE.Mesh[]
  pulsePhase?: number
  twitchPhase?: number
  eyeGlowMat?: THREE.MeshStandardMaterial | undefined
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
  // True while this enemy is the AI driver of a vehicle — its normal on-foot
  // AI is skipped (the vehicle update drives it) and its mesh is hidden.
  aiDriving?: boolean
  // PR motorcycle: true while this terraformer is RIDING a bike (the bike's
  // updateBikeRiders drives it). Unlike aiDriving, the rider stays visible +
  // hittable — shoot it off and the bike goes driverless. The bike is found via
  // vehicles.find(v => v.riderEnemy === enemy).
  riding?: boolean
  // Bot fields (FFA/TDM): set only when this enemy is a bot player
  isBot?: boolean
  botName?: string
  botTeam?: "red" | "blue" | "ffa"
  botAccuracyMult?: number // 1.0 = stock; lower = worse aim spread
  botReactMult?: number // 1.0 = stock; higher = slower fire interval
  botRespawnMs?: number // ms between death and respawn
  nameSprite?: THREE.Sprite | null
  // HUNT mode: per-enemy score + label, and a boss flag (summon / AOE timers).
  huntPoints?: number
  huntName?: string
  isHuntBoss?: boolean
  huntNextSpecial?: number // ms timestamp for boss summon / AOE cadence
  // PR-Z3: when set, the humanoid mesh is hidden and a monster creature rides
  // the root instead. Handles used by updateHuntCreatures for the eerie idle.
  huntCreature?: {
    eyeMats: THREE.MeshStandardMaterial[]
    twitch: THREE.Object3D[]
    heads: THREE.Object3D[]
    phase: number
    nextJerk: number
    boss?: HuntBossParts // PR boss-designs: dedicated boss animation handles
  }

  // ── Aggressive-AI fields ────────────────────────────────────────────────
  // Until-when this enemy reacts to *external* stimulus (heard a shot or
  // saw a teammate die). Patrol uses this to abandon waypoints and move
  // toward the last noise; alert uses it to extend pursuit beyond LOS loss.
  alertedUntil: number
  // Sticky flank offset chosen when this enemy enters alert. -1/+1 picks a
  // side; magnitude (0–1) scales perpendicular offset to the bee-line path
  // so groups of enemies arc around the player instead of stacking.
  flankSide: -1 | 1
  flankStrength: number
  // Grunt sprint window: until-when the enemy moves at dash speed toward
  // the player. Re-armed via `nextDashCheckTime`.
  dashUntil: number
  nextDashCheckTime: number
  // Heavy grenade cooldown (timestamp when the next throw is allowed).
  nextGrenadeTime: number
  // Overhead "!" / "?" / null marker — alert sting / search marker. Hidden
  // when `markerUntil < now`. Sprite stays attached to the mesh group so it
  // moves with the enemy.
  markerSprite?: THREE.Sprite | null
  markerKind?: "alert" | "search" | null
  markerUntil: number
  // Timestamp (ms) until which a melee swing animation plays — set the moment
  // this enemy lands a close-range melee hit so the right arm visibly swings
  // (knife-style) instead of the static aim pose. 0 = no swing.
  meleeAnimUntil: number
  // Difficulty tuning the AI reads from. Bots: assigned from selected
  // difficulty in spawnBots. Mission enemies: left undefined (state machine
  // falls back to MISSION_AI_TUNING — currently the "normal" profile).
  aiTuning?: BotDifficultyTuning
  // ── Elevator-riding AI (PR-C) ───────────────────────────────────────────
  // Set when this enemy is using a tower elevator to chase the player onto a
  // rooftop. `mode` walks: approach (head to the base) → riding (lift up) →
  // roof (normal AI, pinned at deck altitude) → descending (lift back down).
  // `t` is the 0–1 lift progress; `zone` is the target ClimbZone.
  climb?: {
    mode: "approach" | "riding" | "roof" | "descending"
    zone: ClimbZone
    t: number
  } | null
  // Altitude (deck Y) this enemy fell from when shot off a rooftop, so the
  // death animation can drop the corpse to the ground. 0 = died at grade,
  // undefined = not yet captured for the current death.
  fallFromY?: number | undefined
}

interface Bullet {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  life: number
  isEnemy: boolean
  damage: number
  // Thrown enemy grenade — arcs under gravity and AOE-explodes on impact /
  // expiry. Plain bullets ignore this field.
  isGrenade?: boolean
  grenadeRadius?: number
  // True only for a heavy's hand-thrown anti-tank grenade. Gates the 3x
  // tank-damage multiplier so enemy *tank shells* (also explosive grenades)
  // don't inherit it.
  isAntiTankGrenade?: boolean
  // RPG rocket: homes on the target locked at launch (the nearest enemy of
  // ANY type inside the aim cone — jet, ground enemy, vehicle or AA gun),
  // ignores gravity, and AOE-explodes (hitting every enemy type) on proximity
  // / impact / fuse-expiry via detonateRocket.
  isRocket?: boolean
  // The rocket's locked homing target (resolved each frame to a live position;
  // null once it dies / despawns → the rocket flies straight on). Absent when
  // the launch found no enemy inside the aim cone.
  homingTarget?: HomingTarget | null
  // Smoke-trail bookkeeping for the rocket (seconds until next puff).
  trailT?: number
}

// A locked homing target for the RPG rocket. `pos()` returns the entity's
// current world position, or null once it's dead / gone (the rocket then flies
// straight). Abstracts over the four enemy kinds so one rocket can chase any.
interface HomingTarget {
  pos(): { x: number; y: number; z: number } | null
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

// ── Vertical-world geometry ────────────────────────────────────────────────────
// A horizontal walkable surface at altitude y. The ground is implicit
// (y = 0 everywhere); these are added on top for rooftops and any interior
// upper floors.
interface FloorAABB {
  x1: number
  z1: number
  x2: number
  z2: number
  y: number
}
// A ceiling: above-head obstruction the player can't pass through while
// rising vertically (rarely needed today but reserved so future jump/lift
// mechanics don't pop through interior roofs).
interface CeilingAABB {
  x1: number
  z1: number
  x2: number
  z2: number
  y: number
}
// E-key interactable lift. Entering the AABB on foot and pressing E
// teleports the player up to targetY (used for ladders / external stairs
// to a rooftop). A short cooldown stops accidental double-fires.
interface ClimbZone {
  x1: number
  z1: number
  x2: number
  z2: number
  targetY: number
  // Down-climb target — when the player is *on the elevated platform*
  // and presses E inside the zone, they descend back to this Y.
  downY?: number
  // Landing footprint. Climbing up snaps the player to (topX, topZ) so they
  // land *on* the roof (inside its floor bounds) instead of beside the tower
  // where there's no floor and they'd immediately fall. Climbing down snaps
  // to (baseX, baseZ): clear ground outside the footprint so they don't end
  // up embedded in the solid tower body.
  topX?: number
  topZ?: number
  baseX?: number
  baseZ?: number
  // Optional elevator car mesh — when present it rides up/down with the player
  // during a smooth (eased) lift instead of an instant teleport.
  car?: THREE.Mesh
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
  // Vertical-world: rooftops + interior floors + ladder/staircase lifts.
  // Module-level state lives here so the animate loop can sample without
  // capturing fresh closures every frame.
  floors: FloorAABB[]
  ceilings: CeilingAABB[]
  climbZones: ClimbZone[]
  // Door / ladder annotations — drawn on the minimap so the player can
  // navigate to interactable entries without hunting along walls.
  entries: { x: number; z: number; kind: "door" | "ladder" }[]
}

export type BotDifficulty = "easy" | "normal" | "hard"

interface BotDifficultyTuning {
  hpMult: number
  accuracyMult: number // <1 = sloppier aim
  reactMult: number // >1 = slower fire cadence
  damageMult: number
  sightMult: number
  respawnMs: number
  // Aggressive-AI knobs — read by the enemy state machine each tick.
  flankFactor: number // 0 = bee-line, 1 = full side-step toward flanks
  speedMult: number // baseline multiplier on enemy.config.speed
  dashEnabled: boolean // close-range grunts sprint at dash speed
  grenadeEnabled: boolean // heavies throw arc grenades
  groupTactics: boolean // pursue/share lastSeenPlayer with nearby allies
  noiseRange: number // m: how far a fired-shot noise alerts patrols
}

const BOT_DIFFICULTY_CONFIGS: Record<BotDifficulty, BotDifficultyTuning> = {
  // EASY is intentionally "old AI": no flank, no dash, no grenade, narrow
  // noise-radius. Players new to FPS still get a tactical pace.
  easy: {
    hpMult: 0.65,
    accuracyMult: 0.45,
    reactMult: 1.6,
    damageMult: 0.6,
    sightMult: 0.85,
    respawnMs: 5000,
    flankFactor: 0.2,
    speedMult: 0.9,
    dashEnabled: false,
    grenadeEnabled: false,
    groupTactics: false,
    noiseRange: 14,
  },
  // NORMAL is the full new AI: flanking, dashing grunts, grenade-tossing
  // heavies, allies share last-seen player position on hearing a shot or
  // a teammate die. Tuned more aggressive (NEXT_STEPS "敵がトロい" fix):
  // speedMult 1.0→1.15 (15% faster pursuit) and reactMult 1.0→0.8 (fires
  // ~20% sooner after spotting). EASY is intentionally left at the old,
  // slower values below so it still reads as a tutorial pace.
  normal: {
    hpMult: 1.0,
    accuracyMult: 1.0,
    reactMult: 0.8,
    damageMult: 1.0,
    sightMult: 1.0,
    respawnMs: 4000,
    flankFactor: 0.7,
    speedMult: 1.15,
    dashEnabled: true,
    grenadeEnabled: true,
    groupTactics: true,
    noiseRange: 24,
  },
  // HARD: tighter aim, faster reflexes, near-constant pressure.
  hard: {
    hpMult: 1.3,
    accuracyMult: 1.6,
    reactMult: 0.7,
    damageMult: 1.3,
    sightMult: 1.2,
    respawnMs: 3000,
    flankFactor: 1.0,
    speedMult: 1.2,
    dashEnabled: true,
    grenadeEnabled: true,
    groupTactics: true,
    noiseRange: 32,
  },
}

// Mission enemies (non-bot) don't carry a difficulty selector. They run on
// the "normal" aggressive profile so the FPS missions feel modern.
const MISSION_AI_TUNING: BotDifficultyTuning = BOT_DIFFICULTY_CONFIGS.normal

// Zombies (ZOMBIE mode) get a bespoke profile: no flank (they bee-line on
// the shortest path), no dash/grenade (they're already faster than the
// player and unarmed), no group radio. speedMult is 1.0 because the real
// chase speed is baked straight into each zombie's per-wave config.speed.
const ZOMBIE_AI_TUNING: BotDifficultyTuning = {
  hpMult: 1.0,
  accuracyMult: 1.0,
  reactMult: 1.0,
  damageMult: 1.0,
  sightMult: 1.0,
  respawnMs: 0,
  flankFactor: 0,
  speedMult: 1.0,
  dashEnabled: false,
  grenadeEnabled: false,
  groupTactics: false,
  noiseRange: 0,
}

// Terraformers (INVASION) share the zombie's relentless melee-chaser profile
// (bee-line + smart wall steering, no ranged/flank). Their speed/HP come from
// the per-instance config, not the tuning.
const TERRAFORMER_AI_TUNING: BotDifficultyTuning = ZOMBIE_AI_TUNING

// Melee chasers (zombies + terraformers) share the dedicated pursuit AI:
// wall-steering, encircle, lunge, last-seen search. Other types use the
// flank/cover soldier AI.
function isMeleeChaser(type: EnemyType): boolean {
  return type === "zombie" || type === "terraformer"
}

const BOT_NAMES = ["Bot_α", "Bot_β", "Bot_γ", "Bot_δ", "Bot_ε", "Bot_ζ", "Bot_η", "Bot_θ", "Bot_ι"]

export interface ThreeWorldProps {
  mode?: "wave_defense" | "ffa" | "tdm" | "zombie" | "invasion" | "hunt"
  mapId?: "urban" | "desert" | "snow" | "sky"
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
  // Low-pass filtered move-stick value — kills finger micro-jitter while
  // staying responsive. (Look is drag-driven on mobile and feeds the mouse
  // delta path directly, so it needs no separate smoothing ref here.)
  const joySmoothRef = useRef({ vx: 0, vy: 0 })
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
  // Vertical movement: ground-relative foot Y velocity in m/s. Positive =
  // rising (currently only via E-key climb), negative = falling. Sampled
  // each frame against the floor heightmap.
  const playerVelYRef = useRef(0)
  // Fall-damage tracking: the Y the player left the ground at when they became
  // airborne, and whether they were airborne last frame. Drop = startY −
  // landingY. Reset on elevator teleports so riding down deals no damage.
  const fallStartYRef = useRef(0)
  const wasAirborneRef = useRef(false)
  // ── Sensitivity / motion-sickness refs ───────────────────────────────
  // Multiplier applied to mouse / touch-drag look deltas inside the animate
  // loop. Mirrored from React state via a dedicated useEffect so the loop
  // never closes over stale state.
  const mouseSensRef = useRef(1.0)
  // Walk-bob feels great for some players, motion-sick others. Default
  // off (CLAUDE.md's stated tolerance) — toggleable in settings.
  const walkBobOnRef = useRef(false)
  // E-key climb request — set in keydown, consumed and cleared inside the
  // animate loop (so the climb only fires once per press, even if the key
  // remains held).
  const climbRequestRef = useRef(false)
  // Cooldown timestamp after a climb fires; blocks chaining a second climb
  // for half a second so you can't jitter up and down a ladder.
  const climbCooldownUntilRef = useRef(0)
  // Active smooth elevator ride. While set, the animate loop eases the player
  // (and the glass car) between fromY/toY instead of teleporting, and gravity
  // is suspended so the lift can't be fought by the fall code.
  const elevatorRideRef = useRef<{
    fromY: number
    toY: number
    x: number
    z: number
    startMs: number
    durMs: number
    car: THREE.Mesh | null
  } | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const usernameRef = useRef("Player")
  const remotePosRef = useRef<Record<string, RemotePlayer>>({})
  const msgIdRef = useRef(0)
  const minimapRef = useRef<HTMLCanvasElement>(null)
  // GTA-style district banner — tracks the player's current area so the
  // animate loop only fires the on-screen name when they cross a boundary.
  const areaRef = useRef<AreaId | null>(null)
  const areaKeyRef = useRef(0)
  const areaHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
  // 4-slot: pistol(∞) / shotgun(8) / sniper(5) / knife(∞). -1 = infinite.
  const weaponAmmoRef = useRef<[number, number, number, number, number]>([-1, 8, 5, -1, 0])
  // Knife: timestamp gate (anti re-input during swing) + active swing timer
  // (seconds remaining, drives the first-person swing animation).
  const lastMeleeRef = useRef(0)
  const knifeSwingRef = useRef(0)
  // Zombie mode wave controller state.
  const zombieWaveRef = useRef(0)
  const zombieActiveRef = useRef(false)
  // Invasion mode controller state (rocket strike → terraformer waves).
  const invasionWaveRef = useRef(0)
  const invasionActiveRef = useRef(false)
  const invasionNextStrikeRef = useRef(0) // ms timestamp for the next rocket
  // ── Big Cockroach boss (PR-B1) ──────────────────────────────────────────────
  const bigBossRef = useRef<BigBoss | null>(null)
  const bossPendingAtRef = useRef(0) // ms timestamp to spawn the boss (0 = none)
  const bossDoneRef = useRef(false) // boss defeated → no respawn
  const [bossActive, setBossActive] = useState(false) // drives the HUD HP bar
  const [bossHpPct, setBossHpPct] = useState(100)
  const [bossRageUi, setBossRageUi] = useState(false)
  const [bossDefeated, setBossDefeated] = useState(false) // victory overlay
  const [bossPoison, setBossPoison] = useState(false) // green poison vignette
  const bossPoisonRef = useRef(false)
  const bossPoisonHitAtRef = useRef(0) // ms timestamp of the last poison contact

  // ── HUNT mode controller (PR-Z1) ───────────────────────────────────────────
  // Sub-phase machine layered on top of the normal "playing" gamePhase.
  const huntPhaseRef = useRef<"room" | "countdown" | "warp" | "mission" | "scoring" | "dead">(
    "room",
  )
  // Compass arrow that points toward the transfer-room orb (room phase only).
  // Driven imperatively from the animate loop to avoid per-frame re-renders.
  const huntCompassRef = useRef<HTMLDivElement>(null)
  const [huntPhase, setHuntPhase] = useState<
    "room" | "countdown" | "warp" | "mission" | "scoring" | "dead"
  >("room")
  const huntLevelIdxRef = useRef(0) // index into HUNT_LEVELS (Lv3 repeats)
  const huntRepeatRef = useRef(0) // extra Lv3 loops → boss/zako HP +20% each
  const huntScoreRef = useRef(0) // this-mission score
  const [huntScore, setHuntScore] = useState(0)
  const huntTotalRef = useRef(0) // cumulative score (persisted)
  const [huntTotal, setHuntTotal] = useState(0)
  const huntQuotaRef = useRef(0) // minimum points required this mission (penalty)
  const [huntQuota, setHuntQuota] = useState(0)
  const huntDeadlineRef = useRef(0) // ms timestamp the mission times out (0 = none)
  const [huntTimeLeft, setHuntTimeLeft] = useState(0) // seconds, for the HUD
  const huntRadiusRef = useRef(HUNT_BASE_RADIUS)
  const [huntRadius, setHuntRadius] = useState(HUNT_BASE_RADIUS)
  const huntShrinkStartRef = useRef(0) // ms timestamp the Lv3 shrink began
  const huntOobSinceRef = useRef(0) // ms timestamp the player left the ring (0 = inside)
  const [huntOob, setHuntOob] = useState(false)
  const huntCountdownRef = useRef(0) // ms timestamp the 10s warp countdown ends
  const [huntCountdown, setHuntCountdown] = useState(0) // whole seconds shown on the orb
  const [huntWhiteFlash, setHuntWhiteFlash] = useState(false)
  const huntInputLockRef = useRef(false) // kanashibari: freeze input during warp
  const huntGreetingRef = useRef(0) // chosen greeting index
  const huntKillLogRef = useRef<Map<string, { name: string; points: number; count: number }>>(
    new Map(),
  )
  const [huntScoreList, setHuntScoreList] = useState<
    { name: string; points: number; count: number }[]
  >([])
  const huntScoringUntilRef = useRef(0) // ms timestamp the scoring screen ends
  const huntMissionReadyRef = useRef(false) // true once mission enemies are spawned
  // Room/orb 3D handles + animation state (built once on init).
  const huntRoomRef = useRef<{
    orb: THREE.Mesh
    canvas: HTMLCanvasElement
    ctx: CanvasRenderingContext2D
    texture: THREE.CanvasTexture
    leftHalf: THREE.Object3D
    rightHalf: THREE.Object3D
    suitcase: THREE.Object3D
    door: THREE.Object3D
    person: THREE.Object3D // seated silhouette revealed inside the open orb
    open: number // 0..1 orb/rack open progress
    page: number // current orb text page
    pageAt: number // ms timestamp to flip the page
    jingled: boolean
    banged: boolean // the dramatic "bang" open SFX/shake fired once
  } | null>(null)

  // ── HUNT equipment (PR-Z2) ──────────────────────────────────────────────────
  // Equipment menu (opened at the rack in the room).
  const huntNearRackRef = useRef(false)
  const [huntNearRack, setHuntNearRack] = useState(false)
  const [huntEquipOpen, setHuntEquipOpen] = useState(false)
  const huntEquipOpenRef = useRef(false)
  const huntInteractReqRef = useRef(false) // E / tap consumed by updateHunt
  // Chosen loadout (kept across warps; weapons are "owned" once grabbed).
  const huntSuitChosenRef = useRef(false)
  const [huntSuitChosen, setHuntSuitChosen] = useState(false)
  const huntOwnedRef = useRef<Set<HuntWeaponId>>(new Set())
  const [huntOwned, setHuntOwned] = useState<HuntWeaponId[]>([])
  // Active HUNT weapon (null → normal weapons) + per-weapon ammo + reload.
  const huntWeaponRef = useRef<HuntWeaponId | null>(null)
  const [huntWeapon, setHuntWeapon] = useState<HuntWeaponId | null>(null)
  const huntAmmoRef = useRef<Record<string, number>>({})
  const [huntAmmoUi, setHuntAmmoUi] = useState(0)
  const huntReloadingRef = useRef(false)
  const [huntReloadingUi, setHuntReloadingUi] = useState(false)
  // Suit durability runtime.
  const huntSuitDurRef = useRef(0)
  const [huntSuitDur, setHuntSuitDur] = useState(0)
  const huntSuitActiveRef = useRef(false) // chosen AND not broken this mission
  const [huntSuitActive, setHuntSuitActive] = useState(false)
  const [huntSuitFlash, setHuntSuitFlash] = useState(false)
  // Pulse-gun lock-on targets (≤3) + blade hold charge + punch request.
  const huntLockedRef = useRef<CombatEnemy[]>([])
  const [huntLockCount, setHuntLockCount] = useState(0)
  const huntBladeChargeRef = useRef(0)
  const huntPunchReqRef = useRef(false)
  const huntReloadReqRef = useRef(false)
  // 100-pt rewards (persisted): revive tickets, gravity-cannon unlock, clears.
  const huntTicketsRef = useRef(0)
  const [huntTickets, setHuntTickets] = useState(0)
  const huntGravityUnlockedRef = useRef(false)
  const [huntGravityUnlocked, setHuntGravityUnlocked] = useState(false)
  const huntClearsRef = useRef(0)
  const huntRewardOpenRef = useRef(false)
  const [huntRewardOpen, setHuntRewardOpen] = useState(false)
  const huntReleasedRef = useRef(false)
  const [huntReleased, setHuntReleased] = useState(false) // "released" ending overlay

  // ── HUNT equipment menu / reward handlers (component scope, stable via
  //    useCallback so both the JSX buttons and the key-event effect can use
  //    them; they only touch refs/state setters).
  const huntToggleSuitChoice = useCallback(() => {
    const v = !huntSuitChosenRef.current
    huntSuitChosenRef.current = v
    setHuntSuitChosen(v)
  }, [])
  const huntPickupWeapon = useCallback((id: HuntWeaponId) => {
    if (id === "gravitycannon" && !huntGravityUnlockedRef.current) return
    const next = new Set(huntOwnedRef.current)
    next.add(id)
    huntOwnedRef.current = next
    setHuntOwned([...next])
    const def = HUNT_WEAPON_BY_ID[id]
    if (def.mag >= 0) huntAmmoRef.current[id] = def.mag
    // Auto-equip what you just grabbed.
    huntWeaponRef.current = id
    setHuntWeapon(id)
    setHuntAmmoUi(def.mag)
  }, [])
  const huntSelectHuntWeapon = useCallback((id: HuntWeaponId) => {
    if (!huntOwnedRef.current.has(id)) return
    const def = HUNT_WEAPON_BY_ID[id]
    huntWeaponRef.current = id
    setHuntWeapon(id)
    if (def.mag >= 0 && huntAmmoRef.current[id] === undefined) huntAmmoRef.current[id] = def.mag
    setHuntAmmoUi(def.mag < 0 ? -1 : (huntAmmoRef.current[id] ?? def.mag))
  }, [])
  const huntClearHuntWeapon = useCallback(() => {
    huntWeaponRef.current = null
    setHuntWeapon(null)
  }, [])
  const huntChooseReward = useCallback((choice: 1 | 2 | 3) => {
    if (choice === 1) {
      huntClearsRef.current += 1
      try {
        localStorage.setItem(HUNT_CLEARS_KEY, String(huntClearsRef.current))
        localStorage.setItem(HUNT_TOTAL_KEY2, "0")
      } catch {
        /* ignore */
      }
      huntTotalRef.current = 0
      setHuntTotal(0)
      huntRewardOpenRef.current = false
      setHuntRewardOpen(false)
      huntReleasedRef.current = true
      setHuntReleased(true)
      SOUNDS.huntJingle()
      return
    }
    if (huntTotalRef.current < HUNT_REWARD_COST) return
    huntTotalRef.current -= HUNT_REWARD_COST
    setHuntTotal(huntTotalRef.current)
    try {
      localStorage.setItem(HUNT_TOTAL_KEY2, String(huntTotalRef.current))
    } catch {
      /* ignore */
    }
    if (choice === 2) {
      huntGravityUnlockedRef.current = true
      setHuntGravityUnlocked(true)
      try {
        localStorage.setItem(HUNT_GRAVITY_KEY, "1")
      } catch {
        /* ignore */
      }
    } else {
      huntTicketsRef.current = Math.min(HUNT_MAX_TICKETS, huntTicketsRef.current + 1)
      setHuntTickets(huntTicketsRef.current)
      try {
        localStorage.setItem(HUNT_TICKETS_KEY, String(huntTicketsRef.current))
      } catch {
        /* ignore */
      }
    }
    huntRewardOpenRef.current = false
    setHuntRewardOpen(false)
  }, [])

  // Phase 3: extended stat refs
  const maxKillstreakRef = useRef(0)
  const headshotsRef = useRef(0)
  const weaponKillsRef = useRef<Record<string, number>>({
    pistol: 0,
    shotgun: 0,
    sniper: 0,
    grenade: 0,
    knife: 0,
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
  // Tank main-cannon state. cannonModeRef = the cannon (vs handheld guns) is
  // the active weapon while in a tank; cooldown drives the HUD readiness.
  const cannonModeRef = useRef(false)
  const [cannonActive, setCannonActive] = useState(false)
  const lastCannonRef = useRef(0)
  const [cannonCooldownMs, setCannonCooldownMs] = useState(0)
  const prevCannonCdRef = useRef(0)
  // Timestamp until which the player's handheld fire is locked (set right
  // after dismounting a vehicle — see VEHICLE_EXIT_FIRE_LOCK_MS).
  const fireLockUntilRef = useRef(0)
  // Mirror of `playerHp` (the rendered React state). Animate loop uses this
  // to bail out of setPlayerHp calls while regen is ticking sub-integer.
  const prevDisplayHpRef = useRef(PLAYER_MAX_HP)
  // Most recent loud event from the player (gunshot, explosion). Patrolling
  // enemies within `noiseRange` of (x, z) drop their patrol and move toward
  // this point. `expires` is a Date.now() ms timestamp — past it = stale.
  const lastNoiseRef = useRef<{ x: number; z: number; expires: number } | null>(null)
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
  // Mobile: tap the minimap to toggle an enlarged view (PC has no tap-expand).
  const [mapExpanded, setMapExpanded] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [isLandscape, setIsLandscape] = useState(false)
  // True while the player is inside (or right next to) any ClimbZone — the
  // "[E] 登る" prompt at the bottom of the HUD watches this. State is
  // pushed from the animate loop via prevNearClimbRef so we only flip on
  // boundary changes, not every frame.
  const [nearClimb, setNearClimb] = useState(false)
  const prevNearClimbRef = useRef(false)
  // True when the player is in a ClimbZone *and already on the elevated
  // platform* — flips the climb prompt/button from "登る" (up) to "降りる"
  // (down). Pushed on boundary changes only, like nearClimb.
  const [climbAtTop, setClimbAtTop] = useState(false)
  const prevClimbAtTopRef = useRef(false)
  // ── Vehicle state ──────────────────────────────────────────────────────────
  // True while the player is driving a car (camera + WASD switch to driving).
  const drivingRef = useRef(false)
  // Kind of the vehicle currently driven (for input handlers in other effects
  // that can't see the scene-effect-local `activeVehicle`). null when on foot.
  const drivingKindRef = useRef<"car" | "tank" | "jet" | "bike" | null>(null)
  const [inVehicle, setInVehicle] = useState(false)
  // True while on foot next to a boardable car (shows the "乗る" prompt).
  const [nearVehicle, setNearVehicle] = useState(false)
  const prevNearVehicleRef = useRef(false)
  // Set by the E key / mobile board-exit button; consumed once in the loop.
  const vehicleActionRef = useRef(false)
  // ── PR-G1: mounted AA gun state ─────────────────────────────────────────────
  // True while the player is manning a fixed AA gun (movement locked, third-
  // person turret view, FIRE shoots AA shells at jets).
  const aaMountedRef = useRef(false)
  const [inAAGun, setInAAGun] = useState(false)
  // True while on foot next to a boardable AA gun (shows the mount prompt).
  const [nearAAGun, setNearAAGun] = useState(false)
  const prevNearAAGunRef = useRef(false)
  // Set by the E key / mobile mount-exit button; consumed once in the loop.
  const aaMountActionRef = useRef(false)
  // Manual ±30° barrel correction on top of the auto-track, driven by the
  // mouse / right look-stick while mounted. Radians, clamped to ±AA_MOUNT_MANUAL_AIM.
  const aaManualYawRef = useRef(0)
  const aaManualPitchRef = useRef(0)
  // Active vehicle HP (drives the HUD bar while driving). 0 when on foot.
  const [vehicleHp, setVehicleHp] = useState(0)
  const [vehicleMaxHp, setVehicleMaxHp] = useState(0)
  // True while the active vehicle is a tank (drives the cannon HUD + the
  // mobile weapon button's cannon⇄handheld toggle).
  const [inTank, setInTank] = useState(false)
  // True while the active vehicle is the fighter jet (drives the flight HUD).
  const [inJet, setInJet] = useState(false)
  const [jetSpeed, setJetSpeed] = useState(0) // km/h-ish readout
  const [jetAlt, setJetAlt] = useState(0) // altitude (m)
  const [missileCdMs, setMissileCdMs] = useState(0)
  // Jet input refs (mobile throttle buttons + missile request + held MG fire).
  const jetThrottleRef = useRef(0) // -1 / 0 / +1 from the mobile accel/decel pads
  const jetGunHeldRef = useRef(false) // mobile FIRE button held
  const jetMissileReqRef = useRef(false) // one-shot missile request (RMB / button)
  const lastJetGunRef = useRef(0)
  const lastMissileRef = useRef(0)
  const prevMissileCdRef = useRef(0)
  const prevJetSpeedRef = useRef(0)
  const prevJetAltRef = useRef(0)
  // Parachute ejection: phase machine + canopy mesh + eject request (Alt / btn).
  const parachutePhaseRef = useRef<"none" | "falling" | "chute">("none")
  const chuteOpenAtRef = useRef(0)
  const parachuteMeshRef = useRef<THREE.Group | null>(null)
  const ejectReqRef = useRef(false)
  const [parachuting, setParachuting] = useState(false)
  // Last time the player moved the aim (mouse/right-stick) while driving — the
  // chase camera auto-recenters behind the hull after a short idle.
  const lastDriveAimRef = useRef(0)
  // CRT scanlines: default off (was too distracting). F8 toggles, persisted
  // in localStorage so the choice survives refresh.
  const [scanlinesOn, setScanlinesOn] = useState(false)
  // ── Sensitivity (motion-sickness controls) ─────────────────────────────
  // mouseSens is a multiplier on top of the (now-lowered) base sensitivity,
  // applied to both mouse and mobile touch-drag look. Range 0.5–2.0 in the
  // settings UI. walkBobOn gates the head-bob effect. Persisted under "fps_*".
  const [mouseSens, setMouseSens] = useState(1.0)
  const [walkBobOn, setWalkBobOn] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState("")
  const chatEndRef = useRef<HTMLDivElement>(null)
  const [tagGame, setTagGame] = useState<TagGameInfo | null>(null)
  const [isPointerLocked, setIsPointerLocked] = useState(false)

  // Combat state
  const [playerHp, setPlayerHp] = useState(PLAYER_MAX_HP)
  const [ammo, setAmmo] = useState(-1) // -1 = infinite
  const [currentWeaponIdx, setCurrentWeaponIdx] = useState(0)
  // Knife is always available as the fallback melee — bundle it with the
  // starter pistol so it's usable regardless of stored unlock progression.
  const [unlockedWeapons, setUnlockedWeapons] = useState<Set<string>>(new Set(["pistol", "knife"]))
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
  // Fall-damage popup: the number shown center-screen on a hard landing
  // (null = hidden). `key` restarts the fade each landing.
  const [fallDmgPopup, setFallDmgPopup] = useState<{ dmg: number; key: number } | null>(null)
  const fallDmgKeyRef = useRef(0)
  const [killStreakMsg, setKillStreakMsg] = useState<string | null>(null)
  const [headshotMsg, setHeadshotMsg] = useState(false)
  // GTA-style district name banner. `key` re-triggers the fade animation each
  // time the player crosses into a new area; `visible` drives the fade out.
  const [areaBanner, setAreaBanner] = useState<{ id: AreaId; key: number } | null>(null)
  const [areaBannerVisible, setAreaBannerVisible] = useState(false)
  // Mission / wave state
  // SKY has no ground missions — skip the mission picker and drop straight in.
  const [showMissionSelect, setShowMissionSelect] = useState(
    mode === "wave_defense" && mapId !== "sky",
  )
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
        // Always keep pistol + knife available even if older saves omit them.
        setUnlockedWeapons(new Set([...list, "pistol", "knife"]))
      }
    } catch {
      /* ignore */
    }
    try {
      if (localStorage.getItem("fps_scanlines") === "1") setScanlinesOn(true)
    } catch {
      /* ignore */
    }
    // Sensitivity + walk-bob preferences. Stored as decimals (e.g. "1.25").
    try {
      const ms = Number.parseFloat(localStorage.getItem("fps_mouse_sens") ?? "")
      if (Number.isFinite(ms) && ms > 0.1 && ms < 3.5) setMouseSens(ms)
      if (localStorage.getItem("fps_walkbob") === "1") setWalkBobOn(true)
    } catch {
      /* ignore */
    }
    return () => {
      window.removeEventListener("resize", detectLandscape)
      window.removeEventListener("orientationchange", detectLandscape)
    }
  }, [])

  // Mirror sensitivity state into refs (animate loop reads refs).
  useEffect(() => {
    mouseSensRef.current = mouseSens
  }, [mouseSens])
  useEffect(() => {
    walkBobOnRef.current = walkBobOn
  }, [walkBobOn])
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
      // Clear any walls a previous session's Big Cockroach boss flattened —
      // ALL_AABBS is module-scoped, so the `disabled` flag would otherwise leak
      // into the next mount (walls/shots passing through phantom rubble).
      for (const w of ALL_AABBS) w.disabled = false
      // SKY: a dedicated aerial-combat arena — you fight enemy jets in a high,
      // bright sky over the existing world (which reads as the distant terrain).
      const isSky = mapId === "sky"
      const isHunt = modeRef.current === "hunt"
      // Phones/tablets: trim GPU + CPU cost aggressively (pixel ratio, no AA,
      // shorter draw distance, lighter fog, half-rate secondary AI, fewer
      // enemies/particles). UA-based so it's available synchronously at scene
      // setup (the `isMobile` React state isn't set until after mount). Distinct
      // from `isTouch` (maxTouchPoints) which still drives the existing particle
      // counts; this one gates the new mobile-perf paths.
      const isMobileDevice =
        typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
      // Halve sphere/cylinder tessellation on mobile (fewer verts per draw on
      // the many reused/instanced geometries). Floored to a sane minimum.
      // Gentle tessellation trim on mobile — 0.75× (not 0.5×), floored at 6, so
      // spheres stay round. Vehicles keep their full segment counts (they read
      // up close). Bigger perf wins live elsewhere (pixel ratio, shadows, AI).
      const sseg = (n: number) => (isMobileDevice ? Math.max(6, Math.round(n * 0.75)) : n)
      const theme = isHunt
        ? // HUNT: a dark night version of the urban map (also lights the room).
          { sky: 0x05060a, fog: 0x070810, ambient: 0x2a3550, sun: 0x3a4a78 }
        : modeRef.current === "invasion"
          ? // Invasion: an ominous blood-red sky regardless of map.
            { sky: 0x3a1812, fog: 0x33140e, ambient: 0xffcaa8, sun: 0xff7a4a }
          : isSky
            ? { sky: 0x4a9fe0, fog: 0xbfe0f5, ambient: 0xdfeeff, sun: 0xffffe8 }
            : mapId === "desert"
              ? { sky: 0xf0c887, fog: 0xe6c89a, ambient: 0xffe9c0, sun: 0xffd58a }
              : mapId === "snow"
                ? { sky: 0xdce8f0, fog: 0xeaf2f8, ambient: 0xeef5ff, sun: 0xffffff }
                : { sky: 0x87ceeb, fog: 0xc0d8f0, ambient: 0xd4e8ff, sun: 0xfff4cc }
      scene.background = new THREE.Color(theme.sky)
      // Snow gets a tighter fog band ("軽いフォグ" — slightly hazy whiteout
      // without crushing visibility); desert/urban keep the long open draw.
      // Fog distances stretched for the 6× larger open world so distant
      // areas (HARBOR / INDUSTRIAL) still fade out gracefully instead of
      // popping into view, while keeping the near band hazy on snow.
      // HUNT runs at night and the fog was crushing the (already dim) arena to
      // black — disable it entirely so visibility wins. Mobile pulls the fog
      // bands in by half so distant geometry fades sooner (fewer far draws).
      scene.fog = isHunt
        ? null
        : isSky
          ? // Push the haze far out so looking down from altitude doesn't wash
            // the ground into white — terrain should stay legible from up high.
            new THREE.Fog(theme.fog, isMobileDevice ? 450 : 900, isMobileDevice ? 1500 : 3000)
          : mapId === "snow"
            ? new THREE.Fog(theme.fog, isMobileDevice ? 40 : 80, isMobileDevice ? 210 : 420)
            : new THREE.Fog(theme.fog, isMobileDevice ? 70 : 140, isMobileDevice ? 340 : 680)

      // ── Per-map material palette ───────────────────────────────────────────
      // The collision footprints (ALL_AABBS / floors / climb zones) are shared
      // across all three maps — only the *look* of buildings + props changes
      // here so each battlefield reads as a distinct place. urban = grey
      // concrete city, desert = sand-coloured ruined base, snow = cold concrete
      // research station with snow-capped roofs. skyline picks the distant
      // backdrop silhouette (city blocks / sand dunes / mountains).
      const mapPalette =
        mapId === "desert"
          ? {
              concrete: 0xc2a474,
              concreteRoof: 0xb08f5a,
              industrial: 0xb8a276,
              industrialRoof: 0xa68c5c,
              barricade: 0xb09862,
              tank: 0x9a8a5a,
              pipe: 0xa89c7a,
              trench: 0xb6a06e,
              bag: 0xc4ad77,
              trunk: 0x9c7a4a,
              leaves: 0xb89a64,
              rubble: 0xc2a878,
              skyline: 0xc9ad7a,
              skylineStyle: "dunes" as const,
            }
          : mapId === "snow"
            ? {
                concrete: 0x9aa3ad,
                concreteRoof: 0xe8eef2,
                industrial: 0x8e98a2,
                industrialRoof: 0xdfe8ee,
                barricade: 0xc2ccd4,
                tank: 0x8a929a,
                pipe: 0xaab2ba,
                trench: 0xd6dee6,
                bag: 0xc8d2da,
                trunk: 0x6a7078,
                leaves: 0xeef4f8,
                rubble: 0xc8d0d6,
                skyline: 0xdfe8ef,
                skylineStyle: "mountains" as const,
              }
            : {
                concrete: 0x8a8878,
                concreteRoof: 0x7a7868,
                industrial: 0x787878,
                industrialRoof: 0x686868,
                barricade: 0x888870,
                tank: 0x6a7060,
                pipe: 0x888878,
                trench: 0x706050,
                bag: 0x9a8a6a,
                trunk: 0x6b4226,
                leaves: 0x2d5a1b,
                rubble: 0x7a7a6a,
                skyline: 0x202833,
                skylineStyle: "city" as const,
              }

      // ── Camera (FPS) ───────────────────────────────────────────────────────
      // FOV 80 (was 75): wider field reduces peripheral motion-shear when
      // the player whips around, a common motion-sickness trigger.
      // Far clip must exceed the fog's max distance for the open world or
      // distant geometry pops out before the fog hides it. Snow uses a tighter
      // fog band (max 420) so a 500 far is enough; other maps fog out at 680,
      // needing 800. Mirrors the per-map fog set below; read from mapId at
      // scene creation so a map switch (which remounts ThreeWorld) picks up the
      // matching clip.
      const camera = new THREE.PerspectiveCamera(
        80,
        container.clientWidth / container.clientHeight,
        0.1,
        // Mobile caps the far plane at 800 (never increases it) to shrink the
        // draw distance; desktop keeps the per-map values.
        isMobileDevice
          ? Math.min(800, isSky ? 2400 : mapId === "snow" ? 500 : 800)
          : isSky
            ? 2400
            : mapId === "snow"
              ? 500
              : 800,
      )
      camera.rotation.order = "YXZ"

      // ── Renderer ───────────────────────────────────────────────────────────
      const renderer = new THREE.WebGLRenderer({
        // Antialiasing is one of the biggest mobile GPU costs — drop it on
        // phones/tablets (the pixel-ratio cap already softens edges enough).
        antialias: !isMobileDevice,
        powerPreference: "high-performance",
        // SKY views the ground from hundreds of metres up with a far clip of
        // 2400 vs near 0.1 — that ratio crushes depth precision and makes
        // coplanar ground decals / building faces z-fight, which reads as a
        // rippling "wave" over the whole scene. A logarithmic depth buffer
        // restores precision across the huge range and removes the shimmer.
        logarithmicDepthBuffer: isSky,
      })
      renderer.setSize(container.clientWidth, container.clientHeight)
      // Cap at 1.75 instead of 2 — on retina the extra 14% pixels rarely
      // shows visually but costs ~30% GPU. Keeps perf room for shadows.
      // Mobile gets a tighter pixel-ratio cap — retina phones rendered at
      // ~2.5× pixel count of desktop while having a fraction of the GPU.
      const isTouch = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0
      renderer.setPixelRatio(
        // 1.0 was too soft (vehicles looked jagged); 1.5 restores legible detail
        // while still rendering ~2.25× fewer pixels than native retina. The
        // savings now come from shadows-off + shorter draw distance + half-rate
        // AI rather than from undersampling the whole frame.
        Math.min(window.devicePixelRatio, isTouch || isMobileDevice ? 1.5 : 2.0),
      )
      // Shadow maps are an expensive extra depth pass — off on mobile.
      renderer.shadowMap.enabled = !isMobileDevice
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
      // ACESFilmic + linear→sRGB output gives the "cinematic" desaturated
      // highlight rolloff that COD/Battlefield use; exposure < 1 keeps the
      // bright sky from blowing out against PBR-lit concrete.
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      // HUNT was rendering near-black — restore full exposure so its boosted
      // lights actually read; other modes keep the slightly-toned 0.95.
      renderer.toneMappingExposure = isHunt ? 1.0 : 0.95
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
      // HUNT runs at night but must stay legible: a brighter blue-white ambient
      // + a cool moonlight key keep enemies/terrain visible while preserving the
      // night mood (the transfer-room interior reads off the glowing orb too).
      scene.add(
        isHunt
          ? // HUNT: full-white ambient so the night arena stays clearly legible
            // (visibility is prioritised over mood — it was rendering black).
            new THREE.AmbientLight(0xffffff, 1.0)
          : new THREE.AmbientLight(theme.ambient, 0.45),
      )
      const hemi = new THREE.HemisphereLight(
        isHunt ? 0x556688 : theme.sky,
        0x4a4030,
        isHunt ? 0.45 : 0.55,
      )
      hemi.position.set(0, 50, 0)
      scene.add(hemi)
      // HUNT: a strong white key from high up so the arena is fully visible.
      const sun = new THREE.DirectionalLight(isHunt ? 0xffffff : theme.sun, isHunt ? 1.5 : 2.8)
      sun.position.set(isHunt ? 100 : 60, isHunt ? 200 : 80, isHunt ? 100 : 40)
      sun.castShadow = true
      // Shadow map 1024 (was 2048) — quarter the memory + sampling cost.
      // Soft PCF blur covers the precision loss on most viewing angles.
      sun.shadow.mapSize.set(1024, 1024)
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
      const fillLight = new THREE.DirectionalLight(0xb0c8ff, isHunt ? 0.3 : 0.45)
      fillLight.position.set(-40, 30, -20)
      scene.add(fillLight)

      // SKY arena: a layer of flat cloud quads at altitude for depth cues. One
      // shared geometry + material (low draw cost, no lights). Deterministic
      // scatter so the layer reads the same every match.
      if (isSky) {
        const cloudMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
          fog: true,
        })
        const cloudGeo = new THREE.PlaneGeometry(1, 1)
        for (let i = 0; i < 18; i++) {
          const cloud = new THREE.Mesh(cloudGeo, cloudMat)
          const ang = (i / 18) * Math.PI * 2
          const rad = 200 + ((i * 137) % 600)
          const s = 120 + ((i * 53) % 160)
          cloud.scale.set(s, s * 0.6, 1)
          cloud.rotation.x = -Math.PI / 2
          cloud.position.set(
            Math.cos(ang) * rad + 50,
            180 + ((i * 71) % 260),
            Math.sin(ang) * rad + 90,
          )
          cloud.renderOrder = -1
          scene.add(cloud)
        }
      }

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

      // ── Open-world base ground + area bands ────────────────────────────────
      // The city zone strips above only cover x/z 0–100. The rest of the 600×600
      // world is floored here: a single base plane, then two tinted bands for
      // the INDUSTRIAL (north) and HARBOR (south) districts so the player can
      // read which area they're in even before PR-B fills them with geometry.
      // Sits 2cm below the city zones to avoid z-fighting at the seams.
      const baseGroundColor = zoneTint(
        mapId === "snow" ? 0x9aa6ae : mapId === "desert" ? 0x8a7550 : 0x5a5e52,
      )
      const baseGround = new THREE.Mesh(
        new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
        new THREE.MeshStandardMaterial({
          color: baseGroundColor,
          map: groundNoise,
          roughness: 0.96,
          metalness: 0,
        }),
      )
      baseGround.rotation.x = -Math.PI / 2
      baseGround.position.set(WORLD_CENTER, -0.02, WORLD_CENTER)
      baseGround.receiveShadow = true
      scene.add(baseGround)

      // District bands — north (INDUSTRIAL, gritty concrete) and south
      // (HARBOR, cool dock grey with a hint of seawater). Each spans the full
      // world width and the band's depth, lifted a hair above the base plane.
      const districtBands: { z1: number; z2: number; color: number }[] = [
        { z1: WORLD_MIN, z2: AREA_NORTH_EDGE, color: zoneTint(0x4a4d54) }, // industrial
        { z1: AREA_SOUTH_EDGE, z2: WORLD_MAX, color: zoneTint(0x44525e) }, // harbor
      ]
      for (const band of districtBands) {
        const depth = band.z2 - band.z1
        const bandMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(WORLD_SIZE, depth),
          new THREE.MeshStandardMaterial({
            color: band.color,
            map: groundNoise,
            roughness: 0.95,
            metalness: 0.05,
          }),
        )
        bandMesh.rotation.x = -Math.PI / 2
        bandMesh.position.set(WORLD_CENTER, -0.012, (band.z1 + band.z2) / 2)
        bandMesh.receiveShadow = true
        scene.add(bandMesh)
      }

      // ── Road network (GTA-style arterials + sidewalks) ─────────────────────
      // Cosmetic only (no collision). Wide 4-lane asphalt strips run N–S and
      // E–W across the whole world, crossing at intersections; light-grey
      // sidewalks flank each road and dashed lane lines run down the middle.
      // The central E–W road at z=50 lines up with the existing city avenue;
      // the central N–S road at x=50 threads the city and links the districts.
      const ROAD_W = 12 // asphalt width (≈4 lanes)
      const SIDEWALK_W = 3
      const ROAD_Y = 0.004
      const SIDEWALK_Y = 0.006
      const LANE_Y = 0.01
      const V_ROADS = [WORLD_CENTER, -110, 210] // N–S road center X
      const H_ROADS = [WORLD_CENTER, -120, 200] // E–W road center Z
      const asphaltMat = new THREE.MeshStandardMaterial({
        color: 0x282b31,
        roughness: 0.95,
        metalness: 0,
      })
      const sidewalkMat = new THREE.MeshStandardMaterial({
        color: zoneTint(0x8c9095),
        roughness: 0.9,
        metalness: 0,
      })
      const laneMat = new THREE.MeshStandardMaterial({
        color: 0xd8cf52,
        emissive: 0x2a2600,
        roughness: 0.7,
        metalness: 0,
      })
      // Build one road strip (asphalt + two sidewalks + dashed centerline).
      // `axis` "v" = runs along Z at fixed X `c`; "h" = runs along X at fixed Z.
      const addRoadStrip = (axis: "v" | "h", c: number) => {
        const len = WORLD_SIZE
        const asphalt = new THREE.Mesh(
          axis === "v"
            ? new THREE.PlaneGeometry(ROAD_W, len)
            : new THREE.PlaneGeometry(len, ROAD_W),
          asphaltMat,
        )
        asphalt.rotation.x = -Math.PI / 2
        asphalt.position.set(
          axis === "v" ? c : WORLD_CENTER,
          ROAD_Y,
          axis === "v" ? WORLD_CENTER : c,
        )
        asphalt.receiveShadow = true
        scene.add(asphalt)
        // Sidewalks: a thin slab on each side of the asphalt.
        for (const side of [-1, 1]) {
          const off = side * (ROAD_W / 2 + SIDEWALK_W / 2)
          const sw = new THREE.Mesh(
            axis === "v"
              ? new THREE.PlaneGeometry(SIDEWALK_W, len)
              : new THREE.PlaneGeometry(len, SIDEWALK_W),
            sidewalkMat,
          )
          sw.rotation.x = -Math.PI / 2
          sw.position.set(
            axis === "v" ? c + off : WORLD_CENTER,
            SIDEWALK_Y,
            axis === "v" ? WORLD_CENTER : c + off,
          )
          sw.receiveShadow = true
          scene.add(sw)
        }
        // Dashed yellow centerline.
        const dash = 2.4
        const gap = 3.2
        for (let p = WORLD_MIN + 4; p < WORLD_MAX - 4; p += dash + gap) {
          const mark = new THREE.Mesh(
            axis === "v"
              ? new THREE.PlaneGeometry(0.32, dash)
              : new THREE.PlaneGeometry(dash, 0.32),
            laneMat,
          )
          mark.rotation.x = -Math.PI / 2
          mark.position.set(axis === "v" ? c : p, LANE_Y, axis === "v" ? p : c)
          scene.add(mark)
        }
      }
      for (const c of V_ROADS) addRoadStrip("v", c)
      for (const c of H_ROADS) addRoadStrip("h", c)

      // Invisible raycast floor spanning the whole world (was city-only). Floor
      // sampling for gravity uses the `floors` heightmap, so this stays purely
      // a safety net for any plane raycast in the open area.
      const groundGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE)
      const groundMat = new THREE.MeshBasicMaterial({ visible: false })
      const groundPlane = new THREE.Mesh(groundGeo, groundMat)
      groundPlane.rotation.x = -Math.PI / 2
      groundPlane.position.set(WORLD_CENTER, 0, WORLD_CENTER)
      scene.add(groundPlane)

      // ── War-zone buildings / obstacles ─────────────────────────────────────
      const wallMeshes: THREE.Mesh[] = []

      // Shared materials. Buildings use MeshStandardMaterial (PBR) with the
      // procedural noise as albedo so they read as weathered concrete/metal
      // under tone mapping. Roughness near 1 keeps the specular subtle.
      const concreteMat = new THREE.MeshStandardMaterial({
        color: mapPalette.concrete,
        map: concreteNoise,
        roughness: 0.92,
        metalness: 0,
      })
      const concreteRoofMat = new THREE.MeshStandardMaterial({
        color: mapPalette.concreteRoof,
        map: concreteNoise,
        // Snow-capped roofs read as snow (near-white, very rough/matte).
        roughness: mapId === "snow" ? 0.98 : 0.95,
        metalness: 0,
      })
      const industrialMat = new THREE.MeshStandardMaterial({
        color: mapPalette.industrial,
        map: industrialNoise,
        roughness: mapId === "desert" ? 0.85 : 0.7,
        metalness: mapId === "desert" ? 0.1 : 0.25,
      })
      const industrialRoofMat = new THREE.MeshStandardMaterial({
        color: mapPalette.industrialRoof,
        map: industrialNoise,
        roughness: mapId === "snow" ? 0.98 : 0.75,
        metalness: mapId === "snow" ? 0.05 : 0.25,
      })
      const windowMat = new THREE.MeshStandardMaterial({
        color: 0x1a2833,
        emissive: 0x050a10,
        roughness: 0.1,
        metalness: 0.6,
      })
      const barricadeMat = new THREE.MeshStandardMaterial({
        color: mapPalette.barricade,
        map: concreteNoise,
        roughness: 0.9,
        metalness: 0,
      })
      const tankMat = new THREE.MeshLambertMaterial({ color: mapPalette.tank })
      const pipeMat = new THREE.MeshLambertMaterial({ color: mapPalette.pipe })
      const trenchMat = new THREE.MeshLambertMaterial({ color: mapPalette.trench })
      const trunkMat = new THREE.MeshLambertMaterial({ color: mapPalette.trunk })
      const leavesMat = new THREE.MeshLambertMaterial({ color: mapPalette.leaves })
      // Desert: sand-camo wrecks. Snow: snow-dusted hulls. Urban: painted cars.
      const carColors =
        mapId === "desert"
          ? [0x9a8456, 0xa89868, 0x8c7a4e, 0xb0a070]
          : mapId === "snow"
            ? [0x7a828a, 0x8a929a, 0x9aa2aa, 0x6e767e]
            : [0x4a6a8a, 0x8a6a4a, 0x4a6a4a, 0x6a4a4a]

      for (const [ox, oz, ow, od, otype] of MAP_OBJECTS) {
        const cx = ox + ow / 2
        const cz = oz + od / 2
        const area = ow * od
        const isUrban = ox < 32
        const isIndustrial = ox >= 32 && ox < 66

        if (otype === 4) {
          // Outdoor-zone vegetation slot. Same footprint on every map, but the
          // prop changes: urban gets a leafy tree, desert a sandstone boulder
          // cluster, snow a snow-capped rock.
          if (mapId === "desert") {
            // Sandstone boulders — a couple of low angular rocks.
            const rockMat = new THREE.MeshLambertMaterial({ color: mapPalette.trunk })
            const r1 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 0), rockMat)
            r1.position.set(cx, 0.45, cz)
            r1.rotation.set(0.3, (ox + oz) % 3, 0.2)
            r1.castShadow = true
            scene.add(r1)
            const r2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45, 0), rockMat)
            r2.position.set(cx + 0.6, 0.3, cz - 0.4)
            r2.rotation.set(0.5, (oz % 3) + 1, 0.1)
            r2.castShadow = true
            scene.add(r2)
          } else if (mapId === "snow") {
            // Grey rock with a white snow cap.
            const rockMat = new THREE.MeshLambertMaterial({ color: mapPalette.trunk })
            const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.75, 0), rockMat)
            rock.position.set(cx, 0.5, cz)
            rock.rotation.set(0.25, (ox + oz) % 3, 0.15)
            rock.castShadow = true
            scene.add(rock)
            const cap = new THREE.Mesh(
              new THREE.SphereGeometry(0.6, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2),
              new THREE.MeshLambertMaterial({ color: mapPalette.leaves }),
            )
            cap.position.set(cx, 0.85, cz)
            scene.add(cap)
          } else {
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
          }
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
            color: mapPalette.bag,
            roughness: 0.95,
            metalness: 0,
          })
          for (let bi = 0; bi < 2; bi++) {
            const bag = new THREE.Mesh(bagGeo, bagMat)
            bag.position.set(cx, trenchH + 0.08 + bi * 0.17, cz)
            scene.add(bag)
          }
          continue
        }

        if (otype === 1) {
          // Wrecked-vehicle slot. The collision body is the same box on every
          // map (footprint + height unchanged); only the dressing differs:
          // urban = painted car, desert = abandoned sand-camo hull + oil drums,
          // snow = snow-buried wreck.
          const carColor = carColors[Math.floor((ox + oz) % carColors.length)] ?? 0x4a6a8a
          const carBodyMat = new THREE.MeshLambertMaterial({ color: carColor })
          const carH = 0.75
          const body = new THREE.Mesh(new THREE.BoxGeometry(ow, carH, od), carBodyMat)
          body.position.set(cx, carH / 2, cz)
          body.castShadow = true
          body.receiveShadow = true
          scene.add(body)
          wallMeshes.push(body)

          if (mapId === "desert") {
            // A pair of rusty oil drums standing in the wreck footprint.
            const drumMat = new THREE.MeshLambertMaterial({ color: 0x8a6a3a })
            const drumR = Math.min(ow, od) * 0.28
            for (const [dxo, dzo] of [
              [-0.25, -0.2],
              [0.25, 0.25],
            ] as [number, number][]) {
              const drum = new THREE.Mesh(
                new THREE.CylinderGeometry(drumR, drumR, 0.95, 10),
                drumMat,
              )
              drum.position.set(cx + dxo * ow, carH + 0.45, cz + dzo * od)
              drum.castShadow = true
              scene.add(drum)
            }
          } else if (mapId === "snow") {
            // Snow cap on the roof of the buried wreck.
            const snowCap = new THREE.Mesh(
              new THREE.BoxGeometry(ow * 1.04, 0.14, od * 1.04),
              new THREE.MeshLambertMaterial({ color: 0xeef4f8 }),
            )
            snowCap.position.set(cx, carH + 0.05, cz)
            scene.add(snowCap)
          } else {
            // Windshield — sits on the front face.
            const windshield = new THREE.Mesh(
              new THREE.BoxGeometry(ow * 0.6, 0.38, 0.05),
              windowMat,
            )
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
              const tire = new THREE.Mesh(
                new THREE.CylinderGeometry(tireR, tireR, 0.14, 8),
                tireMat,
              )
              tire.position.set(tx2, tireR, tz2)
              tire.rotation.z = Math.PI / 2
              scene.add(tire)
            }
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
          const rubbleMat2 = new THREE.MeshLambertMaterial({ color: mapPalette.rubble })
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

      // ── Vertical city: interiors + rooftops + props + signage ─────────────
      // Everything below extends the city beyond the flat-box MAP_OBJECTS:
      //   - 2 hollow buildings with doors + interior props + ceiling
      //   - 2 rooftop towers with ladder climb zones + parapets + roof props
      //   - street props (drums / pallets / trash / broken cars)
      //   - crosswalk markings
      //   - neon signage
      // All collision is appended to ALL_AABBS so collidesWithWall / bullet
      // checks just see them as regular walls. Floors + climb zones go into
      // the new dedicated arrays that the gravity loop samples each frame.
      const floors: FloorAABB[] = []
      const ceilings: CeilingAABB[] = []
      const climbZones: ClimbZone[] = []
      // Return the climb zone (with interaction pad) whose center is nearest to
      // (px, pz) among those the point is inside, or null. Used by both the [E]
      // prompt and the climb action so overlapping zones resolve consistently
      // to the closest one — and reused by the enemy elevator AI.
      const climbZoneAt = (px: number, pz: number): ClimbZone | null => {
        let best: ClimbZone | null = null
        let bestD = Number.POSITIVE_INFINITY
        for (const zone of climbZones) {
          if (
            px > zone.x1 - CLIMB_INTERACT_PAD &&
            px < zone.x2 + CLIMB_INTERACT_PAD &&
            pz > zone.z1 - CLIMB_INTERACT_PAD &&
            pz < zone.z2 + CLIMB_INTERACT_PAD
          ) {
            const cx = (zone.x1 + zone.x2) / 2
            const cz = (zone.z1 + zone.z2) / 2
            const d = (px - cx) ** 2 + (pz - cz) ** 2
            if (d < bestD) {
              bestD = d
              best = zone
            }
          }
        }
        return best
      }
      const entries: { x: number; z: number; kind: "door" | "ladder" }[] = []

      // Reusable "ENTER" sign sprite — drawn above hollow-building doors
      // and rebuilt per-call so we can vary text/color later if needed.
      // Always-on-top via depthTest:false so cover doesn't hide it.
      function makeEntrySign(label: string, color: string): THREE.Sprite {
        const canvas = document.createElement("canvas")
        canvas.width = 256
        canvas.height = 96
        const ctx = canvas.getContext("2d")
        if (ctx) {
          ctx.fillStyle = "rgba(0,0,0,0.7)"
          ctx.fillRect(0, 0, 256, 96)
          ctx.strokeStyle = color
          ctx.lineWidth = 4
          ctx.strokeRect(4, 4, 248, 88)
          ctx.font = "bold 52px monospace"
          ctx.textAlign = "center"
          ctx.textBaseline = "middle"
          ctx.lineWidth = 6
          ctx.strokeStyle = "rgba(0,0,0,0.9)"
          ctx.strokeText(label, 128, 50)
          ctx.fillStyle = color
          ctx.fillText(label, 128, 50)
        }
        const tex = new THREE.CanvasTexture(canvas)
        tex.needsUpdate = true
        const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })
        const sprite = new THREE.Sprite(mat)
        sprite.scale.set(2.4, 0.9, 1)
        sprite.renderOrder = 1050
        return sprite
      }

      // Pulsing yellow ground disc — placed under entries so the player
      // can spot them peripherally even without looking up at the sign.
      // We tag the mesh with userData.pulse so the animate loop can find
      // them by name and modulate their emissiveIntensity.
      function makeEntryDecal(x: number, z: number, color: number): THREE.Mesh {
        const mat = new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 1.0,
          roughness: 0.4,
          metalness: 0.1,
          transparent: true,
          opacity: 0.85,
        })
        const ring = new THREE.Mesh(new THREE.CircleGeometry(0.75, 24), mat)
        ring.rotation.x = -Math.PI / 2
        ring.position.set(x, 0.025, z)
        ring.userData.pulse = true
        scene.add(ring)
        return ring
      }
      const entryDecals: THREE.Mesh[] = []

      // Default ceiling height used for hollow buildings.
      const INTERIOR_H = 4.0
      const WALL_T = 0.3 // wall slab thickness

      // Build a single thin wall slab and register it for collision + raycast.
      function addWallSlab(
        cxw: number,
        cy: number,
        czw: number,
        sx: number,
        sy: number,
        sz: number,
        mat: THREE.Material,
      ) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat)
        m.position.set(cxw, cy, czw)
        m.castShadow = true
        m.receiveShadow = true
        scene.add(m)
        wallMeshes.push(m)
        ALL_AABBS.push({
          x1: cxw - sx / 2,
          x2: cxw + sx / 2,
          z1: czw - sz / 2,
          z2: czw + sz / 2,
          h: cy + sy / 2, // top of slab
          y0: cy - sy / 2, // bottom of slab — lets movers pass under elevated rails
        })
        return m
      }

      // Build a hollow building (4 perimeter walls with a door gap on one
      // side, plus ceiling). Interior props are added separately by caller.
      function makeHollowBuilding(opts: {
        x: number
        z: number
        w: number
        d: number
        h?: number
        doorSide: "north" | "south" | "east" | "west"
        doorWidth?: number
        bldMat: THREE.Material
        roofMat: THREE.Material
      }) {
        const { x, z, w, d, doorSide, bldMat, roofMat } = opts
        const h = opts.h ?? INTERIOR_H
        const doorW = opts.doorWidth ?? 2.0
        // West wall (low-x)
        if (doorSide === "west") {
          const gapStart = z + d / 2 - doorW / 2
          const gapEnd = z + d / 2 + doorW / 2
          // North half (z < gapStart)
          addWallSlab(x, h / 2, (z + gapStart) / 2, WALL_T, h, gapStart - z, bldMat)
          // South half (z > gapEnd)
          addWallSlab(x, h / 2, (gapEnd + (z + d)) / 2, WALL_T, h, z + d - gapEnd, bldMat)
        } else {
          addWallSlab(x, h / 2, z + d / 2, WALL_T, h, d, bldMat)
        }
        // East wall (high-x)
        if (doorSide === "east") {
          const gapStart = z + d / 2 - doorW / 2
          const gapEnd = z + d / 2 + doorW / 2
          addWallSlab(x + w, h / 2, (z + gapStart) / 2, WALL_T, h, gapStart - z, bldMat)
          addWallSlab(x + w, h / 2, (gapEnd + (z + d)) / 2, WALL_T, h, z + d - gapEnd, bldMat)
        } else {
          addWallSlab(x + w, h / 2, z + d / 2, WALL_T, h, d, bldMat)
        }
        // North wall (low-z)
        if (doorSide === "north") {
          const gapStart = x + w / 2 - doorW / 2
          const gapEnd = x + w / 2 + doorW / 2
          addWallSlab((x + gapStart) / 2, h / 2, z, gapStart - x, h, WALL_T, bldMat)
          addWallSlab((gapEnd + (x + w)) / 2, h / 2, z, x + w - gapEnd, h, WALL_T, bldMat)
        } else {
          addWallSlab(x + w / 2, h / 2, z, w, h, WALL_T, bldMat)
        }
        // South wall (high-z)
        if (doorSide === "south") {
          const gapStart = x + w / 2 - doorW / 2
          const gapEnd = x + w / 2 + doorW / 2
          addWallSlab((x + gapStart) / 2, h / 2, z + d, gapStart - x, h, WALL_T, bldMat)
          addWallSlab((gapEnd + (x + w)) / 2, h / 2, z + d, x + w - gapEnd, h, WALL_T, bldMat)
        } else {
          addWallSlab(x + w / 2, h / 2, z + d, w, h, WALL_T, bldMat)
        }
        // Roof / ceiling slab — interior visible from below, doubles as
        // potential rooftop walkable surface (we don't add it to floors[]
        // since these hollow buildings don't have roof access in this PR).
        const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.25, d + 0.3), roofMat)
        roof.position.set(x + w / 2, h + 0.12, z + d / 2)
        roof.castShadow = true
        roof.receiveShadow = true
        scene.add(roof)
        // Interior floor patch (slightly darker) so it reads as "inside".
        const floorMat = new THREE.MeshStandardMaterial({
          color: 0x554a3a,
          roughness: 0.95,
          metalness: 0,
        })
        const interiorFloor = new THREE.Mesh(
          new THREE.PlaneGeometry(w - WALL_T, d - WALL_T),
          floorMat,
        )
        interiorFloor.rotation.x = -Math.PI / 2
        interiorFloor.position.set(x + w / 2, 0.015, z + d / 2)
        interiorFloor.receiveShadow = true
        scene.add(interiorFloor)
        // ── Door cue: green ground decal in front of the gap. The
        // overhead "ENTER" sprite was dropped — the pulsing disc + the
        // visible door gap + the minimap arrow already make entries
        // findable, and the always-on-top sprite stack was visually busy
        // (every building had one floating). Kept the entry record so
        // the minimap icon still works.
        let doorX = x + w / 2
        let doorZ = z + d / 2
        const doorClearance = 0.6 // outside the wall plane
        if (doorSide === "north") doorZ = z - doorClearance
        else if (doorSide === "south") doorZ = z + d + doorClearance
        else if (doorSide === "west") doorX = x - doorClearance
        else doorX = x + w + doorClearance
        entryDecals.push(makeEntryDecal(doorX, doorZ, 0x44ff88))
        entries.push({ x: doorX, z: doorZ, kind: "door" })
      }

      // Place a prop crate / table / shelf with collision.
      function placeProp(opts: {
        x: number
        y: number
        z: number
        w: number
        h: number
        d: number
        color: number
        roughness?: number
        metalness?: number
        emissive?: number
      }) {
        const mat = new THREE.MeshStandardMaterial({
          color: opts.color,
          roughness: opts.roughness ?? 0.8,
          metalness: opts.metalness ?? 0.05,
          emissive: opts.emissive ?? 0x000000,
        })
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(opts.w, opts.h, opts.d), mat)
        mesh.position.set(opts.x, opts.y + opts.h / 2, opts.z)
        mesh.castShadow = true
        mesh.receiveShadow = true
        scene.add(mesh)
        wallMeshes.push(mesh)
        ALL_AABBS.push({
          x1: opts.x - opts.w / 2,
          x2: opts.x + opts.w / 2,
          z1: opts.z - opts.d / 2,
          z2: opts.z + opts.d / 2,
          h: opts.y + opts.h,
        })
      }

      // ── Shared building-enrichment + mansion materials / geometry ──────────
      // Created once and reused across every existing building AND the new
      // mansions so the GPU sees a handful of materials, not hundreds. No
      // point lights are added anywhere below — all "glow" is emissive only.
      // Dark glass with a faint warm internal glow: reads as an occupied,
      // lit apartment window (pops on the dark/snow skies, subtle in daylight).
      const litWindowMat = new THREE.MeshStandardMaterial({
        color: 0x6a5a2a,
        emissive: 0xffcc55,
        emissiveIntensity: mapId === "snow" ? 1.1 : 0.8,
        roughness: 0.25,
        metalness: 0.3,
      })
      // AC / rooftop-unit grey metal, and a darker concrete for interior floors.
      const acUnitMat = new THREE.MeshStandardMaterial({
        color: 0x6a6a6a,
        roughness: 0.45,
        metalness: 0.5,
      })
      const mansionFloorMat = new THREE.MeshStandardMaterial({
        color: 0x4a4438,
        roughness: 0.95,
        metalness: 0,
      })
      const stairMat = new THREE.MeshStandardMaterial({
        color: 0x6a6258,
        roughness: 0.9,
        metalness: 0,
      })
      const furnMatA = new THREE.MeshStandardMaterial({
        color: 0x6a4a26,
        roughness: 0.85,
        metalness: 0.05,
      })
      const furnMatB = new THREE.MeshStandardMaterial({
        color: 0x40444a,
        roughness: 0.7,
        metalness: 0.2,
      })
      const railMatM = new THREE.MeshStandardMaterial({
        color: 0x3a3a3e,
        roughness: 0.5,
        metalness: 0.7,
      })
      // Small palette of emissive shop-sign colours, shared across all signs.
      const signMats = [0xff4488, 0x44ffcc, 0xffcc44, 0x8844ff].map(
        (c) =>
          new THREE.MeshStandardMaterial({
            color: c,
            emissive: c,
            emissiveIntensity: 1.4,
            roughness: 0.4,
            metalness: 0.2,
          }),
      )
      // Shared window-pane geometries (same size for every pane → one buffer).
      const winGeoH = new THREE.BoxGeometry(1.0, 1.0, 0.08) // north / south faces
      const winGeoV = new THREE.BoxGeometry(0.08, 1.0, 1.0) // east / west faces

      // Lay a grid of windows over the requested faces of a footprint between
      // yStart and yTop. Visual only (no collision, no shadows). A deterministic
      // 1-in-litEvery panes use the warm emissive material so some "rooms" read
      // as lit at night without adding any lights.
      function addBuildingWindows(o: {
        x: number
        z: number
        w: number
        d: number
        yStart: number
        yTop: number
        faces: ("north" | "south" | "east" | "west")[]
        litEvery?: number
        litOffset?: number
      }) {
        const litEvery = o.litEvery ?? 3
        const paneH = 1.0
        const rows: number[] = []
        for (let yy = o.yStart; yy <= o.yTop - 0.6; yy += 1.8) rows.push(yy)
        let idx = o.litOffset ?? 0
        for (const face of o.faces) {
          const horizontal = face === "north" || face === "south"
          const len = horizontal ? o.w : o.d
          const cols = Math.max(1, Math.floor(len / 2.5))
          for (let c = 0; c < cols; c++) {
            const t = (c + 0.5) / cols
            for (const ry of rows) {
              const lit = idx++ % litEvery === 0
              const mat = lit ? litWindowMat : windowMat
              const mesh = new THREE.Mesh(horizontal ? winGeoH : winGeoV, mat)
              if (horizontal) {
                const pz = face === "north" ? o.z - 0.05 : o.z + o.d + 0.05
                mesh.position.set(o.x + t * o.w, ry + paneH / 2, pz)
              } else {
                const px = face === "west" ? o.x - 0.05 : o.x + o.w + 0.05
                mesh.position.set(px, ry + paneH / 2, o.z + t * o.d)
              }
              mesh.castShadow = false
              scene.add(mesh)
            }
          }
        }
      }

      // A rooftop water tank (cylinder) or AC vent (box), placed at the given
      // roof-top Y. Kept simple — these read fine from the street and add
      // city silhouette without any extra lights.
      function addRoofUnit(cx: number, topY: number, cz: number, kind: "tank" | "vent") {
        if (kind === "tank") {
          const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 1.4, 12), tankMat)
          tank.position.set(cx, topY + 0.7, cz)
          tank.castShadow = true
          scene.add(tank)
          // Four stubby legs so it reads as a raised water tank.
          for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
              const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), railMatM)
              leg.position.set(cx + sx * 0.5, topY + 0.25, cz + sz * 0.5)
              scene.add(leg)
            }
          }
        } else {
          const vent = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 1.0), acUnitMat)
          vent.position.set(cx, topY + 0.4, cz)
          vent.castShadow = true
          scene.add(vent)
        }
      }

      // An emissive shop-sign board mounted on a building face (urban only).
      function addShopSign(cx: number, y: number, cz: number, rotY: number, colorIdx: number) {
        const mat = signMats[colorIdx % signMats.length] ?? signMats[0]
        if (!mat) return
        const sign = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.7, 0.14), mat)
        sign.position.set(cx, y, cz)
        sign.rotation.y = rotY
        scene.add(sign)
      }

      // ── Battle city: hollow buildings flanking the central avenue ─────
      // Generated from the BATTLE_CITY_BUILDINGS module-level spec so the
      // layout is editable in one place. Each gets 2–3 interior cover
      // props placed deterministically (seeded by position) so the same
      // building always renders the same crates / desks.
      for (const b of BATTLE_CITY_BUILDINGS) {
        const matB = b.bldKind === "concrete" ? concreteMat : industrialMat
        const matR = b.bldKind === "concrete" ? concreteRoofMat : industrialRoofMat
        const h = b.h ?? 4.5
        makeHollowBuilding({
          x: b.x,
          z: b.z,
          w: b.w,
          d: b.d,
          h,
          doorSide: b.doorSide,
          doorWidth: 2.4,
          bldMat: matB,
          roofMat: matR,
        })
        // Interior cover — quantize position by a fixed seed so the inner
        // layout reads as "designed" rather than random.
        const seed = (b.x * 13 + b.z * 7) & 0xff
        const cx = b.x + b.w * 0.35
        const cz = b.z + b.d * 0.5
        placeProp({
          x: cx,
          y: 0,
          z: cz,
          w: 1.4,
          h: 1.0,
          d: 1.4,
          color: 0x6a4a26,
        })
        placeProp({
          x: b.x + b.w * 0.7,
          y: 0,
          z: b.z + b.d * (0.3 + ((seed >> 4) & 1) * 0.4),
          w: 2.0,
          h: 0.85,
          d: 1.0,
          color: 0x444444,
        })
        // A tall shelf only in larger buildings.
        if (b.w >= 14) {
          placeProp({
            x: b.x + b.w * 0.85,
            y: 0,
            z: b.z + b.d * 0.7,
            w: 1.0,
            h: 1.8,
            d: 0.4,
            color: 0x333333,
          })
        }
        // ── Enrichment: windows (lit subset), a rooftop unit, and an urban
        // shop sign so the avenue reads as a living city block. Windows skip
        // the door face so panes don't float in the doorway gap.
        const allFaces: ("north" | "south" | "east" | "west")[] = ["north", "south", "east", "west"]
        addBuildingWindows({
          x: b.x,
          z: b.z,
          w: b.w,
          d: b.d,
          yStart: 1.2,
          yTop: h,
          faces: allFaces.filter((f) => f !== b.doorSide),
          litOffset: seed & 3,
        })
        addRoofUnit(b.x + b.w * 0.3, h + 0.24, b.z + b.d * 0.3, (seed & 1) === 0 ? "tank" : "vent")
        if (mapId === "urban") {
          // Mount the sign just above the door, facing the avenue.
          const sx = b.x + b.w / 2
          const sz = b.z + b.d / 2
          if (b.doorSide === "south") addShopSign(sx, 3.0, b.z + b.d + 0.2, 0, seed & 3)
          else if (b.doorSide === "north") addShopSign(sx, 3.0, b.z - 0.2, 0, seed & 3)
          else if (b.doorSide === "west") addShopSign(b.x - 0.2, 3.0, sz, Math.PI / 2, seed & 3)
          else addShopSign(b.x + b.w + 0.2, 3.0, sz, Math.PI / 2, seed & 3)
        }
      }

      // ── Industrial-zone hollow buildings (formerly solid type-0 boxes) ─
      // Same generator path so they pick up ENTER decals, AABB walls with
      // door gaps, ceiling, etc. Slightly sparser interior (just a desk +
      // a crate) since these aren't the primary engagement zone.
      for (const b of INDUSTRIAL_HOLLOW_BUILDINGS) {
        const matB = industrialMat
        const matR = industrialRoofMat
        const h = b.h ?? 5.0
        makeHollowBuilding({
          x: b.x,
          z: b.z,
          w: b.w,
          d: b.d,
          h,
          doorSide: b.doorSide,
          doorWidth: 2.2,
          bldMat: matB,
          roofMat: matR,
        })
        placeProp({
          x: b.x + b.w * 0.4,
          y: 0,
          z: b.z + b.d * 0.5,
          w: 1.6,
          h: 0.9,
          d: 1.0,
          color: 0x4a4032,
        })
        placeProp({
          x: b.x + b.w * 0.75,
          y: 0,
          z: b.z + b.d * 0.4,
          w: 1.2,
          h: 1.1,
          d: 1.2,
          color: 0x5a4226,
        })
      }

      // Hollow building #1 — warehouse on south urban edge.
      {
        const x = 16
        const z = 86
        const w = 10
        const d = 8
        makeHollowBuilding({
          x,
          z,
          w,
          d,
          doorSide: "north",
          doorWidth: 2.0,
          bldMat: concreteMat,
          roofMat: concreteRoofMat,
        })
        // Interior props
        placeProp({ x: x + 2, y: 0, z: z + 2.5, w: 1.4, h: 1.0, d: 1.4, color: 0x6a4a26 })
        placeProp({ x: x + 2, y: 1.0, z: z + 2.5, w: 1.2, h: 0.9, d: 1.2, color: 0x5a3a1c })
        placeProp({ x: x + 7.5, y: 0, z: z + 5.5, w: 2.5, h: 0.85, d: 1.0, color: 0x444444 })
        placeProp({ x: x + 5, y: 0, z: z + 5.5, w: 1.0, h: 1.8, d: 0.4, color: 0x333333 })
      }

      // Hollow building #2 — office on industrial / outdoor border.
      {
        const x = 43
        const z = 85
        const w = 10
        const d = 8
        makeHollowBuilding({
          x,
          z,
          w,
          d,
          doorSide: "north",
          doorWidth: 1.8,
          bldMat: industrialMat,
          roofMat: industrialRoofMat,
        })
        placeProp({ x: x + 2, y: 0, z: z + 4, w: 2.0, h: 0.85, d: 1.0, color: 0x333333 })
        placeProp({ x: x + 7, y: 0, z: z + 6.5, w: 1.0, h: 1.7, d: 0.4, color: 0x222222 })
        placeProp({ x: x + 7, y: 0, z: z + 2.0, w: 1.0, h: 1.7, d: 0.4, color: 0x222222 })
      }

      // Build a roof-access tower: solid box you can't enter, with an
      // exterior ladder, a walkable roof, parapets, and one roof prop.
      // The ladder is purely cosmetic + a climb zone; pressing E inside the
      // zone teleports the player up (or back down).
      function makeRoofTower(opts: {
        x: number
        z: number
        w: number
        d: number
        h: number
        ladderSide: "north" | "south" | "east" | "west"
        bldMat: THREE.Material
        roofMat: THREE.Material
        roofProp?: "tank" | "vent"
      }) {
        const { x, z, w, d, h, ladderSide, bldMat, roofMat } = opts
        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bldMat)
        body.position.set(x + w / 2, h / 2, z + d / 2)
        body.castShadow = true
        body.receiveShadow = true
        scene.add(body)
        wallMeshes.push(body)
        ALL_AABBS.push({ x1: x, z1: z, x2: x + w, z2: z + d, h })
        // Roof slab (slightly larger than body)
        const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.25, d + 0.3), roofMat)
        roof.position.set(x + w / 2, h + 0.12, z + d / 2)
        roof.castShadow = true
        roof.receiveShadow = true
        scene.add(roof)
        // Walkable floor on top.
        floors.push({ x1: x, z1: z, x2: x + w, z2: z + d, y: h + 0.25 })
        // Parapets (low walls on each edge) — 0.8m tall.
        const para = 0.8
        const paraT = 0.2
        const paraMat = bldMat
        const paraY = h + 0.25 + para / 2
        addWallSlab(x + w / 2, paraY, z, w, para, paraT, paraMat) // north
        addWallSlab(x + w / 2, paraY, z + d, w, para, paraT, paraMat) // south
        addWallSlab(x, paraY, z + d / 2, paraT, para, d, paraMat) // west
        addWallSlab(x + w, paraY, z + d / 2, paraT, para, d, paraMat) // east
        // Ladder mesh — vertical rails + rungs on the chosen side.
        const railMat = new THREE.MeshStandardMaterial({
          color: 0x444444,
          roughness: 0.4,
          metalness: 0.9,
        })
        const ladderH = h + 0.25
        let lx = 0
        let lz = 0
        if (ladderSide === "west") {
          lx = x - 0.15
          lz = z + d / 2
        } else if (ladderSide === "east") {
          lx = x + w + 0.15
          lz = z + d / 2
        } else if (ladderSide === "north") {
          lx = x + w / 2
          lz = z - 0.15
        } else {
          lx = x + w / 2
          lz = z + d + 0.15
        }
        // Two rails — orient along Y, offset 0.3m apart laterally.
        const railW = 0.06
        const sideOffset = ladderSide === "west" || ladderSide === "east" ? 0 : 0.3
        const otherOffset = ladderSide === "west" || ladderSide === "east" ? 0.3 : 0
        for (const s of [-1, 1]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(railW, ladderH, railW), railMat)
          rail.position.set(lx + s * sideOffset, ladderH / 2, lz + s * otherOffset)
          rail.castShadow = true
          scene.add(rail)
        }
        // Rungs every 0.35m.
        for (let yy = 0.3; yy < ladderH - 0.1; yy += 0.4) {
          const rung = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.05), railMat)
          rung.position.set(lx, yy, lz)
          if (ladderSide === "north" || ladderSide === "south") {
            rung.rotation.y = Math.PI / 2
          }
          scene.add(rung)
        }
        // Climb zone — straddles the ladder base AND a strip of the roof edge
        // so the same zone serves both the ground-level "press E to go up" and
        // the roof-level "press E to come down" (disambiguated by altitude).
        // topX/topZ land the player firmly on the roof; baseX/baseZ on clear
        // ground beside the tower.
        const top = h + 0.25
        const cz: ClimbZone = (() => {
          if (ladderSide === "west") {
            return {
              x1: lx - 1.2,
              x2: x + 1.4,
              z1: lz - 0.7,
              z2: lz + 0.7,
              targetY: top,
              downY: 0,
              topX: x + 1.1,
              topZ: lz,
              baseX: x - 0.8,
              baseZ: lz,
            }
          }
          if (ladderSide === "east") {
            return {
              x1: x + w - 1.4,
              x2: lx + 1.2,
              z1: lz - 0.7,
              z2: lz + 0.7,
              targetY: top,
              downY: 0,
              topX: x + w - 1.1,
              topZ: lz,
              baseX: x + w + 0.8,
              baseZ: lz,
            }
          }
          if (ladderSide === "north") {
            return {
              x1: lx - 0.7,
              x2: lx + 0.7,
              z1: lz - 1.2,
              z2: z + 1.4,
              targetY: top,
              downY: 0,
              topX: lx,
              topZ: z + 1.1,
              baseX: lx,
              baseZ: z - 0.8,
            }
          }
          return {
            x1: lx - 0.7,
            x2: lx + 0.7,
            z1: z + d - 1.4,
            z2: lz + 1.2,
            targetY: top,
            downY: 0,
            topX: lx,
            topZ: z + d - 1.1,
            baseX: lx,
            baseZ: z + d + 0.8,
          }
        })()
        climbZones.push(cz)
        // Ladder cue: yellow ground disc at the base + "[E] CLIMB" sprite
        // a bit above eye height so it pops against the tower wall. Anchored
        // at the ground base (the zone now also covers the roof edge).
        const decalX = cz.baseX ?? (cz.x1 + cz.x2) / 2
        const decalZ = cz.baseZ ?? (cz.z1 + cz.z2) / 2
        entryDecals.push(makeEntryDecal(decalX, decalZ, 0xffcc22))
        const climbSign = makeEntrySign("[E] CLIMB", "#ffcc22")
        climbSign.position.set(decalX, 2.3, decalZ)
        scene.add(climbSign)
        entries.push({ x: decalX, z: decalZ, kind: "ladder" })
        // Roof prop.
        if (opts.roofProp === "tank") {
          const tank = new THREE.Mesh(
            new THREE.CylinderGeometry(0.9, 1.0, 1.6, 12),
            new THREE.MeshStandardMaterial({
              color: 0x6a8a8a,
              roughness: 0.55,
              metalness: 0.35,
            }),
          )
          tank.position.set(x + w / 2 + 0.8, h + 0.25 + 0.8, z + d / 2 - 0.6)
          tank.castShadow = true
          scene.add(tank)
          ALL_AABBS.push({
            x1: tank.position.x - 1.0,
            x2: tank.position.x + 1.0,
            z1: tank.position.z - 1.0,
            z2: tank.position.z + 1.0,
            h: h + 0.25 + 1.6,
          })
        } else if (opts.roofProp === "vent") {
          const vent = new THREE.Mesh(
            new THREE.BoxGeometry(1.4, 0.9, 1.0),
            new THREE.MeshStandardMaterial({
              color: 0x6a6a6a,
              roughness: 0.4,
              metalness: 0.5,
            }),
          )
          vent.position.set(x + w / 2 - 0.5, h + 0.25 + 0.45, z + d / 2 + 0.5)
          vent.castShadow = true
          scene.add(vent)
          ALL_AABBS.push({
            x1: vent.position.x - 0.7,
            x2: vent.position.x + 0.7,
            z1: vent.position.z - 0.5,
            z2: vent.position.z + 0.5,
            h: h + 0.25 + 0.9,
          })
        }
      }

      // Roof tower #1 — west-facing ladder, water tank on top.
      makeRoofTower({
        x: 28,
        z: 86,
        w: 5,
        d: 5,
        h: 6,
        ladderSide: "west",
        bldMat: concreteMat,
        roofMat: concreteRoofMat,
        roofProp: "tank",
      })
      // Roof tower #2 — east-facing ladder, AC vent on top.
      makeRoofTower({
        x: 60,
        z: 86,
        w: 5,
        d: 5,
        h: 5,
        ladderSide: "east",
        bldMat: industrialMat,
        roofMat: industrialRoofMat,
        roofProp: "vent",
      })

      // ── Multi-floor mansions (enterable, walkable switchback stairs) ────────
      // Unlike the roof towers (E-key elevator lifts) these have real walkable
      // stairs: each tread is a FloorAABB rising < STEP_UP_MAX, so the existing
      // floor-snap auto-steps the player up/down. A switchback per storey climbs
      // all the way from the ground to a rooftop penthouse. Interiors are split
      // into rooms with cover; windows + a roof tank dress the exterior. No
      // point lights — emissive windows only. Interior props skip castShadow.
      function makeMansion(opts: {
        x: number
        z: number
        w: number
        d: number
        levels: number // storeys including ground; the roof sits above the top
        bldMat: THREE.Material
        roofMat: THREE.Material
      }) {
        const { x, z, w, d, levels, bldMat, roofMat } = opts
        const floorH = 3.0
        const roofY = levels * floorH
        const WT = WALL_T
        const ix1 = x + WT
        const ix2 = x + w - WT
        const iz1 = z + WT
        const iz2 = z + d - WT
        // Stairwell shaft: flush to the north (iz1) + east (ix2) interior walls,
        // open toward the south (interior). Two 1.4-wide flights + 0.2 gap = 3.0
        // wide, 3.0 deep. Per storey: flight A climbs north, a landing, flight B
        // climbs back south and emerges on the floor above at the open edge.
        const swW = 3.0
        const swDepth = 3.0
        const swx = ix2 - swW // west edge of the shaft
        const nearZ = iz1 + swDepth // open (south) edge of the shaft
        const laneW = 1.4
        const tread = 0.42
        const rise = 0.3 // < STEP_UP_MAX (0.4): floor-snap auto-steps each tread
        const stepsPerFlight = 5 // 5 * 0.3 = 1.5 = half a storey
        const landingD = swDepth - stepsPerFlight * tread // 3.0 - 2.1 = 0.9

        // ── Perimeter shell: full-height walls (windows overlaid separately).
        //    The south wall carries two ground-floor doors via lintels.
        addWallSlab(x + w / 2, roofY / 2, z, w, roofY, WT, bldMat) // north
        addWallSlab(x, roofY / 2, z + d / 2, WT, roofY, d, bldMat) // west
        addWallSlab(x + w, roofY / 2, z + d / 2, WT, roofY, d, bldMat) // east
        const doorTop = 2.4
        const g1 = x + w * 0.3
        const g2 = x + w * 0.7
        const half = 1.0 // half door width (2.0 wide)
        const southSeg = (xa: number, xb: number) => {
          if (xb - xa > 0.05) {
            addWallSlab((xa + xb) / 2, roofY / 2, z + d, xb - xa, roofY, WT, bldMat)
          }
        }
        southSeg(x, g1 - half)
        southSeg(g1 + half, g2 - half)
        southSeg(g2 + half, x + w)
        for (const gc of [g1, g2]) {
          // Lintel above each door (doorTop → roof).
          addWallSlab(gc, (doorTop + roofY) / 2, z + d, 2 * half, roofY - doorTop, WT, bldMat)
          const dz = z + d + 0.6
          entryDecals.push(makeEntryDecal(gc, dz, 0x44ff88))
          entries.push({ x: gc, z: dz, kind: "door" })
        }

        // ── Local builders ──
        // A floor rectangle: walkable AABB + a thin visual slab (top at y).
        const addFloorRect = (fx1: number, fz1: number, fx2: number, fz2: number, y: number) => {
          if (fx2 - fx1 <= 0.05 || fz2 - fz1 <= 0.05) return
          floors.push({ x1: fx1, z1: fz1, x2: fx2, z2: fz2, y })
          const slab = new THREE.Mesh(
            new THREE.BoxGeometry(fx2 - fx1, 0.12, fz2 - fz1),
            mansionFloorMat,
          )
          slab.position.set((fx1 + fx2) / 2, y - 0.06, (fz1 + fz2) / 2)
          slab.receiveShadow = true
          slab.castShadow = false
          scene.add(slab)
        }
        // One stair tread: walkable AABB + a visual step block (no wall AABB).
        const stepGeo = new THREE.BoxGeometry(laneW, rise, tread + 0.04)
        const addTread = (lx1: number, lz1: number, lz2: number, topY: number) => {
          floors.push({ x1: lx1, z1: lz1, x2: lx1 + laneW, z2: lz2, y: topY })
          const step = new THREE.Mesh(stepGeo, stairMat)
          step.position.set(lx1 + laneW / 2, topY - rise / 2, (lz1 + lz2) / 2)
          step.castShadow = false
          step.receiveShadow = true
          scene.add(step)
        }
        // Interior partition with a centred door gap, standing on floor baseY.
        const addPartition = (
          pa: number,
          pb: number,
          fixed: number,
          baseY: number,
          axis: "x" | "z",
        ) => {
          const ph = floorH - 0.1
          const cy = baseY + ph / 2
          const gc = (pa + pb) / 2
          const seg = (a: number, b: number) => {
            if (b - a <= 0.05) return
            if (axis === "x") addWallSlab((a + b) / 2, cy, fixed, b - a, ph, WT, bldMat)
            else addWallSlab(fixed, cy, (a + b) / 2, WT, ph, b - a, bldMat)
          }
          seg(pa, gc - 0.9)
          seg(gc + 0.9, pb)
        }
        // A furniture box (cover) resting on floor baseY; no shadow (interior).
        const addFurniture = (
          cx: number,
          baseY: number,
          cz: number,
          sw: number,
          sh: number,
          sd: number,
          mat: THREE.Material,
        ) => {
          const m = addWallSlab(cx, baseY + sh / 2, cz, sw, sh, sd, mat)
          m.castShadow = false
        }

        // ── Per-storey floor slabs: a frame around the shaft hole. Levels
        //    1..levels-1 are interior floors; `levels` is the roof deck.
        for (let L = 1; L <= levels; L++) {
          const y = L * floorH
          addFloorRect(ix1, iz1, swx, iz2, y) // west of the shaft, full depth
          addFloorRect(swx, nearZ, ix2, iz2, y) // east of west part, south of shaft
        }

        // ── Switchback stairs through every storey (ground → … → roof).
        for (let k = 0; k < levels; k++) {
          const baseY = k * floorH
          for (let i = 1; i <= stepsPerFlight; i++) {
            // Flight A — climbs north (−z) in the west lane.
            addTread(swx, nearZ - i * tread, nearZ - (i - 1) * tread, baseY + i * rise)
          }
          addFloorRect(swx, iz1, ix2, iz1 + landingD, baseY + stepsPerFlight * rise)
          for (let j = 1; j <= stepsPerFlight; j++) {
            // Flight B — climbs south (+z) in the east lane, back to the open edge.
            addTread(
              ix2 - laneW,
              iz1 + landingD + (j - 1) * tread,
              iz1 + landingD + j * tread,
              baseY + (stepsPerFlight + j) * rise,
            )
          }
        }

        // ── Rooms + furniture on each habitable storey (incl. ground).
        for (let L = 0; L < levels; L++) {
          const baseY = L * floorH
          // East-west corridor wall (front rooms vs back rooms), west of shaft.
          addPartition(ix1, swx - 0.3, z + d * 0.55, baseY, "x")
          // North-south cross wall making two south-side rooms.
          addPartition(nearZ + 0.3, iz2, x + w * 0.4, baseY, "z")
          addFurniture(ix1 + 1.4, baseY, iz1 + 1.2, 1.3, 0.9, 1.3, furnMatA)
          addFurniture(x + w * 0.25, baseY, iz2 - 1.4, 1.8, 0.8, 1.0, furnMatB)
          if (L > 0) addFurniture(ix1 + 1.2, baseY, iz2 - 1.6, 1.1, 1.6, 0.4, furnMatB)
        }

        // ── Windows (skip the ground-floor south = door face).
        addBuildingWindows({
          x,
          z,
          w,
          d,
          yStart: 1.2,
          yTop: roofY,
          faces: ["north", "east", "west"],
          litOffset: (x * 3 + z) & 3,
        })
        addBuildingWindows({
          x,
          z,
          w,
          d,
          yStart: floorH + 1.0,
          yTop: roofY,
          faces: ["south"],
        })

        // ── Roof: parapet handrail, a stair penthouse over the shaft, a tank.
        const para = 0.9
        const paraT = 0.18
        const paraY = roofY + para / 2
        addWallSlab(x + w / 2, paraY, z, w, para, paraT, bldMat) // north
        addWallSlab(x + w / 2, paraY, z + d, w, para, paraT, bldMat) // south
        addWallSlab(x, paraY, z + d / 2, paraT, para, d, bldMat) // west
        addWallSlab(x + w, paraY, z + d / 2, paraT, para, d, bldMat) // east
        const phH = 2.4
        const phY = roofY + phH / 2
        const phMid = (swx + ix2) / 2
        addWallSlab(phMid, phY, iz1, swW, phH, paraT, bldMat) // north (against wall)
        addWallSlab(ix2, phY, (iz1 + nearZ) / 2, paraT, phH, swDepth, bldMat) // east
        addWallSlab(swx, phY, (iz1 + nearZ) / 2, paraT, phH, swDepth, bldMat) // west
        // South penthouse face with a door gap (exit onto the roof).
        const phGap = 1.2
        addWallSlab(
          (swx + (phMid - phGap)) / 2,
          phY,
          nearZ,
          phMid - phGap - swx,
          phH,
          paraT,
          bldMat,
        )
        addWallSlab(
          (phMid + phGap + ix2) / 2,
          phY,
          nearZ,
          ix2 - (phMid + phGap),
          phH,
          paraT,
          bldMat,
        )
        const cap = new THREE.Mesh(new THREE.BoxGeometry(swW + 0.2, 0.2, swDepth + 0.2), roofMat)
        cap.position.set(phMid, roofY + phH + 0.1, (iz1 + nearZ) / 2)
        cap.castShadow = true
        scene.add(cap)
        addRoofUnit(x + w * 0.28, roofY, z + d * 0.78, "tank")

        // ── Minimap: phantom footprint AABB. h < 0 → never collides (and
        //    bullets pass), but the minimap draws it as a filled building.
        ALL_AABBS.push({ x1: x, z1: z, x2: x + w, z2: z + d, h: -1 })
      }

      // Three mansions in empty lots, surveyed clear of the observation towers
      // (centres 14,14 / 14,84 / 84,44 / 86,86 — legs splay ±7, kept ≥13 m
      // away), the avenue (z 44–58), and every existing building / prop.
      //  A: outdoor NE cell, north of the z≈28 trench (two trees removed below)
      //  B: west strip, south of the avenue (clear of the S-flank at x≥10)
      //  C: west strip, north of the avenue (clear of the N-flank at x≥10)
      makeMansion({
        x: 70,
        z: 7,
        w: 12,
        d: 12,
        levels: 4,
        bldMat: concreteMat,
        roofMat: concreteRoofMat,
      })
      makeMansion({
        x: 0.5,
        z: 59,
        w: 9,
        d: 12,
        levels: 5,
        bldMat: concreteMat,
        roofMat: concreteRoofMat,
      })
      makeMansion({
        x: 0.5,
        z: 31,
        w: 9,
        d: 12,
        levels: 6,
        bldMat: concreteMat,
        roofMat: concreteRoofMat,
      })

      // ── Landmark observation tower (Tokyo-Tower-style lattice) ──────────────
      // A tall splayed lattice tower with an observation deck you ride an
      // elevator up to (reuses the floor + climb-zone lift). Legs are decorative
      // (no collision) so you can walk under it to the central elevator; the
      // deck + railings are solid up top.
      // Emissive materials of the rooftop warning lights, pulsed in the animate
      // loop so the towers appear to blink.
      const towerBeacons: THREE.MeshStandardMaterial[] = []
      function makeLandmarkTower(
        cx: number,
        cz: number,
        deckY = 22,
        legColor = 0xc0392b,
        neonColor = 0x33ddff,
      ) {
        const towerTopY = deckY + 14
        const legMat = new THREE.MeshStandardMaterial({
          color: legColor,
          roughness: 0.5,
          metalness: 0.55,
        })
        const braceMat = new THREE.MeshStandardMaterial({
          color: 0xe8e8e8,
          roughness: 0.6,
          metalness: 0.3,
        })
        const steelMat = new THREE.MeshStandardMaterial({
          color: 0x9aa0a6,
          roughness: 0.45,
          metalness: 0.6,
        })
        // Strut between two world points (used for legs + braces).
        const strut = (
          ax: number,
          ay: number,
          az: number,
          bx: number,
          by: number,
          bz: number,
          r: number,
          mat: THREE.Material,
        ) => {
          const a = new THREE.Vector3(ax, ay, az)
          const b = new THREE.Vector3(bx, by, bz)
          const len = a.distanceTo(b)
          const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat)
          m.position.copy(a).add(b).multiplyScalar(0.5)
          m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
          m.castShadow = true
          scene.add(m)
        }
        const baseHalf = 7
        const waistHalf = 2.2
        const corners: [number, number][] = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]
        // Position of leg `c` at height fraction t (0=base, 1=deck).
        const legPt = (c: [number, number], t: number): [number, number, number] => {
          const half = baseHalf + (waistHalf - baseHalf) * t
          return [cx + c[0] * half, t * deckY, cz + c[1] * half]
        }
        // Four splayed legs.
        for (const c of corners) {
          const [ax, ay, az] = legPt(c, 0)
          const [bx, by, bz] = legPt(c, 1)
          strut(ax, ay, az, bx, by, bz, 0.32, legMat)
        }
        // Lattice: ring + X braces at several levels.
        for (const t of [0.22, 0.44, 0.66, 0.88]) {
          const pts = corners.map((c) => legPt(c, t))
          for (let i = 0; i < 4; i++) {
            const p = pts[i]
            const q = pts[(i + 1) % 4]
            if (!p || !q) continue
            strut(p[0], p[1], p[2], q[0], q[1], q[2], 0.12, braceMat) // ring
            // diagonal up to the next corner's higher point (cheap X look)
            const qHi = legPt(corners[(i + 1) % 4] as [number, number], t + 0.16)
            strut(p[0], p[1], p[2], qHi[0], qHi[1], qHi[2], 0.08, braceMat)
          }
        }
        // Dark-glass window strips on each face at every lattice level, so the
        // tower reads as a glazed high-rise with "floors" rather than bare steel.
        const glassMat = new THREE.MeshStandardMaterial({
          color: 0x0c2230,
          emissive: 0x12384e,
          emissiveIntensity: 0.45,
          roughness: 0.2,
          metalness: 0.7,
          transparent: true,
          opacity: 0.72,
        })
        for (const t of [0.18, 0.4, 0.62, 0.84]) {
          const half = baseHalf + (waistHalf - baseHalf) * t
          const wy = t * deckY
          const ww = half * 1.2 // strip spans ~60% of each face
          const wh = 1.4
          for (const s of [-1, 1]) {
            const winZ = new THREE.Mesh(new THREE.BoxGeometry(ww, wh, 0.12), glassMat)
            winZ.position.set(cx, wy, cz + s * half)
            scene.add(winZ)
            const winX = new THREE.Mesh(new THREE.BoxGeometry(0.12, wh, ww), glassMat)
            winX.position.set(cx + s * half, wy, cz)
            scene.add(winX)
          }
        }
        // Observation deck slab.
        const deckHalf = 4
        const deck = new THREE.Mesh(
          new THREE.BoxGeometry(deckHalf * 2, 0.4, deckHalf * 2),
          steelMat,
        )
        deck.position.set(cx, deckY, cz)
        deck.castShadow = true
        deck.receiveShadow = true
        scene.add(deck)
        // Neon accent lines along the deck rim (emissive — glow at night).
        const neonMat = new THREE.MeshStandardMaterial({
          color: neonColor,
          emissive: neonColor,
          emissiveIntensity: 2.2,
          roughness: 0.3,
          metalness: 0,
        })
        const neonY = deckY + 0.45
        for (const s of [-1, 1]) {
          const nz = new THREE.Mesh(new THREE.BoxGeometry(deckHalf * 2 + 0.25, 0.12, 0.12), neonMat)
          nz.position.set(cx, neonY, cz + s * deckHalf)
          scene.add(nz)
          const nx = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, deckHalf * 2 + 0.25), neonMat)
          nx.position.set(cx + s * deckHalf, neonY, cz)
          scene.add(nx)
        }
        // Rooftop warning lights at the deck corners — collected so the animate
        // loop can pulse them (aircraft-warning blink).
        for (const c of corners) {
          const beaconMat = new THREE.MeshStandardMaterial({
            color: 0xff2a2a,
            emissive: 0xff1111,
            emissiveIntensity: 1.5,
          })
          const light = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), beaconMat)
          light.position.set(
            cx + c[0] * (deckHalf - 0.3),
            deckY + 0.5,
            cz + c[1] * (deckHalf - 0.3),
          )
          scene.add(light)
          towerBeacons.push(beaconMat)
        }
        floors.push({
          x1: cx - deckHalf,
          z1: cz - deckHalf,
          x2: cx + deckHalf,
          z2: cz + deckHalf,
          y: deckY + 0.2,
        })
        // Deck railings (solid up top so you don't walk off).
        const railY = deckY + 0.2 + 0.55
        addWallSlab(cx, railY, cz - deckHalf, deckHalf * 2, 1.1, 0.15, steelMat)
        addWallSlab(cx, railY, cz + deckHalf, deckHalf * 2, 1.1, 0.15, steelMat)
        addWallSlab(cx - deckHalf, railY, cz, 0.15, 1.1, deckHalf * 2, steelMat)
        addWallSlab(cx + deckHalf, railY, cz, 0.15, 1.1, deckHalf * 2, steelMat)
        // Upper tower above the deck + antenna spire.
        for (const c of corners) {
          strut(
            cx + c[0] * waistHalf,
            deckY,
            cz + c[1] * waistHalf,
            cx + c[0] * 0.6,
            towerTopY,
            cz + c[1] * 0.6,
            0.16,
            legMat,
          )
        }
        const antennaLen = 11
        const antenna = new THREE.Mesh(
          new THREE.CylinderGeometry(0.18, 0.32, antennaLen, 8),
          steelMat,
        )
        antenna.position.set(cx, towerTopY + antennaLen / 2, cz)
        antenna.castShadow = true
        scene.add(antenna)
        const beacon = new THREE.Mesh(
          new THREE.SphereGeometry(0.4, 10, 8),
          new THREE.MeshBasicMaterial({ color: 0xff3322 }),
        )
        beacon.position.set(cx, towerTopY + antennaLen, cz)
        scene.add(beacon)
        // Slim antenna mast standing on the observation deck (rooftop antenna).
        const deckAntenna = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 4.5, 6), steelMat)
        deckAntenna.position.set(cx - (deckHalf - 0.6), deckY + 0.2 + 2.25, cz - (deckHalf - 0.6))
        deckAntenna.castShadow = true
        scene.add(deckAntenna)
        // Elevator shaft (4 thin posts) + a car at the base for flavour.
        for (const c of corners) {
          strut(
            cx + c[0] * 0.8,
            0,
            cz + c[1] * 0.8,
            cx + c[0] * 0.8,
            deckY,
            cz + c[1] * 0.8,
            0.07,
            steelMat,
          )
        }
        // Glass-walled elevator car (translucent blue) — rides with the player.
        const car = new THREE.Mesh(
          new THREE.BoxGeometry(1.6, 2.2, 1.6),
          new THREE.MeshStandardMaterial({
            color: 0x3a8fd0,
            emissive: 0x123a5a,
            emissiveIntensity: 0.5,
            roughness: 0.15,
            metalness: 0.4,
            transparent: true,
            opacity: 0.42,
          }),
        )
        car.position.set(cx, 1.1, cz)
        scene.add(car)
        // Elevator lift zone (central; ground↔deck, disambiguated by altitude).
        // The trigger box is widened to ±2.2 (was ±1.3): the elevator car
        // (1.6×1.6) sits dead-center, so a player walking up to the tower
        // naturally stops *outside* the car — at the old ±1.3 edge the
        // "[E]/↑ ELEVATOR" prompt frequently never fired. ±2.2 still sits well
        // inside the splayed legs (base half-span 7), so it can't trigger from
        // open ground, but the hint now appears as soon as you reach the car.
        const ELEVATOR_ZONE_HALF = 2.2
        climbZones.push({
          x1: cx - ELEVATOR_ZONE_HALF,
          x2: cx + ELEVATOR_ZONE_HALF,
          z1: cz - ELEVATOR_ZONE_HALF,
          z2: cz + ELEVATOR_ZONE_HALF,
          targetY: deckY + 0.2,
          downY: 0,
          topX: cx,
          topZ: cz,
          baseX: cx,
          baseZ: cz,
          car,
        })
        entryDecals.push(makeEntryDecal(cx, cz, 0x33ddff))
        const sign = makeEntrySign("[E] ELEVATOR", "#33ddff")
        sign.position.set(cx, 2.4, cz)
        scene.add(sign)
        entries.push({ x: cx, z: cz, kind: "ladder" })
      }
      // Skyline of climbable observation towers, each with its own elevator.
      // Legs carry no collision, so they never block traversal — only the decks
      // up top are solid. Placed in open corners at varied heights.
      makeLandmarkTower(84, 44, 22, 0xc0392b, 0xff3366) // red neon
      makeLandmarkTower(14, 14, 18, 0x3a6ea5, 0x33ddff) // blue-white neon
      makeLandmarkTower(14, 84, 27, 0xc0392b, 0xff3366) // red neon
      makeLandmarkTower(86, 86, 24, 0x6a6f78, 0x33ddff) // blue-white neon

      // ── Street props ───────────────────────────────────────────────────────
      // Drum barrels (cylinders) clustered at key choke points.
      const drumMat = new THREE.MeshStandardMaterial({
        color: 0x8a3a2a,
        roughness: 0.65,
        metalness: 0.35,
      })
      const drumStripeMat = new THREE.MeshStandardMaterial({
        color: 0xffd84a,
        emissive: 0x3a2200,
        roughness: 0.6,
        metalness: 0,
      })
      const drumSpots: [number, number][] = [
        [12, 36],
        [12.7, 36.6],
        [13.4, 36],
        [40, 30],
        [40.7, 30.7],
        [55, 50],
        [56, 50.6],
        [70, 70],
        [70.7, 70.6],
        [85, 30],
        [85.7, 30.7],
      ]
      for (const [dx, dz] of drumSpots) {
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.95, 10), drumMat)
        drum.position.set(dx, 0.475, dz)
        drum.castShadow = false
        drum.receiveShadow = false
        scene.add(drum)
        wallMeshes.push(drum)
        ALL_AABBS.push({ x1: dx - 0.4, x2: dx + 0.4, z1: dz - 0.4, z2: dz + 0.4, h: 0.95 })
        // Yellow stripe band around the drum.
        const stripe = new THREE.Mesh(
          new THREE.CylinderGeometry(0.36, 0.36, 0.12, 10),
          drumStripeMat,
        )
        stripe.position.set(dx, 0.65, dz)
        scene.add(stripe)
      }

      // Wood pallets (low flat boxes).
      const palletMat = new THREE.MeshStandardMaterial({
        color: 0x886a3a,
        roughness: 0.95,
        metalness: 0,
      })
      const palletSpots: [number, number, number][] = [
        [38, 40, 0],
        [38, 41.1, 0],
        [52, 70, Math.PI / 6],
        [82, 22, 0],
      ]
      for (const [px, pz, rot] of palletSpots) {
        const pal = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.15, 0.8), palletMat)
        pal.position.set(px, 0.075, pz)
        pal.rotation.y = rot
        pal.castShadow = false
        pal.receiveShadow = false
        scene.add(pal)
        // No AABB — players step over flat pallets.
      }

      // Trash cans (small cylinders).
      const trashMat = new THREE.MeshStandardMaterial({
        color: 0x2a2e22,
        roughness: 0.7,
        metalness: 0.2,
      })
      const trashSpots: [number, number][] = [
        [10, 28],
        [10, 60],
        [10, 78],
        [27, 66],
      ]
      for (const [tx, tz] of trashSpots) {
        const can = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.85, 10), trashMat)
        can.position.set(tx, 0.425, tz)
        can.castShadow = false
        scene.add(can)
        wallMeshes.push(can)
        ALL_AABBS.push({ x1: tx - 0.32, x2: tx + 0.32, z1: tz - 0.32, z2: tz + 0.32, h: 0.85 })
      }

      // A wrecked car / hulk in the south plaza — bigger silhouette than
      // the existing patrol cars; clearly broken (no windshield, tilted).
      {
        const wreckMat = new THREE.MeshStandardMaterial({
          color: 0x3a3a32,
          roughness: 0.85,
          metalness: 0.2,
        })
        const wx = 33
        const wz = 88
        const wreck = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.9, 1.5), wreckMat)
        wreck.position.set(wx, 0.45, wz)
        wreck.rotation.z = 0.12
        wreck.castShadow = true
        wreck.receiveShadow = true
        scene.add(wreck)
        wallMeshes.push(wreck)
        ALL_AABBS.push({ x1: wx - 1.6, x2: wx + 1.6, z1: wz - 0.8, z2: wz + 0.8, h: 0.9 })
        // Tires (4)
        const tireMat = new THREE.MeshStandardMaterial({
          color: 0x141414,
          roughness: 0.95,
          metalness: 0,
        })
        const tireOffsets: [number, number][] = [
          [wx - 1.1, wz - 0.65],
          [wx + 1.1, wz - 0.65],
          [wx - 1.1, wz + 0.65],
          [wx + 1.1, wz + 0.65],
        ]
        for (const [tox, toz] of tireOffsets) {
          const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.14, 8), tireMat)
          tire.position.set(tox, 0.24, toz)
          tire.rotation.z = Math.PI / 2
          scene.add(tire)
        }
      }

      // ── Crosswalk markings ────────────────────────────────────────────────
      // Painted white stripes on the ground; no collision, slight y-lift so
      // they sit on top of the ground plane without z-fighting.
      const crosswalkMat = new THREE.MeshStandardMaterial({
        color: 0xeae8d8,
        roughness: 0.9,
        metalness: 0,
        emissive: 0x1a1814,
      })
      const crosswalks: { cx: number; cz: number; rot: number }[] = [
        { cx: 12, cz: 22, rot: 0 },
        { cx: 31, cz: 43, rot: Math.PI / 2 },
        { cx: 60, cz: 22, rot: 0 },
      ]
      // Crosswalks are an urban-only street feature.
      if (mapId === "urban") {
        for (const cw of crosswalks) {
          for (let s = -2; s <= 2; s++) {
            const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 3.5), crosswalkMat)
            stripe.rotation.x = -Math.PI / 2
            stripe.rotation.z = cw.rot
            const off = s * 0.85
            stripe.position.set(
              cw.cx + Math.cos(cw.rot) * off,
              0.018,
              cw.cz + Math.sin(cw.rot) * off,
            )
            stripe.receiveShadow = true
            scene.add(stripe)
          }
        }
      }

      // ── Neon signage ──────────────────────────────────────────────────────
      // Wall-mounted emissive boxes near major buildings — readable from
      // far away thanks to the high emissiveIntensity under ACESFilmic.
      const neonSpec: {
        x: number
        z: number
        rot: number
        w: number
        h: number
        color: number
      }[] = [
        { x: 11, z: 14.5, rot: 0, w: 4, h: 0.9, color: 0xff4488 }, // pink
        { x: 47, z: 4.5, rot: 0, w: 5, h: 1.0, color: 0x44ffcc }, // teal
        { x: 22.5, z: 14, rot: Math.PI / 2, w: 3, h: 0.7, color: 0xffcc44 }, // amber
        { x: 70, z: 5.5, rot: 0, w: 4, h: 0.8, color: 0x8844ff }, // violet
      ]
      // Neon signage is urban-only (desert/snow have no power-lit storefronts).
      if (mapId === "urban") {
        for (const n of neonSpec) {
          const neonMat = new THREE.MeshStandardMaterial({
            color: n.color,
            emissive: n.color,
            emissiveIntensity: 1.4,
            roughness: 0.4,
            metalness: 0.2,
          })
          const sign = new THREE.Mesh(new THREE.BoxGeometry(n.w, n.h, 0.12), neonMat)
          sign.position.set(n.x, 3.2, n.z)
          sign.rotation.y = n.rot
          scene.add(sign)
          // Add a small point light so the neon casts a colored wash on the
          // nearby wall (subtle but adds the "wet street" cyberpunk feel).
          const pl = new THREE.PointLight(n.color, 0.55, 8)
          pl.position.set(n.x, 3.5, n.z + 0.3)
          scene.add(pl)
        }
      }

      // ── Distant horizon silhouette ─────────────────────────────────────
      // Cosmetic ring of shapes *outside* the playable map (no collision, no
      // shadows). The silhouette is what most sells the setting from afar, so
      // it changes per map: urban = tall city blocks, desert = rolling sand
      // dunes, snow = jagged mountain peaks.
      const skylineStyle = mapPalette.skylineStyle
      const skylineMat = new THREE.MeshLambertMaterial({
        color: mapPalette.skyline,
        emissive:
          skylineStyle === "city" ? 0x080a14 : skylineStyle === "dunes" ? 0x2a2010 : 0x101822,
      })
      const skylineGeo =
        skylineStyle === "mountains"
          ? new THREE.ConeGeometry(1, 1, 5)
          : skylineStyle === "dunes"
            ? new THREE.SphereGeometry(1, 10, 6)
            : new THREE.BoxGeometry(1, 1, 1)
      // Per-instance scale profile for the chosen style. Returns [w, h, depth].
      const silhouetteScale = (i: number): [number, number, number] => {
        if (skylineStyle === "mountains") {
          const w = 14 + ((i * 7) % 10)
          const h = 26 + ((i * 13) % 26)
          return [w, h, w]
        }
        if (skylineStyle === "dunes") {
          const w = 18 + ((i * 9) % 12)
          const h = 5 + ((i * 7) % 5)
          return [w, h, w * 0.8]
        }
        const w = 5 + ((i * 7) % 5)
        const h = 14 + ((i * 13) % 18)
        return [w, h, 6]
      }
      // Use a single InstancedMesh per orientation strip to keep draw calls low.
      const skylineRows: { z: number; baseX: number; n: number }[] = [
        { z: WORLD_MIN - 25, baseX: WORLD_MIN - 10, n: 88 }, // far north
        { z: WORLD_MAX + 25, baseX: WORLD_MIN - 10, n: 88 }, // far south
      ]
      for (const row of skylineRows) {
        const inst = new THREE.InstancedMesh(skylineGeo, skylineMat, row.n)
        inst.castShadow = false
        inst.receiveShadow = false
        const dummy = new THREE.Object3D()
        for (let i = 0; i < row.n; i++) {
          const [w, h, depth] = silhouetteScale(i)
          const x = row.baseX + i * 7.5 + ((i * 5) % 3)
          // Dunes sit half-sunk so only the rounded crest shows above grade.
          const yPos = skylineStyle === "dunes" ? h * 0.1 : h / 2
          dummy.position.set(x, yPos, row.z)
          dummy.scale.set(w, h, depth)
          dummy.updateMatrix()
          inst.setMatrixAt(i, dummy.matrix)
        }
        inst.instanceMatrix.needsUpdate = true
        scene.add(inst)
      }
      // Sky lanes (east-west far ends) — give depth along the avenue too.
      for (const xFar of [WORLD_MIN - 22, WORLD_MAX + 22]) {
        const inst = new THREE.InstancedMesh(skylineGeo, skylineMat, 84)
        const dummy = new THREE.Object3D()
        for (let i = 0; i < 84; i++) {
          const [w, h, depth] = silhouetteScale(i + 3)
          const z = WORLD_MIN - 10 + i * 7.5 + ((i * 3) % 4)
          const yPos = skylineStyle === "dunes" ? h * 0.1 : h / 2
          dummy.position.set(xFar, yPos, z)
          dummy.scale.set(w, h, depth)
          dummy.updateMatrix()
          inst.setMatrixAt(i, dummy.matrix)
        }
        inst.instanceMatrix.needsUpdate = true
        scene.add(inst)
      }

      // ── Street lamps along the central avenue ──────────────────────────
      // Tall cylinder with a glowing top — gives the avenue a clear
      // "road" reading at a distance. Lamps alternate sides.
      const lampPostMat = new THREE.MeshStandardMaterial({
        color: 0x2a2e36,
        roughness: 0.55,
        metalness: 0.55,
      })
      const lampHeadMat = new THREE.MeshStandardMaterial({
        color: 0xffe9aa,
        emissive: 0xffd060,
        emissiveIntensity: 1.6,
        roughness: 0.4,
        metalness: 0,
      })
      // Doubled spacing (12→18) — 24 lamps was overkill and dominated the
      // PointLight per-pixel cost. No more castShadow (thin posts barely
      // showed shadow anyway) and no more PointLights (emissive on the
      // head already glows; sun + hemisphere handle the lit pixels).
      // AABB also dropped — bullets at eye-height were getting eaten by
      // the lamp's 5m-tall stop-volume; lamps are now pure decoration.
      // Avenue fixtures change per map: urban street lamps, desert lattice
      // radio/power towers (no power-lit lamps in a ruined base), snow
      // perimeter fence posts. Same alternating-sides cadence as the lamps so
      // the avenue stays legible as a "road" from a distance on every map.
      if (mapId === "urban") {
        for (let lx = 12; lx <= 90; lx += 18) {
          for (const lz of [44, 56]) {
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 5, 6), lampPostMat)
            post.position.set(lx, 2.5, lz)
            scene.add(post)
            const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.08), lampPostMat)
            arm.position.set(lx + (lz < 50 ? 0.5 : -0.5), 4.8, lz)
            scene.add(arm)
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), lampHeadMat)
            head.position.set(lx + (lz < 50 ? 1.0 : -1.0), 4.65, lz)
            scene.add(head)
          }
        }
      } else if (mapId === "desert") {
        // Steel lattice towers — a tapering post with two cross-braces and a
        // tip antenna. Sparser than lamps (every 24m) to keep the count down.
        const towerMat = new THREE.MeshStandardMaterial({
          color: 0x6a6258,
          roughness: 0.7,
          metalness: 0.5,
        })
        for (let lx = 14; lx <= 90; lx += 24) {
          const lz = (lx / 24) % 2 < 1 ? 43 : 57
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, 8, 5), towerMat)
          post.position.set(lx, 4, lz)
          post.castShadow = true
          scene.add(post)
          for (const by of [2.4, 4.6]) {
            const brace = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.06), towerMat)
            brace.position.set(lx, by, lz)
            scene.add(brace)
          }
          const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 4), towerMat)
          antenna.position.set(lx, 8.8, lz)
          scene.add(antenna)
        }
      } else {
        // Snow: chain-of-posts perimeter fence lining the avenue.
        const fenceMat = new THREE.MeshStandardMaterial({
          color: 0x556069,
          roughness: 0.6,
          metalness: 0.4,
        })
        for (const lz of [43, 57]) {
          for (let lx = 10; lx <= 92; lx += 6) {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.3, 0.12), fenceMat)
            post.position.set(lx, 0.65, lz)
            post.castShadow = true
            scene.add(post)
          }
          // Two horizontal rails spanning the whole run.
          for (const ry of [0.45, 1.05]) {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(82, 0.06, 0.06), fenceMat)
            rail.position.set(51, ry, lz)
            scene.add(rail)
          }
        }
        // Scattered snow drifts (low white mounds) across the open ground.
        const driftMat = new THREE.MeshLambertMaterial({ color: 0xeef4f8 })
        const driftSpots: [number, number][] = [
          [14, 26],
          [14, 74],
          [72, 24],
          [88, 70],
          [40, 90],
          [76, 90],
        ]
        for (const [dx, dz] of driftSpots) {
          const drift = new THREE.Mesh(
            new THREE.SphereGeometry(1.6, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
            driftMat,
          )
          drift.scale.set(1, 0.35, 1)
          drift.position.set(dx, 0.02, dz)
          drift.receiveShadow = true
          scene.add(drift)
        }
      }

      // Desert tents — simple cloth cones near the south flank, purely
      // decorative (placed clear of building footprints + walkways).
      if (mapId === "desert") {
        const tentMat = new THREE.MeshLambertMaterial({ color: 0xb8a06a })
        const tentSpots: [number, number][] = [
          [74, 12],
          [88, 46],
          [76, 88],
        ]
        for (const [tx, tz] of tentSpots) {
          const tent = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2.2, 4), tentMat)
          tent.position.set(tx, 1.1, tz)
          tent.rotation.y = Math.PI / 4
          tent.castShadow = true
          scene.add(tent)
        }
      }

      // ════════════════════════════════════════════════════════════════════
      // PR-B — District terrain: HARBOR (south) + INDUSTRIAL (north) + CITY park
      // Every collidable solid reuses a small set of shared geometries (a unit
      // box scaled per instance, one container box, one chimney/tank/post/lamp
      // geo) and registers its collision AABB by hand — so we never allocate a
      // fresh BoxGeometry per object. No PointLights are added; emissive heads
      // carry the "lit" look under the ACESFilmic tone map. The central N–S
      // road runs at x=50 (±6 corridor) and the E–W avenue at z=50, so district
      // props are kept clear of those lanes.
      // ════════════════════════════════════════════════════════════════════
      const smokePuffs: {
        mesh: THREE.Mesh
        baseX: number
        baseZ: number
        baseY: number
        t: number
        rise: number
      }[] = []
      {
        // ── Shared geometries (reused across all instances) ─────────────────
        const unitBox = new THREE.BoxGeometry(1, 1, 1)
        const containerGeo = new THREE.BoxGeometry(6, 2.6, 2.5) // long axis = X
        const chimneyGeo = new THREE.CylinderGeometry(0.9, 1.25, 16, 12)
        // Vehicle geometry keeps full tessellation — it's seen up close, so a
        // faceted tank reads as a quality bug.
        const tankSphereGeo = new THREE.SphereGeometry(3.2, 16, 12)
        const tankCylGeo = new THREE.CylinderGeometry(2.4, 2.4, 6, 16)
        const fencePostGeo = new THREE.BoxGeometry(0.12, 1.7, 0.12)
        const fenceRailGeo = new THREE.BoxGeometry(1, 0.1, 0.1)
        const lampPostGeo = new THREE.CylinderGeometry(0.1, 0.14, 5, 6)
        const lampHeadGeo = new THREE.SphereGeometry(0.26, sseg(8), sseg(6))
        const craneBeamGeo = new THREE.BoxGeometry(0.6, 0.6, 9)
        const craneBoomGeo = new THREE.BoxGeometry(0.55, 0.55, 15)
        const pierPlankGeo = new THREE.BoxGeometry(3.4, 0.2, 22)

        // ── Shared materials ────────────────────────────────────────────────
        const steelMat = new THREE.MeshStandardMaterial({
          color: zoneTint(0x9aa0a6),
          roughness: 0.5,
          metalness: 0.6,
        })
        const rustMat = new THREE.MeshStandardMaterial({
          color: zoneTint(0x7a5238),
          roughness: 0.85,
          metalness: 0.3,
        })
        const factoryMat = new THREE.MeshStandardMaterial({
          color: zoneTint(0x6c7178),
          roughness: 0.8,
          metalness: 0.25,
        })
        const warehouseMat = new THREE.MeshStandardMaterial({
          color: zoneTint(0x80766a),
          roughness: 0.9,
          metalness: 0.1,
        })
        const tankMat = new THREE.MeshStandardMaterial({
          color: zoneTint(0xb6bbc0),
          roughness: 0.45,
          metalness: 0.55,
        })
        const containerMats = [0xb23b3b, 0x3b6bb2, 0x3b9e54, 0x8a5238].map(
          (c) =>
            new THREE.MeshStandardMaterial({
              color: zoneTint(c),
              roughness: 0.72,
              metalness: 0.4,
            }),
        )
        const lampHeadMat = new THREE.MeshStandardMaterial({
          color: 0xffe9aa,
          emissive: 0xffd060,
          emissiveIntensity: 1.7,
          roughness: 0.4,
          metalness: 0,
        })

        // ── Helpers ─────────────────────────────────────────────────────────
        // Register a mesh for collision (AABB) + bullet raycast (wallMeshes).
        const registerSolid = (m: THREE.Mesh, halfX: number, halfZ: number, topY: number) => {
          // District (HARBOR/INDUSTRIAL) solids skip shadow casting/receiving —
          // these districts add a lot of geometry and shadow maps are the main
          // GPU cost on mobile. The CITY core keeps its shadows.
          scene.add(m)
          wallMeshes.push(m)
          ALL_AABBS.push({
            x1: m.position.x - halfX,
            x2: m.position.x + halfX,
            z1: m.position.z - halfZ,
            z2: m.position.z + halfZ,
            h: topY,
          })
          return m
        }
        // Axis-aligned scaled box (reuses unitBox). ry must be 0 or ±π/2 so the
        // footprint stays axis-aligned for the AABB (swaps extents at ±90°).
        const addBox = (
          mat: THREE.Material,
          x: number,
          z: number,
          sx: number,
          sy: number,
          sz: number,
          ry = 0,
        ) => {
          const m = new THREE.Mesh(unitBox, mat)
          m.scale.set(sx, sy, sz)
          m.position.set(x, sy / 2, z)
          m.rotation.y = ry
          const swap = Math.abs(ry) > 0.1
          return registerSolid(m, (swap ? sz : sx) / 2, (swap ? sx : sz) / 2, sy)
        }

        // ── HARBOR (south, z ≈ 150–260; open water beyond) ──────────────────
        // Stacked shipping containers. Each entry: [x, z, levels, rot90].
        const containerStacks: [number, number, number, boolean][] = [
          [28, 162, 3, false],
          [33, 162, 2, false],
          [28, 167, 2, true],
          [70, 170, 3, false],
          [65, 170, 2, false],
          [70, 175, 2, true],
          [18, 205, 2, false],
          [80, 210, 3, false],
          [76, 210, 2, false],
          [40, 225, 2, true],
        ]
        for (const [bx, bz, levels, rot90] of containerStacks) {
          for (let l = 0; l < levels; l++) {
            const mat = containerMats[(l + Math.round(bx) + Math.round(bz)) % 4]
            if (!mat) continue
            const m = new THREE.Mesh(containerGeo, mat)
            const y = 1.3 + l * 2.6
            m.position.set(bx, y, bz)
            if (rot90) m.rotation.y = Math.PI / 2
            registerSolid(m, rot90 ? 1.25 : 3, rot90 ? 3 : 1.25, y + 1.3)
          }
        }
        // Warehouses (low, long sheds) — kept off the x=50 road corridor.
        addBox(warehouseMat, 26, 235, 22, 6, 13)
        addBox(warehouseMat, 74, 236, 20, 6, 12)
        addBox(warehouseMat, 80, 185, 16, 5.5, 11)
        // Gantry cranes near the quay edge (z ≈ 252). Two tall legs + a top
        // beam + a boom cantilevered out over the water (toward +z).
        const makeCrane = (cx: number, cz: number) => {
          for (const dz of [-4, 4]) {
            // legs (scaled unit box, collidable)
            addBox(steelMat, cx, cz + dz, 0.5, 14, 0.5)
          }
          const beam = new THREE.Mesh(craneBeamGeo, steelMat)
          beam.position.set(cx, 14, cz)
          scene.add(beam)
          const boom = new THREE.Mesh(craneBoomGeo, steelMat)
          boom.position.set(cx, 14.4, cz + 9)
          scene.add(boom)
          const cab = new THREE.Mesh(unitBox, rustMat)
          cab.scale.set(1.6, 1.4, 1.6)
          cab.position.set(cx, 13, cz - 1.5)
          scene.add(cab)
        }
        makeCrane(24, 252)
        makeCrane(58, 256)
        makeCrane(86, 252)
        // Piers / jetties — planks reaching south off the quay into the water.
        // Low (y≈0.15) and walkable, so no collision AABB.
        for (const px of [30, 70]) {
          const plank = new THREE.Mesh(pierPlankGeo, warehouseMat)
          plank.position.set(px, 0.15, 274)
          scene.add(plank)
        }
        // Open water — a single large plane at the far south, just below grade.
        const waterMat = new THREE.MeshStandardMaterial({
          color: zoneTint(0x245f80),
          roughness: 0.25,
          metalness: 0.6,
          transparent: true,
          opacity: 0.92,
        })
        const water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_SIZE, 90), waterMat)
        water.rotation.x = -Math.PI / 2
        water.position.set(WORLD_CENTER, -0.05, 305)
        scene.add(water)

        // ── HARBOR airfield — runway + enterable hangar + control tower ─────
        // Sits in the open northern apron (z ≈ 130–142), clear of every
        // container yard / warehouse / crane (all at z ≥ 160) and the harbor
        // enemy spawns (z ≥ 178). The runway is a flat decal (no collision);
        // the jet taxis off its west end toward +x.
        {
          const RW_CX = 35
          const RW_CZ = 136
          const RW_LEN = 100 // along x (x: -15 … 85)
          const RW_WID = 12 // along z (z: 130 … 142)
          const runwayMat = new THREE.MeshStandardMaterial({
            color: 0x1b1d22,
            roughness: 0.95,
            metalness: 0,
          })
          const slab = new THREE.Mesh(new THREE.PlaneGeometry(RW_LEN, RW_WID), runwayMat)
          slab.rotation.x = -Math.PI / 2
          slab.position.set(RW_CX, 0.03, RW_CZ)
          slab.receiveShadow = true
          scene.add(slab)
          // Shared marking materials (emissive, no point lights).
          const centerMat = new THREE.MeshStandardMaterial({
            color: 0xe8e8e8,
            emissive: 0xb0b0b0,
            emissiveIntensity: 0.5,
            roughness: 0.7,
          })
          const edgeLightMat = new THREE.MeshStandardMaterial({
            color: 0xffcc55,
            emissive: 0xffaa22,
            emissiveIntensity: 1.8,
            roughness: 0.5,
          })
          const dashGeo = new THREE.PlaneGeometry(3.2, 0.4)
          const lightGeo = new THREE.PlaneGeometry(0.6, 0.6)
          // Centreline dashes down the middle.
          for (let x = RW_CX - RW_LEN / 2 + 4; x < RW_CX + RW_LEN / 2 - 2; x += 6) {
            const dash = new THREE.Mesh(dashGeo, centerMat)
            dash.rotation.x = -Math.PI / 2
            dash.position.set(x, 0.05, RW_CZ)
            scene.add(dash)
          }
          // Edge lights along both long sides.
          for (let x = RW_CX - RW_LEN / 2 + 2; x <= RW_CX + RW_LEN / 2 - 2; x += 8) {
            for (const ez of [RW_CZ - RW_WID / 2, RW_CZ + RW_WID / 2]) {
              const lt = new THREE.Mesh(lightGeo, edgeLightMat)
              lt.rotation.x = -Math.PI / 2
              lt.position.set(x, 0.05, ez)
              scene.add(lt)
            }
          }
          // Phantom footprint so the airfield reads as a structure on the
          // minimap (h < 0 → never collides, bullets pass).
          ALL_AABBS.push({
            x1: RW_CX - RW_LEN / 2,
            x2: RW_CX + RW_LEN / 2,
            z1: RW_CZ - RW_WID / 2,
            z2: RW_CZ + RW_WID / 2,
            h: -1,
          })
          // Enterable hangar just north-west of the runway (door faces the
          // strip). Reuses the hollow-building generator (walls + door + roof).
          const hangarMat = new THREE.MeshStandardMaterial({
            color: 0x6a6e72,
            roughness: 0.8,
            metalness: 0.2,
          })
          const hangarRoofMat = new THREE.MeshStandardMaterial({
            color: 0x4a4e52,
            roughness: 0.85,
            metalness: 0.2,
          })
          makeHollowBuilding({
            x: -14,
            z: 116,
            w: 14,
            d: 12,
            h: 7,
            doorSide: "south",
            doorWidth: 5,
            bldMat: hangarMat,
            roofMat: hangarRoofMat,
          })
          // Control tower (visual only) — a slim shaft + a glass cab on top.
          const towerMat = new THREE.MeshStandardMaterial({
            color: 0x8a8e92,
            roughness: 0.7,
            metalness: 0.35,
          })
          addBox(towerMat, 10, 120, 4, 13, 4)
          const cab = new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.2, 5.2), towerMat)
          cab.position.set(10, 14.2, 120)
          cab.castShadow = true
          scene.add(cab)
          const cabGlass = new THREE.Mesh(
            new THREE.BoxGeometry(5.0, 1.4, 5.0),
            new THREE.MeshStandardMaterial({
              color: 0x0c2230,
              emissive: 0x16384a,
              emissiveIntensity: 0.5,
              roughness: 0.1,
              metalness: 0.8,
            }),
          )
          cabGlass.position.set(10, 14.4, 120)
          scene.add(cabGlass)
        }

        // ── INDUSTRIAL (north, z ≈ -120 to -240) ────────────────────────────
        // Factory halls (big, low boxes) — off the x=50 corridor.
        addBox(factoryMat, 26, -150, 24, 8, 17)
        addBox(factoryMat, 76, -156, 20, 8, 15)
        addBox(factoryMat, 34, -202, 19, 7, 14)
        // Saw-tooth roof accents (rust) on the big halls, purely decorative.
        for (const [rx, rz] of [
          [26, -150],
          [76, -156],
        ] as [number, number][]) {
          const cap = new THREE.Mesh(unitBox, rustMat)
          cap.scale.set(22, 0.6, 15)
          cap.position.set(rx, 8.3, rz)
          scene.add(cap)
        }
        // Chimneys (thin tall cylinders) with rising smoke. Collect tops so the
        // smoke pool below can emit from each.
        const chimneySpots: [number, number][] = [
          [16, -146],
          [30, -146],
          [70, -152],
          [82, -152],
        ]
        const CHIMNEY_TOP_Y = 16
        for (const [cx, cz] of chimneySpots) {
          const stack = new THREE.Mesh(chimneyGeo, rustMat)
          stack.position.set(cx, CHIMNEY_TOP_Y / 2, cz)
          registerSolid(stack, 1.25, 1.25, CHIMNEY_TOP_Y)
        }
        // Gas tanks — a sphere on a short skirt + a squat cylinder beside it.
        {
          const sphere = new THREE.Mesh(tankSphereGeo, tankMat)
          sphere.position.set(58, 3.4, -192)
          registerSolid(sphere, 3.2, 3.2, 6.6)
          const cyl = new THREE.Mesh(tankCylGeo, tankMat)
          cyl.position.set(67, 3, -196)
          registerSolid(cyl, 2.4, 2.4, 6)
        }
        // Perimeter fence along the far-north boundary (z ≈ -236): a row of
        // posts with two rails. Posts are thin — no collision (decorative line).
        {
          const fenceZ = -236
          for (let fx = -40; fx <= 140; fx += 3) {
            const post = new THREE.Mesh(fencePostGeo, steelMat)
            post.position.set(fx, 0.85, fenceZ)
            scene.add(post)
          }
          for (const ry of [0.6, 1.3]) {
            const rail = new THREE.Mesh(fenceRailGeo, steelMat)
            rail.scale.x = 180
            rail.position.set(50, ry, fenceZ)
            scene.add(rail)
          }
        }

        // ── Chimney smoke pool ──────────────────────────────────────────────
        // A fixed pool of puffs per chimney (no per-frame allocation). Each
        // rises, expands and fades, then loops. Updated in the animate loop.
        const smokeGeo = new THREE.SphereGeometry(0.85, sseg(8), sseg(6))
        // Halve the puff pool on touch devices (mobile GPU budget).
        const puffsPerChimney = isTouch ? 2 : 4
        for (const [cx, cz] of chimneySpots) {
          for (let k = 0; k < puffsPerChimney; k++) {
            const mat = new THREE.MeshLambertMaterial({
              color: 0xdadada,
              transparent: true,
              opacity: 0.45,
              depthWrite: false,
            })
            const puff = new THREE.Mesh(smokeGeo, mat)
            puff.position.set(cx, CHIMNEY_TOP_Y, cz)
            scene.add(puff)
            smokePuffs.push({
              mesh: puff,
              baseX: cx,
              baseZ: cz,
              baseY: CHIMNEY_TOP_Y,
              t: k / puffsPerChimney,
              rise: 9 + (k % 2),
            })
          }
        }

        // ── CITY reinforcement ──────────────────────────────────────────────
        // A small park in the open lot on the city's west side (the avenue
        // mouth by spawn) — clear of the office-building footprints that the
        // earlier south-central spot clipped. A green ground patch + trees;
        // the trees carry no collision so they don't wall off the spawn.
        const parkMat = new THREE.MeshStandardMaterial({
          color: zoneTint(0x3c6e32),
          roughness: 0.95,
          metalness: 0,
        })
        const park = new THREE.Mesh(new THREE.PlaneGeometry(18, 14), parkMat)
        park.rotation.x = -Math.PI / 2
        park.position.set(8, 0.015, 50)
        park.receiveShadow = true
        scene.add(park)
        const parkTreeGeo = new THREE.CylinderGeometry(0.16, 0.24, 2.2, 6)
        const parkLeafGeo = new THREE.SphereGeometry(1.2, sseg(8), sseg(6))
        const treeSpots: [number, number][] = [
          [3, 45],
          [12, 46],
          [8, 52],
          [2, 55],
          [14, 54],
        ]
        for (const [tx, tz] of treeSpots) {
          const trunk = new THREE.Mesh(parkTreeGeo, trunkMat)
          trunk.position.set(tx, 1.1, tz)
          trunk.castShadow = true
          scene.add(trunk)
          const leaf = new THREE.Mesh(parkLeafGeo, leavesMat)
          leaf.position.set(tx, 3.0, tz)
          leaf.castShadow = true
          scene.add(leaf)
        }

        // Street lamps along the central N–S road (x=50). Posts alternate sides
        // (x=43 / 57) and a few continue into the districts so the arterial
        // reads as lit at night. Emissive heads only — no PointLights.
        const lampZs: number[] = []
        for (let lz = 8; lz <= 96; lz += 16) lampZs.push(lz)
        for (const lz of [-40, -80, -120, 130, 170, 210]) lampZs.push(lz)
        let lampFlip = false
        for (const lz of lampZs) {
          const lx = lampFlip ? 57 : 43
          lampFlip = !lampFlip
          const post = new THREE.Mesh(lampPostGeo, steelMat)
          post.position.set(lx, 2.5, lz)
          post.castShadow = true
          scene.add(post)
          const head = new THREE.Mesh(lampHeadGeo, lampHeadMat)
          head.position.set(lx + (lx < 50 ? 0.6 : -0.6), 4.8, lz)
          scene.add(head)
        }
      }

      // ── FPS camera state ───────────────────────────────────────────────────
      // West end of the central avenue, with the avenue terminus building
      // visible dead-ahead. Buildings flanking at z=32–44 (north) and
      // z=57–70 (south) sit tight against the avenue (z≈44–57) so they
      // read as "the city's street walls" — no more "off in the distance".
      // SKY arena spawns the player on the airbase apron beside the runway.
      const focalPoint =
        modeRef.current === "hunt"
          ? new THREE.Vector3(HUNT_ROOM.x, 0, HUNT_ROOM.z + 3) // inside the transfer room
          : isSky
            ? new THREE.Vector3(20, 0, 126)
            : new THREE.Vector3(4, 0, 50)
      const camState = { yaw: -Math.PI / 2, pitch: 0 } // facing +X (east)

      function clampPitch(p: number) {
        return Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, p))
      }

      function updateCamera() {
        // focalPoint.y is now the player's foot Y (0 on ground, raised when
        // standing on a rooftop / climbed ladder). Eye sits above feet.
        camera.position.set(focalPoint.x, focalPoint.y + EYE_HEIGHT, focalPoint.z)
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
      // Gun parts live in their own sub-group so we can hide the whole gun and
      // show the knife when slot [4] is equipped (toggled in the animate loop).
      const gunParts = new THREE.Group()
      gunParts.add(makePart(0.08, 0.055, 0.28, 0, 0, 0)) // body
      gunParts.add(makePart(0.032, 0.032, 0.22, 0, 0.016, -0.18)) // barrel
      gunParts.add(makePart(0.055, 0.1, 0.058, 0, -0.075, 0.065)) // grip
      gunParts.add(makePart(0.065, 0.012, 0.12, 0, 0.035, 0.04)) // slide top
      gunGroup.add(gunParts)

      // Knife viewmodel — a short blade + handle. Hidden until slot [4] is
      // selected. The blade pivots from `knifePivot` so the swing animation
      // (driven in the animate loop) rotates the whole knife about the wrist.
      const knifePivot = new THREE.Group()
      const bladeMat = new THREE.MeshLambertMaterial({ color: 0xcdd4dc, depthTest: false })
      const handleMat = new THREE.MeshLambertMaterial({ color: 0x20242a, depthTest: false })
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.05, 0.26), bladeMat)
      blade.position.set(0, 0.02, -0.16)
      blade.renderOrder = 999
      knifePivot.add(blade)
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.03), handleMat)
      guard.position.set(0, 0.0, -0.02)
      guard.renderOrder = 999
      knifePivot.add(guard)
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.11), handleMat)
      handle.position.set(0, -0.02, 0.05)
      handle.renderOrder = 999
      knifePivot.add(handle)
      knifePivot.position.set(0.02, -0.04, 0.02)
      knifePivot.visible = false
      gunGroup.add(knifePivot)

      gunGroup.renderOrder = 999
      scene.add(gunGroup)

      // Muzzle flash light
      const muzzleLight = new THREE.PointLight(0xffee44, 0, 5)
      scene.add(muzzleLight)

      // ── Drivable vehicles ──────────────────────────────────────────────────
      // First-pass: a handful of intact cars parked on the central avenue the
      // player can board (E / mobile button), drive (WASD / left stick), and
      // exit. Distinct from the wrecked MAP_OBJECTS cars (those stay static
      // cover). No run-over, no AI drivers, no destruction yet.
      interface Vehicle {
        group: THREE.Group
        x: number
        z: number
        heading: number // yaw; forward = (-sin, -cos)
        speed: number // m/s along heading (negative = reverse)
        hp: number
        maxHp: number
        dead: boolean // true once destroyed (no longer boardable)
        kind: "car" | "tank" | "jet" | "bike"
        // Tank only: turret yaws to the aim, barrelPivot pitches the gun.
        // (undefined for cars — required-but-nullable to satisfy exactOptional.)
        turret: THREE.Object3D | undefined
        barrelPivot: THREE.Object3D | undefined
        // Set when an AI enemy has commandeered this vehicle (it then hunts the
        // player). The player can't board it until it's destroyed.
        aiDriver: CombatEnemy | null
        // Bike only: the terraformer riding this bike. Unlike aiDriver, the
        // rider stays VISIBLE + HITTABLE (you shoot the roach off, not the
        // bike), so bikes are intentionally kept out of the aiDriver damage
        // path. null = free (player-boardable). PR motorcycle.
        riderEnemy: CombatEnemy | null
        // Tank AI cannon cadence + ram-damage cooldown timestamps (ms).
        aiNextCannon: number
        aiNextRam: number
        // ── Jet flight state (jet only) ──
        y?: number // altitude (m); cars/tanks stay at 0
        airborne?: boolean // true once the jet has rotated off the runway
      }
      const vehicles: Vehicle[] = []
      let activeVehicle: Vehicle | null = null
      // PR motorcycle: a fixed set of bike parking slots. Each refills itself
      // (BIKE_RESPAWN_MS) once its bike is driven off / ridden away / destroyed,
      // so the map stays stocked with rides for the player and the swarm.
      interface BikeSlot {
        x: number
        z: number
        heading: number
        bike: Vehicle | null
        respawnAt: number // 0 = stocked; else the ms timestamp to refill
      }
      const bikeSlots: BikeSlot[] = []

      // ── Visible player rider/pilot avatar (third-person vehicles) ────────────
      // Driving uses a chase camera, so the seat would otherwise look empty (the
      // FPS body is just the hidden focalPoint). This one humanoid — built from
      // primitives, mirroring the terraformer riderEnemy approach — is parented
      // onto whatever the player is driving and reused via .visible (never
      // rebuilt on mount/dismount). Geometry/materials are shared.
      const avatarSkinMat = new THREE.MeshStandardMaterial({ color: 0xe2b48c, roughness: 0.85 })
      // Body/helmet pick up the player's team colour at mount time.
      const avatarBodyMat = new THREE.MeshStandardMaterial({
        color: 0xffcc00,
        roughness: 0.55,
        metalness: 0.25,
      })
      const avatarLimbMat = new THREE.MeshStandardMaterial({ color: 0x232a33, roughness: 0.7 })

      function buildPlayerAvatar(): THREE.Group {
        const g = new THREE.Group()
        // Upper body tilts forward as a unit for the leaning riding pose.
        const upper = new THREE.Group()
        g.add(upper)
        const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.26), avatarBodyMat)
        torso.position.y = 0.33
        torso.castShadow = true
        upper.add(torso)
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), avatarSkinMat)
        head.position.y = 0.78
        head.castShadow = true
        upper.add(head)
        // Team-coloured helmet cap over the crown.
        const helmet = new THREE.Mesh(
          new THREE.SphereGeometry(0.185, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
          avatarBodyMat,
        )
        helmet.position.y = 0.8
        upper.add(helmet)
        // Arms swing forward + down from the shoulders to grip the controls
        // (handlebars / stick / turret grips). Geometry is pivoted at the
        // shoulder so the rotation reads as a reach, not a slide.
        for (const s of [-1, 1]) {
          const armGeo = new THREE.BoxGeometry(0.12, 0.5, 0.12)
          armGeo.translate(0, -0.25, 0)
          const arm = new THREE.Mesh(armGeo, avatarLimbMat)
          arm.position.set(s * 0.27, 0.52, 0)
          arm.rotation.x = 1.1 // reach forward (-z) and slightly down
          upper.add(arm)
        }
        // Legs straddle the seat (hidden for tank/jet where they're inside the
        // hull). Pivoted at the hip; angled forward a touch.
        const legs = new THREE.Group()
        g.add(legs)
        for (const s of [-1, 1]) {
          const legGeo = new THREE.BoxGeometry(0.15, 0.55, 0.15)
          legGeo.translate(0, -0.275, 0)
          const leg = new THREE.Mesh(legGeo, avatarLimbMat)
          leg.position.set(s * 0.13, 0.02, 0)
          leg.rotation.x = 0.45
          legs.add(leg)
        }
        g.userData.upper = upper
        g.userData.legs = legs
        g.visible = false
        return g
      }

      const playerAvatar = buildPlayerAvatar()
      scene.add(playerAvatar)

      // Seat placement per ridden thing, in the parent's local space (vehicle /
      // AA-gun group; forward = -z). `lean` < 0 tips the upper body toward the
      // nose; `legs` hides the legs for closed cockpits/hulls.
      const AVATAR_SEATS: Record<string, { y: number; z: number; lean: number; legs: boolean }> = {
        bike: { y: 0.74, z: 0.33, lean: -0.5, legs: true },
        car: { y: 0.55, z: 0.05, lean: -0.12, legs: true },
        tank: { y: 1.32, z: 0.3, lean: -0.05, legs: false },
        jet: { y: 0.62, z: -1.05, lean: -0.15, legs: false },
        aa: { y: 0.6, z: 0.95, lean: -0.25, legs: true },
      }

      // Parent the avatar onto `parent` at the seat for `kind` and reveal it.
      // Re-parenting auto-detaches it from any previous mount.
      function showPlayerAvatar(parent: THREE.Object3D, kind: string) {
        const seat = AVATAR_SEATS[kind] ?? AVATAR_SEATS.car
        if (!seat) return
        playerAvatar.position.set(0, seat.y, seat.z)
        playerAvatar.rotation.set(0, 0, 0)
        const upper = playerAvatar.userData.upper as THREE.Group
        const legs = playerAvatar.userData.legs as THREE.Group
        upper.rotation.x = seat.lean
        legs.visible = seat.legs
        // Match the player's team colour (FFA → the default self colour).
        const team = myTeamRef.current
        avatarBodyMat.color.setHex(
          team === "red" ? 0xff4444 : team === "blue" ? 0x4488ff : 0xffcc00,
        )
        parent.add(playerAvatar)
        playerAvatar.visible = true
      }

      // Hide the avatar and detach it back to the scene root so a wreck being
      // removed (destroyed / crashing jet) doesn't take the shared mesh with it.
      function hidePlayerAvatar() {
        playerAvatar.visible = false
        scene.add(playerAvatar)
      }

      function makeVehicle(color: number): THREE.Group {
        const g = new THREE.Group()
        const bodyMat = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.45,
          metalness: 0.5,
        })
        const glassMat = new THREE.MeshStandardMaterial({
          color: 0x101820,
          roughness: 0.1,
          metalness: 0.7,
        })
        const tireMat = new THREE.MeshLambertMaterial({ color: 0x111111 })
        // Lower chassis (nose toward -z).
        const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 2.6), bodyMat)
        chassis.position.y = 0.55
        chassis.castShadow = true
        chassis.receiveShadow = true
        g.add(chassis)
        // Cabin / greenhouse, set back from the nose.
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.5, 1.25), bodyMat)
        cabin.position.set(0, 1.02, 0.15)
        cabin.castShadow = true
        g.add(cabin)
        // Windshield (front of cabin, toward -z).
        const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.42, 0.08), glassMat)
        windshield.position.set(0, 1.02, -0.46)
        g.add(windshield)
        const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.42, 0.08), glassMat)
        rearGlass.position.set(0, 1.02, 0.76)
        g.add(rearGlass)
        // Headlights (nose).
        const lightMat = new THREE.MeshStandardMaterial({
          color: 0xfff2b0,
          emissive: 0xffe070,
          emissiveIntensity: 1.2,
        })
        for (const lx of [-0.42, 0.42]) {
          const hl = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.06), lightMat)
          hl.position.set(lx, 0.6, -1.31)
          g.add(hl)
        }
        // Four wheels.
        for (const [wx, wz] of [
          [-0.62, -0.85],
          [0.62, -0.85],
          [-0.62, 0.85],
          [0.62, 0.85],
        ] as [number, number][]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12), tireMat)
          wheel.rotation.z = Math.PI / 2
          wheel.position.set(wx, 0.34, wz)
          wheel.castShadow = true
          g.add(wheel)
        }
        return g
      }

      // ── Motorcycle ──────────────────────────────────────────────────────────
      // Shared materials (created once; every bike instance reuses them, so a
      // swarm of terraformer bikes costs almost nothing). Forward = -z, matching
      // the car / tank / jet convention.
      const bikeFrameMat = new THREE.MeshStandardMaterial({
        color: 0x33373c,
        roughness: 0.4,
        metalness: 0.7,
      })
      const bikeAccentMat = new THREE.MeshStandardMaterial({
        color: 0xb22222,
        roughness: 0.45,
        metalness: 0.5,
      })
      const bikeTireMat = new THREE.MeshLambertMaterial({ color: 0x0d0d0d })
      const bikeSeatMat = new THREE.MeshStandardMaterial({
        color: 0x141414,
        roughness: 0.7,
        metalness: 0.2,
      })
      const bikeHeadlightMat = new THREE.MeshStandardMaterial({
        color: 0xfff2b0,
        emissive: 0xffe070,
        emissiveIntensity: 1.2,
      })
      function makeBike(): THREE.Group {
        const g = new THREE.Group()
        // Two wheels: front (-z), rear (+z).
        for (const wz of [-0.62, 0.62]) {
          const wheel = new THREE.Mesh(
            new THREE.CylinderGeometry(0.34, 0.34, 0.16, 14),
            bikeTireMat,
          )
          wheel.rotation.z = Math.PI / 2
          wheel.position.set(0, 0.34, wz)
          wheel.castShadow = true
          g.add(wheel)
        }
        // Frame spine connecting the wheels.
        const spine = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 1.2), bikeFrameMat)
        spine.position.set(0, 0.5, 0)
        g.add(spine)
        // Fuel tank (accent colour) + engine block.
        const tank = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.6), bikeAccentMat)
        tank.position.set(0, 0.66, 0.05)
        tank.castShadow = true
        g.add(tank)
        const engine = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.4), bikeFrameMat)
        engine.position.set(0, 0.42, 0.05)
        g.add(engine)
        // Seat (toward the rear / +z).
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.5), bikeSeatMat)
        seat.position.set(0, 0.74, 0.42)
        g.add(seat)
        // Front fork (angled down to the front wheel) + handlebar.
        const fork = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), bikeFrameMat)
        fork.position.set(0, 0.55, -0.55)
        fork.rotation.x = 0.4
        g.add(fork)
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.06), bikeFrameMat)
        bar.position.set(0, 0.82, -0.52)
        g.add(bar)
        // Headlight on the nose.
        const hl = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.06), bikeHeadlightMat)
        hl.position.set(0, 0.7, -0.62)
        g.add(hl)
        return g
      }

      // Build a tank: hull + two treads + a yawing turret carrying a pitching
      // barrel. Returns handles so updateVehicle can aim turret/barrel. Forward
      // is -z (same convention as the car), so the gun points -z at rest.
      function makeTank(color: number): {
        group: THREE.Group
        turret: THREE.Group
        barrelPivot: THREE.Group
      } {
        const g = new THREE.Group()
        const hullMat = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.7,
          metalness: 0.45,
        })
        const darkMat = new THREE.MeshStandardMaterial({
          color: 0x1c1f18,
          roughness: 0.85,
          metalness: 0.3,
        })
        // Lighter shade of the hull colour for the nose, so the front reads
        // distinctly from the rest of the body at a glance.
        const frontMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.3),
          roughness: 0.6,
          metalness: 0.45,
        })
        // Glowing headlight / taillight materials (emissive so they read even in
        // shadow). Forward is -z, so headlights face -z and taillights +z.
        const headlightMat = new THREE.MeshStandardMaterial({
          color: 0xfff2a8,
          emissive: 0xffdd44,
          emissiveIntensity: 1.6,
          roughness: 0.4,
          metalness: 0,
        })
        const taillightMat = new THREE.MeshStandardMaterial({
          color: 0xff5555,
          emissive: 0xff1111,
          emissiveIntensity: 1.4,
          roughness: 0.4,
          metalness: 0,
        })
        // Hull (wide, low, long).
        const hull = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 3.4), hullMat)
        hull.position.y = 0.7
        hull.castShadow = true
        hull.receiveShadow = true
        g.add(hull)
        // Sloped glacis at the nose for a tanky read (lighter front colour).
        const glacis = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.5, 0.7), frontMat)
        glacis.position.set(0, 0.55, -1.5)
        glacis.rotation.x = -0.5
        g.add(glacis)
        // Front headlights (two glowing yellow squares on the nose, facing -z).
        for (const lx of [-0.6, 0.6]) {
          const light = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.08), headlightMat)
          light.position.set(lx, 0.7, -1.72)
          g.add(light)
        }
        // Rear taillights (two glowing red squares on the tail, facing +z).
        for (const lx of [-0.6, 0.6]) {
          const light = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.08), taillightMat)
          light.position.set(lx, 0.7, 1.72)
          g.add(light)
        }
        // Two tracks (long dark boxes along the sides).
        for (const tx of [-1.0, 1.0]) {
          const track = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 3.5), darkMat)
          track.position.set(tx, 0.3, 0)
          track.castShadow = true
          g.add(track)
        }
        // Turret (yaws to the aim). Child of hull so it inherits the heading.
        const turret = new THREE.Group()
        turret.position.set(0, 1.15, 0.1)
        g.add(turret)
        const turretBody = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.7), hullMat)
        turretBody.castShadow = true
        turret.add(turretBody)
        const cupola = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.26, 10), hullMat)
        cupola.position.set(0.35, 0.36, 0.3)
        turret.add(cupola)
        // Thin antenna rod off the turret's rear corner (sways visually with the
        // turret since it's parented to it).
        const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.3, 5), darkMat)
        antenna.position.set(-0.55, 0.9, 0.65)
        turret.add(antenna)
        // Barrel pivot at the turret front — pitches the gun up/down.
        const barrelPivot = new THREE.Group()
        barrelPivot.position.set(0, 0.05, -0.7)
        turret.add(barrelPivot)
        // Barrel lengthened to 1.5× (2.2 → 3.3) so the front reads clearly. The
        // rear end stays just behind the pivot; the muzzle follows the new tip.
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 3.3, 10), darkMat)
        barrel.rotation.x = Math.PI / 2 // lie along z
        barrel.position.z = -1.55 // extend forward (-z) from the pivot
        barrel.castShadow = true
        barrelPivot.add(barrel)
        const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.3, 10), darkMat)
        muzzle.rotation.x = Math.PI / 2
        muzzle.position.z = -3.2
        barrelPivot.add(muzzle)
        return { group: g, turret, barrelPivot }
      }

      // Build a fighter jet from primitives: fuselage + nose cone + swept main
      // wings + tail fin + horizontal stabilisers + a glass canopy + twin
      // exhausts. Forward is -z (same convention as the car/tank), so the nose
      // points -z at rest. Shared materials keep it cheap.
      function makeJet(color: number): THREE.Group {
        const g = new THREE.Group()
        // YXZ so flight orientation reads as yaw → pitch → roll (bank).
        g.rotation.order = "YXZ"
        const bodyMat = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.4,
          metalness: 0.6,
        })
        const darkMat = new THREE.MeshStandardMaterial({
          color: 0x20242a,
          roughness: 0.6,
          metalness: 0.5,
        })
        const glassMat = new THREE.MeshStandardMaterial({
          color: 0x0c2230,
          emissive: 0x10303f,
          emissiveIntensity: 0.4,
          roughness: 0.1,
          metalness: 0.8,
        })
        const exhaustMat = new THREE.MeshStandardMaterial({
          color: 0xffaa44,
          emissive: 0xff7722,
          emissiveIntensity: 1.6,
          roughness: 0.5,
        })
        // Fuselage — a long capsule (cylinder lying along z).
        const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 5.2, 12), bodyMat)
        fuse.rotation.x = Math.PI / 2
        fuse.position.y = 1.0
        fuse.castShadow = true
        g.add(fuse)
        // Nose cone (toward -z).
        const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.3, 12), bodyMat)
        nose.rotation.x = -Math.PI / 2
        nose.position.set(0, 1.0, -3.0)
        nose.castShadow = true
        g.add(nose)
        // Canopy (glass bubble, set forward of centre).
        const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), glassMat)
        canopy.scale.set(0.85, 0.7, 1.5)
        canopy.position.set(0, 1.4, -1.1)
        g.add(canopy)
        // Main wings — a single swept-back thin slab spanning both sides.
        const wing = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.12, 1.6), bodyMat)
        wing.position.set(0, 0.95, 0.4)
        wing.castShadow = true
        g.add(wing)
        // Wingtip rake (thin angled tips) for a sharper read.
        for (const s of [-1, 1]) {
          const tip = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 1.0), darkMat)
          tip.position.set(s * 3.4, 0.95, 0.7)
          tip.rotation.y = s * 0.5
          g.add(tip)
        }
        // Horizontal tail stabilisers.
        const htail = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 0.9), bodyMat)
        htail.position.set(0, 1.0, 2.3)
        g.add(htail)
        // Vertical tail fin.
        const vtail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.3, 1.2), bodyMat)
        vtail.position.set(0, 1.7, 2.3)
        vtail.castShadow = true
        g.add(vtail)
        // Twin exhaust glow at the tail (+z).
        for (const ex of [-0.22, 0.22]) {
          const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.4, 10), exhaustMat)
          exhaust.rotation.x = Math.PI / 2
          exhaust.position.set(ex, 1.0, 2.65)
          g.add(exhaust)
        }
        return g
      }

      function spawnVehicle(
        x: number,
        z: number,
        heading: number,
        color: number,
        kind: "car" | "tank" | "jet" | "bike" = "car",
      ): Vehicle {
        const radius =
          kind === "tank"
            ? VEHICLE_TANK_RADIUS
            : kind === "jet"
              ? VEHICLE_JET_RADIUS
              : kind === "bike"
                ? VEHICLE_BIKE_RADIUS
                : VEHICLE_RADIUS
        const safe = findSafeSpawnNear(x, z, radius)
        let group: THREE.Group
        let turret: THREE.Object3D | undefined
        let barrelPivot: THREE.Object3D | undefined
        if (kind === "tank") {
          const t = makeTank(color)
          group = t.group
          turret = t.turret
          barrelPivot = t.barrelPivot
        } else if (kind === "jet") {
          group = makeJet(color)
        } else if (kind === "bike") {
          group = makeBike()
        } else {
          group = makeVehicle(color)
        }
        group.position.set(safe.x, 0, safe.z)
        group.rotation.y = heading
        scene.add(group)
        const maxHp =
          kind === "tank"
            ? VEHICLE_TANK_HP
            : kind === "jet"
              ? VEHICLE_JET_HP
              : kind === "bike"
                ? VEHICLE_BIKE_HP
                : VEHICLE_CAR_HP
        const vehicle: Vehicle = {
          group,
          x: safe.x,
          z: safe.z,
          heading,
          speed: 0,
          hp: maxHp,
          maxHp,
          dead: false,
          kind,
          turret,
          barrelPivot,
          aiDriver: null,
          riderEnemy: null,
          aiNextCannon: 0,
          aiNextRam: 0,
          y: 0,
          airborne: false,
        }
        vehicles.push(vehicle)
        return vehicle
      }

      // Register a bike parking slot and stock it with a bike right away.
      function addBikeSlot(x: number, z: number, heading: number) {
        const slot: BikeSlot = { x, z, heading, bike: null, respawnAt: 0 }
        slot.bike = spawnVehicle(x, z, heading, 0xb22222, "bike")
        bikeSlots.push(slot)
      }

      // Refill bike slots whose bike has been taken (player-driven, ridden by a
      // terraformer, destroyed, or just driven away) after BIKE_RESPAWN_MS.
      function updateBikeRespawns(now: number) {
        for (const slot of bikeSlots) {
          const b = slot.bike
          const vacated =
            !b ||
            b.dead ||
            b === activeVehicle ||
            b.riderEnemy !== null ||
            Math.hypot(b.x - slot.x, b.z - slot.z) > 6
          if (vacated) {
            if (slot.respawnAt === 0) slot.respawnAt = now + BIKE_RESPAWN_MS
            else if (now >= slot.respawnAt) {
              slot.bike = spawnVehicle(slot.x, slot.z, slot.heading, 0xb22222, "bike")
              slot.respawnAt = 0
            }
          } else {
            slot.respawnAt = 0
          }
        }
      }

      // ── Terraformer bike-charge AI ──────────────────────────────────────────
      // A terraformer grabs a free bike (WALK → RIDE) and high-speed charges the
      // player. The rider stays visible + hittable; shoot it off and the bike
      // halts. Multiple terraformers grabbing bikes → an emergent swarm charge.

      // Detach a terraformer from its bike (death, or the player closed in mid-
      // approach). Clears the claim and stops the now-riderless bike.
      function dismountRider(enemy: CombatEnemy) {
        const bike = vehicles.find((v) => v.riderEnemy === enemy)
        if (bike) {
          bike.riderEnemy = null
          bike.speed = 0
        }
        enemy.riding = false
      }

      // Walk a terraformer toward a free bike and mount it once close. Returns
      // true if it handled the enemy's movement this frame (caller skips normal
      // AI), false if no bike was worth pursuing.
      function tryTerraformerSeekBike(enemy: CombatEnemy, dt: number): boolean {
        const ex = enemy.mesh.position.x
        const ez = enemy.mesh.position.z
        // Keep the bike it already claimed; else find the nearest free one.
        let bike = vehicles.find((v) => v.riderEnemy === enemy) ?? null
        if (!bike) {
          let bestD = BIKE_MOUNT_SEEK_RANGE
          for (const v of vehicles) {
            if (v.kind !== "bike" || v.dead || v.aiDriver || v.riderEnemy) continue
            const d = Math.hypot(v.x - ex, v.z - ez)
            if (d < bestD) {
              bestD = d
              bike = v
            }
          }
          if (!bike) return false
          bike.riderEnemy = enemy // claim it (blocks the player + other roaches)
        }
        const dx = bike.x - ex
        const dz = bike.z - ez
        const d = Math.hypot(dx, dz)
        if (d <= BIKE_MOUNT_RADIUS) {
          // Mount: aim the bike at the player and start the charge.
          enemy.riding = true
          bike.heading = Math.atan2(-(focalPoint.x - bike.x), -(focalPoint.z - bike.z))
          bike.speed = 0
          bike.aiNextRam = 0
          enemy.mesh.position.set(bike.x, BIKE_RIDER_SEAT_Y, bike.z)
          enemy.mesh.rotation.y = bike.heading
          return true
        }
        // Stride toward the bike (wall-aware, same steering the roaches use).
        const spd = enemy.config.speed * dt
        const now = Date.now()
        const dir = zombieSteer(enemy, ex, ez, dx, dz, now)
        const nx = ex + dir.x * spd
        const nz = ez + dir.z * spd
        if (!collidesWithWall(nx, ez, ENEMY_RADIUS)) enemy.mesh.position.x = nx
        if (!collidesWithWall(enemy.mesh.position.x, nz, ENEMY_RADIUS)) enemy.mesh.position.z = nz
        enemy.facing.set(dir.x, 0, dir.z)
        enemy.smoothedYaw = Math.atan2(dir.x, dir.z)
        return true
      }

      // Per-frame: drive every terraformer-ridden bike toward the player (fast,
      // rams on contact) and coast any newly-riderless bike to a halt.
      function updateBikeRiders(dt: number) {
        const now = Date.now()
        for (const v of vehicles) {
          if (v.kind !== "bike" || v.dead) continue
          const rider = v.riderEnemy
          if (!rider || !rider.riding || rider.hp <= 0) {
            // Riderless (or rider only approaching / just died): coast to a stop.
            if (!rider && Math.abs(v.speed) > 0.02) {
              v.speed *= Math.max(0, 1 - dt * 3)
              const fx = -Math.sin(v.heading)
              const fz = -Math.cos(v.heading)
              const nx = v.x + fx * v.speed * dt
              const nz = v.z + fz * v.speed * dt
              if (!collidesWithWall(nx, v.z, VEHICLE_BIKE_RADIUS)) v.x = nx
              if (!collidesWithWall(v.x, nz, VEHICLE_BIKE_RADIUS)) v.z = nz
              v.group.position.set(v.x, 0, v.z)
            }
            continue
          }
          // Steer the heading toward the player; throttle hard when aimed.
          const tx = focalPoint.x - v.x
          const tz = focalPoint.z - v.z
          const dist = Math.max(0.001, Math.hypot(tx, tz))
          const desired = Math.atan2(-tx, -tz)
          let dh = desired - v.heading
          while (dh > Math.PI) dh -= Math.PI * 2
          while (dh < -Math.PI) dh += Math.PI * 2
          const turnStep = VEHICLE_BIKE_TURN * dt
          v.heading += Math.max(-turnStep, Math.min(turnStep, dh))
          const throttle = Math.abs(dh) < 0.9 ? 1 : 0.45
          v.speed += throttle * VEHICLE_BIKE_ACCEL * dt
          v.speed = Math.max(-2, Math.min(VEHICLE_BIKE_MAX_SPEED, v.speed))
          const fx = -Math.sin(v.heading)
          const fz = -Math.cos(v.heading)
          const nx = v.x + fx * v.speed * dt
          const nz = v.z + fz * v.speed * dt
          let moved = false
          if (!collidesWithWall(nx, v.z, VEHICLE_BIKE_RADIUS)) {
            v.x = nx
            moved = true
          }
          if (!collidesWithWall(v.x, nz, VEHICLE_BIKE_RADIUS)) {
            v.z = nz
            moved = true
          }
          if (!moved) {
            v.speed *= 0.3
            v.heading += turnStep * (dh >= 0 ? 1 : -1) // wriggle off the wall
          }
          v.group.position.set(v.x, 0, v.z)
          v.group.rotation.y = v.heading
          // Carry the (visible) rider on the bike, facing forward.
          rider.mesh.position.set(v.x, BIKE_RIDER_SEAT_Y, v.z)
          rider.mesh.rotation.y = v.heading
          rider.smoothedYaw = v.heading
          rider.facing.set(fx, 0, fz)
          // Ram the player on contact (low per-bike; the swarm is the threat).
          const ramReach = VEHICLE_BIKE_RADIUS + PLAYER_RADIUS + 0.6
          if (dist < ramReach && Math.abs(v.speed) > 2 && now > v.aiNextRam) {
            v.aiNextRam = now + 700
            applyPlayerDamage(BIKE_RIDER_RAM_DMG, 4)
          }
        }
      }

      // Park a few intact cars along the central avenue (z ≈ 50). Heading
      // -π/2 faces +x (east) — the same direction the player spawns looking.
      // Vehicles are excluded from PvP (FFA/TDM) for now — they aren't synced
      // over the network, so a half-visible combat car would be unfair there.
      // Now the world is 6× larger, vehicles are scattered along the road
      // network instead of bunched on the central avenue: a couple in the city,
      // the rest staged in the HARBOR (south) and INDUSTRIAL (north) districts
      // and on the cross streets, so there's always a ride within reach. They
      // sit on the V_ROADS (x=50/-110/210) and H_ROADS (z=50/-120/200) lanes.
      if (isSky) {
        // SKY: only jets. Four boardable fighters staged along the runway, in
        // every mode (you always need a ride). The sky-arena manager respawns
        // them so the apron is never empty.
        spawnVehicle(-10, 133, -Math.PI / 2, 0x33557a, "jet")
        spawnVehicle(-10, 139, -Math.PI / 2, 0x3a6a8a, "jet")
        spawnVehicle(2, 132, -Math.PI / 2, 0x335a7a, "jet")
        spawnVehicle(2, 140, -Math.PI / 2, 0x2f6f8f, "jet")
      } else if (modeRef.current !== "ffa" && modeRef.current !== "tdm") {
        // City avenue (z≈50)
        spawnVehicle(14, 50, -Math.PI / 2, 0xbb2222)
        spawnVehicle(66, 49, -Math.PI / 2, 0xddaa22)
        // North–south arterial through the city / districts (x≈50)
        spawnVehicle(50, -70, Math.PI, 0x2255bb) // toward INDUSTRIAL
        spawnVehicle(50, 175, 0, 0x22aa88) // toward HARBOR
        // East / west cross streets
        spawnVehicle(-95, 50, -Math.PI / 2, 0xcc7722)
        spawnVehicle(205, 50, Math.PI / 2, 0x8844cc)
        // Drivable tanks (armored, main cannon): one in the city, one staged
        // in each outlying district.
        spawnVehicle(28, 47, -Math.PI / 2, 0x4a5a3a, "tank")
        spawnVehicle(50, -150, Math.PI, 0x5a5048, "tank") // INDUSTRIAL
        spawnVehicle(50, 250, 0, 0x4a4a52, "tank") // HARBOR
        // Fighter jet parked at the west end of the HARBOR airfield runway,
        // nose pointing +x (east) down the strip for a clean takeoff run.
        spawnVehicle(-10, 136, -Math.PI / 2, 0x33557a, "jet")
        // Motorcycles — fast, nimble rides scattered across the districts. In
        // INVASION mode terraformers grab the free ones and swarm-charge, so a
        // few are staged near the central arena where the horde lands.
        addBikeSlot(20, 52, -Math.PI / 2) // city avenue
        addBikeSlot(44, 44, -Math.PI / 2) // city, near spawn
        addBikeSlot(60, 58, Math.PI / 2) // city east
        addBikeSlot(50, -40, Math.PI) // toward INDUSTRIAL
        addBikeSlot(50, 150, 0) // toward HARBOR
      }

      function nearestVehicle(): Vehicle | null {
        let best: Vehicle | null = null
        let bestD = VEHICLE_ENTER_RADIUS
        for (const v of vehicles) {
          if (v.dead || v.aiDriver || v.riderEnemy) continue // occupied → can't board
          const d = Math.hypot(v.x - focalPoint.x, v.z - focalPoint.z)
          if (d < bestD) {
            bestD = d
            best = v
          }
        }
        return best
      }

      function enterVehicle(v: Vehicle) {
        activeVehicle = v
        drivingRef.current = true
        setInVehicle(true)
        setNearVehicle(false)
        prevNearVehicleRef.current = false
        // Drop any climb prompt — the vertical/climb block is skipped while
        // driving, so clear it now or it could stay stuck on screen.
        setNearClimb(false)
        prevNearClimbRef.current = false
        // Cancel any combat state so nothing leaks into driving.
        playerVelRef.current.x = 0
        playerVelRef.current.z = 0
        mouseDownRef.current = false
        isAimingRef.current = false
        setIsAiming(false)
        // Keep the FP weapon hidden — driving uses a third-person view, and
        // bullets fire from the vehicle (the gun view-model would float).
        gunGroup.visible = false
        // Publish vehicle HP to the HUD.
        setVehicleHp(Math.round(v.hp))
        setVehicleMaxHp(v.maxHp)
        // Tanks board with the main cannon selected; cars are handheld-only.
        const isTank = v.kind === "tank"
        drivingKindRef.current = v.kind
        setInTank(isTank)
        cannonModeRef.current = isTank
        setCannonActive(isTank)
        lastCannonRef.current = 0
        setCannonCooldownMs(0)
        prevCannonCdRef.current = 0
        // Jet flight HUD + weapon timers.
        const isJet = v.kind === "jet"
        setInJet(isJet)
        if (isJet) {
          v.y = 0
          v.airborne = false
          lastJetGunRef.current = 0
          lastMissileRef.current = 0
          jetThrottleRef.current = 0
          jetGunHeldRef.current = false
          jetMissileReqRef.current = false
          setMissileCdMs(0)
          prevMissileCdRef.current = 0
          camState.pitch = 0 // level nose for the takeoff roll
        }
        // Seed the free-aim camera looking the way the hull faces, and start
        // "recentered" so a freshly-boarded car isn't aimed off to one side.
        // Jets start level (pitch 0) so a small pull-up reaches the takeoff
        // rotate angle — a nose-down start made liftoff feel impossible.
        camState.yaw = v.heading
        camState.pitch = isJet ? 0 : -0.12
        lastDriveAimRef.current = 0
        // Snap the (hidden) player onto the car.
        focalPoint.x = v.x
        focalPoint.z = v.z
        focalPoint.y = 0
        // Place the camera behind the car immediately so the view doesn't
        // swing in from wherever the FPS camera last sat.
        const fx = -Math.sin(v.heading)
        const fz = -Math.cos(v.heading)
        camera.position.set(
          v.x - fx * VEHICLE_CAM_DIST,
          VEHICLE_CAM_HEIGHT,
          v.z - fz * VEHICLE_CAM_DIST,
        )
        camera.lookAt(v.x + fx * 4, 1.0, v.z + fz * 4)
        // Show the player riding/piloting the vehicle (the seat is otherwise
        // empty under the chase camera).
        showPlayerAvatar(v.group, v.kind)
      }

      function exitVehicle() {
        const v = activeVehicle
        drivingRef.current = false
        setInVehicle(false)
        gunGroup.visible = true
        hidePlayerAvatar()
        if (v) {
          v.speed = 0
          // Step out to the left side of the car, nudged to clear ground.
          const sideX = Math.cos(v.heading)
          const sideZ = -Math.sin(v.heading)
          const safe = findSafeSpawnNear(v.x + sideX * 1.9, v.z + sideZ * 1.9, PLAYER_RADIUS)
          focalPoint.x = safe.x
          focalPoint.z = safe.z
          focalPoint.y = 0
          // Resume FPS facing the car's forward direction.
          camState.yaw = v.heading
          camState.pitch = 0
          updateCamera()
        }
        activeVehicle = null
        playerVelRef.current.x = 0
        playerVelRef.current.z = 0
        playerVelYRef.current = 0
        setVehicleHp(0)
        setVehicleMaxHp(0)
        cannonModeRef.current = false
        setCannonActive(false)
        setCannonCooldownMs(0)
        setInTank(false)
        setInJet(false)
        jetThrottleRef.current = 0
        jetGunHeldRef.current = false
        jetMissileReqRef.current = false
        setMissileCdMs(0)
        drivingKindRef.current = null
        // Mount/dismount opening: handheld fire is locked briefly so hopping
        // out of a tank mid-fight leaves the player momentarily exposed.
        fireLockUntilRef.current = Date.now() + VEHICLE_EXIT_FIRE_LOCK_MS
      }

      // Route incoming damage to the vehicle the player is riding (the vehicle
      // acts as a shield — the player inside is untouched until it blows up).
      // Tanks shrug off small arms (bullets / claws); explosives hit full.
      function damageActiveVehicle(dmg: number, type: "bullet" | "explosive" = "bullet") {
        const v = activeVehicle
        if (!v || v.dead || dmg <= 0) return
        const applied = v.kind === "tank" && type !== "explosive" ? dmg * TANK_ARMOR_BULLET : dmg
        v.hp = Math.max(0, v.hp - applied)
        setVehicleHp(Math.round(v.hp))
        if (v.hp <= 0) {
          // A downed jet auto-ejects the pilot under a parachute. If it was
          // airborne, the empty jet keeps flying on its last heading and blows
          // up when it finally hits the ground / a building (continueCrash);
          // if it was already low / taxiing, it just detonates in place.
          if (v.kind === "jet") ejectFromJet((v.y ?? 0) > 3)
          else destroyActiveVehicle()
        }
      }

      // Vehicle destroyed: big blast, the player is thrown clear and takes a
      // heavy (but non-lethal) hit, and the wreck is removed (no re-boarding).
      function destroyActiveVehicle() {
        const v = activeVehicle
        if (!v) return
        v.dead = true
        const burst = new THREE.Vector3(v.x, 1.0, v.z)
        spawnExplosion(burst)
        spawnExplosion(burst) // doubled for a meatier vehicle blast
        SOUNDS.damage()
        lastNoiseRef.current = { x: v.x, z: v.z, expires: Date.now() + 4000 }
        // Eject the player beside the wreck (resets driving state + camera).
        exitVehicle()
        // Heavy ejection damage, floored so it never kills outright (生存).
        if (gamePhaseRef.current === "playing") {
          playerHpRef.current = Math.max(1, playerHpRef.current - VEHICLE_EJECT_DAMAGE)
          setPlayerHp(playerHpRef.current)
          lastDamageTimeRef.current = Date.now()
          cameraShakeRef.current.intensity = 6
          setDamageFlash(true)
          setTimeout(() => setDamageFlash(false), 360)
        }
        // Remove the wreck mesh from the scene.
        scene.remove(v.group)
      }

      // PR-G1: a mounted AA gunner is shielded by the turret, so incoming damage
      // is halved. No-op (×1) on foot or while driving. Hoisted so every player-
      // damage site can route through it.
      function aaShield(raw: number) {
        let dmg = aaMountedRef.current ? raw * AA_MOUNT_DMG_MULT : raw
        // HUNT suit: durability soaks the hit and only HUNT_SUIT_CUT of it reaches
        // HP; the suit breaks (all effects gone) once durability hits 0.
        if (huntSuitActiveRef.current && huntSuitDurRef.current > 0) {
          huntSuitDurRef.current = Math.max(0, huntSuitDurRef.current - dmg)
          setHuntSuitDur(huntSuitDurRef.current)
          setHuntSuitFlash(true)
          window.setTimeout(() => setHuntSuitFlash(false), 130)
          if (huntSuitDurRef.current <= 0) huntBreakSuit()
          dmg = dmg * HUNT_SUIT_CUT
        }
        return dmg
      }

      // ── Enemy-driven vehicles ───────────────────────────────────────────────
      // Apply damage to the player, routed through their own vehicle if they're
      // riding one (the shield rule from PR1). Shared by enemy rams / shells.
      function applyPlayerDamage(dmg: number, shake = 2) {
        if (gamePhaseRef.current !== "playing" || Date.now() <= spawnInvulnUntilRef.current) return
        if (drivingRef.current && activeVehicle) {
          damageActiveVehicle(dmg, "bullet")
          return
        }
        playerHpRef.current = Math.max(0, playerHpRef.current - aaShield(dmg))
        setPlayerHp(playerHpRef.current)
        lastDamageTimeRef.current = Date.now()
        cameraShakeRef.current.intensity = shake
        setDamageFlash(true)
        setTimeout(() => setDamageFlash(false), 300)
        SOUNDS.damage()
        if (playerHpRef.current <= 0) {
          gamePhaseRef.current = "gameover"
          setGamePhase("gameover")
          deathsRef.current += 1
          setDeaths(deathsRef.current)
        }
      }

      // An enemy commandeers a free vehicle: spawn a hidden driver enemy bound
      // to it and start hunting the player. Full HP on takeover.
      function commandeerVehicle(v: Vehicle, type: EnemyType) {
        const driver = makeEnemy(type, v.x, v.z)
        driver.aiDriving = true
        driver.mesh.visible = false
        enemies.push(driver)
        v.aiDriver = driver
        v.hp = v.kind === "tank" ? ENEMY_VEH_TANK_HP : ENEMY_VEH_CAR_HP
        setAliveEnemyCount(enemies.filter((e) => e.hp > 0).length)
        v.aiNextCannon = Date.now() + 2200
        v.aiNextRam = 0
        SOUNDS.alert()
        showNotification(v.kind === "tank" ? "⚠ 敵戦車が出撃！" : "⚠ 敵が車両を奪った！")
      }

      // Player damaged an enemy vehicle (bullets / claws reduced for tanks,
      // explosives full). Destroying it kills the driver.
      function damageEnemyVehicle(v: Vehicle, dmg: number, type: "bullet" | "explosive") {
        if (v.dead || !v.aiDriver || dmg <= 0) return
        const applied = v.kind === "tank" && type !== "explosive" ? dmg * TANK_ARMOR_BULLET : dmg
        v.hp = Math.max(0, v.hp - applied)
        if (v.hp <= 0) destroyEnemyVehicle(v)
      }

      function destroyEnemyVehicle(v: Vehicle) {
        if (v.dead) return
        v.dead = true
        const burst = new THREE.Vector3(v.x, 1.2, v.z)
        spawnExplosion(burst)
        spawnExplosion(burst)
        SOUNDS.damage()
        lastNoiseRef.current = { x: v.x, z: v.z, expires: Date.now() + 4000 }
        const driver = v.aiDriver
        v.aiDriver = null
        scene.remove(v.group)
        // Kill the driver (counts for score / killfeed). Show the body for a
        // beat at the wreck — applyEnemyKill plays its death anim.
        if (driver && driver.hp > 0) {
          driver.aiDriving = false
          driver.mesh.visible = true
          driver.mesh.position.set(v.x, 0, v.z)
          driver.hp = 1
          applyEnemyKill(driver, "vehicle")
        }
      }

      // One enemy-driven vehicle's per-frame AI: pursue + ram, tanks also shell.
      function updateEnemyVehicle(v: Vehicle, dt: number) {
        if (v.dead || !v.aiDriver) return
        const isTank = v.kind === "tank"
        const MAXS = isTank ? VEHICLE_TANK_MAX_SPEED : VEHICLE_MAX_SPEED
        const ACCEL = isTank ? VEHICLE_TANK_ACCEL : VEHICLE_ACCEL
        const TURN = isTank ? VEHICLE_TANK_TURN : VEHICLE_TURN_RATE
        const RADIUS = isTank ? VEHICLE_TANK_RADIUS : VEHICLE_RADIUS
        const now = Date.now()

        const tx = focalPoint.x - v.x
        const tz = focalPoint.z - v.z
        const dist = Math.max(0.001, Math.hypot(tx, tz))
        // Forward = (-sin h, -cos h); steer heading so forward points at player.
        const desired = Math.atan2(-tx, -tz)
        let dh = desired - v.heading
        while (dh > Math.PI) dh -= Math.PI * 2
        while (dh < -Math.PI) dh += Math.PI * 2
        const turnStep = TURN * dt
        v.heading += Math.max(-turnStep, Math.min(turnStep, dh))

        // Throttle hard when roughly aimed at the player; ease off when it has
        // to turn a lot so it doesn't just circle.
        const throttle = Math.abs(dh) < 0.8 ? 1 : 0.4
        v.speed += throttle * ACCEL * dt
        v.speed = Math.max(-2, Math.min(MAXS, v.speed))

        const fx = -Math.sin(v.heading)
        const fz = -Math.cos(v.heading)
        const nx = v.x + fx * v.speed * dt
        const nz = v.z + fz * v.speed * dt
        let moved = false
        if (!collidesWithWall(nx, v.z, RADIUS)) {
          v.x = nx
          moved = true
        }
        if (!collidesWithWall(v.x, nz, RADIUS)) {
          v.z = nz
          moved = true
        }
        if (!moved) {
          v.speed *= 0.3
          v.heading += turnStep * (dh >= 0 ? 1 : -1) // wriggle off the wall
        }
        v.group.position.set(v.x, 0, v.z)
        v.group.rotation.y = v.heading
        v.aiDriver.mesh.position.set(v.x, 0, v.z)

        // Tank turret/barrel track the player.
        if (isTank && v.turret && v.barrelPivot) {
          let ty = desired - v.heading
          while (ty > Math.PI) ty -= Math.PI * 2
          while (ty < -Math.PI) ty += Math.PI * 2
          const tb = 1 - Math.exp(-dt * 8)
          v.turret.rotation.y += (ty - v.turret.rotation.y) * tb
          v.barrelPivot.rotation.x += (0.05 - v.barrelPivot.rotation.x) * tb
        }

        // Ram the player (cooldown-gated so contact doesn't drain every frame).
        const ramReach = RADIUS + PLAYER_RADIUS + 0.5
        if (dist < ramReach && Math.abs(v.speed) > 1.0 && now > v.aiNextRam) {
          v.aiNextRam = now + 700
          applyPlayerDamage(isTank ? 40 : 28, 5)
        }

        // Tank shells the player from range (LOS-gated, on a cadence).
        if (
          isTank &&
          dist > 6 &&
          dist < 45 &&
          now > v.aiNextCannon &&
          !zombieLosBlocked(v.x, v.z, focalPoint.x, focalPoint.z)
        ) {
          v.aiNextCannon = now + 3200 + Math.random() * 1500
          const aimX = focalPoint.x + playerVelRef.current.x * 0.4 - v.x
          const aimZ = focalPoint.z + playerVelRef.current.z * 0.4 - v.z
          const ad = Math.max(0.001, Math.hypot(aimX, aimZ))
          const shell = new THREE.Mesh(
            new THREE.SphereGeometry(0.22, 8, 6),
            new THREE.MeshBasicMaterial({ color: 0xffaa44 }),
          )
          shell.position.set(v.x + (aimX / ad) * 3.0, 1.7, v.z + (aimZ / ad) * 3.0)
          scene.add(shell)
          bullets.push({
            mesh: shell,
            velocity: new THREE.Vector3(
              (aimX / ad) * CANNON_SHELL_SPEED,
              3.0,
              (aimZ / ad) * CANNON_SHELL_SPEED,
            ),
            life: 2.6,
            isEnemy: true,
            damage: 0,
            isGrenade: true,
            grenadeRadius: CANNON_RADIUS,
          })
          SOUNDS.shotgun()
        }
      }

      // Shared jet weapon visuals (one material each, reused per shot).
      const jetTracerMat = new THREE.MeshBasicMaterial({ color: 0xffee66, depthTest: false })
      const jetMissileMat = new THREE.MeshStandardMaterial({
        color: 0x9aa0a6,
        roughness: 0.4,
        metalness: 0.6,
        emissive: 0x331100,
        emissiveIntensity: 0.6,
      })

      // ── PR-G1: RPG rocket + smoke trail + map pickups (shared geo/mat) ──────
      const rpgRocketGeo = new THREE.BoxGeometry(0.22, 0.22, 1.0)
      const rpgRocketMat = new THREE.MeshStandardMaterial({
        color: 0x553322,
        roughness: 0.5,
        metalness: 0.5,
        emissive: 0xff5522,
        emissiveIntensity: 0.7,
      })
      const rpgSmokeGeo = new THREE.SphereGeometry(0.4, sseg(6), sseg(5))
      const rpgSmokeMat = new THREE.MeshBasicMaterial({
        color: 0xbbbbbb,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      })
      const rpgPickupMat = new THREE.MeshStandardMaterial({
        color: 0x556622,
        roughness: 0.6,
        metalness: 0.4,
        emissive: 0xff6622,
        emissiveIntensity: 0.45,
      })
      // Cosmetic rocket exhaust puffs (cheap; scale-grow, no per-puff fade).
      const rocketPuffs: { mesh: THREE.Mesh; life: number }[] = []

      // ── PR-F2 systems: anti-air guns, enemy jets, crashing jets, parachute ──
      // Shared materials / geometry (created once; reused per instance).
      const AA_FWD = new THREE.Vector3(0, 0, -1)
      const aaBaseMat = new THREE.MeshStandardMaterial({
        color: 0x4a4e44,
        roughness: 0.7,
        metalness: 0.45,
      })
      const aaBarrelMat = new THREE.MeshStandardMaterial({
        color: 0x26291f,
        roughness: 0.5,
        metalness: 0.6,
      })
      const aaShellMat = new THREE.MeshBasicMaterial({ color: 0xffdd66 })
      const aaShellGeo = new THREE.SphereGeometry(0.26, sseg(6), sseg(5))
      // Canopy materials are created per-deploy (in openChute) so closeChute can
      // dispose them along with the geometry without affecting a later chute.

      interface AAGun {
        group: THREE.Group
        turret: THREE.Group
        x: number
        z: number
        baseY: number
        hp: number
        dead: boolean
        nextFire: number
        meshes: THREE.Mesh[]
      }
      const aaGuns: AAGun[] = []
      // PR-G1: handheld RPG pickups scattered on the map. Walk over one to arm
      // the launcher.
      interface RPGPickup {
        group: THREE.Group
        x: number
        z: number
        y: number
        taken: boolean
      }
      const rpgPickups: RPGPickup[] = []
      interface AAShell {
        mesh: THREE.Mesh
        pos: THREE.Vector3
        vel: THREE.Vector3
        life: number
        // PR-G1: true for shells the player fires from a mounted AA gun — these
        // hunt enemy jets instead of the (AI-only) "damage the player jet" path.
        friendly?: boolean
      }
      const aaShells: AAShell[] = []
      interface EnemyJet {
        group: THREE.Group
        x: number
        y: number
        z: number
        heading: number
        pitch: number
        speed: number
        hp: number
        dead: boolean
        state: "patrol" | "chase" | "attack" | "evade" | "ground_strafe"
        stateUntil: number
        nextFire: number
        evadeYaw: number
        wpIndex: number
        noCrashUntil: number
        nextGroundStrafe: number // ms timestamp the next ground-strafe run is allowed
      }
      const enemyJets: EnemyJet[] = []
      interface CrashJet {
        group: THREE.Group
        x: number
        y: number
        z: number
        heading: number
        pitch: number
        speed: number
      }
      const crashJets: CrashJet[] = []
      // Patrol circuit over the airfield + harbor (x, y=altitude, z).
      const ENEMY_JET_WAYPOINTS: [number, number, number][] = [
        [35, 38, 100],
        [85, 45, 175],
        [40, 42, 235],
        [-10, 40, 175],
      ]

      // Build a fixed AA gun: pedestal + a turret (barrels point -z) that aims
      // via quaternion slerp. Returns nothing; pushes into aaGuns.
      function makeAAGun(x: number, z: number, baseY: number) {
        const g = new THREE.Group()
        g.position.set(x, baseY, z)
        const base = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.3, 0.8, 10), aaBaseMat)
        base.position.y = 0.4
        base.castShadow = true
        g.add(base)
        const turret = new THREE.Group()
        turret.position.y = 1.1
        g.add(turret)
        const housing = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), aaBaseMat)
        turret.add(housing)
        for (const bx of [-0.18, 0.18]) {
          const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.4, 8), aaBarrelMat)
          barrel.rotation.x = Math.PI / 2
          barrel.position.set(bx, 0, -1.0)
          barrel.castShadow = true
          turret.add(barrel)
        }
        scene.add(g)
        const meshes: THREE.Mesh[] = []
        g.traverse((c) => {
          if (c instanceof THREE.Mesh) {
            c.userData.aaGunIndex = aaGuns.length
            meshes.push(c)
          }
        })
        aaGuns.push({
          group: g,
          turret,
          x,
          z,
          baseY,
          hp: AA_GUN_HP,
          dead: false,
          nextFire: 0,
          meshes,
        })
      }

      function destroyAAGun(gun: AAGun) {
        if (gun.dead) return
        gun.dead = true
        spawnExplosion(new THREE.Vector3(gun.x, gun.baseY + 1.0, gun.z))
        scene.remove(gun.group)
      }

      function fireAAShell(gun: AAGun, gunY: number, tx: number, ty: number, tz: number) {
        const dir = new THREE.Vector3(tx - gun.x, ty - gunY, tz - gun.z).normalize()
        const mesh = new THREE.Mesh(aaShellGeo, aaShellMat)
        const pos = new THREE.Vector3(gun.x, gunY, gun.z)
        mesh.position.copy(pos)
        scene.add(mesh)
        aaShells.push({ mesh, pos, vel: dir.multiplyScalar(AA_SHELL_SPEED), life: 4 })
        SOUNDS.pistol()
      }

      // AA guns aim + fire only while the player is flying a jet (asleep
      // otherwise — no barrel updates, no shells).
      function updateAAGuns(dt: number) {
        const jet = drivingRef.current && activeVehicle?.kind === "jet" ? activeVehicle : null
        if (!jet) return
        const now = Date.now()
        const jy = jet.y ?? 0
        for (const gun of aaGuns) {
          if (gun.dead || gun === activeAAGun) continue // the player mans this one
          const gunY = gun.baseY + 1.1
          const dx = jet.x - gun.x
          const dy = jy - gunY
          const dz = jet.z - gun.z
          const d = Math.hypot(dx, dy, dz)
          if (d > AA_RANGE || jy < AA_MIN_ALT) continue
          const dir = new THREE.Vector3(dx / d, dy / d, dz / d)
          const tq = new THREE.Quaternion().setFromUnitVectors(AA_FWD, dir)
          gun.turret.quaternion.slerp(tq, 1 - Math.exp(-dt * 5))
          if (now > gun.nextFire) {
            gun.nextFire = now + AA_FIRE_INTERVAL_MIN + Math.random() * AA_FIRE_INTERVAL_VAR
            fireAAShell(gun, gunY, jet.x, jy, jet.z)
          }
        }
      }

      function updateAAShells(dt: number) {
        const jet = drivingRef.current && activeVehicle?.kind === "jet" ? activeVehicle : null
        for (let i = aaShells.length - 1; i >= 0; i--) {
          const s = aaShells[i]
          if (!s) continue
          s.pos.addScaledVector(s.vel, dt)
          s.mesh.position.copy(s.pos)
          s.life -= dt
          let detonate = false
          let direct = false
          // Player shells hunt the nearest enemy jet; AI shells chase the
          // player's jet (the original behaviour).
          const targetJet = s.friendly ? nearestJetTo(s.pos.x, s.pos.y, s.pos.z) : null
          const tgt = s.friendly
            ? targetJet
              ? { x: targetJet.x, y: targetJet.y, z: targetJet.z }
              : null
            : jet
              ? { x: jet.x, y: jet.y ?? 0, z: jet.z }
              : null
          if (tgt) {
            const d = Math.hypot(s.pos.x - tgt.x, s.pos.y - tgt.y, s.pos.z - tgt.z)
            if (d < AA_DIRECT_RADIUS) {
              detonate = true
              direct = true
            } else if ((s.life <= 0 || s.pos.y <= 0) && d < AA_SPLASH_RADIUS) {
              detonate = true
            }
          }
          // Friendly shells also detonate against the Big Cockroach boss when a
          // manually-aimed shot flies into its (huge) body volume.
          if (
            !detonate &&
            s.friendly &&
            s.pos.y > 1 &&
            s.pos.y < 26 &&
            isPointInBigBossHitVolume(s.pos.x, s.pos.z)
          ) {
            detonate = true
            direct = true
          }
          if (!detonate && (s.life <= 0 || s.pos.y <= 0)) detonate = true
          if (detonate) {
            spawnExplosion(s.pos.clone())
            if (s.friendly) {
              if (isPointInBigBossHitVolume(s.pos.x, s.pos.z)) {
                bossTakeDamage(direct ? AA_MOUNT_SHELL_DIRECT : AA_MOUNT_SHELL_SPLASH)
              }
              if (targetJet && !targetJet.dead) {
                const d = Math.hypot(
                  s.pos.x - targetJet.x,
                  s.pos.y - targetJet.y,
                  s.pos.z - targetJet.z,
                )
                if (direct || d < AA_SPLASH_RADIUS) {
                  targetJet.hp -= direct ? AA_MOUNT_SHELL_DIRECT : AA_MOUNT_SHELL_SPLASH
                  if (targetJet.hp <= 0) {
                    scoreRef.current += 1200
                    setScore(scoreRef.current)
                    if (isSky) {
                      killsRef.current += 1
                      setKills(killsRef.current)
                    }
                    killEnemyJet(targetJet)
                  }
                }
              }
            } else if (
              jet &&
              (direct ||
                Math.hypot(s.pos.x - jet.x, s.pos.y - (jet.y ?? 0), s.pos.z - jet.z) <
                  AA_SPLASH_RADIUS)
            ) {
              damageActiveVehicle(direct ? AA_SHELL_DIRECT : AA_SHELL_SPLASH, "explosive")
            }
            scene.remove(s.mesh)
            aaShells.splice(i, 1)
          }
        }
      }

      // ── PR-G1: player-mounted AA gun ────────────────────────────────────────
      // Board a fixed AA gun with [E]: the turret auto-tracks the nearest jet
      // (slerp) while the player adds a ±30° manual correction with the mouse,
      // and FIRE launches shells that hunt enemy jets. Third-person turret view;
      // on-foot movement is locked while seated.
      let activeAAGun: AAGun | null = null
      let lastAAMountFire = 0

      function nearestAAGunTo(): AAGun | null {
        let best: AAGun | null = null
        let bestD = AA_MOUNT_RADIUS
        for (const gun of aaGuns) {
          if (gun.dead) continue
          const d = Math.hypot(gun.x - focalPoint.x, gun.z - focalPoint.z)
          if (d < bestD) {
            bestD = d
            best = gun
          }
        }
        return best
      }

      function nearestJetTo(x: number, y: number, z: number): EnemyJet | null {
        let best: EnemyJet | null = null
        let bestD = Number.POSITIVE_INFINITY
        for (const ej of enemyJets) {
          if (ej.dead) continue
          const d = Math.hypot(ej.x - x, ej.y - y, ej.z - z)
          if (d < bestD) {
            bestD = d
            best = ej
          }
        }
        return best
      }

      function enterAAGun(gun: AAGun) {
        activeAAGun = gun
        aaMountedRef.current = true
        setInAAGun(true)
        setNearAAGun(false)
        prevNearAAGunRef.current = false
        // Drop the vehicle + climb prompts — both blocks are inert while mounted.
        setNearVehicle(false)
        prevNearVehicleRef.current = false
        setNearClimb(false)
        prevNearClimbRef.current = false
        // Cancel combat state so nothing leaks into the turret.
        playerVelRef.current.x = 0
        playerVelRef.current.z = 0
        mouseDownRef.current = false
        isAimingRef.current = false
        setIsAiming(false)
        gunGroup.visible = false
        aaManualYawRef.current = 0
        aaManualPitchRef.current = 0
        lastAAMountFire = 0
        // Snap the (hidden) player onto the gun base.
        focalPoint.x = gun.x
        focalPoint.z = gun.z
        focalPoint.y = gun.baseY
        // Show the gunner manning the turret.
        showPlayerAvatar(gun.group, "aa")
      }

      function exitAAGun() {
        const gun = activeAAGun
        aaMountedRef.current = false
        setInAAGun(false)
        gunGroup.visible = true
        hidePlayerAvatar()
        if (gun) {
          // Step out beside the gun, nudged clear of the pedestal.
          const safe = findSafeSpawnNear(gun.x + 2.2, gun.z + 0.6, PLAYER_RADIUS)
          focalPoint.x = safe.x
          focalPoint.z = safe.z
          focalPoint.y = gun.baseY
          camState.pitch = 0
          updateCamera()
        }
        activeAAGun = null
        playerVelRef.current.x = 0
        playerVelRef.current.z = 0
        // Same brief fire-lock as dismounting a vehicle (exposure window).
        fireLockUntilRef.current = Date.now() + VEHICLE_EXIT_FIRE_LOCK_MS
      }

      // Per-frame while mounted: aim the turret (auto-track + manual ±30°), park
      // the chase camera behind it, and fire on the player's cadence.
      function updateMountedAA(dt: number) {
        const gun = activeAAGun
        if (!gun || gun.dead) {
          if (aaMountedRef.current) exitAAGun() // gun destroyed under us
          return
        }
        const gunY = gun.baseY + 1.1
        // Auto-track the nearest jet (default: forward + up when none in sight).
        const jet = nearestJetTo(gun.x, gunY, gun.z)
        let az: number
        let el: number
        if (jet) {
          const dx = jet.x - gun.x
          const dy = jet.y - gunY
          const dz = jet.z - gun.z
          az = Math.atan2(dx, dz) // azimuth, 0 = +z
          el = Math.atan2(dy, Math.max(0.001, Math.hypot(dx, dz)))
        } else {
          az = camState.yaw
          el = 0.5 // ~29° up when nothing to track
        }
        // Player's manual ±30° correction on top of the lock.
        az += aaManualYawRef.current
        el = Math.max(-0.2, Math.min(1.3, el + aaManualPitchRef.current))
        const ch = Math.cos(el)
        const aim = new THREE.Vector3(Math.sin(az) * ch, Math.sin(el), Math.cos(az) * ch)
        // Slerp the turret toward the aim (barrels point -z → AA_FWD).
        const tq = new THREE.Quaternion().setFromUnitVectors(AA_FWD, aim)
        gun.turret.quaternion.slerp(tq, 1 - Math.exp(-dt * 8))
        // Third-person chase camera behind the turret, looking along the aim.
        const camX = gun.x - aim.x * AA_MOUNT_CAM_DIST
        const camY = gunY + AA_MOUNT_CAM_HEIGHT - aim.y * 1.5
        const camZ = gun.z - aim.z * AA_MOUNT_CAM_DIST
        const blend = 1 - Math.exp(-dt * 12)
        camera.position.x += (camX - camera.position.x) * blend
        camera.position.y += (camY - camera.position.y) * blend
        camera.position.z += (camZ - camera.position.z) * blend
        camera.lookAt(gun.x + aim.x * 6, gunY + aim.y * 6, gun.z + aim.z * 6)
        // Fire on the player's cadence while FIRE is held.
        const now = Date.now()
        if (
          mouseDownRef.current &&
          gamePhaseRef.current === "playing" &&
          now - lastAAMountFire >= AA_MOUNT_FIRE_INTERVAL_MS
        ) {
          lastAAMountFire = now
          const muzzle = new THREE.Vector3(
            gun.x + aim.x * 2.4,
            gunY + aim.y * 2.4,
            gun.z + aim.z * 2.4,
          )
          const mesh = new THREE.Mesh(aaShellGeo, aaShellMat)
          mesh.position.copy(muzzle)
          scene.add(mesh)
          aaShells.push({
            mesh,
            pos: muzzle.clone(),
            vel: aim.clone().multiplyScalar(AA_MOUNT_SHELL_SPEED),
            life: 5,
            friendly: true,
          })
          SOUNDS.pistol()
          cameraShakeRef.current.intensity = 1.5
        }
      }

      // Spawn an enemy jet. y=0 launches off the runway (climb-out grace); a
      // positive y drops it straight into the fight at altitude (SKY arena).
      function spawnEnemyJet(x: number, z: number, heading: number, y = 0) {
        const group = makeJet(0x992222)
        group.position.set(x, y, z)
        group.rotation.y = heading
        scene.add(group)
        enemyJets.push({
          group,
          x,
          y,
          z,
          heading,
          pitch: y > 5 ? 0 : 0.32,
          speed: ENEMY_JET_SPEED,
          hp: ENEMY_JET_HP,
          dead: false,
          state: "patrol",
          stateUntil: 0,
          nextFire: 0,
          evadeYaw: 0,
          wpIndex: 0,
          // Altitude spawns get a short grace so the bounds / collision check
          // can't kill them on the very first frame; ground launches get longer.
          noCrashUntil: Date.now() + (y > 5 ? 3000 : 4500),
          // Stagger the first strafe (8–18s) so a flight doesn't dive in unison.
          nextGroundStrafe: Date.now() + 8000 + Math.random() * 10000,
        })
      }

      function killEnemyJet(ej: EnemyJet) {
        if (ej.dead) return
        ej.dead = true
        const b = new THREE.Vector3(ej.x, ej.y + 0.5, ej.z)
        spawnExplosion(b)
        spawnExplosion(b)
        SOUNDS.damage()
        scene.remove(ej.group)
      }

      function updateEnemyJets(dt: number) {
        if (enemyJets.length === 0) return
        const now = Date.now()
        const jet = drivingRef.current && activeVehicle?.kind === "jet" ? activeVehicle : null
        for (const ej of enemyJets) {
          if (ej.dead) continue
          // Target selection / state machine.
          let tx: number
          let ty: number
          let tz: number
          const pdx = jet ? jet.x - ej.x : 0
          const pdy = jet ? (jet.y ?? 0) - ej.y : 0
          const pdz = jet ? jet.z - ej.z : 0
          const pdist = jet ? Math.hypot(pdx, pdy, pdz) : Number.POSITIVE_INFINITY
          if (ej.state === "evade" && now > ej.stateUntil) ej.state = "patrol"
          if (!jet) {
            // Player is on foot (or in a ground vehicle). Patrol, but peel off
            // into a strafing run on a timer when they're within range. SKY is
            // excluded (no ground to strafe there).
            if (ej.state === "ground_strafe") {
              // keep strafing — the pull-up check below ends the run
            } else if (ej.state !== "evade") {
              const fhoriz = Math.hypot(focalPoint.x - ej.x, focalPoint.z - ej.z)
              if (
                !isSky &&
                gamePhaseRef.current === "playing" &&
                now > ej.nextGroundStrafe &&
                now > ej.noCrashUntil &&
                fhoriz < ENEMY_JET_STRAFE_RANGE
              ) {
                ej.state = "ground_strafe"
                ej.nextGroundStrafe = now + ENEMY_JET_STRAFE_INTERVAL_MS + Math.random() * 10000
              } else {
                ej.state = "patrol"
              }
            }
          } else if (ej.state !== "evade") {
            // Facing test for ATTACK.
            const fwd = new THREE.Vector3(
              -Math.sin(ej.heading) * Math.cos(ej.pitch),
              Math.sin(ej.pitch),
              -Math.cos(ej.heading) * Math.cos(ej.pitch),
            )
            const toP = new THREE.Vector3(pdx, pdy, pdz).normalize()
            const facing = fwd.dot(toP)
            if (pdist < ENEMY_JET_ATTACK_RANGE && facing > 0.93) ej.state = "attack"
            else if (pdist < ENEMY_JET_CHASE_RANGE) ej.state = "chase"
            else ej.state = "patrol"
          }
          if (ej.state === "evade") {
            tx = ej.x + -Math.sin(ej.evadeYaw) * 100
            ty = ej.y + 6
            tz = ej.z + -Math.cos(ej.evadeYaw) * 100
          } else if (ej.state === "ground_strafe") {
            // Dive toward a low point at the player so the nose drops onto them.
            tx = focalPoint.x
            ty = ENEMY_JET_STRAFE_DIVE_ALT
            tz = focalPoint.z
          } else if (ej.state === "patrol" || !jet) {
            const wp = ENEMY_JET_WAYPOINTS[ej.wpIndex % ENEMY_JET_WAYPOINTS.length] ?? [0, 40, 150]
            tx = wp[0]
            // SKY: patrol the high arena (180–260m) instead of the low harbor
            // circuit so bandits don't dive into the ground between waypoints.
            ty = isSky ? 180 + (ej.wpIndex % 3) * 40 : wp[1]
            tz = wp[2]
            if (Math.hypot(tx - ej.x, tz - ej.z) < 14) ej.wpIndex++
          } else {
            tx = jet?.x ?? ej.x
            ty = (jet?.y ?? 0) + 2
            tz = jet?.z ?? ej.z
          }
          // Climb-out: hold a nose-up attitude until clear of the ground.
          if (now < ej.noCrashUntil) ty = Math.max(ty, 35)
          // Steer heading + pitch toward the target.
          const dx = tx - ej.x
          const dy = ty - ej.y
          const dz = tz - ej.z
          const horiz = Math.max(0.001, Math.hypot(dx, dz))
          const desiredYaw = Math.atan2(-dx, -dz)
          const desiredPitch = Math.max(-0.6, Math.min(0.6, Math.atan2(dy, horiz)))
          let dyaw = desiredYaw - ej.heading
          while (dyaw > Math.PI) dyaw -= Math.PI * 2
          while (dyaw < -Math.PI) dyaw += Math.PI * 2
          const turn = Math.max(-ENEMY_JET_TURN * dt, Math.min(ENEMY_JET_TURN * dt, dyaw))
          ej.heading += turn
          ej.pitch += (desiredPitch - ej.pitch) * (1 - Math.exp(-dt * 2))
          // Integrate.
          const cp = Math.cos(ej.pitch)
          const fx = -Math.sin(ej.heading) * cp
          const fy = Math.sin(ej.pitch)
          const fz = -Math.cos(ej.heading) * cp
          ej.x += fx * ej.speed * dt
          ej.y += fy * ej.speed * dt
          ej.z += fz * ej.speed * dt
          if (ej.y <= 0) {
            if (now > ej.noCrashUntil) {
              killEnemyJet(ej)
              continue
            }
            ej.y = 0.05
          }
          if (now > ej.noCrashUntil && collidesWithWall(ej.x, ej.z, VEHICLE_JET_RADIUS, ej.y)) {
            killEnemyJet(ej)
            continue
          }
          const bank = Math.max(-0.7, Math.min(0.7, -dyaw * 1.5))
          ej.group.position.set(ej.x, ej.y, ej.z)
          ej.group.rotation.set(ej.pitch, ej.heading, bank)
          // ATTACK fire: narrow forward cone + range, 150ms cadence, hitscan.
          if (ej.state === "attack" && jet && now > ej.nextFire) {
            ej.nextFire = now + ENEMY_JET_GUN_COOLDOWN_MS
            const muzzle = new THREE.Vector3(ej.x + fx * 3, ej.y + fy * 3, ej.z + fz * 3)
            const dir = new THREE.Vector3(
              jet.x - ej.x,
              (jet.y ?? 0) - ej.y,
              jet.z - ej.z,
            ).normalize()
            const tracer = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 2.0), jetTracerMat)
            tracer.position.copy(muzzle)
            tracer.lookAt(muzzle.clone().add(dir))
            scene.add(tracer)
            bullets.push({
              mesh: tracer,
              velocity: dir.clone().multiplyScalar(180),
              life: 0.4,
              isEnemy: false,
              damage: 0,
            })
            if (Math.random() < 0.6) damageActiveVehicle(ENEMY_JET_GUN_DAMAGE, "bullet")
          }
          // GROUND_STRAFE fire: machine-gun the ground player on the dive, then
          // pull up + break off once low enough (climbs away as "evade").
          if (ej.state === "ground_strafe") {
            if (ej.y <= ENEMY_JET_STRAFE_PULLUP_ALT) {
              ej.state = "evade"
              ej.stateUntil = now + 3500
              ej.evadeYaw = ej.heading
            } else if (now > ej.nextFire) {
              ej.nextFire = now + ENEMY_JET_GUN_COOLDOWN_MS
              const muzzle = new THREE.Vector3(ej.x + fx * 3, ej.y + fy * 3, ej.z + fz * 3)
              const dir = new THREE.Vector3(
                focalPoint.x - ej.x,
                // Aim at the player's torso at their actual altitude (foot Y +
                // ~1.0), so a strafe lined up on a player on a roof / ledge
                // instead of always raking near the ground.
                focalPoint.y + 1.0 - ej.y,
                focalPoint.z - ej.z,
              ).normalize()
              const tracer = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 2.0), jetTracerMat)
              tracer.position.copy(muzzle)
              tracer.lookAt(muzzle.clone().add(dir))
              scene.add(tracer)
              bullets.push({
                mesh: tracer,
                velocity: dir.clone().multiplyScalar(180),
                life: 0.5,
                isEnemy: false,
                damage: 0,
              })
              // Land hits when the run passes close overhead. applyPlayerDamage
              // routes to a ridden vehicle if the player is driving one.
              const fhoriz = Math.hypot(focalPoint.x - ej.x, focalPoint.z - ej.z)
              if (fhoriz < 30 && Math.random() < 0.4) {
                applyPlayerDamage(ENEMY_JET_STRAFE_DAMAGE, 4)
              }
            }
          }
        }
      }

      function updateCrashJets(dt: number) {
        for (let i = crashJets.length - 1; i >= 0; i--) {
          const c = crashJets[i]
          if (!c) continue
          const cp = Math.cos(c.pitch)
          c.x += -Math.sin(c.heading) * cp * c.speed * dt
          c.y += Math.sin(c.pitch) * c.speed * dt
          c.z += -Math.cos(c.heading) * cp * c.speed * dt
          if (c.y <= 0 || collidesWithWall(c.x, c.z, VEHICLE_JET_RADIUS, c.y)) {
            const b = new THREE.Vector3(c.x, Math.max(0.5, c.y), c.z)
            spawnExplosion(b)
            spawnExplosion(b)
            SOUNDS.damage()
            scene.remove(c.group)
            crashJets.splice(i, 1)
            continue
          }
          c.group.position.set(c.x, c.y, c.z)
          c.group.rotation.set(c.pitch, c.heading, 0)
        }
      }

      // ── Parachute ──
      function openChute() {
        const g = new THREE.Group()
        const canopyMat = new THREE.MeshStandardMaterial({
          color: 0xe8e8ee,
          roughness: 0.85,
          metalness: 0,
          side: THREE.DoubleSide,
          emissive: 0x222230,
          emissiveIntensity: 0.2,
        })
        const cordMat = new THREE.MeshBasicMaterial({ color: 0x888888 })
        const canopy = new THREE.Mesh(
          new THREE.SphereGeometry(1.6, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
          canopyMat,
        )
        canopy.position.y = 2.6
        g.add(canopy)
        for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
          const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.4, 4), cordMat)
          cord.position.set(Math.cos(a) * 1.2, 1.4, Math.sin(a) * 1.2)
          cord.rotation.x = Math.cos(a) * 0.25
          cord.rotation.z = Math.sin(a) * 0.25
          g.add(cord)
        }
        scene.add(g)
        parachuteMeshRef.current = g
        parachutePhaseRef.current = "chute"
        setParachuting(true)
      }
      function closeChute() {
        const g = parachuteMeshRef.current
        if (g) {
          // Free the per-deploy geometry + materials before dropping the group.
          g.traverse((c) => {
            if (c instanceof THREE.Mesh) {
              c.geometry.dispose()
              if (Array.isArray(c.material)) for (const m of c.material) m.dispose()
              else c.material.dispose()
            }
          })
          scene.remove(g)
          parachuteMeshRef.current = null
        }
        parachutePhaseRef.current = "none"
        setParachuting(false)
        // SKY: a downed pilot returns to the airbase apron to grab a fresh jet.
        if (isSky) {
          focalPoint.x = 20
          focalPoint.z = 126
          focalPoint.y = 0
          camState.pitch = 0
          updateCamera()
        }
      }

      // Eject from the jet. makeCrashing=true (manual) lets the empty jet fly on
      // and crash; false (auto-eject on HP 0) detonates it immediately.
      function ejectFromJet(makeCrashing: boolean) {
        const v = activeVehicle
        if (!v || v.kind !== "jet") return
        const jx = v.x
        const jy = v.y ?? 0
        const jz = v.z
        if (makeCrashing) {
          crashJets.push({
            group: v.group,
            x: jx,
            y: jy,
            z: jz,
            heading: v.heading,
            pitch: camState.pitch,
            speed: Math.max(v.speed, 14),
          })
        } else {
          const b = new THREE.Vector3(jx, jy + 0.5, jz)
          spawnExplosion(b)
          spawnExplosion(b)
          scene.remove(v.group)
        }
        v.dead = true
        SOUNDS.damage()
        // Detach the pilot before the jet flies on / is removed (so the empty
        // jet crashes riderless and the shared avatar isn't taken with it).
        hidePlayerAvatar()
        // Tear down driving (no side-step — we keep the player at altitude).
        drivingRef.current = false
        setInVehicle(false)
        gunGroup.visible = true
        activeVehicle = null
        setVehicleHp(0)
        setVehicleMaxHp(0)
        cannonModeRef.current = false
        setCannonActive(false)
        setCannonCooldownMs(0)
        setInTank(false)
        setInJet(false)
        jetThrottleRef.current = 0
        jetGunHeldRef.current = false
        jetMissileReqRef.current = false
        setMissileCdMs(0)
        drivingKindRef.current = null
        // Pop the player up out of the cockpit; free-fall until the canopy opens.
        focalPoint.x = jx
        focalPoint.z = jz
        focalPoint.y = jy + 1
        playerVelRef.current.x = 0
        playerVelRef.current.z = 0
        playerVelYRef.current = EJECT_UP_SPEED
        wasAirborneRef.current = true
        fallStartYRef.current = focalPoint.y
        camState.pitch = -0.08
        parachutePhaseRef.current = "falling"
        chuteOpenAtRef.current = Date.now() + PARACHUTE_OPEN_DELAY_MS
        cameraShakeRef.current.intensity = 5
      }

      // ── SKY arena manager: enemy-jet waves / endless respawns + keeping the
      //    apron stocked with boardable player jets. Runs only on the SKY map.
      let skyWaveNum = 0
      let skyWaveActive = false
      let skyWaveInterUntil = 0
      let skyEnemyRespawnAt = 0
      let skyPlayerJetRespawnAt = 0
      // Spawn `count` red jets at altitude (150–300m), scattered over the arena.
      function skySpawnSquadron(count: number) {
        // Mobile: half the squadron to keep the framerate up.
        const n = isMobileDevice && count > 0 ? Math.ceil(count / 2) : count
        // Keep spawns inside the playable box (with margin) — a jet generated
        // outside WORLD_MIN…WORLD_MAX is killed instantly by the bounds check.
        const lo = WORLD_MIN + 50
        const hi = WORLD_MAX - 50
        for (let i = 0; i < n; i++) {
          const ang = Math.random() * Math.PI * 2
          const rad = 130 + Math.random() * 220
          const x = Math.max(lo, Math.min(hi, 35 + Math.cos(ang) * rad))
          const z = Math.max(lo, Math.min(hi, 150 + Math.sin(ang) * rad))
          const y = 150 + Math.random() * 150
          spawnEnemyJet(x, z, ang + Math.PI, y)
        }
      }
      function updateSkyArena() {
        const now = Date.now()
        let aliveJets = 0
        for (const e of enemyJets) if (!e.dead) aliveJets++
        if (modeRef.current === "wave_defense") {
          if (skyWaveActive) {
            if (aliveJets === 0) {
              skyWaveActive = false
              skyWaveInterUntil = now + 15000 // 15s repair interval
              setWaveMessage(`WAVE ${skyWaveNum} CLEAR — 次の編隊まで15秒`)
            }
          } else if (now > skyWaveInterUntil) {
            skyWaveNum++
            const count = 2 + skyWaveNum // wave1:3, wave2:4, wave3:5, …
            skySpawnSquadron(count)
            skyWaveActive = true
            setCurrentWave(skyWaveNum)
            setWaveMessage(`WAVE ${skyWaveNum} — 敵編隊 ${count} 機`)
            setTimeout(() => setWaveMessage(null), 3000)
          }
        } else {
          // Endless (ffa / tdm / others): keep a flight of 4 up, 30s respawn.
          const TARGET = 4
          if (aliveJets < TARGET) {
            if (skyEnemyRespawnAt === 0) skyEnemyRespawnAt = now + 30000
            else if (now > skyEnemyRespawnAt) {
              skySpawnSquadron(TARGET - aliveJets)
              skyEnemyRespawnAt = 0
            }
          } else {
            skyEnemyRespawnAt = 0
          }
        }
        // Keep ≥2 boardable jets parked at the apron; refill 60s after running low.
        let parked = 0
        for (const v of vehicles) {
          if (
            v.kind === "jet" &&
            !v.dead &&
            (v.y ?? 0) < 2 &&
            Math.abs(v.speed) < 2 &&
            Math.hypot(v.x - 20, v.z - 136) < 70
          )
            parked++
        }
        if (parked < 2) {
          if (skyPlayerJetRespawnAt === 0) skyPlayerJetRespawnAt = now + 60000
          else if (now > skyPlayerJetRespawnAt) {
            // Refill the full deficit in one cycle so "≥2 parked" is restored
            // immediately rather than one jet per 60s.
            for (let s = parked; s < 2; s++) {
              spawnVehicle(-10 + s * 12, 133 + s * 4, -Math.PI / 2, 0x33557a, "jet")
            }
            skyPlayerJetRespawnAt = 0
          }
        } else {
          skyPlayerJetRespawnAt = 0
        }
      }

      // Place the air-defence network + enemy jets (single-player modes only —
      // PvP doesn't sync vehicles/jets). AA guns: 2 on warehouse roofs, 1 by the
      // control tower, 1 at the container-yard edge. Enemy jets scramble from
      // the runway's west end. On SKY, the arena manager owns enemy spawns.
      if (isSky) {
        // Initial bandit flight at altitude; waves / respawns continue from here.
        skySpawnSquadron(modeRef.current === "wave_defense" ? 0 : 4)
        if (modeRef.current === "wave_defense") skyWaveInterUntil = Date.now() + 4000
        // RPG pickups on the airbase apron (handheld anti-air on the ground).
        makeRPGPickup(8, 136)
        makeRPGPickup(-4, 130)
      } else if (modeRef.current !== "ffa" && modeRef.current !== "tdm") {
        makeAAGun(26, 235, 6.0) // west warehouse roof
        makeAAGun(74, 236, 6.0) // central warehouse roof
        makeAAGun(16, 122, 0) // beside the control tower
        makeAAGun(88, 205, 0) // east container-yard edge
        spawnEnemyJet(-12, 134, -Math.PI / 2)
        spawnEnemyJet(-12, 139, -Math.PI / 2)
        // RPG pickups: 2 in the HARBOR (near the airfield + container yard) and
        // 2 in the URBAN core, so every area has a way to answer enemy jets.
        makeRPGPickup(30, 200) // HARBOR — airfield apron edge
        makeRPGPickup(70, 232) // HARBOR — by the warehouses
        makeRPGPickup(40, 60) // URBAN — central avenue
        makeRPGPickup(-18, 32) // URBAN — west side street
      }

      // Nose machine gun: cooldown-gated hitscan from the jet's nose along the
      // aim, with a bright tracer. Direct damage on the first enemy hit.
      function fireJetGun() {
        const v = activeVehicle
        if (!v || v.kind !== "jet" || v.dead) return
        const now = Date.now()
        if (now - lastJetGunRef.current < JET_GUN_COOLDOWN_MS) return
        lastJetGunRef.current = now
        const yaw = camState.yaw
        const pitch = camState.pitch
        const ch = Math.cos(pitch)
        const fwd = new THREE.Vector3(-Math.sin(yaw) * ch, Math.sin(pitch), -Math.cos(yaw) * ch)
        const nose = new THREE.Vector3(
          v.x + fwd.x * 3.2,
          (v.y ?? 0) + 1.0 + fwd.y * 3.2,
          v.z + fwd.z * 3.2,
        )
        raycaster.set(nose, fwd)
        const prevFar = raycaster.far
        raycaster.far = JET_GUN_RANGE
        const parts: THREE.Object3D[] = []
        for (const e of enemies) {
          if (e.hp > 0 && !e.aiDriving) {
            e.mesh.traverse((c) => {
              if (c instanceof THREE.Mesh && c.userData.enemyId) parts.push(c)
            })
          }
        }
        const enemyHit = raycaster.intersectObjects(parts, false)[0]
        const wallHit = raycaster.intersectObjects(wallMeshes, false)[0]
        // Enemy-driven vehicles, AA guns and enemy jets via the shared hitscan
        // helper — a forgiving ground aim-assist lets fast strafing runs land on
        // vehicles / AA. (Air-to-air stays exact mesh.) Run before resetting far
        // so the helper's raycasts respect JET_GUN_RANGE.
        const cands = collectHardTargets(raycaster, JET_GUN_DAMAGE, {
          jetAssistR: 0,
          groundAssistR: JET_GROUND_ASSIST,
          jetRange: JET_GUN_RANGE,
        })
        raycaster.far = prevFar
        // Ground enemies (infantry / terraformers / bike riders): exact mesh
        // first, then the same forgiving sphere assist so a diving strafe run
        // reliably connects on the small, moving figures below.
        let enemyCand: { dist: number; point: THREE.Vector3; en: CombatEnemy } | null = null
        if (enemyHit) {
          const id = enemyHit.object.userData.enemyId as string | undefined
          const en = enemies.find((e) => e.id === id)
          if (en) enemyCand = { dist: enemyHit.distance, point: enemyHit.point.clone(), en }
        }
        if (!enemyCand) {
          const ray = raycaster.ray
          let bestT = Number.POSITIVE_INFINITY
          for (const e of enemies) {
            if (e.hp <= 0 || e.aiDriving) continue
            const ex = e.mesh.position.x
            const ey = e.mesh.position.y
            const ez = e.mesh.position.z
            const ox = ex - ray.origin.x
            const oy = ey - ray.origin.y
            const oz = ez - ray.origin.z
            const t = ox * ray.direction.x + oy * ray.direction.y + oz * ray.direction.z
            if (t <= 0 || t > JET_GUN_RANGE || t >= bestT) continue
            const px = ray.origin.x + ray.direction.x * t
            const py = ray.origin.y + ray.direction.y * t
            const pz = ray.origin.z + ray.direction.z * t
            if (Math.hypot(ex - px, ey - py, ez - pz) > JET_GROUND_ASSIST + e.config.bodyH * 0.5)
              continue
            bestT = t
            enemyCand = { dist: t, point: new THREE.Vector3(px, py, pz), en: e }
          }
        }
        if (enemyCand) {
          const { en, point } = enemyCand
          cands.push({
            dist: enemyCand.dist,
            point,
            apply: () => {
              en.hp -= JET_GUN_DAMAGE
              spawnBlood(point)
              scoreRef.current += JET_GUN_DAMAGE * 8
              setScore(scoreRef.current)
              if (en.hp <= 0) applyEnemyKill(en, "jet")
            },
          })
        }
        cands.sort((a, b) => a.dist - b.dist)
        const best = cands[0]
        const wallDist = wallHit ? wallHit.distance : Number.POSITIVE_INFINITY
        let impact: THREE.Vector3 | null = null
        if (best && best.dist < wallDist) {
          best.apply()
          impact = best.point.clone()
        } else if (wallHit) {
          impact = wallHit.point.clone()
        }
        // Bright tracer streaking from the nose.
        const tracer = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 2.4), jetTracerMat)
        tracer.position.copy(nose)
        tracer.lookAt(nose.clone().add(fwd))
        tracer.renderOrder = 998
        scene.add(tracer)
        bullets.push({
          mesh: tracer,
          velocity: fwd.clone().multiplyScalar(200),
          life: 0.4,
          isEnemy: false,
          damage: 0,
        })
        if (impact) spawnExplosion(impact, true)
        SOUNDS.pistol()
      }

      // Missile: 3s-cooldown explosive that flies forward and AOE-detonates on
      // impact (reuses the grenade detonation → damages enemies in range).
      function fireJetMissile() {
        const v = activeVehicle
        if (!v || v.kind !== "jet" || v.dead) return
        const now = Date.now()
        if (now - lastMissileRef.current < JET_MISSILE_COOLDOWN_MS) return
        lastMissileRef.current = now
        setMissileCdMs(JET_MISSILE_COOLDOWN_MS)
        prevMissileCdRef.current = JET_MISSILE_COOLDOWN_MS
        const yaw = camState.yaw
        const pitch = camState.pitch
        const ch = Math.cos(pitch)
        const fwd = new THREE.Vector3(-Math.sin(yaw) * ch, Math.sin(pitch), -Math.cos(yaw) * ch)
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 1.1), jetMissileMat)
        const start = new THREE.Vector3(
          v.x + fwd.x * 3.6,
          (v.y ?? 0) + 0.9 + fwd.y * 3.6,
          v.z + fwd.z * 3.6,
        )
        m.position.copy(start)
        m.lookAt(start.clone().add(fwd))
        scene.add(m)
        bullets.push({
          mesh: m,
          velocity: fwd.clone().multiplyScalar(JET_MISSILE_SPEED),
          life: 3.0,
          isEnemy: false,
          damage: 0,
          isGrenade: true,
          grenadeRadius: JET_MISSILE_RADIUS,
        })
        SOUNDS.shotgun()
        cameraShakeRef.current.intensity = 3
      }

      // A jet smashing into the ground or a building: big blast, ejects the
      // player (via destroyActiveVehicle) and deals heavy crash damage on top.
      function jetCrash(v: Vehicle) {
        v.hp = 0
        destroyActiveVehicle() // blast + eject + clears driving state
        if (gamePhaseRef.current === "playing") {
          playerHpRef.current = Math.max(1, playerHpRef.current - JET_CRASH_DAMAGE)
          setPlayerHp(playerHpRef.current)
          lastDamageTimeRef.current = Date.now()
          setDamageFlash(true)
          setTimeout(() => setDamageFlash(false), 320)
        }
      }

      // Fighter-jet flight model: taxi → rotate → fly → stall/land. Replaces the
      // ground-vehicle update entirely while the active vehicle is a jet.
      function updateJet(v: Vehicle, dt: number) {
        const now = Date.now()
        // Manual ejection ([Alt] / mobile EJECT) — bail out under a parachute,
        // the empty jet flies on and crashes.
        if (ejectReqRef.current) {
          ejectReqRef.current = false
          ejectFromJet(true)
          return
        }
        // Nose control: PC drives camState via the mouse already; the mobile
        // LEFT stick (joySmoothRef) pitches/rolls the nose here.
        const sj = joySmoothRef.current
        if (sj.vx !== 0 || sj.vy !== 0) {
          camState.yaw -= sj.vx * JET_TURN_RATE * dt
          camState.pitch = clampPitch(camState.pitch + -sj.vy * JET_PITCH_RATE * dt)
          lastDriveAimRef.current = now
        }
        // Throttle: W/S (or arrows) + mobile accel/decel pads.
        let throttle = 0
        if (keysRef.current.has("w") || keysRef.current.has("ArrowUp")) throttle += 1
        if (keysRef.current.has("s") || keysRef.current.has("ArrowDown")) throttle -= 1
        throttle += jetThrottleRef.current
        throttle = Math.max(-1, Math.min(1, throttle))
        if (Math.abs(throttle) > 0.01) v.speed += JET_ACCEL * throttle * dt
        else v.speed -= JET_DRAG * dt
        v.speed = Math.max(0, Math.min(JET_MAX_SPEED, v.speed))

        const yaw = camState.yaw
        let pitch = camState.pitch
        const y = v.y ?? 0
        if (!v.airborne) {
          // On the runway the nose stays level. Rotate + lift off once fast
          // enough AND the player pulls up — or, as a safety net, once well
          // past takeoff speed so you can never get stuck rolling forever.
          pitch = 0
          const fastEnough = v.speed >= JET_TAKEOFF_SPEED
          const pullingUp = camState.pitch > 0.03
          const autoRotate = v.speed >= JET_MAX_SPEED * 0.7
          if (fastEnough && (pullingUp || autoRotate)) {
            v.airborne = true
            v.y = 0.05
            // Guarantee a positive climb angle at the moment of rotation so the
            // jet actually leaves the ground (a near-zero nose just skimmed it).
            camState.pitch = Math.max(camState.pitch, 0.12)
            pitch = camState.pitch
          }
        }
        const stall = !!v.airborne && v.speed < JET_MIN_FLY_SPEED
        const ch = Math.cos(pitch)
        const fx = -Math.sin(yaw) * ch
        const fz = -Math.cos(yaw) * ch
        const fy = Math.sin(pitch)
        const nx = v.x + fx * v.speed * dt
        const nz = v.z + fz * v.speed * dt

        if (v.airborne) {
          let ny = y + fy * v.speed * dt
          if (stall) ny -= JET_STALL_SINK * dt
          if (collidesWithWall(nx, nz, VEHICLE_JET_RADIUS, ny)) {
            jetCrash(v)
            return
          }
          if (ny <= 0) {
            // Touchdown attempt. Gentle = shallow nose, not too fast, soft sink.
            const vertVel = fy * v.speed - (stall ? JET_STALL_SINK : 0)
            const gentle =
              camState.pitch < 0.28 &&
              camState.pitch > -0.28 &&
              v.speed < JET_TAKEOFF_SPEED * 1.35 &&
              vertVel > -13 &&
              !collidesWithWall(nx, nz, VEHICLE_JET_RADIUS, 0)
            if (gentle) {
              v.airborne = false
              v.x = nx
              v.z = nz
              v.y = 0
            } else {
              jetCrash(v)
              return
            }
          } else {
            v.x = nx
            v.z = nz
            v.y = ny
          }
        } else {
          // Taxiing: per-axis wall stop (no crash at runway speeds).
          if (!collidesWithWall(nx, v.z, VEHICLE_JET_RADIUS, 0)) v.x = nx
          if (!collidesWithWall(v.x, nz, VEHICLE_JET_RADIUS, 0)) v.z = nz
          v.y = 0
        }
        focalPoint.x = v.x
        focalPoint.z = v.z
        focalPoint.y = 0
        v.heading = yaw

        // Orient the airframe: yaw + pitch + a visual bank from the turn input.
        const targetBank = Math.max(-0.7, Math.min(0.7, -sj.vx * 0.7))
        const curBank = v.group.rotation.z
        const bank = curBank + (targetBank - curBank) * (1 - Math.exp(-dt * 6))
        v.group.position.set(v.x, v.y ?? 0, v.z)
        v.group.rotation.set(pitch, yaw, bank)

        // Weapons: held MG fire + one-shot missile request.
        if (mouseDownRef.current || jetGunHeldRef.current) fireJetGun()
        if (jetMissileReqRef.current) {
          jetMissileReqRef.current = false
          fireJetMissile()
        }

        // ── Chase camera: trail behind the nose in full 3D (incl. altitude) ──
        const aimHx = -Math.sin(yaw)
        const aimHz = -Math.cos(yaw)
        const cp = Math.cos(pitch)
        const aimFx = aimHx * cp
        const aimFy = Math.sin(pitch)
        const aimFz = aimHz * cp
        const camY = (v.y ?? 0) + JET_CAM_HEIGHT
        const tx = v.x - aimFx * JET_CAM_DIST
        const ty = camY - aimFy * JET_CAM_DIST
        const tz = v.z - aimFz * JET_CAM_DIST
        const blend = 1 - Math.exp(-dt * 8)
        camera.position.x += (tx - camera.position.x) * blend
        camera.position.y += (ty - camera.position.y) * blend
        camera.position.z += (tz - camera.position.z) * blend
        camera.position.y = Math.max(camera.position.y, 0.7)
        camera.lookAt(v.x + aimFx, (v.y ?? 0) + 1 + aimFy, v.z + aimFz)

        // HUD (throttled to value changes to avoid per-frame re-renders).
        const spK = Math.round((v.speed * 3.6) / 5) * 5
        if (spK !== prevJetSpeedRef.current) {
          prevJetSpeedRef.current = spK
          setJetSpeed(spK)
        }
        const altR = Math.round(v.y ?? 0)
        if (altR !== prevJetAltRef.current) {
          prevJetAltRef.current = altR
          setJetAlt(altR)
        }
        const mcd =
          Math.round(Math.max(0, JET_MISSILE_COOLDOWN_MS - (now - lastMissileRef.current)) / 100) *
          100
        if (mcd !== prevMissileCdRef.current) {
          prevMissileCdRef.current = mcd
          setMissileCdMs(mcd)
        }
      }

      function updateVehicle(dt: number) {
        const v = activeVehicle
        if (!v) return
        if (v.kind === "jet") {
          updateJet(v, dt)
          return
        }
        // Inputs: WASD / arrows + left stick (vy = throttle, vx = steer).
        const sjoy = joySmoothRef.current
        let throttle = 0
        if (keysRef.current.has("w") || keysRef.current.has("ArrowUp")) throttle += 1
        if (keysRef.current.has("s") || keysRef.current.has("ArrowDown")) throttle -= 1
        throttle -= sjoy.vy // stick up (vy<0) = forward
        let steer = 0
        if (keysRef.current.has("a") || keysRef.current.has("ArrowLeft")) steer -= 1
        if (keysRef.current.has("d") || keysRef.current.has("ArrowRight")) steer += 1
        steer += sjoy.vx
        throttle = Math.max(-1, Math.min(1, throttle))
        steer = Math.max(-1, Math.min(1, steer))

        // Per-kind handling: tanks are slow, heavy, ponderous; cars are nimble;
        // bikes are the nimblest — quick accel, high top speed, tight turning.
        const isTank = v.kind === "tank"
        const isBike = v.kind === "bike"
        const ACCEL = isTank ? VEHICLE_TANK_ACCEL : isBike ? VEHICLE_BIKE_ACCEL : VEHICLE_ACCEL
        const MAXS = isTank
          ? VEHICLE_TANK_MAX_SPEED
          : isBike
            ? VEHICLE_BIKE_MAX_SPEED
            : VEHICLE_MAX_SPEED
        const REVS = isTank
          ? VEHICLE_TANK_REVERSE
          : isBike
            ? VEHICLE_BIKE_REVERSE
            : VEHICLE_REVERSE_SPEED
        const TURN = isTank ? VEHICLE_TANK_TURN : isBike ? VEHICLE_BIKE_TURN : VEHICLE_TURN_RATE
        const RADIUS = isTank ? VEHICLE_TANK_RADIUS : isBike ? VEHICLE_BIKE_RADIUS : VEHICLE_RADIUS

        // Longitudinal dynamics (accel under throttle, engine-brake when coasting).
        if (Math.abs(throttle) > 0.01) {
          v.speed += throttle * ACCEL * dt
        } else {
          const decel = VEHICLE_BRAKE_DRAG * dt * (Math.abs(v.speed) + 1)
          if (v.speed > 0) v.speed = Math.max(0, v.speed - decel)
          else if (v.speed < 0) v.speed = Math.min(0, v.speed + decel)
        }
        v.speed = Math.max(-REVS, Math.min(MAXS, v.speed))

        // Steering scales with speed and flips in reverse (like a real car).
        // Note the leading minus: with forward = (-sin h, -cos h), a *positive*
        // heading delta swings the nose toward -x (the driver's left). Steer is
        // +1 for D / right-stick, so we negate it to map D → right, A → left.
        // Tanks can also pivot-steer slowly in place (slight base factor).
        const speedFactor = isTank
          ? Math.min(1, Math.abs(v.speed) / 3 + 0.3)
          : Math.min(1, Math.abs(v.speed) / 3 + 0.12)
        const dir = v.speed >= 0 ? 1 : -1
        v.heading -= steer * TURN * dt * speedFactor * dir

        // Integrate with per-axis wall collision (no tunnelling).
        const fx = -Math.sin(v.heading)
        const fz = -Math.cos(v.heading)
        const nx = v.x + fx * v.speed * dt
        const nz = v.z + fz * v.speed * dt
        let moved = false
        if (!collidesWithWall(nx, v.z, RADIUS)) {
          v.x = nx
          moved = true
        }
        if (!collidesWithWall(v.x, nz, RADIUS)) {
          v.z = nz
          moved = true
        }
        if (!moved) v.speed *= 0.2 // head-on bump bleeds momentum

        v.group.position.set(v.x, 0, v.z)
        v.group.rotation.y = v.heading
        // Carry the (hidden) player with the car for WS sync + exit position.
        focalPoint.x = v.x
        focalPoint.z = v.z
        focalPoint.y = 0

        // Tank turret + barrel track the aim (turret yaw is relative to the
        // hull; barrel pitches with the aim, clamped to a sane gun arc).
        if (isTank && v.turret && v.barrelPivot) {
          let ty = camState.yaw - v.heading
          while (ty > Math.PI) ty -= Math.PI * 2
          while (ty < -Math.PI) ty += Math.PI * 2
          const tb = 1 - Math.exp(-dt * 10)
          v.turret.rotation.y += (ty - v.turret.rotation.y) * tb
          const tp = Math.max(
            CANNON_BARREL_MIN_PITCH,
            Math.min(CANNON_BARREL_MAX_PITCH, camState.pitch),
          )
          v.barrelPivot.rotation.x += (tp - v.barrelPivot.rotation.x) * tb
        }

        // ── Run-over ────────────────────────────────────────────────────────
        // Driving through enemies mows them down (the vehicle still passes
        // through — no stopping dead on a body). Tanks crush on contact; cars
        // need speed and scale damage with it. Lethal hits route through the
        // normal kill path (death anim / killfeed / score), bodies flung ahead.
        {
          const sp = Math.abs(v.speed)
          const minSp = isTank ? RUNOVER_MIN_SPEED_TANK : RUNOVER_MIN_SPEED_CAR
          if (sp > minSp) {
            const reach = (isTank ? VEHICLE_TANK_RADIUS : VEHICLE_RADIUS) + ENEMY_RADIUS + 0.25
            const reach2 = reach * reach
            const dmg = isTank ? RUNOVER_TANK_DAMAGE : Math.floor(sp * RUNOVER_CAR_DMG_PER_SPEED)
            for (const enemy of enemies) {
              if (enemy.hp <= 0 || enemy.dyingTimer >= 0 || enemy.aiDriving) continue
              const ex = enemy.mesh.position.x - v.x
              const ez = enemy.mesh.position.z - v.z
              if (ex * ex + ez * ez > reach2) continue
              if (Math.abs(enemy.mesh.position.y) > 2) continue // not our level
              enemy.hp = Math.max(0, enemy.hp - dmg)
              spawnBlood(new THREE.Vector3(enemy.mesh.position.x, 0.9, enemy.mesh.position.z))
              if (enemy.hp <= 0) {
                // Fling the body ahead in the travel direction before the anim.
                enemy.mesh.position.x += fx * 0.6
                enemy.mesh.position.z += fz * 0.6
                applyEnemyKill(enemy, "vehicle")
              } else {
                // Survived: shove them aside so they don't grind under the hull.
                enemy.mesh.position.x += (ex === 0 ? 0 : Math.sign(ex)) * 0.3 + fx * 0.2
                enemy.mesh.position.z += (ez === 0 ? 0 : Math.sign(ez)) * 0.3 + fz * 0.2
              }
              // Cars bleed a little momentum per body; tanks barely notice.
              if (!isTank) v.speed *= 0.94
            }
          }
        }

        // ── Free-aim chase camera ──────────────────────────────────────────
        // The hull steers with WASD; the mouse/right-stick independently aims
        // (camState.yaw/pitch, fed in the mouse-drain block while driving). The
        // camera orbits to sit behind the AIM direction and looks exactly along
        // it, so the screen-center crosshair (and fire ray) point where aimed.
        // When the player stops aiming for a beat, it eases back behind the hull
        // so plain driving keeps the road in view.
        if (Date.now() - lastDriveAimRef.current > VEHICLE_CAM_RECENTER_MS) {
          let dy = v.heading - camState.yaw
          while (dy > Math.PI) dy -= Math.PI * 2
          while (dy < -Math.PI) dy += Math.PI * 2
          const recenter = 1 - Math.exp(-dt * 3)
          camState.yaw += dy * recenter
          camState.pitch += (-0.12 - camState.pitch) * recenter
        }
        const aimHx = -Math.sin(camState.yaw)
        const aimHz = -Math.cos(camState.yaw)
        const cp = Math.cos(camState.pitch)
        const aimFx = aimHx * cp
        const aimFy = Math.sin(camState.pitch)
        const aimFz = aimHz * cp
        // March backward along the aim horizontal; pull the camera in if a
        // view-height wall (or the map edge) would clip it (no black-out).
        let camDist = VEHICLE_CAM_DIST
        for (let d = 1.0; d <= VEHICLE_CAM_DIST; d += 0.5) {
          const sx = v.x - aimHx * d
          const sz = v.z - aimHz * d
          const outOfBounds =
            sx < WORLD_MIN + 0.4 ||
            sx > WORLD_MAX - 0.4 ||
            sz < WORLD_MIN + 0.4 ||
            sz > WORLD_MAX - 0.4
          if (outOfBounds || pointInsideWall(sx, 2.0, sz)) {
            camDist = Math.max(2.2, d - 0.7)
            break
          }
        }
        const camTargetX = v.x - aimHx * camDist
        const camTargetZ = v.z - aimHz * camDist
        const wantCloser =
          camDist * camDist < (camera.position.x - v.x) ** 2 + (camera.position.z - v.z) ** 2
        const camBlend = 1 - Math.exp(-dt * (wantCloser ? 18 : 6))
        camera.position.x += (camTargetX - camera.position.x) * camBlend
        camera.position.z += (camTargetZ - camera.position.z) * camBlend
        camera.position.y += (VEHICLE_CAM_HEIGHT - camera.position.y) * camBlend
        // Look exactly along the aim vector → center-ray == crosshair == fire dir.
        camera.lookAt(
          camera.position.x + aimFx,
          camera.position.y + aimFy,
          camera.position.z + aimFz,
        )
      }

      // ── Humanoid enemy factory ─────────────────────────────────────────────
      let enemyIdCounter = 0
      // Shared terraformer gross-out assets — one sphere geometry + one glossy
      // pustule material reused across every terraformer (pustules are scaled
      // per-mesh). Dark wet red-purple with a faint glow.
      const TERRA_PUSTULE_GEO = new THREE.SphereGeometry(1, sseg(6), sseg(5))
      const terraPustuleMat = new THREE.MeshStandardMaterial({
        color: 0x3a0a1e,
        emissive: 0x2a0512,
        emissiveIntensity: 0.5,
        roughness: 0.18,
        metalness: 0.1,
      })
      function makeEnemy(
        type: EnemyType,
        x: number,
        z: number,
        isCommander = false,
        scaleMul = 1,
      ): CombatEnemy {
        const cfg = ENEMY_CONFIGS[type]
        const isZombie = type === "zombie"
        const isTerraformer = type === "terraformer"
        // Per-individual size jitter (zombies + terraformers vary; soldiers fixed).
        const zJit = isZombie
          ? 0.86 + Math.random() * 0.3
          : isTerraformer
            ? 0.95 + Math.random() * 0.22
            : 1
        const scale =
          (type === "heavy" ? 1.25 : type === "sniper" ? 1.03 : isTerraformer ? 1.4 : 1.0) *
          zJit *
          scaleMul
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
        // Per-zombie colour drift so a horde never looks uniform: flesh slides
        // across sickly green↔grey with varied darkness; rags/skin rot toward
        // muddy tones. Non-zombies keep their exact archetype colours.
        const bodyCol = new THREE.Color(bodyColor)
        const skinCol = new THREE.Color(isTerraformer ? 0x2a2420 : isZombie ? 0x9fae9a : 0xc8a878)
        if (isZombie && !isCommander) {
          bodyCol.offsetHSL(
            (Math.random() - 0.4) * 0.12,
            -0.08 + Math.random() * 0.1,
            -0.12 + Math.random() * 0.1,
          )
          skinCol.offsetHSL(
            (Math.random() - 0.45) * 0.08,
            (Math.random() - 0.5) * 0.18,
            (Math.random() - 0.5) * 0.16,
          )
        } else if (isTerraformer && !isCommander) {
          // Per-terraformer drift: chitin slides red↔purple↔brown and skin
          // darkness varies, so a swarm reads as a writhing mass of mismatched
          // horrors rather than clones.
          bodyCol.offsetHSL(
            (Math.random() - 0.5) * 0.09,
            (Math.random() - 0.5) * 0.2,
            (Math.random() - 0.5) * 0.12,
          )
          skinCol.offsetHSL(
            (Math.random() - 0.5) * 0.1,
            (Math.random() - 0.5) * 0.2,
            (Math.random() - 0.5) * 0.12,
          )
        }
        const bodyMat = new THREE.MeshLambertMaterial({ color: bodyCol, emissive: cfg.emissive })
        const darkColor = type === "grunt" ? 0x2a3027 : type === "sniper" ? 0x18241b : 0x080808
        const darkMat = new THREE.MeshLambertMaterial({ color: darkColor })
        // Zombies have undead, ashen flesh; everyone else is normal skin.
        const skinMat = new THREE.MeshLambertMaterial({
          color: skinCol,
          emissive: isTerraformer ? 0x120606 : isZombie ? 0x202a22 : 0x000000,
        })
        const gloveMat = new THREE.MeshLambertMaterial({
          color: isTerraformer ? 0x14100e : 0x141414,
        })
        // Eye glow varies by archetype (sniper green NV, grunt blue, heavy red,
        // zombie + terraformer a hot menacing red).
        const eyeHex =
          isZombie || isTerraformer
            ? isTerraformer
              ? 0xff2a14
              : 0xff1a1a
            : type === "heavy"
              ? 0xff3333
              : type === "sniper"
                ? 0x55ff99
                : 0x88ddff
        const eyeMat = new THREE.MeshBasicMaterial({ color: eyeHex })

        const lodDetails: THREE.Object3D[] = []
        // Terraformer-only: throbbing pustules + the glowing eye material, both
        // captured here so the return can wire them for the per-frame writhe.
        const terraPustules: THREE.Mesh[] = []
        let terraEyeMat: THREE.MeshStandardMaterial | undefined
        // Attach one pustule to a body node. Shared geometry, scaled per-mesh;
        // userData.pustuleBase stores its rest scale so the animate loop throbs
        // it without re-reading geometry. LOD-culled like the other small bits.
        const addPustule = (
          parent: THREE.Object3D,
          px: number,
          py: number,
          pz: number,
          r: number,
        ) => {
          const m = new THREE.Mesh(TERRA_PUSTULE_GEO, terraPustuleMat)
          m.position.set(px * scale, py * scale, pz * scale)
          const rr = r * scale
          m.scale.set(rr, rr, rr)
          m.userData.pustuleBase = rr
          parent.add(m)
          terraPustules.push(m)
          lodDetails.push(m)
        }
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
        // Zombie wounds: dark bruise / open-gash blotches mottling the torso.
        if (isZombie) {
          const woundMat = new THREE.MeshLambertMaterial({ color: 0x3a2630, emissive: 0x140a10 })
          const blotch = (px: number, py: number, w: number, h: number) => {
            const m = new THREE.Mesh(box(w, h, 0.02), woundMat)
            m.position.set(px * scale, py * scale, -(torsoD / 2 + 0.05) * scale)
            torso.add(m)
            lodDetails.push(m)
          }
          blotch(0.1, 0.44, 0.13, 0.09)
          blotch(-0.12, 0.24, 0.09, 0.14)
        }
        // Terraformer carapace: glossy back wing-cases + shoulder spikes.
        if (isTerraformer) {
          const carMat = new THREE.MeshLambertMaterial({ color: 0x1d1916, emissive: 0x0b0405 })
          for (const s of [-1, 1]) {
            const wing = new THREE.Mesh(box(0.26, 0.52, 0.05), carMat)
            wing.position.set(s * 0.13 * scale, 0.4 * scale, (torsoD / 2 + 0.04) * scale)
            wing.rotation.set(0.16, s * 0.2, s * 0.1)
            wing.castShadow = true
            torso.add(wing)
          }
          for (const s of [-1, 1]) {
            const spike = new THREE.Mesh(
              new THREE.ConeGeometry(0.085 * scale, 0.32 * scale, 5),
              carMat,
            )
            spike.position.set(s * 0.28 * scale, 0.6 * scale, 0)
            spike.rotation.z = s * 0.5
            torso.add(spike)
            lodDetails.push(spike)
          }
          // Pustules erupting across the back, flanks and chest — these throb
          // out of phase in the animate loop for a "writhing flesh" read.
          addPustule(torso, 0.1, 0.5, 0.16, 0.06)
          addPustule(torso, -0.14, 0.34, 0.17, 0.05)
          addPustule(torso, 0.19, 0.22, -0.04, 0.055)
          addPustule(torso, -0.16, 0.16, -0.02, 0.045)
          addPustule(torso, 0.06, 0.12, 0.18, 0.05)
          addPustule(torso, -0.05, 0.42, -0.14, 0.04)
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

        // ── Zombie horror head dressing ──────────────────────────────────────
        // Sunken glowing eyes set in dark sockets, a gaping torn jaw with a
        // black maw + broken teeth, and a skull wound. All small + LOD-culled.
        if (isZombie) {
          // Drop the tidy mouth slit entirely (LOD would re-show a hidden one)
          // — it's replaced by the gaping maw below.
          head.remove(mouth)
          const mIdx = lodDetails.indexOf(mouth)
          if (mIdx >= 0) lodDetails.splice(mIdx, 1)
          const socketMat = new THREE.MeshLambertMaterial({ color: 0x101309, emissive: 0x05060a })
          for (const sx of [-0.055, 0.055]) {
            const socket = new THREE.Mesh(sph(0.052, 8, 6), socketMat)
            socket.position.set(sx * scale, 0.02 * scale, -0.14 * scale)
            socket.scale.z = 0.55
            head.add(socket)
            lodDetails.push(socket)
          }
          // Recess the eyes into the sockets and make them a hotter red so they
          // glint from the shadow (their own material, brighter than the shared).
          const zEyeMat = new THREE.MeshBasicMaterial({ color: 0xff2a12 })
          for (const eye of [leftEye, rightEye]) {
            eye.position.z = -0.128 * scale
            eye.material = zEyeMat
          }
          // Gaping jaw: drop + widen it and expose a black throat cavity.
          jaw.position.set(0, -0.21 * scale, 0.03 * scale)
          jaw.scale.set(1.18, 2.0, 1.05)
          const maw = new THREE.Mesh(
            box(0.1, 0.12, 0.06),
            new THREE.MeshBasicMaterial({ color: 0x070405 }),
          )
          maw.position.set(0, -0.13 * scale, -0.11 * scale)
          head.add(maw)
          lodDetails.push(maw)
          const toothMat = new THREE.MeshLambertMaterial({ color: 0xcabf9f })
          for (const tx of [-0.032, 0.005, 0.034]) {
            const tooth = new THREE.Mesh(box(0.016, 0.035, 0.012), toothMat)
            tooth.position.set(tx * scale, -0.082 * scale, -0.158 * scale)
            head.add(tooth)
            lodDetails.push(tooth)
          }
          // Skull wound — a dark gash across the crown.
          const gash = new THREE.Mesh(
            box(0.12, 0.05, 0.02),
            new THREE.MeshLambertMaterial({ color: 0x32202a, emissive: 0x120a10 }),
          )
          gash.position.set(0.04 * scale, 0.12 * scale, -0.12 * scale)
          gash.rotation.z = 0.5
          head.add(gash)
          lodDetails.push(gash)
        }

        // ── Terraformer roach head ───────────────────────────────────────────
        // Flatter elongated chitin skull, jutting mandibles, swept antennae,
        // wide compound red eyes. Reads as a humanoid roach bearing down.
        if (isTerraformer) {
          head.remove(mouth)
          const tmIdx = lodDetails.indexOf(mouth)
          if (tmIdx >= 0) lodDetails.splice(tmIdx, 1)
          skull.scale.set(1.05, 0.82, 1.4)
          const chitinMat = new THREE.MeshLambertMaterial({ color: 0x1d1916, emissive: 0x0b0405 })
          jaw.visible = false
          // Mandibles — two angled jaws jutting forward-down.
          for (const s of [-1, 1]) {
            const mand = new THREE.Mesh(box(0.045, 0.14, 0.18), chitinMat)
            mand.position.set(s * 0.05 * scale, -0.11 * scale, -0.17 * scale)
            mand.rotation.z = s * 0.32
            mand.rotation.x = 0.34
            head.add(mand)
            lodDetails.push(mand)
          }
          // Antennae sweeping back over the carapace.
          for (const s of [-1, 1]) {
            const ant = new THREE.Mesh(
              new THREE.CylinderGeometry(0.013 * scale, 0.005 * scale, 0.55 * scale, 5),
              chitinMat,
            )
            ant.position.set(s * 0.06 * scale, 0.18 * scale, 0.02 * scale)
            ant.rotation.set(1.0, 0, s * 0.28)
            head.add(ant)
            lodDetails.push(ant)
          }
          // Big wide compound eyes — emissive so they burn through the dark.
          // emissiveIntensity is pulsed per-frame for an unsettling flicker.
          const cEyeMat = new THREE.MeshStandardMaterial({
            color: 0x3a0606,
            emissive: 0xff2a14,
            emissiveIntensity: 2.4,
            roughness: 0.3,
            metalness: 0,
          })
          terraEyeMat = cEyeMat
          for (const eye of [leftEye, rightEye]) {
            const side = Math.sign(eye.position.x) || 1
            eye.geometry = sph(0.058, 8, 6)
            // eye.material is inferred as MeshBasicMaterial from creation; widen
            // through the base Mesh type to swap in the emissive standard mat.
            const eyeMesh: THREE.Mesh = eye
            eyeMesh.material = cEyeMat
            eye.position.set(side * 0.09 * scale, 0.035 * scale, -0.13 * scale)
          }
          // A couple of weeping pustules on the skull/brow.
          addPustule(head, 0.075, 0.12, -0.04, 0.034)
          addPustule(head, -0.06, 0.05, 0.07, 0.03)
        }

        // ── Helmet / Visor (per archetype) ───────────────────────────────────
        // Zombies + terraformers are bare-headed — no helmet/visor.
        if (!isZombie && !isTerraformer) {
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
        // Zombies + terraformers are unarmed (素手) — no rifle.
        if (!isZombie && !isTerraformer) {
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

        // Patrol loop around the spawn. Waypoints range up to ±40 around the
        // spawn and clamp to the *world* bounds (not MAP_SIZE) so HARBOR /
        // INDUSTRIAL enemies patrol their own district instead of being yanked
        // back into the 0–100 city the moment they pick a waypoint.
        const PATROL_R = 40
        const wp = (dx: number, dz: number) => ({
          x: Math.max(WORLD_MIN + 2, Math.min(WORLD_MAX - 2, x + dx)),
          z: Math.max(WORLD_MIN + 2, Math.min(WORLD_MAX - 2, z + dz)),
        })
        const patrol = [
          { x, z },
          wp(PATROL_R * 0.7, PATROL_R * 0.5),
          wp(-PATROL_R * 0.6, PATROL_R * 0.7),
          wp(-PATROL_R * 0.5, -PATROL_R * 0.6),
          wp(PATROL_R * 0.6, -PATROL_R * 0.4),
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
          jaw,
          steerX: 0,
          steerZ: 0,
          steerUntil: 0,
          shadowMesh: shadow,
          lodDetails,
          leftEye,
          rightEye,
          pustules: terraPustules,
          pulsePhase: Math.random() * Math.PI * 2,
          twitchPhase: Math.random() * Math.PI * 2,
          eyeGlowMat: terraEyeMat,
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
          // Aggressive-AI bookkeeping (initial values).
          alertedUntil: 0,
          // Random side at spawn so groups arc around the player from both
          // sides rather than stacking on a single flank.
          flankSide: Math.random() < 0.5 ? -1 : 1,
          flankStrength: 0.4 + Math.random() * 0.6, // 0.4 – 1.0
          dashUntil: 0,
          nextDashCheckTime: 0,
          nextGrenadeTime: 0,
          markerKind: null,
          markerUntil: 0,
          meleeAnimUntil: 0,
        }
      }

      // ── Zombie navigation (smarter pursuit) ────────────────────────────────
      // Coarse line-of-sight: torso-height samples between two ground points,
      // step ~1.5m and capped at 24 samples so long sight-lines stay cheap.
      function zombieLosBlocked(x1: number, z1: number, x2: number, z2: number): boolean {
        const dx = x2 - x1
        const dz = z2 - z1
        const d = Math.hypot(dx, dz)
        if (d < 0.001) return false
        const steps = Math.min(16, Math.ceil(d / 1.8))
        for (let i = 1; i < steps; i++) {
          const t = i / steps
          if (pointInsideWall(x1 + dx * t, 1.2, z1 + dz * t)) return true
        }
        return false
      }
      // True if a short step in (dirX,dirZ) is wall-free (probes mid + end).
      function zombiePathClear(
        x: number,
        z: number,
        dirX: number,
        dirZ: number,
        reach: number,
      ): boolean {
        return (
          !collidesWithWall(x + dirX * reach * 0.6, z + dirZ * reach * 0.6, ENEMY_RADIUS) &&
          !collidesWithWall(x + dirX * reach, z + dirZ * reach, ENEMY_RADIUS)
        )
      }
      // Local steering: head straight when the way is clear, else probe a fan of
      // headings (own flank side first so a horde splits around obstacles) and
      // commit to the clearest one briefly. Lightweight — no global pathfinding.
      function zombieSteer(
        enemy: CombatEnemy,
        x: number,
        z: number,
        desX: number,
        desZ: number,
        now: number,
      ): { x: number; z: number } {
        const dlen = Math.hypot(desX, desZ) || 1
        const dx = desX / dlen
        const dz = desZ / dlen
        const REACH = ENEMY_RADIUS * 2 + 1.0
        if (zombiePathClear(x, z, dx, dz, REACH)) {
          enemy.steerUntil = 0
          return { x: dx, z: dz }
        }
        // Hold a committed detour so it doesn't oscillate at a corner.
        if (enemy.steerUntil && now < enemy.steerUntil) {
          const sx = enemy.steerX ?? dx
          const sz = enemy.steerZ ?? dz
          if (zombiePathClear(x, z, sx, sz, REACH * 0.8)) return { x: sx, z: sz }
        }
        const base = Math.atan2(dx, dz)
        const side = enemy.flankSide
        for (const off of [0.5, 1.0, 1.6, 2.3]) {
          for (const s of [side, -side]) {
            const a = base + s * off
            const cx = Math.sin(a)
            const cz = Math.cos(a)
            if (zombiePathClear(x, z, cx, cz, REACH)) {
              enemy.steerX = cx
              enemy.steerZ = cz
              enemy.steerUntil = now + 350
              return { x: cx, z: cz }
            }
          }
        }
        return { x: dx, z: dz } // boxed in — push straight, per-axis slide handles it
      }
      // Zombie chase movement: encircle the player (pincer), funnel to ladders
      // when the player is treed up high, lunge-feint occasionally, and steer
      // around walls. Falls back to the last-seen position + a search when the
      // player slips out of sight. Self-contained so other AI is untouched.
      function moveZombieAlert(
        enemy: CombatEnemy,
        x: number,
        z: number,
        toPx: number,
        toPz: number,
        dist: number,
        dt: number,
        now: number,
      ) {
        const player = focalPoint
        const dd = Math.max(0.001, dist)
        const elevated = player.y > 2
        // LOS is only worth the wall-trace up close; far zombies just home in.
        const los = elevated || dist > 45 || !zombieLosBlocked(x, z, player.x, player.z)
        let tgtX: number
        let tgtZ: number
        if (los) {
          enemy.lastSeenPlayer = { x: player.x, z: player.z }
          const perpX = -toPz / dd
          const perpZ = toPx / dd
          const ring = Math.min(7, dd * 0.45) * enemy.flankStrength
          tgtX = player.x + perpX * enemy.flankSide * ring
          tgtZ = player.z + perpZ * enemy.flankSide * ring
        } else if (enemy.lastSeenPlayer) {
          tgtX = enemy.lastSeenPlayer.x
          tgtZ = enemy.lastSeenPlayer.z
          // Reached the last-known spot still blind → break into a search.
          if (Math.hypot(tgtX - x, tgtZ - z) < 1.5) {
            enemy.state = "search"
            enemy.searchTimer = 4
            setEnemyMarker(enemy, "search", 4000)
            return
          }
        } else {
          return
        }
        // Player up on a roof/ledge: route to the nearest climb access (ladder)
        // and crowd it — come up the ladder route / lie in wait at its foot.
        if (elevated && climbZones.length) {
          let bx = tgtX
          let bz = tgtZ
          let bestD = Number.POSITIVE_INFINITY
          for (const cz of climbZones) {
            const czx = cz.baseX ?? (cz.x1 + cz.x2) / 2
            const czz = cz.baseZ ?? (cz.z1 + cz.z2) / 2
            const d = Math.hypot(czx - x, czz - z)
            if (d < bestD) {
              bestD = d
              bx = czx
              bz = czz
            }
          }
          tgtX = bx
          tgtZ = bz
        }
        // Lunge feint — sudden bursts so the approach isn't a constant crawl.
        if (now > enemy.nextDashCheckTime) {
          enemy.nextDashCheckTime = now + 1200 + Math.random() * 2000
          if (dist > 2.5 && dist < 22 && Math.random() < 0.4) enemy.dashUntil = now + 650
        }
        const spd = enemy.config.speed * (now < enemy.dashUntil ? 1.55 : 1) * dt
        const dir = zombieSteer(enemy, x, z, tgtX - x, tgtZ - z, now)
        const nx = x + dir.x * spd
        const nz = z + dir.z * spd
        if (!collidesWithWall(nx, z, ENEMY_RADIUS)) enemy.mesh.position.x = nx
        if (!collidesWithWall(x, nz, ENEMY_RADIUS)) enemy.mesh.position.z = nz
        // Face the player when sensed (menace), else face travel direction.
        if (los) enemy.facing.set(toPx / dd, 0, toPz / dd)
        else enemy.facing.set(dir.x, 0, dir.z)
      }

      // ── Wave / mission spawner ─────────────────────────────────────────────
      const enemies: CombatEnemy[] = []
      const goalMarkers: GoalMarker[] = []

      function clearEnemies() {
        for (const e of enemies) scene.remove(e.mesh)
        enemies.length = 0
        // Release any commandeered vehicles back to free/boardable state so a
        // wave reset doesn't leave a driverless car circling forever.
        for (const v of vehicles) {
          if (v.aiDriver && !v.dead) {
            v.aiDriver = null
            v.speed = 0
            v.hp = v.maxHp
          }
          // Bikes: drop the (now-removed) terraformer rider so the bike frees up.
          if (v.riderEnemy) {
            v.riderEnemy = null
            v.speed = 0
          }
        }
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
        // Mobile: cap the wave at half the enemies to keep the framerate up.
        if (isMobileDevice) types.length = Math.ceil(types.length / 2)
        const shuffled = [...SPAWN_POINTS].sort(() => Math.random() - 0.5)
        let commandersSpawned = 0
        for (let i = 0; i < types.length; i++) {
          const sp = shuffled[i % shuffled.length] ?? shuffled[0]
          if (!sp) continue
          const type = types[i] ?? "grunt"
          const rx = Math.max(
            WORLD_MIN + 2,
            Math.min(WORLD_MAX - 2, sp.x + (Math.random() - 0.5) * 3),
          )
          const rz = Math.max(
            WORLD_MIN + 2,
            Math.min(WORLD_MAX - 2, sp.z + (Math.random() - 0.5) * 3),
          )
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
      // Overhead "!" alert sprite / "?" search sprite, drawn always-on-top.
      // We reuse a single texture per glyph (cached on the function) since
      // a sprite material can share the same texture across many sprites.
      const markerTextureCache = new Map<string, THREE.Texture>()
      function makeMarkerSprite(kind: "alert" | "search"): THREE.Sprite {
        const key = kind === "alert" ? "!" : "?"
        const color = kind === "alert" ? "#ffcc00" : "#88ccff"
        let tex = markerTextureCache.get(key)
        if (!tex) {
          const canvas = document.createElement("canvas")
          canvas.width = 128
          canvas.height = 128
          const ctx = canvas.getContext("2d")
          if (ctx) {
            ctx.font = "bold 110px sans-serif"
            ctx.textAlign = "center"
            ctx.textBaseline = "middle"
            ctx.lineWidth = 8
            ctx.strokeStyle = "rgba(0,0,0,0.85)"
            ctx.strokeText(key, 64, 70)
            ctx.fillStyle = color
            ctx.fillText(key, 64, 70)
          }
          tex = new THREE.CanvasTexture(canvas)
          tex.needsUpdate = true
          markerTextureCache.set(key, tex)
        }
        const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })
        const sprite = new THREE.Sprite(mat)
        sprite.scale.set(0.7, 0.7, 1)
        sprite.renderOrder = 1100
        return sprite
      }

      function setEnemyMarker(enemy: CombatEnemy, kind: "alert" | "search" | null, durMs: number) {
        if (kind === null) {
          if (enemy.markerSprite) enemy.markerSprite.visible = false
          enemy.markerKind = null
          enemy.markerUntil = 0
          return
        }
        if (!enemy.markerSprite || enemy.markerKind !== kind) {
          if (enemy.markerSprite) enemy.mesh.remove(enemy.markerSprite)
          const sprite = makeMarkerSprite(kind)
          // Position above head — head is roughly at y ≈ 2.0 for a default
          // humanoid; sit the marker comfortably above it.
          sprite.position.set(0, 2.85, 0)
          enemy.mesh.add(sprite)
          enemy.markerSprite = sprite
        }
        enemy.markerSprite.visible = true
        enemy.markerKind = kind
        enemy.markerUntil = Date.now() + durMs
      }

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
        // Mobile: half the bots to keep the framerate up. Guard count>0 so a
        // zero request stays zero (Math.max(1,…) would otherwise spawn one).
        const n = isMobileDevice && count > 0 ? Math.max(1, Math.ceil(count / 2)) : count
        if (n <= 0) return
        const tuning = BOT_DIFFICULTY_CONFIGS[diff]
        const shuffled = [...SPAWN_POINTS].sort(() => Math.random() - 0.5)
        const myTeam = myTeamRef.current
        for (let i = 0; i < n; i++) {
          const sp = shuffled[i % shuffled.length] ?? shuffled[0]
          if (!sp) continue
          // 70% grunt, 20% sniper, 10% heavy
          const r = Math.random()
          const type: EnemyType = r < 0.7 ? "grunt" : r < 0.9 ? "sniper" : "heavy"
          const rx = Math.max(
            WORLD_MIN + 3,
            Math.min(WORLD_MAX - 3, sp.x + (Math.random() - 0.5) * 4),
          )
          const rz = Math.max(
            WORLD_MIN + 3,
            Math.min(WORLD_MAX - 3, sp.z + (Math.random() - 0.5) * 4),
          )
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
          // Store the full tuning so the AI state machine doesn't have to
          // map back from accuracy/respawn numbers to a difficulty.
          bot.aiTuning = tuning

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
        // SKY has no ground infantry / missions — the sky-arena manager owns
        // all enemy (jet) spawning, so skip the whole infantry mission setup.
        if (isSky) return
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

      // ── Zombie wave spawner (ZOMBIE mode) ─────────────────────────────────
      // waveNum is 1-based. Count = 5 + 3·(n−1). Move speed ramps slightly
      // each wave and is baked straight into each zombie's per-instance config
      // (cloned so the shared ENEMY_CONFIGS isn't mutated). Spawns ring the
      // map perimeter and the zombie starts already homing on the player.
      function spawnZombieWave(waveNum: number) {
        const fullCount = 5 + (waveNum - 1) * 3
        const count = isMobileDevice ? Math.ceil(fullCount / 2) : fullCount
        // Player sprint is MOVE_SPEED·SPRINT_MULTIPLIER (=9). Base chase speed
        // ≈1.3× that, +0.5 m/s per wave so later waves outrun you harder.
        const chaseSpeed = MOVE_SPEED * SPRINT_MULTIPLIER * 1.3 + (waveNum - 1) * 0.5
        const margin = 4
        for (let i = 0; i < count; i++) {
          const edge = Math.floor(Math.random() * 4)
          const along = margin + Math.random() * (MAP_SIZE - 2 * margin)
          let sx: number
          let sz: number
          if (edge === 0) {
            sx = along
            sz = margin
          } else if (edge === 1) {
            sx = MAP_SIZE - margin
            sz = along
          } else if (edge === 2) {
            sx = along
            sz = MAP_SIZE - margin
          } else {
            sx = margin
            sz = along
          }
          const safe = findSafeSpawnNear(sx, sz, ENEMY_RADIUS)
          const zb = makeEnemy("zombie", safe.x, safe.z, false)
          // Per-instance config clone with the wave's chase speed.
          zb.config = { ...zb.config, speed: chaseSpeed }
          zb.aiTuning = ZOMBIE_AI_TUNING
          // Start already hunting so they bee-line from the edge immediately.
          zb.state = "alert"
          zb.lastSeenPlayer = { x: focalPoint.x, z: focalPoint.z }
          enemies.push(zb)
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
        SOUNDS.zombieGroan()
      }

      // ── Invasion mode: rocket strikes + terraformer waves ──────────────────
      interface RocketStrike {
        group: THREE.Group
        x: number
        y: number
        z: number
        vx: number
        vy: number
        vz: number
        tx: number
        tz: number
        waveNum: number
        trailT: number
      }
      const rocketStrikes: RocketStrike[] = []

      function makeRocket(): THREE.Group {
        const g = new THREE.Group()
        const bodyMat = new THREE.MeshStandardMaterial({
          color: 0xcfd4da,
          roughness: 0.4,
          metalness: 0.6,
        })
        const noseMat = new THREE.MeshStandardMaterial({ color: 0xcc3322, roughness: 0.5 })
        const finMat = new THREE.MeshStandardMaterial({ color: 0x99221a, roughness: 0.6 })
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 4.5, 12), bodyMat)
        body.castShadow = true
        g.add(body)
        const nose = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.6, 12), noseMat)
        nose.position.y = 3.05
        g.add(nose)
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2
          const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2, 0.9), finMat)
          fin.position.set(Math.cos(a) * 0.6, -1.9, Math.sin(a) * 0.6)
          fin.rotation.y = -a
          g.add(fin)
        }
        const flame = new THREE.Mesh(
          new THREE.ConeGeometry(0.5, 1.8, 10),
          new THREE.MeshBasicMaterial({ color: 0xffaa33 }),
        )
        flame.position.y = -3.3
        flame.rotation.x = Math.PI
        g.add(flame)
        return g
      }

      // Launch an incoming rocket aimed at (cx,cz); it arcs in from a high
      // diagonal, trails fire, and on impact detonates + spawns a terraformer
      // wave around the crater.
      function triggerRocketStrike(cx: number, cz: number, waveNum: number) {
        const g = makeRocket()
        const sx = Math.max(4, Math.min(MAP_SIZE - 4, cx - 28))
        const sz = Math.max(4, Math.min(MAP_SIZE - 4, cz - 28))
        const sy = 130
        const dur = 2.6
        const vx = (cx - sx) / dur
        const vy = (0.5 - sy) / dur
        const vz = (cz - sz) / dur
        g.position.set(sx, sy, sz)
        // Point the nose (+y) along the travel vector so it dives in nose-first.
        g.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(vx, vy, vz).normalize(),
        )
        scene.add(g)
        rocketStrikes.push({
          group: g,
          x: sx,
          y: sy,
          z: sz,
          vx,
          vy,
          vz,
          tx: cx,
          tz: cz,
          waveNum,
          trailT: 0,
        })
        SOUNDS.alert()
        showNotification("⚠ ロケット接近——!")
      }

      function spawnTerraformerWave(waveNum: number, cx: number, cz: number) {
        const fullCount = 3 + (waveNum - 1) * 2
        const count = isMobileDevice ? Math.ceil(fullCount / 2) : fullCount
        const chaseSpeed = ENEMY_CONFIGS.terraformer.speed + (waveNum - 1) * 0.35
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + Math.random() * 0.5
          const rad = 3 + Math.random() * 4
          const sx = Math.max(3, Math.min(MAP_SIZE - 3, cx + Math.cos(a) * rad))
          const sz = Math.max(3, Math.min(MAP_SIZE - 3, cz + Math.sin(a) * rad))
          const safe = findSafeSpawnNear(sx, sz, ENEMY_RADIUS)
          const tf = makeEnemy("terraformer", safe.x, safe.z, false)
          tf.config = { ...tf.config, speed: chaseSpeed }
          tf.aiTuning = TERRAFORMER_AI_TUNING
          tf.state = "alert"
          tf.lastSeenPlayer = { x: focalPoint.x, z: focalPoint.z }
          enemies.push(tf)
        }
        // Every 3rd wave: a towering BOSS terraformer — much bigger, tankier,
        // and hits harder. Spawned at the crater so it leads the charge.
        if (waveNum % 3 === 0) {
          const safe = findSafeSpawnNear(cx, cz, ENEMY_RADIUS)
          const boss = makeEnemy("terraformer", safe.x, safe.z, false, 1.9)
          boss.hp = 2600
          boss.maxHp = 2600
          boss.config = {
            ...boss.config,
            speed: chaseSpeed * 0.82,
            attackDamage: 60,
            attackRange: 3.2,
          }
          boss.aiTuning = TERRAFORMER_AI_TUNING
          boss.state = "alert"
          boss.lastSeenPlayer = { x: focalPoint.x, z: focalPoint.z }
          enemies.push(boss)
          showNotification("☠ 巨大テラフォーマー出現！")
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

      function updateRocketStrikes(dt: number) {
        for (let i = rocketStrikes.length - 1; i >= 0; i--) {
          const r = rocketStrikes[i]
          if (!r) continue
          r.x += r.vx * dt
          r.y += r.vy * dt
          r.z += r.vz * dt
          r.group.position.set(r.x, r.y, r.z)
          r.trailT += dt
          if (r.trailT > 0.045) {
            r.trailT = 0
            spawnExplosion(new THREE.Vector3(r.x, r.y, r.z), true)
          }
          if (r.y <= 0.6) {
            // Impact: blast, crater, screen-shake, and the horde erupts.
            const c = new THREE.Vector3(r.tx, 1.0, r.tz)
            for (let k = 0; k < 6; k++) spawnExplosion(c)
            cameraShakeRef.current.intensity = 12
            SOUNDS.shotgun()
            lastNoiseRef.current = { x: r.tx, z: r.tz, expires: Date.now() + 6000 }
            const crater = new THREE.Mesh(
              new THREE.CircleGeometry(4.2, 22),
              new THREE.MeshBasicMaterial({
                color: 0x130a06,
                transparent: true,
                opacity: 0.85,
                depthWrite: false,
              }),
            )
            crater.rotation.x = -Math.PI / 2
            crater.position.set(r.tx, 0.03, r.tz)
            scene.add(crater)
            scene.remove(r.group)
            rocketStrikes.splice(i, 1)
            showNotification("☄ 着弾！テラフォーマーズ襲来")
            spawnTerraformerWave(r.waveNum, r.tx, r.tz)
          }
        }
      }

      // ══ Big Cockroach boss (PR-B1) ═══════════════════════════════════════════
      // Brown dust puffs kicked up by the boss's footsteps / stomps / rubble.
      // Lazy-growing object pool: meshes are created on demand the first time
      // they're needed (so non-boss modes allocate nothing), then reused via the
      // `active` flag — never create/dispose per spawn. Capped.
      const BOSS_DUST_CAP = isMobileDevice ? 24 : 48 // half the dust pool on mobile
      const bossDust: { mesh: THREE.Mesh; life: number; active: boolean }[] = []
      const bossDustGeo = new THREE.SphereGeometry(1, sseg(6), sseg(5))
      function spawnBossDust(x: number, z: number, scale: number) {
        let d = bossDust.find((p) => !p.active)
        if (!d) {
          if (bossDust.length >= BOSS_DUST_CAP) return
          const mesh = new THREE.Mesh(
            bossDustGeo,
            new THREE.MeshBasicMaterial({
              color: 0x6a5238,
              transparent: true,
              opacity: 0.5,
              depthWrite: false,
            }),
          )
          scene.add(mesh)
          d = { mesh, life: 0, active: false }
          bossDust.push(d)
        }
        d.active = true
        d.life = 1.0
        d.mesh.visible = true
        d.mesh.position.set(x + (Math.random() - 0.5) * 4, 0.5, z + (Math.random() - 0.5) * 4)
        d.mesh.scale.setScalar(scale * (0.6 + Math.random() * 0.6))
        ;(d.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5
      }
      function updateBossDust(dt: number) {
        for (const d of bossDust) {
          if (!d.active) continue
          d.life -= dt
          d.mesh.position.y += dt * 1.2
          d.mesh.scale.multiplyScalar(1 + dt * 0.8)
          ;(d.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, d.life * 0.5)
          if (d.life <= 0) {
            d.active = false
            d.mesh.visible = false
          }
        }
      }
      // Poison pools left by the beam: green ground discs that hurt on contact.
      // Same lazy-growing pool pattern (cap 12).
      const BOSS_POOL_CAP = isMobileDevice ? 6 : 12 // half the poison-pool count on mobile
      const bossPools: { mesh: THREE.Mesh; x: number; z: number; life: number; active: boolean }[] =
        []
      const bossPoolGeo = new THREE.CircleGeometry(BOSS_POOL_RADIUS, 20)
      function spawnBossPool(x: number, z: number) {
        let p = bossPools.find((q) => !q.active)
        if (!p) {
          if (bossPools.length >= BOSS_POOL_CAP) return
          const mesh = new THREE.Mesh(
            bossPoolGeo,
            new THREE.MeshBasicMaterial({
              color: 0x33dd22,
              transparent: true,
              opacity: 0.5,
              depthWrite: false,
            }),
          )
          mesh.rotation.x = -Math.PI / 2
          scene.add(mesh)
          p = { mesh, x, z, life: 0, active: false }
          bossPools.push(p)
        }
        p.active = true
        p.x = x
        p.z = z
        p.life = BOSS_POOL_LIFE
        p.mesh.visible = true
        p.mesh.position.set(x, 0.05, z)
        ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5
      }
      function updateBossPools(dt: number) {
        const px = focalPoint.x
        const pz = focalPoint.z
        for (const p of bossPools) {
          if (!p.active) continue
          p.life -= dt
          ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(
            0,
            Math.min(0.5, p.life * 0.1),
          )
          // Standing in the pool → poison damage.
          if (Math.hypot(px - p.x, pz - p.z) < BOSS_POOL_RADIUS) {
            applyPlayerDamage(BOSS_POOL_DPS * dt, 0)
            bossPoisonHitAtRef.current = Date.now()
          }
          if (p.life <= 0) {
            p.active = false
            p.mesh.visible = false
          }
        }
      }

      // Spawn the boss at the north map edge with a dramatic drop-in intro.
      // (Wall `disabled` flags are reset at scene init, not here.)
      function spawnBigBoss() {
        const parts = makeBigCockroach()
        const bx = 50
        const bz = -30
        parts.group.position.set(bx, 80, bz) // drops in during the intro
        scene.add(parts.group)
        // Reusable poison beam cylinder (oriented per-frame in BEAM; Phase 2).
        const beam = new THREE.Mesh(
          new THREE.CylinderGeometry(1.4, 1.4, 1, 10, 1, true),
          new THREE.MeshBasicMaterial({
            color: 0x66ff33,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        )
        beam.visible = false
        scene.add(beam)
        const boss: BigBoss = {
          group: parts.group,
          x: bx,
          z: bz,
          heading: 0,
          hp: BOSS_HP,
          state: "intro",
          stateUntil: Date.now() + 2600,
          nextDecisionAt: 0,
          rage: false,
          walkPhase: 0,
          dyingStage: 0,
          dyingNextAt: 0,
          introY: 80,
          legs: parts.legs,
          antennae: parts.antennae,
          eyeMat: parts.eyeMat,
          wingL: parts.wingL,
          wingR: parts.wingR,
          headGroup: parts.headGroup,
          beam,
          stompDone: false,
          spawnDone: false,
          beamTargetX: focalPoint.x,
          beamTargetZ: focalPoint.z,
          poolDropAt: 0,
          wingOpen: 0,
        }
        bigBossRef.current = boss
        setBossActive(true)
        setBossHpPct(100)
        setBossRageUi(false)
        SOUNDS.bossRoar()
        cameraShakeRef.current.intensity = 14
        setWaveMessage("WARNING — 巨大ゴキブリ接近")
        setTimeout(() => {
          if (gamePhaseRef.current === "playing") setWaveMessage(null)
        }, 3000)
        // Phase 4 balance: drop two RPG launchers by the player for the fight
        // (tanks / jets / AA guns are already staged on the invasion map).
        makeRPGPickup(focalPoint.x + 7, focalPoint.z + 5)
        makeRPGPickup(focalPoint.x - 7, focalPoint.z - 5)
        showNotification("全兵器を使え — RPG投下・戦車/ジェット/対空砲で迎撃せよ")
      }

      // Animate the legs (tripod gait) + swaying antennae.
      function animateBossBody(boss: BigBoss, dt: number, moving: boolean) {
        if (moving) boss.walkPhase += dt * 6
        for (let i = 0; i < boss.legs.length; i++) {
          const leg = boss.legs[i]
          if (!leg) continue
          const swing = moving ? Math.sin(boss.walkPhase + (i % 2) * Math.PI) * 0.3 : 0
          leg.rotation.x = swing
        }
        const t = Date.now() * 0.001
        for (let i = 0; i < boss.antennae.length; i++) {
          const a = boss.antennae[i]
          if (!a) continue
          a.rotation.x = Math.sin(t * 2 + i) * 0.2
          a.rotation.z = Math.sin(t * 1.5 + i * 1.3) * 0.15
        }
      }

      // Per-frame boss update (Phase 1: intro + advance + walk; attacks land in
      // Phase 2, damage/death in Phase 3).
      // Distance from a ground point to the boss's nearest body part surface
      // (≤0 = inside the volume). Returns null when there's no live boss. Used so
      // AOE falloff + AA hits match the elongated 60m shape, not a single circle.
      function bigBossNearestDist(px: number, pz: number): number | null {
        const boss = bigBossRef.current
        if (!boss || boss.dyingStage > 0) return null
        const s = Math.sin(boss.heading)
        const c = Math.cos(boss.heading)
        let best = Number.POSITIVE_INFINITY
        for (const part of BOSS_HIT_PARTS) {
          const cx = boss.x + part.lz * s
          const cz = boss.z + part.lz * c
          best = Math.min(best, Math.hypot(px - cx, pz - cz) - part.r)
        }
        return best
      }
      function isPointInBigBossHitVolume(px: number, pz: number): boolean {
        const d = bigBossNearestDist(px, pz)
        return d !== null && d <= 0
      }

      // World position of the boss's eyes (the 2× weak point).
      function bossEyeWorld(boss: BigBoss): { x: number; y: number; z: number } {
        const fx = -Math.sin(boss.heading)
        const fz = -Math.cos(boss.heading)
        return { x: boss.x + fx * 24, y: 14.5, z: boss.z + fz * 24 }
      }
      // Apply weapon damage to the boss. `point` (if given) enables the weak-point
      // 2× when it lands on the head eyes. Shared by every weapon via
      // collectHardTargets (hitscan) + damageAllInRadius (AOE).
      function bossTakeDamage(amount: number, point?: THREE.Vector3) {
        const boss = bigBossRef.current
        if (!boss || boss.dyingStage > 0) return
        let weak = false
        if (point) {
          const e = bossEyeWorld(boss)
          if (Math.hypot(point.x - e.x, point.y - e.y, point.z - e.z) < BOSS_EYE_HIT_RADIUS)
            weak = true
        }
        boss.hp -= amount * (weak ? 2 : 1)
        if (weak) {
          boss.eyeMat.emissiveIntensity = 7
          window.setTimeout(() => {
            if (bigBossRef.current === boss) boss.eyeMat.emissiveIntensity = boss.rage ? 4 : 2
          }, 90)
        }
        setBossHpPct(Math.max(0, (boss.hp / BOSS_HP) * 100))
        // Rage at 50% HP: faster, angrier, brighter eyes.
        if (!boss.rage && boss.hp <= BOSS_HP * BOSS_RAGE_FRACTION) {
          boss.rage = true
          setBossRageUi(true)
          boss.eyeMat.emissiveIntensity = 4
          boss.eyeMat.emissive.setHex(0xff3300)
          SOUNDS.bossRoar()
          showNotification("☠ 巨大ゴキブリ 怒り狂う！")
        }
        if (boss.hp <= 0) {
          boss.hp = 0
          boss.dyingStage = 1
          boss.dyingNextAt = Date.now()
          boss.beam.visible = false
        }
      }
      // Defeat sequence: topple + a chain of 5 explosions, then vanish + victory.
      function updateBossDeath(boss: BigBoss, dt: number) {
        const now = Date.now()
        boss.group.rotation.z = Math.min(Math.PI / 2, boss.group.rotation.z + dt * 0.5)
        boss.group.position.set(boss.x, 0, boss.z)
        cameraShakeRef.current.intensity = Math.max(cameraShakeRef.current.intensity, 3)
        if (now < boss.dyingNextAt) return
        if (boss.dyingStage <= 5) {
          for (let k = 0; k < 4; k++) {
            spawnExplosion(
              new THREE.Vector3(
                boss.x + (Math.random() - 0.5) * 42,
                6 + Math.random() * 12,
                boss.z + (Math.random() - 0.5) * 42,
              ),
            )
          }
          cameraShakeRef.current.intensity = 12
          SOUNDS.bossStomp()
          boss.dyingStage++
          boss.dyingNextAt = now + 600
          return
        }
        // Final blast → remove the boss, award score, show the victory overlay.
        for (let k = 0; k < 12; k++) {
          spawnExplosion(
            new THREE.Vector3(
              boss.x + (Math.random() - 0.5) * 30,
              4 + Math.random() * 14,
              boss.z + (Math.random() - 0.5) * 30,
            ),
            false,
            true,
          )
        }
        scene.remove(boss.group)
        scene.remove(boss.beam)
        bigBossRef.current = null
        bossDoneRef.current = true
        scoreRef.current += BOSS_KILL_SCORE
        setScore(scoreRef.current)
        setBossActive(false)
        setBossDefeated(true)
        // Clear any lingering poison vignette (a kill right after a beam/pool
        // hit would otherwise leave the green overlay stuck, with no boss to
        // decay it).
        bossPoisonRef.current = false
        bossPoisonHitAtRef.current = 0
        setBossPoison(false)
        SOUNDS.clear()
        // Clear the swarm + shield the player so the victory screen is safe.
        for (const e of enemies) scene.remove(e.mesh)
        enemies.length = 0
        setAliveEnemyCount(0)
        spawnInvulnUntilRef.current = Number.MAX_SAFE_INTEGER
      }

      // STOMP impact: flatten buildings + AOE the player at the foot point.
      function bossStompImpact(fx: number, fz: number, boss: BigBoss) {
        const footX = boss.x + fx * 22
        const footZ = boss.z + fz * 22
        cameraShakeRef.current.intensity = 14
        SOUNDS.bossStomp()
        for (let k = 0; k < 5; k++)
          spawnBossDust(footX + (Math.random() - 0.5) * 16, footZ + (Math.random() - 0.5) * 16, 5)
        // Player AOE.
        if (Math.hypot(focalPoint.x - footX, focalPoint.z - footZ) < BOSS_STOMP_AOE) {
          applyPlayerDamage(BOSS_STOMP_DMG, 9)
        }
        // Flatten any buildings within the blast: disable collision + hide mesh.
        let crushed = false
        for (const w of ALL_AABBS) {
          if (w.disabled) continue
          const wcx = (w.x1 + w.x2) / 2
          const wcz = (w.z1 + w.z2) / 2
          if (Math.hypot(wcx - footX, wcz - footZ) < BOSS_STOMP_AOE && w.h > 1.5) {
            w.disabled = true
            crushed = true
          }
        }
        for (const m of wallMeshes) {
          if (!m.visible) continue
          if (Math.hypot(m.position.x - footX, m.position.z - footZ) < BOSS_STOMP_AOE) {
            m.visible = false
            spawnBossDust(m.position.x, m.position.z, 6)
          }
        }
        if (crushed) SOUNDS.collapse()
      }

      // Release small roaches (existing terraformer AI, 0.5× brown, 5 pts each).
      function bossSpawnRoaches(boss: BigBoss) {
        const onField = enemies.filter(
          (e) => e.type === "terraformer" && e.hp > 0 && (e.maxHp ?? 0) < 200,
        ).length
        const room = Math.max(0, BOSS_SMALL_MAX - onField)
        const n = Math.min(BOSS_SPAWN_COUNT, room)
        const fx = -Math.sin(boss.heading)
        const fz = -Math.cos(boss.heading)
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2
          const safe = findSafeSpawnNear(
            boss.x + fx * 8 + Math.cos(a) * 10,
            boss.z + fz * 8 + Math.sin(a) * 10,
            ENEMY_RADIUS,
          )
          const r = makeEnemy("terraformer", safe.x, safe.z, false, 0.5)
          r.config = { ...r.config, hp: 120, score: BOSS_SMALL_SCORE, speed: 7 }
          r.hp = 120
          r.maxHp = 120
          r.aiTuning = TERRAFORMER_AI_TUNING
          r.state = "alert"
          r.lastSeenPlayer = { x: focalPoint.x, z: focalPoint.z }
          enemies.push(r)
        }
        setAliveEnemyCount(enemies.filter((e) => e.hp > 0).length)
      }

      function updateBigBoss(dt: number) {
        const boss = bigBossRef.current
        if (!boss) return
        if (boss.dyingStage > 0) {
          updateBossDeath(boss, dt)
          return
        }
        const now = Date.now()
        // Poison vignette decays shortly after the last contact.
        const poisoned = now - bossPoisonHitAtRef.current < 250
        if (poisoned !== bossPoisonRef.current) {
          bossPoisonRef.current = poisoned
          setBossPoison(poisoned)
        }
        const dx = focalPoint.x - boss.x
        const dz = focalPoint.z - boss.z
        const dist = Math.hypot(dx, dz)
        const desiredHeading = Math.atan2(-dx, -dz) // forward = -z
        const fx = -Math.sin(boss.heading)
        const fz = -Math.cos(boss.heading)
        // Always ease the elytra back shut unless mid-SPAWN.
        if (boss.state !== "spawn") boss.wingOpen = Math.max(0, boss.wingOpen - dt * 2)
        boss.wingL.rotation.z = boss.wingOpen * 1.1
        boss.wingR.rotation.z = -boss.wingOpen * 1.1
        // Beam only visible during BEAM.
        if (boss.state !== "beam") boss.beam.visible = false

        if (boss.state === "intro") {
          boss.introY = Math.max(0, boss.introY - dt * 34)
          boss.group.position.set(boss.x, boss.introY, boss.z)
          if (Math.random() < 0.4)
            cameraShakeRef.current.intensity = Math.max(cameraShakeRef.current.intensity, 4)
          animateBossBody(boss, dt, false)
          if (boss.introY <= 0 && now >= boss.stateUntil) {
            boss.state = "advance"
            boss.nextDecisionAt = now + 3500
          }
          return
        }

        const speed = BOSS_SPEED * (boss.rage ? 1.5 : 1)
        // Smooth turn toward the player (faster while attacking-aiming).
        let dh = desiredHeading - boss.heading
        while (dh > Math.PI) dh -= Math.PI * 2
        while (dh < -Math.PI) dh += Math.PI * 2
        const turn = (boss.state === "advance" ? 0.6 : 0.35) * dt
        boss.heading += Math.max(-turn, Math.min(turn, dh))

        if (boss.state === "advance") {
          const moving = dist > 24
          if (moving) {
            boss.x += fx * speed * dt
            boss.z += fz * speed * dt
            if (
              Math.floor(boss.walkPhase / Math.PI) !==
              Math.floor((boss.walkPhase + dt * 6) / Math.PI)
            ) {
              cameraShakeRef.current.intensity = Math.max(cameraShakeRef.current.intensity, 2)
              spawnBossDust(boss.x + fx * 18, boss.z + fz * 18, 3)
            }
          }
          animateBossBody(boss, dt, moving)
          // Pick the next attack.
          if (now >= boss.nextDecisionAt) {
            const r = Math.random()
            if (dist < BOSS_STOMP_RANGE && r < 0.5) {
              boss.state = "stomp"
              boss.stompDone = false
              boss.stateUntil = now + 1500
            } else if (r < 0.78) {
              boss.state = "beam"
              boss.beamTargetX = focalPoint.x
              boss.beamTargetZ = focalPoint.z
              boss.poolDropAt = now + 400
              boss.stateUntil = now + BOSS_BEAM_SECONDS * 1000
              SOUNDS.bossRoar()
            } else {
              boss.state = "spawn"
              boss.spawnDone = false
              boss.stateUntil = now + 2200
            }
          }
        } else if (boss.state === "stomp") {
          // Raise the front legs, slam at ~0.8s, then recover.
          const t = (now - (boss.stateUntil - 1500)) / 1500
          const raise = t < 0.55 ? t / 0.55 : Math.max(0, 1 - (t - 0.55) / 0.25)
          for (let i = 0; i < boss.legs.length; i++) {
            const leg = boss.legs[i]
            if (leg && (i === 0 || i === 3)) leg.rotation.x = -raise * 1.2 // front legs up
          }
          if (!boss.stompDone && t >= 0.8) {
            boss.stompDone = true
            bossStompImpact(fx, fz, boss)
          }
          if (now >= boss.stateUntil) {
            boss.state = "advance"
            boss.nextDecisionAt = now + (boss.rage ? 1200 : 2400)
          }
        } else if (boss.state === "beam") {
          // Track the player slowly (dodgeable) and fire from the mouth.
          boss.beamTargetX += (focalPoint.x - boss.beamTargetX) * Math.min(1, dt * 0.9)
          boss.beamTargetZ += (focalPoint.z - boss.beamTargetZ) * Math.min(1, dt * 0.9)
          const headX = boss.x + fx * 20
          const headZ = boss.z + fz * 20
          const headY = 13
          const tx = boss.beamTargetX
          const tz = boss.beamTargetZ
          const dirx = tx - headX
          const diry = 0.3 - headY
          const dirz = tz - headZ
          const len = Math.hypot(dirx, diry, dirz) || 1
          boss.beam.visible = true
          boss.beam.position.set((headX + tx) / 2, (headY + 0.3) / 2, (headZ + tz) / 2)
          boss.beam.scale.set(1, len, 1)
          boss.beam.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(dirx / len, diry / len, dirz / len),
          )
          // Distance from the player to the beam's ground endpoint.
          if (Math.hypot(focalPoint.x - tx, focalPoint.z - tz) < 4) {
            applyPlayerDamage(BOSS_BEAM_DPS * dt, 1)
            bossPoisonHitAtRef.current = now
          }
          if (now >= boss.poolDropAt) {
            boss.poolDropAt = now + 500
            spawnBossPool(tx, tz)
          }
          animateBossBody(boss, dt, false)
          if (now >= boss.stateUntil) {
            boss.beam.visible = false
            boss.state = "advance"
            boss.nextDecisionAt = now + (boss.rage ? 1000 : 2200)
          }
        } else if (boss.state === "spawn") {
          boss.wingOpen = Math.min(1, boss.wingOpen + dt * 2)
          if (!boss.spawnDone && boss.wingOpen >= 0.9) {
            boss.spawnDone = true
            bossSpawnRoaches(boss)
            SOUNDS.bossRoar()
          }
          animateBossBody(boss, dt, false)
          if (now >= boss.stateUntil) {
            boss.state = "advance"
            boss.nextDecisionAt = now + (boss.rage ? 1200 : 2600)
          }
        }
        boss.group.position.set(boss.x, 0, boss.z)
        boss.group.rotation.y = boss.heading
      }

      // ══ HUNT mode (PR-Z1) — transfer room + leveled missions ════════════════
      function huntPersistTotal(n: number) {
        try {
          localStorage.setItem(HUNT_TOTAL_KEY, String(n))
        } catch {
          /* ignore */
        }
      }
      // Strong themed body recolour (handles Standard + Lambert materials).
      function huntTint(group: THREE.Object3D, hex: number, amt: number) {
        const target = new THREE.Color(hex)
        group.traverse((c) => {
          if (!(c instanceof THREE.Mesh)) return
          const m = c.material
          if (Array.isArray(m)) return
          if (
            (m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshLambertMaterial) &&
            m.color
          ) {
            const cloned = m.clone()
            cloned.color = m.color.clone().lerp(target, amt)
            c.material = cloned
          }
        })
      }
      // Glowing eyes double as visibility landmarks in the dark arena, so the
      // emissive is cranked up (minions 3.0, bosses 5.0).
      function huntGlowEyes(e: CombatEnemy, hex: number, intensity: number) {
        const glow = new THREE.MeshStandardMaterial({
          color: hex,
          emissive: hex,
          emissiveIntensity: intensity,
        })
        if (e.leftEye) e.leftEye.material = glow
        if (e.rightEye) e.rightEye.material = glow
        const eg = e.eyeGlowMat
        if (eg instanceof THREE.MeshStandardMaterial) {
          eg.color.setHex(hex)
          eg.emissive.setHex(hex)
          eg.emissiveIntensity = intensity
        }
      }
      // ── Monster creatures (shared low-poly geometry; per-instance mats) ──────
      const huntEyeGeo = new THREE.SphereGeometry(1, sseg(6), sseg(5))
      const huntBlobGeo = new THREE.SphereGeometry(1, sseg(8), sseg(6))
      const huntBoxGeo = new THREE.BoxGeometry(1, 1, 1)
      const huntConeGeo = new THREE.ConeGeometry(1, 1, sseg(6))
      const huntStalkGeo = new THREE.CylinderGeometry(0.5, 0.32, 1, sseg(6)) // tapered leaf/root
      // Build one original creature body, sized ~1.5–2.2 units tall (the enemy
      // root scale resizes it). Returns the group + animation handles.
      function makeHuntCreature(
        kind: HuntCreatureKind,
        bodyColor: number,
        eyeColor: number,
        isBoss: boolean,
      ) {
        const group = new THREE.Group()
        const bodyMat = new THREE.MeshStandardMaterial({
          color: bodyColor,
          roughness: 0.85,
          metalness: 0.05,
        })
        const darkMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(bodyColor).multiplyScalar(0.45),
          roughness: 0.95,
          metalness: 0,
        })
        const eyeMat = new THREE.MeshStandardMaterial({
          color: eyeColor,
          emissive: eyeColor,
          emissiveIntensity: 3,
          roughness: 0.4,
        })
        const eyeMats = [eyeMat]
        const twitch: THREE.Object3D[] = []
        const heads: THREE.Object3D[] = []
        let bossParts: HuntBossParts | undefined
        const addEye = (parent: THREE.Object3D, x: number, y: number, z: number, r: number) => {
          const m = new THREE.Mesh(huntEyeGeo, eyeMat)
          m.position.set(x, y, z)
          m.scale.setScalar(r)
          parent.add(m)
        }
        if (kind === "leek") {
          // "Leek-alien": a white bulb body on thin roots, with long green
          // leaves that sway from the top, and glowing red eyes. The boss is
          // the same shape with more, thicker leaves and twice the eyes.
          const greenMat = new THREE.MeshStandardMaterial({
            color: 0x228b22,
            roughness: 0.7,
            metalness: 0,
          })
          // White bulb body.
          const bulb = new THREE.Mesh(huntBlobGeo, bodyMat)
          bulb.position.y = 0.55
          bulb.scale.set(0.5, 0.62, 0.5)
          group.add(bulb)
          twitch.push(bulb)
          // Thin roots splaying down from the bulb.
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2
            const root = new THREE.Mesh(huntStalkGeo, bodyMat)
            root.scale.set(0.06, 0.4, 0.06)
            root.position.set(Math.cos(a) * 0.18, 0.1, Math.sin(a) * 0.18)
            root.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5)
            group.add(root)
          }
          // Long green leaves, pivoted at the bulb top so they sway (stored in
          // `heads` → animated by updateHuntCreatures). Tips bend slightly.
          const leafCount = isBoss ? 6 : 3
          const thick = isBoss ? 0.13 : 0.08
          const leafLen = isBoss ? 1.3 : 1.0
          for (let i = 0; i < leafCount; i++) {
            const a = (i / leafCount) * Math.PI * 2
            const leaf = new THREE.Group()
            leaf.position.set(Math.cos(a) * 0.12, 0.95, Math.sin(a) * 0.12)
            leaf.rotation.z = Math.cos(a) * 0.18
            leaf.rotation.x = Math.sin(a) * 0.18
            const blade = new THREE.Mesh(huntStalkGeo, greenMat)
            blade.scale.set(thick, leafLen, thick)
            blade.position.y = leafLen / 2
            leaf.add(blade)
            const tip = new THREE.Mesh(huntStalkGeo, greenMat)
            tip.scale.set(thick * 0.7, leafLen * 0.5, thick * 0.7)
            tip.position.set(0, leafLen * 0.95, 0.08)
            tip.rotation.x = 0.5
            leaf.add(tip)
            group.add(leaf)
            heads.push(leaf)
          }
          // Glowing red eyes on the bulb front (-z, the enemy facing axis).
          const eyeCount = isBoss ? 4 : 2
          const eyeR = isBoss ? 0.07 : 0.055
          for (let i = 0; i < eyeCount; i++) {
            const ex = (i - (eyeCount - 1) / 2) * 0.13
            addEye(group, ex, 0.6, -0.46, eyeR)
          }
        } else if (kind === "fleshball") {
          // A lump of pale meat covered in eyes + maws, crawling on stubby tentacles.
          const core = new THREE.Mesh(huntBlobGeo, bodyMat)
          core.position.y = 0.95
          core.scale.set(0.8, 0.66, 0.8)
          group.add(core)
          twitch.push(core)
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2
            const lump = new THREE.Mesh(huntBlobGeo, bodyMat)
            lump.position.set(Math.cos(a) * 0.55, 0.9 + Math.sin(i) * 0.28, Math.sin(a) * 0.55)
            lump.scale.setScalar(0.2 + Math.random() * 0.12)
            group.add(lump)
          }
          for (let i = 0; i < 10; i++) {
            const a = Math.random() * Math.PI * 2
            const yy = 0.6 + Math.random() * 0.7
            addEye(
              group,
              Math.cos(a) * 0.6,
              yy,
              Math.sin(a) * 0.6 - 0.1,
              0.07 + Math.random() * 0.05,
            )
          }
          for (let i = 0; i < 3; i++) {
            const a = Math.random() * Math.PI * 2
            const maw = new THREE.Mesh(huntConeGeo, darkMat)
            maw.position.set(
              Math.cos(a) * 0.52,
              0.7 + Math.random() * 0.5,
              Math.sin(a) * 0.52 - 0.3,
            )
            maw.scale.set(0.13, 0.2, 0.13)
            maw.rotation.x = Math.PI
            group.add(maw)
          }
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2
            const tent = new THREE.Mesh(huntBoxGeo, bodyMat)
            tent.position.set(Math.cos(a) * 0.5, 0.3, Math.sin(a) * 0.5)
            tent.scale.set(0.1, 0.62, 0.1)
            tent.rotation.set(Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5)
            group.add(tent)
            twitch.push(tent)
          }
        } else if (kind === "tall") {
          // An abnormally tall, thin figure: blank oval face, kinked long limbs.
          const torso = new THREE.Mesh(huntBoxGeo, bodyMat)
          torso.position.y = 1.5
          torso.scale.set(0.34, 1.0, 0.24)
          group.add(torso)
          twitch.push(torso)
          const hips = new THREE.Mesh(huntBoxGeo, bodyMat)
          hips.position.y = 0.95
          hips.scale.set(0.3, 0.3, 0.22)
          group.add(hips)
          for (const s of [-1, 1]) {
            const thigh = new THREE.Mesh(huntBoxGeo, bodyMat)
            thigh.position.set(s * 0.12, 0.55, 0)
            thigh.scale.set(0.1, 0.72, 0.1)
            thigh.rotation.x = s * 0.1
            group.add(thigh)
            const shin = new THREE.Mesh(huntBoxGeo, bodyMat)
            shin.position.set(s * 0.12, 0.0, 0.02)
            shin.scale.set(0.09, 0.6, 0.09)
            group.add(shin)
            const upper = new THREE.Mesh(huntBoxGeo, bodyMat)
            upper.position.set(s * 0.28, 1.55, 0)
            upper.scale.set(0.09, 0.82, 0.09)
            upper.rotation.z = s * 0.3
            group.add(upper)
            twitch.push(upper)
            const fore = new THREE.Mesh(huntBoxGeo, bodyMat)
            fore.position.set(s * 0.44, 0.95, 0.1)
            fore.scale.set(0.08, 0.82, 0.08)
            fore.rotation.set(-0.6, 0, s * 0.2)
            group.add(fore)
            twitch.push(fore)
          }
          const head = new THREE.Group()
          head.position.y = 2.18
          group.add(head)
          heads.push(head)
          const mask = new THREE.Mesh(huntBlobGeo, bodyMat)
          mask.scale.set(0.2, 0.28, 0.16)
          head.add(mask)
          addEye(head, -0.07, 0.02, -0.15, 0.04)
          addEye(head, 0.07, 0.02, -0.15, 0.04)
        } else if (kind === "multihead_boss") {
          // ── Lv1 boss: MULTI-HEAD ── a hunched skin-coloured body with three
          // twitching skulls and eyeballs sprouting all over it.
          const S = isBoss ? 3.0 : 1.0
          const skinMat = new THREE.MeshLambertMaterial({ color: 0xc8b8a2 })
          const ebGeo = new THREE.SphereGeometry(0.06, 6, 6)
          const pupilGeo = new THREE.SphereGeometry(0.03, 6, 6)
          const eyeballMat = new THREE.MeshLambertMaterial({ color: 0xf0f0f0, emissive: 0x220000 })
          const pupilMat = new THREE.MeshLambertMaterial({ color: 0x000000 })
          const eyeballs: THREE.Object3D[] = []
          // Trunk.
          const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.8, 8), skinMat)
          torso.position.y = 1.5
          group.add(torso)
          twitch.push(torso)
          // Arms ×2, splayed outward.
          for (const s of [-1, 1]) {
            const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 6), skinMat)
            arm.position.set(s * 0.55, 1.7, 0)
            arm.rotation.z = s * 0.3
            group.add(arm)
            twitch.push(arm)
          }
          // Legs ×2.
          for (const s of [-1, 1]) {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.9, 6), skinMat)
            leg.position.set(s * 0.2, 0.45, 0)
            group.add(leg)
          }
          // Heads ×3 in a triangle on the upper trunk, each slightly tilted.
          const headSlots: [number, number, number][] = [
            [0, 2.55, 0.06],
            [-0.28, 2.36, -0.06],
            [0.28, 2.36, -0.06],
          ]
          for (let i = 0; i < 3; i++) {
            const hd = new THREE.Group()
            const [hx, hy, hz] = headSlots[i] ?? [0, 2.5, 0]
            hd.position.set(hx, hy, hz)
            hd.rotation.z = (i - 1) * 0.22
            const skull = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), skinMat)
            hd.add(skull)
            group.add(hd)
            heads.push(hd)
          }
          // Eyeballs ×10 scattered over body / arms / heads, each with a pupil.
          for (let i = 0; i < 10; i++) {
            const a = Math.random() * Math.PI * 2
            const rr = 0.28 + Math.random() * 0.26
            const yy = 1.0 + Math.random() * 1.6
            const eb = new THREE.Mesh(ebGeo, eyeballMat)
            eb.position.set(Math.cos(a) * rr, yy, Math.sin(a) * rr - 0.12)
            const pupil = new THREE.Mesh(pupilGeo, pupilMat)
            pupil.position.set(0, 0, -0.05)
            eb.add(pupil)
            group.add(eb)
            eyeballs.push(eb)
          }
          group.scale.setScalar(S)
          bossParts = {
            kind,
            eyeballs,
            faceMats: [],
            faceEyeMats: [],
            armFaces: [],
            arms: [],
            armBaseY: [],
          }
        } else if (kind === "splitskin_boss") {
          // ── Lv2 boss: SPLIT-SKIN ── a translucent dark figure whose skin is
          // splitting open to reveal screaming faces underneath.
          const S = isBoss ? 3.0 : 1.0
          const skinMat = new THREE.MeshLambertMaterial({
            color: 0x2a2a2a,
            transparent: true,
            opacity: 0.75,
          })
          const faceMats: THREE.MeshLambertMaterial[] = []
          const faceEyeMats: THREE.MeshLambertMaterial[] = []
          const armFaces: THREE.Object3D[] = []
          // Torso + head (translucent dark skin).
          const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 2.4, 8), skinMat)
          torso.position.y = 1.9
          group.add(torso)
          twitch.push(torso)
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 8), skinMat)
          head.position.y = 3.35
          group.add(head)
          // Arms ×2 with a face on each fist.
          for (const s of [-1, 1]) {
            const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.15, 2.0, 6), skinMat)
            arm.position.set(s * 0.95, 2.1, 0)
            arm.rotation.z = s * 0.4
            group.add(arm)
            twitch.push(arm)
            const af = new THREE.Group()
            af.position.set(s * 1.55, 1.25, 0)
            const fistFace = new THREE.Mesh(
              new THREE.SphereGeometry(0.2, 6, 6),
              new THREE.MeshLambertMaterial({ color: 0xc0a090 }),
            )
            af.add(fistFace)
            group.add(af)
            armFaces.push(af)
          }
          // Legs ×2.
          for (const s of [-1, 1]) {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 1.5, 6), skinMat)
            leg.position.set(s * 0.32, 0.75, 0)
            group.add(leg)
          }
          // Inner faces ×5 embedded in the torso / head surface, each lit by a
          // pair of red eyes.
          const faceSlots: [number, number, number][] = [
            [0, 2.0, -0.66],
            [-0.42, 1.45, -0.55],
            [0.42, 1.65, -0.5],
            [0, 3.0, -0.42],
            [-0.22, 2.55, -0.58],
          ]
          for (let i = 0; i < 5; i++) {
            const fm = new THREE.MeshLambertMaterial({ color: 0xc0a090, emissive: 0x1a0000 })
            faceMats.push(fm)
            const f = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), fm)
            const [fx, fy, fz] = faceSlots[i] ?? [0, 2, -0.5]
            f.position.set(fx, fy, fz)
            group.add(f)
            for (const ex of [-0.07, 0.07]) {
              const em = new THREE.MeshLambertMaterial({
                color: 0xff0000,
                emissive: 0xff0000,
                emissiveIntensity: 1.5,
              })
              faceEyeMats.push(em)
              const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), em)
              eye.position.set(ex, 0.03, -0.15)
              f.add(eye)
            }
          }
          // Splits ×5 — thin glowing tears running vertically around the torso.
          const splitMat = new THREE.MeshLambertMaterial({ color: 0x3a0000, emissive: 0x200000 })
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2
            const split = new THREE.Mesh(new THREE.BoxGeometry(0.025, 2.4, 0.08), splitMat)
            split.position.set(Math.cos(a) * 0.78, 1.9, Math.sin(a) * 0.78)
            split.rotation.y = -a
            group.add(split)
          }
          group.scale.setScalar(S)
          bossParts = {
            kind,
            eyeballs: [],
            body: torso,
            faceMats,
            faceEyeMats,
            armFaces,
            arms: [],
            armBaseY: [],
          }
        } else if (kind === "amalgam_boss") {
          // ── Lv3 boss: AMALGAM ── a heaving mass of fused flesh bristling with
          // tendrils, half-formed heads and stumpy legs. Enters a rage at <50% HP.
          const S = isBoss ? 2.5 : 1.0
          const coreMat = new THREE.MeshLambertMaterial({ color: 0x8b4040 })
          const faceEyeMats: THREE.MeshLambertMaterial[] = []
          const arms: THREE.Object3D[] = []
          const armBaseY: number[] = []
          // Central lumpy core (vertices jittered for a meaty silhouette).
          const coreGeo = new THREE.SphereGeometry(2.0, 8, 8)
          const cpos = coreGeo.attributes.position as THREE.BufferAttribute
          for (let i = 0; i < cpos.count; i++) {
            cpos.setXYZ(
              i,
              cpos.getX(i) + (Math.random() - 0.5) * 0.6,
              cpos.getY(i) + (Math.random() - 0.5) * 0.6,
              cpos.getZ(i) + (Math.random() - 0.5) * 0.6,
            )
          }
          coreGeo.computeVertexNormals()
          const core = new THREE.Mesh(coreGeo, coreMat)
          core.position.y = 2.6
          group.add(core)
          // Sub-cores ×4 half-buried in the main mass.
          const subMat = new THREE.MeshLambertMaterial({ color: 0x7a3535 })
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + 0.4
            const sub = new THREE.Mesh(
              new THREE.SphereGeometry(0.8 + Math.random() * 0.4, 7, 7),
              subMat,
            )
            sub.position.set(Math.cos(a) * 1.6, 2.6 + Math.sin(i) * 0.6, Math.sin(a) * 1.6)
            group.add(sub)
          }
          // Tendril arms ×7 jutting out in random directions, bobbing in place.
          const armMat = new THREE.MeshLambertMaterial({ color: 0x8b4040 })
          for (let i = 0; i < 7; i++) {
            const len = 2.5 + Math.random() * 1.5
            const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.28, len, 5), armMat)
            const a = Math.random() * Math.PI * 2
            arm.position.set(Math.cos(a) * 1.8, 2.0 + Math.random() * 1.6, Math.sin(a) * 1.8)
            arm.rotation.set(
              (Math.random() - 0.5) * 2.2,
              Math.random() * Math.PI * 2,
              (Math.random() - 0.5) * 2.2,
            )
            group.add(arm)
            arms.push(arm)
            armBaseY.push(arm.position.y)
          }
          // Heads ×5 with red eyes, fused at odd angles.
          const headMat = new THREE.MeshLambertMaterial({ color: 0x9a5050 })
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2 + 0.9
            const hd = new THREE.Group()
            hd.position.set(Math.cos(a) * 1.4, 3.0 + Math.sin(i * 1.3) * 0.9, Math.sin(a) * 1.4)
            hd.rotation.y = a
            const skull = new THREE.Mesh(
              new THREE.SphereGeometry(0.35 + Math.random() * 0.2, 7, 7),
              headMat,
            )
            hd.add(skull)
            for (const ex of [-0.13, 0.13]) {
              const em = new THREE.MeshLambertMaterial({
                color: 0xff0000,
                emissive: 0xff0000,
                emissiveIntensity: 1.5,
              })
              faceEyeMats.push(em)
              const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), em)
              eye.position.set(ex, 0.05, -0.3)
              hd.add(eye)
            }
            group.add(hd)
            heads.push(hd)
          }
          // Legs ×4 — squat trunks holding the mass up.
          const legMat = new THREE.MeshLambertMaterial({ color: 0x6a2a2a })
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + 0.78
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 3.0, 6), legMat)
            leg.position.set(Math.cos(a) * 1.2, 1.0, Math.sin(a) * 1.2)
            group.add(leg)
          }
          group.scale.setScalar(S)
          bossParts = {
            kind,
            eyeballs: [],
            faceMats: [],
            faceEyeMats,
            armFaces: [],
            core,
            coreMat,
            arms,
            armBaseY,
          }
        } else {
          // A four-legged beast with three independent heads on long necks.
          const trunk = new THREE.Mesh(huntBlobGeo, bodyMat)
          trunk.position.set(0, 1.0, 0.2)
          trunk.scale.set(0.6, 0.5, 0.95)
          group.add(trunk)
          twitch.push(trunk)
          for (const [lx, lz] of [
            [-0.4, -0.5],
            [0.4, -0.5],
            [-0.4, 0.7],
            [0.4, 0.7],
          ] as const) {
            const leg = new THREE.Mesh(huntBoxGeo, darkMat)
            leg.position.set(lx, 0.45, lz)
            leg.scale.set(0.16, 0.9, 0.16)
            group.add(leg)
          }
          for (let i = 0; i < 3; i++) {
            const off = (i - 1) * 0.32
            const neck = new THREE.Group()
            neck.position.set(off, 1.3, -0.5)
            group.add(neck)
            heads.push(neck)
            const nb = new THREE.Mesh(huntBoxGeo, bodyMat)
            nb.position.set(0, 0.3, -0.1)
            nb.scale.set(0.12, 0.7, 0.12)
            nb.rotation.x = -0.5
            neck.add(nb)
            const headG = new THREE.Group()
            headG.position.set(0, 0.6, -0.35)
            neck.add(headG)
            const skull = new THREE.Mesh(huntBlobGeo, bodyMat)
            skull.scale.set(0.16, 0.16, 0.24)
            headG.add(skull)
            const jaw = new THREE.Mesh(huntConeGeo, darkMat)
            jaw.position.set(0, -0.05, -0.2)
            jaw.scale.set(0.1, 0.18, 0.1)
            jaw.rotation.x = -Math.PI / 2
            headG.add(jaw)
            addEye(headG, -0.06, 0.05, -0.18, 0.04)
            addEye(headG, 0.06, 0.05, -0.18, 0.04)
          }
        }
        return { group, eyeMats, twitch, heads, boss: bossParts }
      }
      // Build one themed minion / boss, push it into `enemies`, return it.
      function huntMakeEnemy(
        base: EnemyType,
        x: number,
        z: number,
        scale: number,
        tint: number,
        eyes: number,
        points: number,
        hp: number,
        speed: number,
        isBoss: boolean,
        name: string,
        creatureKind: HuntCreatureKind,
      ): CombatEnemy {
        const e = makeEnemy(base, x, z, false, scale)
        // Stealth (PR-Z2): HUNT enemies only notice the player up close, so the
        // blade lets you pick them off quietly. Guns are still loud (the noise
        // system aggros nearby enemies on fire).
        e.config = {
          ...e.config,
          hp,
          score: points,
          speed,
          sightRange: isBoss ? HUNT_STEALTH_SIGHT * 1.7 : HUNT_STEALTH_SIGHT,
        }
        e.hp = hp
        e.maxHp = hp
        huntTint(e.mesh, tint, isBoss ? 0.6 : 0.78)
        huntGlowEyes(e, eyes, isBoss ? 5.0 : 3.0)
        e.huntPoints = points
        e.huntName = name
        e.isHuntBoss = isBoss
        if (isBoss) e.huntNextSpecial = Date.now() + 10000
        // Swap the humanoid skin for a monster creature: hide the built body
        // (the skeleton still drives AI + death), then ride a creature on the
        // root. The eyes glow strongly for night visibility (boss brighter).
        for (const c of e.mesh.children) c.visible = false
        const cr = makeHuntCreature(creatureKind, tint, eyes, isBoss)
        for (const m of cr.eyeMats) m.emissiveIntensity = isBoss ? 5.0 : 3.0
        e.mesh.add(cr.group)
        e.huntCreature = {
          eyeMats: cr.eyeMats,
          twitch: cr.twitch,
          heads: cr.heads,
          phase: Math.random() * Math.PI * 2,
          nextJerk: Date.now() + 1000 + Math.random() * 3000,
          ...(cr.boss ? { boss: cr.boss } : {}),
        }
        enemies.push(e)
        return e
      }
      // Per-frame creepy idle for the monster creatures: uneasy eye glow,
      // irregular twitches with sudden jerks, and independently-swaying heads.
      function updateHuntCreatures(dt: number) {
        if (modeRef.current !== "hunt") return
        const now = Date.now()
        for (const e of enemies) {
          const cr = e.huntCreature
          if (!cr || e.hp <= 0) continue
          cr.phase += dt
          const pulse = 2.6 + Math.sin(now * 0.006 + cr.phase) * 1.4
          for (const m of cr.eyeMats) m.emissiveIntensity = (e.isHuntBoss ? 1.7 : 1) * pulse
          const jerking = now > cr.nextJerk && now < cr.nextJerk + 220
          for (let i = 0; i < cr.twitch.length; i++) {
            const t = cr.twitch[i]
            if (!t) continue
            const j = jerking ? Math.sin(now * 0.05 + i) * 0.13 : 0
            t.rotation.z = Math.sin(now * 0.004 + cr.phase + i) * 0.06 + j
          }
          if (now > cr.nextJerk + 220) cr.nextJerk = now + 1200 + Math.random() * 3000
          if (cr.boss) {
            updateHuntBoss(cr, e, now)
            continue
          }
          for (let i = 0; i < cr.heads.length; i++) {
            const h = cr.heads[i]
            if (!h) continue
            h.rotation.y = Math.sin(now * 0.0018 + cr.phase + i * 2.1) * 0.5
            h.rotation.x = Math.sin(now * 0.0026 + cr.phase + i) * 0.25
          }
        }
      }
      // PR boss-designs: per-frame motion for the three dedicated HUNT bosses
      // (driven from updateHuntCreatures). Each boss kind animates the handles
      // captured at build time; AMALGAM also flips into a rage state below 50% HP.
      function updateHuntBoss(
        cr: NonNullable<CombatEnemy["huntCreature"]>,
        e: CombatEnemy,
        now: number,
      ) {
        const b = cr.boss
        if (!b) return
        const t = now * 0.001
        const rage = e.hp < e.maxHp * 0.5
        if (b.kind === "multihead_boss") {
          // Three skulls sway on independent periods.
          for (let i = 0; i < cr.heads.length; i++) {
            const h = cr.heads[i]
            if (!h) continue
            h.rotation.y = Math.sin(t * (0.7 + i * 0.45) + cr.phase) * 0.6
            h.rotation.x = Math.sin(t * (0.5 + i * 0.3)) * 0.18
          }
          // Eyeballs pulse between 0.9 and 1.1.
          for (let i = 0; i < b.eyeballs.length; i++) {
            const eb = b.eyeballs[i]
            if (!eb) continue
            eb.scale.setScalar(1 + Math.sin(t * 3 + i * 1.7) * 0.1)
          }
        } else if (b.kind === "splitskin_boss") {
          // Torso breathing (scale.y 0.97–1.03).
          if (b.body) b.body.scale.y = 1 + Math.sin(t * 1.6 + cr.phase) * 0.03
          // Inner faces flicker on staggered timing.
          for (let i = 0; i < b.faceMats.length; i++) {
            const fm = b.faceMats[i]
            if (!fm) continue
            fm.emissiveIntensity = 0.6 + Math.abs(Math.sin(t * (2.3 + i * 0.9) + i)) * 0.9
          }
          // Fist faces turn to track the player.
          if (b.armFaces.length) {
            const aim =
              Math.atan2(focalPoint.x - e.mesh.position.x, focalPoint.z - e.mesh.position.z) -
              e.mesh.rotation.y
            for (const af of b.armFaces) af.rotation.y += (aim - af.rotation.y) * 0.08
          }
        } else {
          // AMALGAM — heaving core (period ~3.5s), bobbing tendrils, rage state.
          const speed = rage ? 2 : 1
          if (b.core) b.core.scale.setScalar(1 + Math.sin(t * 1.8 * speed + cr.phase) * 0.05)
          for (let i = 0; i < b.arms.length; i++) {
            const arm = b.arms[i]
            if (!arm) continue
            arm.position.y = (b.armBaseY[i] ?? arm.position.y) + Math.sin(t * 1.4 + i * 1.1) * 0.3
          }
          for (let i = 0; i < cr.heads.length; i++) {
            const h = cr.heads[i]
            if (!h) continue
            h.rotation.x = Math.sin(t * (0.9 + i * 0.2)) * 0.2
          }
          const eyeI = rage ? 3.0 : 1.5
          for (const em of b.faceEyeMats) em.emissiveIntensity = eyeI
          if (b.coreMat) b.coreMat.color.setHex(rage ? 0xa03030 : 0x8b4040)
        }
      }
      // Remove every (live or dying) enemy mesh and empty the array.
      function huntClearEnemies() {
        for (const e of enemies) scene.remove(e.mesh)
        enemies.length = 0
        setAliveEnemyCount(0)
      }
      // ── Transfer room (built once on init) ──────────────────────────────────
      // Room fill ambient (global light): on while in the room, off during a
      // mission so the night arena stays dark. Toggled in updateHunt.
      let huntRoomAmbient: THREE.AmbientLight | null = null
      // Warm "sunrise through the window" key light — on in the room, off during
      // a mission (toggled in updateHunt) so it doesn't tint the night arena.
      let huntRoomSun: THREE.DirectionalLight | null = null
      function buildHuntRoom() {
        const cx = HUNT_ROOM.x
        const cz = HUNT_ROOM.z
        const W = HUNT_ROOM_HALF + 1.5 // wall half-extent (interior is a bit smaller)
        // ── Apartment surfaces: a bright, ordinary room (white walls, wood
        // floor, off-white ceiling) so the dawn light reads naturally. ──
        const wallMat = new THREE.MeshStandardMaterial({
          color: 0xece7dc,
          roughness: 0.92,
          metalness: 0,
        })
        const floorMat = new THREE.MeshStandardMaterial({
          color: 0x7c5230,
          roughness: 0.7,
          metalness: 0.05,
        })
        const ceilMat = new THREE.MeshStandardMaterial({
          color: 0xf3efe6,
          roughness: 0.95,
          metalness: 0,
        })
        const frameMat = new THREE.MeshStandardMaterial({
          color: 0x3a2a1c,
          roughness: 0.7,
          metalness: 0.1,
        })
        const group = new THREE.Group()
        group.position.set(cx, 0, cz)
        // ── Lighting: a bright white fill + warm sunrise key from the window. ──
        huntRoomAmbient = new THREE.AmbientLight(0xffffff, 1.2)
        group.add(huntRoomAmbient)
        // Warm directional "morning sun" angled in through the north window.
        // Added to the scene (not the group) so its world target is controllable;
        // toggled off during a mission in updateHunt.
        huntRoomSun = new THREE.DirectionalLight(0xfff0dd, 1.5)
        huntRoomSun.position.set(cx, 8, cz - W - 6)
        huntRoomSun.target.position.set(cx, 1, cz + 1)
        scene.add(huntRoomSun)
        scene.add(huntRoomSun.target)
        // A soft warm glow right at the window for a local bloom (range-limited
        // so it never reaches the distant arena).
        const winGlow = new THREE.PointLight(0xffd9a8, 1.4, 18)
        winGlow.position.set(0, 2.4, -W + 0.5)
        group.add(winGlow)
        const floor = new THREE.Mesh(new THREE.BoxGeometry(W * 2, 0.2, W * 2), floorMat)
        floor.position.y = -0.1
        floor.receiveShadow = true
        group.add(floor)
        const ceil = new THREE.Mesh(new THREE.BoxGeometry(W * 2, 0.2, W * 2), ceilMat)
        ceil.position.y = 4.0
        group.add(ceil)
        // Three solid walls (E / W / S). The N wall holds the big window.
        for (const [dx, dz, sx, sz] of [
          [0, W, W * 2, 0.3],
          [-W, 0, 0.3, W * 2],
          [W, 0, 0.3, W * 2],
        ] as const) {
          const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, 4.2, sz), wallMat)
          wall.position.set(dx, 2.0, dz)
          group.add(wall)
        }
        // North wall with a large central window opening (side piers + lintel +
        // sill), plus a cross-mullion frame.
        const winHalf = 2.6 // window half-width
        const sillY = 0.9
        const headY = 3.2
        for (const [px, pw] of [
          [-(W + winHalf) / 2 - 0.4, W - winHalf],
          [(W + winHalf) / 2 + 0.4, W - winHalf],
        ] as const) {
          const pier = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.2, pw), 4.2, 0.3), wallMat)
          pier.position.set(px, 2.0, -W)
          group.add(pier)
        }
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(winHalf * 2, 4.2 - headY, 0.3), wallMat)
        lintel.position.set(0, headY + (4.2 - headY) / 2 - 0.0, -W)
        group.add(lintel)
        const sill = new THREE.Mesh(new THREE.BoxGeometry(winHalf * 2, sillY, 0.34), frameMat)
        sill.position.set(0, sillY / 2, -W)
        group.add(sill)
        for (const mx of [-winHalf, 0, winHalf]) {
          const mull = new THREE.Mesh(new THREE.BoxGeometry(0.1, headY - sillY, 0.12), frameMat)
          mull.position.set(mx, (sillY + headY) / 2, -W)
          group.add(mull)
        }
        const crossMull = new THREE.Mesh(new THREE.BoxGeometry(winHalf * 2, 0.1, 0.12), frameMat)
        crossMull.position.set(0, (sillY + headY) / 2, -W)
        group.add(crossMull)
        // ── Dawn skyline beyond the window: a gradient sky + building
        // silhouettes + an original red/white radio tower. ──
        const skyCanvas = document.createElement("canvas")
        skyCanvas.width = 16
        skyCanvas.height = 256
        const skyCtx = skyCanvas.getContext("2d")
        if (skyCtx) {
          const grad = skyCtx.createLinearGradient(0, 0, 0, 256)
          grad.addColorStop(0, "#241a40") // indigo zenith
          grad.addColorStop(0.55, "#8a4a7a") // violet
          grad.addColorStop(0.8, "#e08a4a") // amber
          grad.addColorStop(1, "#ffd28a") // pale horizon glow
          skyCtx.fillStyle = grad
          skyCtx.fillRect(0, 0, 16, 256)
        }
        const skyTex = new THREE.CanvasTexture(skyCanvas)
        const sky = new THREE.Mesh(
          new THREE.PlaneGeometry(70, 34),
          new THREE.MeshBasicMaterial({ map: skyTex, depthWrite: false }),
        )
        sky.position.set(0, 8, -W - 22)
        group.add(sky)
        // Distant building silhouettes (shared dark material).
        const cityMat = new THREE.MeshBasicMaterial({ color: 0x14101f })
        for (let i = 0; i < 14; i++) {
          const bw = 1.6 + Math.random() * 3.2
          const bh = 3 + Math.random() * 9
          const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 1), cityMat)
          b.position.set(
            -26 + i * 4 + Math.random() * 1.5,
            bh / 2 - 0.5,
            -W - 16 - Math.random() * 4,
          )
          group.add(b)
        }
        // Original radio tower — a tapered four-leg truss pyramid with red/white
        // bands and a blinking-style beacon, off to one side.
        const tower = new THREE.Group()
        const towerRed = new THREE.MeshBasicMaterial({ color: 0xd83a2a })
        const towerWhite = new THREE.MeshBasicMaterial({ color: 0xe8e4dc })
        const TH = 18
        for (const [lx, lz] of [
          [-1.4, -1.4],
          [1.4, -1.4],
          [-1.4, 1.4],
          [1.4, 1.4],
        ] as const) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.16, TH, 5), towerWhite)
          leg.position.set(lx * 0.35, TH / 2, lz * 0.35)
          leg.rotation.set((lz * 0.06) / 1.4, 0, (-lx * 0.06) / 1.4)
          tower.add(leg)
        }
        for (let i = 0; i < 7; i++) {
          const t = i / 7
          const ringR = 1.4 * (1 - t * 0.8)
          const ring = new THREE.Mesh(
            new THREE.BoxGeometry(ringR * 2, 0.5, 0.12),
            i % 2 === 0 ? towerRed : towerWhite,
          )
          ring.position.set(0, 1.5 + i * (TH / 8), 0)
          tower.add(ring)
        }
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 5, 5), towerWhite)
        mast.position.set(0, TH + 2.5, 0)
        tower.add(mast)
        const beacon = new THREE.Mesh(
          new THREE.SphereGeometry(0.35, sseg(8), sseg(6)),
          new THREE.MeshBasicMaterial({ color: 0xff3322 }),
        )
        beacon.position.set(0, TH + 5, 0)
        tower.add(beacon)
        tower.position.set(20, 0, -W - 20)
        group.add(tower)
        // ── The orb on its pedestal (centre of the room). ──
        const pedestal = new THREE.Mesh(
          new THREE.CylinderGeometry(0.7, 0.9, 0.8, 16),
          new THREE.MeshStandardMaterial({ color: 0x14110e, roughness: 0.6, metalness: 0.4 }),
        )
        pedestal.position.set(0, 0.4, 0)
        group.add(pedestal)
        const orb = new THREE.Mesh(
          new THREE.SphereGeometry(1.0, sseg(32), sseg(24)),
          new THREE.MeshStandardMaterial({ color: 0x040406, roughness: 0.1, metalness: 0.9 }),
        )
        orb.position.set(0, 1.7, 0)
        group.add(orb)
        // Seated faceless silhouette inside the orb (revealed when it opens).
        const personMat = new THREE.MeshStandardMaterial({
          color: 0x0a0a0e,
          roughness: 0.9,
          metalness: 0,
        })
        const person = new THREE.Group()
        const pHead = new THREE.Mesh(new THREE.SphereGeometry(0.2, sseg(10), sseg(8)), personMat)
        pHead.position.set(0, 0.62, 0)
        person.add(pHead)
        const pTorso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.5, 0.22), personMat)
        pTorso.position.set(0, 0.25, 0)
        pTorso.rotation.x = 0.18
        person.add(pTorso)
        for (const s of [-1, 1]) {
          const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.32, 0.16), personMat)
          thigh.position.set(s * 0.11, -0.02, 0.12)
          thigh.rotation.x = 1.3
          person.add(thigh)
          const shin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.14), personMat)
          shin.position.set(s * 0.11, -0.12, 0.26)
          person.add(shin)
          const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.1), personMat)
          arm.position.set(s * 0.22, 0.24, 0.06)
          arm.rotation.x = 0.5
          person.add(arm)
        }
        person.position.set(0, 1.35, 0)
        person.visible = false
        group.add(person)
        // Green-text briefing the orb projects toward the spawn (+z).
        const canvas = document.createElement("canvas")
        canvas.width = 1024
        canvas.height = 512
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        const texture = new THREE.CanvasTexture(canvas)
        const readout = new THREE.Mesh(
          new THREE.PlaneGeometry(1.9, 0.95),
          new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
        )
        readout.position.set(0, 1.7, 1.02)
        group.add(readout)
        // Split shells (hidden until the orb "opens").
        const shellMat = new THREE.MeshStandardMaterial({
          color: 0x050507,
          roughness: 0.12,
          metalness: 0.9,
          side: THREE.DoubleSide,
        })
        const leftHalf = new THREE.Mesh(
          new THREE.SphereGeometry(1.04, sseg(24), sseg(18), 0, Math.PI),
          shellMat,
        )
        const rightHalf = new THREE.Mesh(
          new THREE.SphereGeometry(1.04, sseg(24), sseg(18), Math.PI, Math.PI),
          shellMat,
        )
        leftHalf.position.copy(orb.position)
        rightHalf.position.copy(orb.position)
        leftHalf.visible = false
        rightHalf.visible = false
        group.add(leftHalf)
        group.add(rightHalf)
        const rackMat = new THREE.MeshStandardMaterial({
          color: 0x2a2f38,
          roughness: 0.5,
          metalness: 0.7,
          emissive: 0x113322,
          emissiveIntensity: 0.4,
        })
        const weaponRack = new THREE.Group()
        for (const gx of [-0.45, 0.45]) {
          const gun = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.9), rackMat)
          gun.position.set(gx, 1.7, 0)
          weaponRack.add(gun)
        }
        weaponRack.visible = false
        group.add(weaponRack)
        const suitcase = new THREE.Mesh(
          new THREE.BoxGeometry(0.9, 0.6, 0.25),
          new THREE.MeshStandardMaterial({
            color: 0x3a2a16,
            roughness: 0.6,
            metalness: 0.3,
            emissive: 0x221100,
            emissiveIntensity: 0.3,
          }),
        )
        suitcase.position.set(0, 1.7, -0.9)
        suitcase.visible = false
        group.add(suitcase)
        // Inert door on the +z (south) wall — opens as post-mission flavour.
        const door = new THREE.Mesh(
          new THREE.BoxGeometry(1.6, 3.2, 0.16),
          new THREE.MeshStandardMaterial({ color: 0x6a4a2c, roughness: 0.8, metalness: 0.1 }),
        )
        door.position.set(2.4, 1.6, W - 0.05)
        group.add(door)
        scene.add(group)
        huntRoomRef.current = {
          orb,
          canvas,
          ctx,
          texture,
          leftHalf,
          rightHalf,
          suitcase,
          door,
          person,
          open: 0,
          page: 0,
          pageAt: 0,
          jingled: false,
          banged: false,
        }
        // `weaponRack` is parked on the orb so the open anim can find it.
        orb.userData.weaponRack = weaponRack
      }
      // Draw the orb readout for the given page (0 greeting / 1 target / 2 time).
      function huntDrawOrb(page: number) {
        const room = huntRoomRef.current
        if (!room) return
        const { ctx, canvas, texture } = room
        const W = canvas.width
        const H = canvas.height
        ctx.clearRect(0, 0, W, H)
        ctx.fillStyle = "rgba(0,10,2,0.55)"
        ctx.fillRect(0, 0, W, H)
        ctx.strokeStyle = "rgba(0,255,80,0.5)"
        ctx.lineWidth = 6
        ctx.strokeRect(14, 14, W - 28, H - 28)
        ctx.fillStyle = "#39ff7a"
        ctx.shadowColor = "#00ff55"
        ctx.shadowBlur = 18
        ctx.textAlign = "center"
        const lv = HUNT_LEVELS[huntLevelIdxRef.current]
        if (!lv) return
        const wrap = (text: string, font: string, y: number, lh: number, maxW: number) => {
          ctx.font = font
          const words = text.split("")
          let line = ""
          let yy = y
          for (const ch of words) {
            if (ctx.measureText(line + ch).width > maxW && line) {
              ctx.fillText(line, W / 2, yy)
              line = ch
              yy += lh
            } else line += ch
          }
          if (line) ctx.fillText(line, W / 2, yy)
          return yy
        }
        if (page === 0) {
          ctx.font = "bold 54px monospace"
          ctx.fillText(`HUNT  Lv.${lv.level}`, W / 2, 90)
          wrap(HUNT_GREETINGS[huntGreetingRef.current] ?? "", "30px monospace", 190, 52, W - 90)
        } else if (page === 1) {
          ctx.font = "bold 46px monospace"
          ctx.fillText("◆ 標的 TARGET ◆", W / 2, 70)
          const th = HUNT_THEMES[lv.theme]
          const green = "rgba(57,255,122,0.85)"
          ctx.fillStyle = green
          ctx.strokeStyle = green
          const sx = 160
          const sy = 250
          // Original monster silhouette per creature theme.
          if (th.creature === "leek") {
            // White bulb + long leaves + roots (drawn in CRT green).
            ctx.beginPath()
            ctx.ellipse(sx, sy + 40, 48, 60, 0, 0, Math.PI * 2)
            ctx.fill()
            ctx.lineWidth = 12
            for (let i = 0; i < 5; i++) {
              const x = sx - 40 + i * 20
              ctx.beginPath()
              ctx.moveTo(x, sy - 10)
              ctx.lineTo(x + (i - 2) * 14, sy - 180)
              ctx.stroke()
            }
            ctx.lineWidth = 6
            for (let i = 0; i < 4; i++) {
              const x = sx - 30 + i * 20
              ctx.beginPath()
              ctx.moveTo(x, sy + 95)
              ctx.lineTo(x + (i - 1.5) * 8, sy + 165)
              ctx.stroke()
            }
            ctx.fillStyle = "#04140a"
            ctx.beginPath()
            ctx.arc(sx - 16, sy + 30, 7, 0, Math.PI * 2)
            ctx.fill()
            ctx.beginPath()
            ctx.arc(sx + 16, sy + 30, 7, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = green
          } else if (th.creature === "fleshball") {
            ctx.beginPath()
            ctx.arc(sx, sy - 20, 78, 0, Math.PI * 2)
            ctx.fill()
            for (let i = 0; i < 6; i++) {
              const a = (i / 6) * Math.PI * 2
              ctx.beginPath()
              ctx.arc(sx + Math.cos(a) * 70, sy - 20 + Math.sin(a) * 70, 20, 0, Math.PI * 2)
              ctx.fill()
            }
            ctx.lineWidth = 11
            for (let i = 0; i < 5; i++) {
              const x = sx - 60 + i * 30
              ctx.beginPath()
              ctx.moveTo(x, sy + 50)
              ctx.lineTo(x + (i - 2) * 10, sy + 150)
              ctx.stroke()
            }
            ctx.fillStyle = "#04140a"
            for (let i = 0; i < 9; i++) {
              const a = (i / 9) * Math.PI * 2
              const r = 28 + (i % 3) * 18
              ctx.beginPath()
              ctx.arc(sx + Math.cos(a) * r, sy - 20 + Math.sin(a) * r, 7, 0, Math.PI * 2)
              ctx.fill()
            }
            ctx.fillStyle = green
          } else if (th.creature === "tall") {
            ctx.beginPath()
            ctx.ellipse(sx, sy - 130, 26, 40, 0, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillRect(sx - 16, sy - 90, 32, 150)
            ctx.lineWidth = 13
            ctx.beginPath()
            ctx.moveTo(sx - 14, sy - 70)
            ctx.lineTo(sx - 70, sy + 4)
            ctx.lineTo(sx - 56, sy + 140)
            ctx.stroke()
            ctx.beginPath()
            ctx.moveTo(sx + 14, sy - 70)
            ctx.lineTo(sx + 70, sy + 4)
            ctx.lineTo(sx + 56, sy + 140)
            ctx.stroke()
            ctx.beginPath()
            ctx.moveTo(sx - 10, sy + 60)
            ctx.lineTo(sx - 22, sy + 200)
            ctx.stroke()
            ctx.beginPath()
            ctx.moveTo(sx + 10, sy + 60)
            ctx.lineTo(sx + 22, sy + 200)
            ctx.stroke()
          } else {
            ctx.fillRect(sx - 75, sy, 150, 64)
            for (const lx of [-60, -22, 22, 60]) ctx.fillRect(sx + lx, sy + 60, 15, 75)
            ctx.lineWidth = 13
            for (let i = 0; i < 3; i++) {
              const hx = sx - 52 + i * 52
              ctx.beginPath()
              ctx.moveTo(hx, sy)
              ctx.lineTo(hx, sy - 76)
              ctx.stroke()
              ctx.beginPath()
              ctx.arc(hx, sy - 92, 22, 0, Math.PI * 2)
              ctx.fill()
            }
          }
          const weak =
            th.creature === "leek"
              ? "白い球根が本体"
              : th.creature === "fleshball"
                ? "群がる眼を狙え"
                : th.creature === "tall"
                  ? "細い首・関節が脆い"
                  : "各頭を潰せ"
          ctx.textAlign = "left"
          ctx.fillStyle = green
          ctx.font = "bold 42px monospace"
          ctx.fillText(lv.target.name, 320, 130)
          ctx.fillStyle = "#ffd24a"
          ctx.font = "bold 32px monospace"
          ctx.fillText(`撃破  +${lv.bossScore}点`, 320, 188)
          ctx.fillStyle = green
          ctx.font = "25px monospace"
          ctx.fillText(`特徴 : ${lv.target.trait}`, 320, 245)
          ctx.fillText(`弱点 : ${weak}`, 320, 292)
          ctx.fillText(`雑魚 : +${th.points}点  ×${lv.zakoCount}`, 320, 339)
          ctx.textAlign = "center"
        } else {
          ctx.font = "bold 50px monospace"
          ctx.fillText("◆ 制限時間 ◆", W / 2, 130)
          ctx.font = "bold 92px monospace"
          if (lv.timeLimitSec === null) {
            ctx.fillText("無制限", W / 2, 270)
            ctx.font = "30px monospace"
            ctx.fillText("ただしエリアが徐々に縮小する", W / 2, 350)
          } else {
            const mm = Math.floor(lv.timeLimitSec / 60)
            ctx.fillText(`${mm}:00`, W / 2, 280)
          }
        }
        ctx.shadowBlur = 0
        texture.needsUpdate = true
      }
      // Apply the open-progress to the orb shells / rack / suitcase.
      function huntApplyOrbOpen(open: number) {
        const room = huntRoomRef.current
        if (!room) return
        const opening = open > 0.001
        room.orb.visible = !opening
        room.leftHalf.visible = opening
        room.rightHalf.visible = opening
        room.leftHalf.position.x = -open * 0.9
        room.rightHalf.position.x = open * 0.9
        room.leftHalf.rotation.y = -open * 0.6
        room.rightHalf.rotation.y = open * 0.6
        // The seated figure inside is revealed as the shells split apart.
        room.person.visible = opening
        room.person.scale.setScalar(0.6 + open * 0.4)
        const rack = room.orb.userData.weaponRack as THREE.Object3D | undefined
        if (rack) {
          rack.visible = opening
          rack.scale.setScalar(0.2 + open * 0.8)
        }
        room.suitcase.visible = opening
        room.suitcase.position.z = -0.9 - open * 0.7
        room.suitcase.position.y = 1.7 + open * 0.3
      }
      // (Re)start the room briefing for the current level.
      function huntStartRoom() {
        const room = huntRoomRef.current
        huntGreetingRef.current = Math.floor(Math.random() * HUNT_GREETINGS.length)
        if (room) {
          room.open = 0
          room.page = 0
          room.pageAt = Date.now() + 2500
          room.jingled = false
          room.door.rotation.y = 0
          huntApplyOrbOpen(0)
          huntDrawOrb(0)
        }
        huntPhaseRef.current = "room"
        setHuntPhase("room")
        huntInputLockRef.current = false
        focalPoint.set(HUNT_ROOM.x, 0, HUNT_ROOM.z + 3)
        camState.yaw = Math.PI
        camState.pitch = -0.05
      }
      // Refill HP + reserve mags for the next run (suit durability + HUNT ammo
      // are restored too, per the "帰還時に全回復" rule).
      function huntHeal() {
        playerHpRef.current = PLAYER_MAX_HP
        setPlayerHp(PLAYER_MAX_HP)
        weaponAmmoRef.current[1] = 8
        weaponAmmoRef.current[2] = 5
        const cur = currentWeaponIdxRef.current
        const mag = weaponAmmoRef.current[cur]
        if (mag !== undefined) {
          ammoRef.current = mag
          setAmmo(mag)
        }
        if (huntSuitChosenRef.current) {
          huntSuitActiveRef.current = true
          setHuntSuitActive(true)
          huntSuitDurRef.current = HUNT_SUIT_MAX
          setHuntSuitDur(HUNT_SUIT_MAX)
        }
        for (const w of HUNT_WEAPONS) {
          if (
            w.mag > 0 &&
            (huntOwnedRef.current.has(w.id) || (w.reward && huntGravityUnlockedRef.current))
          )
            huntAmmoRef.current[w.id] = w.mag
        }
        if (huntWeaponRef.current) setHuntAmmoUi(huntAmmoRef.current[huntWeaponRef.current] ?? 0)
      }
      // Warp into the mission: spawn themed minions + boss, set limits.
      function huntBeginMission() {
        const lv = HUNT_LEVELS[huntLevelIdxRef.current]
        if (!lv) return
        huntClearEnemies()
        huntKillLogRef.current = new Map()
        huntScoreRef.current = 0
        setHuntScore(0)
        const hpScale = lv.level === 3 ? 1 + 0.2 * huntRepeatRef.current : 1
        const th = HUNT_THEMES[lv.theme]
        // Minions ring the arena centre.
        for (let i = 0; i < lv.zakoCount; i++) {
          const ang = Math.random() * Math.PI * 2
          const r = 28 + Math.random() * 150
          const safe = findSafeSpawnNear(
            HUNT_ARENA.x + Math.cos(ang) * r,
            HUNT_ARENA.z + Math.sin(ang) * r,
            ENEMY_RADIUS,
          )
          huntMakeEnemy(
            th.base,
            safe.x,
            safe.z,
            th.scale,
            th.tint,
            th.eyes,
            th.points,
            Math.round(th.hp * hpScale),
            th.speed,
            false,
            "minion",
            th.creature,
          )
        }
        // Boss: charge/aoe → terraformer (melee), ranged_summon → grunt (shoots).
        // It's a giant version of the level's creature (its eyes tinted red).
        const bossBase: EnemyType = lv.boss === "ranged_summon" ? "grunt" : "terraformer"
        const bsafe = findSafeSpawnNear(HUNT_ARENA.x, HUNT_ARENA.z - 60, ENEMY_RADIUS)
        huntMakeEnemy(
          bossBase,
          bsafe.x,
          bsafe.z,
          lv.bossScale,
          th.tint,
          0xff2200,
          lv.bossScore,
          Math.round(lv.bossHp * hpScale),
          lv.boss === "aoe_fast" ? 5.5 : 3.0,
          true,
          lv.target.name,
          lv.bossCreature,
        )
        setAliveEnemyCount(enemies.filter((e) => e.hp > 0).length)
        // Boundary + timer.
        huntRadiusRef.current = HUNT_BASE_RADIUS
        setHuntRadius(HUNT_BASE_RADIUS)
        huntShrinkStartRef.current = Date.now()
        huntDeadlineRef.current = lv.timeLimitSec ? Date.now() + lv.timeLimitSec * 1000 : 0
        huntOobSinceRef.current = 0
        setHuntOob(false)
        // Drop the player into the arena centre (nudged clear of any building).
        const psafe = findSafeSpawnNear(HUNT_ARENA.x, HUNT_ARENA.z, PLAYER_RADIUS)
        focalPoint.set(psafe.x, 0, psafe.z)
        playerVelRef.current.x = 0
        playerVelRef.current.z = 0
        spawnInvulnUntilRef.current = Date.now() + 2500
        huntInitEquipForMission() // suit durability, weapon ammo, clear locks
        huntMissionReadyRef.current = true
        huntPhaseRef.current = "mission"
        setHuntPhase("mission")
        showNotification(`Lv.${lv.level} — ${lv.target.name} を狩れ`)
      }
      // Head-pop death (boundary breach / quota miss): red burst + game over.
      function huntHeadExplode(reason: string) {
        const head = new THREE.Vector3(focalPoint.x, EYE_HEIGHT, focalPoint.z)
        spawnExplosion(head, false, true)
        spawnExplosion(head, false, true)
        cameraShakeRef.current.intensity = 8
        SOUNDS.gameover()
        huntMissionReadyRef.current = false
        huntPhaseRef.current = "dead"
        setHuntPhase("dead")
        gamePhaseRef.current = "gameover"
        setGamePhase("gameover")
        deathsRef.current += 1
        setDeaths(deathsRef.current)
        showNotification(reason)
      }
      // Build the scoring list (this mission's kills) for the orb + HUD.
      function huntBuildScoreList() {
        const list = [...huntKillLogRef.current.values()].sort((a, b) => b.points - a.points)
        setHuntScoreList(list)
      }
      // Return to the room after a mission (outcome: clear or timeout).
      function huntReturnToRoom(outcome: "clear" | "timeout") {
        // Quota set by a prior time-out: this mission had to clear the bar.
        if (huntQuotaRef.current > 0 && huntScoreRef.current < huntQuotaRef.current) {
          focalPoint.set(HUNT_ROOM.x, 0, HUNT_ROOM.z + 3)
          huntClearEnemies()
          huntHeadExplode("ノルマ未達 — 制裁執行")
          return
        }
        huntQuotaRef.current = 0
        setHuntQuota(0)
        huntClearEnemies()
        huntMissionReadyRef.current = false
        focalPoint.set(HUNT_ROOM.x, 0, HUNT_ROOM.z + 3)
        playerVelRef.current.x = 0
        playerVelRef.current.z = 0
        camState.yaw = Math.PI
        camState.pitch = -0.05
        if (outcome === "timeout") {
          // Forfeit this run AND the whole cumulative bank; arm the next quota.
          huntScoreRef.current = 0
          setHuntScore(0)
          huntTotalRef.current = 0
          setHuntTotal(0)
          huntPersistTotal(0)
          huntQuotaRef.current = HUNT_QUOTA_MISS
          setHuntQuota(HUNT_QUOTA_MISS)
          showNotification("時間切れ — 得点没収。次は最低ノルマ達成せよ")
        } else {
          if (huntLevelIdxRef.current < HUNT_LEVELS.length - 1) huntLevelIdxRef.current++
          else huntRepeatRef.current++ // Lv3 cleared → repeat tougher (+20% HP)
          SOUNDS.clear()
        }
        huntBuildScoreList()
        huntHeal()
        huntPhaseRef.current = "scoring"
        setHuntPhase("scoring")
        huntScoringUntilRef.current = Date.now() + 7000
        // 100-pt menu offered on the scoring screen when eligible (clear only).
        if (outcome === "clear") huntOfferRewardIfEligible()
      }
      // ══ HUNT equipment runtime (PR-Z2) ══════════════════════════════════════
      // Delayed pulse bursts, captures, lock markers and gravity blasts — all
      // pooled/reused arrays processed once per frame in huntUpdateEquip.
      const huntBursts: { enemy: CombatEnemy; at: number; dmg: number; base: number }[] = []
      const huntCaptures: {
        enemy: CombatEnemy
        until: number
        wire: THREE.Line
        ring: THREE.Mesh
      }[] = []
      const huntGravBlasts: { mesh: THREE.Mesh; t: number }[] = []
      const huntMarkerPool: THREE.Mesh[] = []
      const huntMarkerMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
      const huntMarkerGeo = new THREE.RingGeometry(0.5, 0.62, 16)
      const huntWireMat = new THREE.LineBasicMaterial({ color: 0x66ddff })
      const huntRingMat = new THREE.MeshBasicMaterial({
        color: 0x66ddff,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
      })
      const huntPillarMat = new THREE.MeshBasicMaterial({
        color: 0xaaffff,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
      const huntGravMat = new THREE.MeshBasicMaterial({ color: 0x050008 })
      // Three reusable lock-on ring markers (created once, toggled via .visible).
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(huntMarkerGeo, huntMarkerMat)
        m.visible = false
        m.renderOrder = 999
        scene.add(m)
        huntMarkerPool.push(m)
      }

      function huntPersistTickets() {
        try {
          localStorage.setItem(HUNT_TICKETS_KEY, String(huntTicketsRef.current))
        } catch {
          /* ignore */
        }
      }
      // Center-screen raycast for the nearest enemy under the crosshair.
      function huntRaycastEnemy(
        maxDist = 140,
      ): { enemy: CombatEnemy; point: THREE.Vector3 } | null {
        pointer.set(0, 0)
        raycaster.setFromCamera(pointer, camera)
        const parts: THREE.Object3D[] = []
        for (const e of enemies) {
          if (e.hp <= 0 || e.aiDriving) continue
          e.mesh.traverse((c) => {
            if (c instanceof THREE.Mesh && c.userData.enemyId) parts.push(c)
          })
        }
        const hit = raycaster.intersectObjects(parts, false)[0]
        if (!hit || hit.distance > maxDist) return null
        const id = hit.object.userData.enemyId as string
        const e = enemies.find((x) => x.id === id)
        return e ? { enemy: e, point: hit.point.clone() } : null
      }
      // Schedule a delayed in-body burst on an enemy (pulse weapons).
      function huntScheduleBurst(e: CombatEnemy, dmg: number) {
        huntBursts.push({
          enemy: e,
          at: Date.now() + HUNT_BURST_DELAY * 1000,
          dmg,
          base: e.mesh.scale.x,
        })
      }
      // Suit damage: drain durability first, cut HP damage; break at 0.
      function huntBreakSuit() {
        if (!huntSuitActiveRef.current) return
        huntSuitActiveRef.current = false
        setHuntSuitActive(false)
        SOUNDS.huntWarn()
        SOUNDS.damage()
        showNotification("⚠ スーツ破壊 — 生身だ")
      }
      // Initialise the loadout when a mission starts (durability, ammo, locks).
      function huntInitEquipForMission() {
        huntBursts.length = 0
        huntLockedRef.current = []
        setHuntLockCount(0)
        for (const m of huntMarkerPool) m.visible = false
        // Suit.
        const suited = huntSuitChosenRef.current
        huntSuitActiveRef.current = suited
        setHuntSuitActive(suited)
        huntSuitDurRef.current = suited ? HUNT_SUIT_MAX : 0
        setHuntSuitDur(suited ? HUNT_SUIT_MAX : 0)
        // Weapon ammo (owned + gravity if unlocked).
        for (const w of HUNT_WEAPONS) {
          if (w.mag < 0) continue
          if (huntOwnedRef.current.has(w.id) || (w.reward && huntGravityUnlockedRef.current))
            huntAmmoRef.current[w.id] = w.mag
        }
        huntReloadingRef.current = false
        setHuntReloadingUi(false)
        if (huntWeaponRef.current) setHuntAmmoUi(huntAmmoRef.current[huntWeaponRef.current] ?? 0)
      }
      // Reload the active HUNT weapon.
      function huntReload() {
        const id = huntWeaponRef.current
        if (!id) return
        const def = HUNT_WEAPON_BY_ID[id]
        if (def.mag < 0 || huntReloadingRef.current) return
        if ((huntAmmoRef.current[id] ?? 0) >= def.mag) return
        huntReloadingRef.current = true
        setHuntReloadingUi(true)
        window.setTimeout(() => {
          huntAmmoRef.current[id] = def.mag
          if (huntWeaponRef.current === id) setHuntAmmoUi(def.mag)
          huntReloadingRef.current = false
          setHuntReloadingUi(false)
        }, def.reloadMs)
      }
      // Consume one round; returns false (and auto-reloads) when empty.
      function huntConsumeAmmo(id: HuntWeaponId): boolean {
        const def = HUNT_WEAPON_BY_ID[id]
        if (def.mag < 0) return true
        const a = huntAmmoRef.current[id] ?? 0
        if (a <= 0) {
          huntReload()
          return false
        }
        huntAmmoRef.current[id] = a - 1
        setHuntAmmoUi(a - 1)
        if (a - 1 <= 0) huntReload()
        return true
      }
      // Suit punch ([F]) + blade slash/thrust — quiet melee in a forward cone.
      function huntConeMelee(dmg: number, range: number, tag: string) {
        camera.getWorldDirection(fwd3)
        const flen = Math.hypot(fwd3.x, fwd3.z) || 1
        const nfx = fwd3.x / flen
        const nfz = fwd3.z / flen
        const cosHalf = Math.cos(Math.PI / 5)
        let struck = false
        for (const e of enemies) {
          if (e.hp <= 0 || e.aiDriving) continue
          const dx = e.mesh.position.x - focalPoint.x
          const dz = e.mesh.position.z - focalPoint.z
          const d = Math.hypot(dx, dz)
          if (d > range || d < 1e-3) continue
          if ((dx / d) * nfx + (dz / d) * nfz < cosHalf) continue
          struck = true
          e.hp -= dmg
          spawnBlood(new THREE.Vector3(e.mesh.position.x, EYE_HEIGHT * 0.8, e.mesh.position.z))
          if (e.hp <= 0) applyEnemyKill(e, tag)
        }
        if (struck) SOUNDS.hit()
        recoilRef.current = 0.05
        knifeSwingRef.current = KNIFE_SWING_TIME
      }
      function huntPunch() {
        if (!huntSuitActiveRef.current) return // punch unlocked only by the suit
        const now = Date.now()
        if (now - lastMeleeRef.current < KNIFE_COOLDOWN_MS) return
        lastMeleeRef.current = now
        huntConeMelee(HUNT_PUNCH_DAMAGE, HUNT_PUNCH_RANGE, "punch")
      }
      function huntBlade(thrust: boolean) {
        const now = Date.now()
        if (now - lastMeleeRef.current < KNIFE_COOLDOWN_MS) return
        lastMeleeRef.current = now
        SOUNDS.knife()
        huntConeMelee(thrust ? 350 : 200, thrust ? 3.0 : 1.8, "blade")
      }
      // Capture wire/ring + teleport pillar (created per capture; ≤3 at once).
      function huntStartCapture(e: CombatEnemy) {
        const head = e.mesh.position.clone()
        head.y = 1.2
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(focalPoint.x, EYE_HEIGHT, focalPoint.z),
          head,
        ])
        const wire = new THREE.Line(geo, huntWireMat)
        scene.add(wire)
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.08, 6, 18), huntRingMat)
        ring.rotation.x = Math.PI / 2
        scene.add(ring)
        huntCaptures.push({ enemy: e, until: Date.now() + 2000, wire, ring })
      }
      // Gravity blast at a point: black sphere expand→contract; zako die, boss −500.
      function huntGravityBlast(center: THREE.Vector3) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), huntGravMat)
        mesh.position.copy(center)
        mesh.scale.setScalar(0.1)
        scene.add(mesh)
        huntGravBlasts.push({ mesh, t: 0 })
        for (const e of enemies) {
          if (e.hp <= 0 || e.aiDriving) continue
          const d = Math.hypot(e.mesh.position.x - center.x, e.mesh.position.z - center.z)
          if (d > 15) continue
          if (e.isHuntBoss) {
            e.hp -= 500
            if (e.hp <= 0) applyEnemyKill(e, "gravity")
          } else {
            e.hp = 0
            applyEnemyKill(e, "gravity")
          }
        }
        cameraShakeRef.current.intensity = 5
        SOUNDS.rpg()
      }
      // Dispatch a HUNT-weapon shot (called from fire() / blade handled separately).
      function fireHuntWeapon() {
        const id = huntWeaponRef.current
        if (!id || huntReloadingRef.current) return
        const now = Date.now()
        if (id === "pulsegun") {
          if (now - lastFireTimeRef.current < 250) return
          lastFireTimeRef.current = now
          if (!huntConsumeAmmo("pulsegun")) return
          const targets =
            huntLockedRef.current.length > 0
              ? huntLockedRef.current.filter((e) => e.hp > 0)
              : (() => {
                  const h = huntRaycastEnemy()
                  return h ? [h.enemy] : []
                })()
          for (const e of targets) huntScheduleBurst(e, 120)
          huntLockedRef.current = []
          setHuntLockCount(0)
          for (const m of huntMarkerPool) m.visible = false
          SOUNDS.sniper()
          recoilRef.current = 0.12
        } else if (id === "pulseshotgun") {
          if (now - lastFireTimeRef.current < 600) return
          lastFireTimeRef.current = now
          if (!huntConsumeAmmo("pulseshotgun")) return
          // 5 spread rays; each enemy hit gets its own 40-dmg delayed burst.
          for (let p = 0; p < 5; p++) {
            const sx = (Math.random() - 0.5) * 0.18
            const sy = (Math.random() - 0.5) * 0.18
            pointer.set(sx, sy)
            raycaster.setFromCamera(pointer, camera)
            const parts: THREE.Object3D[] = []
            for (const e of enemies) {
              if (e.hp <= 0 || e.aiDriving) continue
              e.mesh.traverse((c) => {
                if (c instanceof THREE.Mesh && c.userData.enemyId) parts.push(c)
              })
            }
            const hit = raycaster.intersectObjects(parts, false)[0]
            if (hit && hit.distance < 40) {
              const e = enemies.find((x) => x.id === hit.object.userData.enemyId)
              if (e) huntScheduleBurst(e, 40)
            }
          }
          SOUNDS.shotgun()
          recoilRef.current = 0.2
        } else if (id === "capturegun") {
          if (now - lastFireTimeRef.current < 400) return
          lastFireTimeRef.current = now
          if (huntCaptures.length >= 3) return
          if (!huntConsumeAmmo("capturegun")) return
          const h = huntRaycastEnemy(120)
          if (h) huntStartCapture(h.enemy)
          SOUNDS.huntWarp()
          recoilRef.current = 0.1
        } else if (id === "gravitycannon") {
          if (now - lastFireTimeRef.current < 400) return
          lastFireTimeRef.current = now
          if (!huntConsumeAmmo("gravitycannon")) return
          camera.getWorldDirection(fwd3)
          const dir = fwd3.clone().normalize()
          // Aim point: nearest enemy / wall hit, else 25m ahead, clamped to ground.
          pointer.set(0, 0)
          raycaster.setFromCamera(pointer, camera)
          const wallHit = raycaster.intersectObjects(wallMeshes, false)[0]
          const eh = huntRaycastEnemy(200)
          let pt: THREE.Vector3
          if (eh && (!wallHit || eh.point.distanceTo(camera.position) < wallHit.distance))
            pt = eh.point
          else if (wallHit) pt = wallHit.point.clone()
          else
            pt = new THREE.Vector3(
              focalPoint.x + dir.x * 25,
              EYE_HEIGHT + dir.y * 25,
              focalPoint.z + dir.z * 25,
            )
          pt.y = Math.max(0.5, pt.y)
          huntGravityBlast(pt)
          recoilRef.current = 0.3
        }
      }
      // Auto-consume a revive ticket on a lethal hit during a mission.
      function huntTryRevive(): boolean {
        if (modeRef.current !== "hunt" || huntPhaseRef.current !== "mission") return false
        if (huntTicketsRef.current <= 0) return false
        huntTicketsRef.current -= 1
        setHuntTickets(huntTicketsRef.current)
        huntPersistTickets()
        // Undo the game-over set by the lethal hit earlier this frame.
        gamePhaseRef.current = "playing"
        setGamePhase("playing")
        playerHpRef.current = PLAYER_MAX_HP
        setPlayerHp(PLAYER_MAX_HP)
        if (huntSuitChosenRef.current) {
          huntSuitActiveRef.current = true
          setHuntSuitActive(true)
          huntSuitDurRef.current = HUNT_SUIT_MAX
          setHuntSuitDur(HUNT_SUIT_MAX)
        }
        spawnInvulnUntilRef.current = Date.now() + 2000
        cameraShakeRef.current.intensity = 6
        SOUNDS.clear()
        showNotification("復活チケット消費 — 蘇生")
        return true
      }
      // Per-frame HUNT equipment update (locks / bursts / captures / gravity /
      // blade hold). Only meaningful during a mission.
      function huntUpdateEquip(dt: number) {
        const now = Date.now()
        // Pulse-gun lock-on: ADS held → add the centred enemy (≤3).
        if (huntWeaponRef.current === "pulsegun" && isAimingRef.current) {
          if (huntLockedRef.current.length < 3) {
            const h = huntRaycastEnemy()
            if (h && !huntLockedRef.current.includes(h.enemy)) {
              huntLockedRef.current.push(h.enemy)
              setHuntLockCount(huntLockedRef.current.length)
            }
          }
        }
        // Drop dead locks; park white ring markers above the live ones.
        huntLockedRef.current = huntLockedRef.current.filter((e) => e.hp > 0)
        for (let i = 0; i < huntMarkerPool.length; i++) {
          const m = huntMarkerPool[i]
          if (!m) continue
          const e = huntLockedRef.current[i]
          if (e) {
            m.visible = true
            m.position.set(e.mesh.position.x, e.mesh.position.y + 1.3, e.mesh.position.z)
            m.lookAt(camera.position)
          } else m.visible = false
        }
        // Delayed in-body bursts: swell then detonate.
        for (let i = huntBursts.length - 1; i >= 0; i--) {
          const b = huntBursts[i]
          if (!b) continue
          if (b.enemy.hp <= 0) {
            huntBursts.splice(i, 1)
            continue
          }
          const remain = (b.at - now) / 1000
          const swell = 1 + 0.3 * Math.max(0, 1 - remain / HUNT_BURST_DELAY)
          b.enemy.mesh.scale.setScalar(b.base * swell)
          if (now >= b.at) {
            b.enemy.mesh.scale.setScalar(b.base)
            spawnExplosion(b.enemy.mesh.position.clone())
            b.enemy.hp -= b.dmg
            if (b.enemy.hp <= 0) applyEnemyKill(b.enemy, "pulse")
            huntBursts.splice(i, 1)
          }
        }
        // Captures: hold the wire/ring, then teleport (or snap on a healthy boss).
        for (let i = huntCaptures.length - 1; i >= 0; i--) {
          const c = huntCaptures[i]
          if (!c) continue
          const dead = c.enemy.hp <= 0
          if (!dead) {
            const head = c.enemy.mesh.position
            const pts = [
              new THREE.Vector3(focalPoint.x, EYE_HEIGHT, focalPoint.z),
              new THREE.Vector3(head.x, head.y + 1.0, head.z),
            ]
            c.wire.geometry.setFromPoints(pts)
            c.ring.position.set(head.x, head.y + 1.0, head.z)
            c.ring.rotation.z += dt * 4
          }
          if (now >= c.until || dead) {
            scene.remove(c.wire)
            scene.remove(c.ring)
            c.wire.geometry.dispose()
            c.ring.geometry.dispose()
            huntCaptures.splice(i, 1)
            if (dead) continue
            const healthyBoss = c.enemy.isHuntBoss && c.enemy.hp > c.enemy.maxHp * 0.3
            if (healthyBoss) {
              showNotification("拘束を引きちぎられた — ボスはHP30%以下で捕獲可")
              continue
            }
            // Teleport kill: light pillar + capture bonus points.
            const pillar = new THREE.Mesh(
              new THREE.CylinderGeometry(0.8, 0.8, 40, 12, 1, true),
              huntPillarMat,
            )
            pillar.position.set(c.enemy.mesh.position.x, 20, c.enemy.mesh.position.z)
            scene.add(pillar)
            huntGravBlasts.push({ mesh: pillar, t: 0 }) // reuse the fade pool
            const mult = c.enemy.isHuntBoss ? 2 : 1.5
            c.enemy.huntPoints = Math.round((c.enemy.huntPoints ?? 0) * mult)
            c.enemy.hp = 0
            applyEnemyKill(c.enemy, "capture")
            SOUNDS.huntWarp()
          }
        }
        // Gravity-blast / pillar fades (expand→contract / shrink-out).
        for (let i = huntGravBlasts.length - 1; i >= 0; i--) {
          const g = huntGravBlasts[i]
          if (!g) continue
          g.t += dt
          const isPillar = g.mesh.geometry instanceof THREE.CylinderGeometry
          if (isPillar) {
            const m = g.mesh.material as THREE.MeshBasicMaterial
            m.opacity = Math.max(0, 0.55 * (1 - g.t / 0.9))
            g.mesh.scale.x = g.mesh.scale.z = 1 + g.t * 0.5
          } else {
            // expand to 15m by t=0.4, then contract.
            const s = g.t < 0.4 ? (g.t / 0.4) * 15 : Math.max(0, 15 * (1 - (g.t - 0.4) / 0.4))
            g.mesh.scale.setScalar(Math.max(0.1, s))
          }
          if (g.t > 0.9) {
            scene.remove(g.mesh)
            g.mesh.geometry.dispose()
            huntGravBlasts.splice(i, 1)
          }
        }
        // Blade: tap = slash, hold ≥0.4s = 3m thrust (fired on release).
        if (huntWeaponRef.current === "blade") {
          if (mouseDownRef.current) huntBladeChargeRef.current += dt
          else if (huntBladeChargeRef.current > 0.001) {
            huntBlade(huntBladeChargeRef.current >= 0.4)
            huntBladeChargeRef.current = 0
          }
        }
        // Suit punch request ([F] / mobile).
        if (huntPunchReqRef.current) {
          huntPunchReqRef.current = false
          huntPunch()
        }
        // Reload request ([R] / mobile) for the active HUNT weapon.
        if (huntReloadReqRef.current) {
          huntReloadReqRef.current = false
          huntReload()
        }
      }
      // Offer the 100-pt menu (component-scope huntChooseReward resolves it).
      function huntOfferRewardIfEligible() {
        if (huntTotalRef.current >= 100) {
          huntRewardOpenRef.current = true
          setHuntRewardOpen(true)
        }
      }

      // Per-frame HUNT state machine.
      function updateHunt(dt: number) {
        if (modeRef.current !== "hunt") return
        const now = Date.now()
        const room = huntRoomRef.current
        const phase = huntPhaseRef.current
        // Room fill ambient is global → keep it off during the mission so the
        // night arena stays dark; on whenever the player is back in the room.
        if (huntRoomAmbient) huntRoomAmbient.visible = phase !== "mission"
        if (huntRoomSun) huntRoomSun.visible = phase !== "mission"
        // Keep the player boxed in the room during briefing/countdown.
        if (phase === "room" || phase === "countdown" || phase === "scoring") {
          focalPoint.x = Math.max(
            HUNT_ROOM.x - HUNT_ROOM_HALF,
            Math.min(HUNT_ROOM.x + HUNT_ROOM_HALF, focalPoint.x),
          )
          focalPoint.z = Math.max(
            HUNT_ROOM.z - HUNT_ROOM_HALF,
            Math.min(HUNT_ROOM.z + HUNT_ROOM_HALF, focalPoint.z),
          )
          focalPoint.y = 0
        }
        // Equipment rack: reachable during the briefing + countdown. [E]/tap
        // toggles the loadout menu (and releases pointer-lock so it's clickable).
        if (phase === "room" || phase === "countdown") {
          if (!huntNearRackRef.current) {
            huntNearRackRef.current = true
            setHuntNearRack(true)
          }
          if (huntInteractReqRef.current) {
            huntInteractReqRef.current = false
            huntEquipOpenRef.current = !huntEquipOpenRef.current
            setHuntEquipOpen(huntEquipOpenRef.current)
            if (huntEquipOpenRef.current) document.exitPointerLock?.()
          }
        } else if (huntNearRackRef.current) {
          huntNearRackRef.current = false
          setHuntNearRack(false)
          if (huntEquipOpenRef.current) {
            huntEquipOpenRef.current = false
            setHuntEquipOpen(false)
          }
        }
        if (phase === "room" && room) {
          if (now >= room.pageAt) {
            if (room.page < 2) {
              room.page++
              huntDrawOrb(room.page)
              room.pageAt = now + 4500
              SOUNDS.huntTally()
            } else if (!room.jingled) {
              room.jingled = true
              SOUNDS.huntJingle()
              huntCountdownRef.current = now + 10000
              huntPhaseRef.current = "countdown"
              setHuntPhase("countdown")
            }
          }
        } else if (phase === "countdown" && room) {
          // The orb cracks open fast — a sharp "bang" (≈0.4s) with a sound +
          // small camera shake the instant the shells part.
          if (!room.banged) {
            room.banged = true
            SOUNDS.huntOrbOpen()
            cameraShakeRef.current.intensity = 4
          }
          room.open = Math.min(1, room.open + dt * 2.5)
          huntApplyOrbOpen(room.open)
          const sec = Math.max(0, Math.ceil((huntCountdownRef.current - now) / 1000))
          setHuntCountdown(sec)
          if (sec <= 3) huntInputLockRef.current = true // 金縛り
          if (now >= huntCountdownRef.current) {
            huntPhaseRef.current = "warp"
            setHuntPhase("warp")
            SOUNDS.huntWarp()
            setHuntWhiteFlash(true)
            window.setTimeout(() => {
              huntBeginMission()
              setHuntWhiteFlash(false)
              huntInputLockRef.current = false
            }, 480)
          }
        } else if (phase === "scoring") {
          if (room) room.door.rotation.y = Math.min(1.2, room.door.rotation.y + dt * 0.8)
          // Hold on the scoring screen while the 100-pt menu is open.
          if (
            now >= huntScoringUntilRef.current &&
            !huntRewardOpenRef.current &&
            !huntReleasedRef.current
          )
            huntStartRoom()
        } else if (phase === "mission" && huntMissionReadyRef.current) {
          huntUpdateEquip(dt)
          // Arena boundary: shrink on Lv3, else fixed.
          const lv = HUNT_LEVELS[huntLevelIdxRef.current]
          if (lv?.shrink) {
            const tt = Math.min(1, (now - huntShrinkStartRef.current) / (HUNT_SHRINK_SEC * 1000))
            huntRadiusRef.current = HUNT_BASE_RADIUS - (HUNT_BASE_RADIUS - HUNT_MIN_RADIUS) * tt
          }
          setHuntRadius(Math.round(huntRadiusRef.current))
          // Out-of-bounds → warn, then head-pop after the grace period.
          const dist = Math.hypot(focalPoint.x - HUNT_ARENA.x, focalPoint.z - HUNT_ARENA.z)
          if (dist > huntRadiusRef.current) {
            if (huntOobSinceRef.current === 0) {
              huntOobSinceRef.current = now
              setHuntOob(true)
            }
            if (Math.floor(now / 600) % 2 === 0) SOUNDS.huntWarn()
            if (now - huntOobSinceRef.current > HUNT_OOB_GRACE_MS) {
              huntHeadExplode("境界侵犯 — 頭部爆散")
              return
            }
          } else if (huntOobSinceRef.current !== 0) {
            huntOobSinceRef.current = 0
            setHuntOob(false)
          }
          // Boss special behaviours (light PR-Z1 versions).
          const boss = enemies.find((e) => e.isHuntBoss && e.hp > 0)
          if (boss && lv && boss.huntNextSpecial && now >= boss.huntNextSpecial) {
            if (lv.boss === "ranged_summon") {
              const th = HUNT_THEMES[lv.theme]
              // Cap the swarm: only top up to HUNT_SUMMON_CAP live minions so
              // the field can actually be cleared (the bug was an unbounded
              // spawn that grew faster than the player could cull it, so the
              // "all enemies dead" clear check never fired).
              const aliveMinions = enemies.filter((e) => e.hp > 0 && !e.isHuntBoss).length
              const room = Math.min(2, HUNT_SUMMON_CAP - aliveMinions)
              for (let i = 0; i < room; i++) {
                const a = Math.random() * Math.PI * 2
                const safe = findSafeSpawnNear(
                  boss.mesh.position.x + Math.cos(a) * 4,
                  boss.mesh.position.z + Math.sin(a) * 4,
                  ENEMY_RADIUS,
                )
                huntMakeEnemy(
                  th.base,
                  safe.x,
                  safe.z,
                  th.scale,
                  th.tint,
                  th.eyes,
                  th.points,
                  th.hp,
                  th.speed,
                  false,
                  "minion",
                  th.creature,
                )
              }
              boss.huntNextSpecial = now + 12000
            } else if (lv.boss === "aoe_fast") {
              spawnExplosion(boss.mesh.position.clone(), false, true)
              const bd = Math.hypot(
                focalPoint.x - boss.mesh.position.x,
                focalPoint.z - boss.mesh.position.z,
              )
              if (bd < 9 && Date.now() > spawnInvulnUntilRef.current) applyPlayerDamage(26, 5)
              boss.huntNextSpecial = now + 6000
            }
          }
          // Timer (Lv1/Lv2): survive → return with the bank forfeited.
          if (huntDeadlineRef.current > 0) {
            const left = Math.max(0, Math.ceil((huntDeadlineRef.current - now) / 1000))
            setHuntTimeLeft(left)
            if (now >= huntDeadlineRef.current) {
              huntReturnToRoom("timeout")
              return
            }
          }
          // Clear: every enemy dead.
          if (enemies.filter((e) => e.hp > 0).length === 0) {
            huntReturnToRoom("clear")
          }
        }
      }

      // Auto-spawn bots for FFA/TDM modes (wave_defense uses mission select).
      if (!isSky && (modeRef.current === "ffa" || modeRef.current === "tdm") && botCount > 0) {
        spawnBots(botCount, botDifficulty, modeRef.current)
        showNotification(
          `${botCount} BOT${botCount === 1 ? "" : "S"} ENGAGED · ${botDifficulty.toUpperCase()}`,
        )
      }

      // Zombie mode: kick off wave 1 immediately, flag active after the intro.
      if (!isSky && modeRef.current === "zombie") {
        zombieWaveRef.current = 1
        zombieActiveRef.current = false
        setCurrentWave(1)
        setWaveMessage("WAVE 1 — ゾンビ接近中")
        spawnZombieWave(1)
        setTimeout(() => {
          setWaveMessage(null)
          zombieActiveRef.current = true
        }, 3000)
        showNotification("ZOMBIE MODE — 生き延びろ")
      }

      // Invasion mode: a calm opening, then the first rocket falls ~15s in and
      // terraformer waves begin. Waves escalate endlessly with a lull between.
      if (!isSky && modeRef.current === "invasion") {
        invasionWaveRef.current = 0
        invasionActiveRef.current = false
        invasionNextStrikeRef.current = Date.now() + 15000
        setCurrentWave(0)
        setWaveMessage("INVASION — 静かだ…今のうちに備えろ")
        setTimeout(() => {
          if (gamePhaseRef.current === "playing") setWaveMessage(null)
        }, 3500)
        showNotification("INVASION MODE — 空を警戒せよ")
      }

      // HUNT mode: build the transfer room and start the first briefing. The
      // cumulative score is restored from localStorage (PR-Z2 100-pt menu).
      if (modeRef.current === "hunt") {
        let saved = 0
        try {
          saved = Number.parseInt(localStorage.getItem(HUNT_TOTAL_KEY) ?? "0", 10) || 0
        } catch {
          /* ignore */
        }
        huntTotalRef.current = saved
        setHuntTotal(saved)
        // Persisted rewards from prior runs (PR-Z2).
        try {
          const tk = Number.parseInt(localStorage.getItem(HUNT_TICKETS_KEY) ?? "0", 10) || 0
          huntTicketsRef.current = Math.max(0, Math.min(HUNT_MAX_TICKETS, tk))
          setHuntTickets(huntTicketsRef.current)
          const gv = localStorage.getItem(HUNT_GRAVITY_KEY) === "1"
          huntGravityUnlockedRef.current = gv
          setHuntGravityUnlocked(gv)
          huntClearsRef.current =
            Number.parseInt(localStorage.getItem(HUNT_CLEARS_KEY) ?? "0", 10) || 0
        } catch {
          /* ignore */
        }
        huntLevelIdxRef.current = 0
        huntRepeatRef.current = 0
        buildHuntRoom()
        huntStartRoom()
        showNotification("HUNT — 標的の情報を待て・ラックで装備せよ [E]")
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
        floors,
        ceilings,
        climbZones,
        entries,
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
        if (drivingRef.current && activeVehicle) {
          // Third-person: spawn the tracer at the vehicle so it doesn't appear
          // to come from the chase camera floating behind the car.
          bulletMesh.position.set(activeVehicle.x + fwd.x * 1.6, 1.1, activeVehicle.z + fwd.z * 1.6)
        } else {
          bulletMesh.position.copy(camera.position).addScaledVector(fwd, 0.55)
        }
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
        // Halve particle counts on touch devices to lighten the mobile GPU load.
        const bloodCount = isTouch ? Math.ceil(PARTICLE_COUNT / 2) : PARTICLE_COUNT
        for (let i = 0; i < bloodCount; i++) {
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
      // `gore` (HUNT head-pop) swaps the orange fireball for a red blood burst.
      function spawnExplosion(pos: THREE.Vector3, isSpark = false, gore = false) {
        const refs = sceneRef.current
        if (!refs) return
        const baseCount = isSpark ? 6 : 18
        // Halve particle counts on touch devices to lighten the mobile GPU load.
        const count = isTouch ? Math.ceil(baseCount / 2) : baseCount
        const lifetime = isSpark ? 0.28 : 0.75
        const speed = isSpark ? 5 : 3.5
        for (let i = 0; i < count; i++) {
          const size = isSpark ? 0.03 : 0.06 + Math.random() * 0.1
          const color = gore
            ? i % 2 === 0
              ? 0xcc0000
              : 0xff3322
            : isSpark
              ? 0xffaa00
              : i % 2 === 0
                ? 0xff6600
                : 0xffcc00
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

      // ── Register an enemy kill ─────────────────────────────────────────────
      // Shared by both the bullet path (fire) and the melee path (knife). The
      // caller has already driven hp to ≤0; this handles death animation, fall
      // direction (away from the player), ally aggro, score / kills / killfeed,
      // streak counter, mission progress and per-weapon kill stats. weaponKey
      // is one of "pistol"/"shotgun"/"sniper"/"knife"/"grenade".
      function applyEnemyKill(hitEnemy: CombatEnemy, weaponKey: string) {
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
        // Alert nearby allies — seeing a teammate drop gives them a
        // hard reason to investigate the player's last position.
        {
          const killerTuning = hitEnemy.aiTuning ?? MISSION_AI_TUNING
          if (killerTuning.groupTactics) {
            for (const ally of enemies) {
              if (ally === hitEnemy || ally.hp <= 0) continue
              const ad = Math.hypot(
                ally.mesh.position.x - hitEnemy.mesh.position.x,
                ally.mesh.position.z - hitEnemy.mesh.position.z,
              )
              if (ad < 25 && (ally.state === "patrol" || ally.state === "search")) {
                ally.state = "search"
                ally.searchTimer = 7.0
                ally.lastSeenPlayer = { x: focalPoint.x, z: focalPoint.z }
                setEnemyMarker(ally, "search", 7000)
              }
            }
          }
        }
        killsRef.current += 1
        setKills(killsRef.current)
        scoreRef.current += hitEnemy.config.score
        setScore(scoreRef.current)
        // HUNT: route points to the mission + cumulative tallies and log the kill
        // for the post-mission scoring screen.
        if (modeRef.current === "hunt" && hitEnemy.huntPoints) {
          huntScoreRef.current += hitEnemy.huntPoints
          setHuntScore(huntScoreRef.current)
          huntTotalRef.current += hitEnemy.huntPoints
          setHuntTotal(huntTotalRef.current)
          huntPersistTotal(huntTotalRef.current)
          const key = hitEnemy.isHuntBoss ? `boss:${hitEnemy.huntName}` : "minion"
          const label = hitEnemy.isHuntBoss
            ? `★ ${hitEnemy.huntName}`
            : `雑魚 (${hitEnemy.huntPoints}pt)`
          const log = huntKillLogRef.current
          const cur = log.get(key)
          if (cur) cur.count += 1
          else log.set(key, { name: label, points: hitEnemy.huntPoints, count: 1 })
        }
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
          : hitEnemy.type === "terraformer"
            ? "TERRAFORMER SLAIN"
            : hitEnemy.type === "heavy"
              ? "HEAVY ELIMINATED"
              : hitEnemy.type === "sniper"
                ? "SNIPER ELIMINATED"
                : hitEnemy.type === "zombie"
                  ? "ZOMBIE DOWN"
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
          : hitEnemy.type === "terraformer"
            ? "#ff7733"
            : hitEnemy.type === "heavy"
              ? "#cc44ff"
              : hitEnemy.type === "sniper"
                ? "#88cc44"
                : hitEnemy.type === "zombie"
                  ? "#88dd66"
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
        if (mission === "sniper" && weaponKey === "sniper") {
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
        maxKillstreakRef.current = Math.max(maxKillstreakRef.current, consecutiveKillsRef.current)
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
        weaponKillsRef.current[weaponKey] = (weaponKillsRef.current[weaponKey] ?? 0) + 1
      }

      // ══ Universal weapon targeting ═══════════════════════════════════════════
      // One source of truth for "what can a weapon hit". Every enemy kind the
      // player can damage is enumerated here so each weapon (hitscan + AOE +
      // homing) shares the exact same target set: ground infantry / terraformers
      // / bike riders (the `enemies` array, minus hidden vehicle drivers), enemy
      // jets, enemy-driven vehicles, and enemy AA guns (the one the player is
      // manning is always spared).

      // Shared explosive AOE — damage every enemy type within `radius` of
      // `center`. `falloff(d)` returns the damage at distance d; `tag` labels
      // ground-enemy kills. Used by the RPG rocket, the jet missile and every
      // player grenade / tank shell so all explosives hit the same full set.
      function damageAllInRadius(
        center: THREE.Vector3,
        radius: number,
        falloff: (d: number) => number,
        tag: string,
      ) {
        // Ground enemies (infantry / terraformers / bike riders). Hidden
        // vehicle drivers are skipped — they take damage via their vehicle.
        for (const enemy of enemies) {
          if (enemy.hp <= 0 || enemy.aiDriving) continue
          const d = Math.hypot(
            enemy.mesh.position.x - center.x,
            enemy.mesh.position.y - center.y,
            enemy.mesh.position.z - center.z,
          )
          if (d >= radius) continue
          enemy.hp = Math.max(0, enemy.hp - falloff(d))
          if (enemy.hp <= 0) {
            spawnExplosion(enemy.mesh.position.clone())
            applyEnemyKill(enemy, tag)
          }
        }
        // Enemy jets.
        for (const ej of enemyJets) {
          if (ej.dead) continue
          const d = Math.hypot(ej.x - center.x, ej.y - center.y, ej.z - center.z)
          if (d >= radius) continue
          ej.hp -= falloff(d)
          if (ej.hp <= 0) {
            scoreRef.current += 1200
            setScore(scoreRef.current)
            if (isSky) {
              killsRef.current += 1
              setKills(killsRef.current)
            }
            killEnemyJet(ej)
          }
        }
        // Enemy-driven vehicles (explosive bypasses tank armor).
        for (const vv of vehicles) {
          if (vv.dead || !vv.aiDriver) continue
          const d = Math.hypot(vv.x - center.x, vv.z - center.z)
          if (d >= radius) continue
          damageEnemyVehicle(vv, falloff(d), "explosive")
        }
        // Enemy AA guns (the one the player currently mans is spared).
        for (const gun of aaGuns) {
          if (gun.dead || gun === activeAAGun) continue
          const d = Math.hypot(gun.x - center.x, gun.baseY + 1.0 - center.y, gun.z - center.z)
          if (d >= radius) continue
          gun.hp -= falloff(d)
          if (gun.hp <= 0) {
            scoreRef.current += 600
            setScore(scoreRef.current)
            destroyAAGun(gun)
          }
        }
        // Big Cockroach boss — explosives hit it too (RPG / grenade / tank shell
        // / jet missile). Falloff uses the distance to the nearest body part so a
        // blast near the head or tail still connects (not just the centre).
        {
          const near = bigBossNearestDist(center.x, center.z)
          if (near !== null && near < radius) bossTakeDamage(falloff(Math.max(0, near)))
        }
      }

      // Shared hitscan — push damage candidates for the "hard" (non-humanoid)
      // enemy types along `raycaster`'s ray: enemy-driven vehicles, enemy AA
      // guns and enemy jets. Each candidate is { dist, point, apply }; the
      // caller merges these with its own ground-enemy / PvP candidates, sorts by
      // distance and applies the nearest one a wall doesn't occlude. `jetAssistR`
      // / `groundAssistR` > 0 add a ray-vs-sphere aim-assist (jets are tiny and
      // fast → ground AA needs it; the jet gun needs it air-to-ground); 0 = exact
      // mesh only. Used by the on-foot weapons (fire) and the jet nose gun
      // (fireJetGun) so every gun reaches every target type through one path.
      function collectHardTargets(
        raycaster: THREE.Raycaster,
        damage: number,
        opts: { jetAssistR: number; groundAssistR: number; jetRange: number },
      ): { dist: number; point: THREE.Vector3; apply: () => void }[] {
        const cands: { dist: number; point: THREE.Vector3; apply: () => void }[] = []
        const ray = raycaster.ray
        // Nearest point along the ray to (x,y,z); returns { t, px, py, pz } with
        // t = signed distance from origin (negative ⇒ behind the shooter).
        const project = (x: number, y: number, z: number) => {
          const ox = x - ray.origin.x
          const oy = y - ray.origin.y
          const oz = z - ray.origin.z
          const t = ox * ray.direction.x + oy * ray.direction.y + oz * ray.direction.z
          return {
            t,
            px: ray.origin.x + ray.direction.x * t,
            py: ray.origin.y + ray.direction.y * t,
            pz: ray.origin.z + ray.direction.z * t,
          }
        }
        // Enemy-driven vehicles (bullets chip; tank armor reduces them).
        {
          const meshes: THREE.Object3D[] = []
          const map = new Map<THREE.Object3D, Vehicle>()
          for (const vv of vehicles) {
            if (vv.dead || !vv.aiDriver) continue
            vv.group.traverse((c) => {
              if (c instanceof THREE.Mesh) {
                meshes.push(c)
                map.set(c, vv)
              }
            })
          }
          const hit = meshes.length ? raycaster.intersectObjects(meshes, false)[0] : undefined
          let vv = hit ? (map.get(hit.object) ?? null) : null
          let dist = hit ? hit.distance : Number.POSITIVE_INFINITY
          let point = hit ? hit.point.clone() : null
          if (!vv && opts.groundAssistR > 0) {
            let bestT = Number.POSITIVE_INFINITY
            for (const cand of vehicles) {
              if (cand.dead || !cand.aiDriver) continue
              const { t, px, py, pz } = project(cand.x, 1, cand.z)
              if (t <= 0 || t > opts.jetRange || t >= bestT) continue
              if (
                Math.hypot(cand.x - px, 1 - py, cand.z - pz) >
                opts.groundAssistR + VEHICLE_RADIUS
              )
                continue
              bestT = t
              vv = cand
              dist = t
              point = new THREE.Vector3(px, py, pz)
            }
          }
          if (vv && point) {
            const target = vv
            cands.push({
              dist,
              point,
              apply: () => damageEnemyVehicle(target, damage, "bullet"),
            })
          }
        }
        // Enemy AA guns (the manned one is spared).
        {
          const meshes: THREE.Object3D[] = []
          const map = new Map<THREE.Object3D, AAGun>()
          for (const gun of aaGuns) {
            if (gun.dead || gun === activeAAGun) continue
            for (const m of gun.meshes) {
              meshes.push(m)
              map.set(m, gun)
            }
          }
          const hit = meshes.length ? raycaster.intersectObjects(meshes, false)[0] : undefined
          let gun = hit ? (map.get(hit.object) ?? null) : null
          let dist = hit ? hit.distance : Number.POSITIVE_INFINITY
          let point = hit ? hit.point.clone() : null
          if (!gun && opts.groundAssistR > 0) {
            let bestT = Number.POSITIVE_INFINITY
            for (const cand of aaGuns) {
              if (cand.dead || cand === activeAAGun) continue
              const cy = cand.baseY + 1.1
              const { t, px, py, pz } = project(cand.x, cy, cand.z)
              if (t <= 0 || t > opts.jetRange || t >= bestT) continue
              if (Math.hypot(cand.x - px, cy - py, cand.z - pz) > opts.groundAssistR + 1.0) continue
              bestT = t
              gun = cand
              dist = t
              point = new THREE.Vector3(px, py, pz)
            }
          }
          if (gun && point) {
            const target = gun
            cands.push({
              dist,
              point,
              apply: () => {
                target.hp -= damage
                if (target.hp <= 0) {
                  scoreRef.current += 600
                  setScore(scoreRef.current)
                  destroyAAGun(target)
                }
              },
            })
          }
        }
        // Enemy jets — exact mesh, then a ray-vs-sphere aim-assist fallback for
        // the tiny, fast targets (only when jetAssistR > 0).
        {
          const meshes: THREE.Object3D[] = []
          const map = new Map<THREE.Object3D, EnemyJet>()
          for (const ej of enemyJets) {
            if (ej.dead) continue
            ej.group.traverse((c) => {
              if (c instanceof THREE.Mesh) {
                meshes.push(c)
                map.set(c, ej)
              }
            })
          }
          const hit = meshes.length ? raycaster.intersectObjects(meshes, false)[0] : undefined
          let ej = hit ? (map.get(hit.object) ?? null) : null
          let dist = hit ? hit.distance : Number.POSITIVE_INFINITY
          let point = hit ? hit.point.clone() : null
          if (!ej && opts.jetAssistR > 0) {
            let bestT = Number.POSITIVE_INFINITY
            for (const cand of enemyJets) {
              if (cand.dead) continue
              const { t, px, py, pz } = project(cand.x, cand.y, cand.z)
              if (t <= 0 || t > opts.jetRange || t >= bestT) continue
              if (Math.hypot(cand.x - px, cand.y - py, cand.z - pz) > opts.jetAssistR) continue
              bestT = t
              ej = cand
              dist = t
              point = new THREE.Vector3(px, py, pz)
            }
          }
          if (ej && point) {
            const target = ej
            cands.push({
              dist,
              point,
              apply: () => {
                target.hp -= damage
                if (target.hp <= 0) {
                  scoreRef.current += 1200
                  setScore(scoreRef.current)
                  if (isSky) {
                    killsRef.current += 1
                    setKills(killsRef.current)
                  }
                  killEnemyJet(target)
                } else {
                  // Took a hit → break off and evade for a beat.
                  target.state = "evade"
                  target.stateUntil = Date.now() + 1500
                  target.evadeYaw =
                    target.heading + (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random() * 0.8)
                }
              },
            })
          }
        }
        // Big Cockroach boss — every hitscan weapon hits it (head eyes = 2×).
        {
          const boss = bigBossRef.current
          if (boss && boss.dyingStage === 0) {
            const hit = raycaster.intersectObject(boss.group, true)[0]
            if (hit) {
              const pt = hit.point.clone()
              cands.push({ dist: hit.distance, point: pt, apply: () => bossTakeDamage(damage, pt) })
            }
          }
        }
        return cands
      }

      // Lock the RPG's homing target at launch: the nearest enemy of ANY type
      // whose bearing from `origin` lies inside the aim cone around `dir`.
      // Returns a HomingTarget wrapping the live entity, or null when the cone
      // is empty (the rocket then flies straight). Covers every enemy kind so
      // the launcher is no longer jet-only.
      function acquireRocketTarget(origin: THREE.Vector3, dir: THREE.Vector3): HomingTarget | null {
        let best: HomingTarget | null = null
        let bestD = Number.POSITIVE_INFINITY
        const consider = (
          x: number,
          y: number,
          z: number,
          live: () => { x: number; y: number; z: number } | null,
        ) => {
          const ox = x - origin.x
          const oy = y - origin.y
          const oz = z - origin.z
          const d = Math.hypot(ox, oy, oz)
          if (d < 1e-3 || d >= bestD) return
          // Bearing inside the lock cone?
          if ((ox * dir.x + oy * dir.y + oz * dir.z) / d < RPG_LOCK_COS) return
          bestD = d
          best = { pos: live }
        }
        for (const e of enemies) {
          if (e.hp <= 0 || e.aiDriving) continue
          consider(e.mesh.position.x, e.mesh.position.y, e.mesh.position.z, () =>
            e.hp > 0 && !e.aiDriving
              ? { x: e.mesh.position.x, y: e.mesh.position.y, z: e.mesh.position.z }
              : null,
          )
        }
        for (const ej of enemyJets) {
          if (ej.dead) continue
          consider(ej.x, ej.y, ej.z, () => (ej.dead ? null : { x: ej.x, y: ej.y, z: ej.z }))
        }
        for (const vv of vehicles) {
          if (vv.dead || !vv.aiDriver) continue
          consider(vv.x, 1, vv.z, () =>
            vv.dead || !vv.aiDriver ? null : { x: vv.x, y: 1, z: vv.z },
          )
        }
        for (const gun of aaGuns) {
          if (gun.dead || gun === activeAAGun) continue
          const gy = gun.baseY + 1.1
          consider(gun.x, gy, gun.z, () => (gun.dead ? null : { x: gun.x, y: gy, z: gun.z }))
        }
        return best
      }

      // ── Grenade detonation (shared) ─────────────────────────────────────────
      // AOE blast for any thrown grenade. Enemy-thrown grenades (fromEnemy)
      // damage the player; player-thrown grenades damage enemies. Called from
      // every isGrenade projectile's impact / fuse-expiry path so the toss →
      // land → AOE → damage chain runs from one place.
      function detonateGrenade(
        center: THREE.Vector3,
        radius: number,
        fromEnemy: boolean,
        antiTank = false,
      ) {
        center.y = Math.max(0.4, center.y)
        spawnExplosion(center)
        lastNoiseRef.current = { x: center.x, z: center.z, expires: Date.now() + 4000 }
        if (fromEnemy) {
          const dpDist = Math.hypot(focalPoint.x - center.x, focalPoint.z - center.z)
          if (
            dpDist < radius &&
            gamePhaseRef.current === "playing" &&
            Date.now() > spawnInvulnUntilRef.current
          ) {
            const dmg = Math.max(15, Math.floor(60 * (1 - dpDist / radius)))
            if (drivingRef.current && activeVehicle) {
              // Riding: the vehicle soaks the blast (player shielded). Explosive
              // → bypasses tank armor. Only a heavy's anti-tank grenade gets the
              // 3x multiplier — enemy tank shells (also explosive) stay 1x.
              const vDmg = activeVehicle.kind === "tank" && antiTank ? dmg * TANK_GRENADE_MULT : dmg
              damageActiveVehicle(vDmg, "explosive")
            } else {
              playerHpRef.current = Math.max(0, playerHpRef.current - aaShield(dmg))
              setPlayerHp(playerHpRef.current)
              lastDamageTimeRef.current = Date.now()
              cameraShakeRef.current.intensity = 3
              setDamageFlash(true)
              SOUNDS.damage()
              setTimeout(() => setDamageFlash(false), 320)
              if (playerHpRef.current <= 0) {
                gamePhaseRef.current = "gameover"
                setGamePhase("gameover")
                deathsRef.current += 1
                setDeaths(deathsRef.current)
              }
            }
          }
          return
        }
        // Player-thrown (frag / tank shell / jet missile): AOE-damage every
        // enemy type in range through the shared target set — infantry,
        // terraformers, bike riders, enemy jets, enemy vehicles and AA guns.
        damageAllInRadius(
          center,
          radius,
          (d) => Math.max(20, Math.floor(120 * (1 - d / radius))),
          "grenade",
        )
      }

      // ── PR-G1: RPG rocket — fire + homing detonation ─────────────────────────
      // AOE blast through the shared target set: ground enemies (terraformers /
      // infantry / bike riders), enemy jets, enemy-driven vehicles and enemy AA
      // guns. Direct (centre) damage falls off to splash at the rim.
      function detonateRocket(center: THREE.Vector3) {
        center.y = Math.max(0.3, center.y)
        spawnExplosion(center)
        spawnExplosion(center.clone(), true)
        lastNoiseRef.current = { x: center.x, z: center.z, expires: Date.now() + 4000 }
        const radius = RPG_RADIUS
        damageAllInRadius(
          center,
          radius,
          (d) => Math.max(RPG_SPLASH, Math.floor(RPG_DIRECT * (1 - d / radius))),
          "rpg",
        )
      }

      // Launch a single homing rocket from the camera along the aim direction.
      function fireRocket() {
        camera.getWorldDirection(fwd3)
        const dir = fwd3.clone().normalize()
        const start = new THREE.Vector3(
          focalPoint.x + dir.x * 1.2,
          // Include the player's own altitude so rockets fired from a roof /
          // ledge launch at eye level there — not from the ground (immediate
          // self-collision).
          focalPoint.y + EYE_HEIGHT + dir.y * 1.2,
          focalPoint.z + dir.z * 1.2,
        )
        const mesh = new THREE.Mesh(rpgRocketGeo, rpgRocketMat)
        mesh.position.copy(start)
        mesh.lookAt(start.clone().add(dir))
        scene.add(mesh)
        // Lock onto the nearest enemy of ANY type inside the aim cone (must run
        // before dir is scaled into the velocity below).
        const homingTarget = acquireRocketTarget(start, dir)
        bullets.push({
          mesh,
          velocity: dir.multiplyScalar(RPG_SPEED),
          life: RPG_LIFE,
          isEnemy: false,
          damage: 0,
          isRocket: true,
          homingTarget,
          trailT: 0,
        })
        SOUNDS.rpg()
        cameraShakeRef.current.intensity = 3
      }

      // ── PR-G1: RPG pickups (arm the launcher by walking over one) ────────────
      function makeRPGPickup(x: number, z: number, y = 0) {
        const safe = findSafeSpawnNear(x, z, 0.6)
        const g = new THREE.Group()
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.4, 8), rpgPickupMat)
        tube.rotation.z = Math.PI / 2
        tube.position.y = 1.0
        g.add(tube)
        const warhead = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.5, 8), rpgPickupMat)
        warhead.rotation.z = -Math.PI / 2
        warhead.position.set(0.85, 1.0, 0)
        g.add(warhead)
        g.position.set(safe.x, y, safe.z)
        scene.add(g)
        rpgPickups.push({ group: g, x: safe.x, z: safe.z, y, taken: false })
      }

      function collectRPG() {
        const idx = WEAPONS.findIndex((w) => w.id === "rpg")
        if (idx < 0) return
        weaponAmmoRef.current[idx] = 1
        setUnlockedWeapons((s) => {
          if (s.has("rpg")) return s
          const next = new Set([...s, "rpg"])
          // Persist so the launcher survives a page refresh (startup reads this
          // same key into unlockedWeapons).
          try {
            localStorage.setItem("fps_unlocked_weapons", JSON.stringify([...next]))
          } catch {
            /* ignore */
          }
          return next
        })
        // Auto-equip the launcher (mirrors the inline switch the weapon UI uses).
        weaponAmmoRef.current[currentWeaponIdxRef.current] = ammoRef.current
        currentWeaponIdxRef.current = idx
        ammoRef.current = 1
        setAmmo(1)
        setCurrentWeaponIdx(idx)
        showNotification("RPG 取得 — 対空ロケット装備！")
        SOUNDS.pistol()
      }

      // Bob / spin the pickups and collect any the (on-foot) player walks over.
      function updateRPGPickups(dt: number) {
        if (rpgPickups.length === 0) return
        const grabbable = !drivingRef.current && !aaMountedRef.current
        const bob = Math.sin(Date.now() * 0.003) * 0.15
        for (const p of rpgPickups) {
          if (p.taken) continue
          p.group.rotation.y += dt * 1.5
          p.group.position.y = p.y + 0.3 + bob
          if (!grabbable) continue
          if (
            Math.hypot(p.x - focalPoint.x, p.z - focalPoint.z) < 2.0 &&
            Math.abs(p.y - focalPoint.y) < 3
          ) {
            p.taken = true
            scene.remove(p.group)
            collectRPG()
          }
        }
      }

      // ── Knife melee ────────────────────────────────────────────────────────
      // Forward fan-shaped (±30°, 1.8m) sweep. Big damage; a hit on a target
      // whose head is in view (player aiming up) is a one-shot. Anti-spam
      // gated by KNIFE_COOLDOWN_MS so a held FIRE / mouse can't chain swings
      // mid-animation. Also melees remote players in PvP-enabled modes.
      function meleeAttack() {
        if (gamePhaseRef.current !== "playing") return
        if (drivingRef.current) return
        const now = Date.now()
        if (now - lastMeleeRef.current < KNIFE_COOLDOWN_MS) return
        lastMeleeRef.current = now
        knifeSwingRef.current = KNIFE_SWING_TIME
        recoilRef.current = 0.05
        SOUNDS.knife()

        // Horizontal camera forward.
        camera.getWorldDirection(fwd3)
        const flen = Math.hypot(fwd3.x, fwd3.z) || 1
        const nfx = fwd3.x / flen
        const nfz = fwd3.z / flen
        const cosHalf = Math.cos(KNIFE_HALF_ANGLE)
        // Looking up enough that the cross-hair is on a target's head → the
        // strike counts as a decapitating blow (instant kill).
        const headHeightAim = camState.pitch > 0.12

        const aliveEnemies = enemies.filter((e) => e.hp > 0 && !e.aiDriving)
        let struck = false
        for (const e of aliveEnemies) {
          const dx = e.mesh.position.x - focalPoint.x
          const dz = e.mesh.position.z - focalPoint.z
          const d = Math.hypot(dx, dz)
          if (d > KNIFE_RANGE || d < 1e-3) continue
          const dot = (dx / d) * nfx + (dz / d) * nfz
          if (dot < cosHalf) continue
          struck = true
          const dmg = headHeightAim ? 9999 : KNIFE_DAMAGE
          e.hp -= dmg
          scoreRef.current += Math.floor(Math.min(dmg, e.maxHp) * 10)
          setScore(scoreRef.current)
          const bloodAt = e.mesh.position.clone()
          bloodAt.y = EYE_HEIGHT * (headHeightAim ? 1.1 : 0.7)
          spawnBlood(bloodAt)
          SOUNDS.hit()
          if (headHeightAim) {
            setHeadshotMsg(true)
            headshotsRef.current += 1
            setTimeout(() => setHeadshotMsg(false), 800)
          }
          if (e.hp <= 0) applyEnemyKill(e, "knife")
        }
        if (struck) {
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

        // PvP melee: stab nearby remote players (same gating as gun PvP).
        const sceneRefsLocal = sceneRef.current
        if (sceneRefsLocal && (myTeamRef.current !== "ffa" || modeRef.current === "ffa")) {
          for (const [rid, rmesh] of sceneRefsLocal.remoteMeshes) {
            const dx = rmesh.position.x - focalPoint.x
            const dz = rmesh.position.z - focalPoint.z
            const d = Math.hypot(dx, dz)
            if (d > KNIFE_RANGE || d < 1e-3) continue
            const dot = (dx / d) * nfx + (dz / d) * nfz
            if (dot < cosHalf) continue
            wsRef.current?.send(
              JSON.stringify({
                type: "pvp_hit",
                targetId: rid,
                dmg: KNIFE_DAMAGE,
                headshot: headHeightAim,
                weapon: "knife",
              }),
            )
            SOUNDS.hit()
            spawnBlood(rmesh.position.clone())
          }
        }
      }

      // ── Fire weapon ────────────────────────────────────────────────────────
      // Tank main cannon: a slow AOE shell on a cooldown. Reuses the grenade
      // projectile path (isGrenade, player-owned) so it arcs, impacts and
      // AOE-detonates against enemies via detonateGrenade. Never hurts the
      // player or their own tank (player grenades only damage enemies).
      function fireCannon() {
        const v = activeVehicle
        if (!v || v.kind !== "tank" || v.dead) return
        const now = Date.now()
        if (now - lastCannonRef.current < CANNON_COOLDOWN_MS) return
        lastCannonRef.current = now
        setCannonCooldownMs(CANNON_COOLDOWN_MS)
        const fwd = new THREE.Vector3()
        camera.getWorldDirection(fwd)
        // Spawn ahead of the turret so the shell clears the tank's own body.
        const shell = new THREE.Mesh(
          new THREE.SphereGeometry(0.22, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0xffcc66 }),
        )
        shell.position.set(v.x + fwd.x * 3.0, 1.7 + fwd.y * 2.5, v.z + fwd.z * 3.0)
        scene.add(shell)
        bullets.push({
          mesh: shell,
          velocity: new THREE.Vector3(
            fwd.x * CANNON_SHELL_SPEED,
            fwd.y * CANNON_SHELL_SPEED + 2.0, // slight lob to fight gravity drop
            fwd.z * CANNON_SHELL_SPEED,
          ),
          life: 2.5,
          isEnemy: false,
          damage: 0, // damage comes from the AOE on detonation
          isGrenade: true,
          grenadeRadius: CANNON_RADIUS,
        })
        SOUNDS.shotgun() // deep boom
        cameraShakeRef.current.intensity = 5
        lastNoiseRef.current = { x: v.x, z: v.z, expires: Date.now() + 5000 }
      }

      function fire() {
        if (gamePhaseRef.current !== "playing") return
        // In a tank with the cannon selected, FIRE shoots the main gun.
        if (drivingRef.current && cannonModeRef.current && activeVehicle?.kind === "tank") {
          fireCannon()
          return
        }
        // In the jet, the nose MG is fired continuously from updateJet while
        // the button is held (mouseDownRef) — nothing to do here.
        if (drivingRef.current && activeVehicle?.kind === "jet") return
        // Manning an AA gun: shells fire on their own cadence in updateMountedAA.
        if (aaMountedRef.current) return
        // Brief lock right after dismounting a vehicle (exposure window).
        if (Date.now() < fireLockUntilRef.current) return
        // HUNT special weapon equipped → its own firing path (blade fires on
        // release in huntUpdateEquip, so left-click is a no-op for it).
        if (modeRef.current === "hunt" && huntWeaponRef.current) {
          if (huntWeaponRef.current !== "blade") fireHuntWeapon()
          return
        }
        const weapon = WEAPONS[currentWeaponIdxRef.current]
        if (!weapon) return
        // Knife: melee swing instead of a projectile. Its own cooldown gate
        // lives in meleeAttack so a held FIRE button can't chain swings.
        // (meleeAttack stays disabled while driving — no knifing from a car.)
        if (weapon.melee) {
          meleeAttack()
          return
        }
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

        // RPG: launch one homing rocket, then auto-reload (8s). The rocket
        // carries its own AOE damage, so skip the hitscan path entirely.
        if (weapon.rocket) {
          recoilRef.current = weapon.recoil
          fireRocket()
          if (ammoRef.current <= 0) startReload(weapon)
          return
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
        // Broadcast a "noise" event from the player position. The enemy AI
        // reads this each tick: any patrol within `noiseRange` abandons its
        // waypoint and converges on the source. ADS-suppressed pistol shots
        // travel a shorter distance via the per-weapon noiseRadius override.
        lastNoiseRef.current = {
          x: focalPoint.x,
          z: focalPoint.z,
          // Stay "interesting" for 3.5s — long enough to commit to a search,
          // short enough that holding fire eventually de-aggros patrols.
          expires: Date.now() + 3500,
        }

        // Center-ray hit detection (recursive through humanoid groups)
        pointer.set(0, 0)
        raycaster.setFromCamera(pointer, camera)
        // Exclude hidden vehicle drivers — they're damaged via their vehicle.
        const aliveEnemies = enemies.filter((e) => e.hp > 0 && !e.aiDriving)
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

        // A single shot can only damage one thing. Once any target (AI vehicle,
        // enemy jet, remote player or infantry) takes the hit, later passes are
        // skipped — otherwise one bullet would pass through and multi-hit.
        let shotConsumed = false

        // Hard (non-humanoid) targets — enemy-driven vehicles, enemy AA guns and
        // enemy jets — share one hitscan helper. Jets are small, fast and fly at
        // 150–300m, so a pixel-perfect centre ray almost never connects; the
        // helper adds a ray-vs-sphere aim assist (scoped wider for the sniper)
        // out to JET_GROUND_RANGE so ground fire can actually down a bandit. We
        // take the nearest such candidate, provided no wall or infantry sits in
        // front of it (a single shot only damages one thing).
        {
          const assistR =
            JET_AIM_ASSIST_RADIUS * (weapon.id === "sniper" ? JET_AIM_ASSIST_SNIPER_MULT : 1)
          const hard = collectHardTargets(raycaster, weapon.hitDamage, {
            jetAssistR: assistR,
            groundAssistR: 0,
            jetRange: JET_GROUND_RANGE,
          }).sort((a, b) => a.dist - b.dist)[0]
          if (hard) {
            const blockedByWall = !!(nearestWall && nearestWall.distance < hard.dist)
            const blockedByEnemy = !!(enemyHits[0] && enemyHits[0].distance < hard.dist)
            if (!blockedByWall && !blockedByEnemy) {
              hard.apply()
              SOUNDS.hit()
              spawnExplosion(hard.point.clone(), true)
              enemyHits = [] // consumed by the hard target
              shotConsumed = true
            }
          }
        }

        // PvP hit: check remote players
        const sceneRefsLocal = sceneRef.current
        if (
          !shotConsumed &&
          sceneRefsLocal &&
          (myTeamRef.current !== "ffa" || modeRef.current === "ffa")
        ) {
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
            // A nearer infantry (AI enemy) in front of the remote player blocks
            // the shot: don't consume it on PvP, let the infantry hit run below.
            const blockedByInfantry = !!(
              enemyHits[0] &&
              pvpHits[0] &&
              enemyHits[0].distance < pvpHits[0].distance
            )
            if (!wallBlocks && !blockedByInfantry && pvpHits.length > 0 && pvpHits[0]) {
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
                shotConsumed = true
              }
            }
          }
        }

        if (!shotConsumed && enemyHits.length > 0) {
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
              applyEnemyKill(hitEnemy, weapon.id)
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
        } else if (e.button === 2 && drivingRef.current && activeVehicle?.kind === "jet") {
          // Right-click fires a jet missile (consumed in updateJet).
          jetMissileReqRef.current = true
        } else if (e.button === 2 && !drivingRef.current) {
          // ADS is disabled while driving (third-person free-aim, no zoom).
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

      // ── Enemy elevator-chase FSM (PR-C) ──────────────────────────────────
      // Advances an enemy that is using a tower elevator to reach a rooftop
      // player. Returns true when the FSM fully owns the enemy this frame (skip
      // the normal AI) — that's approach / riding / descending. Returns false
      // only for the "roof" phase, where the normal combat AI runs but the
      // enemy stays pinned at the deck altitude (its mesh.y is never otherwise
      // touched while alive). Movement is plain Y-lerp + 2D steering — no
      // raycasts.
      function updateEnemyClimb(enemy: CombatEnemy, dt: number): boolean {
        const c = enemy.climb
        if (!c) return false
        const zone = c.zone
        const baseX = zone.baseX ?? (zone.x1 + zone.x2) / 2
        const baseZ = zone.baseZ ?? (zone.z1 + zone.z2) / 2
        const topX = zone.topX ?? baseX
        const topZ = zone.topZ ?? baseZ
        const targetY = zone.targetY
        if (c.mode === "approach") {
          const dx = baseX - enemy.mesh.position.x
          const dz = baseZ - enemy.mesh.position.z
          const d = Math.hypot(dx, dz)
          if (d < 1.4) {
            // At the base — board only if a rider slot is free (else queue).
            let riders = 0
            for (const e of enemies) if (e !== enemy && e.climb?.mode === "riding") riders++
            if (riders < MAX_ELEVATOR_RIDERS) {
              c.mode = "riding"
              c.t = 0
              enemy.mesh.position.x = baseX
              enemy.mesh.position.z = baseZ
            }
          } else {
            const spd = enemy.config.speed * 0.95 * dt
            const nx = enemy.mesh.position.x + (dx / d) * spd
            const nz = enemy.mesh.position.z + (dz / d) * spd
            if (!collidesWithWall(nx, enemy.mesh.position.z, ENEMY_RADIUS))
              enemy.mesh.position.x = nx
            if (!collidesWithWall(enemy.mesh.position.x, nz, ENEMY_RADIUS))
              enemy.mesh.position.z = nz
            enemy.facing.set(dx / d, 0, dz / d)
          }
          return true
        }
        if (c.mode === "riding") {
          c.t = Math.min(1, c.t + dt / ENEMY_RIDE_TIME)
          enemy.mesh.position.x = baseX + (topX - baseX) * c.t
          enemy.mesh.position.z = baseZ + (topZ - baseZ) * c.t
          enemy.mesh.position.y = targetY * c.t
          if (c.t >= 1) {
            c.mode = "roof"
            enemy.mesh.position.y = targetY
            // Engage immediately on arrival.
            enemy.state = "alert"
            enemy.lastSeenPlayer = { x: enemy.mesh.position.x, z: enemy.mesh.position.z }
          }
          return true
        }
        if (c.mode === "descending") {
          c.t = Math.min(1, c.t + dt / ENEMY_RIDE_TIME)
          enemy.mesh.position.x = topX + (baseX - topX) * c.t
          enemy.mesh.position.z = topZ + (baseZ - topZ) * c.t
          enemy.mesh.position.y = targetY * (1 - c.t)
          if (c.t >= 1) {
            enemy.mesh.position.y = 0
            enemy.climb = null
            enemy.state = "patrol"
          }
          return true
        }
        return false // "roof" — normal AI runs at altitude
      }

      // ── Animation loop ─────────────────────────────────────────────────────
      const clock = new THREE.Clock()
      const fwd3 = new THREE.Vector3()
      const right3 = new THREE.Vector3()

      // Frame counter — used to throttle non-critical per-frame work
      // (aim raycast, minimap redraw). 60Hz visuals don't need these at
      // 60Hz; running them every 4th frame is the cheapest perf win in
      // the loop.
      let frameCount = 0
      // Smoke is updated every 3rd frame; this banks the dt of the skipped
      // frames so the puffs still rise at the right rate when we do update.
      let smokeAccumDt = 0
      // Wall-clock throttle (ms) for the minimap redraw — see the draw block.
      let lastMinimapAt = 0
      // Enemy-vehicle spawn manager timers (ms). Armed lazily on first frame.
      let aiVehicleArmAt = 0
      let aiVehicleNextCheck = 0

      function animate() {
        animFrameRef.current = requestAnimationFrame(animate)
        // Cap dt to 50ms so a tab refocus / long pause doesn't yank everything
        // (massive lerp blends + massive position deltas would look like
        // teleportation and could clip through walls).
        const dt = Math.min(clock.getDelta(), 0.05)
        const refs = sceneRef.current
        if (!refs) return
        frameCount = (frameCount + 1) | 0

        // Low-pass filter the move-stick input (finger jitter on glass).
        const joyBlend = 1 - Math.exp(-dt * 22)
        joySmoothRef.current.vx += (joystickRef.current.vx - joySmoothRef.current.vx) * joyBlend
        joySmoothRef.current.vy += (joystickRef.current.vy - joySmoothRef.current.vy) * joyBlend

        // Drain accumulated mouse delta with a light smoothing tail. We
        // apply ~75% of the buffered movement this frame and roll the
        // remainder into next frame — eliminates the spiky single-event
        // jumps on high-Hz mice without adding noticeable input lag.
        {
          // Drain 55% of buffered mouse movement this frame and roll the
          // rest forward. Lower than the previous 0.75 → stops "slide-past"
          // when the player flicks-and-stops, which read as motion-sickness
          // jitter for some players.
          const APPLY = 0.55
          const mdx = mouseDeltaRef.current.x * APPLY
          const mdy = mouseDeltaRef.current.y * APPLY
          mouseDeltaRef.current.x -= mdx
          mouseDeltaRef.current.y -= mdy
          // HUNT teleport: "金縛り" — freeze the view (drop the buffered delta).
          if (huntInputLockRef.current) {
            mouseDeltaRef.current.x = 0
            mouseDeltaRef.current.y = 0
          } else if (mdx !== 0 || mdy !== 0) {
            // Base sensitivity dropped 0.002 → 0.0012 (≈40% slower default).
            // Player can scale 0.5x–2.0x via the settings panel. Mobile drags
            // are coarser than a mouse, so trim touch look to 0.7× for control.
            const sens = 0.0012 * mouseSensRef.current * (isMobileDevice ? 0.7 : 1)
            if (aaMountedRef.current) {
              // Manning the AA gun: the mouse nudges the ±30° manual barrel
              // correction (updateMountedAA owns the camera + turret).
              const lim = AA_MOUNT_MANUAL_AIM
              aaManualYawRef.current = Math.max(
                -lim,
                Math.min(lim, aaManualYawRef.current - mdx * sens),
              )
              aaManualPitchRef.current = Math.max(
                -lim,
                Math.min(lim, aaManualPitchRef.current - mdy * sens),
              )
            } else {
              camState.yaw -= mdx * sens
              camState.pitch = clampPitch(camState.pitch - mdy * sens)
              if (drivingRef.current) {
                // Free-aim while driving: the chase camera (updateVehicle) reads
                // camState and owns the camera. Just flag active aiming so it
                // doesn't auto-recenter behind the hull mid-aim.
                lastDriveAimRef.current = Date.now()
              } else {
                updateCamera()
              }
            }
          }
        }

        // ADS FOV interpolation. Base FOV bumped 75 → 80 — wider field of
        // view trades a touch of zoom for less peripheral motion-shear
        // when the player rotates quickly. No ADS zoom while driving.
        const targetFov =
          isAimingRef.current && !drivingRef.current
            ? currentWeaponIdxRef.current === 2
              ? 28
              : 50
            : 80
        if (Math.abs(camera.fov - targetFov) > 0.3) {
          camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12)
          camera.updateProjectionMatrix()
        }

        // Grenade request: throw an arcing grenade (disabled while driving).
        // It travels under gravity and AOE-detonates on ground/wall impact or
        // fuse expiry via the shared isGrenade projectile path — same physics
        // the heavy enemies' grenades already use.
        if (requestGrenadeRef.current && drivingRef.current) {
          requestGrenadeRef.current = false
        }
        if (requestGrenadeRef.current) {
          requestGrenadeRef.current = false
          const fwd = new THREE.Vector3()
          camera.getWorldDirection(fwd)
          const gMesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.14, 8, 6),
            new THREE.MeshBasicMaterial({ color: 0x335a33 }),
          )
          // Spawn just ahead of the eye so it clears the player's own body.
          gMesh.position.set(
            refs.focalPoint.x + fwd.x * 0.6,
            EYE_HEIGHT - 0.1,
            refs.focalPoint.z + fwd.z * 0.6,
          )
          refs.scene.add(gMesh)
          const THROW_SPEED = 17
          refs.bullets.push({
            mesh: gMesh,
            velocity: new THREE.Vector3(
              fwd.x * THROW_SPEED,
              fwd.y * THROW_SPEED + 4.5, // upward arc on top of the aim vector
              fwd.z * THROW_SPEED,
            ),
            life: 2.5,
            isEnemy: false,
            damage: 0, // damage comes from the AOE on detonation
            isGrenade: true,
            grenadeRadius: 5,
          })
          // Grenade toss is loud — flags the AI's noise sense to the throw spot.
          lastNoiseRef.current = {
            x: refs.focalPoint.x,
            z: refs.focalPoint.z,
            expires: Date.now() + 2000,
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
        // Tick tank cannon cooldown display (same change-gated pattern).
        if (drivingRef.current && cannonModeRef.current) {
          const sinceC = Date.now() - lastCannonRef.current
          const cd = Math.max(0, Math.round((CANNON_COOLDOWN_MS - sinceC) / 100) * 100)
          if (cd !== prevCannonCdRef.current) {
            prevCannonCdRef.current = cd
            setCannonCooldownMs(cd)
          }
        }

        // ── Vehicle: board / exit (E key or mobile button) + drive ──────────
        {
          const wantAction = climbRequestRef.current || vehicleActionRef.current
          if (drivingRef.current) {
            if (wantAction) {
              climbRequestRef.current = false
              vehicleActionRef.current = false
              exitVehicle()
            }
          } else if (!aaMountedRef.current) {
            const nv = nearestVehicle()
            const nowNear = nv !== null
            if (nowNear !== prevNearVehicleRef.current) {
              prevNearVehicleRef.current = nowNear
              setNearVehicle(nowNear)
            }
            if (wantAction && nv) {
              // Consume the E press so boarding doesn't also trigger a climb.
              climbRequestRef.current = false
              enterVehicle(nv)
            }
            // The mobile board button is vehicle-only — never fall through.
            vehicleActionRef.current = false
          }
        }

        // ── PR-G1: AA gun mount / dismount (E key or mobile button) ──────────
        // Mirrors the vehicle board flow. Runs after it so a vehicle wins if the
        // player somehow stands next to both; consumes the same E press.
        {
          const wantAction = climbRequestRef.current || aaMountActionRef.current
          if (aaMountedRef.current) {
            if (wantAction) {
              climbRequestRef.current = false
              aaMountActionRef.current = false
              exitAAGun()
            }
          } else if (!drivingRef.current) {
            const ng = nearestAAGunTo()
            const nowNear = ng !== null
            if (nowNear !== prevNearAAGunRef.current) {
              prevNearAAGunRef.current = nowNear
              setNearAAGun(nowNear)
            }
            if (wantAction && ng) {
              climbRequestRef.current = false
              enterAAGun(ng)
            }
            aaMountActionRef.current = false
          }
        }
        if (drivingRef.current) updateVehicle(dt)
        if (aaMountedRef.current) updateMountedAA(dt) // PR-G1 manned AA turret
        if (bikeSlots.length > 0) updateBikeRespawns(Date.now()) // refill taken bikes
        if (modeRef.current === "hunt") updateHunt(dt) // HUNT transfer-mission FSM
        if (modeRef.current === "hunt") updateHuntCreatures(dt) // monster idle/twitch
        // HUNT room compass: rotate the on-screen arrow toward the orb (which
        // sits at the room centre) in the player's local frame. Room phase only.
        if (modeRef.current === "hunt" && huntCompassRef.current) {
          const el = huntCompassRef.current
          if (huntPhaseRef.current === "room") {
            const dx = HUNT_ROOM.x - focalPoint.x
            const dz = HUNT_ROOM.z - focalPoint.z
            const cy = Math.cos(camState.yaw)
            const sy = Math.sin(camState.yaw)
            // forward = (-sin, -cos), screen-right = (-cos, sin)
            const fwdComp = dx * -sy + dz * -cy
            const rightComp = dx * -cy + dz * sy
            const ang = Math.atan2(rightComp, fwdComp)
            el.style.opacity = "0.9"
            el.style.transform = `translate(-50%, -50%) rotate(${ang}rad)`
          } else {
            el.style.opacity = "0"
          }
        }
        // Projectiles run every frame (skipping risks tunnelling through targets).
        updateAAShells(dt)
        updateCrashJets(dt)
        if (isSky && gamePhaseRef.current === "playing") updateSkyArena()
        // Mobile: run the secondary AI / effect systems every OTHER frame with a
        // doubled timestep — halves their per-frame cost while keeping motion
        // speed and time-gated cadences (firing, ramming) about the same.
        if (!isMobileDevice || (frameCount & 1) === 0) {
          const sdt = isMobileDevice ? dt * 2 : dt
          updateRPGPickups(sdt) // PR-G1 handheld launcher pickups
          updateBikeRiders(sdt) // motorcycle: drive terraformer-ridden bikes
          updateAAGuns(sdt)
          updateEnemyJets(sdt)
        }

        // ── Enemy-driven vehicles: spawn manager + per-frame AI ──────────────
        // Only in Wave Defense / missions (FFA/TDM have no vehicles; Zombie has
        // no driving enemies). A capped, occasional "special threat".
        if (modeRef.current === "wave_defense") {
          const nowAi = Date.now()
          if (aiVehicleArmAt === 0) aiVehicleArmAt = nowAi + 18000 // arm after 18s
          if (nowAi > aiVehicleArmAt && nowAi > aiVehicleNextCheck) {
            aiVehicleNextCheck = nowAi + 3000
            const activeDrivers = vehicles.filter((vv) => vv.aiDriver && !vv.dead).length
            const cap = nowAi - aiVehicleArmAt > 60000 ? 2 : 1
            if (activeDrivers < cap) {
              const free = vehicles.find((vv) => !vv.dead && !vv.aiDriver && vv !== activeVehicle)
              const hasFootEnemy = enemies.some((e) => e.hp > 0 && !e.aiDriving)
              if (free && hasFootEnemy) {
                commandeerVehicle(free, free.kind === "tank" ? "heavy" : "grunt")
              }
            }
          }
          for (const vv of vehicles) {
            if (vv.aiDriver && !vv.dead) updateEnemyVehicle(vv, dt)
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
        // HUNT teleport: freeze movement during the paralysis/warp window.
        if (huntInputLockRef.current) {
          inVx = 0
          inVz = 0
        }
        // Normalize once magnitude exceeds 1 so diagonal isn't √2 faster.
        const inMag = Math.hypot(inVx, inVz)
        if (inMag > 1) {
          inVx /= inMag
          inVz /= inMag
        }

        const fwdX = -Math.sin(camState.yaw)
        const fwdZ = -Math.cos(camState.yaw)
        const isSprinting = keysRef.current.has("Shift")
        // HUNT suit: +50% move speed while the suit holds.
        const huntSuitSpeed = huntSuitActiveRef.current ? HUNT_SUIT_SPEED : 1
        const spd = MOVE_SPEED * (isSprinting ? SPRINT_MULTIPLIER : 1) * huntSuitSpeed
        // Desired world-space velocity from input.
        const desiredVx = (fwdX * -inVz + Math.cos(camState.yaw) * inVx) * spd
        const desiredVz = (fwdZ * -inVz + -Math.sin(camState.yaw) * inVx) * spd
        // Smooth player velocity toward desired (accel ~10/s, no input → decel).
        const moveBlend = 1 - Math.exp(-dt * 14)
        playerVelRef.current.x += (desiredVx - playerVelRef.current.x) * moveBlend
        playerVelRef.current.z += (desiredVz - playerVelRef.current.z) * moveBlend
        const pv = playerVelRef.current
        const playerSpeed = Math.hypot(pv.x, pv.z)
        // On-foot movement is suspended while driving (the car owns focalPoint).
        if (!drivingRef.current && !aaMountedRef.current && playerSpeed > 0.01) {
          const nx = refs.focalPoint.x + pv.x * dt
          const nz = refs.focalPoint.z + pv.z * dt
          // Failsafe: if the player is somehow already inside a wall (bad
          // spawn, physics push-in), let any step through so they can escape
          // — otherwise the gate latches shut and they're stuck forever.
          // Pass the player's foot Y so walls below them (their own rooftop)
          // don't block lateral movement across the roof.
          const fy = refs.focalPoint.y
          const stuck = collidesWithWall(refs.focalPoint.x, refs.focalPoint.z, PLAYER_RADIUS, fy)
          if (stuck || !collidesWithWall(nx, refs.focalPoint.z, PLAYER_RADIUS, fy))
            refs.focalPoint.x = nx
          if (stuck || !collidesWithWall(refs.focalPoint.x, nz, PLAYER_RADIUS, fy))
            refs.focalPoint.z = nz
          updateCamera()
        }

        // (Mobile look is handled via the drag→mouseDelta path above; there
        // is no separate look-stick integration step anymore.)

        // ── Vertical update: floor sampling + gravity + E-key climb ─────
        // Highest walkable floor under the player's (x, z). Default ground
        // is y=0. Floors stored higher than the player's current head +
        // STEP_UP_MAX are ignored (we don't snap *up* onto rooftops just
        // by walking under them — those require an E-key climb zone).
        // Entirely skipped while driving: the car keeps the player on the
        // ground plane and owns the camera.
        if (!drivingRef.current) {
          let groundY = 0
          for (const f of refs.floors) {
            if (
              refs.focalPoint.x > f.x1 &&
              refs.focalPoint.x < f.x2 &&
              refs.focalPoint.z > f.z1 &&
              refs.focalPoint.z < f.z2 &&
              f.y > groundY &&
              f.y <= refs.focalPoint.y + STEP_UP_MAX
            ) {
              groundY = f.y
            }
          }

          // Is the player standing inside any climb zone right now? Powers
          // the bottom-of-screen "[E] 登る" prompt. We push to React state
          // only on boundary changes (entering / leaving the zone) so the
          // HUD doesn't re-render every frame while the player loiters.
          // Pick the *closest* zone the player is inside (by center distance)
          // rather than the first in array order. When two zones overlap (an
          // elevator pad near a building ladder), first-match could latch onto
          // the wrong one and the elevator would feel unresponsive — choosing
          // the nearest center makes every tower's elevator reliably engage.
          let nearClimbNow = false
          let atTopNow = false
          {
            const zone = climbZoneAt(refs.focalPoint.x, refs.focalPoint.z)
            if (zone) {
              nearClimbNow = true
              // Same "already on top" test the climb action uses, so the label
              // matches what pressing the button will actually do.
              atTopNow = Math.abs(refs.focalPoint.y - zone.targetY) < 0.6
            }
          }
          if (nearClimbNow !== prevNearClimbRef.current) {
            prevNearClimbRef.current = nearClimbNow
            setNearClimb(nearClimbNow)
          }
          if (atTopNow !== prevClimbAtTopRef.current) {
            prevClimbAtTopRef.current = atTopNow
            setClimbAtTop(atTopNow)
          }

          // E-key climb (consumed once per press in the keydown handler).
          if (climbRequestRef.current) {
            climbRequestRef.current = false
            if (Date.now() > climbCooldownUntilRef.current) {
              const zone = climbZoneAt(refs.focalPoint.x, refs.focalPoint.z)
              if (zone) {
                // If already roughly at the top, descend back down; else
                // climb up. Avoids "press E and bounce back instantly"
                // when the player keeps the key tapped at the top.
                const atTop = Math.abs(refs.focalPoint.y - zone.targetY) < 0.6
                // Start a smooth (eased) lift rather than teleporting. The ride
                // snaps the player to the shaft centre, then the animate loop
                // interpolates Y (and the glass car) over RIDE_MS.
                const RIDE_MS = 750
                const startRide = (toY: number, ex: number, ez: number) => {
                  refs.focalPoint.x = ex
                  refs.focalPoint.z = ez
                  elevatorRideRef.current = {
                    fromY: refs.focalPoint.y,
                    toY,
                    x: ex,
                    z: ez,
                    startMs: Date.now(),
                    durMs: RIDE_MS,
                    car: zone.car ?? null,
                  }
                  // Bring the car to the boarding height so it carries the player.
                  if (zone.car) zone.car.position.set(ex, refs.focalPoint.y + 1.1, ez)
                  playerVelYRef.current = 0
                  // Block re-trigger until the ride (plus a little slack) ends.
                  climbCooldownUntilRef.current = Date.now() + RIDE_MS + 150
                  // A lift is not a fall — keep the fall tracker quiet.
                  wasAirborneRef.current = false
                  fallStartYRef.current = refs.focalPoint.y
                }
                if (atTop && zone.downY !== undefined) {
                  // Descend onto clear ground at the shaft centre.
                  startRide(
                    zone.downY,
                    zone.baseX ?? refs.focalPoint.x,
                    zone.baseZ ?? refs.focalPoint.z,
                  )
                } else if (!atTop) {
                  // Ascend onto the deck (inside its floor bounds).
                  startRide(
                    zone.targetY,
                    zone.topX ?? refs.focalPoint.x,
                    zone.topZ ?? refs.focalPoint.z,
                  )
                }
              }
            }
          }

          // Parachute: 1s after ejecting the canopy auto-deploys.
          if (parachutePhaseRef.current === "falling" && Date.now() >= chuteOpenAtRef.current) {
            openChute()
            playerVelYRef.current = Math.min(playerVelYRef.current, -1.5)
          }

          // Smooth elevator ride takes precedence over gravity: ease the player
          // (and the glass car) between fromY/toY, suspending the fall code.
          if (elevatorRideRef.current) {
            const e = elevatorRideRef.current
            const tt = Math.min(1, (Date.now() - e.startMs) / e.durMs)
            const k = tt * tt * (3 - 2 * tt) // smoothstep ease-in-out
            refs.focalPoint.x = e.x
            refs.focalPoint.z = e.z
            refs.focalPoint.y = e.fromY + (e.toY - e.fromY) * k
            if (e.car) e.car.position.set(e.x, refs.focalPoint.y + 1.1, e.z)
            playerVelYRef.current = 0
            wasAirborneRef.current = false
            fallStartYRef.current = refs.focalPoint.y
            if (tt >= 1) {
              refs.focalPoint.y = e.toY
              elevatorRideRef.current = null
            }
          }
          // Under canopy: gentle descent (no fall damage), horizontal steering
          // already handled by the normal on-foot movement above.
          else if (parachutePhaseRef.current === "chute") {
            playerVelYRef.current -= PARACHUTE_GRAVITY * dt
            if (playerVelYRef.current < -PARACHUTE_MAX_SINK) {
              playerVelYRef.current = -PARACHUTE_MAX_SINK
            }
            refs.focalPoint.y += playerVelYRef.current * dt
            if (refs.focalPoint.y <= groundY) {
              refs.focalPoint.y = groundY
              playerVelYRef.current = 0
              wasAirborneRef.current = false
              closeChute()
            }
            if (parachuteMeshRef.current) {
              parachuteMeshRef.current.position.set(
                refs.focalPoint.x,
                refs.focalPoint.y,
                refs.focalPoint.z,
              )
            }
          }
          // Apply gravity / floor snap. Fall damage is computed from the drop
          // height (the Y the player became airborne at, minus the landing Y) —
          // a single cheap comparison, no raycasts.
          else if (refs.focalPoint.y > groundY + 0.01) {
            // Mark the start of a fall the frame the player leaves the ground.
            if (!wasAirborneRef.current) {
              wasAirborneRef.current = true
              fallStartYRef.current = refs.focalPoint.y
            }
            playerVelYRef.current -= GRAVITY * dt
            refs.focalPoint.y += playerVelYRef.current * dt
            if (refs.focalPoint.y <= groundY) {
              // Landed. Damage scales with the drop; ≥ LETHAL_DROP is fatal.
              const drop = fallStartYRef.current - groundY
              wasAirborneRef.current = false
              if (
                drop >= FALL_MIN_DROP &&
                parachutePhaseRef.current === "none" &&
                gamePhaseRef.current === "playing" &&
                Date.now() > spawnInvulnUntilRef.current &&
                !huntSuitActiveRef.current // HUNT suit negates fall damage
              ) {
                let dmg: number
                if (drop >= FALL_LETHAL_DROP) {
                  dmg = playerHpRef.current // guaranteed kill
                } else {
                  const t = (drop - FALL_MIN_DROP) / (FALL_LETHAL_DROP - FALL_MIN_DROP)
                  dmg = Math.round(FALL_DMG_AT_MIN + (FALL_DMG_MAX - FALL_DMG_AT_MIN) * t)
                }
                if (dmg > 0) {
                  playerHpRef.current = Math.max(0, playerHpRef.current - dmg)
                  setPlayerHp(playerHpRef.current)
                  lastDamageTimeRef.current = Date.now()
                  cameraShakeRef.current.intensity = 3 + Math.min(6, drop * 0.3)
                  setDamageFlash(true)
                  SOUNDS.damage()
                  setTimeout(() => setDamageFlash(false), 320)
                  // Center-screen damage number; auto-clears after ~1.1s
                  // (guarded by key so a fresher popup isn't wiped early).
                  fallDmgKeyRef.current += 1
                  const popupKey = fallDmgKeyRef.current
                  setFallDmgPopup({ dmg, key: popupKey })
                  setTimeout(
                    () => setFallDmgPopup((p) => (p && p.key === popupKey ? null : p)),
                    1100,
                  )
                  if (playerHpRef.current <= 0) {
                    gamePhaseRef.current = "gameover"
                    setGamePhase("gameover")
                    deathsRef.current += 1
                    setDeaths(deathsRef.current)
                  }
                }
              }
              refs.focalPoint.y = groundY
              playerVelYRef.current = 0
            }
          } else if (
            modeRef.current === "hunt" &&
            keysRef.current.has(" ") &&
            !huntInputLockRef.current &&
            !drivingRef.current
          ) {
            // HUNT jump: the suit triples the launch impulse (3× jump).
            refs.focalPoint.y = groundY + 0.02
            playerVelYRef.current = HUNT_JUMP_SPEED * (huntSuitActiveRef.current ? 3 : 1)
            wasAirborneRef.current = true
            fallStartYRef.current = refs.focalPoint.y
          } else {
            // Snap to floor (handles walking onto a new floor at the same Y
            // and the small auto step-up of low geometry).
            refs.focalPoint.y = groundY
            playerVelYRef.current = 0
            wasAirborneRef.current = false
          }
          updateCamera()
        }

        // Pulse the entry decal rings (door / ladder ground markers) so
        // they're spottable peripherally. Shared sine wave keeps the
        // pulse in lockstep across all decals — reads as deliberate
        // signage rather than per-light flicker.
        {
          const pulse = 0.7 + Math.sin(Date.now() * 0.004) * 0.45
          for (const d of entryDecals) {
            const mm = d.material as THREE.MeshStandardMaterial
            mm.emissiveIntensity = pulse
          }
        }

        // Blink the rooftop warning lights on the landmark towers (sharp on/off
        // pulse, like aircraft-warning beacons).
        if (towerBeacons.length) {
          const on = Math.sin(Date.now() * 0.006) > 0
          const intensity = on ? 2.6 : 0.25
          for (const m of towerBeacons) m.emissiveIntensity = intensity
        }

        // Walk-bob: subtle vertical head sway when actually moving. Phase
        // freezes when standing still so it doesn't bob while idle. Base Y
        // is now the focal point's altitude (0 on ground, raised on roof).
        // Gated by the user preference (defaults off — common motion-sickness
        // trigger). When off, the camera stays locked to baseY.
        const baseY = refs.focalPoint.y + EYE_HEIGHT
        if (drivingRef.current) {
          // Chase camera owns Y while driving — no head-bob.
        } else if (walkBobOnRef.current && playerSpeed > 0.5) {
          walkBobRef.current += dt * (4 + playerSpeed * 0.6)
          const bobAmp = isAimingRef.current ? 0.012 : 0.03
          camera.position.y = baseY + Math.sin(walkBobRef.current * 2) * bobAmp
        } else {
          // Snap toward baseY (slightly faster decay when bob is off so
          // toggling mid-game settles quickly).
          camera.position.y += (baseY - camera.position.y) * (1 - Math.exp(-dt * 14))
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

        // Camera shake (applied directly, not baked into camState).
        // Per-axis multipliers halved (0.008 → 0.004, 0.006 → 0.003) to
        // cut the motion-sickness load on damage / fall landings.
        if (cameraShakeRef.current.intensity > 0 && !drivingRef.current) {
          const shk = cameraShakeRef.current.intensity
          const t = Date.now() * 0.05
          camera.rotation.y += Math.sin(t) * shk * 0.004
          camera.rotation.x += Math.cos(t * 1.3) * shk * 0.003
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

        // Knife viewmodel: show the blade for slot [4], hide the gun; drive
        // the down-swing animation while a swing is active.
        {
          const knifeEquipped = WEAPONS[currentWeaponIdxRef.current]?.melee === true
          gunParts.visible = !knifeEquipped
          knifePivot.visible = knifeEquipped
          if (knifeSwingRef.current > 0) {
            knifeSwingRef.current = Math.max(0, knifeSwingRef.current - dt)
            // 0 → 1 over the swing; sine arc so it whips down then recovers.
            const prog = 1 - knifeSwingRef.current / KNIFE_SWING_TIME
            const arc = Math.sin(prog * Math.PI)
            knifePivot.rotation.x = arc * 1.3 // down-swing pitch
            knifePivot.rotation.z = -arc * 0.5 // slight inward roll
            // Lunge the blade forward at the peak of the swing.
            refs.gunGroup.position.addScaledVector(fwd3, arc * 0.12)
          } else {
            knifePivot.rotation.x = 0
            knifePivot.rotation.z = 0
          }
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

        // ── PR-G1: rocket exhaust puffs (scale-grow, then despawn) ───────────
        for (let i = rocketPuffs.length - 1; i >= 0; i--) {
          const p = rocketPuffs[i]
          if (!p) continue
          p.life -= dt
          if (p.life <= 0) {
            refs.scene.remove(p.mesh)
            rocketPuffs.splice(i, 1)
            continue
          }
          const s = 0.4 + (0.5 - p.life) * 1.2
          p.mesh.scale.setScalar(Math.max(0.2, s))
        }

        // ── Bullets ────────────────────────────────────────────────────────
        for (let i = refs.bullets.length - 1; i >= 0; i--) {
          const b = refs.bullets[i]
          if (!b) continue
          // RPG rocket: homes on the target locked at launch — any enemy type
          // (medium turn rate, no gravity) — trails smoke, and AOE-explodes on
          // proximity / impact / fuse expiry via detonateRocket. With no lock it
          // flies straight. Fully self-contained → continue.
          if (b.isRocket) {
            const tgt = b.homingTarget ? b.homingTarget.pos() : null
            if (tgt) {
              const speed = b.velocity.length() || RPG_SPEED
              const want = new THREE.Vector3(
                tgt.x - b.mesh.position.x,
                tgt.y - b.mesh.position.y,
                tgt.z - b.mesh.position.z,
              ).normalize()
              const cur = b.velocity.clone().normalize()
              // Rotate the heading toward the target, capped at RPG_HOMING_TURN.
              const ang = cur.angleTo(want)
              if (ang > 1e-3) {
                const t = Math.min(1, (RPG_HOMING_TURN * dt) / ang)
                cur.lerp(want, t).normalize()
                b.velocity.copy(cur.multiplyScalar(speed))
              }
            }
            b.mesh.position.addScaledVector(b.velocity, dt)
            b.mesh.lookAt(b.mesh.position.clone().add(b.velocity))
            b.life -= dt
            // Smoke trail.
            b.trailT = (b.trailT ?? 0) - dt
            if ((b.trailT ?? 0) <= 0) {
              b.trailT = 0.04
              const puff = new THREE.Mesh(rpgSmokeGeo, rpgSmokeMat)
              puff.position.copy(b.mesh.position)
              puff.scale.setScalar(0.3)
              refs.scene.add(puff)
              rocketPuffs.push({ mesh: puff, life: 0.5 })
            }
            // Proximity fuse on jets, plus ground / wall / fuse-expiry.
            const near = tgt
              ? Math.hypot(
                  b.mesh.position.x - tgt.x,
                  b.mesh.position.y - tgt.y,
                  b.mesh.position.z - tgt.z,
                ) < RPG_DIRECT_RADIUS
              : false
            const hitGround = b.mesh.position.y <= 0.2
            const inWall = pointInsideWall(b.mesh.position.x, b.mesh.position.y, b.mesh.position.z)
            if (near || hitGround || inWall || b.life <= 0) {
              detonateRocket(b.mesh.position.clone())
              refs.scene.remove(b.mesh)
              refs.bullets.splice(i, 1)
            }
            continue
          }
          // Grenades arc under gravity (plain bullets travel in straight
          // lines — flag-gated so we don't pay this cost on every shot).
          if (b.isGrenade) b.velocity.y -= 12 * dt
          b.mesh.position.addScaledVector(b.velocity, dt)
          b.life -= dt
          // Grenade ground/wall hit → detonate now (rather than waiting
          // for the fuse) so it doesn't roll under buildings.
          if (b.isGrenade && b.life > 0) {
            const ground = b.mesh.position.y <= 0.15
            const inWall = pointInsideWall(b.mesh.position.x, b.mesh.position.y, b.mesh.position.z)
            if (ground || inWall) {
              detonateGrenade(
                b.mesh.position.clone(),
                b.grenadeRadius ?? 4,
                b.isEnemy,
                b.isAntiTankGrenade ?? false,
              )
              refs.scene.remove(b.mesh)
              b.mesh.geometry.dispose()
              refs.bullets.splice(i, 1)
              continue
            }
          }
          // Wall impact: if the bullet just entered a wall's 3D AABB, sink it
          // with a small spark instead of letting it punch through cover.
          // Grenades are handled by the dedicated branch above.
          if (
            !b.isGrenade &&
            b.life > 0 &&
            pointInsideWall(b.mesh.position.x, b.mesh.position.y, b.mesh.position.z)
          ) {
            spawnExplosion(b.mesh.position.clone(), true)
            refs.scene.remove(b.mesh)
            b.mesh.geometry.dispose()
            refs.bullets.splice(i, 1)
            continue
          }
          // Enemy bullet hits player. Skipped for grenades — they damage
          // via the AOE detonation, not direct contact (avoids the toss
          // being eaten mid-arc if it brushes the player).
          if (b.isEnemy && !b.isGrenade && b.life > 0) {
            const dx = b.mesh.position.x - refs.focalPoint.x
            const dy = b.mesh.position.y - EYE_HEIGHT
            const dz = b.mesh.position.z - refs.focalPoint.z
            // Riding presents a bigger target (the vehicle body) than a person.
            const riding = drivingRef.current && activeVehicle !== null
            const hitR = riding ? VEHICLE_RADIUS : 0.5
            if (Math.sqrt(dx * dx + dy * dy + dz * dz) < hitR) {
              refs.scene.remove(b.mesh)
              b.mesh.geometry.dispose()
              refs.bullets.splice(i, 1)
              if (gamePhaseRef.current === "playing" && Date.now() > spawnInvulnUntilRef.current) {
                if (riding) {
                  damageActiveVehicle(b.damage) // vehicle soaks it (player shielded)
                } else {
                  playerHpRef.current = Math.max(0, playerHpRef.current - aaShield(b.damage))
                  setPlayerHp(playerHpRef.current)
                  lastDamageTimeRef.current = Date.now()
                  cameraShakeRef.current.intensity = 2
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
              }
              continue
            }
          }
          if (b.life <= 0) {
            // Fuse-expired grenade air-bursts (covers the rare "stays
            // airborne the whole fuse" case — apartment-balcony-trajectory).
            if (b.isGrenade) {
              detonateGrenade(
                b.mesh.position.clone(),
                b.grenadeRadius ?? 4,
                b.isEnemy,
                b.isAntiTankGrenade ?? false,
              )
            } else if (!b.isEnemy) {
              spawnExplosion(b.mesh.position.clone(), true)
            }
            refs.scene.remove(b.mesh)
            b.mesh.geometry.dispose()
            refs.bullets.splice(i, 1)
          }
        }

        // ── Chimney smoke (industrial district) ────────────────────────────
        // Fixed pool: each puff rises from its chimney, expands + fades, loops.
        // Updated only every 3rd frame to save CPU; the banked dt keeps the
        // rise rate constant regardless of how many frames we skipped.
        smokeAccumDt += dt
        if (frameCount % 3 === 0) {
          const sdt = smokeAccumDt
          smokeAccumDt = 0
          for (const puff of smokePuffs) {
            puff.t += sdt * 0.16
            if (puff.t > 1) puff.t -= 1
            const tt = puff.t
            puff.mesh.position.set(
              puff.baseX + Math.sin(tt * 3.1) * 0.7,
              puff.baseY + tt * puff.rise,
              puff.baseZ + Math.cos(tt * 2.3) * 0.5,
            )
            puff.mesh.scale.setScalar(0.5 + tt * 1.9)
            ;(puff.mesh.material as THREE.MeshLambertMaterial).opacity = 0.45 * (1 - tt)
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
          // ── Elevator-chase setup (PR-C) ──────────────────────────────────
          // Find the tower deck the player is currently standing on (matching
          // a climb zone by altitude + horizontal proximity to its top), and
          // count how many enemies are already committed to a lift, so we can
          // send a couple more up after them without jamming the elevator.
          let playerRoofZone: ClimbZone | null = null
          if (fp.y > PLAYER_ROOF_MIN_Y) {
            let bestD = 81 // (9m)² — within deck radius + margin
            for (const zone of refs.climbZones) {
              if (Math.abs(fp.y - zone.targetY) > 1.5) continue
              const tx = zone.topX ?? (zone.x1 + zone.x2) / 2
              const tz = zone.topZ ?? (zone.z1 + zone.z2) / 2
              const d = (tx - fp.x) ** 2 + (tz - fp.z) ** 2
              if (d < bestD) {
                bestD = d
                playerRoofZone = zone
              }
            }
          }
          let elevatorCommits = 0
          for (const e of refs.enemies) if (e.climb) elevatorCommits++
          for (const enemy of refs.enemies) {
            // Skip enemies currently driving a vehicle — updateEnemyVehicle
            // owns them (their mesh is hidden + parked at the vehicle). On
            // death the vehicle clears aiDriving so the corpse anim runs here.
            if (enemy.aiDriving) continue
            // Respawn dead enemies (with death animation)
            if (enemy.hp <= 0) {
              if (enemy.dyingTimer >= 0) {
                // Death animation timeline:
                //   t∈[0, FALL]:        knees buckle, body rotates to prone.
                //   t∈[FALL, FALL+LIE]: corpse lies still on the ground.
                //   final FADE seconds: opacity fades to 0, then mesh hides.
                enemy.dyingTimer -= dt
                // First dying frame: record any rooftop altitude so the corpse
                // tumbles off the deck to the ground (rooftop "shot off" kill).
                // Also release any in-progress elevator state.
                if (enemy.fallFromY === undefined) {
                  enemy.fallFromY = enemy.mesh.position.y > 3 ? enemy.mesh.position.y : 0
                  enemy.climb = null
                  // Shot off a bike → fall off; the riderless bike halts.
                  if (enemy.riding) dismountRider(enemy)
                }
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
                if (enemy.fallFromY && enemy.fallFromY > 0.5) {
                  // Rooftop kill: tumble off the deck, accelerating downward to
                  // the ground (gravity-like ease-in) with an extra somersault.
                  const fallP = Math.min(1, tElapsed / (DEATH_ANIM_FALL * 1.4))
                  enemy.mesh.position.y = Math.max(0, enemy.fallFromY * (1 - fallP * fallP))
                  enemy.mesh.rotation.x = enemy.deathFallDir * tilt + fallP * Math.PI * 1.2
                  if (enemy.mesh.position.y <= 0.0001) enemy.fallFromY = 0
                } else {
                  enemy.mesh.rotation.x = enemy.deathFallDir * tilt
                  // Lift the root slightly as it lies flat so the prone torso
                  // rests *on* the ground rather than half-buried in it.
                  enemy.mesh.position.y = Math.sin(tilt) * 0.18
                }
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
                  const rx = Math.max(
                    WORLD_MIN + 3,
                    Math.min(WORLD_MAX - 3, sp.x + (Math.random() - 0.5) * 4),
                  )
                  const rz = Math.max(
                    WORLD_MIN + 3,
                    Math.min(WORLD_MAX - 3, sp.z + (Math.random() - 0.5) * 4),
                  )
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
                  // Clear rooftop fall / elevator state for the fresh life.
                  enemy.fallFromY = undefined
                  enemy.climb = null
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

            // ── PR motorcycle: terraformer bike-charge ───────────────────────
            // Riders are driven by updateBikeRiders — skip their on-foot AI.
            if (enemy.riding) continue
            // A terraformer with the player far off peels away to grab a free
            // bike (WALK → RIDE). If the player closes in, abandon the claim
            // and fight on foot.
            if (enemy.type === "terraformer") {
              if (distToPlayer > BIKE_PLAYER_FAR) {
                if (tryTerraformerSeekBike(enemy, dt)) continue
              } else {
                dismountRider(enemy) // release any claimed-but-unmounted bike
              }
            }

            // ── Elevator chase (PR-C) ────────────────────────────────────────
            // Already committed to a lift? The FSM owns approach/riding/descend
            // (skip the normal AI). The "roof" phase returns false and falls
            // through so the standard combat AI fights at deck altitude. If the
            // player has left this rooftop, ride back down.
            if (enemy.climb) {
              const playerGone = !playerRoofZone || playerRoofZone !== enemy.climb.zone
              if (playerGone && enemy.climb.mode === "approach") {
                // Player left before we boarded — abort and resume normal AI.
                enemy.climb = null
              } else {
                if (playerGone && enemy.climb.mode === "roof") {
                  enemy.climb.mode = "descending"
                  enemy.climb.t = 0
                }
                if (updateEnemyClimb(enemy, dt)) continue
                // else: roof phase — fall through to the normal AI below.
              }
            } else if (
              playerRoofZone &&
              !isMeleeChaser(enemy.type) &&
              elevatorCommits < MAX_ELEVATOR_COMMIT
            ) {
              // Commit nearby grounded enemies to chase up the elevator.
              const bx = playerRoofZone.baseX ?? (playerRoofZone.x1 + playerRoofZone.x2) / 2
              const bz = playerRoofZone.baseZ ?? (playerRoofZone.z1 + playerRoofZone.z2) / 2
              if (Math.hypot(bx - ex, bz - ez) < ELEVATOR_CHASE_RANGE) {
                enemy.climb = { mode: "approach", zone: playerRoofZone, t: 0 }
                elevatorCommits++
                continue
              }
            }

            // ── Pre-state-machine: read difficulty tuning + sensory input ─
            // Mission enemies have no botDifficulty selector → fall back to
            // the "normal" aggressive profile.
            const tuning: BotDifficultyTuning = enemy.aiTuning ?? MISSION_AI_TUNING
            // Bots bake reactMult into their cloned config.fireInterval at
            // spawn, so re-applying it here would double-count. Mission/wave
            // enemies share the base ENEMY_CONFIGS, so they instead pick up
            // the faster reaction (reactMult) at fire time via this multiplier.
            const fireCadenceMult = enemy.isBot ? 1 : tuning.reactMult

            // Hide overhead "!"/"?" marker once its time-window expires.
            if (enemy.markerKind && now > enemy.markerUntil) {
              setEnemyMarker(enemy, null, 0)
            }

            // Noise alert: if the player fired/exploded recently within
            // `noiseRange`, a patrolling enemy commits to a search at the
            // noise origin. Already-alert/attacking enemies ignore this
            // (they have better info — direct LOS).
            const noise = lastNoiseRef.current
            if (
              noise &&
              now < noise.expires &&
              enemy.state === "patrol" &&
              Math.hypot(noise.x - ex, noise.z - ez) < tuning.noiseRange
            ) {
              enemy.state = "search"
              enemy.searchTimer = 5.5
              enemy.lastSeenPlayer = { x: noise.x, z: noise.z }
              setEnemyMarker(enemy, "search", 5500)
            }

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
                  const enemyFeetY = enemy.climb?.mode === "roof" ? enemy.mesh.position.y : 0
                  if (!collidesWithWall(nx, ez, ENEMY_RADIUS, enemyFeetY))
                    enemy.mesh.position.x = nx
                  if (!collidesWithWall(ex, nz, ENEMY_RADIUS, enemyFeetY))
                    enemy.mesh.position.z = nz
                  enemy.facing.set(wpDx / wpDist, 0, wpDz / wpDist)
                }
              }
              if (
                enemyCanSee(enemy.facing.x, enemy.facing.z, toPx, toPz, distToPlayer, enemy.config)
              ) {
                enemy.state = "alert"
                enemy.lastSeenPlayer = { x: fp.x, z: fp.z }
                // Overhead "!" sting (COD-style spot indicator).
                setEnemyMarker(enemy, "alert", 800)
                // Group tactics: this enemy spotted the player — broadcast
                // the position to nearby allies so they converge from their
                // own flanks instead of needing to see independently.
                if (tuning.groupTactics) {
                  for (const ally of refs.enemies) {
                    if (ally === enemy || ally.hp <= 0) continue
                    const allyDist = Math.hypot(
                      ally.mesh.position.x - ex,
                      ally.mesh.position.z - ez,
                    )
                    if (allyDist < 20 && ally.state === "patrol") {
                      ally.state = "search"
                      ally.searchTimer = 6.0
                      ally.lastSeenPlayer = { x: fp.x, z: fp.z }
                      setEnemyMarker(ally, "search", 6000)
                    }
                  }
                }
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
              // Melee chasers manage their own last-seen tracking (LOS-gated)
              // inside moveZombieAlert; everyone else remembers the live position.
              if (!isMeleeChaser(enemy.type)) enemy.lastSeenPlayer = { x: fp.x, z: fp.z }
              if (
                distToPlayer <= enemy.config.attackRange &&
                Math.abs(enemy.mesh.position.y - fp.y) < 2.5
              ) {
                enemy.state = "attack"
              } else if (isMeleeChaser(enemy.type)) {
                moveZombieAlert(enemy, ex, ez, toPx, toPz, distToPlayer, dt, now)
              } else {
                // Flank offset: aim toward a point perpendicular to the
                // bee-line so different enemies arc around the player from
                // different sides. Magnitude scales with distance (more
                // arcing while far, straight push when close).
                const perpX = -toPz / Math.max(0.001, distToPlayer)
                const perpZ = toPx / Math.max(0.001, distToPlayer)
                const flankScale =
                  tuning.flankFactor *
                  enemy.flankStrength *
                  enemy.flankSide *
                  Math.min(8, distToPlayer * 0.5)
                const targetX = fp.x + perpX * flankScale
                const targetZ = fp.z + perpZ * flankScale
                const tx = targetX - ex
                const tz = targetZ - ez
                const tDist = Math.max(0.001, Math.hypot(tx, tz))

                // Grunt close-range dash: every ~3s, decide whether to
                // sprint at the player (1.6x speed for 1.4s) if we're at
                // medium-close range. The actual dash cycle is bounded so
                // bots don't permanently sprint into the player's gun.
                // Dash-check cadence halved (3000→1500ms) so grunts break
                // cover and push the player roughly twice as often — the
                // NEXT_STEPS "敵がトロい" fix. EASY never reaches here
                // (dashEnabled=false), so the tutorial pace is unchanged.
                if (tuning.dashEnabled && enemy.type === "grunt" && now > enemy.nextDashCheckTime) {
                  enemy.nextDashCheckTime = now + 1500
                  if (distToPlayer > 3 && distToPlayer < 14 && Math.random() < 0.55) {
                    enemy.dashUntil = now + 1400
                  }
                }
                const dashing = now < enemy.dashUntil
                const dashMult = dashing ? 1.6 : 1.0

                // Cover AI: stop *only* when actually behind cover that
                // breaks LOS to the player. Previously any nearby AABB
                // counted as cover, which made enemies stall in the open.
                const losClear = enemyCanSee(
                  toPx / distToPlayer,
                  toPz / distToPlayer,
                  toPx,
                  toPz,
                  distToPlayer,
                  enemy.config,
                )
                const shouldPushIn = !losClear || distToPlayer > enemy.config.fireRange || dashing

                if (shouldPushIn) {
                  const spd = enemy.config.speed * tuning.speedMult * dashMult * dt
                  const nx = ex + (tx / tDist) * spd
                  const nz = ez + (tz / tDist) * spd
                  const enemyFeetY = enemy.climb?.mode === "roof" ? enemy.mesh.position.y : 0
                  if (!collidesWithWall(nx, ez, ENEMY_RADIUS, enemyFeetY))
                    enemy.mesh.position.x = nx
                  if (!collidesWithWall(ex, nz, ENEMY_RADIUS, enemyFeetY))
                    enemy.mesh.position.z = nz
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
                  enemy.searchTimer = 4.5
                  setEnemyMarker(enemy, "search", 4500)
                }
              }
              // Heavy grenade throw: parabolic toss toward where the player
              // *will be* in ~1s. Only fires when LOS is clear and the
              // player is at mid-range (too close = friendly-fire risk; too
              // far = arc gets weird).
              // Anti-tank behaviour: against a player riding a vehicle the
              // heavy prioritises grenades — wider engagement range and a much
              // shorter cooldown so the tank takes real anti-armor pressure.
              const vsVehicle = drivingRef.current && activeVehicle !== null
              if (
                tuning.grenadeEnabled &&
                enemy.type === "heavy" &&
                now > enemy.nextGrenadeTime &&
                distToPlayer > 5 &&
                distToPlayer < (vsVehicle ? 32 : 22) &&
                enemyCanSee(
                  toPx / distToPlayer,
                  toPz / distToPlayer,
                  toPx,
                  toPz,
                  distToPlayer,
                  enemy.config,
                )
              ) {
                enemy.nextGrenadeTime = vsVehicle
                  ? now + 2500 + Math.random() * 1500
                  : now + 6000 + Math.random() * 3000
                // Lead the player by their current velocity (approx via the
                // smoothed player velocity ref).
                const leadT = 1.0
                const aimX = fp.x + playerVelRef.current.x * leadT - ex
                const aimZ = fp.z + playerVelRef.current.z * leadT - ez
                const aimDist = Math.max(0.001, Math.hypot(aimX, aimZ))
                // Solve for a velocity that lands roughly at aim distance
                // with a fixed ~1.0s air time under -12 gravity.
                const SPEED_H = aimDist / leadT
                const upInitial = 12 * leadT * 0.5 + 1.2 // small extra arc
                const gGeo = new THREE.SphereGeometry(0.14, 8, 6)
                const gMat = new THREE.MeshBasicMaterial({ color: 0x556633 })
                const gMesh = new THREE.Mesh(gGeo, gMat)
                gMesh.position.set(enemy.mesh.position.x, EYE_HEIGHT * 0.85, enemy.mesh.position.z)
                refs.scene.add(gMesh)
                refs.bullets.push({
                  mesh: gMesh,
                  velocity: new THREE.Vector3(
                    (aimX / aimDist) * SPEED_H,
                    upInitial,
                    (aimZ / aimDist) * SPEED_H,
                  ),
                  life: leadT + 0.8,
                  isEnemy: true,
                  damage: 0, // damage comes from the AOE on detonation
                  isGrenade: true,
                  grenadeRadius: 4.5,
                  isAntiTankGrenade: true, // heavy anti-tank nade → 3x vs tank
                })
              }
              // Shoot while chasing (alert range fire)
              if (
                distToPlayer <= enemy.config.fireRange &&
                now - enemy.lastFireTime > enemy.config.fireInterval * 1.5 * fireCadenceMult
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
                Date.now() > spawnInvulnUntilRef.current &&
                // Don't let a melee swing land through a wall — require an
                // unobstructed torso-height line from the enemy to the player.
                !wallBetween(enemy.mesh.position.x, enemy.mesh.position.z, fp.x, fp.z) &&
                // …nor through a floor: the attacker must be on the player's
                // level (stops zombies hitting a player up on a roof/ledge).
                Math.abs(enemy.mesh.position.y - fp.y) < 2.5
              ) {
                enemy.lastAttackTime = now
                // Visible melee swing (right arm) — same knife-style motion
                // for grunts/heavies/zombies whenever they land a close hit.
                enemy.meleeAnimUntil = now + 300
                if (drivingRef.current && activeVehicle) {
                  // Clawing the vehicle chips its HP, not the shielded driver.
                  damageActiveVehicle(enemy.config.attackDamage)
                } else {
                  playerHpRef.current = Math.max(
                    0,
                    playerHpRef.current - aaShield(enemy.config.attackDamage),
                  )
                  setPlayerHp(playerHpRef.current)
                  lastDamageTimeRef.current = Date.now()
                  cameraShakeRef.current.intensity = 2
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
              }
              // Enemy ranged fire
              if (
                distToPlayer <= enemy.config.fireRange &&
                now - enemy.lastFireTime > enemy.config.fireInterval * fireCadenceMult
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
            } else if (enemy.state === "search" && isMeleeChaser(enemy.type)) {
              // Zombie search: shamble around the last-known spot hunting for
              // prey. Re-locks the instant the player reappears, and never
              // truly gives up — it loops back to the hunt when the timer ends.
              enemy.searchTimer -= dt
              const reSee =
                distToPlayer < enemy.config.sightRange && !zombieLosBlocked(ex, ez, fp.x, fp.z)
              if (reSee) {
                enemy.state = "alert"
                enemy.lastSeenPlayer = { x: fp.x, z: fp.z }
                setEnemyMarker(enemy, "alert", 800)
              } else if (enemy.searchTimer <= 0) {
                enemy.state = "alert" // resume relentless pursuit toward last-seen
              } else {
                const cx = enemy.lastSeenPlayer?.x ?? ex
                const cz = enemy.lastSeenPlayer?.z ?? ez
                const wanderX = cx + Math.sin(now * 0.001 + enemy.microIdleSeed) * 4
                const wanderZ = cz + Math.cos(now * 0.0013 + enemy.microIdleSeed) * 4
                const dir = zombieSteer(enemy, ex, ez, wanderX - ex, wanderZ - ez, now)
                const spd = enemy.config.speed * 0.5 * dt
                const nx = ex + dir.x * spd
                const nz = ez + dir.z * spd
                const enemyFeetY = enemy.climb?.mode === "roof" ? enemy.mesh.position.y : 0
                if (!collidesWithWall(nx, ez, ENEMY_RADIUS, enemyFeetY)) enemy.mesh.position.x = nx
                if (!collidesWithWall(ex, nz, ENEMY_RADIUS, enemyFeetY)) enemy.mesh.position.z = nz
                enemy.facing.set(dir.x, 0, dir.z)
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
                  const enemyFeetY = enemy.climb?.mode === "roof" ? enemy.mesh.position.y : 0
                  if (!collidesWithWall(nx, ez, ENEMY_RADIUS, enemyFeetY))
                    enemy.mesh.position.x = nx
                  if (!collidesWithWall(ex, nz, ENEMY_RADIUS, enemyFeetY))
                    enemy.mesh.position.z = nz
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
                // Search → alert: replace the "?" with an "!" sting.
                setEnemyMarker(enemy, "alert", 800)
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
              // Zombies lurch unevenly — a slow swell plus a fast jitter on the
              // stride cadence so the shamble speeds up and stutters, never the
              // metronome march the soldiers walk.
              const zLurch =
                enemy.type === "zombie"
                  ? 0.55 +
                    0.7 * (0.5 + 0.5 * Math.sin(now * 0.004 + enemy.microIdleSeed)) +
                    0.3 * Math.sin(now * 0.028 + enemy.microIdleSeed * 2.3)
                  : 1
              enemy.animTime += dt * 5 * cadenceMult * speedRatio * zLurch
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

            // Zombie shamble: hunched hard forward, twitching. Overrides the
            // rifle-aim pose (zombies are unarmed). Per-zombie carriage — about
            // half claw both arms forward for prey, half let them dangle and
            // swing limp — plus a fast spasm twitch layered on the slow sway.
            if (enemy.type === "zombie") {
              const seed = enemy.microIdleSeed
              const twitch = Math.sin(now * 0.033 + seed * 3.1) * 0.06
              const zsw = Math.sin(t) * 0.22 + twitch
              tgtTorsoPitchX = 0.42 + Math.sin(now * 0.006 + seed) * 0.06 // heaving hunch
              if ((seed | 0) % 2 === 0) {
                tgtLeftShoulder = -1.45 + zsw
                tgtRightShoulder = -1.45 - zsw
                tgtLeftElbow = -0.3 + twitch
                tgtRightElbow = -0.3 - twitch
              } else {
                tgtLeftShoulder = -0.12 + zsw * 1.5
                tgtRightShoulder = -0.12 - zsw * 1.5
                tgtLeftElbow = -0.55
                tgtRightElbow = -0.55
              }
            }

            // Terraformer charge: hulking forward-lean, big raised claws ready
            // to swipe, powerful arm pump synced to the stride. Reads as a
            // bearing-down monster rather than a shambling corpse.
            if (enemy.type === "terraformer") {
              const sw = Math.sin(t) * 0.5
              // Heavier forward hunch — it drags itself toward you.
              tgtTorsoPitchX = 0.52 + Math.sin(now * 0.007 + enemy.microIdleSeed) * 0.06
              tgtLeftShoulder = -1.7 + sw
              tgtRightShoulder = -1.7 - sw
              tgtLeftElbow = -1.1 - Math.max(0, sw) * 0.4
              tgtRightElbow = -1.1 - Math.max(0, -sw) * 0.4
              // Asymmetric stride: the trailing leg drags (lower amplitude,
              // bent knee) so the gait looks lopsided and wrong.
              tgtLeftHip = -sw * 0.6
              tgtRightHip = sw * 0.35 - 0.18
            }

            // Melee swing: when an enemy has just landed a close-range hit, whip
            // the right arm down (knife-style) over the ~300ms window. Applied
            // after the per-state pose so it reads on grunts, heavies, zombies.
            if (now < enemy.meleeAnimUntil) {
              const swingProg = 1 - (enemy.meleeAnimUntil - now) / 300
              const swingArc = Math.sin(Math.max(0, Math.min(1, swingProg)) * Math.PI)
              tgtRightShoulder = -1.9 + swingArc * 1.6
              tgtRightElbow = -0.2 - swingArc * 0.4
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
            // Zombies + terraformers never blink — a fixed dead stare.
            const tgtEyeOpen = isMeleeChaser(enemy.type) ? 1 : enemy.blinkActive > 0 ? 0.08 : 1

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
              // Zombies cock their head at an unsettling angle — a slow roll
              // plus an occasional sharper crick. Non-zombies keep it level.
              if (enemy.type === "zombie") {
                const s = enemy.microIdleSeed
                const crick = Math.sin(now * 0.0007 + s * 1.7) > 0.86 ? 0.5 : 0
                enemy.head.rotation.z = Math.sin(now * 0.0011 + s) * 0.16 + crick
              }
            }
            // Jaw chomp: zombies gnash continuously, snapping wider mid-lunge.
            if (enemy.jaw && enemy.type === "zombie") {
              const chomping = now < enemy.meleeAnimUntil || distToPlayer < 3.5
              const chomp =
                (Math.sin(now * (chomping ? 0.02 : 0.008) + enemy.microIdleSeed) + 1) * 0.5
              enemy.jaw.rotation.x = (chomping ? 0.55 : 0.2) * chomp
            }
            if (enemy.leftEye) enemy.leftEye.scale.y = p.eyeOpenness
            if (enemy.rightEye) enemy.rightEye.scale.y = p.eyeOpenness

            // ── Terraformer writhe ─────────────────────────────────────────
            // Out-of-phase body swell, individually throbbing pustules, jerky
            // head twitches/tilts, and a flickering eye glow. All driven off
            // `now` + per-enemy phases so a swarm never moves in lockstep.
            if (enemy.type === "terraformer") {
              const ph = enemy.pulsePhase ?? 0
              const pulse = Math.sin(now * 0.004 + ph) * 0.05
              if (enemy.torso) {
                enemy.torso.scale.x = 1 + pulse
                enemy.torso.scale.z = 1 + pulse
                enemy.torso.scale.y = (1 + p.torsoBreath) * (1 + pulse * 0.6)
              }
              if (enemy.pustules) {
                for (let pi = 0; pi < enemy.pustules.length; pi++) {
                  const pm = enemy.pustules[pi]
                  if (!pm) continue
                  const base = pm.userData.pustuleBase as number
                  pm.scale.setScalar(base * (1 + Math.sin(now * 0.006 + ph + pi * 1.3) * 0.22))
                }
              }
              if (enemy.head) {
                const tw = enemy.twitchPhase ?? 0
                const jerk = Math.sin(now * 0.0009 + tw) > 0.9 ? 0.32 : 0
                enemy.head.rotation.y += Math.sin(now * 0.05 + tw) * 0.04 + jerk
                enemy.head.rotation.z = Math.sin(now * 0.0017 + tw) * 0.2 + jerk * 0.5
              }
              if (enemy.eyeGlowMat) {
                enemy.eyeGlowMat.emissiveIntensity = 2.0 + Math.sin(now * 0.008 + ph) * 1.1
              }
            }
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

        // ── Aimed enemy detection (crosshair highlight) ─────────────────
        // Runs every 4 frames (~15Hz) — purely UI feedback, not gameplay
        // critical, and the old per-frame "filter + traverse-every-enemy-
        // skeleton + raycast against ~20*N parts" was the single most
        // expensive thing in the loop. Also skipped on mobile (no
        // crosshair shown there).
        if (!isMobile && frameCount % 4 === 0) {
          pointer.set(0, 0)
          raycaster.setFromCamera(pointer, camera)
          const aimParts: THREE.Object3D[] = []
          for (const e of refs.enemies) {
            if (e.hp <= 0 || e.aiDriving) continue
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

        // ── Invasion mode control: rocket strikes + terraformer waves ──────
        if (modeRef.current === "invasion" && gamePhaseRef.current === "playing") {
          updateRocketStrikes(dt)
          // Boss dust + poison pools are pure VFX → half-rate on mobile (the
          // boss AI itself, updateBigBoss, still runs every frame below).
          if (!isMobileDevice || (frameCount & 1) === 0) {
            const fdt = isMobileDevice ? dt * 2 : dt
            updateBossDust(fdt)
            updateBossPools(fdt)
          }
          if (bigBossRef.current) {
            // Boss is the whole encounter — normal waves are suspended.
            updateBigBoss(dt)
          } else if (bossPendingAtRef.current > 0) {
            // 15s alarm interval before the boss drops in.
            if (Date.now() >= bossPendingAtRef.current) {
              bossPendingAtRef.current = 0
              spawnBigBoss()
            }
          } else {
            const waveActive =
              rocketStrikes.length > 0 ||
              refs.enemies.some((e) => e.type === "terraformer" && (e.hp > 0 || e.dyingTimer >= 0))
            if (waveActive) {
              invasionActiveRef.current = true
            } else {
              if (invasionActiveRef.current) {
                // Wave just cleared → breathe, then the next rocket comes.
                invasionActiveRef.current = false
                invasionNextStrikeRef.current = Date.now() + 7000
                // Wave 5 down → schedule the final boss (after a 15s alarm lull).
                if (invasionWaveRef.current >= 5 && !bossDoneRef.current) {
                  bossPendingAtRef.current = Date.now() + 15000
                  SOUNDS.alert()
                  setWaveMessage("WAVE 5 制圧 — 最終ボス接近中…")
                  setTimeout(() => {
                    if (gamePhaseRef.current === "playing") setWaveMessage(null)
                  }, 4000)
                }
              }
              if (
                invasionWaveRef.current < 5 &&
                bossPendingAtRef.current === 0 &&
                Date.now() > invasionNextStrikeRef.current
              ) {
                const next = invasionWaveRef.current + 1
                invasionWaveRef.current = next
                setCurrentWave(next)
                setWaveMessage(`INVASION WAVE ${next} / 5`)
                setTimeout(() => {
                  if (gamePhaseRef.current === "playing") setWaveMessage(null)
                }, 2500)
                const tx = Math.max(
                  6,
                  Math.min(MAP_SIZE - 6, refs.focalPoint.x + (Math.random() - 0.5) * 24),
                )
                const tz = Math.max(
                  6,
                  Math.min(MAP_SIZE - 6, refs.focalPoint.z + (Math.random() - 0.5) * 24),
                )
                triggerRocketStrike(tx, tz, next)
                invasionNextStrikeRef.current = Number.MAX_SAFE_INTEGER // until cleared
              }
            }
          }
        }

        // ── Zombie mode wave control ───────────────────────────────────────
        // Endless: when the current wave is fully cleared, after a short lull
        // spawn the next (larger, faster) wave. Runs independently of the
        // mission "wave" flow so it never touches Wave Defense behaviour.
        if (
          modeRef.current === "zombie" &&
          zombieActiveRef.current &&
          gamePhaseRef.current === "playing"
        ) {
          const allDead = refs.enemies.every((e) => e.hp <= 0 && e.dyingTimer < 0)
          if (allDead) {
            zombieActiveRef.current = false
            const next = zombieWaveRef.current + 1
            zombieWaveRef.current = next
            setCurrentWave(next)
            setWaveMessage(`WAVE ${next} — ゾンビ接近中`)
            setTimeout(() => {
              if (gamePhaseRef.current !== "playing") return
              setWaveMessage(null)
              spawnZombieWave(next)
              zombieActiveRef.current = true
            }, 3500)
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

        // Minimap — redraw every 4 frames (~15Hz). Player movement is
        // smooth in 3D; the corner minimap doesn't need 60Hz canvas
        // repaints, and the wall/enemy/player draws cost real time.
        // ── District banner ────────────────────────────────────────────────
        // Fire the GTA-style area name whenever the player crosses into a new
        // district (and once on spawn, since areaRef starts null). It fades in
        // via the key change, then auto-hides after a few seconds.
        {
          const area = areaForPos(refs.focalPoint.z)
          if (area !== areaRef.current) {
            areaRef.current = area
            areaKeyRef.current += 1
            setAreaBanner({ id: area, key: areaKeyRef.current })
            setAreaBannerVisible(true)
            if (areaHideTimerRef.current) clearTimeout(areaHideTimerRef.current)
            areaHideTimerRef.current = setTimeout(() => setAreaBannerVisible(false), 3200)
          }
        }

        const mcanvas = minimapRef.current
        // Redraw the minimap at most every 100ms (frame-rate independent) — the
        // canvas 2D work is wasted at full frame rate and costly on mobile.
        const nowMs = Date.now()
        if (mcanvas && nowMs - lastMinimapAt >= 100) {
          lastMinimapAt = nowMs
          const ctx = mcanvas.getContext("2d")
          if (ctx) {
            // ── Local (player-centered) minimap ───────────────────────────
            // The world is now 600×600 — far too large to show whole. Instead
            // the minimap is a moving window centered on the player: VIEW world
            // units span the canvas, player fixed at the center, north = up.
            const W = mcanvas.width
            // SKY zooms the minimap out to an aviation-radar scale so the whole
            // dogfight (jets spread over hundreds of metres) fits the dial.
            // HUNT radar: zoom the minimap out so the whole arena (all enemies)
            // is always visible (the controller-style radar from step 4).
            const VIEW = isSky || modeRef.current === "hunt" ? 520 : 96
            const SCALE = W / VIEW
            const px = refs.focalPoint.x
            const pz = refs.focalPoint.z
            // World → canvas (player at center). Returns pixel coords.
            const mx = (wx: number) => (wx - px) * SCALE + W / 2
            const mz = (wz: number) => (wz - pz) * SCALE + W / 2
            const inView = (cx: number, cz: number, pad = 6) =>
              cx >= -pad && cx <= W + pad && cz >= -pad && cz <= W + pad

            // Base + district tint. Fill the three z-bands (INDUSTRIAL north /
            // CITY center / HARBOR south) so the player can read which area
            // surrounds them as they move.
            ctx.fillStyle = "#15171a"
            ctx.fillRect(0, 0, W, W)
            const nEdge = mz(AREA_NORTH_EDGE)
            const sEdge = mz(AREA_SOUTH_EDGE)
            ctx.fillStyle = "#24262c" // INDUSTRIAL band (north / top)
            ctx.fillRect(0, 0, W, Math.max(0, Math.min(W, nEdge)))
            ctx.fillStyle = "#2c3a2a" // CITY band (center)
            ctx.fillRect(0, Math.max(0, nEdge), W, Math.max(0, sEdge - nEdge))
            ctx.fillStyle = "#1f2a30" // HARBOR band (south / bottom)
            ctx.fillRect(0, Math.max(0, Math.min(W, sEdge)), W, W)

            // Roads — grey strips for the N–S / E–W arterials in view.
            ctx.fillStyle = "#3a3d42"
            const roadPx = ROAD_W * SCALE
            for (const c of V_ROADS) {
              const x = mx(c)
              if (x > -roadPx && x < W + roadPx) ctx.fillRect(x - roadPx / 2, 0, roadPx, W)
            }
            for (const c of H_ROADS) {
              const z = mz(c)
              if (z > -roadPx && z < W + roadPx) ctx.fillRect(0, z - roadPx / 2, W, roadPx)
            }

            // Buildings — only AABBs within the view window. Big footprints get
            // a brighter building fill so the city silhouette reads; small
            // props are skipped to keep the local map legible.
            for (const wAabb of ALL_AABBS) {
              const cx1 = mx(wAabb.x1)
              const cz1 = mz(wAabb.z1)
              const ww = (wAabb.x2 - wAabb.x1) * SCALE
              const wd = (wAabb.z2 - wAabb.z1) * SCALE
              if (!inView(cx1 + ww / 2, cz1 + wd / 2, Math.max(ww, wd))) continue
              const area = (wAabb.x2 - wAabb.x1) * (wAabb.z2 - wAabb.z1)
              if (area > 8) ctx.fillStyle = "#6a6a55"
              else if (area > 1.5) ctx.fillStyle = "#55534a"
              else continue
              ctx.fillRect(cx1, cz1, Math.max(1, ww), Math.max(1, wd))
            }
            // Goal markers
            for (const marker of refs.goalMarkers) {
              if (marker.collected) continue
              const cx = mx(marker.x)
              const cz = mz(marker.z)
              if (!inView(cx, cz)) continue
              ctx.fillStyle = "#00ff88"
              ctx.beginPath()
              ctx.arc(cx, cz, 4, 0, Math.PI * 2)
              ctx.fill()
            }
            // Doors (green ▲) and ladders/elevators (yellow square). Doors are
            // drawn only when in view (there are many). Ladders/elevators are
            // the key navigational landmarks, so an off-screen one is *clamped*
            // to the minimap's circular edge (GTA-style) — the player can always
            // see which way to head for the nearest elevator. Before PR-A the
            // whole-map minimap showed every elevator at once; the local window
            // hid distant ones, which is what made the elevators feel "gone".
            const EDGE_R = W / 2 - 5
            for (const ent of refs.entries) {
              const ex = mx(ent.x)
              const ez = mz(ent.z)
              if (ent.kind === "door") {
                if (!inView(ex, ez)) continue
                ctx.fillStyle = "#44ff88"
                ctx.strokeStyle = "rgba(0,0,0,0.85)"
                ctx.lineWidth = 1
                ctx.beginPath()
                ctx.moveTo(ex, ez - 4)
                ctx.lineTo(ex + 3.4, ez + 2.5)
                ctx.lineTo(ex - 3.4, ez + 2.5)
                ctx.closePath()
                ctx.fill()
                ctx.stroke()
              } else {
                // Ladder / elevator. Clamp to the circular edge when off-screen.
                const dx = ex - W / 2
                const dz = ez - W / 2
                const dist = Math.hypot(dx, dz)
                const clamped = dist > EDGE_R
                const lx = clamped ? W / 2 + (dx / dist) * EDGE_R : ex
                const lz = clamped ? W / 2 + (dz / dist) * EDGE_R : ez
                ctx.fillStyle = "#ffcc22"
                ctx.strokeStyle = "rgba(0,0,0,0.85)"
                ctx.lineWidth = 1
                const s = clamped ? 2 : 3 // edge pips are a touch smaller
                ctx.fillRect(lx - s, lz - s, s * 2, s * 2)
                ctx.strokeRect(lx - s, lz - s, s * 2, s * 2)
                if (!clamped) {
                  ctx.fillStyle = "rgba(0,0,0,0.6)"
                  ctx.fillRect(lx - 2, lz - 1, 4, 1)
                  ctx.fillRect(lx - 2, lz + 1, 4, 1)
                }
              }
            }
            // Vehicles — cyan squares (occupied/enemy ones go orange-red; a
            // terraformer-ridden bike flashes bright red).
            for (const v of vehicles) {
              if (v.dead) continue
              const cx = mx(v.x)
              const cz = mz(v.z)
              if (!inView(cx, cz)) continue
              ctx.fillStyle = v.riderEnemy ? "#ff3344" : v.aiDriver ? "#ff7733" : "#33d6ff"
              ctx.fillRect(cx - 2, cz - 2, 4, 4)
            }
            // Draw enemies on minimap (color by type/state)
            for (const enemy of refs.enemies) {
              if (enemy.hp <= 0) continue
              const cx = mx(enemy.mesh.position.x)
              const cz = mz(enemy.mesh.position.z)
              if (!inView(cx, cz)) continue
              // HUNT radar: bosses are a big red triangle, minions small red dots.
              if (modeRef.current === "hunt") {
                ctx.fillStyle = "#ff2a2a"
                if (enemy.isHuntBoss) {
                  ctx.beginPath()
                  ctx.moveTo(cx, cz - 6)
                  ctx.lineTo(cx + 5, cz + 4)
                  ctx.lineTo(cx - 5, cz + 4)
                  ctx.closePath()
                  ctx.fill()
                } else {
                  ctx.beginPath()
                  ctx.arc(cx, cz, 2.5, 0, Math.PI * 2)
                  ctx.fill()
                }
                continue
              }
              ctx.fillStyle =
                enemy.type === "heavy"
                  ? "#cc44ff"
                  : enemy.type === "sniper"
                    ? "#88cc44"
                    : enemy.state === "alert" || enemy.state === "attack"
                      ? "#ff2222"
                      : "#ff6666"
              ctx.beginPath()
              ctx.arc(cx, cz, 3, 0, Math.PI * 2)
              ctx.fill()
            }
            // AA guns (orange squares) + enemy jets (red diamonds).
            for (const gun of aaGuns) {
              if (gun.dead) continue
              const cx = mx(gun.x)
              const cz = mz(gun.z)
              if (!inView(cx, cz)) continue
              ctx.fillStyle = "#ff9933"
              ctx.fillRect(cx - 2.5, cz - 2.5, 5, 5)
            }
            // Enemy jets: red triangle. On SKY, tint by altitude relative to the
            // player's jet — brighter = above you, darker = below you.
            const playerJetY =
              isSky && drivingRef.current && activeVehicle?.kind === "jet"
                ? (activeVehicle.y ?? 0)
                : null
            for (const ej of enemyJets) {
              if (ej.dead) continue
              const cx = mx(ej.x)
              const cz = mz(ej.z)
              if (!inView(cx, cz)) continue
              ctx.fillStyle =
                playerJetY === null
                  ? "#ff3366"
                  : ej.y > playerJetY + 12
                    ? "#ff8888" // above
                    : ej.y < playerJetY - 12
                      ? "#aa1133" // below
                      : "#ff3366" // co-altitude
              ctx.beginPath()
              ctx.moveTo(cx, cz - 3.5)
              ctx.lineTo(cx + 3, cz)
              ctx.lineTo(cx, cz + 3.5)
              ctx.lineTo(cx - 3, cz)
              ctx.closePath()
              ctx.fill()
            }
            for (const rp of Object.values(snapshot)) {
              const { tx: rtx, ty: rty } = canvasToTile(rp.x, rp.y)
              const cx = mx(rtx * TILE_UNIT + TILE_UNIT / 2)
              const cz = mz(rty * TILE_UNIT + TILE_UNIT / 2)
              if (!inView(cx, cz)) continue
              ctx.fillStyle = "#ffcc00"
              ctx.beginPath()
              ctx.arc(cx, cz, 2.5, 0, Math.PI * 2)
              ctx.fill()
            }
            // HUNT arena boundary ring (drawn on top so it reads clearly).
            if (modeRef.current === "hunt" && huntPhaseRef.current === "mission") {
              const bx = mx(HUNT_ARENA.x)
              const bz = mz(HUNT_ARENA.z)
              const br = huntRadiusRef.current * SCALE
              ctx.strokeStyle = huntOobSinceRef.current ? "#ff2222" : "rgba(255,70,70,0.8)"
              ctx.lineWidth = 2
              ctx.beginPath()
              ctx.arc(bx, bz, br, 0, Math.PI * 2)
              ctx.stroke()
            }
            ctx.save()
            ctx.translate(W / 2, W / 2)
            ctx.rotate(-camState.yaw)
            // White self-marker, 2× larger, with a heavy black outline so the
            // player's own heading is always obvious at a glance.
            ctx.fillStyle = "#ffffff"
            ctx.strokeStyle = "rgba(0,0,0,0.9)"
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.moveTo(0, -10)
            ctx.lineTo(7, 6)
            ctx.lineTo(0, 3)
            ctx.lineTo(-7, 6)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
            ctx.restore()
          }
        }

        // HUNT revive ticket: if a lethal hit set game-over this frame during a
        // mission, auto-consume a ticket and undo it before the screen renders.
        if (
          modeRef.current === "hunt" &&
          gamePhaseRef.current === "gameover" &&
          huntPhaseRef.current === "mission" &&
          huntTicketsRef.current > 0
        ) {
          huntTryRevive()
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
        if (areaHideTimerRef.current) clearTimeout(areaHideTimerRef.current)
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

    function isTypingInInput(e?: KeyboardEvent): boolean {
      const a = document.activeElement
      if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) return true
      if (a instanceof HTMLElement && a.isContentEditable) return true
      // Defensive second-check: some browsers (and the chat panel after
      // Tab-cycling) leave activeElement on <body>, but the keydown is
      // still bubbling from the input. Read it off the event target too.
      const t = e?.target
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return true
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
      if (isTypingInInput(e)) return
      // ── HUNT menus swallow keys while open ──────────────────────────────────
      if (huntRewardOpenRef.current) {
        if (e.key === "1") huntChooseReward(1)
        else if (e.key === "2") huntChooseReward(2)
        else if (e.key === "3") huntChooseReward(3)
        return
      }
      if (huntEquipOpenRef.current) {
        if (e.key === "1") huntToggleSuitChoice()
        else if (e.key === "2") huntPickupWeapon("pulsegun")
        else if (e.key === "3") huntPickupWeapon("pulseshotgun")
        else if (e.key === "4") huntPickupWeapon("capturegun")
        else if (e.key === "5") huntPickupWeapon("blade")
        else if (e.key === "6") huntPickupWeapon("gravitycannon")
        else if (e.key === "e" || e.key === "E" || e.key === "Escape") {
          huntEquipOpenRef.current = false
          setHuntEquipOpen(false)
        }
        return
      }
      // Prevent browser default (scroll / focus shift) for movement keys
      if (MOVEMENT_KEYS.has(e.key)) e.preventDefault()
      // Normalize so Shift+WASD still triggers movement
      const stored = e.key.length === 1 ? e.key.toLowerCase() : e.key
      keysRef.current.add(stored)
      // ── HUNT weapons + actions (slots 6-9 / 0, punch, reload, interact) ─────
      if (modeRef.current === "hunt") {
        if (e.key === "6") huntSelectHuntWeapon("pulsegun")
        else if (e.key === "7") huntSelectHuntWeapon("pulseshotgun")
        else if (e.key === "8") huntSelectHuntWeapon("capturegun")
        else if (e.key === "9") huntSelectHuntWeapon("blade")
        else if (e.key === "0") huntSelectHuntWeapon("gravitycannon")
        if (e.key === "f" || e.key === "F") huntPunchReqRef.current = true
        if (e.key === "r" || e.key === "R") huntReloadReqRef.current = true
        // 1-5 fall through to the normal-weapon switch below, which also drops
        // back off the HUNT weapon.
        if (["1", "2", "3", "4", "5"].includes(e.key)) huntClearHuntWeapon()
      }
      // In a tank, 1/2/3 pick handheld guns (and leave the cannon), 4 selects
      // the main cannon. On foot / in a car, 1/2/3/4 are the usual weapons.
      const drivingTank = drivingRef.current && drivingKindRef.current === "tank"
      const toHandheld = (slot: number) => {
        if (drivingTank) {
          cannonModeRef.current = false
          setCannonActive(false)
        }
        switchWeapon(slot)
      }
      if (e.key === "1") toHandheld(0)
      if (e.key === "2") toHandheld(1)
      if (e.key === "3") toHandheld(2)
      if (e.key === "4") {
        if (drivingTank) {
          cannonModeRef.current = true
          setCannonActive(true)
        } else {
          switchWeapon(3)
        }
      }
      if (e.key === "5") switchWeapon(4) // PR-G1: RPG (locked until picked up)
      if (e.key === "e" || e.key === "E") {
        // Climb interaction — animate loop consumes the request and only
        // fires if the player is currently inside a climb zone.
        climbRequestRef.current = true
        // HUNT: same key toggles the equipment rack menu in the room.
        if (modeRef.current === "hunt") huntInteractReqRef.current = true
      }
      if (e.key === "Alt" && drivingKindRef.current === "jet") {
        // Eject from the jet (consumed in updateJet).
        e.preventDefault()
        ejectReqRef.current = true
      }
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
  }, [
    showNotification,
    unlockedWeapons,
    huntChooseReward,
    huntToggleSuitChoice,
    huntPickupWeapon,
    huntSelectHuntWeapon,
    huntClearHuntWeapon,
  ])

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
    // This effect must re-run once the joystick DOM actually mounts. isMobile
    // flips true on mount while isLoading is still true (scene not ready), so
    // the stick <div>s don't exist yet and the refs are null. If we only
    // depended on [isMobile] we'd bail here and never bind — the sticks would
    // stay dead for the whole session. Gating on the same state the JSX uses
    // (and listing it in the deps) makes us rebind the moment they appear.
    if (isLoading || error !== null || gamePhase !== "playing") return
    const moveEl = joyContainerRef.current
    const dragEl = mountRef.current
    if (!moveEl && !dragEl) return
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

    // Drag-to-look: any touch that lands on the 3D canvas (i.e. NOT on the
    // move stick or an action button — those capture their own touches, and
    // pointer-events:none HUD lets touches fall through to the canvas) drives
    // the camera by finger delta. Feeds the same mouseDelta drain the mouse
    // uses, so the look-sensitivity slider and smoothing apply for free. A
    // conservative scale keeps it gentle (motion-sickness) — the slider can
    // raise it. Touch events stay bound to their origin element, so a look
    // drag and a move-stick drag run independently as separate fingers.
    function bindDragLook(el: HTMLElement): () => void {
      let activeId = -1
      let lastX = 0
      let lastY = 0
      const TOUCH_LOOK_SCALE = 2.0
      const onStart = (e: TouchEvent) => {
        if (activeId !== -1) return
        const t = e.changedTouches[0]
        if (!t) return
        // A button / UI tap (buttons, the move stick, the minimap — all tagged
        // button or [data-ui]) must never start a look-drag. Touch + pointer are
        // separate event streams, so a button's onPointerDown can't stop this
        // native touchstart — we guard on the touch target instead. Everywhere
        // else on screen (the whole canvas) is fair game for looking, so the
        // player can always turn right past the right-side action buttons.
        const tgt = e.target as HTMLElement | null
        if (tgt?.closest("button, [data-ui]")) return
        e.preventDefault()
        activeId = t.identifier
        lastX = t.clientX
        lastY = t.clientY
      }
      const onMove = (e: TouchEvent) => {
        if (activeId === -1) return
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches.item(i)
          if (!t || t.identifier !== activeId) continue
          e.preventDefault()
          mouseDeltaRef.current.x += (t.clientX - lastX) * TOUCH_LOOK_SCALE
          mouseDeltaRef.current.y += (t.clientY - lastY) * TOUCH_LOOK_SCALE
          lastX = t.clientX
          lastY = t.clientY
        }
      }
      const onEnd = (e: TouchEvent) => {
        if (activeId === -1) return
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches.item(i)
          if (t && t.identifier === activeId) {
            activeId = -1
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
      }
    }

    const cleanupMove = moveEl ? bindStick(moveEl, joystickRef, joyThumbRef) : undefined
    const cleanupLook = dragEl ? bindDragLook(dragEl) : undefined
    return () => {
      cleanupMove?.()
      cleanupLook?.()
    }
  }, [isMobile, isLoading, error, gamePhase])

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

        {/* Settings button — small gear that opens the sensitivity modal.
            Releases pointer lock on click so the slider is grabbable. */}
        {!isLoading && !error && (
          <button
            type="button"
            onClick={() => {
              if (document.pointerLockElement) document.exitPointerLock()
              setShowSettings(true)
            }}
            style={{
              position: "absolute",
              top: "0.5rem",
              // On mobile the top-right corner is taken by the minimap, so the
              // gear moves to the top-left (clear there).
              ...(isMobile ? { left: "0.5rem" } : { right: "0.5rem" }),
              width: "2.1rem",
              height: "2.1rem",
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(0,0,0,0.55)",
              color: "#bcd",
              fontSize: "1.1rem",
              cursor: "pointer",
              borderRadius: "2px",
              zIndex: 90,
              pointerEvents: "auto",
            }}
            aria-label="settings"
          >
            ⚙
          </button>
        )}

        {/* Settings modal: sensitivity sliders + walk-bob + scanline toggle */}
        {showSettings && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,5,15,0.78)",
              zIndex: 200,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "monospace",
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowSettings(false)
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowSettings(false)
            }}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: modal backdrop
            tabIndex={0}
          >
            <div
              style={{
                background: "rgba(0,15,30,0.96)",
                border: "1px solid rgba(100,180,255,0.5)",
                padding: "1.6rem 1.8rem",
                minWidth: "320px",
                maxWidth: "92vw",
                boxShadow: "0 0 24px rgba(80,160,255,0.18)",
                color: "#fff",
              }}
            >
              <div
                style={{
                  fontSize: "1.1rem",
                  letterSpacing: "0.3em",
                  marginBottom: "1rem",
                  color: "#88aaff",
                }}
              >
                ⚙ SETTINGS
              </div>

              <label
                style={{
                  display: "block",
                  fontSize: "0.7rem",
                  letterSpacing: "0.15em",
                  marginTop: "0.6rem",
                  color: "#bcd",
                }}
              >
                {isMobile ? "LOOK SENS" : "MOUSE SENS"} · {mouseSens.toFixed(2)}x
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.05"
                  value={mouseSens}
                  onChange={(e) => {
                    const v = Number.parseFloat(e.currentTarget.value)
                    setMouseSens(v)
                    try {
                      localStorage.setItem("fps_mouse_sens", v.toString())
                    } catch {
                      /* ignore */
                    }
                  }}
                  style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
                />
              </label>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  marginTop: "1rem",
                  fontSize: "0.78rem",
                  letterSpacing: "0.12em",
                  color: "#bcd",
                }}
              >
                <input
                  type="checkbox"
                  checked={walkBobOn}
                  onChange={(e) => {
                    const v = e.currentTarget.checked
                    setWalkBobOn(v)
                    try {
                      localStorage.setItem("fps_walkbob", v ? "1" : "0")
                    } catch {
                      /* ignore */
                    }
                  }}
                />
                WALK BOB
                <span style={{ color: "#666", fontSize: "0.65rem" }}>
                  (motion-sickness; default off)
                </span>
              </label>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  marginTop: "0.6rem",
                  fontSize: "0.78rem",
                  letterSpacing: "0.12em",
                  color: "#bcd",
                }}
              >
                <input
                  type="checkbox"
                  checked={scanlinesOn}
                  onChange={(e) => {
                    const v = e.currentTarget.checked
                    setScanlinesOn(v)
                    try {
                      localStorage.setItem("fps_scanlines", v ? "1" : "0")
                    } catch {
                      /* ignore */
                    }
                  }}
                />
                CRT SCANLINES (F8)
              </label>

              <button
                type="button"
                onClick={() => setShowSettings(false)}
                style={{
                  marginTop: "1.4rem",
                  width: "100%",
                  padding: "0.55rem",
                  background: "rgba(60,100,160,0.35)",
                  border: "1px solid rgba(100,180,255,0.55)",
                  color: "#88aaff",
                  letterSpacing: "0.25em",
                  fontFamily: "monospace",
                  cursor: "pointer",
                  fontSize: "0.78rem",
                }}
              >
                CLOSE
              </button>
            </div>
          </div>
        )}

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

        {/* ══ HUNT mode HUD (PR-Z1) ══════════════════════════════════════════ */}
        {mode === "hunt" && !isLoading && !error && (
          <>
            {/* White teleport flash. */}
            {huntWhiteFlash && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(255,255,255,0.96)",
                  pointerEvents: "none",
                  zIndex: 58,
                }}
              />
            )}

            {/* ── Suit vignette + damage-line flash (worn = subtle black edges). */}
            {huntSuitActive && gamePhase === "playing" && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  zIndex: 5,
                  boxShadow: huntSuitFlash
                    ? "inset 0 0 60px 16px rgba(120,200,255,0.5)"
                    : "inset 0 0 120px 30px rgba(0,0,0,0.55)",
                  transition: "box-shadow 0.12s",
                }}
              />
            )}

            {/* ── Suit durability gauge (black bar above the HP bar). */}
            {huntSuitChosen && gamePhase === "playing" && (
              <div
                style={{
                  position: "absolute",
                  bottom: isMobile ? "5.4rem" : "3.0rem",
                  left: "1.4rem",
                  width: isMobile ? "140px" : "200px",
                  zIndex: 21,
                  pointerEvents: "none",
                  fontFamily: "monospace",
                }}
              >
                <div
                  style={{
                    fontSize: "0.55rem",
                    letterSpacing: "0.2em",
                    color: huntSuitActive ? "#9fdfff" : "#ff5555",
                    marginBottom: "2px",
                  }}
                >
                  {huntSuitActive ? "SUIT" : "SUIT BROKEN"}
                </div>
                <div
                  style={{
                    height: "7px",
                    background: "rgba(0,0,0,0.85)",
                    border: "1px solid rgba(150,200,255,0.4)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.round((huntSuitDur / HUNT_SUIT_MAX) * 100)}%`,
                      background: huntSuitActive
                        ? "linear-gradient(90deg,#2a4a6a,#7fd0ff)"
                        : "#552222",
                      boxShadow: huntSuitActive ? "0 0 6px #66ccff" : "none",
                      transition: "width 0.2s",
                    }}
                  />
                </div>
              </div>
            )}

            {/* ── HUNT weapon readout (replaces the normal ammo HUD). */}
            {huntWeapon && gamePhase === "playing" && (
              <div
                style={{
                  position: "absolute",
                  bottom: "1.4rem",
                  right: "1.4rem",
                  zIndex: 21,
                  textAlign: "right",
                  pointerEvents: "none",
                  fontFamily: "monospace",
                }}
              >
                <div style={{ color: "#9fffd0", fontSize: "0.65rem", letterSpacing: "0.18em" }}>
                  {HUNT_WEAPON_BY_ID[huntWeapon].name}
                  {huntReloadingUi && <span style={{ color: "#ffaa00" }}> RELOAD</span>}
                  {huntWeapon === "pulsegun" && huntLockCount > 0 && (
                    <span style={{ color: "#fff" }}> ◎{huntLockCount}/3</span>
                  )}
                </div>
                <div
                  style={{ color: "#fff", fontSize: "2.6rem", fontWeight: "bold", lineHeight: 1 }}
                >
                  {HUNT_WEAPON_BY_ID[huntWeapon].mag < 0 ? "∞" : huntAmmoUi}
                </div>
              </div>
            )}

            {/* ── Revive tickets. */}
            {huntTickets > 0 && gamePhase === "playing" && (
              <div
                style={{
                  position: "absolute",
                  top: "0.5rem",
                  right: "0.6rem",
                  zIndex: 26,
                  fontFamily: "monospace",
                  color: "#ff88cc",
                  fontSize: "0.8rem",
                  pointerEvents: "none",
                  textShadow: "0 0 6px rgba(255,80,160,0.7)",
                }}
              >
                ♻ 復活 ×{huntTickets}
              </div>
            )}

            {/* ── Rack prompt (room). */}
            {huntNearRack && !huntEquipOpen && !isMobile && (
              <div
                style={{
                  position: "absolute",
                  bottom: "30%",
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 30,
                  fontFamily: "monospace",
                  color: "#39ff7a",
                  fontSize: "0.95rem",
                  pointerEvents: "none",
                  textShadow: "0 0 8px #00ff55",
                }}
              >
                [E] 装備ラック
              </div>
            )}

            {/* ── Equipment menu (loadout chosen before the countdown ends). */}
            {huntEquipOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%,-50%)",
                  zIndex: 55,
                  fontFamily: "monospace",
                  background: "rgba(0,10,6,0.94)",
                  border: "2px solid #00ff55",
                  boxShadow: "0 0 28px rgba(0,255,80,0.4)",
                  padding: "1.2rem 1.6rem",
                  color: "#39ff7a",
                  minWidth: "300px",
                  pointerEvents: "auto",
                }}
              >
                <div
                  style={{
                    fontSize: "1.2rem",
                    fontWeight: "bold",
                    letterSpacing: "0.2em",
                    marginBottom: "0.8rem",
                    textAlign: "center",
                  }}
                >
                  装備ラック
                </div>
                <button
                  type="button"
                  onClick={huntToggleSuitChoice}
                  style={{
                    display: "block",
                    width: "100%",
                    marginBottom: "0.5rem",
                    padding: "0.5rem",
                    textAlign: "left",
                    cursor: "pointer",
                    fontFamily: "monospace",
                    background: huntSuitChosen ? "rgba(0,120,255,0.25)" : "rgba(0,20,10,0.6)",
                    border: `1px solid ${huntSuitChosen ? "#66ccff" : "#225544"}`,
                    color: huntSuitChosen ? "#9fdfff" : "#7fbfa0",
                  }}
                >
                  [1] 強化スーツ {huntSuitChosen ? "✓ 着用" : "— 未着用"}
                </button>
                {HUNT_WEAPONS.filter((w) => !w.reward || huntGravityUnlocked).map((w, i) => {
                  const owned = huntOwned.includes(w.id)
                  return (
                    <button
                      type="button"
                      key={w.id}
                      onClick={() => huntPickupWeapon(w.id)}
                      style={{
                        display: "block",
                        width: "100%",
                        marginBottom: "0.4rem",
                        padding: "0.45rem",
                        textAlign: "left",
                        cursor: "pointer",
                        fontFamily: "monospace",
                        background: owned ? "rgba(0,80,40,0.5)" : "rgba(0,20,10,0.6)",
                        border: `1px solid ${owned ? "#33cc77" : "#225544"}`,
                        color: owned ? "#9fffc0" : "#7fbfa0",
                      }}
                    >
                      [{i + 2}] {w.name} {owned ? "✓" : "取得"}
                    </button>
                  )
                })}
                <div style={{ fontSize: "0.62rem", opacity: 0.7, marginTop: "0.6rem" }}>
                  カウントダウン終了までに選べ。選ばなければ生身＋既存武器で転送。[E]で閉じる
                </div>
              </div>
            )}

            {/* ── 100-pt reward menu (shown on the scoring screen when eligible). */}
            {huntRewardOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%,-50%)",
                  zIndex: 56,
                  fontFamily: "monospace",
                  background: "rgba(8,0,12,0.95)",
                  border: "2px solid #cc66ff",
                  boxShadow: "0 0 30px rgba(180,80,255,0.45)",
                  padding: "1.4rem 1.8rem",
                  color: "#e0b0ff",
                  minWidth: "340px",
                  textAlign: "center",
                  pointerEvents: "auto",
                }}
              >
                <div
                  style={{
                    fontSize: "1.3rem",
                    fontWeight: "bold",
                    letterSpacing: "0.18em",
                    marginBottom: "0.4rem",
                  }}
                >
                  100点に到達した
                </div>
                <div style={{ fontSize: "0.7rem", opacity: 0.8, marginBottom: "1rem" }}>
                  累計 {huntTotal} pt — 選べ（タップ / キー 1・2・3）
                </div>
                {(
                  [
                    {
                      n: 1 as const,
                      t: "① 解放される",
                      d: "HUNT クリア。記憶を消され外へ。累計リセット",
                    },
                    {
                      n: 2 as const,
                      t: "② 強力な武器を得る",
                      d: "−100pt グラビティキャノン永久解放",
                    },
                    {
                      n: 3 as const,
                      t: "③ 復活チケット",
                      d: `−100pt 蘇生を1枚（最大${HUNT_MAX_TICKETS}）`,
                    },
                  ] as const
                ).map((c) => (
                  <button
                    type="button"
                    key={c.n}
                    onClick={() => huntChooseReward(c.n)}
                    style={{
                      display: "block",
                      width: "100%",
                      marginBottom: "0.5rem",
                      padding: "0.6rem",
                      textAlign: "left",
                      cursor: "pointer",
                      fontFamily: "monospace",
                      background: "rgba(40,10,60,0.6)",
                      border: "1px solid #aa55dd",
                      color: "#e8c8ff",
                    }}
                  >
                    <div style={{ fontWeight: "bold" }}>{c.t}</div>
                    <div style={{ fontSize: "0.62rem", opacity: 0.8 }}>{c.d}</div>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    huntRewardOpenRef.current = false
                    setHuntRewardOpen(false)
                  }}
                  style={{
                    marginTop: "0.3rem",
                    padding: "0.35rem 0.8rem",
                    cursor: "pointer",
                    fontFamily: "monospace",
                    background: "transparent",
                    border: "1px solid #553366",
                    color: "#aa88bb",
                    fontSize: "0.7rem",
                  }}
                >
                  スキップ
                </button>
              </div>
            )}

            {/* ── "Released" ending overlay. */}
            {huntReleased && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 70,
                  background: "rgba(255,255,255,0.97)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "monospace",
                  color: "#111",
                  textAlign: "center",
                  pointerEvents: "auto",
                  animation: "huntRelease 2s ease-in",
                }}
              >
                <style>
                  {
                    "@keyframes huntRelease { 0% { background: rgba(0,0,0,0.95); color: #fff; } 100% { background: rgba(255,255,255,0.97); color: #111; } }"
                  }
                </style>
                <div style={{ fontSize: "2.2rem", fontWeight: "bold", letterSpacing: "0.3em" }}>
                  解放
                </div>
                <div
                  style={{
                    fontSize: "0.95rem",
                    marginTop: "1rem",
                    maxWidth: "440px",
                    lineHeight: 1.8,
                  }}
                >
                  契約は果たされた。狩りの記憶は薄れ、あなたは元の日常へ還される……
                  <br />
                  もう、あの黒い球体を思い出すことはない。
                </div>
                <button
                  type="button"
                  onClick={() => {
                    huntReleasedRef.current = false
                    setHuntReleased(false)
                    onExit?.()
                  }}
                  style={{
                    marginTop: "2rem",
                    padding: "0.7rem 2.4rem",
                    cursor: "pointer",
                    fontFamily: "monospace",
                    background: "#111",
                    color: "#fff",
                    border: "none",
                    letterSpacing: "0.2em",
                  }}
                >
                  ▶ モードセレクトへ
                </button>
              </div>
            )}
            {/* Persistent score banner: this mission + cumulative (+ quota). */}
            {gamePhase === "playing" && (
              <div
                style={{
                  position: "absolute",
                  top: "0.5rem",
                  left: "0.6rem",
                  zIndex: 26,
                  fontFamily: "monospace",
                  background: "rgba(0,8,4,0.7)",
                  border: "1px solid rgba(0,255,90,0.4)",
                  padding: "0.4rem 0.7rem",
                  color: "#39ff7a",
                  lineHeight: 1.5,
                  pointerEvents: "none",
                }}
              >
                <div style={{ fontSize: "0.62rem", letterSpacing: "0.15em", opacity: 0.7 }}>
                  MISSION
                </div>
                <div
                  style={{ fontSize: "1.5rem", fontWeight: "bold", textShadow: "0 0 8px #00ff55" }}
                >
                  {huntScore} pt
                </div>
                <div style={{ fontSize: "0.7rem", opacity: 0.85 }}>累計 {huntTotal} pt</div>
                {huntQuota > 0 && (
                  <div style={{ fontSize: "0.7rem", color: "#ffcc44", marginTop: "0.2rem" }}>
                    ノルマ {huntScore}/{huntQuota}
                  </div>
                )}
              </div>
            )}
            {/* Top-center: time remaining (Lv1/2) or arena radius (Lv3). */}
            {huntPhase === "mission" && (
              <div
                style={{
                  position: "absolute",
                  top: "0.4rem",
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 26,
                  fontFamily: "monospace",
                  textAlign: "center",
                  color: "#ffffff",
                  pointerEvents: "none",
                }}
              >
                {huntDeadlineRef.current > 0 ? (
                  <div
                    style={{
                      fontSize: "2.2rem",
                      fontWeight: "bold",
                      color: huntTimeLeft <= 30 ? "#ff4040" : "#ffffff",
                      textShadow: "0 0 14px rgba(0,0,0,0.9)",
                    }}
                  >
                    {Math.floor(huntTimeLeft / 60)}:{String(huntTimeLeft % 60).padStart(2, "0")}
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: "1.9rem",
                      fontWeight: "bold",
                      color: "#ff7766",
                      textShadow: "0 0 14px rgba(0,0,0,0.9)",
                    }}
                  >
                    ◎ {huntRadius}m
                  </div>
                )}
              </div>
            )}
            {/* Orb countdown number (room). */}
            {huntPhase === "countdown" && (
              <div
                style={{
                  position: "absolute",
                  top: "16%",
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 40,
                  fontFamily: "monospace",
                  fontSize: "4.5rem",
                  fontWeight: "bold",
                  color: "#39ff7a",
                  textShadow: "0 0 30px #00ff55",
                  pointerEvents: "none",
                }}
              >
                {huntCountdown}
              </div>
            )}
            {/* Out-of-bounds warning. */}
            {huntOob && gamePhase === "playing" && (
              <>
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background:
                      "radial-gradient(ellipse at center, transparent 30%, rgba(220,0,0,0.6) 100%)",
                    pointerEvents: "none",
                    zIndex: 7,
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: "30%",
                    left: "50%",
                    transform: "translateX(-50%)",
                    zIndex: 41,
                    fontFamily: "monospace",
                    fontSize: "2rem",
                    fontWeight: "bold",
                    color: "#ff3030",
                    textShadow: "0 0 18px rgba(255,0,0,0.9)",
                    pointerEvents: "none",
                    textAlign: "center",
                  }}
                >
                  ⚠ 境界侵犯 ⚠<br />
                  <span style={{ fontSize: "1rem" }}>3秒以内に戻れ — さもなくば頭部爆散</span>
                </div>
              </>
            )}
            {/* Post-mission scoring screen. */}
            {huntPhase === "scoring" && gamePhase === "playing" && (
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%,-50%)",
                  zIndex: 42,
                  fontFamily: "monospace",
                  background: "rgba(0,10,4,0.86)",
                  border: "2px solid #00ff55",
                  boxShadow: "0 0 28px rgba(0,255,80,0.35)",
                  padding: "1.4rem 2rem",
                  color: "#39ff7a",
                  textAlign: "center",
                  minWidth: "320px",
                  pointerEvents: "none",
                }}
              >
                <div
                  style={{
                    fontSize: "1.6rem",
                    fontWeight: "bold",
                    letterSpacing: "0.2em",
                    textShadow: "0 0 12px #00ff55",
                    marginBottom: "0.8rem",
                  }}
                >
                  MISSION CLEAR
                </div>
                {huntScoreList.map((k) => (
                  <div
                    key={k.name}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "0.85rem",
                      padding: "0.15rem 0",
                    }}
                  >
                    <span>
                      {k.name} ×{k.count}
                    </span>
                    <span style={{ color: "#ffcc44" }}>+{k.points * k.count} pt</span>
                  </div>
                ))}
                <div
                  style={{
                    marginTop: "0.7rem",
                    paddingTop: "0.5rem",
                    borderTop: "1px solid rgba(0,255,80,0.3)",
                    fontSize: "1.1rem",
                    fontWeight: "bold",
                  }}
                >
                  今回 {huntScore} pt ／ 累計 {huntTotal} pt
                </div>
                <div style={{ marginTop: "0.5rem", fontSize: "0.7rem", opacity: 0.7 }}>
                  HP・弾薬 回復 — 次の標的へ…
                </div>
              </div>
            )}
          </>
        )}

        {/* Fall-damage number — rises + fades on a hard landing. */}
        {fallDmgPopup && (
          <div
            key={fallDmgPopup.key}
            style={{
              position: "absolute",
              top: "44%",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 46,
              pointerEvents: "none",
              fontFamily: "monospace",
              fontSize: "2.6rem",
              fontWeight: "bold",
              color: "#ff5252",
              textShadow: "0 0 16px rgba(255,0,0,0.9), 0 2px 6px rgba(0,0,0,0.9)",
              animation: "fallDmgRise 1.1s ease-out forwards",
            }}
          >
            -{fallDmgPopup.dmg}
            <style>{`@keyframes fallDmgRise {
              0% { opacity: 0; transform: translate(-50%, 12px) scale(0.7); }
              20% { opacity: 1; transform: translate(-50%, 0) scale(1.1); }
              100% { opacity: 0; transform: translate(-50%, -28px) scale(1); }
            }`}</style>
          </div>
        )}

        {/* ── Top-center: Score / Kills (desktop only — mobile shows these in
            the compact top HUD bar below to avoid stacking two panels) ──── */}
        {!isLoading && !error && !isMobile && gamePhase === "playing" && mode !== "hunt" && (
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

        {/* Climb prompt — shown while the player is inside a ladder/stairs
            ClimbZone. The animate loop flips the state on entry/exit so this
            doesn't re-render every frame. Desktop only ("[E]" is meaningless
            on touch); mobile shows a tappable CLIMB button instead. */}
        {nearClimb && !isLoading && !error && !isMobile && gamePhase === "playing" && (
          <div
            style={{
              position: "absolute",
              bottom: "20%",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 25,
              pointerEvents: "none",
              fontFamily: "monospace",
              fontSize: "1rem",
              color: "#ffcc22",
              background: "rgba(0,0,0,0.78)",
              border: "1px solid #ffcc22",
              padding: "0.45rem 1.1rem",
              letterSpacing: "0.15em",
              textShadow: "0 0 8px rgba(255,200,40,0.6)",
              boxShadow: "0 0 14px rgba(255,200,40,0.3)",
              borderRadius: "2px",
            }}
          >
            {climbAtTop ? "[E] 降りる" : "[E] 登る"}
          </div>
        )}

        {/* Vehicle board / exit prompt (desktop) */}
        {(nearVehicle || inVehicle) &&
          !isLoading &&
          !error &&
          !isMobile &&
          gamePhase === "playing" && (
            <div
              style={{
                position: "absolute",
                bottom: inVehicle ? "12%" : "26%",
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 25,
                pointerEvents: "none",
                fontFamily: "monospace",
                fontSize: "1rem",
                color: "#33ddff",
                background: "rgba(0,0,0,0.78)",
                border: "1px solid #33ddff",
                padding: "0.45rem 1.1rem",
                letterSpacing: "0.15em",
                textShadow: "0 0 8px rgba(60,200,255,0.6)",
                boxShadow: "0 0 14px rgba(60,200,255,0.3)",
                borderRadius: "2px",
              }}
            >
              {inVehicle ? "[E] 降りる" : "[E] 車に乗る"}
            </div>
          )}

        {/* AA gun mount / exit prompt (desktop) — PR-G1 */}
        {(nearAAGun || inAAGun) && !isLoading && !error && !isMobile && gamePhase === "playing" && (
          <div
            style={{
              position: "absolute",
              bottom: inAAGun ? "12%" : "26%",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 25,
              pointerEvents: "none",
              fontFamily: "monospace",
              fontSize: "1rem",
              color: "#ffaa33",
              background: "rgba(0,0,0,0.78)",
              border: "1px solid #ffaa33",
              padding: "0.45rem 1.1rem",
              letterSpacing: "0.15em",
              textShadow: "0 0 8px rgba(255,170,60,0.6)",
              boxShadow: "0 0 14px rgba(255,170,60,0.3)",
              borderRadius: "2px",
            }}
          >
            {inAAGun ? "[E] 降りる" : "[E] 対空砲に乗る"}
          </div>
        )}

        {/* Vehicle HP bar — shown while driving (mobile + desktop). */}
        {inVehicle && vehicleMaxHp > 0 && !isLoading && !error && gamePhase === "playing" && (
          <div
            style={{
              position: "absolute",
              bottom: isMobile ? "auto" : "6%",
              top: isMobile ? "0.6rem" : "auto",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 25,
              pointerEvents: "none",
              fontFamily: "monospace",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: "0.7rem",
                letterSpacing: "0.2em",
                color: "#ffcc44",
                textShadow: "0 0 6px rgba(255,180,40,0.6)",
                marginBottom: "0.2rem",
              }}
            >
              VEHICLE {Math.max(0, Math.ceil((vehicleHp / vehicleMaxHp) * 100))}%
            </div>
            <div
              style={{
                width: "220px",
                height: "10px",
                background: "rgba(0,0,0,0.7)",
                border: "1px solid rgba(255,180,40,0.7)",
                borderRadius: "2px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, (vehicleHp / vehicleMaxHp) * 100))}%`,
                  height: "100%",
                  background:
                    vehicleHp / vehicleMaxHp > 0.5
                      ? "#ffcc44"
                      : vehicleHp / vehicleMaxHp > 0.25
                        ? "#ff8800"
                        : "#ff3333",
                  transition: "width 0.1s linear",
                }}
              />
            </div>
            {/* Tank weapon readout: active weapon + cannon readiness. */}
            {inTank && (
              <div
                style={{
                  marginTop: "0.3rem",
                  fontSize: "0.72rem",
                  letterSpacing: "0.15em",
                  color: cannonActive ? (cannonCooldownMs > 0 ? "#ff8866" : "#ffdd55") : "#9fd8ff",
                  textShadow: "0 0 6px rgba(0,0,0,0.8)",
                }}
              >
                {cannonActive
                  ? cannonCooldownMs > 0
                    ? `● CANNON ${(cannonCooldownMs / 1000).toFixed(1)}s`
                    : "● CANNON READY"
                  : "○ HANDHELD"}
                <span style={{ opacity: 0.6, marginLeft: "0.6rem" }}>
                  {isMobile ? "[切替]主砲/銃" : "[1/2/3]銃 [4]主砲"}
                </span>
              </div>
            )}
            {/* Jet flight readout: speed, altitude, missile readiness. */}
            {inJet && (
              <div
                style={{
                  marginTop: "0.3rem",
                  fontSize: "0.72rem",
                  letterSpacing: "0.12em",
                  color: "#9fd8ff",
                  textShadow: "0 0 6px rgba(0,0,0,0.8)",
                }}
              >
                <span style={{ marginRight: "0.7rem" }}>SPD {jetSpeed}</span>
                <span style={{ marginRight: "0.7rem" }}>ALT {jetAlt}m</span>
                <span style={{ color: missileCdMs > 0 ? "#ff8866" : "#ffdd55" }}>
                  {missileCdMs > 0 ? `◇ MSL ${(missileCdMs / 1000).toFixed(1)}s` : "◆ MSL READY"}
                </span>
                <span style={{ opacity: 0.6, marginLeft: "0.6rem" }}>
                  {isMobile ? "" : "[W/S]加減速 [マウス]機首 [RMB]ミサイル"}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Parachute indicator */}
        {parachuting && !isLoading && !error && gamePhase === "playing" && (
          <div
            style={{
              position: "absolute",
              top: isMobile ? "0.6rem" : "auto",
              bottom: isMobile ? "auto" : "8%",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 26,
              pointerEvents: "none",
              fontFamily: "monospace",
              fontSize: "0.9rem",
              letterSpacing: "0.2em",
              fontWeight: "bold",
              color: "#bfefff",
              textShadow: "0 0 8px rgba(120,200,255,0.8)",
            }}
          >
            ⬇ CHUTE
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
            <span style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.55rem" }}>K/D</span>
            <span style={{ color: "#ff5555", fontSize: "1.05rem", fontWeight: "bold" }}>
              {kills}
            </span>
            <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.8rem" }}>/</span>
            <span style={{ color: "#aaa", fontSize: "1.05rem", fontWeight: "bold" }}>{deaths}</span>
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
        {!isLoading && !error && !isMobile && gamePhase === "playing" && !huntWeapon && (
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
        {/* Compact mobile minimap — small circular version in the top-right
            corner (enough to read enemies, own heading, buildings) above the
            ADS button. */}
        {!isLoading && !error && isMobile && (
          <div
            data-ui="minimap"
            onPointerUp={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setMapExpanded((v) => !v)
            }}
            style={{
              position: "absolute",
              top: "0.5rem",
              right: "0.5rem",
              zIndex: 23,
              width: mapExpanded ? "300px" : "62px",
              height: mapExpanded ? "300px" : "62px",
              borderRadius: mapExpanded ? "12px" : "50%",
              overflow: "hidden",
              border: "2px solid rgba(255,255,255,0.28)",
              boxShadow: "0 0 10px rgba(0,0,0,0.7)",
              background: mapExpanded ? "rgba(0,0,0,0.85)" : "transparent",
              transition: "all 0.2s ease",
              touchAction: "none",
            }}
          >
            <canvas
              ref={minimapRef}
              // Match the buffer resolution to the expanded display size so the
              // minimap is drawn sharp (the draw reads canvas.width), instead of
              // CSS-stretching a 92px buffer to 300px (blurry).
              width={mapExpanded ? 300 : 92}
              height={mapExpanded ? 300 : 92}
              style={{
                display: "block",
                width: "100%",
                height: "100%",
                imageRendering: "pixelated",
              }}
            />
            {mapExpanded && (
              <button
                type="button"
                onPointerUp={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setMapExpanded(false)
                }}
                style={{
                  position: "absolute",
                  top: "4px",
                  right: "4px",
                  width: "34px",
                  height: "34px",
                  borderRadius: "8px",
                  background: "rgba(0,0,0,0.6)",
                  border: "1px solid rgba(255,255,255,0.45)",
                  color: "#fff",
                  fontSize: "1.1rem",
                  fontWeight: "bold",
                  lineHeight: 1,
                  touchAction: "none",
                  zIndex: 24,
                }}
              >
                ✕
              </button>
            )}
          </div>
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
                // On mobile the top-center bar (top 0.5rem) and the centered
                // weapon-swap row (top 2.8rem, ~60px tall) own the upper strip,
                // so drop the objective into the clear left column below them
                // and give it a chip background so it reads over the scene.
                top: isMobile ? "6.8rem" : "1rem",
                left: isMobile ? "0.5rem" : "1rem",
                zIndex: 20,
                pointerEvents: "none",
                fontFamily: "monospace",
                ...(isMobile
                  ? {
                      maxWidth: "44vw",
                      background: "rgba(0,0,0,0.5)",
                      border: "1px solid rgba(136,170,255,0.25)",
                      borderRadius: "6px",
                      padding: "0.25rem 0.45rem",
                    }
                  : {}),
              }}
            >
              {!isMobile && (
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
              )}
              <div
                style={{
                  color: "white",
                  fontSize: isMobile ? "0.6rem" : "0.72rem",
                  fontWeight: "bold",
                  letterSpacing: "0.06em",
                  marginBottom: isMobile ? "0.15rem" : "0.3rem",
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
                    fontSize: isMobile ? "1rem" : "1.4rem",
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
          mode !== "hunt" &&
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
                {mode === "zombie"
                  ? "ZOMBIES"
                  : mode === "invasion"
                    ? "TERRAFORMERS"
                    : mode === "wave_defense"
                      ? "ENEMIES REMAINING"
                      : "BOTS ALIVE"}
              </div>
              <div
                style={{ color: "#ff5555", fontSize: "1.4rem", fontWeight: "bold", lineHeight: 1 }}
              >
                {aliveEnemyCount}
              </div>
            </div>
          )}

        {/* ── Remaining-enemy / boss readout (top-right). Shown where the
            top-center count is hidden — on mobile and in HUNT — so there's
            always a clear, large "残り" tally. Sits below the minimap. */}
        {!isLoading &&
          !error &&
          gamePhase === "playing" &&
          !showMissionSelect &&
          (isMobile || mode === "hunt") &&
          (aliveEnemyCount > 0 || bossActive) && (
            <div
              style={{
                position: "absolute",
                top: "5rem",
                right: "0.6rem",
                zIndex: 21,
                pointerEvents: "none",
                fontFamily: "monospace",
                textAlign: "right",
                textShadow: "0 2px 4px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.9)",
              }}
            >
              {aliveEnemyCount > 0 && (
                <div
                  style={{
                    color: "#ffffff",
                    fontSize: "1.3rem",
                    fontWeight: "bold",
                    lineHeight: 1.1,
                  }}
                >
                  残り: {aliveEnemyCount}体
                </div>
              )}
              {bossActive && (
                <div
                  style={{
                    color: "#ff8866",
                    fontSize: "1.1rem",
                    fontWeight: "bold",
                    lineHeight: 1.2,
                  }}
                >
                  BOSS HP: {Math.round(bossHpPct)}%
                </div>
              )}
            </div>
          )}

        {/* ── HUNT compass: arrow rotates toward the transfer-room orb (room
            phase). Orientation + opacity are driven from the animate loop via
            huntCompassRef. */}
        {!isLoading && !error && gamePhase === "playing" && mode === "hunt" && (
          <div
            ref={huntCompassRef}
            style={{
              position: "absolute",
              top: "38%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 21,
              pointerEvents: "none",
              opacity: 0,
              transition: "opacity 0.2s",
              color: "#00ff66",
              fontSize: "2.4rem",
              lineHeight: 1,
              textShadow: "0 0 10px rgba(0,255,80,0.9), 0 2px 4px rgba(0,0,0,0.9)",
            }}
          >
            ▲
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
        {!isLoading && !error && scanlinesOn && !isMobile && (
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
                {mode === "zombie" || mode === "invasion"
                  ? `WAVE ${currentWave}`
                  : `WAVE ${currentWave} / ${WAVE_DEFS.length}`}
              </div>
            </button>
          )}

        {/* District name banner (GTA-style) — fades in on area entry, then
            auto-hides. `key` restarts the fade each time the player crosses
            into a new district. */}
        {!isLoading && !error && areaBanner && (
          <div
            key={areaBanner.key}
            style={{
              position: "absolute",
              top: "12%",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 44,
              pointerEvents: "none",
              textAlign: "center",
              fontFamily: "monospace",
              opacity: areaBannerVisible ? 1 : 0,
              transition: areaBannerVisible ? "opacity 0.5s ease-out" : "opacity 1.2s ease-in",
            }}
          >
            <div
              style={{
                fontSize: "2.2rem",
                fontWeight: "bold",
                color: "#ffffff",
                letterSpacing: "0.32em",
                textShadow: "0 2px 12px rgba(0,0,0,0.95), 0 0 24px rgba(0,0,0,0.6)",
              }}
            >
              {areaBanner.id}
            </div>
            <div
              style={{
                marginTop: "0.15rem",
                fontSize: "0.7rem",
                letterSpacing: "0.4em",
                color: "rgba(255,255,255,0.65)",
                textShadow: "0 1px 6px rgba(0,0,0,0.9)",
              }}
            >
              {areaBanner.id === "CITY"
                ? "DOWNTOWN"
                : areaBanner.id === "HARBOR"
                  ? "SOUTH DOCKS"
                  : "NORTH WORKS"}
            </div>
          </div>
        )}

        {/* Wave message */}
        {/* ── Big Cockroach boss HP bar (top, 80% width red) ──────────────── */}
        {bossActive && !isLoading && !error && gamePhase === "playing" && (
          <div
            style={{
              position: "absolute",
              top: "0.6rem",
              left: "50%",
              transform: "translateX(-50%)",
              width: "80vw",
              zIndex: 24,
              pointerEvents: "none",
              fontFamily: "monospace",
              textAlign: "center",
            }}
          >
            <div
              style={{
                color: bossRageUi ? "#ff2a2a" : "#ff6644",
                fontSize: "0.85rem",
                fontWeight: "bold",
                letterSpacing: "0.25em",
                textShadow: "0 0 12px rgba(255,0,0,0.9)",
                marginBottom: "0.2rem",
              }}
            >
              ☠ BIG COCKROACH {bossRageUi ? "— 怒" : ""}
            </div>
            <div
              style={{
                height: "16px",
                background: "rgba(20,0,0,0.85)",
                border: "2px solid #661111",
                boxShadow: "0 0 14px rgba(255,0,0,0.4)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${bossHpPct}%`,
                  background: bossRageUi
                    ? "linear-gradient(90deg,#ff0000,#ff7700)"
                    : "linear-gradient(90deg,#aa0000,#ff3333)",
                  transition: "width 0.2s",
                }}
              />
            </div>
          </div>
        )}

        {/* ── Poison vignette (beam / poison pool contact). ──────────────── */}
        {bossPoison && gamePhase === "playing" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              zIndex: 6,
              background:
                "radial-gradient(ellipse at center, transparent 30%, rgba(40,200,40,0.5) 100%)",
            }}
          />
        )}

        {/* ── Boss victory overlay (Phase 3 sets bossDefeated). ───────────── */}
        {bossDefeated && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 62,
              background: "rgba(0,0,0,0.9)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "monospace",
              textAlign: "center",
              pointerEvents: "auto",
            }}
          >
            <div
              style={{
                color: "#ffcc00",
                fontSize: "2.6rem",
                fontWeight: "bold",
                letterSpacing: "0.18em",
                textShadow: "0 0 30px rgba(255,180,0,0.9)",
              }}
            >
              TERRAFORMER QUEEN
              <br />
              DESTROYED
            </div>
            <div style={{ color: "#fff", fontSize: "1.4rem", marginTop: "1.2rem" }}>
              SCORE {score.toString().padStart(6, "0")}
            </div>
            <button
              type="button"
              onClick={() => {
                setBossDefeated(false)
                onExit?.()
              }}
              style={{
                marginTop: "2rem",
                padding: "0.7rem 2.4rem",
                cursor: "pointer",
                fontFamily: "monospace",
                background: "rgba(60,40,0,0.7)",
                border: "1px solid #ffcc00",
                color: "#ffcc00",
                letterSpacing: "0.2em",
              }}
            >
              ▶ RESULT / MODE SELECT
            </button>
          </div>
        )}

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
              {mode === "zombie"
                ? `WAVE ${currentWave}`
                : `WAVE ${currentWave} / ${WAVE_DEFS.length}`}
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

        {/* Crosshair (legacy duplicate — desktop only; mobile uses the
            crosshair above so the two don't stack on the touch HUD) */}
        {!isLoading && !error && isPointerLocked && !isMobile && gamePhase === "playing" && (
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

        {/* Enemy status (top-right) — hidden on mobile: the E1–E8 HP rows
            collide with the top HUD bar and there's no room on a phone. */}
        {!isLoading && !error && !isMobile && gamePhase === "playing" && (
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

        {/* Minimap (legacy square — desktop only. On mobile the dedicated
            hidden canvas above keeps minimapRef alive for the draw loop, so
            this visible one would just overlap the top HUD.) */}
        {!isLoading && !error && !isMobile && (
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

        {/* Weapon selector (bottom-right) — desktop only; mobile switches
            weapons with the [1][2][3] row in the action buttons below. */}
        {!isLoading && !error && !isMobile && gamePhase === "playing" && (
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
            data-ui="joystick"
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

        {/* Look: drag anywhere on the screen (except the move stick / action
            buttons) to rotate the camera — listeners are attached to the
            canvas mount in the twin-control useEffect. No on-screen stick. */}

        {/* Mobile action buttons */}
        {isMobile && !isLoading && !error && gamePhase === "playing" && (
          <>
            {/* FIRE button — sits ABOVE the right look-stick so right thumb
                can stretch up to fire without leaving the stick. */}
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
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

            {/* ── HUNT mobile extras: PUNCH, EQUIP (room), HUNT weapon column. */}
            {mode === "hunt" && (
              <>
                {huntSuitActive && (
                  <button
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault()
                      huntPunchReqRef.current = true
                    }}
                    style={{
                      position: "absolute",
                      bottom: isLandscape ? "7.5rem" : "11rem",
                      right: isLandscape ? "9rem" : "9.5rem",
                      width: "60px",
                      height: "60px",
                      borderRadius: "50%",
                      background: "rgba(255,180,40,0.28)",
                      border: "2px solid rgba(255,200,80,0.8)",
                      color: "#ffe0a0",
                      fontFamily: "monospace",
                      fontSize: "0.7rem",
                      fontWeight: "bold",
                      touchAction: "none",
                      userSelect: "none",
                      zIndex: 32,
                    }}
                  >
                    PUNCH
                  </button>
                )}
                {huntNearRack && (
                  <button
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault()
                      huntInteractReqRef.current = true
                    }}
                    style={{
                      position: "absolute",
                      bottom: "30%",
                      left: "50%",
                      transform: "translateX(-50%)",
                      padding: "0.7rem 1.4rem",
                      borderRadius: "8px",
                      background: "rgba(0,40,20,0.8)",
                      border: "2px solid #00ff55",
                      color: "#39ff7a",
                      fontFamily: "monospace",
                      fontSize: "0.9rem",
                      fontWeight: "bold",
                      touchAction: "none",
                      userSelect: "none",
                      zIndex: 33,
                    }}
                  >
                    装備ラック
                  </button>
                )}
                <div
                  style={{
                    position: "absolute",
                    left: "0.4rem",
                    top: "30%",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.3rem",
                    zIndex: 32,
                  }}
                >
                  {HUNT_WEAPONS.filter((w) => huntOwned.includes(w.id)).map((w) => (
                    <button
                      type="button"
                      key={w.id}
                      onPointerDown={(e) => {
                        e.preventDefault()
                        huntSelectHuntWeapon(w.id)
                      }}
                      style={{
                        padding: "0.35rem 0.5rem",
                        borderRadius: "6px",
                        background:
                          huntWeapon === w.id ? "rgba(0,200,120,0.4)" : "rgba(0,20,12,0.7)",
                        border: `1px solid ${huntWeapon === w.id ? "#33ff99" : "#225544"}`,
                        color: "#9fffc0",
                        fontFamily: "monospace",
                        fontSize: "0.58rem",
                        fontWeight: "bold",
                        touchAction: "none",
                        userSelect: "none",
                      }}
                    >
                      {w.name.split(" ")[0]}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* RELOAD button (bottom-center) */}
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                // HUNT weapon reload routes through its own request ref.
                if (modeRef.current === "hunt" && huntWeaponRef.current) {
                  huntReloadReqRef.current = true
                  return
                }
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

            {/* ADS button (top-right) — hidden while driving (no ADS in vehicles). */}
            {!inVehicle && (
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
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
                  // Portrait: pushed below the top-right minimap (62px) so they
                  // don't overlap. Landscape ADS sits further left (right 7.5rem)
                  // clear of the corner minimap already.
                  top: isLandscape ? "0.6rem" : "4.7rem",
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
            )}

            {/* GRENADE button (top-right, below ADS) */}
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
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

            {/* Weapon swap row [1][2][3][4] (top-center, below HUD bar) */}
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
              {/* In a tank: 3 gun slots + a 主砲 (cannon) toggle. Otherwise the
                  usual [1][2][3][4] weapon row. */}
              {(inTank
                ? [0, 1, 2, -1]
                : unlockedWeapons.has("rpg")
                  ? [0, 1, 2, 3, 4]
                  : [0, 1, 2, 3]
              ).map((idx) => {
                const isCannon = idx === -1
                const w = isCannon ? null : WEAPONS[idx]
                if (!isCannon && !w) return null
                const sel = isCannon
                  ? cannonActive
                  : inTank
                    ? !cannonActive && currentWeaponIdx === idx
                    : currentWeaponIdx === idx
                const locked = !isCannon && w ? !unlockedWeapons.has(w.id) : false
                return (
                  <button
                    type="button"
                    key={isCannon ? "cannon" : idx}
                    onPointerDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (isCannon) {
                        cannonModeRef.current = true
                        setCannonActive(true)
                        return
                      }
                      if (locked || reloadingRef.current) return
                      if (inTank) {
                        cannonModeRef.current = false
                        setCannonActive(false)
                      }
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
                    {isCannon ? "[4]" : `[${idx + 1}]`}
                    <br />
                    {isCannon ? "砲" : (w?.name.charAt(0) ?? "")}
                  </button>
                )
              })}
            </div>

            {/* CLIMB button — only while inside a ladder ClimbZone. Fires the
                same climbRequestRef path as the PC "E" key (the animate loop
                consumes it and honours the cooldown). Real <button> with its
                own pointer events + high z-index, so the touch is captured
                here and never reaches the canvas drag-look listener. Centered
                in the lower-middle, clear of FIRE (right) / RELOAD (bottom-
                center) / move stick (bottom-left). */}
            {nearClimb && (
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault()
                  climbRequestRef.current = true
                }}
                style={{
                  position: "absolute",
                  bottom: isLandscape ? "9rem" : "13rem",
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: isLandscape ? "68px" : "76px",
                  height: isLandscape ? "68px" : "76px",
                  borderRadius: "50%",
                  background: "rgba(255,200,40,0.22)",
                  border: "3px solid #ffcc22",
                  boxShadow: "0 0 16px rgba(255,200,40,0.4)",
                  color: "#ffe79a",
                  fontFamily: "monospace",
                  fontSize: isLandscape ? "0.8rem" : "0.9rem",
                  letterSpacing: "0.12em",
                  fontWeight: "bold",
                  textShadow: "0 0 10px rgba(255,200,40,0.7)",
                  lineHeight: 1.15,
                  touchAction: "none",
                  userSelect: "none",
                  zIndex: 32,
                }}
              >
                {climbAtTop ? "↓" : "↑"}
                <br />
                {climbAtTop ? "降りる" : "登る"}
              </button>
            )}

            {/* Vehicle board / exit button — shown near a car or while driving.
                Routes through vehicleActionRef, the same path the PC "E" key
                feeds into for vehicles. Sits above the climb slot so the two
                never overlap (they rarely co-occur anyway). */}
            {(nearVehicle || inVehicle) && (
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault()
                  vehicleActionRef.current = true
                }}
                style={{
                  position: "absolute",
                  bottom: isLandscape ? "13rem" : "17.5rem",
                  right: isLandscape ? "1rem" : "2rem",
                  width: isLandscape ? "64px" : "72px",
                  height: isLandscape ? "64px" : "72px",
                  borderRadius: "50%",
                  background: "rgba(60,200,255,0.22)",
                  border: "3px solid #33ddff",
                  boxShadow: "0 0 16px rgba(60,200,255,0.4)",
                  color: "#bfefff",
                  fontFamily: "monospace",
                  fontSize: isLandscape ? "0.74rem" : "0.84rem",
                  letterSpacing: "0.08em",
                  fontWeight: "bold",
                  textShadow: "0 0 10px rgba(60,200,255,0.7)",
                  lineHeight: 1.15,
                  touchAction: "none",
                  userSelect: "none",
                  zIndex: 32,
                }}
              >
                {inVehicle ? "降りる" : "乗る"}
              </button>
            )}

            {/* AA gun mount / exit button (mobile) — PR-G1. Routes through
                aaMountActionRef, same path as the PC "E" key. Sits one slot
                higher than the vehicle button so they never overlap. */}
            {(nearAAGun || inAAGun) && (
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault()
                  aaMountActionRef.current = true
                }}
                style={{
                  position: "absolute",
                  bottom: isLandscape ? "20rem" : "25rem",
                  right: isLandscape ? "1rem" : "2rem",
                  width: isLandscape ? "64px" : "72px",
                  height: isLandscape ? "64px" : "72px",
                  borderRadius: "50%",
                  background: "rgba(255,170,60,0.22)",
                  border: "3px solid #ffaa33",
                  boxShadow: "0 0 16px rgba(255,170,60,0.4)",
                  color: "#ffe0b0",
                  fontFamily: "monospace",
                  fontSize: isLandscape ? "0.74rem" : "0.84rem",
                  letterSpacing: "0.08em",
                  fontWeight: "bold",
                  textShadow: "0 0 10px rgba(255,170,60,0.7)",
                  lineHeight: 1.15,
                  touchAction: "none",
                  userSelect: "none",
                  zIndex: 32,
                }}
              >
                {inAAGun ? "降りる" : "対空砲"}
              </button>
            )}

            {/* Jet flight controls (mobile): nose is the LEFT stick; these add
                throttle, machine gun and missile. */}
            {inJet && (
              <>
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    jetGunHeldRef.current = true
                  }}
                  onPointerUp={() => {
                    jetGunHeldRef.current = false
                  }}
                  onPointerLeave={() => {
                    jetGunHeldRef.current = false
                  }}
                  onPointerCancel={() => {
                    jetGunHeldRef.current = false
                  }}
                  style={{
                    position: "absolute",
                    bottom: "6rem",
                    right: "1.5rem",
                    width: "72px",
                    height: "72px",
                    borderRadius: "50%",
                    background: "rgba(255,60,60,0.22)",
                    border: "3px solid #ff5555",
                    color: "#ffd0d0",
                    fontFamily: "monospace",
                    fontSize: "0.78rem",
                    fontWeight: "bold",
                    touchAction: "none",
                    userSelect: "none",
                    zIndex: 32,
                  }}
                >
                  FIRE
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    jetMissileReqRef.current = true
                  }}
                  style={{
                    position: "absolute",
                    bottom: "10rem",
                    right: "1.5rem",
                    width: "68px",
                    height: "68px",
                    borderRadius: "50%",
                    background: "rgba(255,160,40,0.22)",
                    border: "3px solid #ffaa33",
                    color: "#ffe2b0",
                    fontFamily: "monospace",
                    fontSize: "0.66rem",
                    fontWeight: "bold",
                    touchAction: "none",
                    userSelect: "none",
                    zIndex: 32,
                  }}
                >
                  MSL
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    ejectReqRef.current = true
                  }}
                  style={{
                    position: "absolute",
                    bottom: "14rem",
                    right: "1.5rem",
                    width: "62px",
                    height: "62px",
                    borderRadius: "50%",
                    background: "rgba(255,230,60,0.2)",
                    border: "3px solid #ffe23a",
                    color: "#fff4b0",
                    fontFamily: "monospace",
                    fontSize: "0.6rem",
                    fontWeight: "bold",
                    touchAction: "none",
                    userSelect: "none",
                    zIndex: 32,
                  }}
                >
                  EJECT
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    jetThrottleRef.current = 1
                  }}
                  onPointerUp={() => {
                    jetThrottleRef.current = 0
                  }}
                  onPointerLeave={() => {
                    jetThrottleRef.current = 0
                  }}
                  onPointerCancel={() => {
                    jetThrottleRef.current = 0
                  }}
                  style={{
                    position: "absolute",
                    bottom: "10rem",
                    right: "7rem",
                    width: "66px",
                    height: "66px",
                    borderRadius: "50%",
                    background: "rgba(60,220,120,0.2)",
                    border: "3px solid #33dd77",
                    color: "#bfffd6",
                    fontFamily: "monospace",
                    fontSize: "0.66rem",
                    fontWeight: "bold",
                    touchAction: "none",
                    userSelect: "none",
                    zIndex: 32,
                  }}
                >
                  加速
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    jetThrottleRef.current = -1
                  }}
                  onPointerUp={() => {
                    jetThrottleRef.current = 0
                  }}
                  onPointerLeave={() => {
                    jetThrottleRef.current = 0
                  }}
                  onPointerCancel={() => {
                    jetThrottleRef.current = 0
                  }}
                  style={{
                    position: "absolute",
                    bottom: "6rem",
                    right: "7rem",
                    width: "66px",
                    height: "66px",
                    borderRadius: "50%",
                    background: "rgba(160,170,180,0.18)",
                    border: "3px solid #9aa4ae",
                    color: "#dfe6ee",
                    fontFamily: "monospace",
                    fontSize: "0.66rem",
                    fontWeight: "bold",
                    touchAction: "none",
                    userSelect: "none",
                    zIndex: 32,
                  }}
                >
                  減速
                </button>
              </>
            )}
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
