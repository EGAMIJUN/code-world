import { cookies } from "next/headers"
import Link from "next/link"
import { Suspense } from "react"
import DifficultyFilter from "./DifficultyFilter"

interface ProblemRow {
  id: string
  title: string
  difficulty: number
  category: string
  solvedCount: number
  solved: boolean
}

const DIFFICULTY_LABEL: Record<number, string> = {
  0: "Lv.0",
  1: "Lv.1",
  2: "Lv.2",
  3: "Lv.3",
}

async function fetchProblems(difficulty?: string): Promise<ProblemRow[]> {
  const apiUrl = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"
  const params = new URLSearchParams()
  if (difficulty) params.set("difficulty", difficulty)
  const url = `${apiUrl}/api/problems${params.size > 0 ? `?${params.toString()}` : ""}`

  try {
    const cookieStore = await cookies()
    const cookieHeader = cookieStore
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join("; ")

    const res = await fetch(url, {
      cache: "no-store",
      headers: cookieHeader ? { cookie: cookieHeader } : {},
    })
    if (!res.ok) return []
    const json = (await res.json()) as { data: ProblemRow[] }
    return json.data ?? []
  } catch {
    return []
  }
}

interface ProblemsPageProps {
  searchParams: Promise<{ difficulty?: string }>
}

export default async function ProblemsPage({ searchParams }: ProblemsPageProps) {
  const { difficulty } = await searchParams
  const problems = await fetchProblems(difficulty)
  const solvedCount = problems.filter((p) => p.solved).length

  return (
    <div
      style={{
        minHeight: "100%",
        padding: "2rem 1rem",
        fontFamily: "monospace",
        color: "#00ff41",
      }}
    >
      <div style={{ margin: "0 auto", maxWidth: "1100px" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "1.5rem",
                fontWeight: "bold",
                letterSpacing: "0.25em",
                color: "#00ff41",
                textShadow: "0 0 15px #00ff41",
              }}
            >
              ▓ MISSION SELECT
            </div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "#00aa2a",
                letterSpacing: "0.15em",
                marginTop: "0.25rem",
              }}
            >
              HACK THE DATABASE — CLAIM YOUR BLOCKS
            </div>
          </div>
          {solvedCount > 0 && (
            <div
              style={{
                border: "1px solid #003300",
                padding: "0.25rem 0.75rem",
                fontSize: "0.75rem",
                color: "#00ff41",
                letterSpacing: "0.1em",
                background: "rgba(0,255,65,0.05)",
                whiteSpace: "nowrap",
              }}
            >
              ✓ {solvedCount} CLEARED
            </div>
          )}
        </div>

        {/* Filter */}
        <div style={{ marginBottom: "1.5rem" }}>
          <Suspense fallback={null}>
            <DifficultyFilter />
          </Suspense>
        </div>

        {/* Problem grid */}
        {problems.length === 0 ? (
          <div
            style={{
              border: "1px solid #003300",
              padding: "3rem",
              textAlign: "center",
              color: "#005500",
              letterSpacing: "0.2em",
            }}
          >
            NO TARGETS FOUND
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gap: "0.75rem",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            }}
          >
            {problems.map((problem) => (
              <Link
                key={problem.id}
                href={`/problems/${problem.id}`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  border: `1px solid ${problem.solved ? "#00ff41" : "#003300"}`,
                  padding: "1rem",
                  textDecoration: "none",
                  color: "#00ff41",
                  background: problem.solved ? "rgba(0,255,65,0.04)" : "rgba(0,10,0,0.6)",
                  position: "relative",
                  transition: "border-color 0.2s",
                }}
              >
                {problem.solved && (
                  <div
                    style={{
                      position: "absolute",
                      top: "0.5rem",
                      right: "0.75rem",
                      fontSize: "0.65rem",
                      color: "#00ff41",
                      letterSpacing: "0.1em",
                    }}
                  >
                    ✓ CLEARED
                  </div>
                )}

                <div
                  style={{
                    fontSize: "0.65rem",
                    color: "#00aa2a",
                    letterSpacing: "0.15em",
                    marginBottom: "0.1rem",
                  }}
                >
                  {DIFFICULTY_LABEL[problem.difficulty] ?? `Lv.${problem.difficulty}`} |{" "}
                  {problem.category.toUpperCase()}
                </div>

                <div
                  style={{
                    fontSize: "0.9rem",
                    fontWeight: "bold",
                    letterSpacing: "0.05em",
                    paddingRight: problem.solved ? "4.5rem" : "0",
                  }}
                >
                  {problem.title}
                </div>

                <div
                  style={{
                    marginTop: "auto",
                    fontSize: "0.65rem",
                    color: "#005500",
                    letterSpacing: "0.1em",
                  }}
                >
                  {problem.solvedCount.toLocaleString()} AGENTS CLEARED
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
