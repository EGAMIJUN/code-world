import { db, submissions } from "@code-world/db"
import { type Job, Worker } from "bullmq"
import { eq } from "drizzle-orm"
import type IORedis from "ioredis"
import { QUEUE_NAMES } from "../queues"

export interface CodeExecutionJobData {
  submissionId: string
  problemId: string
  code: string
  language: "sql" | "javascript" | "typescript"
  timeoutMs?: number
}

export interface CodeExecutionJobResult {
  result: "accepted" | "wrong_answer" | "runtime_error" | "time_limit_exceeded"
  score: number
  execTimeMs: number
  feedback?: Record<string, unknown>
}

async function executeJob(job: Job<CodeExecutionJobData>): Promise<CodeExecutionJobResult> {
  const { submissionId, code, language } = job.data
  const startMs = Date.now()

  console.log(`[Executor] Processing submission ${submissionId} (${language})`)

  // TODO: implement sandboxed execution
  // For now, return a stub result
  const execTimeMs = Date.now() - startMs

  const result: CodeExecutionJobResult = {
    result: "accepted",
    score: 100,
    execTimeMs,
    feedback: { message: "Stub execution — implement sandboxed runner" },
  }

  // Update submission in DB
  await db
    .update(submissions)
    .set({
      result: result.result,
      score: result.score,
      execTimeMs: result.execTimeMs,
      feedback: result.feedback ?? null,
    })
    .where(eq(submissions.id, submissionId))

  return result
}

export function createCodeExecutionWorker(connection: IORedis) {
  const worker = new Worker<CodeExecutionJobData, CodeExecutionJobResult>(
    QUEUE_NAMES.CODE_EXECUTION,
    executeJob,
    {
      connection,
      concurrency: 5,
    },
  )

  worker.on("completed", (job, result) => {
    console.log(`[Executor] Job ${job.id} completed: ${result.result} in ${result.execTimeMs}ms`)
  })

  worker.on("failed", (job, err) => {
    console.error(`[Executor] Job ${job?.id} failed:`, err.message)
  })

  worker.on("error", (err) => {
    console.error("[Executor] Worker error:", err)
  })

  return worker
}
