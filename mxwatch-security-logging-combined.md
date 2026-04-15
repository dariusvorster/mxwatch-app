# MxWatch — Security + Logging Implementation
## Paste into Claude Code in /Users/dariusvorster/Projects/Mxwatch-app
## This is a combined prompt — build security first, then logging.
## Confirm with me after each PHASE before proceeding.

---

You are adding two major feature sets to MxWatch V3.5:
1. Full security layer (TOTP, sessions, API tokens, IP allowlist, activity log)
2. Structured logging system (SQLite + file, configurable levels, UI)

Read this entire prompt before writing any code.
Build in the exact phase order below. Confirm after each phase.

---

# PHASE 1 — DATABASE MIGRATIONS

Do this first. All schema changes in one migration so there's
no conflict between security and logging tables.

Add to packages/db/schema.ts:

```typescript
// ── Security additions to users table ─────────────────────────
// Add these columns to the existing users table:
totpEnabled:      integer('totp_enabled', { mode: 'boolean' }).default(false),
totpSecret:       text('totp_secret'),
totpBackupCodes:  text('totp_backup_codes'),
ipAllowlist:      text('ip_allowlist'),
sessionExpiryDays: integer('session_expiry_days').default(7),
logLevel:         text('log_level').default('info'),

// ── Activity log ───────────────────────────────────────────────
export const activityLog = sqliteTable('activity_log', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  action: text('action').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  detail: text('detail'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

// ── API tokens ─────────────────────────────────────────────────
export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  prefix: text('prefix').notNull(),
  scopes: text('scopes').notNull(),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  lastUsedIp: text('last_used_ip'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),
})

// ── App logs ───────────────────────────────────────────────────
export const appLogs = sqliteTable('app_logs', {
  id: text('id').primaryKey(),
  level: text('level').notNull(),
  category: text('category').notNull(),
  message: text('message').notNull(),
  detail: text('detail'),
  error: text('error'),
  stack: text('stack'),
  domainId: text('domain_id').references(() => domains.id),
  jobRunId: text('job_run_id'),
  requestId: text('request_id'),
  userId: text('user_id').references(() => users.id),
  ipAddress: text('ip_address'),
  durationMs: integer('duration_ms'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

// ── Job runs ───────────────────────────────────────────────────
export const jobRuns = sqliteTable('job_runs', {
  id: text('id').primaryKey(),
  jobName: text('job_name').notNull(),
  domainId: text('domain_id').references(() => domains.id),
  status: text('status').notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  durationMs: integer('duration_ms'),
  itemsProcessed: integer('items_processed').default(0),
  itemsSucceeded: integer('items_succeeded').default(0),
  itemsFailed: integer('items_failed').default(0),
  errorMessage: text('error_message'),
  detail: text('detail'),
})
```

Run: pnpm db:migrate
Verify: pnpm db:studio — confirm all tables + columns exist.
Fix any migration errors before proceeding.

**Confirm: Phase 1 complete before proceeding.**

---

# PHASE 2 — LOGGER (needed by all subsequent phases)

Build the logger before security because security events
need to be logged too.

## 2a — Core logger

Create packages/db/logger.ts:

