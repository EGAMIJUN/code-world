import { db } from "@code-world/db"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  trustedOrigins: [
    process.env["BETTER_AUTH_URL"] ?? "http://localhost:3001",
    process.env["WEB_URL"] ?? "http://localhost:3000",
  ],
  socialProviders: {
    github: {
      clientId: process.env["GITHUB_CLIENT_ID"] ?? "",
      clientSecret: process.env["GITHUB_CLIENT_SECRET"] ?? "",
    },
  },
})
