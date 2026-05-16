# CLAUDE.md — CODE WORLD

## プロジェクト概要

**CODE WORLD** は Turborepo + Bun モノレポで構成された学習型オープンワールドSEゲーム。
SQLクエリ・システム設計・デバッグ・コードレビューの問題を解くことで「街のブロック」を獲得し、
3Dオープンワールドを自由に建設していくサンドボックス学習ゲーム。

## モノレポ構成

```
code-world/
├── apps/
│   ├── web/       Next.js 15 (App Router, Tailwind v4, shadcn/ui)  :3000
│   ├── api/       Hono + Better Auth + Zod                          :3001
│   └── executor/  BullMQ ワーカー (コード実行サンドボックス)
├── packages/
│   ├── types/     Zod スキーマ共有 (@code-world/types)
│   ├── db/        Drizzle ORM + PostgreSQL スキーマ
│   ├── config/    tsconfig・biome 共通設定
│   └── ui/        shadcn/ui コンポーネントライブラリ
├── docker-compose.yml   postgres:5432, redis:6379
└── biome.json           ルート Biome 設定
```

## アーキテクチャ

- **パッケージマネージャー**: Bun workspaces (`workspace:*` プロトコル)
- **ビルドキャッシュ**: Turborepo (`turbo.json` でタスクグラフ管理)
- **Lint/Format**: Biome (ESLint・Prettier の代替、設定は `biome.json`)
- **テスト**: Vitest
- **DB**: Drizzle ORM + PostgreSQL (接続: `postgres.js`)
- **キュー**: BullMQ + ioredis
- **認証**: Better Auth (GitHub OAuth 対応)

## 主要コマンド

```bash
# 初回セットアップ
cp .env.example .env
docker compose up -d          # postgres + redis 起動
bun install                   # 全ワークスペース依存インストール

# 開発
bun run dev                   # 全 app を並列起動 (turbo)
bun run dev --filter=web      # web のみ起動
bun run dev --filter=api      # api のみ起動

# DB
bun run db:generate           # Drizzle マイグレーションファイル生成
bun run db:push               # スキーマを直接 DB に push (開発時)
bun run db:migrate            # マイグレーション実行

# 品質
bun run lint                  # Biome lint (全パッケージ)
bun run format                # Biome format (全パッケージ)
bun run check                 # Biome lint + format 自動修正
bun run test                  # Vitest (全パッケージ)
bun run build                 # プロダクションビルド

# shadcn/ui コンポーネント追加
cd apps/web
bunx shadcn@latest add <component>
```

## DBスキーマ (packages/db)

| テーブル | 用途 |
|---|---|
| `users` | プレイヤー情報 (GitHub OAuth, レベル, XP) |
| `problems` | 問題 (SQL/debug/design/review、難易度 0〜3) |
| `submissions` | 提出履歴 (コード, 実行結果, スコア) |
| `worlds` | プレイヤーのワールド (人口, 税収) |
| `blocks` | ワールド内ブロック (XYZ座標, ユニーク制約) |
| `leaderboard` | ランキング (スコア, 解いた問題数, レビュー数) |

スキーマ変更: `packages/db/src/schema/` 配下のファイルを編集 → `bun run db:generate`

## 実装ルール

### 型安全
- `any` は禁止 (`noExplicitAny: warn`、実質エラーとして扱う)
- Zod スキーマは `packages/types` に定義し、api・web・executor で共有
- Drizzle の `$inferSelect` / `$inferInsert` を使い DB 型を手書きしない
- `as unknown as T` キャストは原則禁止。必要な場合はコメントで理由を書く

### テスト必須
- ビジネスロジック (`service/` 層) は Vitest でユニットテスト必須
- DB を伴うテストは実際の PostgreSQL に接続するインテグレーションテストで行う
  (モックでは検出できない型ずれ・マイグレーション問題を防ぐため)
- テストファイルは `*.test.ts` / `*.spec.ts` 命名

### コードスタイル (Biome 設定準拠)
- インデント: スペース 2
- 行幅: 100 文字
- クォート: ダブルクォート
- セミコロン: なし (`asNeeded`)
- トレイリングカンマ: あり (`all`)
- import 文は `verbatimModuleSyntax` 有効のため `import type` を使い分ける

### コンポーネント設計 (apps/web)
- Server Component をデフォルトとし、必要最小限の範囲のみ `'use client'` に
- shadcn/ui コンポーネントは `apps/web/src/components/ui/` に追加
- 共有コンポーネントは `packages/ui` に配置
- `@code-world/ui` は `transpilePackages` で Next.js がトランスパイルする

### API設計 (apps/api)
- Hono ルーターはリソース単位でファイル分割 (`routes/*.ts`)
- バリデーションは `@hono/zod-validator` を使い `@code-world/types` のスキーマを再利用
- エラーレスポンス: `{ error: string }` 形式に統一
- 認証が必要なルートは Better Auth のミドルウェアで保護

### キュー設計 (apps/executor)
- ジョブデータの型は `workers/*.ts` に `interface ***JobData` で定義
- 冪等性を保つ: 同じ submissionId で複数回実行されても結果が変わらないように
- タイムアウト: デフォルト 10 秒、上限 30 秒
- 失敗時: `attempts: 3` + 指数バックオフ

## 禁止事項

| 禁止 | 理由 |
|---|---|
| `any` 型の使用 | 型安全性が崩壊するため |
| DB モックによるテスト | 実際の DB と型ずれが生じるため |
| `--no-verify` での git commit | Biome チェックをスキップするため |
| `eval()` / `new Function()` | executor 以外でのコード実行はセキュリティリスク |
| `process.env.FOO` の直接アクセス (バリデーションなし) | 実行時エラーの原因になるため `process.env["FOO"] ?? default` 形式を使う |
| packages/db 以外での Drizzle クライアント作成 | 接続プールが分散するため |
| `console.log` のコミット (デバッグ用) | ロガーを使うか削除する |

## 環境変数

必須の環境変数は `.env.example` を参照。`.env` は git 管理しない。

```
DATABASE_URL          PostgreSQL 接続文字列
REDIS_URL             Redis 接続文字列
BETTER_AUTH_SECRET    認証シークレット (32文字以上のランダム文字列)
BETTER_AUTH_URL       API サーバーの URL
GITHUB_CLIENT_ID      GitHub OAuth App Client ID
GITHUB_CLIENT_SECRET  GitHub OAuth App Client Secret
```

## 新機能追加の流れ

1. `packages/types` に Zod スキーマを追加
2. `packages/db` にテーブルを追加 → `bun run db:generate`
3. `apps/api` にルートを追加 (Zod バリデーション付き)
4. `apps/web` にページ・コンポーネントを追加
5. テストを書く
6. `bun run check && bun run test` がパスすることを確認