```typescript
import { db } from './index'
import { appLogs } from './schema'
import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import { eq, lt } from 'drizzle-orm'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogCategory =
  | 'system' | 'job' | 'dns' | 'rbl' | 'smtp'
  | 'cert' | 'dmarc' | 'stalwart' | 'delivery'
  | 'propagation' | 'auth' | 'billing' | 'api' | 'webhook'

export interface LogEntry {
  level: LogLevel
  category: LogCategory
  message: string
  detail?: Record<string, unknown>
  error?: string
  stack?: string
  domainId?: string
  jobRunId?: string
  requestId?: string
  userId?: string
  ipAddress?: string
  durationMs?: number
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3,
}

let currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info'
export const setLogLevel = (level: LogLevel) => { currentLevel = level }
export const getLogLevel = () => currentLevel

const LOG_DIR = process.env.LOG_DIR ?? '/app/data/logs'
const LOG_FILE = path.join(LOG_DIR, 'mxwatch.log')

// Keys that must never appear in logs
const SENSITIVE_KEYS = [
  'password', 'secret', 'token', 'key', 'apikey',
  'encryptionkey', 'totpsecret', 'passwordhash',
]

export function sanitiseLogDetail(
  detail: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...detail }
  for (const key of Object.keys(result)) {
    if (SENSITIVE_KEYS.some(s => key.toLowerCase().includes(s))) {
      result[key] = '[REDACTED]'
    }
  }
  return result
}

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true })
  }
}

export async function log(entry: LogEntry): Promise<void> {
  if (LEVEL_ORDER[entry.level] < LEVEL_ORDER[currentLevel]) return

  const ts = new Date().toISOString()
  const safeDetail = entry.detail ? sanitiseLogDetail(entry.detail) : undefined

  // Write to JSON log file
  try {
    ensureLogDir()
    const line = JSON.stringify({
      ts, level: entry.level, category: entry.category,
      message: entry.message,
      ...safeDetail,
      ...(entry.error ? { error: entry.error } : {}),
      ...(entry.domainId ? { domainId: entry.domainId } : {}),
      ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
    }) + '\n'
    fs.appendFileSync(LOG_FILE, line)
  } catch (e) {
    console.error('[logger] File write failed:', e)
  }

  // Write to SQLite
  try {
    await db.insert(appLogs).values({
      id: nanoid(),
      level: entry.level,
      category: entry.category,
      message: entry.message,
      detail: safeDetail ? JSON.stringify(safeDetail) : null,
      error: entry.error ?? null,
      stack: entry.stack ?? null,
      domainId: entry.domainId ?? null,
      jobRunId: entry.jobRunId ?? null,
      requestId: entry.requestId ?? null,
      userId: entry.userId ?? null,
      ipAddress: entry.ipAddress ?? null,
      durationMs: entry.durationMs ?? null,
      createdAt: new Date(ts),
    })
  } catch (e) {
    console.error('[logger] SQLite write failed:', e)
  }

  // Console in dev
  if (process.env.NODE_ENV === 'development') {
    const prefix = { debug: '🔍', info: 'ℹ️', warn: '⚠️', error: '❌' }
    console.log(
      `${prefix[entry.level]} [${entry.category}] ${entry.message}`,
      safeDetail ?? '', entry.error ?? '',
    )
  }
}

export const logger = {
  debug: (cat: LogCategory, msg: string, detail?: Record<string, unknown>) =>
    log({ level: 'debug', category: cat, message: msg, detail }),
  info: (cat: LogCategory, msg: string, detail?: Record<string, unknown>) =>
    log({ level: 'info', category: cat, message: msg, detail }),
  warn: (cat: LogCategory, msg: string, detail?: Record<string, unknown>) =>
    log({ level: 'warn', category: cat, message: msg, detail }),
  error: (cat: LogCategory, msg: string, err: unknown, detail?: Record<string, unknown>) => {
    const e = err instanceof Error ? err : new Error(String(err))
    return log({
      level: 'error', category: cat, message: msg,
      error: e.message, stack: e.stack, detail,
    })
  },

  job: async (jobName: string, domainId?: string) => {
    const { jobRuns } = await import('./schema')
    const runId = nanoid()
    const startedAt = new Date()
    await db.insert(jobRuns).values({
      id: runId, jobName,
      domainId: domainId ?? null,
      status: 'running', startedAt,
    })
    await log({ level: 'info', category: 'job',
      message: `Job started: ${jobName}`,
      domainId, jobRunId: runId, detail: { jobName } })

    return {
      runId,
      success: async (detail?: Record<string, unknown>) => {
        const durationMs = Date.now() - startedAt.getTime()
        await db.update(jobRuns)
          .set({ status: 'success', completedAt: new Date(), durationMs, ...detail })
          .where(eq(jobRuns.id, runId))
        await log({ level: 'info', category: 'job',
          message: `Job completed: ${jobName}`,
          domainId, jobRunId: runId, durationMs, detail: { jobName, ...detail } })
      },
      partial: async (detail?: Record<string, unknown>) => {
        const durationMs = Date.now() - startedAt.getTime()
        await db.update(jobRuns)
          .set({ status: 'partial', completedAt: new Date(), durationMs, ...detail })
          .where(eq(jobRuns.id, runId))
        await log({ level: 'warn', category: 'job',
          message: `Job partially completed: ${jobName}`,
          domainId, jobRunId: runId, durationMs, detail: { jobName, ...detail } })
      },
      fail: async (err: unknown, detail?: Record<string, unknown>) => {
        const durationMs = Date.now() - startedAt.getTime()
        const e = err instanceof Error ? err : new Error(String(err))
        await db.update(jobRuns)
          .set({ status: 'failed', completedAt: new Date(), durationMs,
            errorMessage: e.message, ...detail })
          .where(eq(jobRuns.id, runId))
        await log({ level: 'error', category: 'job',
          message: `Job failed: ${jobName}`,
          error: e.message, stack: e.stack,
          domainId, jobRunId: runId, durationMs, detail: { jobName, ...detail } })
      },
    }
  },
}
```

