import { eq, inArray } from "drizzle-orm"
import { db, dungeonRooms, dungeons, problems } from "./index"

interface ProblemBody {
  description: string
  setup: string
  expectedOutput: unknown[][]
  hints: Array<{ level: number; text: string }>
  explanation: string
}

interface SeedProblem {
  title: string
  category: "sql" | "debug" | "design" | "review" | "algorithm"
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
      hints: [
        {
          level: 1,
          text: "WHERE句を使って条件を指定しましょう。文字列は'シングルクォート'で囲みます。",
        },
      ],
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
      explanation:
        "`INNER JOIN residents ON orders.resident_id = residents.id` で住民情報と注文を結合できます。",
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
        {
          level: 1,
          text: "LEFT JOINを使うと右テーブルにデータがない場合もNULLとして表示されます。",
        },
        { level: 2, text: "COUNT(orders.id) はNULLをカウントしないため、0件の建物は0になります。" },
      ],
      explanation:
        "`LEFT JOIN orders ON buildings.id = orders.building_id` でLEFT JOINし、`COUNT(orders.id)`で集計します。",
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
      explanation:
        "`GROUP BY resident_id HAVING COUNT(*) >= 2` で複数回注文した住民を絞り込めます。",
    },
    isOfficial: true,
    status: "approved",
  },
  // Lv.3 — 2問 (SQL上級)
  {
    title: "ピボットテーブルで月別集計しよう",
    category: "sql",
    difficulty: 3,
    body: {
      description: `## 問題\n\n\`orders\` テーブルから、月ごとの注文件数をピボット形式で表示してください。\n\n結果のカラムは \`month\`、\`order_count\`、\`cumulative_count\`（累計件数）とし、月の昇順で表示してください。\n\n累計件数はウィンドウ関数 \`SUM() OVER\` を使って計算してください。`,
      setup: SETUP_DDL,
      expectedOutput: [
        ["2024-01", 2, 2],
        ["2024-02", 2, 4],
        ["2024-03", 4, 8],
        ["2024-04", 2, 10],
      ],
      hints: [
        { level: 1, text: "TO_CHAR(ordered_at, 'YYYY-MM') で月文字列を生成できます。" },
        { level: 2, text: "SUM(COUNT(*)) OVER (ORDER BY month) で累計を計算できます。" },
        {
          level: 3,
          text: "CTEでまず月別件数を集計し、外のクエリでウィンドウ関数を適用すると整理しやすいです。",
        },
      ],
      explanation:
        "CTEで月別集計を行い、`SUM(order_count) OVER (ORDER BY month)` で累計を計算します。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "階層データを再帰CTEで展開しよう",
    category: "sql",
    difficulty: 3,
    body: {
      description: `## 問題\n\n再帰CTE（WITH RECURSIVE）を使って、1〜10の連番と各数値の累計和を一度に求めてください。\n\n結果のカラムは \`n\`（1〜10）と \`cumulative_sum\`（1からnまでの合計）とし、nの昇順で表示してください。`,
      setup: "",
      expectedOutput: [
        [1, 1],
        [2, 3],
        [3, 6],
        [4, 10],
        [5, 15],
        [6, 21],
        [7, 28],
        [8, 36],
        [9, 45],
        [10, 55],
      ],
      hints: [
        { level: 1, text: "WITH RECURSIVE seq AS (...) でアンカー部分と再帰部分を定義します。" },
        {
          level: 2,
          text: "アンカー: SELECT 1 AS n, 1 AS cumulative_sum. 再帰: n + 1, cumulative_sum + (n + 1) WHERE n < 10",
        },
      ],
      explanation:
        "`WITH RECURSIVE` でアンカー（n=1）と再帰（n+1, sum+n+1）を定義し、10回繰り返します。",
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
        {
          level: 2,
          text: "まず大阪の建物IDを取得し、そのIDに対応する注文のresident_idを調べます。",
        },
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
        {
          level: 1,
          text: "ROW_NUMBER() OVER (ORDER BY income DESC) でランキング番号を付けられます。",
        },
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
  // Algorithm — 3問
  {
    title: "LAGで前月比を計算しよう",
    category: "algorithm",
    difficulty: 1,
    body: {
      description: `## 問題\n\nウィンドウ関数 \`LAG()\` を使って、月ごとの注文件数と**前月からの増減**を求めてください。\n\n結果のカラムは \`month\`、\`order_count\`、\`diff\`（前月比、初月はNULL）とし、月の昇順で表示してください。`,
      setup: SETUP_DDL,
      expectedOutput: [
        ["2024-01", 2, null],
        ["2024-02", 2, 0],
        ["2024-03", 4, 2],
        ["2024-04", 2, -2],
      ],
      hints: [
        {
          level: 1,
          text: "TO_CHAR(ordered_at, 'YYYY-MM') で月を取得し、GROUP BYで集計します。",
        },
        {
          level: 2,
          text: "LAG(order_count, 1) OVER (ORDER BY month) で前月の件数を取得できます。",
        },
        {
          level: 3,
          text: "CTEで月別件数を先に集計してから、外のクエリでLAGを使うと整理しやすいです。",
        },
      ],
      explanation:
        "CTEで月別集計後、`order_count - LAG(order_count) OVER (ORDER BY month)` で前月比を計算します。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "移動平均で注文トレンドを分析しよう",
    category: "algorithm",
    difficulty: 2,
    body: {
      description: `## 問題\n\n各注文について、その日を含む過去3件の注文金額の**移動平均**を求めてください。\n\nウィンドウ関数 \`AVG() OVER\` を使い、結果のカラムは \`id\`、\`amount\`、\`moving_avg\`（小数点以下2桁）とし、注文IDの昇順で表示してください。`,
      setup: SETUP_DDL,
      expectedOutput: [
        [1, 150000, "150000.00"],
        [2, 80000, "115000.00"],
        [3, 200000, "143333.33"],
        [4, 120000, "133333.33"],
        [5, 95000, "138333.33"],
        [6, 160000, "125000.00"],
        [7, 180000, "145000.00"],
        [8, 75000, "138333.33"],
        [9, 50000, "101666.67"],
        [10, 110000, "78333.33"],
      ],
      hints: [
        {
          level: 1,
          text: "ROWS BETWEEN 2 PRECEDING AND CURRENT ROW で過去2行＋現在行のウィンドウを定義できます。",
        },
        {
          level: 2,
          text: "AVG(amount) OVER (ORDER BY id ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) が基本形です。",
        },
        { level: 3, text: "ROUND(..., 2) で小数点2桁に丸めます。" },
      ],
      explanation:
        "`ROUND(AVG(amount) OVER (ORDER BY id ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 2)` で移動平均を計算します。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "連続する日付のアイランドを検出しよう",
    category: "algorithm",
    difficulty: 3,
    body: {
      description: `## 問題\n\n**アイランド問題**（Islands Problem）に挑戦しましょう。\n\n\`orders\` テーブルの \`ordered_at\` から、**連続した日付のグループ**（アイランド）ごとに、グループの開始日・終了日・日数を求めてください。\n\n結果のカラムは \`island_start\`、\`island_end\`、\`days\` とし、開始日の昇順で表示してください。\n\n※日付が1日でも空いたら別グループとします。`,
      setup: SETUP_DDL,
      expectedOutput: [
        ["2024-01-15", "2024-01-20", 6],
        ["2024-02-10", "2024-02-15", 6],
        ["2024-03-01", "2024-04-05", 36],
      ],
      hints: [
        {
          level: 1,
          text: "まず日付を重複なしで取得し、ROW_NUMBER()と日付の差でグループを識別します。",
        },
        {
          level: 2,
          text: "date - ROW_NUMBER() OVER (ORDER BY date) は連続する日付で一定になります。この値でGROUP BYすればアイランドを識別できます。",
        },
        {
          level: 3,
          text: "CTEで「日付 - ROW_NUMBER()」を計算し、外のクエリでMIN/MAX/COUNT を集計します。",
        },
      ],
      explanation:
        "連続日付ではROW_NUMBER()との差が一定になる性質を利用。CTEで `ordered_at - ROW_NUMBER()::int` を計算し、その値でGROUP BYしてMIN・MAXを取ります。",
    },
    isOfficial: true,
    status: "approved",
  },
  // System Design — 2問
  {
    title: "高スループットAPIのキャッシュ戦略を設計しよう",
    category: "design",
    difficulty: 2,
    body: {
      description: `## 問題\n\n月間アクティブユーザー100万人のSNSサービスで、ユーザープロフィール取得APIが**秒間10,000リクエスト**のトラフィックを受けています。\n\n現在の構成はAPIサーバー → PostgreSQLの単純な構成で、DBが過負荷になっています。\n\n### 要件\n- プロフィール情報は1時間に1回程度しか更新されない\n- 読み取り:書き込み = 99:1\n- P99レイテンシを50ms以下にしたい\n- データ整合性は「結果整合性」で許容される\n\n### あなたのタスク\nキャッシュ戦略を含むシステム設計を記述してください。以下の観点を含めてください:\n1. キャッシュ層の設計（どこに何をキャッシュするか）\n2. キャッシュ無効化戦略\n3. キャッシュ階層（L1/L2など）\n4. 障害時のフォールバック`,
      setup: "",
      expectedOutput: [],
      hints: [
        {
          level: 1,
          text: "Redisなどのインメモリキャッシュを使うと読み取りレイテンシを大幅に削減できます。",
        },
        {
          level: 2,
          text: "Write-through vs Write-behind vs Cache-aside パターンの違いを考慮しましょう。",
        },
        {
          level: 3,
          text: "CDNエッジキャッシュ(L1) + Redisクラスタ(L2) + DB(L3) の多層構成が有効です。",
        },
      ],
      explanation:
        "Cache-asideパターン＋TTL 1時間のRedisを採用。更新時はパブリッシュ/サブスクライブでキャッシュを無効化。CDNでさらにエッジキャッシュ（TTL 5分）を追加しDBへの到達を最小化します。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "マイクロサービスのAPIゲートウェイを設計しよう",
    category: "design",
    difficulty: 3,
    body: {
      description: `## 問題\n\nECサイトをモノリスからマイクロサービスへ移行します。以下のサービスが存在します:\n\n- **UserService**: 認証・認可、ユーザー管理\n- **ProductService**: 商品カタログ、在庫\n- **OrderService**: 注文処理、決済\n- **NotificationService**: メール・プッシュ通知\n\n### 課題\nフロントエンド（Web/アプリ）は複数サービスに分散したAPIを直接呼び出しており、以下の問題が発生しています:\n- 認証が各サービスで重複実装\n- フロントエンドのリクエスト数が多い（N+1問題）\n- レート制限が各サービスにバラバラ\n- サービス間の依存関係が複雑\n\n### タスク\nAPIゲートウェイを設計してください。以下を含めてください:\n1. ゲートウェイの責務（何を担当させるか）\n2. 認証・認可フロー\n3. リクエスト集約（BFF: Backends for Frontends）パターン\n4. レート制限とサーキットブレーカー\n5. 障害時の対策`,
      setup: "",
      expectedOutput: [],
      hints: [
        {
          level: 1,
          text: "APIゲートウェイはルーティング・認証・SSL終端・ロギングなどの横断的関心事を一元管理します。",
        },
        {
          level: 2,
          text: "BFFパターンではWebとモバイルで異なるゲートウェイを用意し、それぞれのクライアントに最適なAPIを提供します。",
        },
        {
          level: 3,
          text: "サーキットブレーカーで障害の連鎖を防ぎ、フォールバックレスポンスでユーザー体験を維持します。",
        },
      ],
      explanation:
        "Kong/Envoy等のAPIゲートウェイを前段に配置。JWTで一元認証し、GraphQL/gRPCでリクエスト集約。各サービスへはサービスメッシュ（Istio）で通信、Redisでレート制限、Hystrixでサーキットブレーカーを実装します。",
    },
    isOfficial: true,
    status: "approved",
  },
]

// ── Dungeon seed data ─────────────────────────────────────────────────────────

const DUNGEON_DDL = `
CREATE TABLE IF NOT EXISTS servers (
  id SERIAL PRIMARY KEY,
  hostname TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  status TEXT NOT NULL,
  data_size_gb INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  access_level INTEGER NOT NULL,
  salary INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS access_logs (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  server_id INTEGER REFERENCES servers(id),
  accessed_at TIMESTAMP NOT NULL,
  action TEXT NOT NULL
);
INSERT INTO servers VALUES
  (1,'ALPHA-SRV','192.168.1.1','online',500),
  (2,'BETA-SRV','192.168.1.2','online',1200),
  (3,'GAMMA-SRV','192.168.1.3','offline',300),
  (4,'DELTA-SRV','192.168.1.4','online',800),
  (5,'OMEGA-SRV','192.168.1.5','maintenance',2000);
INSERT INTO employees VALUES
  (1,'Agent Neo','R&D',5,850000),
  (2,'Morpheus','Security',9,1200000),
  (3,'Trinity','Operations',7,950000),
  (4,'Agent Smith','Management',10,1500000),
  (5,'Tank','Infrastructure',6,780000),
  (6,'Niobe','Security',8,1050000),
  (7,'Ghost','R&D',4,720000),
  (8,'Sparks','Operations',5,760000);
INSERT INTO access_logs VALUES
  (1,1,1,'2024-01-15 09:00','READ'),
  (2,2,2,'2024-01-15 10:00','WRITE'),
  (3,3,3,'2024-01-15 11:00','READ'),
  (4,4,1,'2024-01-16 09:00','EXECUTE'),
  (5,1,4,'2024-01-16 10:00','READ'),
  (6,5,2,'2024-01-17 14:00','WRITE'),
  (7,6,5,'2024-01-17 15:00','READ'),
  (8,2,4,'2024-01-18 09:00','EXECUTE'),
  (9,3,2,'2024-01-19 11:00','READ'),
  (10,4,5,'2024-01-19 13:00','WRITE');
`

// 5 problems per level tier, shared across all dungeons of that tier
const dungeonProblemDefs: SeedProblem[] = [
  // ── Tier 1 (Lv0) ─────────────────────────────────────────────────────────
  {
    title: "[DNG-L1-1] サーバー全リストを入手せよ",
    category: "sql",
    difficulty: 0,
    body: {
      description: `## MISSION: 侵入初期偵察\n\n企業のサーバー管理データベースに侵入した。\nまず全サーバーの情報を取得してシステム全体を把握せよ。\n\n\`servers\` テーブルの全データを取得せよ。`,
      setup: DUNGEON_DDL,
      expectedOutput: [
        [1, "ALPHA-SRV", "192.168.1.1", "online", 500],
        [2, "BETA-SRV", "192.168.1.2", "online", 1200],
        [3, "GAMMA-SRV", "192.168.1.3", "offline", 300],
        [4, "DELTA-SRV", "192.168.1.4", "online", 800],
        [5, "OMEGA-SRV", "192.168.1.5", "maintenance", 2000],
      ],
      hints: [{ level: 1, text: "SELECT * FROM テーブル名 で全データを取得できる。" }],
      explanation: "`SELECT * FROM servers` で全サーバー情報を取得する。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[DNG-L1-2] オンラインサーバーを特定せよ",
    category: "sql",
    difficulty: 0,
    body: {
      description: `## MISSION: ターゲット選定\n\n稼働中のサーバーのみが攻撃対象だ。\n\`servers\` テーブルから \`status\` が **'online'** のサーバーのみ取得せよ。`,
      setup: DUNGEON_DDL,
      expectedOutput: [
        [1, "ALPHA-SRV", "192.168.1.1", "online", 500],
        [2, "BETA-SRV", "192.168.1.2", "online", 1200],
        [4, "DELTA-SRV", "192.168.1.4", "online", 800],
      ],
      hints: [{ level: 1, text: "WHERE句で条件を絞り込む。文字列は'シングルクォート'で囲む。" }],
      explanation: "`WHERE status = 'online'` でオンラインサーバーを絞り込む。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[DNG-L1-3] 高権限エージェントを炙り出せ",
    category: "sql",
    difficulty: 0,
    body: {
      description: `## MISSION: 内部脅威の特定\n\n権限の高い内部エージェントを優先して特定する。\n\`employees\` テーブルを \`access_level\` の高い順に全件取得せよ。`,
      setup: DUNGEON_DDL,
      expectedOutput: [
        [4, "Agent Smith", "Management", 10, 1500000],
        [2, "Morpheus", "Security", 9, 1200000],
        [6, "Niobe", "Security", 8, 1050000],
        [3, "Trinity", "Operations", 7, 950000],
        [5, "Tank", "Infrastructure", 6, 780000],
        [1, "Agent Neo", "R&D", 5, 850000],
        [8, "Sparks", "Operations", 5, 760000],
        [7, "Ghost", "R&D", 4, 720000],
      ],
      hints: [{ level: 1, text: "ORDER BY カラム名 DESC で降順に並べられる。" }],
      explanation: "`ORDER BY access_level DESC` でアクセスレベルの高い順に並べる。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[DNG-L1-4] 部門別の人員数を把握せよ",
    category: "sql",
    difficulty: 1,
    body: {
      description: `## MISSION: 組織構造解析\n\n企業の組織構造を把握するため、\n各部門の人員数を集計せよ。\n\n結果カラムは \`department\`, \`count\` とする。`,
      setup: DUNGEON_DDL,
      expectedOutput: [
        ["Infrastructure", 1],
        ["Management", 1],
        ["Operations", 2],
        ["R&D", 2],
        ["Security", 2],
      ],
      hints: [
        { level: 1, text: "GROUP BY で部門ごとにグループ化する。" },
        { level: 2, text: "COUNT(*) で各グループの件数を数える。" },
      ],
      explanation: "`GROUP BY department` でグループ化し `COUNT(*) AS count` で集計する。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[DNG-L1-5] アクセスログと従業員を照合せよ",
    category: "sql",
    difficulty: 1,
    body: {
      description: `## MISSION: 侵入経路の追跡\n\nアクセスログから誰がどのアクションを実行したか追跡する。\n\`access_logs\` と \`employees\` を結合して\n**ログID**、**従業員名**、**実行アクション** を取得せよ。\nログIDの昇順で返すこと。`,
      setup: DUNGEON_DDL,
      expectedOutput: [
        [1, "Agent Neo", "READ"],
        [2, "Morpheus", "WRITE"],
        [3, "Trinity", "READ"],
        [4, "Agent Smith", "EXECUTE"],
        [5, "Agent Neo", "READ"],
        [6, "Tank", "WRITE"],
        [7, "Niobe", "READ"],
        [8, "Morpheus", "EXECUTE"],
        [9, "Trinity", "READ"],
        [10, "Agent Smith", "WRITE"],
      ],
      hints: [
        { level: 1, text: "INNER JOIN で2つのテーブルを結合する。" },
        { level: 2, text: "access_logs.employee_id = employees.id で結合条件を指定する。" },
      ],
      explanation:
        "`INNER JOIN employees ON access_logs.employee_id = employees.id` で結合し、id・name・action を取得する。",
    },
    isOfficial: true,
    status: "approved",
  },

  // ── Tier 3 (Lv3) ─────────────────────────────────────────────────────────
  {
    title: "[DNG-L3-1] 給与ランキングを生成せよ",
    category: "sql",
    difficulty: 2,
    body: {
      description: `## MISSION: 資産調査\n\nウィンドウ関数を使って従業員の給与ランキングを生成せよ。\n\n結果カラムは \`name\`、\`salary\`、\`rank\` とし、給与の高い順にランキングをつけること。`,
      setup: DUNGEON_DDL,
      expectedOutput: [
        ["Agent Smith", 1500000, 1],
        ["Morpheus", 1200000, 2],
        ["Niobe", 1050000, 3],
        ["Trinity", 950000, 4],
        ["Agent Neo", 850000, 5],
        ["Tank", 780000, 6],
        ["Sparks", 760000, 7],
        ["Ghost", 720000, 8],
      ],
      hints: [
        { level: 1, text: "ROW_NUMBER() OVER (ORDER BY salary DESC) でランキングを生成できる。" },
        { level: 2, text: "ウィンドウ関数はSELECT句の中で使う。" },
      ],
      explanation:
        "`ROW_NUMBER() OVER (ORDER BY salary DESC) AS rank` でウィンドウ関数を使ってランキングを付ける。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[DNG-L3-2] 部門別平均給与をCTEで算出せよ",
    category: "sql",
    difficulty: 2,
    body: {
      description: `## MISSION: 内部経済分析\n\nCTE（WITH句）を使って部門別の平均給与を計算し、\n**平均給与が900,000円以上** の部門のみ抽出せよ。\n\n結果カラムは \`department\`、\`avg_salary\` とし、平均給与の高い順で返すこと。`,
      setup: DUNGEON_DDL,
      expectedOutput: [
        ["Management", 1500000],
        ["Security", 1125000],
        ["Operations", 950000],
      ],
      hints: [
        { level: 1, text: "WITH dept_avg AS (...) のようにCTEを定義する。" },
        { level: 2, text: "外部クエリで WHERE avg_salary >= 900000 でフィルタする。" },
      ],
      explanation:
        "CTEで `AVG(salary)` を計算し、外部クエリで `WHERE avg_salary >= 900000` でフィルタリングする。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[DNG-L3-3] サーバーのアクセス件数を集計せよ",
    category: "sql",
    difficulty: 2,
    body: {
      description: `## MISSION: アクセスパターン解析\n\nLEFT JOINを使って、アクセスがないサーバーも含め\n各サーバーのアクセス件数を集計せよ。\n\n結果カラムは \`hostname\`、\`access_count\` とし、アクセス件数の多い順で返すこと。`,
      setup: DUNGEON_DDL,
      expectedOutput: [
        ["BETA-SRV", 3],
        ["ALPHA-SRV", 2],
        ["DELTA-SRV", 2],
        ["OMEGA-SRV", 2],
        ["GAMMA-SRV", 1],
      ],
      hints: [
        { level: 1, text: "LEFT JOINで右テーブルにデータがない場合もNULLとして表示される。" },
        {
          level: 2,
          text: "COUNT(access_logs.id) はNULLをカウントしないため0件サーバーは0になる。",
        },
      ],
      explanation:
        "`LEFT JOIN access_logs ON servers.id = access_logs.server_id` でLEFT JOINし、`COUNT(access_logs.id)`で集計する。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[DNG-L3-4] 高権限エージェントのサーバーを特定せよ",
    category: "sql",
    difficulty: 2,
    body: {
      description: `## MISSION: VIPターゲット追跡\n\nサブクエリを使って、\`access_level\` が **8以上** の従業員が\nアクセスしたことのある **サーバーのホスト名** を重複なしで取得せよ。`,
      setup: DUNGEON_DDL,
      expectedOutput: [["BETA-SRV"], ["DELTA-SRV"], ["OMEGA-SRV"]],
      hints: [
        { level: 1, text: "IN句にサブクエリを使って条件を指定できる。" },
        {
          level: 2,
          text: "まず access_level >= 8 の employee_id を取得し、そのIDに対応するサーバーを調べる。",
        },
      ],
      explanation:
        "サブクエリで高権限従業員のserver_idを取得し、DISTINCT hostnameで重複を排除する。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[DNG-L3-5] 複数回アクセスした従業員を検出せよ",
    category: "sql",
    difficulty: 2,
    body: {
      description: `## MISSION: 不審行動パターン検出\n\n**2回以上** アクセスした従業員のIDとアクセス件数を取得せよ。\nアクセス件数の多い順で返すこと。`,
      setup: DUNGEON_DDL,
      expectedOutput: [
        [1, 2],
        [2, 2],
        [3, 2],
        [4, 2],
      ],
      hints: [
        { level: 1, text: "GROUP BY でグループ化した後、HAVINGで条件を絞り込む。" },
        { level: 2, text: "HAVING COUNT(*) >= 2 で2件以上のグループのみを取得できる。" },
      ],
      explanation:
        "`GROUP BY employee_id HAVING COUNT(*) >= 2` で複数回アクセスした従業員を絞り込む。",
    },
    isOfficial: true,
    status: "approved",
  },

  // ── Tier 5 (Lv5) ─────────────────────────────────────────────────────────
  {
    title: "[DNG-L5-1] 累積アクセス数を解析せよ",
    category: "sql",
    difficulty: 3,
    body: {
      description: `## MISSION: タイムライン再構築\n\nアクセスログを時系列で解析し、\n各ログの**累積アクセス件数**を求めよ。\n\n結果カラムは \`id\`、\`action\`、\`cumulative_count\` とし、ログIDの昇順で返すこと。`,
      setup: DUNGEON_DDL,
      expectedOutput: [
        [1, "READ", 1],
        [2, "WRITE", 2],
        [3, "READ", 3],
        [4, "EXECUTE", 4],
        [5, "READ", 5],
        [6, "WRITE", 6],
        [7, "READ", 7],
        [8, "EXECUTE", 8],
        [9, "READ", 9],
        [10, "WRITE", 10],
      ],
      hints: [
        { level: 1, text: "SUM(1) OVER (ORDER BY id) で累積カウントを計算できる。" },
        {
          level: 2,
          text: "ウィンドウ関数 COUNT(*) OVER (ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) も使える。",
        },
      ],
      explanation:
        "`COUNT(*) OVER (ORDER BY id)` または `ROW_NUMBER() OVER (ORDER BY id)` で累積件数を取得する。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[DNG-L5-2] 部門内給与ランキングを生成せよ",
    category: "sql",
    difficulty: 3,
    body: {
      description: `## MISSION: 組織内格差分析\n\nPARTITION BYを使って、**部門内での給与ランキング**を生成せよ。\n\n結果カラムは \`department\`、\`name\`、\`salary\`、\`dept_rank\` とし、\n部門の昇順、部門内では給与の高い順で返すこと。`,
      setup: DUNGEON_DDL,
      expectedOutput: [
        ["Infrastructure", "Tank", 780000, 1],
        ["Management", "Agent Smith", 1500000, 1],
        ["Operations", "Trinity", 950000, 1],
        ["Operations", "Sparks", 760000, 2],
        ["R&D", "Agent Neo", 850000, 1],
        ["R&D", "Ghost", 720000, 2],
        ["Security", "Morpheus", 1200000, 1],
        ["Security", "Niobe", 1050000, 2],
      ],
      hints: [
        {
          level: 1,
          text: "ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) で部門内ランキングを生成できる。",
        },
        { level: 2, text: "PARTITION BY で部門ごとにウィンドウを分割する。" },
      ],
      explanation:
        "`ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) AS dept_rank` で部門内ランキングを付ける。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[DNG-L5-3] 再帰CTEでアクセス連鎖を解析せよ",
    category: "sql",
    difficulty: 3,
    body: {
      description: `## MISSION: 侵入ルート全解析\n\n再帰CTE（WITH RECURSIVE）を使って、1から10までの連番とその**累積和**を計算せよ。\n\n結果カラムは \`n\`（1〜10）と \`cumulative_sum\` とし、nの昇順で返すこと。`,
      setup: "",
      expectedOutput: [
        [1, 1],
        [2, 3],
        [3, 6],
        [4, 10],
        [5, 15],
        [6, 21],
        [7, 28],
        [8, 36],
        [9, 45],
        [10, 55],
      ],
      hints: [
        { level: 1, text: "WITH RECURSIVE seq AS (...) でアンカー部分と再帰部分を定義する。" },
        {
          level: 2,
          text: "アンカー: SELECT 1 AS n, 1 AS cumulative_sum. 再帰: n+1, cumulative_sum+(n+1) WHERE n < 10",
        },
      ],
      explanation: "`WITH RECURSIVE` でアンカー（n=1）と再帰（n+1, sum+n+1）を定義し10回繰り返す。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[DNG-L5-4] アクション別統計を分析せよ",
    category: "sql",
    difficulty: 3,
    body: {
      description: `## MISSION: 行動プロファイリング\n\nCTEを使ってアクションごとのアクセス件数と\n**全体に占める割合（%、小数点1桁）**を計算せよ。\n\n結果カラムは \`action\`、\`count\`、\`percentage\` とし、件数の多い順で返すこと。`,
      setup: DUNGEON_DDL,
      expectedOutput: [
        ["READ", 5, "50.0"],
        ["WRITE", 3, "30.0"],
        ["EXECUTE", 2, "20.0"],
      ],
      hints: [
        {
          level: 1,
          text: "CTEでaction別件数を集計してから、外のクエリでtotalを使って割合を計算する。",
        },
        { level: 2, text: "ROUND(count * 100.0 / total, 1) で割合を計算できる。" },
      ],
      explanation: "CTEで合計件数を求め、`ROUND(count * 100.0 / total, 1)` で割合を計算する。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[DNG-L5-5] 前回アクセスとの間隔を算出せよ",
    category: "sql",
    difficulty: 3,
    body: {
      description: `## MISSION: 異常アクセス間隔の検出\n\nLAG()ウィンドウ関数を使って、各アクセスログと**前のアクセスとの時間差（時間単位）**を計算せよ。\n\n結果カラムは \`id\`、\`accessed_at\`、\`hours_since_prev\`（前回からの時間差、初回はNULL）とし、IDの昇順で返すこと。`,
      setup: DUNGEON_DDL,
      expectedOutput: [
        [1, "2024-01-15 09:00:00", null],
        [2, "2024-01-15 10:00:00", 1],
        [3, "2024-01-15 11:00:00", 1],
        [4, "2024-01-16 09:00:00", 22],
        [5, "2024-01-16 10:00:00", 1],
        [6, "2024-01-17 14:00:00", 28],
        [7, "2024-01-17 15:00:00", 1],
        [8, "2024-01-18 09:00:00", 18],
        [9, "2024-01-19 11:00:00", 26],
        [10, "2024-01-19 13:00:00", 2],
      ],
      hints: [
        { level: 1, text: "LAG(accessed_at) OVER (ORDER BY id) で前行の値を取得できる。" },
        {
          level: 2,
          text: "EXTRACT(EPOCH FROM (accessed_at - prev)) / 3600 で時間差を計算できる。",
        },
      ],
      explanation:
        "`LAG(accessed_at) OVER (ORDER BY id)` で前のアクセス時刻を取得し、差をEPOCHで時間に変換する。",
    },
    isOfficial: true,
    status: "approved",
  },
]

// ── Python dungeon problems ───────────────────────────────────────────────────
const pythonProblemDefs: SeedProblem[] = [
  {
    title: "[PY-1] 侵入ログリストをソートせよ",
    category: "algorithm",
    difficulty: 0,
    body: {
      description: `## MISSION: 侵入ログ解析\n\nPythonスクリプトが動いている。ターゲットシステムの侵入ログを解析して攻撃経路を特定せよ。\n\n### タスク\nリストの基本操作を使って以下を実装せよ:\n\n1. **ソート**: \`access_times\` を昇順ソート（\`sorted()\` または \`.sort()\`）\n2. **スライス**: 最初の3件のみ取得（スライス記法: \`[0:3]\`）\n3. **リスト内包表記**: 偶数のみ抽出\n\n\`\`\`python\naccess_times = [1423, 892, 2891, 456, 1039, 2341, 78]\n\nsorted_times = sorted(access_times)\ntop3 = sorted_times[:3]\neven_times = [t for t in access_times if t % 2 == 0]\n\nprint(sorted_times)\nprint(top3)\nprint(even_times)\n\`\`\``,
      setup: "",
      expectedOutput: [],
      hints: [
        { level: 1, text: "`sorted(list)` は新しいリストを返す。`list.sort()` はインプレースでソートする。" },
        { level: 2, text: "リスト内包表記: `[x for x in list if 条件]` で条件に合う要素を抽出できる。" },
      ],
      explanation: "`sorted()` でソート、スライス `[:3]` で先頭3件、リスト内包表記で条件フィルタリングを行う。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[PY-2] エージェント情報を辞書で管理せよ",
    category: "algorithm",
    difficulty: 0,
    body: {
      description: `## MISSION: エージェントデータベース構築\n\n辞書（dict）を使ってエージェントの情報を効率的に管理せよ。\n\n### タスク\n\n1. **辞書作成**: エージェント情報を辞書で表現\n2. **安全なアクセス**: \`.get()\` でキー不在時のデフォルト値を設定\n3. **更新と追加**: 既存値の更新と新しいキーの追加\n4. **ループ**: \`.items()\` で全エントリを列挙\n\n\`\`\`python\nagent = {\n    "name": "CIPHER",\n    "level": 5,\n    "access_codes": ["ALPHA", "BETA"],\n}\n\nstatus = agent.get("status", "UNKNOWN")\nagent["level"] = 7\nagent["department"] = "INFILTRATION"\n\nfor key, value in agent.items():\n    print(f"{key}: {value}")\n\`\`\``,
      setup: "",
      expectedOutput: [],
      hints: [
        { level: 1, text: "`dict.get(key, default)` はキーが存在しない場合でも例外を起こさずデフォルト値を返す。" },
        { level: 2, text: "`for key, value in dict.items():` で辞書のすべてのキーと値をループできる。" },
      ],
      explanation: "辞書はキー→値のマッピング。`.get()`で安全アクセス、`.items()`でループ、直接代入で更新・追加。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[PY-3] ループで脆弱性を探索せよ",
    category: "algorithm",
    difficulty: 1,
    body: {
      description: `## MISSION: 脆弱性スキャン\n\nforループとwhileループを駆使して脆弱なポートをスキャンせよ。\n\n### タスク\n\n1. **enumerate**: インデックスと値を同時に取得\n2. **continue / break**: ループ制御でスキャンを最適化\n3. **whileループ**: 条件が満たされるまでリトライ\n\n\`\`\`python\nports = [22, 80, 443, 8080, 3306, 5432]\nclosed_ports = {3306}\n\nfor i, port in enumerate(ports):\n    if port in closed_ports:\n        continue\n    print(f"[{i}] PORT {port}: OPEN")\n    if port == 443:\n        print("HTTPS発見、侵入成功")\n        break\n\nattempts = 0\nwhile attempts < 3:\n    attempts += 1\n    print(f"試行 {attempts}/3")\n    if attempts == 2:\n        print("侵入完了")\n        break\n\`\`\``,
      setup: "",
      expectedOutput: [],
      hints: [
        { level: 1, text: "`enumerate(list)` は `(index, value)` のタプルを返す。インデックスと値を同時に取得できる。" },
        { level: 2, text: "`continue` は現在のループを次に進める。`break` はループ全体を終了する。" },
      ],
      explanation: "`for`ループで順次処理、`enumerate`でインデックス付きループ、`continue`/`break`でフロー制御を行う。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[PY-4] 暗号化関数を実装せよ",
    category: "algorithm",
    difficulty: 1,
    body: {
      description: `## MISSION: 暗号化モジュール開発\n\n関数を定義して、コードの再利用性を高めよ。\n\n### タスク\n\n1. **関数定義**: 引数と戻り値を持つ関数\n2. **デフォルト引数**: 省略可能なパラメータ\n3. **ラムダ**: 短い変換処理をインラインで定義\n4. **map**: 関数をリストに適用\n\n\`\`\`python\ndef encrypt(text: str, shift: int = 3) -> str:\n    result = ""\n    for char in text:\n        if char.isalpha():\n            base = ord('A') if char.isupper() else ord('a')\n            result += chr((ord(char) - base + shift) % 26 + base)\n        else:\n            result += char\n    return result\n\ndef decrypt(text: str, shift: int = 3) -> str:\n    return encrypt(text, -shift)\n\nencrypted = encrypt("HACK")  # デフォルトshift=3\nprint(encrypted)  # KDFN\n\ncodes = list(map(encrypt, ["SYS", "ROOT", "SUDO"]))\nprint(codes)\n\`\`\``,
      setup: "",
      expectedOutput: [],
      hints: [
        { level: 1, text: "デフォルト引数は `def func(arg=default):` のように定義する。呼び出し時に省略可能。" },
        { level: 2, text: "`map(function, iterable)` はiterable の各要素に関数を適用し、新しいイテレータを返す。" },
      ],
      explanation: "関数定義でコードを再利用可能に。デフォルト引数で柔軟性を確保。ラムダと高階関数でFP的なスタイルを活用。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[PY-5] エージェントクラスを設計せよ",
    category: "algorithm",
    difficulty: 2,
    body: {
      description: `## MISSION: エージェントAI設計\n\nオブジェクト指向プログラミングでエージェントシステムを設計せよ。\n\n### タスク\n\n1. **クラス定義**: \`__init__\` でインスタンス変数を初期化\n2. **メソッド**: エージェントの行動を定義\n3. **継承**: 基底クラスを拡張して特殊エージェントを作成\n4. **プロパティ**: \`@property\` でカプセル化\n\n\`\`\`python\nclass Agent:\n    def __init__(self, name: str, level: int):\n        self.name = name\n        self._level = level\n        self.missions: list[str] = []\n\n    @property\n    def level(self) -> int:\n        return self._level\n\n    def accept_mission(self, mission: str) -> None:\n        self.missions.append(mission)\n        print(f"{self.name} が {mission} を受諾")\n\n    def __repr__(self) -> str:\n        return f"Agent({self.name}, Lv{self.level})"\n\n\nclass EliteAgent(Agent):\n    def __init__(self, name: str, level: int, clearance: str):\n        super().__init__(name, level)\n        self.clearance = clearance\n\n    def infiltrate(self, target: str) -> str:\n        return f"[{self.clearance}] {self.name} → {target} 侵入完了"\n\n\nneo = EliteAgent("Neo", 10, "TOP_SECRET")\nneo.accept_mission("MATRIX_BREACH")\nprint(neo.infiltrate("MAINFRAME"))\nprint(repr(neo))\n\`\`\``,
      setup: "",
      expectedOutput: [],
      hints: [
        { level: 1, text: "`super().__init__(...)` で親クラスの初期化メソッドを呼び出す。継承時に必須。" },
        { level: 2, text: "`@property` デコレータで属性のように見えるメソッドを定義できる（getter）。" },
      ],
      explanation: "クラスでデータと処理をまとめ、継承で機能を拡張。`@property`でカプセル化を実現し、`__repr__`でデバッグを容易に。",
    },
    isOfficial: true,
    status: "approved",
  },
]

// ── JavaScript dungeon problems ────────────────────────────────────────────────
const jsProblemDefs: SeedProblem[] = [
  {
    title: "[JS-1] 配列メソッドで不審者を抽出せよ",
    category: "algorithm",
    difficulty: 0,
    body: {
      description: `## MISSION: 不審者リスト生成\n\nJavaScriptの配列メソッドを駆使して不審なアクセスを抽出せよ。\n\n### タスク\n\n1. **filter**: 条件に合う要素を抽出\n2. **map**: 各要素を変換\n3. **reduce**: 集計値を計算\n4. **find**: 最初の一致要素を取得\n\n\`\`\`javascript\nconst accessLogs = [\n  { user: "agent_neo", level: 5, attempts: 3 },\n  { user: "morpheus", level: 9, attempts: 1 },\n  { user: "unknown_x", level: 2, attempts: 15 },\n  { user: "trinity", level: 7, attempts: 2 },\n  { user: "bot_001", level: 1, attempts: 42 },\n];\n\nconst suspects = accessLogs.filter(log => log.attempts >= 5);\nconst suspectNames = suspects.map(log => log.user.toUpperCase());\nconst totalAttempts = accessLogs.reduce((sum, log) => sum + log.attempts, 0);\nconst topAgent = accessLogs.find(log => log.level === 9);\n\nconsole.log("不審者:", suspectNames);\nconsole.log("総試行回数:", totalAttempts);\nconsole.log("最高権限:", topAgent?.user);\n\`\`\``,
      setup: "",
      expectedOutput: [],
      hints: [
        { level: 1, text: "`array.filter(fn)` は条件を満たす要素のみを含む新しい配列を返す。元の配列は変更しない。" },
        { level: 2, text: "`array.reduce((acc, cur) => ..., initial)` で配列を単一の値に集約できる。" },
      ],
      explanation: "配列メソッド `filter`/`map`/`reduce`/`find` は関数型スタイルで配列を操作する強力なツール。メソッドチェーンで組み合わせると効果的。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[JS-2] Promiseチェーンで非同期を制御せよ",
    category: "algorithm",
    difficulty: 1,
    body: {
      description: `## MISSION: 非同期侵入シーケンス\n\nPromiseとasync/awaitで非同期処理を制御し、複数のシステムを順次ハックせよ。\n\n### タスク\n\n1. **Promise**: 非同期操作をPromiseでラップ\n2. **async/await**: 同期的に見えるコードで非同期処理\n3. **try/catch**: リジェクトをキャッチ\n4. **Promise.all**: 並列実行で効率化\n\n\`\`\`javascript\nconst delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));\n\nconst hackSystem = async (target) => {\n  await delay(100);\n  if (target === "FIREWALL") throw new Error("ACCESS DENIED");\n  return \`\${target}: COMPROMISED\`;\n};\n\nasync function infiltrate() {\n  try {\n    const r1 = await hackSystem("PROXY");\n    const r2 = await hackSystem("DATABASE");\n    console.log(r1, r2);\n  } catch (err) {\n    console.error("侵入失敗:", err.message);\n  }\n\n  const results = await Promise.all([\n    hackSystem("SERVER_A"),\n    hackSystem("SERVER_B"),\n  ]);\n  console.log(results);\n}\n\ninfiltrate();\n\`\`\``,
      setup: "",
      expectedOutput: [],
      hints: [
        { level: 1, text: "`async` 関数は常にPromiseを返す。`await` はPromiseが解決されるまで実行を一時停止する。" },
        { level: 2, text: "`Promise.all([p1, p2])` は全てのPromiseが解決されるまで待ち、結果の配列を返す。" },
      ],
      explanation: "async/awaitはPromiseのシンタックスシュガー。try/catchでエラーを処理し、Promise.allで並列実行を最適化する。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[JS-3] DOMを操作して罠を設置せよ",
    category: "algorithm",
    difficulty: 1,
    body: {
      description: `## MISSION: フロントエンド制御\n\nDOM APIを使ってウェブページを動的に操作せよ。\n\n### タスク\n\n1. **querySelector**: CSSセレクタで要素を取得\n2. **createElement / appendChild**: 要素を作成してDOMに追加\n3. **addEventListener**: クリックイベントを検知\n4. **setAttribute / style**: 属性とスタイルを操作\n\n\`\`\`javascript\nconst panel = document.querySelector("#control-panel");\nconst statusDiv = document.getElementById("status");\n\nconst btn = document.createElement("button");\nbtn.textContent = "ACTIVATE TRAP";\nbtn.setAttribute("data-type", "trap");\nbtn.style.backgroundColor = "#00ff41";\nbtn.style.color = "#000";\n\nbtn.addEventListener("click", (event) => {\n  console.log("トリガー:", event.target.dataset.type);\n  statusDiv.textContent = "⚠ SYSTEM COMPROMISED";\n  statusDiv.style.color = "red";\n});\n\npanel?.appendChild(btn);\n\`\`\``,
      setup: "",
      expectedOutput: [],
      hints: [
        { level: 1, text: "`document.querySelector(selector)` はCSSセレクタで最初に一致する要素を返す。見つからない場合は `null`。" },
        { level: 2, text: "`element.addEventListener('click', callback)` でクリックイベントを監視。`event.target` でクリックされた要素にアクセスできる。" },
      ],
      explanation: "DOM APIでHTMLを動的に操作。createElement→setAttribute→addEventListener→appendChildの順で要素を作成し機能を付加する。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[JS-4] クロージャで秘密を隠蔽せよ",
    category: "algorithm",
    difficulty: 2,
    body: {
      description: `## MISSION: 秘密の保護\n\nクロージャを使って外部からアクセスできない秘密の状態を管理せよ。\n\n### タスク\n\n1. **クロージャ**: 外部スコープの変数を閉じ込める\n2. **プライベート状態**: 直接アクセスできない変数\n3. **ファクトリ関数**: クロージャを返す関数\n4. **IIFE**: 即時実行関数式でモジュールを模倣\n\n\`\`\`javascript\nfunction createSecureCounter(secret) {\n  let count = 0;\n  const _secret = secret;\n\n  return {\n    increment() { count++; },\n    getCount() { return count; },\n    verify(code) { return code === _secret; },\n  };\n}\n\nconst counter = createSecureCounter("MATRIX");\ncounter.increment();\ncounter.increment();\nconsole.log(counter.getCount());       // 2\nconsole.log(counter.verify("MATRIX")); // true\nconsole.log(counter.count);            // undefined\n\nconst hackerModule = (() => {\n  const privateKey = "XK-7749";\n  return { getKey: () => btoa(privateKey) };\n})();\nconsole.log(hackerModule.getKey());\n\`\`\``,
      setup: "",
      expectedOutput: [],
      hints: [
        { level: 1, text: "クロージャは関数が定義されたスコープの変数を「閉じ込める」。関数が返されても、その変数は生き続ける。" },
        { level: 2, text: "IIFE（即時実行関数式）: `(() => { ... })()` でスクリプト実行時に一度だけ実行。スコープ汚染を防ぐ。" },
      ],
      explanation: "クロージャで変数を外部から隠蔽し、公開APIのみを返すことでカプセル化を実現。IIFEはモジュールパターンに活用される。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[JS-5] ES6+の機能を活用せよ",
    category: "algorithm",
    difficulty: 2,
    body: {
      description: `## MISSION: モダンJS習得\n\nES6以降の現代的なJavaScript機能を使ってコードを洗練させよ。\n\n### タスク\n\n1. **分割代入**: オブジェクト・配列からの値の取り出し\n2. **スプレッド演算子**: 配列・オブジェクトの展開\n3. **テンプレートリテラル**: 文字列補間\n4. **オプショナルチェーン (?.)**: 安全なプロパティアクセス\n\n\`\`\`javascript\nconst agent = {\n  name: "CIPHER",\n  stats: { level: 9, clearance: "TOP_SECRET" },\n  missions: ["ALPHA", "BETA", "GAMMA"],\n};\n\nconst { name, stats: { level, clearance } } = agent;\nconst [first, ...rest] = agent.missions;\n\nconst upgraded = {\n  ...agent,\n  stats: { ...agent.stats, level: level + 1 },\n};\n\nconsole.log(\`エージェント: \${name} (Lv\${level}) [\${clearance}]\`);\nconsole.log(\`初回ミッション: \${first}, 残り: \${rest.join(", ")}\`);\n\nconst avatarUrl = agent?.profile?.avatar?.url ?? "DEFAULT_AVATAR";\nconsole.log(avatarUrl);\n\`\`\``,
      setup: "",
      expectedOutput: [],
      hints: [
        { level: 1, text: "分割代入 `const { a, b } = obj` はオブジェクトのプロパティを変数に展開する。配列も `const [x, y] = arr` で同様に使える。" },
        { level: 2, text: "オプショナルチェーン `obj?.prop` はobjがnull/undefinedの場合、例外を投げずundefinedを返す。`??` はnull/undefinedの場合のフォールバック。" },
      ],
      explanation: "ES6+の機能（分割代入・スプレッド・テンプレートリテラル・オプショナルチェーン）でコードを簡潔で安全に記述できる。",
    },
    isOfficial: true,
    status: "approved",
  },
]

// ── C# dungeon problems ───────────────────────────────────────────────────────
const csProblemDefs: SeedProblem[] = [
  {
    title: "[CS-1] LINQで脅威データを照会せよ",
    category: "algorithm",
    difficulty: 0,
    body: {
      description: `## MISSION: データ照会システム\n\nLINQ（Language Integrated Query）を使ってセキュリティログを効率的に照会せよ。\n\n### タスク\n\n1. **Where**: 条件でフィルタリング\n2. **Select**: プロパティの射影\n3. **OrderByDescending**: 降順ソート\n4. **GroupBy + ToDictionary**: グループ集計\n\n\`\`\`csharp\nusing System;\nusing System.Collections.Generic;\nusing System.Linq;\n\nvar logs = new List<(string User, int Level, int Attempts)>\n{\n    ("agent_neo", 5, 3), ("morpheus", 9, 1),\n    ("unknown_x", 2, 15), ("trinity", 7, 2), ("bot_001", 1, 42),\n};\n\nvar suspects = logs\n    .Where(l => l.Attempts >= 5)\n    .OrderByDescending(l => l.Attempts)\n    .Select(l => l.User.ToUpper())\n    .ToList();\n\nvar grouped = logs\n    .GroupBy(l => l.Level > 5 ? "HIGH" : "LOW")\n    .ToDictionary(g => g.Key, g => g.Count());\n\nConsole.WriteLine(string.Join(", ", suspects));\nConsole.WriteLine(string.Join(", ", grouped.Select(kv => $"{kv.Key}: {kv.Value}")));\n\`\`\``,
      setup: "",
      expectedOutput: [],
      hints: [
        { level: 1, text: "LINQのメソッドチェーン: `Where().OrderBy().Select().ToList()` のように繋げて処理を記述する。" },
        { level: 2, text: "`GroupBy(keySelector).ToDictionary(g => g.Key, g => g.Count())` でグループ集計を辞書に変換できる。" },
      ],
      explanation: "LINQはSQL風のクエリをC#コードとして記述できる。`Where`でフィルタ、`Select`で射影、`GroupBy`で集計、`OrderBy`でソート。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[CS-2] 継承階層でエージェントを設計せよ",
    category: "algorithm",
    difficulty: 0,
    body: {
      description: `## MISSION: エージェント階層設計\n\n抽象クラスとインターフェースを使ってエージェントの型階層を構築せよ。\n\n### タスク\n\n1. **インターフェース**: 契約を定義\n2. **抽象クラス**: 共通実装を提供\n3. **継承**: 基底クラスを拡張（\`: base\`）\n4. **ポリモーフィズム**: 基底型で派生型を操作\n\n\`\`\`csharp\ninterface IHackable\n{\n    string Infiltrate(string target);\n    int Clearance { get; }\n}\n\nabstract class AgentBase : IHackable\n{\n    public string Name { get; }\n    public int Level { get; protected set; }\n    protected AgentBase(string name, int level) { Name = name; Level = level; }\n    public abstract int Clearance { get; }\n    public abstract string Infiltrate(string target);\n    public override string ToString() => $"[{GetType().Name}] {Name} Lv{Level}";\n}\n\nclass EliteAgent : AgentBase\n{\n    public override int Clearance => Level * 2;\n    public EliteAgent(string name, int level) : base(name, level) { }\n    public override string Infiltrate(string target) =>\n        $"{Name} (clearance={Clearance}) → {target}: BREACHED";\n}\n\nIHackable[] agents = { new EliteAgent("Neo", 10), new EliteAgent("Trinity", 8) };\nforeach (var a in agents)\n    Console.WriteLine(a.Infiltrate("MAINFRAME"));\n\`\`\``,
      setup: "",
      expectedOutput: [],
      hints: [
        { level: 1, text: "`abstract` メソッドは定義のみで実装を持たない。派生クラスで `override` して実装する必要がある。" },
        { level: 2, text: "インターフェース型で配列を作ると、実際の型に関わらず同じメソッドを呼び出せる（ポリモーフィズム）。" },
      ],
      explanation: "インターフェースで契約を定義し、抽象クラスで共通実装を提供。継承で機能を拡張し、基底型でポリモーフィックに操作する。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[CS-3] async/awaitで非同期処理せよ",
    category: "algorithm",
    difficulty: 1,
    body: {
      description: `## MISSION: 非同期侵入シーケンス\n\n\`async\`/\`await\` と \`Task\` を使って非同期処理を制御し、複数システムに並行侵入せよ。\n\n### タスク\n\n1. **async/await**: 非同期メソッドの定義と呼び出し\n2. **Task.Delay**: 非同期の待機\n3. **Task.WhenAll**: 複数タスクの並列実行\n4. **try/catch**: 例外ハンドリング\n\n\`\`\`csharp\nusing System;\nusing System.Threading.Tasks;\n\nasync Task<string> HackSystemAsync(string target)\n{\n    await Task.Delay(100);\n    if (target == "FIREWALL") throw new UnauthorizedAccessException("ACCESS DENIED");\n    return $"{target}: COMPROMISED";\n}\n\nasync Task RunAsync()\n{\n    try\n    {\n        var r1 = await HackSystemAsync("PROXY");\n        var r2 = await HackSystemAsync("DATABASE");\n        Console.WriteLine($"{r1}, {r2}");\n    }\n    catch (UnauthorizedAccessException ex)\n    {\n        Console.WriteLine($"失敗: {ex.Message}");\n    }\n\n    var results = await Task.WhenAll(\n        HackSystemAsync("SERVER_A"),\n        HackSystemAsync("SERVER_B")\n    );\n    Console.WriteLine(string.Join(", ", results));\n}\n\nawait RunAsync();\n\`\`\``,
      setup: "",
      expectedOutput: [],
      hints: [
        { level: 1, text: "`async` メソッドは `Task` または `Task<T>` を返す。`await` は非同期操作の完了を待ち、スレッドをブロックしない。" },
        { level: 2, text: "`Task.WhenAll(t1, t2)` は全タスクが完了するまで待ち、結果の配列を返す。例外が発生するとAggregateExceptionをスローする。" },
      ],
      explanation: "async/awaitでUIスレッドをブロックせずに非同期処理を実行。Task.WhenAllで並列実行して全体の処理時間を短縮する。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[CS-4] ジェネリクスとコレクションを活用せよ",
    category: "algorithm",
    difficulty: 1,
    body: {
      description: `## MISSION: データ構造マスタリー\n\nジェネリクスと.NETコレクションを使って型安全なデータ管理システムを構築せよ。\n\n### タスク\n\n1. **List<T>**: 動的配列の操作\n2. **Dictionary<TKey, TValue>**: キー・バリューストア\n3. **HashSet<T>**: 重複排除コレクション\n4. **ジェネリクスメソッド**: 型パラメータを持つメソッド\n\n\`\`\`csharp\nusing System;\nusing System.Collections.Generic;\nusing System.Linq;\n\nstatic List<T> PeekTop<T>(Stack<T> stack, int n) => stack.Take(n).ToList();\n\nvar registry = new Dictionary<string, int> { ["Neo"] = 10, ["Morpheus"] = 9 };\n\nvar compromised = new HashSet<string> { "SERVER_A", "DATABASE" };\ncompromised.Add("PROXY");\ncompromised.Add("SERVER_A"); // 重複は無視される\n\nvar log = new Stack<string>();\nlog.Push("INFILTRATE_PROXY");\nlog.Push("EXTRACT_KEYS");\nlog.Push("COVER_TRACKS");\n\nvar top2 = PeekTop(log, 2);\n\nConsole.WriteLine($"エージェント数: {registry.Count}");\nConsole.WriteLine($"侵害システム数: {compromised.Count}");\nConsole.WriteLine($"最新操作: {string.Join(", ", top2)}");\n\`\`\``,
      setup: "",
      expectedOutput: [],
      hints: [
        { level: 1, text: "`HashSet<T>` は重複を自動的に排除する。`Add()` の戻り値は追加された場合 `true`、重複の場合 `false`。" },
        { level: 2, text: "ジェネリクスメソッド `Method<T>()` は型を引数にとる。呼び出し時に型を指定する（多くの場合は型推論で省略可）。" },
      ],
      explanation: "List<T>はインデックスアクセス、Dictionary<K,V>は高速なキー検索、HashSet<T>は重複排除、Stack<T>はLIFO操作に最適。",
    },
    isOfficial: true,
    status: "approved",
  },
  {
    title: "[CS-5] 例外処理で障害に対応せよ",
    category: "algorithm",
    difficulty: 2,
    body: {
      description: `## MISSION: 障害対応プロトコル\n\n堅牢な例外処理を実装して、システム障害から自動回復するエージェントを構築せよ。\n\n### タスク\n\n1. **try/catch/finally**: 例外の捕捉とリソース解放\n2. **カスタム例外**: ドメイン固有の例外を定義\n3. **例外フィルタ**: \`when\` 句で条件付きキャッチ\n4. **複数catch**: 型別に例外を処理\n\n\`\`\`csharp\nusing System;\n\nclass InfiltrationException : Exception\n{\n    public string Target { get; }\n    public InfiltrationException(string target, string msg) : base(msg)\n        => Target = target;\n}\n\nstatic string HackTarget(string target)\n{\n    if (target == "HONEYPOT") throw new InfiltrationException(target, "罠を検知");\n    if (target == "NULL")     throw new ArgumentNullException(nameof(target));\n    return $"{target}: HACKED";\n}\n\nstring[] targets = { "SERVER_A", "HONEYPOT", "NULL", "DATABASE" };\nforeach (var target in targets)\n{\n    try\n    {\n        Console.WriteLine(HackTarget(target));\n    }\n    catch (InfiltrationException ex) when (ex.Target == "HONEYPOT")\n    {\n        Console.WriteLine($"⚠ ハニーポット回避: {ex.Message}");\n    }\n    catch (ArgumentNullException)\n    {\n        Console.WriteLine("⚠ 無効なターゲット。スキップ");\n    }\n    finally\n    {\n        // 常に実行（接続クリーンアップなど）\n    }\n}\n\`\`\``,
      setup: "",
      expectedOutput: [],
      hints: [
        { level: 1, text: "`catch (ExType ex) when (condition)` は例外フィルタ。例外の型に加えてconditionがtrueの場合のみキャッチする。" },
        { level: 2, text: "`finally` ブロックは例外の有無にかかわらず必ず実行される。DBやファイルのクリーンアップに使う。" },
      ],
      explanation: "カスタム例外で意味のあるエラー情報を伝達。`when`フィルタで細かい条件分岐、`finally`でリソースを確実に解放する。",
    },
    isOfficial: true,
    status: "approved",
  },
]

const DUNGEON_DEFS = [
  // SQL
  {
    name: "Data Vault",
    description: "企業の基幹データベースに侵入せよ。AIガード QUERY-DRONE が守っている。",
    language: "sql" as const,
    levelRequired: 0,
    bossName: "QUERY-DRONE",
    bossHp: 250,
    tier: 1,
  },
  {
    name: "Query Fortress",
    description: "高度なセキュリティで守られたデータ要塞。INDEX-SENTINEL が立ちはだかる。",
    language: "sql" as const,
    levelRequired: 3,
    bossName: "INDEX-SENTINEL",
    bossHp: 500,
    tier: 3,
  },
  {
    name: "Oracle Core",
    description: "企業の中枢AIシステムへの最終侵入。ORACLE-PRIME を倒せ。",
    language: "sql" as const,
    levelRequired: 5,
    bossName: "ORACLE-PRIME",
    bossHp: 800,
    tier: 5,
  },
  // Python
  {
    name: "Script Maze",
    description: "Pythonスクリプトが張り巡らされた迷宮。LOOP-DAEMON が待ち受ける。",
    language: "python" as const,
    levelRequired: 0,
    bossName: "LOOP-DAEMON",
    bossHp: 250,
    tier: 1,
  },
  {
    name: "Algorithm Lab",
    description: "最適化アルゴリズムで守られた研究施設。COMPLEXITY-AI が守護する。",
    language: "python" as const,
    levelRequired: 3,
    bossName: "COMPLEXITY-AI",
    bossHp: 500,
    tier: 3,
  },
  {
    name: "Neural Nest",
    description: "深層学習AIが潜む神経ネットワーク。NEURAL-CORE を破壊せよ。",
    language: "python" as const,
    levelRequired: 5,
    bossName: "NEURAL-CORE",
    bossHp: 800,
    tier: 5,
  },
  // JavaScript
  {
    name: "DOM Dungeon",
    description: "フロントエンドの闇に潜む罠。EVENT-GHOST が徘徊している。",
    language: "javascript" as const,
    levelRequired: 0,
    bossName: "EVENT-GHOST",
    bossHp: 250,
    tier: 1,
  },
  {
    name: "Async Abyss",
    description: "非同期処理の深淵。PROMISE-WRAITH が時間を操る。",
    language: "javascript" as const,
    levelRequired: 3,
    bossName: "PROMISE-WRAITH",
    bossHp: 500,
    tier: 3,
  },
  {
    name: "Runtime Rift",
    description: "V8エンジンの核心部。RUNTIME-DEITY に挑め。",
    language: "javascript" as const,
    levelRequired: 5,
    bossName: "RUNTIME-DEITY",
    bossHp: 800,
    tier: 5,
  },
  // C#
  {
    name: "Syntax Citadel",
    description: ".NETの防衛拠点。COMPILER-GUARD が型システムを守る。",
    language: "csharp" as const,
    levelRequired: 0,
    bossName: "COMPILER-GUARD",
    bossHp: 250,
    tier: 1,
  },
  {
    name: "LINQ Labyrinth",
    description: "LINQクエリが絡み合う迷宮。EXPRESSION-TREE が待つ。",
    language: "csharp" as const,
    levelRequired: 3,
    bossName: "EXPRESSION-TREE",
    bossHp: 500,
    tier: 3,
  },
  {
    name: "CLR Core",
    description: "共通言語ランタイムの中核。CLR-OVERLORD を倒して真の自由を得よ。",
    language: "csharp" as const,
    levelRequired: 5,
    bossName: "CLR-OVERLORD",
    bossHp: 800,
    tier: 5,
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

  // ── Language-specific problem definitions ────────────────────────────────
  const allLangProbDefs = [...pythonProblemDefs, ...jsProblemDefs, ...csProblemDefs]
  const allLangTitles = allLangProbDefs.map((p) => p.title)

  for (const def of allLangProbDefs) {
    await db
      .insert(problems)
      .values({
        title: def.title,
        category: def.category,
        difficulty: def.difficulty,
        body: def.body,
        isOfficial: def.isOfficial,
        status: def.status,
      })
      .onConflictDoNothing()
  }

  // ── Dungeon seed ─────────────────────────────────────────────────────────
  const existingDungeons = await db.select({ id: dungeons.id }).from(dungeons).limit(1)
  if (existingDungeons.length > 0) {
    console.log("[Seed] Dungeons already exist. Patching non-SQL dungeon rooms...")

    const langProbRows = await db
      .select({ id: problems.id, title: problems.title })
      .from(problems)
      .where(inArray(problems.title, allLangTitles))

    const langProbIdByTitle: Record<string, string> = {}
    for (const row of langProbRows) {
      if (!langProbIdByTitle[row.title]) langProbIdByTitle[row.title] = row.id
    }

    const allDungeonRows = await db.select().from(dungeons)
    const nonSqlDungeons = allDungeonRows.filter((d) => d.language !== "sql")

    const langTitlesMap: Record<string, string[]> = {
      python: pythonProblemDefs.map((p) => p.title),
      javascript: jsProblemDefs.map((p) => p.title),
      csharp: csProblemDefs.map((p) => p.title),
    }

    for (const dungeon of nonSqlDungeons) {
      const titles = langTitlesMap[dungeon.language]
      if (!titles) continue

      const rooms = await db
        .select()
        .from(dungeonRooms)
        .where(eq(dungeonRooms.dungeonId, dungeon.id))
        .orderBy(dungeonRooms.roomOrder)

      for (let i = 0; i < rooms.length; i++) {
        const room = rooms[i]
        const title = titles[i]
        if (!room || !title) continue
        const problemId = langProbIdByTitle[title]
        if (!problemId) {
          console.warn(`[Seed] Problem not found for patch: ${title}`)
          continue
        }
        await db.update(dungeonRooms).set({ problemId }).where(eq(dungeonRooms.id, room.id))
      }
      console.log(`[Seed] Patched ${rooms.length} rooms for dungeon: ${dungeon.name}`)
    }

    process.exit(0)
  }

  // ── First-time dungeon seed ───────────────────────────────────────────────
  console.log("[Seed] Seeding dungeon problems...")
  for (const problem of dungeonProblemDefs) {
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

  // Fetch all dungeon problem IDs (SQL + language-specific)
  const allDungeonProbTitles = [...dungeonProblemDefs.map((p) => p.title), ...allLangTitles]
  const dungeonProbRows = await db
    .select({ id: problems.id, title: problems.title })
    .from(problems)
    .where(inArray(problems.title, allDungeonProbTitles))

  const problemIdByTitle: Record<string, string> = {}
  for (const row of dungeonProbRows) {
    if (!problemIdByTitle[row.title]) problemIdByTitle[row.title] = row.id
  }

  // Language-aware tier → problem titles
  const pythonTitles = pythonProblemDefs.map((p) => p.title)
  const jsTitles = jsProblemDefs.map((p) => p.title)
  const csTitles = csProblemDefs.map((p) => p.title)

  const langTierTitles: Record<string, Record<number, string[]>> = {
    sql: {
      1: [
        "[DNG-L1-1] サーバー全リストを入手せよ",
        "[DNG-L1-2] オンラインサーバーを特定せよ",
        "[DNG-L1-3] 高権限エージェントを炙り出せ",
        "[DNG-L1-4] 部門別の人員数を把握せよ",
        "[DNG-L1-5] アクセスログと従業員を照合せよ",
      ],
      3: [
        "[DNG-L3-1] 給与ランキングを生成せよ",
        "[DNG-L3-2] 部門別平均給与をCTEで算出せよ",
        "[DNG-L3-3] サーバーのアクセス件数を集計せよ",
        "[DNG-L3-4] 高権限エージェントのサーバーを特定せよ",
        "[DNG-L3-5] 複数回アクセスした従業員を検出せよ",
      ],
      5: [
        "[DNG-L5-1] 累積アクセス数を解析せよ",
        "[DNG-L5-2] 部門内給与ランキングを生成せよ",
        "[DNG-L5-3] 再帰CTEでアクセス連鎖を解析せよ",
        "[DNG-L5-4] アクション別統計を分析せよ",
        "[DNG-L5-5] 前回アクセスとの間隔を算出せよ",
      ],
    },
    python: { 1: pythonTitles, 3: pythonTitles, 5: pythonTitles },
    javascript: { 1: jsTitles, 3: jsTitles, 5: jsTitles },
    csharp: { 1: csTitles, 3: csTitles, 5: csTitles },
  }

  const roomTypes = ["minion", "minion", "minion", "miniboss", "boss"] as const

  console.log("[Seed] Seeding dungeons and rooms...")
  for (const def of DUNGEON_DEFS) {
    const [dungeon] = await db
      .insert(dungeons)
      .values({
        name: def.name,
        description: def.description,
        language: def.language,
        levelRequired: def.levelRequired,
        bossName: def.bossName,
        bossHp: def.bossHp,
      })
      .returning()

    if (!dungeon) continue

    const tierProblems = langTierTitles[def.language]?.[def.tier]
    if (!tierProblems) continue

    for (let i = 0; i < tierProblems.length; i++) {
      const title = tierProblems[i]!
      const problemId = problemIdByTitle[title]
      if (!problemId) {
        console.warn(`[Seed] Problem not found: ${title}`)
        continue
      }
      await db.insert(dungeonRooms).values({
        dungeonId: dungeon.id,
        problemId,
        roomType: roomTypes[i]!,
        roomOrder: i,
      })
    }
  }

  console.log(`[Seed] Seeded ${DUNGEON_DEFS.length} dungeons with rooms.`)
  process.exit(0)
}

// Run when called directly
seed().catch((err) => {
  console.error("[Seed] Error:", err)
  process.exit(1)
})
