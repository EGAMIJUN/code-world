import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env["SENTRY_DSN"],
  enabled: !!process.env["SENTRY_DSN"],
  environment: process.env["NODE_ENV"] ?? "development",
  tracesSampleRate: 0.2,
})