## 2b — Log rotation

Create packages/db/log-rotation.ts:

```typescript
import fs from 'fs'
import path from 'path'
import { db } from './index'
import { appLogs } from './schema'
import { lt } from 'drizzle-orm'
import { logger } from './logger'

const LOG_DIR = process.env.LOG_DIR ?? '/app/data/logs'
const LOG_FILE = path.join(LOG_DIR, 'mxwatch.log')

export async function rotateAndPruneLogs(): Promise<void> {
  // Rotate file
  if (fs.existsSync(LOG_FILE)) {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const dateStr = yesterday.toISOString().slice(0, 10)
    fs.renameSync(LOG_FILE, path.join(LOG_DIR, `mxwatch.${dateStr}.log`))
  }

  // Delete files older than 30 days
  if (fs.existsSync(LOG_DIR)) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    for (const file of fs.readdirSync(LOG_DIR)) {
      if (!file.match(/mxwatch\.\d{4}-\d{2}-\d{2}\.log/)) continue
      const fileDate = new Date(file.slice(8, 18))
      if (fileDate < cutoff) {
        fs.unlinkSync(path.join(LOG_DIR, file))
      }
    }
  }

  // Prune SQLite — delete entries older than 30 days
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)
  await db.delete(appLogs).where(lt(appLogs.createdAt, cutoff))

  logger.info('system', 'Log rotation complete')
}
```

Add to scheduler (apps/web/src/jobs/scheduler.ts):
```typescript
cron.schedule('0 0 * * *', () => rotateAndPruneLogs())
```

## 2c — Wire startup logging

Update apps/web/instrumentation.ts:
```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { logger } = await import('@mxwatch/db/logger')
    logger.info('system', 'MxWatch starting', {
      nodeEnv: process.env.NODE_ENV,
      cloud: process.env.MXWATCH_CLOUD === '1',
      logLevel: process.env.LOG_LEVEL ?? 'info',
    })
    const { startMonitoringJobs } = await import('./src/jobs/scheduler')
    await startMonitoringJobs()
    logger.info('system', 'Monitoring jobs started')
  }
}
```

**Confirm: Phase 2 complete. Logger works, logs appear in SQLite and file.**

---

# PHASE 3 — SECURITY FEATURES

## 3a — Activity log helper

Create packages/db/activity-log.ts:
```typescript
import { db } from './index'
import { activityLog } from './schema'
import { nanoid } from 'nanoid'

export async function logActivity(
  userId: string,
  action: string,
  req: { headers: { get: (key: string) => string | null } },
  detail?: Record<string, unknown>,
) {
  await db.insert(activityLog).values({
    id: nanoid(),
    userId,
    action,
    ipAddress: req.headers.get('x-forwarded-for') ??
               req.headers.get('x-real-ip') ?? 'unknown',
    userAgent: req.headers.get('user-agent') ?? 'unknown',
    detail: detail ? JSON.stringify(detail) : null,
    createdAt: new Date(),
  })
}
```

