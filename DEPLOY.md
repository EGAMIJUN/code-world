# 鉄火 TEKKA — デプロイ手順

友達に使ってもらうための本番デプロイ手順です。
すべて無料枠で動きます。

## 構成

| 役割 | サービス | 料金 |
|------|----------|------|
| Web (Next.js) | Vercel | 無料 |
| API (Hono) | Railway | 無料枠 ($5/月クレジット) |
| Executor (BullMQ) | Railway | 無料枠 |
| PostgreSQL | Neon | 無料 (0.5GB) |
| Redis | Upstash | 無料 (10,000 req/日) |
| Judge0 (コード実行) | VPS or RapidAPI | VPS: ~$5/月 |

---

## 事前準備

### GitHub OAuth App を本番用に作成

1. https://github.com/settings/developers → "New OAuth App"
2. **Application name**: 鉄火 TEKKA
3. **Homepage URL**: `https://あなたのvercelドメイン.vercel.app`
4. **Authorization callback URL**: `https://あなたのrailwayドメイン.up.railway.app/api/auth/callback/github`
5. Client ID と Client Secret をメモ

---

## Step 1: GitHubにプッシュ

```bash
git add .
git commit -m "feat: add production deploy config"
git push origin main
```

---

## Step 2: Neon PostgreSQL を作成

1. https://neon.tech にサインアップ
2. "New Project" → プロジェクト名: `code-world` → リージョン: `AWS / ap-northeast-1` (東京)
3. 作成後、**Connection string** をコピー
   - 形式: `postgresql://user:password@ep-xxx.ap-northeast-1.aws.neon.tech/neondb?sslmode=require`
4. これが `DATABASE_URL` になる

### マイグレーション実行

```bash
# ローカルから本番DBにスキーマを適用
DATABASE_URL="postgresql://..." bun run db:push
```

---

## Step 3: Upstash Redis を作成

1. https://upstash.com にサインアップ
2. "Create Database" → 名前: `code-world` → リージョン: `ap-northeast-1` (東京) → TLS: ON
3. 作成後、**Redis URL** (TLS付き) をコピー
   - 形式: `rediss://default:password@xxx.upstash.io:6380`
4. これが `REDIS_URL` になる

---

## Step 4: Railway に API + Executor をデプロイ

### Railway プロジェクト作成

1. https://railway.app にサインアップ (GitHub連携)
2. "New Project" → "Deploy from GitHub repo" → `code-world` を選択

### API サービスを設定

1. "Add Service" → "GitHub Repo" → `code-world`
2. サービス名を `api` に変更
3. Settings → Build:
   - **Build Command**: (空白のまま)
   - **Dockerfile Path**: `apps/api/Dockerfile`
   - **Watch Paths**: `apps/api/**`, `packages/**`
4. Settings → Deploy:
   - **Start Command**: `bun dist/index.js`
5. Variables タブで環境変数を設定 (後述)
6. Settings → Networking → "Generate Domain" でドメインを取得

### Executor サービスを設定

1. "Add Service" → "GitHub Repo" → `code-world` (同じリポジトリ)
2. サービス名を `executor` に変更
3. Settings → Build:
   - **Dockerfile Path**: `apps/executor/Dockerfile`
   - **Watch Paths**: `apps/executor/**`, `packages/**`
4. Variables タブで環境変数を設定 (後述)

### Railway 環境変数設定

**API サービス** の Variables に以下を設定:

```
DATABASE_URL=postgresql://... (Neonのコネクション文字列)
REDIS_URL=rediss://... (UpstashのRedis URL)
BETTER_AUTH_SECRET=... (下記コマンドで生成)
BETTER_AUTH_URL=https://あなたのapi.up.railway.app
GITHUB_CLIENT_ID=... (GitHub OAuth AppのClient ID)
GITHUB_CLIENT_SECRET=... (GitHub OAuth AppのClient Secret)
WEB_URL=https://あなたのvercel.app
NEXT_PUBLIC_WEB_URL=https://あなたのvercel.app
API_PORT=3001
NODE_ENV=production
```

**Executor サービス** の Variables に以下を設定:

```
DATABASE_URL=postgresql://... (Neonと同じ)
REDIS_URL=rediss://... (Upstashと同じ)
NODE_ENV=production
```

#### BETTER_AUTH_SECRET の生成方法

```bash
openssl rand -base64 32
```

出力された文字列 (例: `abc123...==`) をそのまま `BETTER_AUTH_SECRET` に設定する。

---

## Step 5: Vercel に Web をデプロイ

1. https://vercel.com にサインアップ (GitHub連携)
2. "Add New Project" → `code-world` を選択
3. **Root Directory**: `apps/web` に変更
4. **Framework Preset**: Next.js (自動検出)
5. **Build Command**: `cd ../.. && bun run build --filter=@code-world/web`
6. **Install Command**: `cd ../.. && bun install`
7. **Output Directory**: `.next`

### Vercel 環境変数設定

