# ── Stage 1: Prune monorepo to minimal subset ────────────────────────────────
FROM oven/bun:1 AS pruner
WORKDIR /app
COPY . .
RUN bunx turbo prune @code-world/executor --docker

# ── Stage 2: Install dependencies ────────────────────────────────────────────
FROM oven/bun:1 AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/bun.lock ./bun.lock
RUN bun install --frozen-lockfile

# ── Stage 3: Build ───────────────────────────────────────────────────────────
FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=installer /app/node_modules ./node_modules
COPY --from=pruner /app/out/full/ .
RUN cd apps/executor && bun build src/index.ts --outdir dist --target bun

# ── Stage 4: Runner ──────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/apps/executor/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages

CMD ["bun", "dist/index.js"]
