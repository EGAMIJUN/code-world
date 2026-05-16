import { db, problems } from "./index"
import { sql } from "drizzle-orm"

interface ProblemBody {
  description: string
  setup: string
  expectedOutput: unknown[][]
  hints: Array<{ level: number; text: string }>
  explanation: string
}

interface SeedProblem {
  title: string
  category: "sql" | "debug" | "design" | "review"
  difficulty: number
  body: ProblemBody
  isOfficial: boolean
  status: "approved" | "pending" | "rejected"
}

const SETUP_DDL = `
CREATE TABLE IF NOT EXISTS residents (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  age INTEGER NOT NULL,
  city TEXT NOT NULL,
  income INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS buildings (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  category TEXT NOT NULL,
  floors INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  resident_id INTEGER NOT NULL REFERENCES residents(id),
  building_id INTEGER NOT NULL REFERENCES buildings(id),
  amount INTEGER NOT NULL,
  ordered_at DATE NOT NULL
);

INSERT INTO residents (id, name, age, city, income) VALUES
  (1, '田中 太郎', 32, '東京', 450000),
  (2, '鈴木 花子', 25, '大阪', 320000),
  (3, '佐藤 次郎', 40, '東京', 600000),
  (4, '高橋 美咲', 28, '名古屋', 380000),
  (5, '渡辺 健一', 35, '大阪', 520000),
  (6, '伊藤 さくら', 22, '東京', 280000),
  (7, '山本 雄介', 45, '名古屋', 700000),
  (8, '中村 恵子', 30, '大阪', 410000);

INSERT INTO buildings (id, name, city, category, floors) VALUES
  (1, '東京タワーマンション', '東京', 'residential', 20),
  (2, 'なんばオフィスビル', '大阪', 'office', 15),
  (3, '名古屋駅前ビル', '名古屋', 'office', 10),
  (4, '渋谷ショッピングモール', '東京', 'commercial', 8),
  (5, '梅田レジデンス', '大阪', 'residential', 25);

INSERT INTO orders (id, resident_id, building_id, amount, ordered_at) VALUES
  (1, 1, 1, 150000, '2024-01-15'),
  (2, 2, 2, 80000, '2024-01-20'),
  (3, 3, 4, 200000, '2024-02-10'),
  (4, 4, 3, 120000, '2024-02-15'),
  (5, 5, 2, 95000, '2024-03-01'),
  (6, 6, 1, 160000, '2024-03-05'),
  (7, 7, 3, 180000, '2024-03-10'),
  (8, 8, 5, 75000, '2024-03-15'),
  (9, 1, 4, 50000, '2024-04-01'),
  (10, 3, 2, 110000, '2024-04-05');
`

