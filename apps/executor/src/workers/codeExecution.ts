import { type Job, Worker } from "bullmq"
import type IORedis from "ioredis"
import { QUEUE_NAMES } from "../queues"

export interface CodeExecutionJobData {
  submissionId: string
  problemId: string
  code: string
  language: "sql" | "javascript" | "typescript" | "python" | "csharp"
  timeoutMs?: number
}

export interface CodeExecutionJobResult {
  result: "accepted" | "wrong_answer" | "runtime_error" | "time_limit_exceeded"
  score: number
  execTimeMs: number
  feedback?: Record<string, unknown>
}

export function createCodeExecutionWorker(connection: IORedis) {
  return new Worker<CodeExecutionJobData, CodeExecutionJobResult>(
    QUEUE_NAMES.CODE_EXECUTION,
    async (_job: Job<CodeExecutionJobData>) => {
      // Phase 1 pure-FPS: code execution is disabled.
      return {
        result: "runtime_error",
        score: 0,
        execTimeMs: 0,
        feedback: { error: "code execution disabled in pure-FPS phase" },
      }
    },
    { connection },
  )
}
