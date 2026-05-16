# CODE WORLD

> **「コードを書いて、街を作れ。」**
> SEとして必要なスキルが全部身につく、学習型オープンワールドサンドボックスゲーム。

---

## 1. ゲーム概要

### タイトル・コンセプト

**CODE WORLD** は、プログラミングやシステム設計の問題を解くことで「街のブロック」を獲得し、  
オープンワールドを自由に構築していくサンドボックス学習ゲームです。

- **学ぶ → 建てる → 共有する** の循環が核心
- 問題を解いた報酬がゲーム内資源（建物・道路・インフラ）になる
- 他プレイヤーが建てた街を訪問・コードレビューできる
- 正解を暗記させるのではなく、**「なぜそうなるか」を街の構造で体感させる**

### ターゲットユーザー

| レベル | 対象者 | ゲーム内ゴール |
|---|---|---|
| Lv.0 入門 | プログラミング未経験・文系就職SE | SQL基礎・Git操作・HTTP理解 |
| Lv.1 初級 | 入社1〜2年目のSE | CRUD設計・デバッグ・コードレビュー基礎 |
| Lv.2 中級 | 3〜5年目のSE | システム設計・パフォーマンス改善・マイクロサービス |
| Lv.3 上級 | リードエンジニア候補 | 大規模障害対応・アーキテクチャ設計・チーム設計 |

### 技術スタック案

| レイヤー | 選定技術 | 理由 |
|---|---|---|
| フロントエンド | Next.js 14 + TypeScript | SSR/ISR対応、型安全、エコシステム |
| 3Dワールド | React Three Fiber + Three.js | Web標準、モバイル対応可 |
| バックエンド | Go (Gin) | 高並列処理、シンプルなAPI設計 |
| コード実行環境 | Judge0 (OSS) / Deno Isolate | セキュアなサンドボックス実行 |
| リアルタイム | Socket.IO / Cloudflare Durable Objects | マルチプレイヤー同期 |
| データベース | PostgreSQL + Redis | 問題データ・スコア・セッション管理 |
| 認証 | Clerk / NextAuth.js | GitHub OAuth対応 |
| インフラ | Vercel + Fly.io + Neon | フルマネージド、低コスト |

---

## 2. 学習コンテンツ設計

### 2-1. SQLクエリ問題

「街のデータベース」として実際にクエリを書く形式。テーブルが街の住人・建物・道路に対応している。

#### 初級（Lv.0〜1）
```sql
-- 問題例：住人が100人以上いる区を全て取得せよ
SELECT district_name, population
FROM districts
WHERE population >= 100
ORDER BY population DESC;
```

| 問題カテゴリ | 例 | 獲得ブロック |
|---|---|---|
| SELECT基礎 | 特定の条件で住人を検索 | 木造住宅 |
| WHERE条件 | 年収100万以上の住人を抽出 | レンガ住宅 |
| ORDER BY | 人口順に区を並べる | 公園 |
| GROUP BY + COUNT | 職業ごとの人数を集計 | 商業ビル |
| JOIN (INNER) | 住人と建物を結合して家賃を取得 | 鉄筋ビル |

#### 中級（Lv.2）
```sql
-- 問題例：直近30日でアクティブなユーザーの平均購入回数を区ごとに集計
SELECT d.district_name,
       AVG(order_count) AS avg_orders
FROM districts d
JOIN (
  SELECT u.district_id, COUNT(o.id) AS order_count
  FROM users u
  JOIN orders o ON o.user_id = u.id
  WHERE o.created_at >= NOW() - INTERVAL '30 days'
  GROUP BY u.district_id, u.id
) sub ON sub.district_id = d.id
GROUP BY d.district_name
HAVING AVG(order_count) > 3;
```

| 問題カテゴリ | 獲得ブロック |
|---|---|
| サブクエリ / CTE | 高層マンション |
| WINDOW関数 | 広場・噴水 |
| インデックス設計 | 地下鉄駅 |
| トランザクション設計 | 銀行 |
| クエリチューニング（EXPLAIN ANALYZE） | 超高層ビル |

#### 上級（Lv.3）
- シャーディング設計問題
- レプリケーションラグ対策
- デッドロック解析と再設計

---

### 2-2. システム設計問題

「街のインフラ設計」として出題。図を描いて正解を目指す形式（draw.io互換のUIで提出）。