## 3b — TOTP

Wire better-auth twoFactor plugin:
```typescript
// apps/web/src/lib/auth.ts — add to plugins array:
import { twoFactor } from 'better-auth/plugins'

twoFactor({
  issuer: 'MxWatch',
  totpOptions: { period: 30, digits: 6 },
})
```

Install: pnpm add qrcode @types/qrcode

Create /setup/2fa page (mandatory cloud redirect target):
- Generate QR code via qrcode npm package → data URL
- Show manual entry key
- 6-digit verification input
- On success: generate 8 backup codes (random, bcrypt hash, store encrypted)
- Show backup codes once with download button
- "I have saved my backup codes" checkbox required to proceed

Create /auth/2fa page (shown after password login if TOTP enabled):
- 6-digit input
- "Use backup code" link → text input for backup code
- Rate limit: 5 attempts → 15 minute lockout (store in SQLite)
- On success: session created, redirect to dashboard

Mandatory redirect middleware (cloud only):
```typescript
// apps/web/src/middleware.ts — add check:
if (
  process.env.MXWATCH_CLOUD === '1' &&
  session &&
  !session.user.totpEnabled &&
  !pathname.startsWith('/setup/2fa') &&
  !pathname.startsWith('/api') &&
  !pathname.startsWith('/auth')
) {
  return NextResponse.redirect(new URL('/setup/2fa', req.url))
}
```

Log all TOTP events:
```typescript
logger.info('auth', '2FA enabled', { userId })
logger.warn('auth', '2FA verification failed', { userId, attempt })
logger.info('auth', 'Backup code used', { userId })
```

## 3c — Session management tRPC routes

```typescript
// Add to tRPC router:
sessions: router({
  list: authedProcedure.query(async ({ ctx }) => {
    // Return all sessions for user from better-auth sessions table
    // Mark current session with isCurrent: true
  }),
  revoke: authedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.sessionId === ctx.session.id)
        throw new TRPCError({ code: 'BAD_REQUEST',
          message: 'Use logout to end current session' })
      await revokeSession(input.sessionId, ctx.user.id)
      await logActivity(ctx.user.id, 'session_revoked', ctx.req)
    }),
  revokeAll: authedProcedure.mutation(async ({ ctx }) => {
    await revokeAllOtherSessions(ctx.user.id, ctx.session.id)
    await logActivity(ctx.user.id, 'all_sessions_revoked', ctx.req)
  }),
}),
```

Install: pnpm add ua-parser-js @types/ua-parser-js

## 3d — API tokens tRPC routes

Token format: `mxw_live_` prefix (cloud) or `mxw_self_` (self-hosted)
followed by 32 random bytes base58-encoded.
Store SHA-256 hash only — never store plaintext token.

```typescript
apiTokens: router({
  list: authedProcedure.query(/* prefix + name + scopes + lastUsed */),
  create: authedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      scopes: z.array(z.enum([
        'domains:read','checks:read','reports:read',
        'alerts:read','alerts:write',
      ])),
      expiresInDays: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const prefix = process.env.MXWATCH_CLOUD === '1'
        ? 'mxw_live_' : 'mxw_self_'
      const token = prefix + generateRandomBase58(32)
      const hash = crypto.createHash('sha256').update(token).digest('hex')
      const displayPrefix = token.slice(0, 16) + '...'
      await db.insert(apiTokens).values({ /* ... */ })
      await logActivity(ctx.user.id, 'api_token_created', ctx.req,
        { name: input.name, scopes: input.scopes })
      // Return token ONCE — not stored
      return { token, prefix: displayPrefix }
    }),
  revoke: authedProcedure
    .input(z.object({ tokenId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await db.update(apiTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiTokens.id, input.tokenId),
                   eq(apiTokens.userId, ctx.user.id)))
      await logActivity(ctx.user.id, 'api_token_revoked', ctx.req)
    }),
}),
```

## 3e — IP allowlist

Install: pnpm add is-in-subnet