"Environment Variables" セクションに追加:

```
NEXT_PUBLIC_API_URL=https://あなたのapi.up.railway.app
NEXT_PUBLIC_WEB_URL=https://あなたのvercel.app
BETTER_AUTH_URL=https://あなたのapi.up.railway.app
```

8. "Deploy" をクリック
9. デプロイ完了後のドメインをメモ

---

## Step 6: Judge0 のセットアップ (コード実行サンドボックス)

Judge0 は privileged コンテナが必要なため、Railway では動かない。
以下の2択から選ぶ。

### Option A: RapidAPI の Judge0 を使う (推奨・簡単)

1. https://rapidapi.com/judge0-official/api/judge0-ce にサインアップ
2. APIキーを取得
3. Executor の環境変数に追加:
   ```
   JUDGE0_API_URL=https://judge0-ce.p.rapidapi.com
   JUDGE0_API_KEY=あなたのRapidAPIキー
   ```

### Option B: VPS でセルフホスト

```bash
# VPS (Ubuntu 22.04+) で実行
git clone https://github.com/your-org/code-world.git
cd code-world

# Judge0 設定ファイルを作成
cp judge0.conf.example judge0.conf
# judge0.conf を編集してDB/Redisパスワードを設定

# 起動
docker compose -f docker-compose.production.yml up -d
```

VPS の Judge0 URL を Executor の `JUDGE0_API_URL` に設定する。

---

## Step 7: GitHub OAuth App のコールバックURL更新

GitHub OAuth App の設定に戻り:
- **Homepage URL**: Vercel のデプロイURL (e.g. `https://code-world-xxx.vercel.app`)
- **Authorization callback URL**: Railway API の URL + `/api/auth/callback/github`

---

## Step 8: 動作確認

### ヘルスチェック

```bash
# API が起動しているか確認
curl https://あなたのapi.up.railway.app/api/health

# 期待するレスポンス
# {"status":"ok","timestamp":"..."}
```

### 認証フロー確認

1. `https://あなたのvercel.app` を開く
2. "GitHubでログイン" をクリック
3. GitHub認証後、ダッシュボードに戻ることを確認

### 問題一覧確認

1. ログイン後、問題一覧ページを開く
2. 問題が表示されていることを確認 (初期データが入っているか `bun run db:seed` を実行)

```bash
# シードデータ投入 (初回のみ)
DATABASE_URL="postgresql://..." bun run db:seed
```

### コード提出確認

1. 問題を1つ開く
2. SQLを入力して提出
3. 結果が返ってくることを確認

---

## トラブルシューティング

### Railway のビルドが失敗する

- Railway の Logs タブでエラーを確認
- `bun.lock` がコミットされているか確認: `git ls-files bun.lock`
- Dockerfile のパスが正しいか設定を再確認

### Better Auth のリダイレクトが失敗する

- `BETTER_AUTH_URL` が Railway の API URL と完全一致しているか確認
- GitHub OAuth App のコールバック URL が `/api/auth/callback/github` で終わっているか確認
- `BETTER_AUTH_SECRET` が両サービス (API) で同じ値か確認

### DB接続エラー

- Neon の Connection string に `?sslmode=require` が含まれているか確認
- Railway の環境変数が正しく設定されているか確認 (スペースなし)

### CORS エラー

- API の `WEB_URL` / `NEXT_PUBLIC_WEB_URL` が Vercel のデプロイURLと一致しているか確認
- `https://` プレフィックスが含まれているか確認

---

## 環境変数まとめ

### apps/api (Railway)

| 変数名 | 説明 | 例 |
|--------|------|-----|
| `DATABASE_URL` | Neon PostgreSQL URL | `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require` |
| `REDIS_URL` | Upstash Redis URL | `rediss://default:pass@xxx.upstash.io:6380` |
| `BETTER_AUTH_SECRET` | 認証シークレット (32文字以上) | `openssl rand -base64 32` で生成 |
| `BETTER_AUTH_URL` | API の公開URL | `https://api-xxx.up.railway.app` |
| `GITHUB_CLIENT_ID` | GitHub OAuth Client ID | `Ov23li...` |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth Client Secret | `xxx...` |
| `WEB_URL` | Web の公開URL | `https://code-world-xxx.vercel.app` |
| `NODE_ENV` | 環境 | `production` |

### apps/executor (Railway)

| 変数名 | 説明 |
|--------|------|
| `DATABASE_URL` | Neon PostgreSQL URL (APIと同じ) |
| `REDIS_URL` | Upstash Redis URL (APIと同じ) |
| `NODE_ENV` | `production` |

### apps/web (Vercel)

| 変数名 | 説明 |
|--------|------|
| `NEXT_PUBLIC_API_URL` | Railway API の公開URL |
| `NEXT_PUBLIC_WEB_URL` | Vercel の公開URL |
| `BETTER_AUTH_URL` | Railway API の公開URL (APIと同じ) |
