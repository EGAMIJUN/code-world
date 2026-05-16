import path from "node:path"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@code-world/ui"],
  // Resolve workspace root correctly (avoids lockfile detection warning)
  outputFileTracingRoot: path.join(__dirname, "../../"),
}

export default nextConfig
