import IORedis from "ioredis"
import { createQueues } from "./queues"
import { createCodeExecutionWorker } from "./workers/codeExecution"

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379"

// ── Redis connection ──────────────────────────────────────────────────────────
const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,
})

connection.on("connect", () => console.log("✅ Redis connected"))
connection.on("error", (err) => console.error("❌ Redis error:", err.message))

// ── Queues & Workers ──────────────────────────────────────────────────────────
const queues = createQueues(connection)
const codeExecutionWorker = createCodeExecutionWorker(connection)

console.log("⚙️  Executor started — listening for jobs...")

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown() {
  console.log("\n🛑 Shutting down executor...")
  await codeExecutionWorker.close()
  await queues.codeExecution.close()
  await queues.rewardGrant.close()
  connection.disconnect()
  process.exit(0)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

// Export queues for other apps to enqueue jobs
export { queues }
