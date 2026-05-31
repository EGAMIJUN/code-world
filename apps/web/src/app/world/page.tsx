import type { Metadata } from "next"
import WorldClient from "./WorldClient"

export const metadata: Metadata = {
  title: "ゲームワールド — 鉄火 TEKKA",
}

export default function WorldPage() {
  return <WorldClient />
}
