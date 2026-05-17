# CODE WORLD — 技術設計書・全体まとめ

> 「コードを書いて、街を作れ。」  
> サイバーパンク世界を舞台にしたダンジョンRPG × 学習型オープンワールドゲーム

---

## 目次

1. [プロジェクト概要](#1-プロジェクト概要)
2. [技術スタック全体](#2-技術スタック全体)
3. [モノレポ構成](#3-モノレポ構成)
4. [フロントエンド設計](#4-フロントエンド設計)
5. [バックエンド設計](#5-バックエンド設計)
6. [コード実行パイプライン](#6-コード実行パイプライン)
7. [データベース設計](#7-データベース設計)
8. [リアルタイム通信](#8-リアルタイム通信)
9. [ゲームシステム設計](#9-ゲームシステム設計)
10. [認証設計](#10-認証設計)
11. [インフラ・デプロイ](#11-インフラデプロイ)
12. [セキュリティ設計](#12-セキュリティ設計)
13. [学習コンテンツ設計](#13-学習コンテンツ設計)
14. [ゲームループ設計](#14-ゲームループ設計)
15. [開発の経緯・意思決定](#15-開発の経緯意思決定)

---

## 1. プロジェクト概要

### コンセプト

CODE WORLD は2つのゲームジャンルを融合した学習ゲームです。

- **ダンジョンRPG（マトリックス風）**: SQLやPython・JavaScript・C#の問題を解いてAIボスと戦う
- **オープンワールドサンドボックス**: ダンジョンで獲得したブロックを使って自由に街を建設

### ターゲットユーザー

| レベル | 対象 | 習得スキル |
|--------|------|-----------|
| Lv.0 入門 | プログラミング未経験 | SELECT・WHERE・ORDER BY |
| Lv.1 基礎 | 入社1〜2年目のSE | JOIN・GROUP BY・サブクエリ |
| Lv.2 中級 | 3〜5年目のSE | ウィンドウ関数・CTE・設計 |
| Lv.3 上級 | リードエンジニア候補 | 大規模設計・最適化 |

### 本番URL

```
https://code-worldweb-production.up.railway.app
```

### GitHub

```
https://github.com/EGAMIJUN/code-world
```

---

## 2. 技術スタック全体

### 全体図

```
┌─────────────────────────────────────────────────────┐
│                    ユーザーのブラウザ                  │
│  Next.js 15 (App Router + RSC)                      │
│  Phaser 3 (2Dゲームエンジン)                         │
│  Monaco Editor (VS Codeと同じエディタ)               │
│  Tailwind v4 + shadcn/ui                            │
│  Zustand + TanStack Query                           │
└───────────────────┬─────────────────────────────────┘
                    │ HTTPS + WebSocket
┌───────────────────▼─────────────────────────────────┐
│                    APIサーバー (Hono)                 │
│  Better Auth (認証)                                  │
│  Socket.io (リアルタイム通信)                        │
│  Zod (バリデーション)                                │
└──────┬──────────────────────┬───────────────────────┘
       │ BullMQ (ジョブキュー) │
┌──────▼──────┐         ┌─────▼──────────────────────┐
│  Executor   │         │        データ層             │
│  BullMQ     │         │  PostgreSQL (Neon)          │
│  Judge0     │         │  Redis (Upstash)            │
│  Docker     │         │  Drizzle ORM               │
└─────────────┘         └────────────────────────────┘
```

### 技術選定一覧

| レイヤー | 技術 | 選定理由 |
|---------|------|---------|
| フロントフレームワーク | Next.js 15 | App Router + RSCで高速レンダリング |
| ゲームエンジン | Phaser 3 | Next.jsのcanvasコンポーネントとして組み込める |
| コードエディタ | Monaco Editor | VS Codeと同じエンジン、SQL・多言語対応 |
| バックエンド | Hono | `hono/client`でフロントと型共有可能 |
| 認証 | Better Auth | GitHub OAuth + メール認証、セッション管理 |
| ORM | Drizzle ORM | 型安全かつSQL的記法、PrismaよりSQLに近い |
| キュー | BullMQ | Redis based、優先度・リトライ・タイムアウト完備 |
| コード実行 | Judge0 | 40+言語対応、SQL含む、セルフホスト可 |
| DB | PostgreSQL (Neon) | ブランチDB機能あり、PRごとにDB分岐可能 |
| キャッシュ/Pub-Sub | Redis (Upstash) | BullMQ + リーダーボード + WebSocket adapter |
| リアルタイム | Socket.io | マルチプレイヤー位置同期・チャット |
| パッケージマネージャー | Bun | npm比10倍速、workspaces対応 |
| モノレポ | Turborepo | ビルドキャッシュ、並列ビルド |
| Lint/Format | Biome | ESLint + Prettierの代替、10倍高速 |

---

## 3. モノレポ構成

```
code-world/
├── apps/
│   ├── web/              # Next.js 15 フロントエンド
│   ├── api/              # Hono APIサーバー
│   └── executor/         # BullMQ Worker + コード実行
├── packages/
│   ├── db/               # Drizzle ORM + スキーマ + seed
│   ├── types/            # Zodスキーマ共有 (api ↔ web)
│   ├── ui/               # shadcn/uiコンポーネント
│   └── config/           # tsconfig・biome共通設定
├── CLAUDE.md             # Claude Code用プロジェクト説明
├── DEPLOY.md             # デプロイ手順書
├── docker-compose.yml    # ローカル開発用 (PG + Redis)
├── turbo.json            # Turborepo設定
└── package.json          # Bun workspaces設定
```

### 型共有の仕組み

```typescript
// packages/types/src/schemas/submission.ts
export const CreateSubmissionSchema = z.object({
  problemId: z.string().uuid(),
  code: z.string().min(1).max(50_000),
  language: z.enum(["sql", "python", "javascript", "csharp"]).default("sql"),
})

// apps/api → このスキーマでバリデーション
// apps/web → 同じスキーマで型推論
```

---

## 4. フロントエンド設計

### ディレクトリ構成 (apps/web)

```
apps/web/src/
├── app/
│   ├── layout.tsx           # 共通レイアウト (NavHeader + MatrixRain)
│   ├── page.tsx             # トップページ
│   ├── login/page.tsx       # ログイン
│   ├── signup/page.tsx      # 新規登録
│   ├── problems/
│   │   ├── page.tsx         # 問題一覧 (Server Component)
│   │   └── [id]/
│   │       ├── page.tsx     # 問題詳細
│   │       └── ProblemEditor.tsx  # Monaco Editor + 採点UI
│   ├── dungeon/
│   │   ├── page.tsx         # ダンジョン選択 (マトリックス雨エフェクト)
│   │   ├── DungeonSelectClient.tsx
│   │   └── [id]/
│   │       ├── page.tsx     # 戦闘ページ
│   │       └── BattleClient.tsx   # RPG戦闘UI
│   ├── world/
│   │   ├── page.tsx         # ゲームワールド
│   │   ├── WorldClient.tsx  # dynamic import wrapper
│   │   ├── PhaserGame.tsx   # Phaser 3メインコンポーネント
│   │   └── [userId]/        # 他プレイヤーワールド閲覧
│   ├── leaderboard/page.tsx
│   └── profile/page.tsx
└── components/
    ├── NavHeader.tsx         # 共通ナビゲーション
    └── MatrixRain.tsx        # マトリックス雨アニメーション
```

### デザインシステム

全ページ共通のマトリックスデザイン：

```css
背景: #000000 (純黒)
メインカラー: #00ff41 (マトリックスグリーン)
サブカラー: #00aa2a
アクセント: #ff0040 (赤・ダメージ系)
フォント: monospace
```

### Phaser 3 の Next.js 統合

Phaser 3はSSR非対応なため `dynamic import + ssr:false` で組み込み：

```typescript
const PhaserGame = dynamic(() => import('./PhaserGame'), {
  ssr: false,
  loading: () => <LoadingScreen />
})
```

### アイソメトリック（疑似3D）ビュー

```typescript
// タイル座標 → スクリーン座標の変換
const screenX = (tx - ty) * (TILE_SIZE / 2) + ORIGIN_X
const screenY = (tx + ty) * (TILE_SIZE / 4) + ORIGIN_Y
```

---

## 5. バックエンド設計

### APIエンドポイント一覧

```
GET  /api/health                    # ヘルスチェック

# 認証 (Better Auth)
POST /api/auth/sign-up/email        # メール登録
POST /api/auth/sign-in/email        # メールログイン
GET  /api/auth/session              # セッション確認
POST /api/auth/sign-out             # ログアウト
GET  /api/auth/callback/github      # GitHub OAuthコールバック

# 問題
GET  /api/problems                  # 問題一覧 (難易度・カテゴリフィルター)
GET  /api/problems/:id              # 問題詳細 + テストケース

# 提出・採点
POST /api/submissions               # コード提出 → BullMQキューへ
GET  /api/submissions/:id           # 採点結果取得

# ワールド
GET  /api/worlds/my                 # 自分のワールド取得/作成
GET  /api/worlds/user/:userId       # 他プレイヤーのワールド
GET  /api/worlds/:id/blocks         # ブロック一覧
POST /api/worlds/:id/blocks         # ブロック設置

# インベントリ・プロフィール
GET  /api/inventory                 # 所持ブロック一覧
GET  /api/profile/me                # 自分のプロフィール
GET  /api/profile/:id               # 他プレイヤーのプロフィール

# ダンジョン
GET  /api/dungeons                  # ダンジョン一覧
GET  /api/dungeons/:id              # ダンジョン詳細 + 部屋
POST /api/dungeons/runs             # ダンジョン開始
PATCH /api/dungeons/runs/:runId     # バトル状態更新

# ランキング
GET  /api/leaderboard               # 上位10人

# WebSocket
WS   /ws                            # リアルタイム位置同期・チャット
```

### Hono RPC による型安全

```typescript
// apps/api/src/routes/submissions.ts
submissionsRouter.post("/", zValidator("json", CreateSubmissionSchema), async (c) => {
  const body = c.req.valid("json") // 型が自動推論される
  // ...
})
```

---

## 6. コード実行パイプライン

### フロー

```
ユーザーがコードを書く
    ↓
POST /api/submissions
    ↓
DBに pending レコード作成
    ↓
BullMQ キューにジョブ投入
    ↓ (即座に { id, status: "pending" } を返す)
    
Executor Worker が処理
    ↓
Judge0 に送信 (Docker内で実行)
    ↓
テストケースと比較
    ↓
DBに結果保存 (accepted / wrong_answer / runtime_error)
    ↓
Socket.io でリアルタイム通知
    ↓
フロントエンドに結果表示
```

### Judge0 サンドボックス

Judge0はコードをDockerコンテナ内で隔離実行します：

- CPU・メモリ・時間制限
- ネットワーク遮断
- SQL用に専用スキーマを動的作成（サンドボックス分離）

```sql
-- 各提出ごとに独立したスキーマを作成
CREATE SCHEMA IF NOT EXISTS sandbox_xxx;
SET search_path TO sandbox_xxx;
-- テーブル作成・データ挿入・クエリ実行
-- 終了後にスキーマを削除
DROP SCHEMA sandbox_xxx CASCADE;
```

### タイムアウト設定

| 言語 | ポーリング間隔 | 最大待機時間 |
|------|-------------|------------|
| SQL | 800ms | 30秒 |
| Python/JS/C# | 400ms | 60秒 |

---

## 7. データベース設計

### テーブル一覧

```sql
-- ユーザー
users (
  id UUID PK,
  email TEXT UNIQUE,
  username TEXT UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  level INT DEFAULT 0,
  xp INT DEFAULT 0,
  total_score INT DEFAULT 0,
  hp INT DEFAULT 200,         -- ダンジョン用HP
  preferred_language TEXT,    -- sql/python/javascript/csharp
  created_at TIMESTAMPTZ
)

-- 問題
problems (
  id UUID PK,
  author_id UUID → users,
  title TEXT UNIQUE,          -- 重複防止のユニーク制約
  category ENUM(sql/algorithm/design),
  difficulty INT (0-3),
  body JSONB,                 -- 問題文・テストケース・ヒント
  is_official BOOL,
  status ENUM(pending/approved/rejected),
  created_at TIMESTAMPTZ
)

-- 提出履歴
submissions (
  id UUID PK,
  player_id UUID → users,
  problem_id UUID → problems,
  code TEXT,
  result ENUM(pending/accepted/wrong_answer/runtime_error/time_limit_exceeded),
  score INT,
  exec_time_ms INT,
  feedback JSONB,             -- エラーメッセージ等
  language TEXT,
  created_at TIMESTAMPTZ
)

-- ワールド
worlds (
  id UUID PK,
  owner_id UUID → users UNIQUE,
  name TEXT,
  created_at TIMESTAMPTZ
)

-- ブロック
world_blocks (
  id UUID PK,
  world_id UUID → worlds,
  player_id UUID → users,
  block_type ENUM(wood_block/stone_block/diamond_block/gold_block/purple_block),
  tile_x INT,
  tile_y INT,
  placed_at TIMESTAMPTZ,
  UNIQUE(world_id, tile_x, tile_y)
)

-- インベントリ
inventory (
  id UUID PK,
  player_id UUID → users,
  block_type TEXT,
  quantity INT DEFAULT 0,
  UNIQUE(player_id, block_type)
)

-- 実績
achievements (
  id UUID PK,
  player_id UUID → users,
  type ENUM(first_ac/ten_solved/diamond_block/level_5),
  earned_at TIMESTAMPTZ,
  UNIQUE(player_id, type)
)

-- ダンジョン
dungeons (
  id UUID PK,
  name TEXT,
  language ENUM(sql/python/javascript/csharp),
  level_required INT,
  boss_name TEXT,
  boss_hp INT,
  description TEXT
)

-- ダンジョン部屋
dungeon_rooms (
  id UUID PK,
  dungeon_id UUID → dungeons,
  problem_id UUID → problems,
  room_order INT,
  room_type ENUM(minion/miniboss/boss)
)

-- ダンジョン挑戦履歴
dungeon_runs (
  id UUID PK,
  player_id UUID → users,
  dungeon_id UUID → dungeons,
  player_hp INT,
  boss_hp INT,
  status ENUM(in_progress/completed/failed),
  started_at TIMESTAMPTZ
)

-- Better Auth テーブル (自動生成)
auth_user, auth_session, auth_account, auth_verification
```

### 難易度別ブロック報酬

| 難易度 | ブロック | 色 |
|--------|---------|-----|
| Lv.0 初級 | 木材ブロック | 茶色 |
| Lv.1 基礎 | 石ブロック | グレー |
| Lv.2 中級 | ダイヤブロック | 水色 (発光) |
| Lv.3 上級 | 紫ブロック | 紫 (発光) |

---

## 8. リアルタイム通信

### WebSocket イベント仕様

```typescript
// クライアント → サーバー
{ type: "join", worldId: string, username: string, x: number, y: number }
{ type: "move", x: number, y: number }
{ type: "chat", text: string }  // 200文字制限

// サーバー → クライアント
{ type: "sync", players: Record<socketId, { username, x, y }> }
{ type: "chat", from: string, text: string, timestamp: number }
```

### スケール設計

- `worldId` 単位でルームを分割
- 同じワールドに入ったプレイヤー間でのみ同期
- 接続切断時は自動でルームから除外・全員に通知

### 位置同期レート

- 10Hz (100msごと) でブロードキャスト
- ジョイスティック入力は直接DOMを更新してReact re-renderを回避

---

## 9. ゲームシステム設計

### ダンジョン構造

```
12ダンジョン = 4言語 × 3難易度

各ダンジョン: 5部屋
  Room 1-3: 雑魚 (minion)
  Room 4:   ミニボス (miniboss)
  Room 5:   ボス (boss)

言語セクター:
  SQL SECTOR     : Data Vault / Query Fortress / Oracle Core
  PYTHON SECTOR  : Script Maze / Algorithm Lab / Neural Nest
  JS SECTOR      : DOM Dungeon / Async Abyss / Runtime Rift
  C# SECTOR      : Syntax Citadel / LINQ Labyrinth / CLR Core
```

### 戦闘バランス

| パラメータ | 値 |
|-----------|-----|
| プレイヤー初期HP | 200 |
| ボス攻撃間隔 | 15秒 |
| ボス攻撃ダメージ | 5 |
| 正解時のボスダメージ | 50 |
| 不正解時のプレイヤーダメージ | 10 |
| 敗北時XPペナルティ | -10% |

### XP・レベルシステム

```typescript
// レベルアップ計算
function getLevelFromXp(xp: number): number {
  let level = 0
  let required = 100
  let remaining = xp
  while (remaining >= required) {
    remaining -= required
    level++
    required = 100 * (level + 1)
  }
  return level
}

// XP付与量
Lv.0問題: +50 XP
Lv.1問題: +100 XP
Lv.2問題: +150 XP
Lv.3問題: +200 XP
```

### ワールドゾーン

```
32×32タイルのマップ

ゾーン分け:
  SQL District       (左上, 青系)
  Algorithm Forest   (右上, 緑系)
  System Design City (中央上, 紫系)
  Your City          (中央下, プレイヤー建設エリア)
  Web Dev Harbor     (下部, シアン系)
```

---

## 10. 認証設計

### Better Auth 設定

```typescript
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    }
  },
  emailAndPassword: { enabled: true },
  trustedOrigins: [
    "https://code-worldweb-production.up.railway.app",
    "http://localhost:3000",
  ],
  advanced: {
    defaultCookieAttributes: {
      sameSite: "none",  // クロスドメイン対応
      secure: true,      // HTTPS必須
    }
  }
})
```

### セッション管理

- セッショントークンはCookieで管理
- `credentials: "include"` で全APIリクエストに付与
- Better AuthがDBにセッションを保存

---

## 11. インフラ・デプロイ

### 本番環境構成

| サービス | 用途 | URL |
|---------|------|-----|
| Railway (web) | Next.js フロントエンド | code-worldweb-production.up.railway.app |
| Railway (api) | Hono APIサーバー | code-worldapi-production.up.railway.app |
| Railway (executor) | BullMQ Worker | (内部のみ) |
| Neon | PostgreSQL DB | ap-southeast-1 (Singapore) |
| Upstash | Redis | ap-northeast-1 (Tokyo) |

### 環境変数

```bash
# API + Executor共通
DATABASE_URL=postgresql://...
REDIS_URL=rediss://...
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=https://code-worldapi-production.up.railway.app
NODE_ENV=production
WEB_URL=https://code-worldweb-production.up.railway.app

# Web
NEXT_PUBLIC_API_URL=https://code-worldapi-production.up.railway.app
NODE_ENV=production
```

### ローカル開発環境

```bash
# 必要なもの
- Bun 1.3.14
- Docker Desktop
- Node.js 22+

# 起動手順
cp .env.example .env
docker compose up -d          # PostgreSQL (5434) + Redis (6379)
bun install
cd packages/db && DATABASE_URL=... bunx drizzle-kit push
DATABASE_URL=... bun src/seed.ts
bun run dev                   # web:3000 / api:3001 / executor
```

### CI/CD (GitHub Actions)

```yaml
# .github/workflows/ci.yml
on: push (main)
jobs:
  - bun install
  - bun run build (全app)
  - bun run lint
```

Railway は GitHub main ブランチへのpushで自動デプロイ。

---

## 12. セキュリティ設計

### コード実行の安全性

- Judge0 がDockerコンテナ内でコードを実行
- 各提出ごとに独立したPostgreSQLスキーマを使用（サンドボックス）
- CPU・メモリ・実行時間に制限
- 実行後はスキーマをDROP

### API セキュリティ

- Zod による全リクエストのバリデーション
- Better Auth のセッション管理
- CORS: 本番フロントURLのみ許可
- Better Auth: trustedOrigins 設定

### 今後強化すべき点（v2）

- gVisor (runsc) によるsyscallレベルの遮断
- レートリミット (Hono middleware)
- Cloudflare WAF導入

---

## 13. 学習コンテンツ設計

### 問題数・カテゴリ (本番DB)

| カテゴリ | 問題数 | 難易度 |
|---------|--------|--------|
| SQL | 25問 | Lv.0〜3 |
| Algorithm (Python) | 5問 | Lv.0〜2 |
| Algorithm (JavaScript) | 5問 | Lv.0〜2 |
| Algorithm (C#) | 5問 | Lv.0〜2 |
| Algorithm (SQL拡張) | 3問 | Lv.1〜2 |
| Design | 2問 | Lv.2〜3 |
| **合計** | **47問** | |

### 問題データ形式 (JSONB)

```typescript
interface ProblemBody {
  description: string      // 問題文 (Markdown)
  setup: string            // テーブル作成・データ挿入SQL
  expectedOutput: Array<Record<string, unknown>>[]  // テストケース
  hints: Array<{ level: number; text: string }>     // 段階的ヒント
  explanation?: string     // 解説
}
```

### 採点ロジック

```typescript
// 正解判定: 実行結果と期待出力の比較
function judgeResult(actual: Row[], expected: Row[]): boolean {
  if (actual.length !== expected.length) return false
  return actual.every((row, i) =>
    JSON.stringify(normalize(row)) === JSON.stringify(normalize(expected[i]))
  )
}
```

---

## 14. ゲームループ設計

### 基本ループ

```
1. ダンジョン選択
   └─ 言語 (SQL/Python/JS/C#) × 難易度 (Lv1/3/5) を選ぶ

2. 戦闘
   ├─ 雑魚 × 3 → ミニボス × 1 → ボス × 1
   ├─ 問題を解く = ボスにダメージ
   ├─ 15秒ごとにボスから5ダメージ
   └─ HP0で敗北 (XP -10%)

3. ダンジョンクリア
   └─ ブロック獲得 → インベントリに追加

4. ワールド建設
   ├─ 獲得ブロックをタイルに配置
   ├─ 他プレイヤーとリアルタイム共存
   └─ チャットで交流

5. ランキング・プロフィール
   └─ XP・レベル・実績を確認
```

### 報酬フロー

```
問題正解
  ↓
Executor が submissions テーブルに accepted を書き込み
  ↓
XP付与 (users.xp += 難易度×50)
  ↓
レベルチェック → レベルアップ判定
  ↓
ブロック付与 (inventory に upsert)
  ↓
実績チェック (first_ac / ten_solved / diamond_block / level_5)
  ↓
Socket.io でフロントに通知
  ↓
画面に結果表示
```

---

## 15. 開発の経緯・意思決定

### なぜ Hono を選んだか

`hono/client` によりフロントとバックエンドの型を完全共有できる。Expressと違ってAPIを変更するとフロントのコンパイルエラーとして即検出される。

### なぜ Drizzle ORM を選んだか

Prismaの抽象化が複雑なSQLを書くときに邪魔になる。Drizzleはに近い記法で型安全を保てる。特にダンジョンの採点ロジックで複雑なJOINを書く際に有効。

### なぜ Judge0 を使うか

自前でDockerサンドボックスを実装するより安全で速い。PostgreSQL・Python・JavaScript・C#など40言語に対応。セルフホストで月額コストをコントロール可能。

### なぜ Phaser 3 を選んだか

Next.js の `canvas` コンポーネントとして組み込める実績がある。TypeScript対応完備。2Dゲームに必要な機能（アイソメトリック・カメラ追従・パーティクル）が揃っている。

### マトリックスデザインの採用理由

サイバーパンク世界観とプログラミング学習の親和性が高い。「コードを書いてシステムを攻略する」というゲームコンセプトと視覚的に一致する。

### 1日で完成させた経緯

Claude Code (Sonnet 4.6) を使ってPhase 0〜7を1日で実装。プロンプト設計とデバッグの判断は人間が担当し、実装はエージェントに委譲する形で進めた。

---

## 付録: コマンドリファレンス

```bash
# 開発
bun run dev                    # 全app起動
bun run build                  # 全app本番ビルド

# DB
cd packages/db
DATABASE_URL=... bunx drizzle-kit push   # スキーマ反映
DATABASE_URL=... bun src/seed.ts         # 問題・ダンジョンseed
DATABASE_URL=... bun run db:seed:world   # ワールドブロックseed

# デプロイ
git push origin main           # Railway自動デプロイS

# ログ確認
railway logs --service api
railway logs --service web
```

---

*最終更新: 2026-05-17*  
*作成者: EGAMIJUN*  
*技術支援: Claude (Sonnet 4.6)*