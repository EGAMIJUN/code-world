import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@code-world/ui"],
  experimental: {
    // React 19 compatibility
    reactCompiler: false,
  },
}

export default nextConfig
