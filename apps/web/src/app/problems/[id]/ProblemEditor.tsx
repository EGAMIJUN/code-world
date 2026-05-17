"use client"

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

const DIFFICULTY_LABELS: Record<number, string> = {
  0: "Lv.0 BASIC",
  1: "Lv.1 NORMAL",
  2: "Lv.2 HARD",
  3: "Lv.3 EXPERT",
}

export default function ProblemEditor({ problem }: { problem: Problem }) {
  const [code, setCode] = useState("-- HACK THE SYSTEM\nSELECT ")
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
        const res = await fetch(`${apiUrl}/api/submissions/${submissionId}`, { credentials: "include" })
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
        credentials: "include",
        body: JSON.stringify({
          problemId: problem.id,
          code,
          language: "sql",
        }),
      })

      if (res.status === 401) {
        setStatus("done")
        setFeedback({ message: "LOGIN REQUIRED — ACCESS DENIED" })
        setResult("runtime_error")
        return
      }

      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string }
        setStatus("done")
        setFeedback({ message: errJson.error ?? "SUBMISSION FAILED" })
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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100%",
        background: "#000",
        color: "#00ff41",
        fontFamily: "monospace",
      }}
    >
      {/* Sub-header */}
      <div
        style={{
          flexShrink: 0,
          borderBottom: "1px solid #003300",
          background: "rgba(0,0,0,0.9)",
          padding: "0.5rem 1rem",
          display: "flex",
          alignItems: "center",
          gap: "1rem",
        }}
      >
        <a
          href="/problems"
          style={{
            color: "#00aa2a",
            textDecoration: "none",
            fontSize: "0.75rem",
            letterSpacing: "0.15em",
            whiteSpace: "nowrap",
          }}
        >
          ← MISSIONS
        </a>
        <div style={{ width: "1px", height: "16px", background: "#003300", flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: "0.85rem",
              fontWeight: "bold",
              color: "#00ff41",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {problem.title}
          </div>
          <div
            style={{
              fontSize: "0.65rem",
              color: "#00aa2a",
              letterSpacing: "0.15em",
              marginTop: "0.1rem",
            }}
          >
            {diffLabel} | {problem.category.toUpperCase()}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left pane - problem description */}
        <div
          style={{
            width: "50%",
            overflowY: "auto",
            borderRight: "1px solid #003300",
            padding: "1rem",
            background: "rgba(0,5,0,0.9)",
            fontSize: "0.8rem",
            lineHeight: 1.7,
            color: "#00cc33",
          }}
        >
          <div
            style={{ whiteSpace: "pre-wrap" }}
            dangerouslySetInnerHTML={{ __html: problem.body.description.replace(/\n/g, "<br/>") }}
          />

          {problem.body.hints && problem.body.hints.length > 0 && (
            <div style={{ marginTop: "1.5rem" }}>
              {problem.body.hints.map((hint) => (
                <details
                  key={hint.level}
                  style={{ marginTop: "0.5rem", border: "1px solid #003300", padding: "0.5rem" }}
                >
                  <summary
                    style={{
                      cursor: "pointer",
                      fontSize: "0.7rem",
                      color: "#00aa2a",
                      letterSpacing: "0.15em",
                    }}
                  >
                    ▶ HINT {hint.level}
                  </summary>
                  <div style={{ paddingTop: "0.5rem", color: "#007700", fontSize: "0.75rem" }}>
                    {hint.text}
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>

        {/* Right pane - editor */}
        <div style={{ display: "flex", flexDirection: "column", width: "50%" }}>
          <div style={{ flex: 1 }}>
            <MonacoEditor
              height="400px"
              language="sql"
              theme="vs-dark"
              value={code}
              onChange={(value) => setCode(value ?? "")}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                automaticLayout: true,
                fontFamily: "monospace",
              }}
            />
          </div>

          {/* Submit */}
          <div
            style={{
              borderTop: "1px solid #003300",
              background: "rgba(0,0,0,0.95)",
              padding: "0.75rem 1rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isLoading}
              style={{
                background: isLoading ? "#001100" : "#003300",
                color: "#00ff41",
                border: "1px solid #00ff41",
                padding: "0.6rem 1rem",
                fontFamily: "monospace",
                fontSize: "0.85rem",
                letterSpacing: "0.2em",
                cursor: isLoading ? "not-allowed" : "pointer",
                opacity: isLoading ? 0.6 : 1,
                textShadow: isLoading ? "none" : "0 0 8px #00ff41",
                width: "100%",
              }}
            >
              {isLoading
                ? status === "submitting"
                  ? "⟳ UPLOADING PAYLOAD..."
                  : "⟳ EXECUTING..."
                : "▶ EXECUTE PAYLOAD"}
            </button>

            {status === "done" && result !== null && result !== undefined && (
              <div
                style={{
                  padding: "0.5rem 0.75rem",
                  border: `1px solid ${
                    result === "accepted"
                      ? "#00ff41"
                      : result === "wrong_answer"
                        ? "#ff0040"
                        : "#ff9900"
                  }`,
                  fontSize: "0.8rem",
                  color:
                    result === "accepted"
                      ? "#00ff41"
                      : result === "wrong_answer"
                        ? "#ff0040"
                        : "#ff9900",
                  background:
                    result === "accepted"
                      ? "rgba(0,255,65,0.05)"
                      : result === "wrong_answer"
                        ? "rgba(255,0,64,0.05)"
                        : "rgba(255,153,0,0.05)",
                }}
              >
                {result === "accepted" && "✓ HIT — SYSTEM BREACHED"}
                {result === "wrong_answer" && "✗ WRONG ANSWER — ACCESS DENIED"}
                {result === "runtime_error" && "⚠ RUNTIME ERROR — SYSTEM COUNTERMEASURE"}
                {result === "time_limit_exceeded" && "⏱ TIME LIMIT — CONNECTION TIMEOUT"}
                {feedback && typeof feedback["message"] === "string" && (
                  <div style={{ marginTop: "0.25rem", fontSize: "0.7rem", opacity: 0.8 }}>
                    {feedback["message"]}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
