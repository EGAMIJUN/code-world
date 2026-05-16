import { notFound } from "next/navigation"
import ProblemEditor from "./ProblemEditor"

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

export default async function ProblemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const apiUrl = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"

  let problem: Problem | null = null
  try {
    const res = await fetch(`${apiUrl}/api/problems/${id}`, { cache: "no-store" })
    if (!res.ok) return notFound()
    const json = (await res.json()) as { data: Problem }
    problem = json.data
  } catch {
    return notFound()
  }

  if (!problem) return notFound()

  return <ProblemEditor problem={problem} />
}
