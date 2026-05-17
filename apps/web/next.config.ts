import path from "node:path"
import { withSentryConfig } from "@sentry/nextjs"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@code-world/ui"],
  outputFileTracingRoot: path.join(__dirname, "../../"),
}

export default withSentryConfig(nextConfig, {
  org: process.env["SENTRY_ORG"],
  project: process.env["SENTRY_PROJECT"] ?? "code-world",
  // Source maps are uploaded only when SENTRY_AUTH_TOKEN is set (CI/CD)
  silent: !process.env["CI"],
  // Disable source map upload in local dev to avoid CLI prompts
  sourcemaps: { disable: !process.env["SENTRY_AUTH_TOKEN"] },
  // Avoid adding Sentry auto-instrumentation in dev when DSN is absent
  autoInstrumentServerFunctions: !!process.env["SENTRY_DSN"],
})
