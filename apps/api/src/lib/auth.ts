import { authAccount, authSession, authUser, authVerification, db } from "@code-world/db"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"

export const auth = betterAuth({
  secret: process.env["BETTER_AUTH_SECRET"] ?? "change-this-to-a-long-random-secret",
  database: drizzleAdapter(db, {
    provider: "pg",
    // Map Better Auth model names to our schema exports
    schema: {
      user: authUser,
      session: authSession,
      account: authAccount,
      verification: authVerification,
    },
  }),
  trustedOrigins: [
    "https://code-worldweb-production.up.railway.app",
    process.env["BETTER_AUTH_URL"] ?? "http://localhost:3001",
    process.env["WEB_URL"] ?? "http://localhost:3000",
    "http://localhost:3000",
  ],
  advanced: {
    crossSubdomainCookies: {
      enabled: false,
    },
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    github: {
      clientId: process.env["GITHUB_CLIENT_ID"] ?? "",
      clientSecret: process.env["GITHUB_CLIENT_SECRET"] ?? "",
    },
  },
})
