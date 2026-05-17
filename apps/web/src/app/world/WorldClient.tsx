"use client"

import dynamic from "next/dynamic"

const ThreeWorld = dynamic(() => import("./ThreeWorld"), {
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
      ⟳ LOADING 3D WORLD...
    </div>
  ),
})

export default function WorldClient() {
  return <ThreeWorld />
}
