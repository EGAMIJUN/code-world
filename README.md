# ⚡ CODE WORLD

> 「コードを書いて、街を作れ。」  
> サイバーパンク世界を舞台にしたダンジョンRPG × 学習型オープンワールドゲーム

🌐 **本番URL**: https://code-worldweb-production.up.railway.app

---

## 🎮 ゲーム概要

SQLやPython・JavaScript・C#の問題を解いてAIボスと戦い、獲得したブロックでサイバーパンク風の街を建設するプログラミング学習ゲーム。

```
ダンジョンに挑む → 問題を解く → ボスを倒す → ブロック獲得 → ワールドに建設 → 他プレイヤーと交流
```

---

## 🏗️ システムアーキテクチャ

```mermaid
graph TD
    Browser["🌐 ブラウザ\nNext.js 15 + Phaser 3\nMonaco Editor"]
    API["⚙️ APIサーバー\nHono + Better Auth\nSocket.io"]
    Executor["🔧 Executor\nBullMQ Worker\nJudge0 + Docker"]
    PG["🐘 PostgreSQL\nNeon (Singapore)"]
    Redis["⚡ Redis\nUpstash (Tokyo)"]

    Browser -->|"HTTPS / WebSocket"| API
    API -->|"BullMQ Job"| Executor
    API -->|"Drizzle ORM"| PG
    API -->|"Cache / PubSub"| Redis
    Executor -->|"採点結果保存"| PG
    Executor -->|"ジョブ管理"| Redis
```

---

## 🎯 ゲームループ

```mermaid
flowchart LR
    A["🏰 ダンジョン選択\nSQL/Python/JS/C#"] --> B["⚔️ 戦闘\n問題を解く"]
    B -->|"正解 +50ダメージ"| C["🧱 ブロック獲得\n木材/石/ダイヤ/紫"]
    B -->|"不正解 -10HP"| B
    C --> D["🌆 ワールド建設\nブロックを配置"]
    D --> E["🏆 ランキング\nXP・レベルアップ"]
    E --> A
```

---

## 🏰 ダンジョン構造

```mermaid
graph TD
    subgraph SQL["🔵 SQL SECTOR"]
        S1["Data Vault\nLv0+ / 250HP"]
        S2["Query Fortress\nLv3+ / 500HP"]
        S3["Oracle Core\nLv5+ / 800HP"]
    end
    subgraph PY["🐍 PYTHON SECTOR"]
        P1["Script Maze\nLv0+ / 250HP"]
        P2["Algorithm Lab\nLv3+ / 500HP"]
        P3["Neural Nest\nLv5+ / 800HP"]
    end
    subgraph JS["💛 JS SECTOR"]
        J1["DOM Dungeon\nLv0+ / 250HP"]
        J2["Async Abyss\nLv3+ / 500HP"]
        J3["Runtime Rift\nLv5+ / 800HP"]
    end
    subgraph CS["🟣 C# SECTOR"]
        C1["Syntax Citadel\nLv0+ / 250HP"]
        C2["LINQ Labyrinth\nLv3+ / 500HP"]
        C3["CLR Core\nLv5+ / 800HP"]
    end

    Room["各ダンジョン: 5部屋\n雑魚×3 → ミニボス → ボス"]
    S1 & S2 & S3 & P1 & P2 & P3 & J1 & J2 & J3 & C1 & C2 & C3 --> Room
```

---

## 💻 コード実行パイプライン

```mermaid
sequenceDiagram
    participant U as ユーザー
    participant API as APIサーバー
    participant Q as BullMQ
    participant E as Executor
    participant J as Judge0
    participant DB as PostgreSQL

    U->>API: コード提出 (POST /api/submissions)
    API->>DB: pending レコード作成
    API->>Q: ジョブ投入
    API-->>U: { id, status: "pending" }
    Q->>E: ジョブ取得
    E->>J: コード実行 (Docker sandbox)
    J-->>E: 実行結果
    E->>DB: 結果保存 (accepted/wrong_answer/runtime_error)
    E-->>U: Socket.io でリアルタイム通知
```

---

## 🗃️ データベース設計

