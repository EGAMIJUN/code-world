# BANG BANG

> 純粋なオンライン FPS。 — BATTLE · RANK · SURVIVE

🌐 **本番URL**: https://code-worldweb-production.up.railway.app

---

## 🎮 ゲーム概要

ブラウザだけで動く Three.js 製のオープンワールド FPS。歩兵戦から戦車・戦闘機・対空砲を使った
ビークルコンバット、ゾンビ／テラフォーマー侵攻、空域専用マップ、GANTZ 風の転送ミッションまで
1 つのワールドに詰め込んでいる。

- 7 種のゲームモード（FFA / TDM / Wave Defense / Zombie / Terraformer Invasion / SKY / HUNT）
- 5 種のビークル（車・戦車・戦闘機・バイク・対空砲）と 5 種＋専用武器
- WebSocket でリアルタイム同期（位置・PvP ヒット・キルフィード・チームスコア）
- 6 言語対応（JA / EN / ZH / KO / ES / FR）
- **モバイル完全対応**: タッチ操作・バーチャルパッド・乗り物含む全機能を指だけで操作可能
- COD 風演出: ヘッドショット 2倍ダメージ / Double / Triple Kill / Rampage / Unstoppable / Godlike キルストリーク / MVP 表示 / 3秒スポーン無敵

---

## 🕹️ ゲームモード（7 種）

| モード | 内容 |
|---|---|
| **FFA** (Free For All) | 同じルームの全員が敵の全員乱戦。最後まで生き残れ |
| **TDM** (Team Deathmatch) | 赤チーム vs 青チーム。サーバーが自動でチーム振り分け |
| **Wave Defense** | 押し寄せる敵を捌くウェーブ防衛。ミッション選択あり |
| **Zombie** | ウェーブごとに増えるゾンビの群れを生き延びる |
| **Terraformer Invasion** | テラフォーマーがバイクに乗って集団突撃してくる侵攻モード |
| **SKY** | 空域マップ・ジェット専用戦場。航空戦に特化 |
| **HUNT** | 転送ミッションモード（GANTZ 風）。部屋 → 転送 → 討伐 → 帰還のループ |

---

## 🗺️ マップ

| マップ | 内容 |
|---|---|
| **HARBOR** | 港・飛行場・対空砲・倉庫・コンテナヤード。ビークルコンバットの主戦場 |
| **URBAN** | 市街地・ビル・屋上。垂直方向の戦闘 |
| **DESERT** | 砂漠（砂色テーマ） |
| **SNOW** | 雪山（白い空テーマ） |
| **SKY** | 空域・エアベース。SKY モード専用 |

---

## 🚗 ビークル（5 種）

| ビークル | 特徴 |
|---|---|
| **車** | 基本の乗り物。機動力重視 |
| **戦車** | 砲撃（AOE キャノン）・重装甲。鈍重だが強力 |
| **戦闘機** | HARBOR 飛行場から離陸／失速／着陸。マシンガン + ミサイル、被撃墜時はパラシュート脱出 |
| **バイク** | 高機動・小型。テラフォーマーが乗って集団突撃してくる |
| **対空砲** | 固定砲台。プレイヤー搭乗可・自動追尾 + 手動微調整で対空射撃 |

---

## 🔫 武器（5 種 ＋ HUNT 専用）

**通常武器**
- ピストル / ショットガン / スナイパー / マシンガン
- **RPG ロケットランチャー**: ホーミング・AOE 爆発。マップ上にピックアップとして配置

**HUNT 専用武器**
- パルスガン（遅延爆発・マルチロックオン）
- パルスショットガン
- キャプチャーガン（捕獲して転送）
- ブレード（近接）

---

## 🤖 敵 AI

| 敵 | 挙動 |
|---|---|
| **歩兵ボット** | 難易度 3 段階（easy / normal / hard）。フランキング・ダッシュ・グレネード |
| **テラフォーマー** | 侵攻・バイク搭乗・集団突撃 |
| **敵戦闘機** | PATROL / CHASE / ATTACK / EVADE の状態機械で空中戦 |
| **バイクライダー** | テラフォーマーが乗車。撃墜すると落車する |
| **HUNT 敵** | テーマ別 3 種・3 段階ボス |

---

## ⚙️ 主要システム

- **パラシュート脱出**: `[Alt]` で手動 / HP0 で自動。ゆっくり降下し、降下中も銃を使用可能
- **対空砲システム**: 自動追尾 + プレイヤー搭乗・対空弾による迎撃
- **武器ヒット統一**: 全武器 × 全敵タイプに対応。`shotConsumed` で 1 発の多重ヒット（貫通）を防止
- **エイムアシスト**: ray-vs-sphere 判定。地上から空中目標を狙いやすくする
- **スーツシステム** (HUNT): 耐久制・ダメージカット・強化
- **100 点メニュー** (HUNT): 解放 / 強武器 / 復活チケットを獲得スコアで交換

