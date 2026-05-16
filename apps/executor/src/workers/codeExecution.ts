import { db, submissions, problems } from "@code-world/db"
import { type Job, Worker } from "bullmq"
import { eq } from "drizzle-orm"
import type IORedis from "ioredis"
import postgres from "postgres"
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

interface ProblemBody {
  description: string
  setup?: string
  expectedOutput?: unknown[][]
  hints?: Array<{ level: number; text: string }>
  explanation?: string
}

function normalizeProblemBody(raw: unknown): ProblemBody {
  if (typeof raw !== "object" || raw === null) return { description: "" }
  const obj = raw as Record<string, unknown>
  return {
    description: typeof obj["description"] === "string" ? obj["description"] : "",
    setup: typeof obj["setup"] === "string" ? obj["setup"] : undefined,
    expectedOutput: Array.isArray(obj["expectedOutput"])
      ? (obj["expectedOutput"] as unknown[][])
      : undefined,
    hints: Array.isArray(obj["hints"])
      ? (obj["hints"] as Array<{ level: number; text: string }>)
      : undefined,
    explanation: typeof obj["explanation"] === "string" ? obj["explanation"] : undefined,
  }
}

function rowsToNormalized(rows: Record<string, unknown>[]): unknown[][] {
  return rows.map((row) => Object.values(row))
}

function compareOutputs(actual: unknown[][], expected: unknown[][]): boolean {
  const sortFn = (a: unknown[], b: unknown[]) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b))
  const sortedActual = [...actual].sort(sortFn)
  const sortedExpected = [...expected].sort(sortFn)
  return JSON.stringify(sortedActual) === JSON.stringify(sortedExpected)
}

async function executeSql(job: Job<CodeExecutionJobData>): Promise<CodeExecutionJobResult> {
  const { submissionId, problemId, code } = job.data
  const startMs = Date.now()

  console.log(`[Executor] Processing SQL submission ${submissionId}`)

  // Fetch the problem to get setup SQL and expected output
  const problem = await db.query.problems.findFirst({
    where: (p, { eq: eqFn }) => eqFn(p.id, problemId),
  })

  if (!problem) {
    const execTimeMs = Date.now() - startMs
    return {
      result: "runtime_error",
      score: 0,
      execTimeMs,
      feedback: { message: "Problem not found" },
    }
  }

  const body = normalizeProblemBody(problem.body)

  if (!body.setup) {
    const execTimeMs = Date.now() - startMs
    return {
      result: "runtime_error",
      score: 0,
      execTimeMs,
      feedback: { message: "Problem has no setup SQL" },
    }
  }

  // Create a separate postgres connection for sandboxed execution
  const connectionString =
    process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@localhost:5432/codeworld"
  const sandboxSql = postgres(connectionString, { prepare: false, max: 1 })

  const sandboxSchema = `sandbox_${submissionId.replace(/-/g, "_").slice(0, 40)}`

  let actualRows: Record<string, unknown>[] = []
  let runtimeError: string | null = null

  try {
    // Create sandbox schema and set search_path
    await sandboxSql`CREATE SCHEMA IF NOT EXISTS ${sandboxSql(sandboxSchema)}`
    await sandboxSql`SET search_path TO ${sandboxSql(sandboxSchema)}`

    // Execute setup DDL+DML
    await sandboxSql.unsafe(body.setup)

    // Execute student code and capture result
    const rows = await sandboxSql.unsafe(code)
    actualRows = rows as Record<string, unknown>[]
  } catch (err: unknown) {
    runtimeError = err instanceof Error ? err.message : String(err)
  } finally {
    // Always drop sandbox schema for isolation
    try {
      await sandboxSql`DROP SCHEMA IF EXISTS ${sandboxSql(sandboxSchema)} CASCADE`
    } catch {
      // ignore cleanup errors
    }
    await sandboxSql.end()
  }

  const execTimeMs = Date.now() - startMs

  if (runtimeError !== null) {
    return {
      result: "runtime_error",
      score: 0,
      execTimeMs,
      feedback: { message: runtimeError },
    }
  }

  if (!body.expectedOutput) {
    // No expected output defined — accept all
    return {
      result: "accepted",
      score: 100,
      execTimeMs,
      feedback: { message: "No expected output defined; accepted by default." },
    }
  }

  const actualNormalized = rowsToNormalized(actualRows)
  const isCorrect = compareOutputs(actualNormalized, body.expectedOutput)

  return {
    result: isCorrect ? "accepted" : "wrong_answer",
    score: isCorrect ? 100 : 0,
    execTimeMs,
    feedback: isCorrect
      ? { message: "Correct!" }
      : {
          message: "Output does not match expected result.",
          actual: actualNormalized,
          expected: body.expectedOutput,
        },
  }
}

async function executeJob(job: Job<CodeExecutionJobData>): Promise<CodeExecutionJobResult> {
  const { submissionId, language } = job.data
  const startMs = Date.now()

  console.log(`[Executor] Processing submission ${submissionId} (${language})`)

  let jobResult: CodeExecutionJobResult

  if (language === "sql") {
    jobResult = await executeSql(job)
  } else {
    // Stub for non-SQL languages
    const execTimeMs = Date.now() - startMs
    jobResult = {
      result: "accepted",
      score: 100,
      execTimeMs,
      feedback: { message: `Stub execution for ${language} — not yet implemented` },
    }
  }

  // Update submission in DB
  await db
    .update(submissions)
    .set({
      result: jobResult.result,
      score: jobResult.score,
      execTimeMs: jobResult.execTimeMs,
      feedback: jobResult.feedback ?? null,
    })
    .where(eq(submissions.id, submissionId))

  return jobResult
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
