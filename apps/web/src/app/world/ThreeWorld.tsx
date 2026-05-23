"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import * as THREE from "three"

// ── Constants ──────────────────────────────────────────────────────────────────
const MAP_SIZE = 32
const TILE_UNIT = 1
const BLOCK_HEIGHT = 0.5
const EYE_HEIGHT = 1.6
const MOVE_SPEED = 6
const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

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
  { startTX: 0, endTX: 9, color: 0x0d2545, label: "SQL District", labelColor: "#6ab0ff" },
  { startTX: 10, endTX: 21, color: 0x0d2e13, label: "Algorithm Forest", labelColor: "#5aef5a" },
  { startTX: 22, endTX: 31, color: 0x1a0d38, label: "System Design City", labelColor: "#c06aff" },
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
  focalPoint: THREE.Vector3
  groundPlane: THREE.Mesh
  raycaster: THREE.Raycaster
  pointer: THREE.Vector2
  playerMesh: THREE.Mesh
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
  const placeCenterRef = useRef<(() => void) | null>(null)

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

  useEffect(() => {
    selectedBlockRef.current = selectedBlock
  }, [selectedBlock])

  useEffect(() => {
    setIsMobile(navigator.maxTouchPoints > 0)
  }, [])

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

  // ── Create/update a block mesh ─────────────────────────────────────────────
  const spawnBlock = useCallback(
    (tx: number, ty: number, tz: number, blockType: string, blockId?: string, placedBy?: string) => {
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
      const ambient = new THREE.AmbientLight(0x334466, 0.8)
      scene.add(ambient)
      const sun = new THREE.DirectionalLight(0xffffff, 1.2)
      sun.position.set(20, 40, 10)
      sun.castShadow = true
      sun.shadow.mapSize.set(2048, 2048)
      sun.shadow.camera.near = 0.5
      sun.shadow.camera.far = 100
      sun.shadow.camera.left = -40
      sun.shadow.camera.right = 40
      sun.shadow.camera.top = 40
      sun.shadow.camera.bottom = -40
      scene.add(sun)

      // ── Ground zones ───────────────────────────────────────────────────────
      for (const zone of ZONES) {
        const w = (zone.endTX - zone.startTX + 1) * TILE_UNIT
        const d = MAP_SIZE * TILE_UNIT
        const geo = new THREE.PlaneGeometry(w, d)
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

      // Local player mesh — hidden in FPS but position used for WS sync
      const playerGeo = new THREE.CapsuleGeometry(0.22, 0.5, 4, 8)
      const playerMat = new THREE.MeshLambertMaterial({ color: 0x00ff41 })
      const playerMesh = new THREE.Mesh(playerGeo, playerMat)
      playerMesh.visible = false
      scene.add(playerMesh)

      sceneRef.current = {
        scene,
        camera,
        renderer,
        blockMeshes,
        blocksGrid,
        remoteMeshes,
        focalPoint,
        groundPlane,
        raycaster,
        pointer,
        playerMesh,
      }

      fetch(`${API_URL}/api/me`, { credentials: "include" })
        .then((r) => r.json() as Promise<{ data?: { user?: { id?: string } } }>)
        .then((json) => { userIdRef.current = json.data?.user?.id ?? null })
        .catch(() => {})

      for (const block of initialBlocks) {
        spawnBlock(block.positionX, block.positionY, block.positionZ, block.blockType, block.id, block.placedBy)
      }

      // ── Place at crosshair (center screen) ─────────────────────────────────
      function placeAtCenter() {
        if (!selectedBlockRef.current || pendingPlaceRef.current) return
        pointer.set(0, 0)
        raycaster.setFromCamera(pointer, camera)
        const blockHits = raycaster.intersectObjects([...blockMeshes.values()], false)
        if (blockHits.length > 0) {
          const hit = blockHits[0]!
          const normal = hit.face?.normal
          if (normal && normal.y > 0.5) {
            const p = hit.point
            const tx = Math.floor((p.x + 0.001) / TILE_UNIT)
            const ty = Math.floor((p.z + 0.001) / TILE_UNIT)
            if (tx >= 0 && tx < MAP_SIZE && ty >= 0 && ty < MAP_SIZE) {
              placeBlock(tx, ty).catch(() => {})
            }
            return
          }
        }
        const groundHits = raycaster.intersectObject(groundPlane)
        if (groundHits.length > 0) {
          const p = groundHits[0]!.point
          const tx = Math.floor(p.x / TILE_UNIT)
          const ty = Math.floor(p.z / TILE_UNIT)
          if (tx >= 0 && tx < MAP_SIZE && ty >= 0 && ty < MAP_SIZE) {
            placeBlock(tx, ty).catch(() => {})
          }
        }
      }
      placeCenterRef.current = placeAtCenter

      // ── Destroy at crosshair ───────────────────────────────────────────────
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

      // ── PointerLock mouse look ─────────────────────────────────────────────
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
        if (e.button === 0 && selectedBlockRef.current) {
          placeAtCenter()
        }
      }

      function onContextMenu(e: MouseEvent) {
        e.preventDefault()
        if (document.pointerLockElement !== renderer.domElement) return
        destroyAtCenter()
      }

      // ── Mobile long press: destroy; short tap: place ───────────────────────
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
          if (Date.now() - touchStartTime < 600) {
            placeAtCenter()
          }
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

      // ── Resize ─────────────────────────────────────────────────────────────
      function onResize() {
        if (!container) return
        camera.aspect = container.clientWidth / container.clientHeight
        camera.updateProjectionMatrix()
        renderer.setSize(container.clientWidth, container.clientHeight)
      }
      window.addEventListener("resize", onResize)

      // ── Animation loop ─────────────────────────────────────────────────────
      const clock = new THREE.Clock()

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
          const rtX = Math.cos(camState.yaw)
          const rtZ = -Math.sin(camState.yaw)
          refs.focalPoint.x += (fwdX * (-vz) + rtX * vx) * MOVE_SPEED * dt
          refs.focalPoint.z += (fwdZ * (-vz) + rtZ * vx) * MOVE_SPEED * dt
          refs.focalPoint.x = Math.max(0, Math.min(MAP_SIZE * TILE_UNIT, refs.focalPoint.x))
          refs.focalPoint.z = Math.max(0, Math.min(MAP_SIZE * TILE_UNIT, refs.focalPoint.z))
          updateCamera()
        }

        // Mobile look joystick
        const lJoy = lookJoyRef.current
        if (lJoy.vx !== 0 || lJoy.vy !== 0) {
          camState.yaw -= lJoy.vx * 2.5 * dt
          camState.pitch = clampPitch(camState.pitch - lJoy.vy * 2 * dt)
          updateCamera()
        }

        // Sync player mesh position (hidden but used by WS)
        refs.playerMesh.position.set(refs.focalPoint.x, EYE_HEIGHT, refs.focalPoint.z)

        // Update remote player meshes
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

        // Tag game coloring
        const tg = tagGameRef.current
        for (const [rmId, rmesh] of refs.remoteMeshes) {
          const rstate = remotePosRef.current[rmId]
          const rmat = rmesh.material as THREE.MeshLambertMaterial
          const wantRed = tg?.running === true && rstate?.username === tg.itUsername
          const wantHex = wantRed ? 0xff3333 : 0xffcc00
          if (rmat.color.getHex() !== wantHex) rmat.color.setHex(wantHex)
        }

        // Draw minimap
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
            const snap = remotePosRef.current
            for (const rp of Object.values(snap)) {
              const { tx: rtx, ty: rty } = canvasToTile(rp.x, rp.y)
              ctx.fillStyle = "#ffcc00"
              ctx.beginPath()
              ctx.arc(
                (rtx * TILE_UNIT + TILE_UNIT / 2) * SCALE,
                (rty * TILE_UNIT + TILE_UNIT / 2) * SCALE,
                2.5, 0, Math.PI * 2,
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
      .then((fn) => { cleanup = fn })
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
      placeCenterRef.current = null
      cleanup?.()
    }
  }, [spawnBlock, placeBlock, destroyBlock, fetchInventory, fetchPlayerStats, showNotification])

  // ── Keyboard events ────────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      keysRef.current.add(e.key)
      if (e.key === "Escape") setSelectedBlock(null)
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
  }, [])

  // ── WebSocket position sync ────────────────────────────────────────────────
  useEffect(() => {
    if (isLoading) return

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
          running?: boolean
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
          setChatMessages((prev) => {
            const next = [
              ...prev,
              { id: ++msgIdRef.current, from: msg.from ?? "?", text: msg.text ?? "", isSystem },
            ]
            return next.slice(-20)
          })
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
          const winner = msg.winner ?? "?"
          setChatMessages((prev) => {
            const next = [
              ...prev,
              { id: ++msgIdRef.current, from: "SYSTEM", text: `鬼ごっこ終了！最も逃げた: ${winner}`, isSystem: true },
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

  // ── Tag game countdown ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!tagGame?.running) return
    const interval = setInterval(() => {
      setTagGame((prev) => {
        if (!prev?.running) return prev
        const newMs = Math.max(0, prev.remainingMs - 1000)
        const next = { ...prev, remainingMs: newMs }
        tagGameRef.current = next
        return next
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [tagGame?.running])

  // ── Move joystick handlers ─────────────────────────────────────────────────
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

  // ── Look joystick handlers ─────────────────────────────────────────────────
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
    if (lookJoyThumbRef.current) {
      lookJoyThumbRef.current.style.transform = `translate(${nx}px, ${ny}px)`
    }
  }, [])

  const handleLookJoyEnd = useCallback(() => {
    lookJoyBaseRef.current = null
    lookJoyRef.current = { vx: 0, vy: 0 }
    if (lookJoyThumbRef.current) {
      lookJoyThumbRef.current.style.transform = "translate(0px, 0px)"
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

  // ── HUD ────────────────────────────────────────────────────────────────────
  const { level, xpInLevel, xpForNext } = computeXpProgress(playerStats.xp)
  const xpPct = xpForNext > 0 ? Math.round((xpInLevel / xpForNext) * 100) : 0

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
      {/* ── HUD bar ──────────────────────────────────────────────────────────── */}
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
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

        <span
          style={{ color: "#003300", fontSize: "0.7rem", letterSpacing: "0.1em" }}
          className="hidden sm:block"
        >
          WASD: MOVE · MOUSE: LOOK · CLICK: PLACE · R-CLICK: DESTROY
        </span>

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
          <span style={{ color: "#00ff41", fontSize: "0.7rem", letterSpacing: "0.1em" }}>
            {onlineCount} ONLINE
          </span>
        </div>

        {/* Tag game button / status */}
        {!isLoading && !error && (
          <>
            {!tagGame?.running ? (
              <button
                type="button"
                onClick={() => {
                  if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ type: "tag_start" }))
                  }
                }}
                style={{
                  background: "transparent",
                  border: "1px solid #003300",
                  color: "#005500",
                  fontFamily: "monospace",
                  fontSize: "0.65rem",
                  letterSpacing: "0.1em",
                  padding: "0.2rem 0.6rem",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                TAG
              </button>
            ) : (
              <div
                style={{
                  color: "#ff3333",
                  fontSize: "0.7rem",
                  letterSpacing: "0.1em",
                  border: "1px solid #550000",
                  padding: "0.2rem 0.6rem",
                  whiteSpace: "nowrap",
                }}
              >
                IT: {tagGame.itUsername} · {Math.ceil(tagGame.remainingMs / 1000)}s
              </div>
            )}
          </>
        )}

        {notification && (
          <span
            style={{
              fontSize: "0.75rem",
              color: "#00ff41",
              border: "1px solid #00ff41",
              padding: "0.2rem 0.75rem",
              textShadow: "0 0 8px #00ff41",
            }}
          >
            {notification}
          </span>
        )}
      </div>

      {/* ── Three.js canvas area ─────────────────────────────────────────────── */}
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        <div ref={mountRef} style={{ width: "100%", height: "100%" }} />

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
              LOGIN
            </a>
          </div>
        )}

        {/* ENTER WORLD overlay (desktop, not yet locked) */}
        {!isMobile && !isLoading && !error && !isPointerLocked && (
          <div
            onClick={() => rendererDomRef.current?.requestPointerLock()}
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "1rem",
              background: "rgba(0,0,0,0.55)",
              cursor: "pointer",
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
              CLICK TO LOCK MOUSE
            </div>
          </div>
        )}

        {/* Crosshair */}
        {!isLoading && !error && (isPointerLocked || isMobile) && (
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              pointerEvents: "none",
              zIndex: 30,
            }}
          >
            <line x1="10" y1="2" x2="10" y2="8" stroke="#00ff41" strokeWidth="1.5" opacity="0.8" />
            <line x1="10" y1="12" x2="10" y2="18" stroke="#00ff41" strokeWidth="1.5" opacity="0.8" />
            <line x1="2" y1="10" x2="8" y2="10" stroke="#00ff41" strokeWidth="1.5" opacity="0.8" />
            <line x1="12" y1="10" x2="18" y2="10" stroke="#00ff41" strokeWidth="1.5" opacity="0.8" />
            <circle cx="10" cy="10" r="1" fill="#00ff41" opacity="0.6" />
          </svg>
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

        {/* Move joystick (mobile, bottom-left) */}
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

        {/* Look joystick (mobile, bottom-right) */}
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

        {/* World chat */}
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
                maxHeight: "100px",
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
                    color: m.isSystem ? "#00aaff" : "#00ff41",
                    background: "rgba(0,0,0,0.75)",
                    padding: "2px 6px",
                    letterSpacing: "0.04em",
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
                  fontSize: "0.68rem",
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
          <a
            href="/dungeon"
            style={{ color: "#00aa2a", marginLeft: "0.5rem", textDecoration: "underline" }}
          >
            /dungeon へ
          </a>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span
            style={{ flexShrink: 0, color: "#003300", fontSize: "0.65rem", letterSpacing: "0.2em" }}
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
                      }}
                    >
                      <span
                        style={{
                          width: "8px",
                          height: "8px",
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
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ color: "#00ff41", fontSize: "0.7rem", letterSpacing: "0.1em" }}>
                SELECTED
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
