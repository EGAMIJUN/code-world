# 鉄火 TEKKA

> 純粋なオンライン FPS。 — BATTLE · RANK · SURVIVE

🌐 **本番URL**: https://code-worldweb-production.up.railway.app

---

## 🎮 ゲーム概要

ブラウザだけで動く Three.js 製のオープンワールド FPS。

- ヒューマノイド型エネミーを排除するシングルプレイ・ミッション 10 種
- 赤チーム vs 青チームの **Team Deathmatch** / 全員バトルロイヤルの **Free For All** / 押し寄せる敵を捌く **Wave Defense**
- 武器 3 種 (Pistol / Shotgun / Sniper) + 投擲グレネード
- WebSocket でリアルタイム同期 (位置・PvP ヒット・キルフィード・チームスコア)
- 6 言語対応 (JA / EN / ZH / KO / ES / FR), モバイル完全対応 (タッチジョイスティック + ボタン)
- COD 風演出: ヘッドショット 2倍ダメージ / Double / Triple Kill / Rampage / Unstoppable / Godlike キルストリーク / 試合終了時 MVP 表示 / 3秒スポーン無敵

---

## 🏗️ システムアーキテクチャ

```
apps/web      Next.js 15 + React 19 + Three.js (FPS フロントエンド)            :3000
apps/api      Hono on Bun + Drizzle + WebSocket (認証・ランキング・PvP同期)    :3001
apps/executor BullMQ ワーカー (Phase1 でスタブ化、現状未使用)                   :3002

packages/db    Drizzle ORM スキーマ (users / sessions / matches)
packages/types Zod スキーマ共有
packages/ui    shadcn 風 UI コンポーネント
packages/config 共通 tsconfig / biome 設定
```

---

## 🚀 開発セットアップ

```bash
# 環境変数
cp .env.example .env

# DB / Redis 起動 (Docker)
docker compose up -d postgres redis

# 依存インストール
bun install

# DB スキーマを反映
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/codeworld \
  bunx --cwd packages/db drizzle-kit push

# 全 app を並列起動
bun run dev
```

| URL | 内容 |
|---|---|
| http://localhost:3000 | Web (Next.js) |
| http://localhost:3001 | API (Hono + WebSocket) |
| http://localhost:3002 | Executor (BullMQ ワーカー、現状未使用) |

---

## 🕹️ 操作

### PC
| キー | 動作 |
|---|---|
| W A S D / ↑↓←→ | 移動 |
| Shift | ダッシュ |
| マウス | 視点回転 |
| 左クリック | 射撃 |
| 右クリック | ADS (覗き込み) |
| R | リロード |
| 1 / 2 / 3 | 武器スワップ (Pistol / Shotgun / Sniper) |
| G | グレネード (5秒クールダウン) |

### モバイル
- 左下: 移動ジョイスティック
- 右下: 視点ジョイスティック + 大きな射撃ボタン
- 右上: ADS / グレネード ボタン
- 上部: 武器スワップ [1] [2] [3] / TDM 時はチームスコア

---

## 🎯 ゲームモード

| モード | 内容 |
|---|---|
| **Wave Defense** | 10 種類のミッションから選択 (殲滅 / 防衛 / 狙撃 / 突破 / 救出 / 破壊 / 潜入 / 制圧 / ウェーブ防衛 / ボス) |
| **Free For All** | 同じルームにいる全員が敵。最後まで生き残れ |
| **Team Deathmatch** | 赤チーム vs 青チーム。サーバーが自動でチーム振り分け |

マップは 3 種類: **URBAN** (市街地・青空) / **DESERT** (砂漠・砂色) / **SNOW** (雪山・白い空)

---

## 📡 主要 API

| ルート | メソッド | 認証 | 用途 |
|---|---|---|---|
| `/api/auth/signup` | POST | × | 新規登録 |
| `/api/auth/login` | POST | × | ログイン |
| `/api/auth/me` | GET | ○ | 現在のユーザー取得 |
| `/api/profile/me` | GET | ○ | 自分のプロフィール (武器別キル・最高ストリーク・国コード含む) |
| `/api/profile/me/matches` | GET | ○ | 直近 10 試合 |
| `/api/profile/stats` | POST | ○ | 試合終了時に通算 + matches テーブルへ追記 |
| `/api/leaderboard` | GET | × | `window=all/week/month`, `sort=score/kills/kd` |
| `/api/leaderboard/me-rank` | GET | × | userId クエリで自分の順位を取得 |
| `/ws` | WebSocket | × | PvP ルーム同期 (join/move/chat/pvp_hit/vote_map) |

---

## 🛠️ 品質コマンド

```bash
bun run check   # biome lint + format 自動修正
bun run build   # プロダクションビルド (全 app)
bun run test    # Vitest (全パッケージ)
```

---

## 📜 ライセンス

private (内部開発)
