# CLAUDE.md — BANG BANG

## プロジェクト概要

**BANG BANG** は Turborepo + Bun モノレポで構成された純粋な FPS ゲーム。
オープンワールドの戦場マップで人型兵士エネミーを排除するミッション型 FPS + マルチプレイヤー PvP。
（初期構想の「SQL・コード問題を解くサンドボックス学習ゲーム」は Phase 1 でコード要素を撤去し、現在は純 FPS に振り切っている。executor のジョブ実行はスタブ状態。）

Phase 3 で追加:
- 6 言語対応 (i18n: 日本語/英語/中国語/韓国語/スペイン語/フランス語)
- ゲームモード選択: Wave Defense / Free For All / Team Deathmatch
- マップ選択: 都市 / 砂漠 / 雪山
- PvP マルチプレイヤー (チーム自動振り分け、ヒット同期、リスポーン)
- 武器強化: 右クリック ADS / 反動パターン / グレネード (Gキー, 5秒CD)
- モバイル対応: タッチジョイスティック + 射撃/リロード/武器/ADS/グレネードボタン
- COD 風演出: ヘッドショット 2倍ダメージ、Double/Triple/Rampage/Unstoppable/Godlike キルストリーク、MVP リザルト、3秒スポーン無敵
- 戦績強化: 試合履歴(直近10)、武器別キル数、最高キルストリーク、国旗
- ランキング強化: 全期間/週間/月間タブ、スコア/キル/K/D ソート、30秒自動更新、自分の順位を下部固定

## モノレポ構成

```
code-world/
├── apps/
│   ├── web/       Next.js 15 + React 19 + Tailwind v4 + Three.js (FPSゲーム)         :3000
│   ├── api/       Hono on Bun + 自前セッション認証 + WebSocket (room sync)            :3001
│   └── executor/  BullMQ ワーカー（コード実行はPhase1で無効化、スタブで返す）           :3002
├── packages/
│   ├── types/     Zod スキーマ共有 (@code-world/types) — User/Signup/Login のみ
│   ├── db/        Drizzle ORM + PostgreSQL (@code-world/db) — users + sessions
│   ├── config/    tsconfig・biome 共通設定 (@code-world/config)
│   └── ui/        shadcn 風 UI コンポーネント (@code-world/ui) — Button, cn ユーティリティ
├── docker-compose.yml   postgres:5434 (host) / redis:6379 / judge0(任意, 未使用)
└── biome.json           ルート Biome 設定
```

## アーキテクチャ

- **パッケージマネージャー**: Bun workspaces (`workspace:*` プロトコル)
- **ビルドキャッシュ**: Turborepo (`turbo.json` でタスクグラフ管理)
- **Lint/Format**: Biome (ESLint・Prettier の代替)
- **テスト**: Vitest
- **DB**: Drizzle ORM + PostgreSQL (`drizzle-orm/pg-core`, `postgres.js` ドライバ)
- **キュー**: BullMQ + ioredis（現状はスタブのみ稼働）
- **認証**: 自前実装のセッション認証（`Bun.password` bcrypt + HttpOnly Cookie）
- **エラー監視**: Sentry (`@sentry/nextjs` for web, `@sentry/node` for api)

## 主要コマンド

```bash
# 初回セットアップ
cp .env.example .env
docker compose up -d postgres redis  # 5434/6379 を立てる
bun install                          # 全ワークスペース依存インストール
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/codeworld \
  bunx --filter @code-world/db drizzle-kit push   # 初期スキーマ反映

# 開発
bun run dev                          # 全 app を並列起動 (turbo)
bun run dev --filter=@code-world/web # web のみ起動
bun run dev --filter=@code-world/api # api のみ起動

# DB
bun run db:generate                  # マイグレーションファイル生成
bun run db:push                      # スキーマを直接 DB に push (開発時)
bun run db:migrate                   # マイグレーション実行
bun run db:seed                      # シードデータ投入 (packages/db/src/seed.ts)

# 品質
bun run lint                         # Biome lint (全パッケージ)
bun run format                       # Biome format (全パッケージ)
bun run check                        # Biome lint + format 自動修正
bun run test                         # Vitest (全パッケージ)
bun run build                        # プロダクションビルド

# shadcn/ui コンポーネント追加
cd apps/web
bunx shadcn@latest add <component>
```

