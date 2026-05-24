"use client"

// biome-ignore lint/complexity/useLiteralKeys: bracket notation required per CLAUDE.md
const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

export interface AuthUser {
  id: string
  username: string
}

interface AuthResponse {
  data?: { user: AuthUser }
  error?: string
}

async function postJson(path: string, body: unknown): Promise<AuthResponse> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as AuthResponse
  if (!res.ok) return { error: json.error ?? `HTTP ${res.status}` }
  return json
}

export function signup(username: string, password: string): Promise<AuthResponse> {
  return postJson("/api/auth/signup", { username, password })
}

export function login(username: string, password: string): Promise<AuthResponse> {
  return postJson("/api/auth/login", { username, password })
}

export async function logout(): Promise<void> {
  await fetch(`${API_URL}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  }).catch(() => {})
}

export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${API_URL}/api/auth/me`, { credentials: "include" })
    if (!res.ok) return null
    const json = (await res.json()) as { data?: { user: AuthUser } }
    return json.data?.user ?? null
  } catch {
    return null
  }
}

const GUEST_KEY = "cw_guest_nickname"

export function getGuestNickname(): string | null {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem(GUEST_KEY)
}

export function setGuestNickname(nickname: string): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(GUEST_KEY, nickname)
}

export function clearGuestNickname(): void {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(GUEST_KEY)
}
