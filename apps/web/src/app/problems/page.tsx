import Link from "next/link"
import { Suspense } from "react"
import DifficultyFilter from "./DifficultyFilter"

interface ProblemRow {
  id: string
  title: string
  difficulty: number
  category: string
  solvedCount: number
}

const DIFFICULTY_BADGE: Record<number, { label: string; className: string }> = {
  0: { label: "Lv.0", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  1: { label: "Lv.1", className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  2: { label: "Lv.2", className: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
  3: { label: "Lv.3", className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
}

const CATEGORY_BADGE: Record<string, string> = {
  sql: "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200",
  debug: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  design: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  review: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
}

async function fetchProblems(difficulty?: string): Promise<ProblemRow[]> {
  const apiUrl = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"
  const params = new URLSearchParams()
  if (difficulty) params.set("difficulty", difficulty)
  const url = `${apiUrl}/api/problems${params.size > 0 ? `?${params.toString()}` : ""}`

  try {
    const res = await fetch(url, { cache: "no-store" })
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

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold">
            問題一覧
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">SQLスキルを磨こう</p>
        </div>

        <Suspense fallback={null}>
          <DifficultyFilter />
        </Suspense>

        {problems.length === 0 ? (
          <div className="rounded-xl border bg-card p-12 text-center text-muted-foreground">
            問題が見つかりませんでした。
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {problems.map((problem) => {
              const diffBadge = DIFFICULTY_BADGE[problem.difficulty] ?? {
                label: `Lv.${problem.difficulty}`,
                className: "bg-gray-100 text-gray-800",
              }
              const catClass = CATEGORY_BADGE[problem.category] ?? "bg-gray-100 text-gray-800"

              return (
                <Link
                  key={problem.id}
                  href={`/problems/${problem.id}`}
                  className="rounded-xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold leading-tight">{problem.title}</h2>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${diffBadge.className}`}>
                      {diffBadge.label}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${catClass}`}>
                      {problem.category.toUpperCase()}
                    </span>
                  </div>
                  <div className="mt-auto text-xs text-muted-foreground">
                    {problem.solvedCount} 人が解答済み
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