## DB スキーマ (packages/db)

| テーブル | 主なカラム | 用途 |
|---|---|---|
| `users` | id (uuid pk), username (unique), passwordHash, totalKills, totalDeaths, totalScore, maxKillstreak, weaponKills (jsonb), countryCode (varchar 2), createdAt | プレイヤー情報・通算戦績 |
| `sessions` | token (pk), userId (fk→users, cascade), expiresAt, createdAt | ログインセッション（30日有効） |
| `matches` | id (uuid pk), userId (fk→users), mode, mapId, kills, deaths, score, killstreak, headshots, durationSec, result, createdAt | 試合履歴 (試合終了時に1行ずつ追加) |

スキーマ変更: `packages/db/src/schema/` 配下のファイルを編集 → `bun run db:push` で実DBに反映 (差分検出)

## API ルート (apps/api)

Hono ルーターで `/api/*` 配下にマウント。すべて JSON、共通エラー形式 `{ error: string }`。

| ルート | メソッド | 認証 | 用途 |
|---|---|---|---|
| `/api/auth/signup` | POST | × | 新規登録（ユーザーID 英数字4〜16文字, パスワード 8文字以上） |
| `/api/auth/login`  | POST | × | ログイン |
| `/api/auth/logout` | POST | △ | セッション破棄 |
| `/api/auth/me`     | GET  | ○ | 現在のユーザー取得 |
| `/api/profile/me`  | GET  | ○ | 自分のプロフィール（K/D・武器別キル・最高キルストリーク・国コード含む） |
| `/api/profile/me/matches` | GET | ○ | 自分の直近10試合 |
| `/api/profile/:id` | GET  | × | 他プレイヤーのプロフィール |
| `/api/profile/:id/matches` | GET | × | 他プレイヤーの直近10試合 |
| `/api/profile/stats` | POST | ○ | 試合終了時に通算 + match行を追加。bodyに mode/mapId/killstreak/headshots/weaponKills/durationSec/result も受け取り |
| `/api/leaderboard` | GET  | × | window=all/week/month, sort=score/kills/kd, limit ≤100。週間/月間は matches を集計 |
| `/api/leaderboard/me-rank` | GET | × | userId クエリで自分の順位を返す（フッターの sticky 表示用） |
| `/api/health`      | GET  | × | ヘルスチェック |
| `/ws`              | WS   | × | PvP対応のルーム同期。 join({roomId, mode, mapId, username}) → joined(team) を返す。move/chat/pvp_hit/vote_map を受信、sync/pvp_damage/pvp_kill/pvp_respawn/vote_tally をブロードキャスト。TDM 時は両チームの kill score を保持 |

加えて、レート制限が全 `/api/*` に対して IP ベースで 60秒200回適用される（ヘルスチェックと `/ws` を除く）。

## Web ページ (apps/web)

| パス | 概要 |
|---|---|
| `/` | ランディングページ |
| `/login` / `/signup` | フォーム認証 UI |
| `/world` | メインの FPS ゲーム。`WorldClient` がモード/マップ選択画面 → `ThreeWorld.tsx` (約29,400行・継続増加中) |
| `/leaderboard` | totalScore ランキング |
| `/profile` / `/profile/[id]` | プロフィール表示 |

