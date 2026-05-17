import path from "node:path"
import { withSentryConfig } from "@sentry/nextjs"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@code-world/ui"],
  outputFileTracingRoot: path.join(__dirname, "../../"),
}

export default withSentryConfig(nextConfig, {
  org: process.env["SENTRY_ORG"] ?? "my-org",
  project: process.env["SENTRY_PROJECT"] ?? "code-world",
  silent: !process.env["CI"],
  sourcemaps: { disable: !process.env["SENTRY_AUTH_TOKEN"] },
  autoInstrumentServerFunctions: !!process.env["SENTRY_DSN"],
})
