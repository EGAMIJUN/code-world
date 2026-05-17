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
    process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@localhost:5432/codeworld"
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
  } else {
    const execTimeMs = Date.now() - startMs
    jobResult = {
      result: "accepted",
      score: 100,
      execTimeMs,
      feedback: { message: `${language} accepted` },
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