`ThreeWorld.tsx` は単一巨大コンポーネント。主要要素:
- 100×100 ユニットの戦場マップ（市街地 / 工業 / 屋外の3ゾーン）
- マップテーマ: urban (青空) / desert (砂色) / snow (白い空)
- プレイヤースポーン: `focalPoint = (2, 0, 48)` (西端で東向き)。`(8, 48)` は建物 `[3,45,6,7]` の内側にあって動けなくなる罠だったので避けてある
- ヒューマノイド型エネミー（grunt / sniper / heavy）。`root.rotation.order = "YXZ"` で死亡チルトが体の左右軸基準
- 10種類のミッション (Wave Defense モード時のみ表示)
- 武器3種（pistol 無限弾, shotgun 8発, sniper 5発）+ グレネード（Gキー, AOE, 5秒CD）
- 右クリック (またはモバイル ADS ボタン) で ADS — Sniper は FOV 28、その他は 50 にズーム
- WebAudio API で生成する効果音
- WebSocket でルーム内位置同期 + PvP ヒット同期
- モバイル: 左ジョイスティック (移動) + 右ジョイスティック (視点) + FIRE/RELOAD/ADS/GRENADE/武器スワップ ボタン
- COD 風演出: ヘッドショット (2倍ダメージ + 表示) / Double/Triple Kill / Rampage / Unstoppable / Godlike キルストリーク / MVP リザルト / 3秒スポーン無敵
- 入力スムージング: `playerVelRef` で WASD/ジョイスティックの希望速度に指数補間、`joySmoothRef`/`lookSmoothRef` で指のジッタを低域フィルタ、ウォークボブ
- 壁衝突: `WALL_AABBS` にタイプ別高さ `h` を持たせ、`pointInsideWall(x,y,z)` で弾の壁着弾、`fire()` の raycast は `wallMeshes` も対象にしてカバー越し射撃を遮断 (PvP も同様)
- 安全スポーン: `findSafeSpawnNear(x, z, radius)` (同心円スパイラル探索) を `spawnEnemiesFromDef` / `spawnBots` / bot respawn 全てに通して建物内スポーンを回避
- 死亡アニメ: `DEATH_ANIM_TOTAL = 4.0s` (`FALL 1.2s` で 0→π/2 を ease-out でプローン化 + 膝崩れ → `LIE 1.8s` 地面接地 → `FADE 1.0s` 不透明度フェード)。`deathFallDir` をキル時に shooter とのドット積で決定し、撃たれた方向へ倒れる。`mesh.position.y = sin(tilt) * 0.18` で胴体が地面に乗る

### 大阪編 (OSAKA / HUNT ステージ) の現状

`/world` の HUNT モードに大阪ステージ群があり、以下が実装済み:
- エリア進行: 道頓堀 → 通天閣 → 大阪城。各エリアに雑魚 (`yokai_lite` 妖怪) + 中ボス (天狗 / 山谷)、最終エリアで **五変化ボス** (`spawnOsakaBoss`、6形態)。
- 難易度: 通常 / **鬼モード** (`osaka_oni`) / **終焉モード** (`osaka_cataclysm`、鬼クリアで解放)。
- **終焉モード**: 赤黒い災厄ライティング + 黒い雨 + 落雷。真・五変化撃破後に **大魔 (Daima)** が降臨 (`spawnDaima` → 地中からせり上がる演出) — 7コア破壊式の最終ボス。
- **恐怖演出**: 暗転 / 顕現フラッシュ / 大魔コア接近で赤ビネット脈動 / 不定期の遠い唸り (全て CSS オーバーレイ + 既存 SOUNDS、`updateDaima` + 都市崩壊シーケンサ駆動)。
- **鉄輪 (Tetsurin)**: 大阪専用モノホイール戦闘バイク (`makeTetsurin`)。ガトリング `fireTetsurinGatling`、敵鉄輪兵部隊 `spawnOsakaBikeSquad`。
- **破魔砲 (hamahō)**: チャージ式の極太貫通ビーム武器 (`fireHamaho`、`WEAPONS[5]`、ピックアップで解放、`h` キー、4発)。
- **実績/称号**: localStorage フラグ (`osaka_oni_clear` / `osaka_cataclysm_clear` / `osaka_tetsurin_champion` / `osaka_shuen_suit` 等) → プロフィール画面に i18n 表示。
- 雑魚の最大同時数: `OSAKA_ENEMY_CAP` = 20 (PC) / 15 (モバイル)。
- **perf 最適化**: 大阪雑魚は creature 差し替え時にヒューマノイドリグを省略 (`makeEnemy` の `slim` 引数 → 不可視ヒットボックス1個。当たり判定/死亡/AI は全て null ガード済みで維持) + `yokai_lite` を頂点カラーで 2 メッシュに統合。鉄輪ガトリングはトレーサー/スパークをプール化。影は 512² マップ + プレイヤー追従の ±40 frustum。