```mermaid
erDiagram
    users {
        uuid id PK
        string email
        string username
        int level
        int xp
        int hp
    }
    problems {
        uuid id PK
        string title
        string category
        int difficulty
        jsonb body
        string status
    }
    submissions {
        uuid id PK
        uuid player_id FK
        uuid problem_id FK
        text code
        string result
        int score
        string language
    }
    worlds {
        uuid id PK
        uuid owner_id FK
        string name
    }
    world_blocks {
        uuid id PK
        uuid world_id FK
        string block_type
        int tile_x
        int tile_y
    }
    inventory {
        uuid id PK
        uuid player_id FK
        string block_type
        int quantity
    }
    dungeons {
        uuid id PK
        string name
        string language
        int level_required
        int boss_hp
    }
    dungeon_rooms {
        uuid id PK
        uuid dungeon_id FK
        uuid problem_id FK
        int room_order
        string room_type
    }
    achievements {
        uuid id PK
        uuid player_id FK
        string type
    }

    users ||--o{ submissions : "提出する"
    users ||--o{ worlds : "所有する"
    users ||--o{ inventory : "所持する"
    users ||--o{ achievements : "獲得する"
    problems ||--o{ submissions : "解かれる"
    problems ||--o{ dungeon_rooms : "使われる"
    worlds ||--o{ world_blocks : "含む"
    dungeons ||--o{ dungeon_rooms : "構成される"
```

---

## 📦 モノレポ構成

```mermaid
graph TD
    Root["code-world (Turborepo + Bun)"]
    Root --> Apps
    Root --> Packages

    subgraph Apps["apps/"]
        Web["web/\nNext.js 15"]
        Api["api/\nHono"]
        Exec["executor/\nBullMQ Worker"]
    end

    subgraph Packages["packages/"]
        DB["db/\nDrizzle ORM + Schema"]
        Types["types/\nZod スキーマ共有"]
        UI["ui/\nshadcn/ui"]
        Config["config/\ntsconfig・biome"]
    end

    Web --> Types
    Api --> Types
    Api --> DB
    Exec --> DB
```

---

## 🚀 デプロイ構成

```mermaid
graph LR
    GitHub["GitHub\nEGAMIJUN/code-world"]
    GitHub -->|"push → 自動デプロイ"| Railway

    subgraph Railway["Railway"]
        RW["web\nNext.js"]
        RA["api\nHono"]
        RE["executor\nBullMQ"]
    end

    Railway --> Neon["Neon\nPostgreSQL\nSingapore"]
    Railway --> Upstash["Upstash\nRedis\nTokyo"]
```

---

## 🛠️ 技術スタック

| レイヤー | 技術 | 用途 |
|---------|------|------|
| フロント | Next.js 15 + TypeScript | App Router + RSC |
| ゲームエンジン | Phaser 3 | アイソメトリック2Dワールド |
| コードエディタ | Monaco Editor | VS Codeと同じエンジン |
| バックエンド | Hono | 型安全RPC API |
| 認証 | Better Auth | GitHub OAuth + メール認証 |
| ORM | Drizzle ORM | 型安全SQL |
| キュー | BullMQ | コード採点ジョブ管理 |
| コード実行 | Judge0 + Docker | セキュアサンドボックス |
| DB | PostgreSQL (Neon) | 全データ永続化 |
| キャッシュ | Redis (Upstash) | BullMQ + リーダーボード |
| リアルタイム | Socket.io | マルチプレイヤー位置同期 |
| パッケージ管理 | Bun | npm比10倍速 |
| モノレポ | Turborepo | ビルドキャッシュ・並列実行 |
| デプロイ | Railway | 全サービス自動デプロイ |

---

## ⚔️ 戦闘バランス

| パラメータ | 値 |
|-----------|-----|
| プレイヤー初期HP | 200 |
| ボス攻撃間隔 | 15秒 |
| ボス攻撃ダメージ | 5 |
| 正解時ボスダメージ | 50 |
| 不正解時ダメージ | 10 |
| Lv.0問題XP | +50 |
| Lv.1問題XP | +100 |
| Lv.2問題XP | +150 |
| Lv.3問題XP | +200 |

---

## 🏃 ローカル開発

```bash
# 必要: Bun 1.3.14 + Docker Desktop

git clone https://github.com/EGAMIJUN/code-world
cd code-world
cp .env.example .env
docker compose up -d          # PostgreSQL(5434) + Redis(6379)
bun install
cd packages/db && DATABASE_URL=... bunx drizzle-kit push
DATABASE_URL=... bun src/seed.ts
cd ../..
bun run dev                   # web:3000 / api:3001 / executor
```

---

*Built by EGAMIJUN with Claude Code (Sonnet 4.6)*
