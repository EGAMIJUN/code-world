'use client'

import dynamic from "next/dynamic"
import { useCallback, useState } from "react"

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false })

type SubmissionStatus = "idle" | "submitting" | "polling" | "done"
type JudgeResult = "accepted" | "wrong_answer" | "runtime_error" | "time_limit_exceeded"
type JudgeResultOrNull = JudgeResult | null
type ApiSubmissionResult = JudgeResult | "pending" | null

interface Problem {
  id: string
  title: string
  difficulty: number
  category: string
  body: {
    description: string
    setup?: string
    hints?: Array<{ level: number; text: string }>
  }
}

interface SubmissionResponse {
  id: string
  status: string
}

interface SubmissionResult {
  data: {
    result: ApiSubmissionResult
    score: number
    feedback: Record<string, unknown> | null
  }
}

const RESULT_CONFIG: Record<
  NonNullable<JudgeResult>,
  { icon: string; label: string; className: string }
> = {
  accepted: {
    icon: "✅",
    label: "Accepted — 正解！",
    className: "bg-green-50 border-green-200 text-green-800 dark:bg-green-950 dark:border-green-800 dark:text-green-200",
  },
  wrong_answer: {
    icon: "❌",
    label: "Wrong Answer — 不正解",
    className: "bg-red-50 border-red-200 text-red-800 dark:bg-red-950 dark:border-red-800 dark:text-red-200",
  },
  runtime_error: {
    icon: "⚠️",
    label: "Runtime Error — 実行エラー",
    className: "bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-950 dark:border-yellow-800 dark:text-yellow-200",
  },
  time_limit_exceeded: {
    icon: "⏱️",
    label: "Time Limit Exceeded — 時間超過",
    className: "bg-orange-50 border-orange-200 text-orange-800 dark:bg-orange-950 dark:border-orange-800 dark:text-orange-200",
  },
}

const DIFFICULTY_LABELS: Record<number, string> = {
  0: "Lv.0 入門",
  1: "Lv.1 基礎",
  2: "Lv.2 中級",
  3: "Lv.3 上級",
}

export default function ProblemEditor({ problem }: { problem: Problem }) {
  const [code, setCode] = useState("-- ここにSQLを書いてください\nSELECT ")
  const [status, setStatus] = useState<SubmissionStatus>("idle")
  const [result, setResult] = useState<JudgeResultOrNull>(null)
  const [feedback, setFeedback] = useState<Record<string, unknown> | null>(null)

  const apiUrl = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

  const pollSubmission = useCallback(
    async (submissionId: string, retries = 0): Promise<void> => {
      if (retries >= 30) {
        setStatus("done")
        setResult("runtime_error")
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 800))

      try {
        const res = await fetch(`${apiUrl}/api/submissions/${submissionId}`)
        if (!res.ok) {
          setStatus("done")
          setResult("runtime_error")
          return
        }
        const json = (await res.json()) as SubmissionResult
        const sub = json.data

        if (sub.result !== "pending" && sub.result !== null && sub.result !== undefined) {
          setResult(sub.result as JudgeResult)
          setFeedback(sub.feedback)
          setStatus("done")
        } else {
          await pollSubmission(submissionId, retries + 1)
        }
      } catch {
        setStatus("done")
        setResult("runtime_error")
      }
    },
    [apiUrl],
  )

  const handleSubmit = useCallback(async () => {
    setStatus("submitting")
    setResult(null)
    setFeedback(null)

    try {
      const res = await fetch(`${apiUrl}/api/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          problemId: problem.id,
          code,
          language: "sql",
        }),
      })

      if (!res.ok) {
        setStatus("done")
        setResult("runtime_error")
        return
      }

      const json = (await res.json()) as SubmissionResponse
      setStatus("polling")
      await pollSubmission(json.id)
    } catch {
      setStatus("done")
      setResult("runtime_error")
    }
  }, [apiUrl, code, problem.id, pollSubmission])

  const isLoading = status === "submitting" || status === "polling"
  const diffLabel = DIFFICULTY_LABELS[problem.difficulty] ?? `Lv.${problem.difficulty}`

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="border-b bg-background px-6 py-4">
        <div className="mx-auto max-w-7xl flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">{problem.title}</h1>
            <div className="mt-1 flex gap-2 text-xs">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary font-medium">
                {diffLabel}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground font-medium uppercase">
                {problem.category}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left pane — problem description */}
        <div className="w-1/2 overflow-y-auto border-r p-6">
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <div
              className="whitespace-pre-wrap text-sm leading-relaxed"
              dangerouslySetInnerHTML={{ __html: problem.body.description.replace(/\n/g, "<br/>") }}
            />
          </div>

          {problem.body.hints && problem.body.hints.length > 0 && (
            <div className="mt-6 space-y-2">
              <h3 className="text-sm font-semibold">ヒント</h3>
              {problem.body.hints.map((hint) => (
                <details key={hint.level} className="rounded-lg border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    ヒント {hint.level}
                  </summary>
                  <p className="mt-2 text-sm text-muted-foreground">{hint.text}</p>
                </details>
              ))}
            </div>
          )}
        </div>

        {/* Right pane — Monaco Editor */}
        <div className="flex w-1/2 flex-col">
          <div className="flex-1">
            <MonacoEditor
              height="400px"
              language="sql"
              theme="vs-dark"
              value={code}
              onChange={(value) => setCode(value ?? "")}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          </div>

          {/* Submit section */}
          <div className="border-t bg-background p-4 space-y-3">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isLoading}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  採点中...
                </span>
              ) : (
                "実行"
              )}
            </button>

            {status === "done" && result !== null && result !== undefined && (
              <div className={`rounded-lg border p-3 text-sm font-medium ${RESULT_CONFIG[result].className}`}>
                <span className="mr-2">{RESULT_CONFIG[result].icon}</span>
                {RESULT_CONFIG[result].label}
                {feedback && typeof feedback["message"] === "string" && (
                  <p className="mt-1 font-normal opacity-80">{feedback["message"]}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
