import * as Sentry from "@sentry/node"

export function initSentry() {
  const dsn = process.env.SENTRY_DSN
  Sentry.init({
    dsn,
    enabled: !!dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0.2,
  })
}

export { Sentry }
