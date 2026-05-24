import { achievements, db, inventory, leaderboard, submissions, users } from "@code-world/db"
import { type Job, Worker } from "bullmq"
import { sql } from "drizzle-orm"
import { eq } from "drizzle-orm"
import type IORedis from "ioredis"
import postgres from "postgres"
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

interface ProblemBody {
  description: string
  setup?: string
  expectedOutput?: unknown[][]
  expectedStdout?: string
  hints?: Array<{ level: number; text: string }>
  explanation?: string
}

function normalizeProblemBody(raw: unknown): ProblemBody {
  if (typeof raw !== "object" || raw === null) return { description: "" }
  const obj = raw as Record<string, unknown>
  return {
    description: typeof obj.description === "string" ? obj.description : "",
    setup: typeof obj.setup === "string" ? obj.setup : undefined,
    expectedOutput: Array.isArray(obj.expectedOutput)
      ? (obj.expectedOutput as unknown[][])
      : undefined,
    hints: Array.isArray(obj.hints)
      ? (obj.hints as Array<{ level: number; text: string }>)
      : undefined,
    explanation: typeof obj.explanation === "string" ? obj.explanation : undefined,
  }
}

function rowsToNormalized(rows: Record<string, unknown>[]): unknown[][] {
  return rows.map((row) => Object.values(row))
}

function compareOutputs(actual: unknown[][], expected: unknown[][]): boolean {
  const sortFn = (a: unknown[], b: unknown[]) => JSON.stringify(a).localeCompare(JSON.stringify(b))
  const sortedActual = [...actual].sort(sortFn)
  const sortedExpected = [...expected].sort(sortFn)
  return JSON.stringify(sortedActual) === JSON.stringify(sortedExpected)
}

function difficultyToBlockType(difficulty: number): "wood_block" | "stone_block" | "diamond_block" {
  if (difficulty >= 3) return "diamond_block"
  if (difficulty >= 2) return "stone_block"
  return "wood_block"
}

function difficultyToXp(difficulty: number): number {
  if (difficulty >= 3) return 200
  if (difficulty >= 2) return 100
  return 50
}

// XP needed to level up from level L to L+1 = 100 * (L + 1)
function computeLevel(totalXp: number): { level: number; xpInLevel: number; xpForNext: number } {
  let level = 0
  let consumed = 0
  for (;;) {
    const needed = 100 * (level + 1)
    if (consumed + needed > totalXp) {
      return { level, xpInLevel: totalXp - consumed, xpForNext: needed }
    }
    consumed += needed
    level++
  }
}

async function grantXpAndLevelUp(playerId: string, difficulty: number): Promise<void> {
  try {
    const xpGain = difficultyToXp(difficulty)
    const [updated] = await db
      .update(users)
      .set({ xp: sql`${users.xp} + ${xpGain}`, updatedAt: new Date() })
      .where(eq(users.id, playerId))
      .returning({ xp: users.xp, level: users.level })

    if (!updated) return

    const { level: newLevel } = computeLevel(updated.xp)
    if (newLevel !== updated.level) {
      await db
        .update(users)
        .set({ level: newLevel, updatedAt: new Date() })
        .where(eq(users.id, playerId))
    }

    console.log(
      `[Executor] Granted ${xpGain} XP to player ${playerId} (total: ${updated.xp}, level: ${newLevel})`,
    )
  } catch (err) {
    console.error("[Executor] Failed to grant XP:", err)
  }
}

type AchievementType = "first_ac" | "ten_solved" | "diamond_block" | "level_5"

async function grantAchievement(playerId: string, type: AchievementType): Promise<boolean> {
  try {
    const result = await db
      .insert(achievements)
      .values({ playerId, achievementType: type })
      .onConflictDoNothing()
      .returning()
    return result.length > 0
  } catch {
    return false
  }
}

async function checkAndGrantAchievements(playerId: string, blockType: string): Promise<void> {
  try {
    const user = await db.query.users.findFirst({
      where: (u, { eq: eqFn }) => eqFn(u.id, playerId),
    })
    if (!user) return

    const lbRow = await db.query.leaderboard.findFirst({
      where: (lb, { eq: eqFn }) => eqFn(lb.playerId, playerId),
    })
    const problemsSolved = lbRow?.problemsSolved ?? 0

    if (problemsSolved === 1) {
      await grantAchievement(playerId, "first_ac")
    }
    if (problemsSolved >= 10) {
      await grantAchievement(playerId, "ten_solved")
    }
    if (blockType === "diamond_block") {
      await grantAchievement(playerId, "diamond_block")
    }
    if (user.level >= 5) {
      await grantAchievement(playerId, "level_5")
    }
  } catch (err) {
    console.error("[Executor] Failed to check achievements:", err)
  }
}

