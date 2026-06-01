import type { Metadata } from "next"
import WorldClient from "./WorldClient"

export const metadata: Metadata = {
  title: "ゲームワールド — BANG BANG",
}

export default function WorldPage() {
  return <WorldClient />
}