const seedProblems: SeedProblem[] = [
  // Lv.0 — 3問
  {
    title: "住民を全件取得しよう",
    category: "sql",
    difficulty: 0,
    body: {
      description: `## 問題\n\n\`residents\` テーブルのすべての行を取得してください。\n\n### テーブル構造\n- \`id\` - 住民ID\n- \`name\` - 名前\n- \`age\` - 年齢\n- \`city\` - 都市\n- \`income\` - 月収（円）`,
      setup: SETUP_DDL,
      expectedOutput: [
        [1, "田中 太郎", 32, "東京", 450000],
        [2, "鈴木 花子", 25, "大阪", 320000],
        [3, "佐藤 次郎", 40, "東京", 600000],
        [4, "高橋 美咲", 28, "名古屋", 380000],
        [5, "渡辺 健一", 35, "大阪", 520000],
        [6, "伊藤 さくら", 22, "東京", 280000],
        [7, "山本 雄介", 45, "名古屋", 700000],
        [8, "中村 恵子", 30, "大阪", 410000],
      ],
      hints: [{ level: 1, text: "SELECT文で全カラムを取得するには `SELECT *` を使います。" }],
      explanation: "`SELECT * FROM residents` でテーブルの全行・全列を取得できます。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "東京の住民を絞り込もう",
    category: "sql",
    difficulty: 0,
    body: {
      description: `## 問題\n\n\`residents\` テーブルから、\`city\` が **'東京'** の住民のみを取得してください。`,
      setup: SETUP_DDL,
      expectedOutput: [
        [1, "田中 太郎", 32, "東京", 450000],
        [3, "佐藤 次郎", 40, "東京", 600000],
        [6, "伊藤 さくら", 22, "東京", 280000],
      ],
      hints: [{ level: 1, text: "WHERE句を使って条件を指定しましょう。文字列は'シングルクォート'で囲みます。" }],
      explanation: "`WHERE city = '東京'` で都市が東京の住民だけを絞り込めます。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "収入の高い順に並べよう",
    category: "sql",
    difficulty: 0,
    body: {
      description: `## 問題\n\n\`residents\` テーブルの全住民を、\`income\`（月収）の高い順（降順）に並べて取得してください。`,
      setup: SETUP_DDL,
      expectedOutput: [
        [7, "山本 雄介", 45, "名古屋", 700000],
        [3, "佐藤 次郎", 40, "東京", 600000],
        [5, "渡辺 健一", 35, "大阪", 520000],
        [1, "田中 太郎", 32, "東京", 450000],
        [8, "中村 恵子", 30, "大阪", 410000],
        [4, "高橋 美咲", 28, "名古屋", 380000],
        [2, "鈴木 花子", 25, "大阪", 320000],
        [6, "伊藤 さくら", 22, "東京", 280000],
      ],
      hints: [{ level: 1, text: "ORDER BY カラム名 DESC で降順に並べられます。" }],
      explanation: "`ORDER BY income DESC` で月収の高い順に並べられます。",
    },
    isOfficial: true,
    status: "approved",
  },
  // Lv.1 — 4問
  {
    title: "注文と住民を結合しよう",
    category: "sql",
    difficulty: 1,
    body: {
      description: `## 問題\n\n\`orders\` テーブルと \`residents\` テーブルを結合して、各注文の **注文ID**、**住民名**、**金額** を取得してください。\n\n結果は注文IDの昇順で並べてください。`,
      setup: SETUP_DDL,
      expectedOutput: [
        [1, "田中 太郎", 150000],
        [2, "鈴木 花子", 80000],
        [3, "佐藤 次郎", 200000],
        [4, "高橋 美咲", 120000],
        [5, "渡辺 健一", 95000],
        [6, "伊藤 さくら", 160000],
        [7, "山本 雄介", 180000],
        [8, "中村 恵子", 75000],
        [9, "田中 太郎", 50000],
        [10, "佐藤 次郎", 110000],
      ],
      hints: [
        { level: 1, text: "INNER JOINを使って2つのテーブルを結合しましょう。" },
        { level: 2, text: "orders.resident_id = residents.id で結合条件を指定します。" },
      ],
      explanation: "`INNER JOIN residents ON orders.resident_id = residents.id` で住民情報と注文を結合できます。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "都市ごとの住民数を数えよう",
    category: "sql",
    difficulty: 1,
    body: {
      description: `## 問題\n\n\`residents\` テーブルから、都市ごとの住民数を集計してください。\n\n結果のカラムは \`city\`、\`count\` とし、住民数の多い順に並べてください。`,
      setup: SETUP_DDL,
      expectedOutput: [
        ["東京", 3],
        ["大阪", 3],
        ["名古屋", 2],
      ],
      hints: [
        { level: 1, text: "GROUP BY を使って都市ごとにグループ化します。" },
        { level: 2, text: "COUNT(*) で各グループの件数を数えられます。" },
      ],
      explanation: "`GROUP BY city` でグループ化し、`COUNT(*) AS count` で件数を集計します。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "注文のない建物も表示しよう",
    category: "sql",
    difficulty: 1,
    body: {
      description: `## 問題\n\n\`buildings\` テーブルと \`orders\` テーブルを LEFT JOIN して、**建物名** と **注文件数** を取得してください。\n\n注文が0件の建物も含め、注文件数の多い順で表示してください。`,
      setup: SETUP_DDL,
      expectedOutput: [
        ["なんばオフィスビル", 3],
        ["名古屋駅前ビル", 2],
        ["東京タワーマンション", 2],
        ["渋谷ショッピングモール", 2],
        ["梅田レジデンス", 1],
      ],
      hints: [
        { level: 1, text: "LEFT JOINを使うと右テーブルにデータがない場合もNULLとして表示されます。" },
        { level: 2, text: "COUNT(orders.id) はNULLをカウントしないため、0件の建物は0になります。" },
      ],
      explanation: "`LEFT JOIN orders ON buildings.id = orders.building_id` でLEFT JOINし、`COUNT(orders.id)`で集計します。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "2件以上注文した住民を見つけよう",
    category: "sql",
    difficulty: 1,
    body: {
      description: `## 問題\n\n\`orders\` テーブルから、**2件以上**注文した住民のIDと注文件数を取得してください。\n\n結果は注文件数の多い順で表示してください。`,
      setup: SETUP_DDL,
      expectedOutput: [
        [1, 2],
        [3, 2],
      ],
      hints: [
        { level: 1, text: "GROUP BY でグループ化した後、HAVINGで条件を絞り込めます。" },
        { level: 2, text: "HAVING COUNT(*) >= 2 で2件以上のグループのみを取得できます。" },
      ],
      explanation: "`GROUP BY resident_id HAVING COUNT(*) >= 2` で複数回注文した住民を絞り込めます。",
    },
    isOfficial: true,
    status: "approved",
  },
  // Lv.2 — 3問
  {
    title: "大阪の建物に注文した住民を求めよう",
    category: "sql",
    difficulty: 2,
    body: {
      description: `## 問題\n\n**大阪**にある建物に注文したことのある住民の名前を、サブクエリを使って取得してください。\n\n重複なし（DISTINCT）で名前のみ表示してください。`,
      setup: SETUP_DDL,
      expectedOutput: [["鈴木 花子"], ["渡辺 健一"], ["中村 恵子"], ["佐藤 次郎"]],
      hints: [
        { level: 1, text: "IN句にサブクエリを使って条件を指定できます。" },
        { level: 2, text: "まず大阪の建物IDを取得し、そのIDに対応する注文のresident_idを調べます。" },
      ],
      explanation:
        "サブクエリ `WHERE id IN (SELECT building_id FROM orders WHERE building_id IN (SELECT id FROM buildings WHERE city = '大阪'))` を使って絞り込みます。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "収入ランキングをつけよう",
    category: "sql",
    difficulty: 2,
    body: {
      description: `## 問題\n\nウィンドウ関数 \`ROW_NUMBER()\` を使って、住民の収入ランキングを作成してください。\n\n結果のカラムは \`name\`、\`income\`、\`rank\` とし、収入の高い順にランキングをつけて表示してください。`,
      setup: SETUP_DDL,
      expectedOutput: [
        ["山本 雄介", 700000, 1],
        ["佐藤 次郎", 600000, 2],
        ["渡辺 健一", 520000, 3],
        ["田中 太郎", 450000, 4],
        ["中村 恵子", 410000, 5],
        ["高橋 美咲", 380000, 6],
        ["鈴木 花子", 320000, 7],
        ["伊藤 さくら", 280000, 8],
      ],
      hints: [
        { level: 1, text: "ROW_NUMBER() OVER (ORDER BY income DESC) でランキング番号を付けられます。" },
        { level: 2, text: "ウィンドウ関数はSELECT句の中で使います。" },
      ],
      explanation:
        "`ROW_NUMBER() OVER (ORDER BY income DESC) AS rank` でウィンドウ関数を使ってランキングを付けられます。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "CTEで都市別平均収入を比較しよう",
    category: "sql",
    difficulty: 2,
    body: {
      description: `## 問題\n\nCTE（WITH句）を使って、都市ごとの平均収入を計算し、**平均収入が400,000円以上**の都市のみ表示してください。\n\n結果のカラムは \`city\`、\`avg_income\` とし、平均収入の高い順で表示してください。`,
      setup: SETUP_DDL,
      expectedOutput: [
        ["名古屋", 540000],
        ["東京", 443333],
      ],
      hints: [
        { level: 1, text: "WITH city_avg AS (...) のようにCTEを定義できます。" },
        { level: 2, text: "CTEの中でGROUP BYとAVGを使い、外のクエリでWHERE条件を指定します。" },
      ],
      explanation:
        "CTEで `AVG(income)` を計算し、外部クエリで `WHERE avg_income >= 400000` でフィルタリングします。",
    },
    isOfficial: true,
    status: "approved",
  },
]

export async function seed() {
  console.log("[Seed] Starting seed...")

  for (const problem of seedProblems) {
    await db
      .insert(problems)
      .values({
        title: problem.title,
        category: problem.category,
        difficulty: problem.difficulty,
        body: problem.body,
        isOfficial: problem.isOfficial,
        status: problem.status,
      })
      .onConflictDoNothing()
  }

  console.log(`[Seed] Inserted ${seedProblems.length} problems (or skipped if already exists).`)
  process.exit(0)
}

// Run when called directly
seed().catch((err) => {
  console.error("[Seed] Error:", err)
  process.exit(1)
})