| 問題 | 内容 | 制約条件 |
|---|---|---|
| SNSのフィード設計 | タイムラインをどう配信するか | DAU 100万、レイテンシ100ms以下 |
| 短縮URLサービス | 1秒に10万件のリダイレクト | DB選定・キャッシュ戦略 |
| 在庫管理システム | 同時注文時の整合性 | 在庫マイナス禁止・二重購入禁止 |
| チャットシステム | グループチャット既読管理 | 1グループ最大10万人 |
| 決済システム | 冪等性を保った決済フロー | 障害時のリカバリ設計込み |

**採点方式：**
- ルーブリック形式（スケーラビリティ・信頼性・コスト・シンプルさ）
- 模範解答との差分を可視化
- 他プレイヤーの設計を匿名でレビューしてポイント獲得

---

### 2-3. バグ修正ミッション

「街に障害が発生した」という演出でデバッグ問題を出題。

```
🚨 緊急アラート: 商業区でサービス障害発生！
   エラーレート: 98%
   原因を特定して修正せよ。制限時間: 20分
```

**問題パターン：**

| カテゴリ | 具体例 |
|---|---|
| 構文エラー | typo・括弧忘れ（Lv.0） |
| ロジックエラー | off-by-one・条件反転（Lv.1） |
| パフォーマンスバグ | N+1クエリ・不要なループ（Lv.2） |
| 並行性バグ | race condition・deadlock（Lv.3） |
| メモリリーク | GC不足・循環参照（Lv.3） |

---

### 2-4. コードレビュータスク

他プレイヤー（またはAI生成）のコードをレビューしてコメントする。  
レビューの質をAIが採点し、的確なレビューで街にポイントが還元される。

**レビュー観点チェックリスト（自動ガイド付き）：**
- [ ] 変数名・関数名は意図が伝わるか
- [ ] エラーハンドリングは適切か
- [ ] 単一責任原則を守っているか
- [ ] テストが書けるコードか
- [ ] セキュリティリスクはないか（SQLインジェクション等）

---

### 2-5. 難易度の段階設計

```
Lv.0 ─── Lv.1 ─────── Lv.2 ─────────── Lv.3
  │          │              │                 │
入門村     基礎区        実務区           上級都市
  │          │              │                 │
SELECT      JOIN          設計問題         障害対応
Git基礎     デバッグ      チューニング      アーキテクチャ
HTTP        REST API      マイクロサービス  チーム設計
```

- 各レベルは**前のレベルをクリアしないと解放されない**
- ただしサンドボックスエリアは常に開放（学習ペースを強制しない）
- 「ガイドあり」「ヒントあり」「完全自力」の3モードを選択可能

---

## 3. ゲームシステム設計

### 3-1. オープンワールドの構造

```
┌──────────────────────────────────────────────┐
│                  CODE WORLD                   │
│                                              │
│  [入門村]  ──→  [基礎区]  ──→  [実務区]     │
│    SQL基礎        JOIN/設計      パフォーマンス │
│                                              │
│  [自分の区画]  ← 問題を解いて獲得したブロックで建設 │
│                                              │
│  [他プレイヤーの区画]  ← 訪問・コードレビュー可  │
│                                              │
│  [共有インフラゾーン]  ← マルチプレイヤー協力エリア │
└──────────────────────────────────────────────┘
```

**ゾーン詳細：**

| ゾーン | 内容 | 解放条件 |
|---|---|---|
| 入門村 | チュートリアル・基礎問題 | 初回ログイン |
| 基礎区 | JOIN・API・Git問題 | Lv.1到達 |
| 実務区 | 設計・チューニング問題 | Lv.2到達 |
| 上級都市 | 障害対応・大規模設計 | Lv.3到達 |
| 自分の区画 | 自由建設エリア | 初回ログイン |
| 共有インフラ | チーム協力問題 | Lv.1到達 |

---

### 3-2. サンドボックス要素

**建設できるもの（問題を解いて獲得）：**

| ブロック種別 | 獲得方法 | ゲーム内の意味 |
|---|---|---|
| 木造住宅 | SELECT基礎クリア | 人口+10 |
| 商業ビル | GROUP BY/集計クリア | 税収+100/日 |
| 発電所 | システム設計クリア | 電力供給範囲+5 |
| 地下鉄 | パフォーマンス問題クリア | 移動速度UP |
| 病院 | セキュリティ問題クリア | バグ障害回復速度UP |
| 研究所 | 上級問題クリア | 新建物解放 |

**自由に決められること：**
- 区画のレイアウト（道路・ゾーニング）
- 建物の配置・名前・カラーテーマ
- 区のルール（どんな問題で人が移住してくるか）
- 他プレイヤーへの土地の開放・非公開設定

---

### 3-3. マルチプレイヤー設計