---

## 🏗️ 技術スタック

| レイヤー | 採用技術 |
|---|---|
| **Frontend** | Next.js 15 + React 19 + Three.js（WebGL） |
| **Backend** | Hono + Bun |
| **DB** | PostgreSQL（Neon, Singapore） |
| **Cache** | Redis（Upstash, Tokyo） |
| **Deploy** | Railway（〜$5/month） |
| **Monorepo** | Turborepo |
| **CI/CD** | GitHub Actions, CodeQL, CodeRabbit, Dependabot |
| **Lint/Format** | Biome |

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
  bunx --filter @code-world/db drizzle-kit push

# 全 app を並列起動
bun run dev
```

| URL | 内容 |
|---|---|
| http://localhost:3000 | Web (Next.js) |
| http://localhost:3001 | API (Hono + WebSocket) |
| http://localhost:3002 | Executor (BullMQ ワーカー、現状未使用) |

---

## 🎮 操作

### PC
| キー | 動作 |
|---|---|
| W A S D / ↑↓←→ | 移動 |
| Shift | ダッシュ |
| マウス | 視点回転 |
| 左クリック | 射撃 |
| 右クリック | ADS (覗き込み) |
| R | リロード |
| 1 / 2 / 3 / 4 | 武器スワップ |
| G | グレネード |
| Alt | パラシュート手動展開（落下／脱出時） |
| E | 乗り物・対空砲の乗降 |

### モバイル
- 左下: 移動ジョイスティック
- 右下: 視点ジョイスティック + 大きな射撃ボタン
- 右上: ADS / グレネード ボタン
- 上部: 武器スワップ / TDM 時はチームスコア
- 乗り物・対空砲・ジェット操縦・パラシュートまで含め、**全機能をタッチで操作可能**

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

> レート制限: 全 `/api/*` に IP ベースで 60 秒 200 回（ヘルスチェックと `/ws` を除く）。

---

## 🛠️ 品質コマンド

```bash
bun run check   # biome lint + format 自動修正
bun run build   # プロダクションビルド (全 app)
bun run test    # Vitest (全パッケージ)
```

---

## 🔔 Discord 通知（CI/CD）

開発・運用イベントを Discord に通知する。GitHub Actions 側は以下のイベントで Discord embed を送る:

| ワークフロー | イベント | 通知 |
|---|---|---|
| `ci.yml` | CI 成功 / 失敗 | ✅ CI パス / ❌ CI 失敗（ブランチ + コミットメッセージ） |
| `codeql.yml` | セキュリティスキャン完了 | 🔒 スキャン完了（成功 / 失敗） |
| `notify.yml` | PR 作成 / マージ / main への push | 📝 新しいPR / 🔀 マージ完了 / 🚀 本番デプロイ開始 |

### セットアップ: `DISCORD_WEBHOOK` を GitHub Secrets に登録

Webhook URL は**コードに直接書かず必ず Secrets 経由**で参照する（`${{ secrets.DISCORD_WEBHOOK }}`）。

1. **Discord 側**: 通知したいチャンネル → 「連携サービス」→「ウェブフックを作成」→ URL をコピー。
2. **GitHub 側**: リポジトリ → **Settings → Secrets and variables → Actions → New repository secret**
   - **Name**: `DISCORD_WEBHOOK`
   - **Secret**: コピーした Webhook URL
   - 「Add secret」で保存。
3. 以降、`main` への push / PR / CI / CodeQL で自動通知される。

> Secret が未設定の場合（フォーク PR では GitHub が secret を渡さない等）、通知スクリプト
> [`.github/scripts/notify-discord.sh`](.github/scripts/notify-discord.sh) は**静かにスキップ**し CI は失敗しない。
> コミットメッセージや PR タイトル等の動的値はすべて `env:` 経由でスクリプトに渡し、`run:` への
> インライン展開を避けている（シェルインジェクション対策）。

### （任意）ローカル Claude Code の通知

ローカルの作業完了 / ツールエラーも Discord に流す場合は、`~/.claude/settings.json` の `hooks`
（`Stop` / `PostToolUse`）から通知スクリプトを呼ぶ。**Webhook URL は `~/.claude/.discord-webhook`
（パーミッション 600・リポジトリ外）に置き**、スクリプト・設定ファイルには URL を書かない。

---

## 📜 ライセンス

private (内部開発)