Add tRPC mutation:
```typescript
ipAllowlist: router({
  get: authedProcedure.query(/* return parsed array */),
  set: authedProcedure
    .input(z.array(z.string()))
    .mutation(async ({ ctx, input }) => {
      // Validate each entry is valid IP or CIDR
      // Warn if current IP not in list
      await db.update(users)
        .set({ ipAllowlist: JSON.stringify(input) })
        .where(eq(users.id, ctx.user.id))
      await logActivity(ctx.user.id, 'ip_allowlist_changed', ctx.req)
    }),
}),
```

Add to middleware (after session check):
```typescript
if (session?.user?.ipAllowlist) {
  const list = JSON.parse(session.user.ipAllowlist) as string[]
  if (list.length > 0) {
    const clientIP = req.headers.get('x-forwarded-for') ?? ''
    const { isInSubnet } = await import('is-in-subnet')
    const allowed = list.some(cidr =>
      cidr.includes('/') ? isInSubnet(clientIP, cidr) : clientIP === cidr
    )
    if (!allowed) {
      return NextResponse.redirect(new URL('/auth/blocked', req.url))
    }
  }
}
```

Create /auth/blocked page:
"Access denied. Your IP address is not in the allowlist for this account."
Show current IP. Link to contact support.

## 3f — Password change

```typescript
changePassword: authedProcedure
  .input(z.object({
    currentPassword: z.string(),
    newPassword: z.string().min(12),
    confirmPassword: z.string(),
  }))
  .mutation(async ({ ctx, input }) => {
    if (input.newPassword !== input.confirmPassword)
      throw new TRPCError({ code: 'BAD_REQUEST',
        message: 'Passwords do not match' })
    // Use better-auth changePassword
    await logActivity(ctx.user.id, 'password_changed', ctx.req)
    // Send email: "Your MxWatch password was changed"
  }),
```

## 3g — Activity log tRPC route

```typescript
activityLog: authedProcedure
  .input(z.object({ limit: z.number().default(50) }))
  .query(async ({ ctx, input }) => {
    return db.query.activityLog.findMany({
      where: eq(activityLog.userId, ctx.user.id),
      orderBy: [desc(activityLog.createdAt)],
      limit: input.limit,
    })
  }),
```

## 3h — Logout button

Add to sidebar footer (next to user name + theme toggle):
```tsx
<button onClick={async () => {
  await authClient.signOut()
  router.push('/login')
}} title="Log out">
  <LogOut size={16} />
</button>
```

**Confirm: Phase 3 complete. All security routes work.**

---

# PHASE 4 — /settings/security PAGE

Single page, sections stacked vertically. No sub-routes.

Section order:
1. Two-factor authentication
   - Status badge (enabled/not configured)
   - Setup button → opens setup modal (QR + verify + backup codes)
   - Disable button (requires current TOTP code)
   - Backup codes: X remaining, Regenerate button

2. Active sessions
   - Cards: browser+OS (ua-parser-js), IP, last active, [Revoke]
   - Current session badge (no revoke button)
   - [Log out all other sessions] button at bottom

3. API tokens
   - Token list: prefix, name, scopes, last used, expiry, [Revoke]
   - [Create token] button → modal
   - Token creation modal: name + scope checkboxes + expiry
   - Token shown once after creation with copy button + warning

4. IP allowlist
   - Toggle to enable/disable
   - IP/CIDR input with [Add] button
   - List of current entries with [Remove]
   - Always show current IP with warning if not in list
   - Pre-fill add input with user's current IP

5. Password
   - Collapsed by default, [Change password] to expand
   - Current password + new password + confirm
   - Password strength indicator

6. Account activity
   - Timeline: icon + action + IP + time
   - Login events, security changes, domain changes
   - Last 50 entries, [Load more]
   - Failed logins in amber, unknown IPs in red

7. Danger zone
   - [Export my data] → downloads JSON of all domains/checks
   - [Delete account] → requires typing "DELETE MY ACCOUNT"

**Confirm: Phase 4 complete. /settings/security page fully working.**

---

# PHASE 5 — WIRE LOGGER INTO MONITORING JOBS

Wrap every monitoring job with the logger.job() pattern.

