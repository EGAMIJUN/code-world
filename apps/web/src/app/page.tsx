import { Button } from "@code-world/ui"

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <div className="text-center space-y-4">
        <h1 className="text-5xl font-bold tracking-tight">
          CODE{" "}
          <span className="bg-gradient-to-r from-violet-600 to-cyan-500 bg-clip-text text-transparent">
            WORLD
          </span>
        </h1>
        <p className="text-xl text-muted-foreground max-w-xl">
          コードを書いて、街を作れ。
          <br />
          SEとして必要なスキルが全部身につく学習型オープンワールドゲーム。
        </p>
      </div>

      <div className="flex gap-4">
        <Button size="lg">ゲームを始める</Button>
        <Button variant="outline" size="lg">
          詳細を見る
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mt-8">
        {[
          { label: "SQL", description: "50問" },
          { label: "デバッグ", description: "30問" },
          { label: "設計", description: "20問" },
          { label: "レビュー", description: "20問" },
        ].map(({ label, description }) => (
          <div
            key={label}
            className="rounded-xl border bg-card p-4 text-center shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="text-2xl font-bold text-primary">{label}</div>
            <div className="text-sm text-muted-foreground mt-1">{description}</div>
          </div>
        ))}
      </div>
    </main>
  )
}
