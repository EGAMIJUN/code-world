import type { Metadata } from "next"
import WorldClient from "./WorldClient"

export const metadata: Metadata = {
  title: "ゲームワールド — CODE WORLD",
}

export default function WorldPage() {
  return <WorldClient />
}
