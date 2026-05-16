import IORedis from "ioredis"
import { Queue } from "bullmq"

const redis = new IORedis(process.env["REDIS_URL"] ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
})

export const codeExecutionQueue = new Queue("code-execution", { connection: redis })