## Pattern to apply to ALL jobs:

```typescript
// Before (example dns check):
export async function runDNSChecks() {
  for (const domain of domains) {
    await checkDNS(domain)
  }
}

// After:
export async function runDNSChecks() {
  for (const domain of domains) {
    const run = await logger.job('dns_check', domain.id)
    try {
      logger.debug('dns', 'Starting DNS check', { domain: domain.domain })
      const result = await checkDNS(domain)
      logger.debug('dns', 'DNS check result', {
        domain: domain.domain,
        spf: result.spf?.valid,
        dkim: result.dkim?.valid,
        dmarc: result.dmarc?.policy,
      })
      await run.success({ domain: domain.domain })
    } catch (e) {
      logger.error('dns', 'DNS check failed', e, { domain: domain.domain })
      await run.fail(e, { domain: domain.domain })
    }
  }
}
```

Apply this pattern to:
- DNS checks (category: 'dns')
- RBL checks (category: 'rbl') — log each RBL individually at debug level
- SMTP checks (category: 'smtp')
- Certificate checks (category: 'cert')
- DMARC ingestion (category: 'dmarc')
- Stalwart pull (category: 'stalwart')
- Deliverability tests (category: 'delivery')
- Propagation checks (category: 'propagation')

For RBL specifically — log the error type classification:
```typescript
const errorType =
  err.message.includes('ETIMEOUT') ? 'timeout' :
  err.message.includes('ENOTFOUND') ? 'nxdomain' :
  'network_error'
logger.warn('rbl', `RBL check failed: ${rbl.name}`,
  { domain, rbl: rbl.name, errorType, durationMs })
```

**Confirm: Phase 5 complete. All jobs log to SQLite and file.**

---

# PHASE 6 — LOGGING tRPC ROUTES

Add to main tRPC router:

```typescript
logs: router({
  list: authedProcedure
    .input(z.object({
      level: z.enum(['debug','info','warn','error']).optional(),
      category: z.string().optional(),
      domainId: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().default(100),
      offset: z.number().default(0),
      from: z.number().optional(),
      to: z.number().optional(),
    }))
    .query(/* filtered + paginated log query */),

  byDomain: authedProcedure
    .input(z.object({
      domainId: z.string(),
      limit: z.number().default(50),
      level: z.string().optional(),
    }))
    .query(/* logs for one domain, verify ownership */),

  jobRuns: authedProcedure
    .input(z.object({
      domainId: z.string().optional(),
      jobName: z.string().optional(),
      status: z.string().optional(),
      limit: z.number().default(50),
    }))
    .query(/* job runs with filters */),

  errorSummary: authedProcedure.query(async ({ ctx }) => {
    // Count errors in last 24h grouped by category
    // Used by dashboard error indicator
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    return getErrorCounts(ctx.user.id, since)
  }),

  download: authedProcedure
    .input(z.object({
      from: z.number(),
      to: z.number(),
    }))
    .query(/* return NDJSON string of logs for date range */),
}),

// Log level setting
settings: router({
  // ... existing ...
  logLevel: router({
    get: authedProcedure.query(async ({ ctx }) => {
      const user = await getUser(ctx.user.id)
      return user.logLevel ?? 'info'
    }),
    set: authedProcedure
      .input(z.enum(['debug','info','warn','error']))
      .mutation(async ({ ctx, input }) => {
        await db.update(users)
          .set({ logLevel: input })
          .where(eq(users.id, ctx.user.id))
        setLogLevel(input)
        logger.info('system', 'Log level changed', { newLevel: input })
      }),
  }),
}),
```

**Confirm: Phase 6 complete. All tRPC log routes work.**

---

# PHASE 7 — LOGGING UI

## 7a — Global /logs page

Route: apps/web/app/(dashboard)/logs/page.tsx