async function updateLeaderboard(playerId: string, score: number): Promise<void> {
  try {
    await db
      .insert(leaderboard)
      .values({ playerId, totalScore: score, problemsSolved: 1 })
      .onConflictDoUpdate({
        target: [leaderboard.playerId],
        set: {
          totalScore: sql`${leaderboard.totalScore} + ${score}`,
          problemsSolved: sql`${leaderboard.problemsSolved} + 1`,
          updatedAt: new Date(),
        },
      })
  } catch (err) {
    console.error("[Executor] Failed to update leaderboard:", err)
  }
}

const JUDGE0_URL = process.env.JUDGE0_API_URL ?? ""
const JUDGE0_KEY = process.env.JUDGE0_API_KEY ?? ""

const LANGUAGE_IDS: Record<string, number> = {
  python: 71,
  javascript: 63,
  csharp: 51,
}

function getExpectedStdout(body: ProblemBody): string | null {
  if (body.expectedStdout) return body.expectedStdout
  if (body.expectedOutput && body.expectedOutput.length > 0) {
    return body.expectedOutput.flat().map(String).join("\n")
  }
  return null
}

async function executeWithJudge0(
  code: string,
  language: string,
  expectedStdout: string | null,
  timeoutMs: number,
): Promise<CodeExecutionJobResult> {
  const startMs = Date.now()

  if (!JUDGE0_URL) {
    return {
      result: "runtime_error",
      score: 0,
      execTimeMs: 0,
      feedback: { message: "Judge0 not configured (set JUDGE0_API_URL)" },
    }
  }

  const languageId = LANGUAGE_IDS[language]
  if (!languageId) {
    return {
      result: "runtime_error",
      score: 0,
      execTimeMs: 0,
      feedback: { message: `Unsupported language: ${language}` },
    }
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (JUDGE0_KEY) {
    headers["X-RapidAPI-Key"] = JUDGE0_KEY
    headers["X-RapidAPI-Host"] = "judge0-ce.p.rapidapi.com"
  }

  let token: string
  try {
    const submitRes = await fetch(`${JUDGE0_URL}/submissions?base64_encoded=false&wait=false`, {
      method: "POST",
      headers,
      body: JSON.stringify({ source_code: code, language_id: languageId, stdin: "" }),
    })
    if (!submitRes.ok) {
      return {
        result: "runtime_error",
        score: 0,
        execTimeMs: Date.now() - startMs,
        feedback: { message: `Judge0 submit failed: ${submitRes.status}` },
      }
    }
    const submitData = (await submitRes.json()) as { token: string }
    token = submitData.token
  } catch (err) {
    return {
      result: "runtime_error",
      score: 0,
      execTimeMs: Date.now() - startMs,
      feedback: { message: `Judge0 network error: ${String(err)}` },
    }
  }

  const deadline = startMs + Math.min(timeoutMs, 30_000)
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000))
    try {
      const getHeaders: Record<string, string> = {}
      if (JUDGE0_KEY) getHeaders["X-RapidAPI-Key"] = JUDGE0_KEY

      const getRes = await fetch(
        `${JUDGE0_URL}/submissions/${token}?base64_encoded=false&fields=status,stdout,stderr,compile_output,time`,
        { headers: getHeaders },
      )
      if (!getRes.ok) continue

      const data = (await getRes.json()) as {
        status: { id: number; description: string }
        stdout: string | null
        stderr: string | null
        compile_output: string | null
        time: string | null
      }

      if (data.status.id <= 2) continue

      const execTimeMs = Date.now() - startMs

      if (data.status.id === 5) {
        return {
          result: "time_limit_exceeded",
          score: 0,
          execTimeMs,
          feedback: { message: "Time limit exceeded" },
        }
      }

      if (data.status.id !== 3) {
        const msg = data.compile_output ?? data.stderr ?? data.status.description ?? "Runtime error"
        return { result: "runtime_error", score: 0, execTimeMs, feedback: { message: msg } }
      }

      const stdout = (data.stdout ?? "").trimEnd()

      if (expectedStdout === null) {
        return {
          result: "accepted",
          score: 100,
          execTimeMs,
          feedback: { message: "Accepted (no expected output defined)" },
        }
      }

      const isCorrect = stdout === expectedStdout.trimEnd()
      return {
        result: isCorrect ? "accepted" : "wrong_answer",
        score: isCorrect ? 100 : 0,
        execTimeMs,
        feedback: isCorrect
          ? { message: "Correct!" }
          : { message: "Output does not match expected", actual: stdout, expected: expectedStdout },
      }
    } catch {
      // ignore poll error, retry
    }
  }

  return {
    result: "time_limit_exceeded",
    score: 0,
    execTimeMs: Date.now() - startMs,
    feedback: { message: "Execution timed out waiting for Judge0" },
  }
}

