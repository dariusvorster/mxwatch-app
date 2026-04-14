# ---- base (shared by deps + builder) ----
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable

# ---- deps (install node_modules for the monorepo) ----
FROM base AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json .npmrc ./
COPY pnpm-lock.yaml* ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/monitor/package.json packages/monitor/
COPY packages/alerts/package.json packages/alerts/
COPY packages/types/package.json packages/types/
RUN pnpm install --frozen-lockfile || pnpm install

# ---- builder (produce .next/standalone) ----
FROM base AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages ./packages
COPY . .
# Next.js "collect page data" evaluates route modules, which imports auth.ts,
# which eagerly opens the SQLite DB. Provide a dummy location the build can use.
ENV DATABASE_URL=/tmp/build.db
ENV MXWATCH_SECRET=build-placeholder-secret-32chars
RUN mkdir -p /tmp && pnpm --filter @mxwatch/web build

# ---- migrator (small image carrying drizzle-kit + schema for one-shot schema push) ----
FROM base AS migrator
WORKDIR /app
# Match runner UID so the SQLite file written here is writable by the app container.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder --chown=nextjs:nodejs /app/packages/db ./packages/db
COPY --from=builder --chown=nextjs:nodejs /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
RUN mkdir -p /data && chown -R nextjs:nodejs /data
USER nextjs
ENV NODE_ENV=production
WORKDIR /app/packages/db
CMD ["pnpm", "exec", "drizzle-kit", "push"]

# ---- runner (slim standalone image) ----
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production \
    DATABASE_URL=/data/mxwatch.db \
    SMTP_PORT=2525 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Non-root user for the runtime
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Standalone server + static assets
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

RUN mkdir -p /data && chown -R nextjs:nodejs /data
VOLUME ["/data"]

USER nextjs
EXPOSE 3000 2525

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health 2>/dev/null || exit 1

# The standalone output puts the Next entrypoint at apps/web/server.js
CMD ["node", "apps/web/server.js"]
