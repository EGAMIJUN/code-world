"use client"

import { useEffect, useRef } from "react"

export default function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener("resize", resize)

    const chars = "アイウエオカキクケコ0123456789ABCDEF<>{}SELECTFROMWHERE"
    const fontSize = 13
    const columns = Math.floor(canvas.width / fontSize)
    const drops: number[] = Array(columns).fill(1)

    const draw = () => {
      ctx.fillStyle = "rgba(0,0,0,0.05)"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = "#00ff41"
      ctx.font = `${fontSize}px monospace`
      for (let i = 0; i < drops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)] ?? ""
        const drop = drops[i] ?? 0
        ctx.fillText(char, i * fontSize, drop * fontSize)
        if (drop * fontSize > canvas.height && Math.random() > 0.975) drops[i] = 0
        drops[i] = (drops[i] ?? 0) + 1
      }
    }

    const interval = setInterval(draw, 55)
    return () => {
      clearInterval(interval)
      window.removeEventListener("resize", resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        zIndex: 0,
        opacity: 0.3,
        pointerEvents: "none",
      }}
    />
  )
}
