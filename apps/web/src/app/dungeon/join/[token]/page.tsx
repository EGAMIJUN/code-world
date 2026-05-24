"use client"

import { useParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"

export default function DungeonJoinPage() {
  const params = useParams()
  const router = useRouter()
  const token = String(params.token ?? "")
  const [status, setStatus] = useState<"joining" | "success" | "error">("joining")
  const [error, setError] = useState("")
  const [dungeonId, setDungeonId] = useState("")

  useEffect(() => {
    async function join() {
      try {
        const res = await fetch(`${API_URL}/api/dungeons/join/${token}`, {
          method: "POST",
          credentials: "include",
        })
        if (res.ok) {
          const json = (await res.json()) as { data: { dungeonId: string } }
          setDungeonId(json.data.dungeonId)
          setStatus("success")
          setTimeout(() => router.push(`/dungeon/${json.data.dungeonId}`), 1500)
        } else {
          const json = (await res.json()) as { error?: string }
          setError(json.error ?? "参加できませんでした")
          setStatus("error")
        }
      } catch {
        setError("接続エラーが発生しました")
        setStatus("error")
      }
    }
    if (token) join()
  }, [token, router])

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#000",
        fontFamily: "monospace",
        color: "#00ff41",
        gap: "1.5rem",
      }}
    >
      {status === "joining" && (
        <div style={{ fontSize: "1.2rem", letterSpacing: "0.3em", textShadow: "0 0 20px #00ff41" }}>
          ⟳ JOINING DUNGEON...
        </div>
      )}
      {status === "success" && (
        <>
          <div style={{ fontSize: "1.2rem", letterSpacing: "0.3em", color: "#00ff41" }}>
            ✓ CO-OP JOINED — REDIRECTING...
          </div>
          {dungeonId && (
            <a
              href={`/dungeon/${dungeonId}`}
              style={{ color: "#00aa2a", textDecoration: "underline" }}
            >
              クリックしてもダンジョンへ
            </a>
          )}
        </>
      )}
      {status === "error" && (
        <>
          <div style={{ fontSize: "1rem", color: "#ff3333", letterSpacing: "0.2em" }}>
            ⚠ {error}
          </div>
          <a
            href="/dungeon"
            style={{
              color: "#00ff41",
              border: "1px solid #00ff41",
              padding: "0.5rem 1.5rem",
              textDecoration: "none",
              letterSpacing: "0.15em",
            }}
          >
            ← DUNGEON SELECT
          </a>
        </>
      )}
    </div>
  )
}