**協力モード：**
- 2〜4人で「大規模システム設計」を分担して解く
- 役割分担：フロント担当・DB担当・インフラ担当
- 全員の解答が揃って初めてビルが完成する

**競争モード：**
- 同じバグ修正問題を同時スタート、早解きランキング
- SQLクエリ最適化バトル（実行速度で勝負）

**コードレビューエコノミー：**
- 他プレイヤーのコードをレビュー → レビュアーにも報酬
- レビューの質をコミュニティが評価 → 高評価レビュアーに称号

---

### 3-4. ユーザー生成コンテンツ（UGC）

**問題の自作・投稿：**
```yaml
# 問題フォーマット例
id: user_sql_001
author: "@username"
title: "住人の平均年収を区ごとに出せ"
difficulty: 2
category: sql/aggregation
schema: |
  CREATE TABLE residents (...);
  INSERT INTO residents VALUES (...);
expected_output:
  - [新宿区, 4200000]
  - [渋谷区, 5100000]
hints:
  - "GROUP BY を使おう"
  - "AVG関数を使おう"
solution: |
  SELECT district, AVG(salary) FROM residents GROUP BY district;
tags: [sql, group-by, avg]
```

**審査フロー：**
1. 投稿 → 自動テスト（答えが一意か・スキーマが正しいか）
2. コミュニティレビュー（3名以上のLv.2以上が承認）
3. 公開 → 投稿者に問題採用バッジ + ブロック報酬

---

## 4. 技術アーキテクチャ

### 4-1. フロントエンド

```
src/
├── app/                    # Next.js App Router
│   ├── world/              # 3Dワールド本体
│   ├── problems/           # 問題一覧・詳細
│   ├── editor/             # コードエディタ画面
│   └── profile/            # プレイヤープロフィール
├── game/
│   ├── World.tsx           # R3F ワールドレンダリング
│   ├── BuildingSystem.tsx  # 建設システム
│   ├── PlayerController.tsx
│   └── MultiplayerSync.tsx # リアルタイム同期
├── components/
│   ├── CodeEditor/         # Monaco Editor ラッパー
│   ├── SqlRunner/          # SQLクエリ実行UI
│   ├── DesignBoard/        # システム設計キャンバス
│   └── ReviewPanel/        # コードレビューUI
└── lib/
    ├── api/                # API クライアント
    ├── store/              # Zustand グローバル状態
    └── judge/              # コード実行クライアント
```

**主要ライブラリ：**
- `@monaco-editor/react` — コードエディタ
- `react-three-fiber` + `drei` — 3Dワールド
- `socket.io-client` — リアルタイム通信
- `zustand` — 状態管理
- `react-flow` — システム設計キャンバス（ノード/エッジ描画）

---

### 4-2. バックエンド

```
/
├── cmd/
│   └── server/main.go      # エントリポイント
├── internal/
│   ├── handler/            # HTTPハンドラ
│   │   ├── problems.go
│   │   ├── submissions.go
│   │   ├── world.go
│   │   └── review.go
│   ├── service/            # ビジネスロジック
│   │   ├── judge.go        # コード採点ロジック
│   │   ├── world.go        # ワールド管理
│   │   └── reward.go       # 報酬計算
│   ├── repository/         # DB アクセス層
│   └── model/              # データモデル
├── pkg/
│   ├── sandbox/            # コード実行サンドボックス
│   └── realtime/           # WebSocket 管理
└── migrations/             # DBマイグレーション
```

**APIエンドポイント（主要）：**

```
GET    /api/problems              # 問題一覧
GET    /api/problems/:id          # 問題詳細
POST   /api/problems/:id/submit   # 回答提出
GET    /api/world/:userId         # ワールド状態取得
POST   /api/world/build           # ブロック設置
GET    /api/reviews               # レビュー対象一覧
POST   /api/reviews/:submissionId # レビュー投稿
WS     /ws/world                  # リアルタイムワールド同期
```

---

### 4-3. データベース設計

