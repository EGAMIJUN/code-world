# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM oven/bun:1 AS builder
WORKDIR /app

# Copy all package.json files first for layer caching
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/
COPY apps/executor/package.json ./apps/executor/
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY packages/ui/package.json ./packages/ui/

# Install all workspace deps from monorepo root (resolves workspace: symlinks)
RUN bun install --frozen-lockfile

# Copy source
COPY apps/executor ./apps/executor
COPY packages ./packages

# Build
RUN cd apps/executor && bun build src/index.ts --outdir dist --target bun

# ── Stage 2: Runner ──────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/apps/executor/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
# workspace: symlinks in node_modules point to ../../packages/* — copy source to resolve them
COPY --from=builder /app/packages ./packages

CMD ["bun", "dist/index.js"]