### ⚠️ ThreeWorld.tsx 編集時の必読ルール（トークン上限）

> **ThreeWorld.tsx は 29,000 行超。** 大型機能は必ず段階的に実装し、1回のコミットで追加・変更するのは
> **最大 1,500 行程度**に抑えること。出力トークン上限（約 32k）に対してファイルが巨大なため、
> 実装は**複数フェーズに分割してコミット**すること。1フェーズ＝1責務（例: データ定義 → 生成関数 →
> 更新ループ統合 → HUD）を目安にする。ファイル全体の書き直し・大規模な行移動は禁止（差分が肥大化し
> レビュー・レート制限・コンフリクトのすべてを悪化させる）。

### ThreeWorld.tsx モジュール構造サマリー（実測値）

| 行範囲 | 内容 |
|---|---|
| `1〜2,379` | 定数・型・純粋ヘルパー関数（モジュールスコープ。`WEAPONS` / `ENEMY_CONFIGS` / `WALL_AABBS` / `DAIMA_*` / `OSAKA_*` 定数 / `collidesWithWall` など） |
| `2,380〜` | `export default function ThreeWorld` コンポーネント本体開始 |
| `2,380〜3,050` | `useRef` / `useState` の宣言密集帯（useRef + useState 計 ~299 箇所。ゲーム状態はほぼ ref 経由の暗黙グローバル） |
| `3,093〜24,867` | **巨大 useEffect**: Three.js シーン構築 (`scene` 3177 / `renderer` 3332) + 全ゲームロジック + `animate()` ループ (21,725) を内包 |
| `24,888〜29,359` | JSX return（HUD/UI 全体。60+ の条件付きオーバーレイ） |

### ThreeWorld.tsx 主要システム関数マップ（巨大 useEffect 内・実測行番号）

新機能やバグ修正の際は、まず該当システムの関数へ直行すること。

**マップ/ジオメトリ生成**
`makeNoiseTexture`(3492), `makeHollowBuilding`(4189), `addBuildingWindows`(4387), `makeRoofTower`(4631), `makeMansion`(4855), `makeLandmarkTower`(5149)

**プレイヤー/カメラ**
`updateCamera`(6295), `buildPlayerAvatar`(6453), `showPlayerAvatar`(6566), `applyPlayerDamage`(7615)

**車両（共通）**
`makeVehicle`(6595), `spawnVehicle`(7123), `enterVehicle`(7407), `exitVehicle`(7482), `updateVehicle`(9193), `destroyActiveVehicle`(7561)

**バイク / 鉄輪**
`makeBike`(6678), `makeTetsurin`(6753), `addBikeSlot`(7189), `updateBikeRiders`(7283), `tryTerraformerSeekBike`(7237), `fireTetsurinGatling`(8820)

**戦車**
`makeTank`(6942), `fireCannon`(21202)

**ジェット/航空戦**
`makeJet`(7048), `spawnEnemyJet`(8246), `updateEnemyJets`(8284), `updateCrashJets`(8454), `ejectFromJet`(8534), `skySpawnSquadron`(8601), `updateSkyArena`(8617), `fireJetGun`(8705), `fireJetMissile`(8995), `updateJet`(9045)

**対空砲(AA)**
`makeAAGun`(7926), `fireAAShell`(7973), `updateAAGuns`(7985), `updateAAShells`(8008), `updateMountedAA`(8178)

**敵生成/AI**
`makeEnemy`(9473、`slim` 引数で creature 敵はリグ省略), `spawnEnemiesFromDef`(10417), `spawnBots`(10546), `updateEnemyClimb`(21642)

**ミッション/ウェーブ**
`spawnMission`(10671), `spawnWave`(10736), `spawnZombieWave`(10749), `spawnTerraformerWave`(10881), `updateRocketStrikes`(10929)