async function executeSql(job: Job<CodeExecutionJobData>): Promise<CodeExecutionJobResult> {
  const { submissionId, problemId, code } = job.data
  const startMs = Date.now()

  console.log(`[Executor] Processing SQL submission ${submissionId}`)

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

  const connectionString =
    process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/codeworld"
  const sandboxSql = postgres(connectionString, { prepare: false, max: 1 })

  const sandboxSchema = `sandbox_${submissionId.replace(/-/g, "_").slice(0, 40)}`

  let actualRows: Record<string, unknown>[] = []
  let runtimeError: string | null = null

  try {
    await sandboxSql`CREATE SCHEMA IF NOT EXISTS ${sandboxSql(sandboxSchema)}`
    await sandboxSql`SET search_path TO ${sandboxSql(sandboxSchema)}`
    if (body.setup) {
      await sandboxSql.unsafe(body.setup)
    }
    const rows = await sandboxSql.unsafe(code)
    actualRows = rows as Record<string, unknown>[]
  } catch (err: unknown) {
    runtimeError = err instanceof Error ? err.message : String(err)
  } finally {
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

async function grantBlockReward(submissionId: string, problemId: string): Promise<void> {
  try {
    const [submission, problem] = await Promise.all([
      db.query.submissions.findFirst({ where: (s, { eq: eqFn }) => eqFn(s.id, submissionId) }),
      db.query.problems.findFirst({ where: (p, { eq: eqFn }) => eqFn(p.id, problemId) }),
    ])

    if (!submission || !problem) return
    // Skip the anonymous fallback player UUID
    if (submission.playerId === "00000000-0000-0000-0000-000000000000") return

    const blockType = difficultyToBlockType(problem.difficulty)

    await db
      .insert(inventory)
      .values({ playerId: submission.playerId, blockType, quantity: 1 })
      .onConflictDoUpdate({
        target: [inventory.playerId, inventory.blockType],
        set: {
          quantity: sql`${inventory.quantity} + 1`,
          updatedAt: new Date(),
        },
      })

    console.log(`[Executor] Granted ${blockType} to player ${submission.playerId}`)
  } catch (err) {
    console.error("[Executor] Failed to grant block reward:", err)
  }
}

async function executeJob(job: Job<CodeExecutionJobData>): Promise<CodeExecutionJobResult> {
  const { submissionId, problemId, language } = job.data
  const startMs = Date.now()

  console.log(`[Executor] Processing submission ${submissionId} (${language})`)

  let jobResult: CodeExecutionJobResult

  if (language === "sql") {
    // Enforce a 30-second hard timeout for SQL execution
    const SQL_TIMEOUT = 30_000
    jobResult = await Promise.race([
      executeSql(job),
      new Promise<CodeExecutionJobResult>((resolve) =>
        setTimeout(
          () =>
            resolve({
              result: "time_limit_exceeded",
              score: 0,
              execTimeMs: SQL_TIMEOUT,
              feedback: { message: "Execution time limit exceeded (30s)" },
            }),
          SQL_TIMEOUT,
        ),
      ),
    ])
  } else if (language === "python" || language === "javascript" || language === "csharp") {
    const problem = await db.query.problems.findFirst({
      where: (p, { eq: eqFn }) => eqFn(p.id, problemId),
    })
    const body = problem ? normalizeProblemBody(problem.body) : { description: "" }
    const expectedStdout = getExpectedStdout(body)
    const timeoutMs = job.data.timeoutMs ?? 10_000
    jobResult = await executeWithJudge0(code, language, expectedStdout, timeoutMs)
  } else {
    const execTimeMs = Date.now() - startMs
    jobResult = {
      result: "accepted",
      score: 100,
      execTimeMs,
      feedback: { message: `${language} accepted (stub)` },
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

  // Grant rewards on correct answer
  if (jobResult.result === "accepted") {
    await grantBlockReward(submissionId, problemId)
    const sub = await db.query.submissions.findFirst({
      where: (s, { eq: eqFn }) => eqFn(s.id, submissionId),
    })
    const prob = await db.query.problems.findFirst({
      where: (p, { eq: eqFn }) => eqFn(p.id, problemId),
    })
    if (sub && prob && sub.playerId !== "00000000-0000-0000-0000-000000000000") {
      await grantXpAndLevelUp(sub.playerId, prob.difficulty)
      await updateLeaderboard(sub.playerId, jobResult.score)
      const blockType = difficultyToBlockType(prob.difficulty)
      // Re-fetch user after XP/level update for accurate achievement check
      await checkAndGrantAchievements(sub.playerId, blockType)
    }
  }

  return jobResult
}

export function createCodeExecutionWorker(connection: IORedis) {
  const worker = new Worker<CodeExecutionJobData, CodeExecutionJobResult>(
    QUEUE_NAMES.CODE_EXECUTION,
    executeJob,
    {
      connection,
      concurrency: 5,
      // Lock duration: 45s. If a job takes longer the lock is released and another worker can retry.
      lockDuration: 45_000,
      // Stalledless: how often to check for stalled jobs (ms)
      stalledInterval: 15_000,
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
