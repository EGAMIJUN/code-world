import type { Context } from "hono"

const COUNTRY_RE = /^[A-Z]{2}$/

export function getCountryCode(c: Context): string | null {
  const candidates = [
    c.req.header("cf-ipcountry"),
    c.req.header("x-vercel-ip-country"),
    c.req.header("x-country-code"),
    c.req.header("x-appengine-country"),
  ]
  for (const raw of candidates) {
    if (!raw) continue
    const v = raw.toUpperCase()
    if (COUNTRY_RE.test(v) && v !== "XX") return v
  }
  return null
}
