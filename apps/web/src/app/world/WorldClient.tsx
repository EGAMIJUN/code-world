"use client"

import dynamic from "next/dynamic"

const PhaserGame = dynamic(() => import("./PhaserGame"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        display: "flex",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        background: "#000",
        fontFamily: "monospace",
        color: "#00aa2a",
        letterSpacing: "0.25em",
        fontSize: "0.9rem",
      }}
    >
      ⟳ LOADING WORLD DATA...
    </div>
  ),
})

export default function WorldClient() {
  return <PhaserGame />
}