```sql
-- プレイヤー
CREATE TABLE players (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_id   TEXT UNIQUE NOT NULL,
  username    TEXT NOT NULL,
  level       INT DEFAULT 0,
  xp          INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 問題
CREATE TABLE problems (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id   UUID REFERENCES players(id),
  title       TEXT NOT NULL,
  category    TEXT NOT NULL,          -- 'sql', 'design', 'debug', 'review'
  difficulty  INT CHECK (difficulty BETWEEN 0 AND 3),
  body        JSONB NOT NULL,         -- 問題文・スキーマ・期待出力
  is_official BOOLEAN DEFAULT false,
  status      TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 提出履歴
CREATE TABLE submissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   UUID REFERENCES players(id),
  problem_id  UUID REFERENCES problems(id),
  code        TEXT NOT NULL,
  result      TEXT,                   -- 'accepted', 'wrong', 'error', 'timeout'
  score       INT DEFAULT 0,
  exec_time_ms INT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ワールド状態
CREATE TABLE world_blocks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   UUID REFERENCES players(id),
  block_type  TEXT NOT NULL,
  position_x  INT NOT NULL,
  position_y  INT NOT NULL,
  position_z  INT NOT NULL,
  meta        JSONB,                  -- 名前・カラー等
  placed_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(player_id, position_x, position_y, position_z)
);

-- 報酬ログ
CREATE TABLE rewards (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    UUID REFERENCES players(id),
  source_type  TEXT NOT NULL,         -- 'problem', 'review', 'ugc_approved'
  source_id    UUID,
  block_type   TEXT NOT NULL,
  quantity     INT DEFAULT 1,
  granted_at   TIMESTAMPTZ DEFAULT NOW()
);

-- コードレビュー
CREATE TABLE code_reviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_id    UUID REFERENCES players(id),
  submission_id  UUID REFERENCES submissions(id),
  comments       JSONB NOT NULL,      -- [{line, body, type}]
  rating         INT CHECK (rating BETWEEN 1 AND 5),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
```

**インデックス：**
```sql
CREATE INDEX idx_submissions_player ON submissions(player_id, created_at DESC);
CREATE INDEX idx_problems_category_diff ON problems(category, difficulty) WHERE status = 'approved';
CREATE INDEX idx_world_blocks_player ON world_blocks(player_id);
```

---

### 4-4. リアルタイム通信

**マルチプレイヤー同期（WebSocket）：**

```typescript
// イベント定義
type WorldEvent =
  | { type: 'block_placed';  playerId: string; block: Block }
  | { type: 'block_removed'; playerId: string; position: Position }
  | { type: 'player_moved';  playerId: string; position: Position }
  | { type: 'problem_solved'; playerId: string; problemId: string }
  | { type: 'chat';          playerId: string; message: string }
```

**スケーリング戦略：**
- プレイヤー区画単位でルームを分割（最大50人/ルーム）
- Redis PubSub でサーバー間イベント伝播
- 建設イベントは楽観的UIアップデート → サーバー確定後に同期

---

## 5. MVP（段階的リリース計画）

### Week 1 — ローカル動作する最小版

**目標：** SQLの問題を1問解いて、ブロックが1個置ける

- [ ] Next.js プロジェクト初期化
- [ ] Monaco Editor でSQLを書ける画面
- [ ] SQLite でクエリ実行（サンドボックス不要な最初期）
- [ ] 正解判定ロジック（期待出力との比較）
- [ ] 3Dワールドに1×1×1のブロックを置けるR3F画面
- [ ] ローカルストレージに状態保存

**使える技術：** Next.js + R3F + better-sqlite3

---

### Month 1 — 公開できるβ版

**目標：** GitHubログインして友人に見せられる

- [ ] GitHub OAuth 認証（NextAuth.js）
- [ ] PostgreSQL + Prisma でユーザー・提出履歴を永続化
- [ ] SQLカテゴリの問題 20問
- [ ] 正解時にブロックが付与されワールドに配置できる
- [ ] 他人のワールドをURLで見られる（読み取り専用）
- [ ] 基本的なプロフィール画面（解いた問題・レベル）
- [ ] Vercel + Neon でデプロイ

**問題数目標：** SQL 20問・デバッグ 10問

---

### Month 3 — コミュニティが育つ版

**目標：** OSSとして外部コントリビューターが問題を追加できる

- [ ] 問題投稿UI・審査フロー
- [ ] コードレビュータスク機能
- [ ] リアルタイムマルチプレイヤー（WebSocket）
- [ ] システム設計問題（react-flow キャンバス）
- [ ] 難易度Lv.0〜2の全問題セット（計100問以上）
- [ ] レビューエコノミー（レビュアー報酬）
- [ ] モバイル対応（3Dはシンプル化）
- [ ] コミュニティDiscord連携

**問題数目標：** SQL 50問・デバッグ 30問・設計 20問・レビュー 20問

---

## 6. OSS設計

### 6-1. リポジトリ構造

