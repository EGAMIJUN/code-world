import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/codeworld"

// Disable prefetch for serverless / short-lived environments
const client = postgres(connectionString, { prepare: false })

export const db = drizzle(client, { schema, logger: process.env.NODE_ENV === "development" })