**HUNT モード**
`huntMakeEnemy`(12063), `makeHuntCreature`(11535、yokai_lite 等の妖怪), `buildHuntRoom`(16412), `huntStartRoom`(19025), `huntBeginMission`(19073), `huntHeadExplode`(19176), `huntReturnToRoom`(19198), `updateHunt`(19700)

**OSAKA 編（終焉 / 大魔 / 中ボス / 鉄輪）**
`buildOsakaMap`(16946), `clearOsakaMap`(18540), `spawnOsakaBoss`(12937、五変化6形態) / `updateOsakaBoss`(15289), `spawnTengu`(15772) / `spawnYamaya`(15865) / `updateOsakaMidBoss`(15972), `buildDaima`(14753) / `spawnDaima`(14947) / `updateDaima`(15077) / `daimaHitCore`(15033), `osakaTelegraph`(13144、予兆リング), `osakaShowCutin`(14669), `spawnOsakaBikeSquad`(16166) / `updateOsakaBikes`(16209)

**武器/射撃/戦闘**
`fire`(21236), `fireHamaho`(20897、破魔砲チャージビーム), `createBullet`(20011), `meleeAttack`(21115), `fireRocket`(21003), `detonateGrenade`(20822), `damageAllInRadius`(20512), `applyEnemyKill`(20336)

**RPG / ピックアップ**
`makeRPGPickup`(21036), `collectRPG`(21057、`weaponId` で RPG / 破魔砲を付与), `updateRPGPickups`(21090)

**エフェクト**
`spawnBlood`(20068), `spawnExplosion`(20093)

**入力**
`onMouseDown`(21585), `onMouseUp`(21602), `onKeyDown`(24367), `onKeyUp`(24499)

**メインループ**
`animate`(21725〜約24,600、約2,800行) — 上記すべての `update*()` を毎フレーム呼び出すオーケストレーター

**JSX/HUD**
`24,888〜29,359` — 60+ の条件付きオーバーレイ（設定モーダル・HUNT/終焉 HUD・クロスヘア・ミニマップ・キルフィード・武器セレクタ・モバイルボタン群）

> ⚠️ 行番号は実測時点の値。ファイルは継続増加中のため、編集前に `grep -n "function 関数名" ThreeWorld.tsx` で
> 現在地を再確認すること。

### 操作キー (PC)

| キー | 用途 |
|---|---|
| `WASD` / 矢印 | 移動 (ジッタ吸収のため指数補間) |
| `Shift` | スプリント (1.5x) |
| マウス | 視点 (pointer lock) |
| 左クリック | 射撃 |
| 右クリック | ADS (ズーム + 反動低下) |
| `R` | リロード |
| `1` / `2` / `3` | 武器切替 (pistol / shotgun / sniper) |
| `G` | グレネード (5秒CD) |
| `F8` | CRT スキャンライントグル (デフォルト OFF、`localStorage["fps_scanlines"]` 永続化) |

## Executor (apps/executor)

BullMQ ワーカー。`code-execution` キューを購読するが、Phase 1 で実行ロジックは無効化されており、すべて `runtime_error` を返すスタブ。
今後コード問題機能が復活する場合の入口として残してある。docker-compose には Judge0 が定義されているが、現状コードからは呼び出していない。

## 共有パッケージ

- **@code-world/types**: `UserSchema`, `SignupSchema`, `LoginSchema` のみ。ユーザー名は `/^[a-zA-Z0-9_]{4,16}$/`、パスワードは 8〜128 文字。
- **@code-world/ui**: `Button` (`./button` でサブパス export) + `cn` (`./utils`)。`apps/web` 側で `transpilePackages` 対象。

## 実装ルール

### 型安全
- `any` は禁止（実質エラー扱い）
- Zod スキーマは `packages/types` に定義し、api・web で共有
- Drizzle の `$inferSelect` / `$inferInsert` を使い DB 型を手書きしない
- `as unknown as T` キャストは原則禁止、必要時はコメントで理由を明記
- `process.env` は **必ず** ブラケット記法 `process.env["FOO"] ?? default` を使う（`verbatimModuleSyntax` の関係で）