```
code-world/
├── apps/
│   ├── web/               # Next.js フロントエンド
│   └── api/               # Go バックエンド
├── packages/
│   ├── problems/          # 問題データ（YAML形式）
│   │   ├── sql/
│   │   │   ├── beginner/
│   │   │   ├── intermediate/
│   │   │   └── advanced/
│   │   ├── debug/
│   │   ├── design/
│   │   └── review/
│   ├── judge/             # 採点エンジン（単体利用可）
│   └── ui/                # 共有UIコンポーネント
├── docs/                  # ドキュメント
│   ├── CONTRIBUTING.md
│   ├── PROBLEM_GUIDE.md   # 問題作成ガイド
│   └── architecture/
└── scripts/               # セットアップ・デプロイスクリプト
```

---

### 6-2. 問題の追加方法

**1. ファイルを作成（YAMLフォーマット）：**

```yaml
# packages/problems/sql/beginner/select_basics_001.yaml
meta:
  id: select_basics_001
  title: "住人を名前順で取得せよ"
  category: sql
  difficulty: 0
  author: "@your-github-username"
  tags: [select, order-by]

setup: |
  CREATE TABLE residents (
    id   INT,
    name TEXT,
    age  INT
  );
  INSERT INTO residents VALUES
    (1, '田中', 28),
    (2, '佐藤', 35),
    (3, '山田', 22);

problem: |
  residentsテーブルから全住人を名前のアルファベット順（昇順）で取得するSQLを書いてください。

expected_output:
  columns: [id, name, age]
  rows:
    - [2, 佐藤, 35]
    - [3, 山田, 22]
    - [1, 田中, 28]

hints:
  - level: 1
    text: "ORDER BY句を使います"
  - level: 2
    text: "ORDER BY name ASC"

explanation: |
  ORDER BY句を使うことでSELECT結果を並び替えられます。
  デフォルト（ASC）は昇順です。

reward:
  block_type: wooden_house
  quantity: 1
```

**2. プルリクエストを作成：**

```bash
git checkout -b add/sql-select-basics-001
# ファイルを追加
git add packages/problems/sql/beginner/select_basics_001.yaml
git commit -m "feat(problems): add SQL SELECT ORDER BY problem"
git push origin add/sql-select-basics-001
# GitHub でPR作成
```

**3. 自動テストが走る：**
- YAML スキーマバリデーション
- SQLを実際に実行して expected_output と一致するか確認
- 重複問題検出

**4. レビュー・マージ：**
- メンテナーまたはLv.2以上のコントリビューター2名がApprove
- マージ後、次のデプロイで本番反映

---

### 6-3. コントリビュートの仕組み

**コントリビューターの種類：**

| 種類 | 内容 | 必要スキル |
|---|---|---|
| 問題作成者 | YAMLで問題を追加 | SQLやプログラミングの知識 |
| 翻訳者 | 問題文を多言語化 | 日英翻訳 |
| バグ修正者 | issueを拾ってfix | TypeScript / Go |
| UIコントリビューター | フロント改善 | React / R3F |
| 採点エンジン改善 | Judge精度向上 | Go / セキュリティ |

**コントリビューターの特典（ゲーム内）：**
- 採用された問題1問ごとに「問題作成者バッジ」
- コントリビューター専用建物（開発者の家）解放
- プロフィールにGitHub連携表示

---

### 6-4. コミュニティ設計

**チャンネル構成（Discord）：**

```
CODE WORLD Community
├── #announcements       ← リリース情報
├── #general             ← 雑談
├── #problem-discussion  ← 問題の解き方・ヒント
├── #problem-proposals   ← 新問題のアイデア共有
├── #bug-reports         ← バグ報告
├── #showcase            ← 自分の街を見せる
└── #contributors        ← OSS開発の話
```

**コミュニティルール：**
1. 問題の答えを直接投稿しない（ヒントまでにする）
2. 他プレイヤーのワールドには敬意を持ってレビューする
3. 問題投稿時は必ず動作確認してからPRを出す
4. Inclusiveな雰囲気を保つ（初心者を歓迎する）

---

## ライセンス

- **コード:** MIT License
- **問題データ (`packages/problems/`):** CC BY-SA 4.0
  - 問題を改変・再配布する場合は同じライセンスで
  - 作者のクレジットを記載すること

---

## 開発に参加する

```bash
# リポジトリをクローン
git clone https://github.com/your-org/code-world.git
cd code-world

# 依存パッケージをインストール
npm install

# ローカルDBを起動（Docker）
docker compose up -d db

# マイグレーション実行
npm run db:migrate

# 開発サーバー起動
npm run dev
# → http://localhost:3000
```

詳細は [CONTRIBUTING.md](./docs/CONTRIBUTING.md) を参照してください。

---

*CODE WORLD — コードを書いて、街を作れ。*