Layout:
```
/logs — Application logs

[Level filter] [Category filter] [Domain filter] [Search] [Date range]
                                                          [Download]

── Recent job runs ──────────────────────────────────────────────
✓ dns_check      homelabza.com    2m ago    234ms
⚠ rbl_check      homelabza.com    2m ago    5.1s   1 timeout
✓ smtp_check     gitbay.dev       30m ago   198ms
✗ stalwart_pull  —                1h ago    —      401

── Log entries ──────────────────────────────────────────────────
[timestamp]  [LEVEL badge]  [category badge]  [message]
             [expanded detail when clicked]
[Load more]
```

Level badge colours:
- DEBUG: text-muted, bg-surface
- INFO: text-blue, bg-blue-dim
- WARN: text-amber, bg-amber-dim
- ERROR: text-red, bg-red-dim

Each log row is clickable — expands to show full detail JSON
and stack trace if present.

## 7b — Domain detail Logs tab

Add "Logs" tab after existing tabs on /domains/[id] page.

Content:
- Job runs for this domain (last 24h) — same style as /logs
- Log entries pre-filtered to this domain
- Quick filter: All / Errors / Jobs

## 7c — Dashboard error indicator

Add to topbar (apps/web/components/topbar.tsx):
```typescript
const { data: errorSummary } = trpc.logs.errorSummary.useQuery()
const errorCount = errorSummary?.total ?? 0

// Show only if errors exist:
{errorCount > 0 && (
  <Link href="/logs?level=error">
    <span className="...amber badge...">
      ⚠ {errorCount} error{errorCount !== 1 ? 's' : ''}
    </span>
  </Link>
)}
```

## 7d — Log level setting

Add to /settings page (general settings, not security):
```
── Logging ──────────────────────────────────────
Log level:
○ Debug   (very verbose — for troubleshooting only)
● Info    (recommended)
○ Warn    (warnings and errors only)
○ Error   (errors only)

Log retention: 30 days rolling
[Download logs]  [Clear logs]
```

"Clear logs" requires typing "CLEAR LOGS" to confirm.

**Confirm: Phase 7 complete. Both log UIs work.**

---

# PHASE 8 — DOCKER + ENV UPDATES

## docker-compose.yml

```yaml
services:
  mxwatch:
    volumes:
      - mxwatch_data:/app/data
      - mxwatch_logs:/app/data/logs  # separate logs volume
    environment:
      - LOG_LEVEL=${LOG_LEVEL:-info}
      - LOG_DIR=/app/data/logs

volumes:
  mxwatch_data:
  mxwatch_logs:
```

## .env.example additions

```env
# Logging
LOG_LEVEL=info
LOG_DIR=/app/data/logs
```

**Confirm: Phase 8 complete.**

---

# FINAL CHECKS

After all phases complete:

1. tsc --noEmit — zero type errors
2. pnpm db:studio — verify all tables have correct shape
3. Test TOTP setup end-to-end:
   - Enable TOTP → scan QR → verify code → save backup codes
   - Log out → log in → TOTP prompt appears → enter code → dashboard
   - Log out → log in → use backup code → dashboard
4. Test session management:
   - List shows current session with badge
   - Revoke another session → it disappears
   - Log out all other sessions → only current remains
5. Test API token:
   - Create token → copy shown once
   - List shows prefix only, not full token
   - Use token in Authorization header → works
   - Revoke → returns 401
6. Test logging:
   - Trigger an RBL check → see job run + log entries in /logs
   - Force an error (wrong Stalwart URL) → see error in red
   - Check log file written to /app/data/logs/mxwatch.log
7. Test IP allowlist:
   - Enable with current IP → still have access
   - Remove current IP → redirected to /auth/blocked
   - Re-add IP via database (need this escape hatch documented)

---

# IMPORTANT RULES

- Never log: passwords, secrets, tokens (full value), TOTP secrets,
  encryption keys. sanitiseLogDetail() must be called on all detail objects.
- Never store API token plaintext — SHA-256 hash only.
- Middleware IP check must come AFTER session check — no session = redirect to login, not blocked.
- TOTP mandatory redirect only applies when MXWATCH_CLOUD=1 — self-hosted users are never blocked.
- Log file writes must never crash the app — all file I/O wrapped in try/catch.
- pnpm add is-in-subnet ua-parser-js @types/ua-parser-js qrcode @types/qrcode