### テスト
- ビジネスロジック（API ルート、AI 判定、ゲームロジック）は Vitest でユニットテスト
- DB を伴うテストは実際の PostgreSQL に接続するインテグレーションテストで行う（モックでは検出できない型ずれ・マイグレーション問題を防ぐ）
- テストファイル命名: `*.test.ts` / `*.spec.ts`

### コードスタイル (Biome 設定準拠)
- インデント: スペース 2
- 行幅: 100
- クォート: ダブルクォート
- セミコロン: なし (`asNeeded`)
- トレイリングカンマ: `all`
- import 文は `verbatimModuleSyntax` 有効のため `import type` を使い分ける

### コンポーネント設計 (apps/web)
- Server Component をデフォルトとし、必要最小限の範囲のみ `'use client'`
- shadcn 風コンポーネントは `apps/web/src/components/` に追加（共有可能なものは `packages/ui` へ）
- `@code-world/ui` は Next.js の `transpilePackages` でトランスパイル
- ThreeWorld の巨大さは認識した上で、現状はリファクタより機能追加優先

### API 設計 (apps/api)
- Hono ルーターはリソース単位でファイル分割 (`routes/*.ts`)
- バリデーションは `@hono/zod-validator` または手動 + `isValid*` ヘルパー
- エラーレスポンス: `{ error: string }`
- 認証が必要なルートは `getAuthUser(c)` の結果を `null` チェックして 401 を返す
- セッションは `cw_session` Cookie に格納（HttpOnly, Secure in production, SameSite=None/Lax）

### キュー設計 (apps/executor)
- ジョブデータの型は `workers/*.ts` に `interface ***JobData` で定義
- 冪等性を保つ（同じ submissionId で複数回実行されても結果が変わらないように）
- 現状は Phase1 でスタブ化されているため、本格実装するときは Judge0 ないしサンドボックスを噛ませる

## 禁止事項

| 禁止 | 理由 |
|---|---|
| `any` 型の使用 | 型安全性が崩壊するため |
| DB モックによるテスト | 実 DB との型ずれを防ぐため、実 PostgreSQL を使う |
| `--no-verify` での git commit | Biome チェックをスキップするため |
| `eval()` / `new Function()` | XSS / RCE リスク |
| `process.env.FOO` の直接アクセス（ドット記法） | `verbatimModuleSyntax` のため `process.env["FOO"]` を使う |
| packages/db 以外での Drizzle クライアント生成 | 接続プールが分散するため、必ず `import { db } from "@code-world/db"` |
| `console.log` のコミット | デバッグ用は削除するか、構造化ログを使う |

## 環境変数

`.env.example` を参照（`.env` は git 管理外）。

| 変数 | 用途 |
|---|---|
| `DATABASE_URL` | PostgreSQL 接続文字列。ローカル既定は `postgresql://postgres:postgres@localhost:5434/codeworld` |
| `REDIS_URL` | Redis 接続文字列。既定 `redis://localhost:6379` |
| `NEXT_PUBLIC_API_URL` | web → api の HTTP base URL |
| `NEXT_PUBLIC_WS_URL` | web → api の WebSocket URL |
| `WEB_URL` / `NEXT_PUBLIC_WEB_URL` | CORS 許可オリジン |
| `WEB_PORT` / `API_PORT` / `EXECUTOR_PORT` | 3000 / 3001 / 3002 |
| `JUDGE0_API_URL` / `JUDGE0_API_KEY` | 任意・現状未使用 |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` / `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | 旧 Better Auth 用。現状コードからは参照していない（将来 OAuth 復活時の予約） |

## 新機能追加の流れ

1. （DB が必要な場合）`packages/db/src/schema/` にテーブル追加 → `bun run db:generate` → `bun run db:push`
2. （共有スキーマが必要な場合）`packages/types` に Zod スキーマ追加
3. `apps/api` にルートを追加（バリデーション・認証チェック付き）
4. `apps/web` にページ・コンポーネントを追加（Server Component 優先）
5. テストを書く
6. `bun run check && bun run test && bun run build` がパスすることを確認
