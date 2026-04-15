# MxWatch — Logging System Implementation
## Paste into Claude Code in /Users/dariusvorster/Projects/Mxwatch-app

---

Add a structured logging system to MxWatch. Logs go to two
destinations simultaneously: SQLite (for the UI) and JSON files
on disk (for external tools like Loki/Grafana/Promtail).
Log level is configurable in settings. UI is in two places:
/logs (global) and a logs tab on each domain detail page.

---

## 1. Log Schema

### SQLite table

```typescript
// packages/db/schema.ts — add:

export const appLogs = sqliteTable('app_logs', {
  id: text('id').primaryKey(),
  level: text('level').notNull(),
  // 'debug' | 'info' | 'warn' | 'error'

  category: text('category').notNull(),
  // 'system'     — startup, shutdown, config
  // 'job'        — cron job execution
  // 'dns'        — DNS check runs
  // 'rbl'        — RBL check runs
  // 'smtp'       — SMTP check runs
  // 'cert'       — certificate check runs
  // 'dmarc'      — DMARC report ingestion
  // 'stalwart'   — Stalwart API integration
  // 'delivery'   — deliverability test runs
  // 'propagation'— DNS propagation checks
  // 'auth'       — login/logout/2FA events
  // 'billing'    — Lemon Squeezy webhooks
  // 'api'        — API request errors
  // 'webhook'    — inbound webhook handling

  message: text('message').notNull(),
  detail: text('detail'),           // JSON — structured context
  error: text('error'),             // Error message if applicable
  stack: text('stack'),             // Stack trace if error

  // Associations — nullable, attach log to a domain or job run
  domainId: text('domain_id').references(() => domains.id),
  jobRunId: text('job_run_id'),     // references jobRuns.id

  // Request context (if triggered by an HTTP request)
  requestId: text('request_id'),
  userId: text('user_id').references(() => users.id),
  ipAddress: text('ip_address'),

  durationMs: integer('duration_ms'), // for job/check entries

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

// Job runs — tracks each cron execution
export const jobRuns = sqliteTable('job_runs', {
  id: text('id').primaryKey(),
  jobName: text('job_name').notNull(),
  // 'dns_check' | 'rbl_check' | 'smtp_check' | 'cert_check' |
  // 'stalwart_pull' | 'dmarc_ingest' | 'ip_reputation_snapshot'

  domainId: text('domain_id').references(() => domains.id),
  // null = global job (e.g. stalwart pull for all domains)

  status: text('status').notNull(),
  // 'running' | 'success' | 'partial' | 'failed'

  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  durationMs: integer('duration_ms'),

  // Summary counts
  itemsProcessed: integer('items_processed').default(0),
  itemsSucceeded: integer('items_succeeded').default(0),
  itemsFailed: integer('items_failed').default(0),

  errorMessage: text('error_message'),
  detail: text('detail'),  // JSON — job-specific result summary
})
```

### File log location

```
/app/data/logs/
  mxwatch.log          # current log file (JSON lines)
  mxwatch.2026-04-14.log  # rotated daily
  mxwatch.2026-04-13.log
  # keep 30 days of rotated files, then delete
```

JSON lines format (one JSON object per line, newline-delimited):
```json
{"ts":"2026-04-15T10:23:45.123Z","level":"info","category":"rbl","message":"RBL check completed","domainId":"dom_abc","domain":"homelabza.com","rbl":"Spamhaus ZEN","listed":false,"durationMs":245}
{"ts":"2026-04-15T10:23:45.456Z","level":"warn","category":"rbl","message":"RBL check timeout","domainId":"dom_abc","domain":"homelabza.com","rbl":"Barracuda","error":"ETIMEOUT","durationMs":5001}
{"ts":"2026-04-15T10:23:46.000Z","level":"error","category":"smtp","message":"SMTP connection refused","domainId":"dom_def","domain":"gitbay.dev","host":"mail.gitbay.dev","port":587,"error":"ECONNREFUSED"}
```

---

## 2. Logger Implementation

```typescript
// packages/db/logger.ts
// Single logger used everywhere in the app

import { db } from './index'
import { appLogs, jobRuns } from './schema'
import fs from 'fs'
import path from 'path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogCategory = 'system' | 'job' | 'dns' | 'rbl' | 'smtp' |
  'cert' | 'dmarc' | 'stalwart' | 'delivery' | 'propagation' |
  'auth' | 'billing' | 'api' | 'webhook'

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

// Log level hierarchy — only log at or above configured level
const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3,
}

// Read configured level from env (overridden by settings at runtime)
let currentLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) ?? 'info'

export function setLogLevel(level: LogLevel) {
  currentLevel = level
}

export function getLogLevel(): LogLevel {
  return currentLevel
}

// Log file path
const LOG_DIR = process.env.LOG_DIR ?? '/app/data/logs'
const LOG_FILE = path.join(LOG_DIR, 'mxwatch.log')

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true })
  }
}

function getRotatedLogPath(): string {
  const date = new Date().toISOString().slice(0, 10)
  return path.join(LOG_DIR, `mxwatch.${date}.log`)
}

async function writeToFile(entry: LogEntry & { ts: string }) {
  ensureLogDir()
  const line = JSON.stringify({
    ts: entry.ts,
    level: entry.level,
    category: entry.category,
    message: entry.message,
    ...entry.detail,
    ...(entry.error ? { error: entry.error } : {}),
    ...(entry.domainId ? { domainId: entry.domainId } : {}),
    ...(entry.durationMs ? { durationMs: entry.durationMs } : {}),
  }) + '\n'

  // Write to current log file
  fs.appendFileSync(LOG_FILE, line)
}

async function writeToSQLite(entry: LogEntry & { ts: string }) {
  try {
    await db.insert(appLogs).values({
      id: nanoid(),
      level: entry.level,
      category: entry.category,
      message: entry.message,
      detail: entry.detail ? JSON.stringify(entry.detail) : null,
      error: entry.error ?? null,
      stack: entry.stack ?? null,
      domainId: entry.domainId ?? null,
      jobRunId: entry.jobRunId ?? null,
      requestId: entry.requestId ?? null,
      userId: entry.userId ?? null,
      ipAddress: entry.ipAddress ?? null,
      durationMs: entry.durationMs ?? null,
      createdAt: new Date(entry.ts),
    })
  } catch (e) {
    // Never let logging failures crash the app
    // Write to stderr only
    console.error('[logger] Failed to write to SQLite:', e)
  }
}

export async function log(entry: LogEntry): Promise<void> {
  // Check level filter
  if (LEVEL_ORDER[entry.level] < LEVEL_ORDER[currentLevel]) return

  const ts = new Date().toISOString()
  const full = { ...entry, ts }

  // Always write to file
  await writeToFile(full)

  // Always write to SQLite
  await writeToSQLite(full)

  // Also write to console in development
  if (process.env.NODE_ENV === 'development') {
    const emoji = { debug: '🔍', info: 'ℹ️', warn: '⚠️', error: '❌' }
    console.log(`${emoji[entry.level]} [${entry.category}] ${entry.message}`,
      entry.detail ?? '', entry.error ?? '')
  }
}

// Convenience methods
export const logger = {
  debug: (category: LogCategory, message: string, detail?: Record<string, unknown>) =>
    log({ level: 'debug', category, message, detail }),

  info: (category: LogCategory, message: string, detail?: Record<string, unknown>) =>
    log({ level: 'info', category, message, detail }),

  warn: (category: LogCategory, message: string, detail?: Record<string, unknown>) =>
    log({ level: 'warn', category, message, detail }),

  error: (category: LogCategory, message: string, error: unknown, detail?: Record<string, unknown>) => {
    const err = error instanceof Error ? error : new Error(String(error))
    return log({
      level: 'error',
      category,
      message,
      error: err.message,
      stack: err.stack,
      detail,
    })
  },

  // For jobs — creates a job run record and returns helper methods
  job: async (jobName: string, domainId?: string) => {
    const runId = nanoid()
    const startedAt = new Date()

    await db.insert(jobRuns).values({
      id: runId,
      jobName,
      domainId: domainId ?? null,
      status: 'running',
      startedAt,
    })

    await log({
      level: 'info',
      category: 'job',
      message: `Job started: ${jobName}`,
      domainId,
      jobRunId: runId,
      detail: { jobName, domainId },
    })

    return {
      runId,

      success: async (detail?: Record<string, unknown>) => {
        const durationMs = Date.now() - startedAt.getTime()
        await db.update(jobRuns).set({
          status: 'success',
          completedAt: new Date(),
          durationMs,
          ...detail,
        }).where(eq(jobRuns.id, runId))

        await log({
          level: 'info',
          category: 'job',
          message: `Job completed: ${jobName}`,
          domainId,
          jobRunId: runId,
          durationMs,
          detail: { jobName, ...detail },
        })
      },

      partial: async (detail?: Record<string, unknown>) => {
        const durationMs = Date.now() - startedAt.getTime()
        await db.update(jobRuns).set({
          status: 'partial',
          completedAt: new Date(),
          durationMs,
          ...detail,
        }).where(eq(jobRuns.id, runId))

        await log({
          level: 'warn',
          category: 'job',
          message: `Job partially completed: ${jobName}`,
          domainId,
          jobRunId: runId,
          durationMs,
          detail: { jobName, ...detail },
        })
      },

      fail: async (error: unknown, detail?: Record<string, unknown>) => {
        const durationMs = Date.now() - startedAt.getTime()
        const err = error instanceof Error ? error : new Error(String(error))
        await db.update(jobRuns).set({
          status: 'failed',
          completedAt: new Date(),
          durationMs,
          errorMessage: err.message,
          ...detail,
        }).where(eq(jobRuns.id, runId))

        await log({
          level: 'error',
          category: 'job',
          message: `Job failed: ${jobName}`,
          error: err.message,
          stack: err.stack,
          domainId,
          jobRunId: runId,
          durationMs,
          detail: { jobName, ...detail },
        })
      },
    }
  },
}
```

---

## 3. Wire Logger Into All Monitoring Jobs

### DNS check example (apply same pattern to all jobs)

```typescript
// packages/monitors/src/dns.ts — wrap all check functions

export async function runDNSCheck(domain: Domain): Promise<void> {
  const run = await logger.job('dns_check', domain.id)

  try {
    logger.info('dns', 'Starting DNS check', {
      domain: domain.domain,
      domainId: domain.id,
    })

    // SPF check
    try {
      const spf = await checkSPF(domain.domain)
      logger.debug('dns', 'SPF check result', {
        domain: domain.domain,
        record: spf.record,
        valid: spf.valid,
      })
    } catch (e) {
      logger.error('dns', 'SPF check failed', e, {
        domain: domain.domain,
        domainId: domain.id,
      })
    }

    // DKIM check
    try {
      const dkim = await checkDKIM(domain.domain, selector)
      logger.debug('dns', 'DKIM check result', {
        domain: domain.domain,
        selector,
        valid: dkim.valid,
      })
    } catch (e) {
      logger.error('dns', 'DKIM check failed', e, {
        domain: domain.domain,
        selector,
        domainId: domain.id,
      })
    }

    // DMARC check
    // ... same pattern

    await run.success({ domain: domain.domain })

  } catch (e) {
    await run.fail(e, { domain: domain.domain })
    throw e
  }
}
```

### RBL check logging (most verbose — each RBL gets its own log entry)

```typescript
export async function checkAllRBLs(domain: Domain): Promise<void> {
  const run = await logger.job('rbl_check', domain.id)
  let succeeded = 0
  let failed = 0

  for (const rbl of BLACKLISTS) {
    const start = Date.now()
    try {
      const result = await checkRBL(domain.resolvedIp, rbl)
      const durationMs = Date.now() - start

      if (result.listed) {
        logger.warn('rbl', `IP listed on ${rbl.name}`, {
          domain: domain.domain,
          domainId: domain.id,
          rbl: rbl.name,
          ip: domain.resolvedIp,
          durationMs,
        })
      } else {
        logger.debug('rbl', `RBL check clean: ${rbl.name}`, {
          domain: domain.domain,
          domainId: domain.id,
          rbl: rbl.name,
          durationMs,
        })
      }
      succeeded++
    } catch (e) {
      const durationMs = Date.now() - start
      failed++

      // Classify the error — RBL down vs network issue vs timeout
      const err = e instanceof Error ? e : new Error(String(e))
      const errorType =
        err.message.includes('ETIMEOUT') ? 'timeout' :
        err.message.includes('ENOTFOUND') && rbl.host.includes(rbl.host) ? 'rbl_down' :
        'network_error'

      logger.warn('rbl', `RBL check failed: ${rbl.name}`, {
        domain: domain.domain,
        domainId: domain.id,
        rbl: rbl.name,
        errorType,
        error: err.message,
        durationMs,
      })
    }
  }

  if (failed === 0) {
    await run.success({ itemsProcessed: BLACKLISTS.length, itemsSucceeded: succeeded })
  } else if (succeeded > 0) {
    await run.partial({ itemsProcessed: BLACKLISTS.length, itemsSucceeded: succeeded, itemsFailed: failed })
  } else {
    await run.fail(new Error('All RBL checks failed'), { itemsFailed: failed })
  }
}
```

### DMARC ingest logging

```typescript
// Log every report received with parsing result
logger.info('dmarc', 'DMARC report received', {
  from: email.from,
  subject: email.subject,
  size: rawEmail.length,
  domain: reportDomain,
  domainId: domain.id,
})

// Log parsing failures with full detail
logger.error('dmarc', 'Failed to parse DMARC report', parseError, {
  from: email.from,
  subject: email.subject,
  rawXmlPreview: rawXml.slice(0, 200),  // first 200 chars only
  domainId: domain?.id,
})
```

### Stalwart integration logging

```typescript
logger.info('stalwart', 'Pulling stats from Stalwart API', {
  integrationId,
  baseUrl: config.baseUrl,  // never log the token
})

logger.error('stalwart', 'Stalwart API unreachable', error, {
  integrationId,
  baseUrl: config.baseUrl,
  statusCode: response?.status,
  hint: response?.status === 401
    ? 'Check API token — may have expired or been revoked'
    : response?.status === 404
    ? 'Check Stalwart URL — endpoint not found'
    : 'Check network connectivity to Stalwart server',
})
```

---

## 4. Log Rotation

```typescript
// packages/db/log-rotation.ts
// Run as a daily cron job

export async function rotateLogFile(): Promise<void> {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const dateStr = yesterday.toISOString().slice(0, 10)
  const rotatedPath = path.join(LOG_DIR, `mxwatch.${dateStr}.log`)

  // Rename current log to yesterday's date
  if (fs.existsSync(LOG_FILE)) {
    fs.renameSync(LOG_FILE, rotatedPath)
  }

  logger.info('system', 'Log file rotated', { rotatedPath })

  // Delete log files older than 30 days
  const files = fs.readdirSync(LOG_DIR)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)

  for (const file of files) {
    if (!file.match(/mxwatch\.\d{4}-\d{2}-\d{2}\.log/)) continue
    const fileDate = new Date(file.slice(8, 18))
    if (fileDate < cutoff) {
      fs.unlinkSync(path.join(LOG_DIR, file))
      logger.info('system', 'Deleted old log file', { file })
    }
  }
}

// SQLite log retention — delete entries older than 30 days
export async function pruneOldLogs(): Promise<void> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)

  const deleted = await db.delete(appLogs)
    .where(lt(appLogs.createdAt, cutoff))

  logger.info('system', 'Pruned old log entries from SQLite', {
    cutoffDate: cutoff.toISOString(),
  })
}
```

Add to scheduler:
```typescript
cron.schedule('0 0 * * *', async () => {
  await rotateLogFile()
  await pruneOldLogs()
})
```

---

## 5. Log Level Settings

### DB addition
```typescript
// Add to users table:
logLevel: text('log_level').default('info'),
// 'debug' | 'info' | 'warn' | 'error'
```

### tRPC router
```typescript
settings: router({
  // ... existing settings routes ...

  logLevel: router({
    get: authedProcedure.query(async ({ ctx }) => {
      const user = await getUser(ctx.user.id)
      return user.logLevel ?? 'info'
    }),

    set: authedProcedure
      .input(z.enum(['debug', 'info', 'warn', 'error']))
      .mutation(async ({ ctx, input }) => {
        await db.update(users)
          .set({ logLevel: input })
          .where(eq(users.id, ctx.user.id))

        // Apply immediately to the running logger
        setLogLevel(input)

        logger.info('system', 'Log level changed', {
          userId: ctx.user.id,
          newLevel: input,
        })
      }),
  }),
}),
```

### Where it lives in the UI

Add to /settings page (not /settings/security):
```
Logging

Log level:
○ Debug    (everything — very verbose, use for troubleshooting)
● Info     (normal operations — recommended)
○ Warn     (warnings and errors only)
○ Error    (errors only — minimal logging)

Note: Debug mode logs all DNS lookups, RBL responses, and API calls.
Do not leave on permanently — generates significant log volume.

Log retention: 30 days (rolling)
Current log size: 4.2 MB
[Download logs] [Clear logs]
```

---

## 6. tRPC Logs Router

```typescript
logs: router({
  // Global log query
  list: authedProcedure
    .input(z.object({
      level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
      category: z.enum(['system','job','dns','rbl','smtp','cert',
        'dmarc','stalwart','delivery','propagation','auth',
        'billing','api','webhook']).optional(),
      domainId: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().default(100),
      offset: z.number().default(0),
      from: z.number().optional(),  // unix timestamp
      to: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      // Build where clauses from filters
      // Return logs + total count for pagination
      return getFilteredLogs(ctx.user.id, input)
    }),

  // Per-domain logs
  byDomain: authedProcedure
    .input(z.object({
      domainId: z.string(),
      limit: z.number().default(50),
      level: z.enum(['debug','info','warn','error']).optional(),
    }))
    .query(async ({ ctx, input }) => {
      // Verify domain belongs to user
      return getDomainLogs(input.domainId, ctx.user.id, input)
    }),

  // Job runs
  jobRuns: authedProcedure
    .input(z.object({
      domainId: z.string().optional(),
      jobName: z.string().optional(),
      status: z.enum(['running','success','partial','failed']).optional(),
      limit: z.number().default(50),
    }))
    .query(async ({ ctx, input }) => {
      return getJobRuns(ctx.user.id, input)
    }),

  // Error summary — count of errors by category in last 24h
  // Used for dashboard status indicator
  errorSummary: authedProcedure.query(async ({ ctx }) => {
    return getErrorSummary(ctx.user.id)
  }),

  // Download logs as JSON (for support)
  download: authedProcedure
    .input(z.object({
      from: z.number(),
      to: z.number(),
      format: z.enum(['json', 'ndjson']).default('ndjson'),
    }))
    .mutation(async ({ ctx, input }) => {
      // Returns a signed URL or streams the file
      return generateLogDownload(ctx.user.id, input)
    }),

  // Clear logs (with confirmation)
  clear: authedProcedure
    .input(z.object({ confirm: z.literal('CLEAR LOGS') }))
    .mutation(async ({ ctx }) => {
      await db.delete(appLogs)
        .where(eq(appLogs.userId, ctx.user.id))
      logger.info('system', 'Logs cleared by user', { userId: ctx.user.id })
    }),
}),
```

---

## 7. Global /logs Page

```
/logs — App logs

┌─ Filters ──────────────────────────────────────────────────────┐
│ Level: [All ▾]  Category: [All ▾]  Domain: [All ▾]            │
│ Search: [___________________________________]  [From] [To]     │
│                                                [Download logs] │
└────────────────────────────────────────────────────────────────┘

┌─ Job runs ─────────────────────────────────────────────────────┐
│ Recent job executions                         [View all]       │
│                                                                 │
│ ✓ dns_check      homelabza.com    2m ago    245ms              │
│ ✓ rbl_check      homelabza.com    2m ago    1.2s   8/8 clean   │
│ ⚠ rbl_check      gitbay.dev       2m ago    5.1s   1 timeout   │
│ ✓ smtp_check     homelabza.com    30m ago   198ms              │
│ ✗ stalwart_pull  —                1h ago    —      401 Unauth  │
└────────────────────────────────────────────────────────────────┘

┌─ Log entries ───────────────────────────────────────────────────┐
│                                                                  │
│ 10:23:46  ERROR  stalwart  Stalwart API returned 401             │
│           integrationId: int_abc · Check API token              │
│                                                                  │
│ 10:23:45  WARN   rbl       RBL check timeout: Barracuda         │
│           domain: gitbay.dev · durationMs: 5001                 │
│                                                                  │
│ 10:23:45  INFO   rbl       RBL check clean: Spamhaus ZEN        │
│           domain: homelabza.com · durationMs: 234               │
│                                                                  │
│ 10:23:44  INFO   job       Job started: rbl_check               │
│           domain: homelabza.com                                  │
│                                                                  │
│           [Load more]                                            │
└─────────────────────────────────────────────────────────────────┘
```

**Log row design:**
- Timestamp: IBM Plex Mono, 11px
- Level badge: DEBUG (gray) / INFO (blue) / WARN (amber) / ERROR (red)
- Category badge: small pill
- Message: 13px, truncated at 80 chars, click to expand
- Detail: expanded view shows full JSON detail
- Expandable row — click to see full context including stack trace

**Level colour coding:**
- DEBUG: `var(--text3)` — muted, not prominent
- INFO: `var(--blue)` — normal operations
- WARN: `var(--amber)` — needs attention
- ERROR: `var(--red)` — needs immediate attention

---

## 8. Per-Domain Logs Tab

Add a "Logs" tab to the domain detail page (after History tab):

```
Domain detail tabs:
Overview | DMARC | DNS | Blacklists | SMTP | History | Logs  ← new
```

**Logs tab content:**
- Same log list as /logs but pre-filtered to this domain
- Job runs section showing all checks for this domain
- Last 7 days by default
- Quick filters: All / Errors only / Job runs only

```
homelabza.com — Logs

Job runs (last 24h)
─────────────────────────────────────────────────
✓ dns_check      2 hours ago    234ms
✓ rbl_check      2 hours ago    1.1s    8/8 clean
✓ smtp_check     30 min ago     198ms
✓ cert_check     Yesterday      445ms   89 days remaining

Log entries for homelabza.com
─────────────────────────────────────────────────
[same log list, pre-filtered to this domain]
```

---

## 9. Dashboard Log Health Indicator

Add a small indicator to the dashboard topbar or sidebar showing
if there are recent errors. Uses `logs.errorSummary` tRPC query.

```
If 0 errors in last 24h:  nothing shown (clean)
If errors exist:
  ⚠ 2 errors    (amber badge in topbar, links to /logs?level=error)
```

---

## 10. System Startup Logging

```typescript
// apps/web/src/instrumentation.ts — add startup logs

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { logger } = await import('@mxwatch/db/logger')

    logger.info('system', 'MxWatch starting', {
      version: process.env.npm_package_version,
      nodeEnv: process.env.NODE_ENV,
      cloud: process.env.MXWATCH_CLOUD === '1',
      logLevel: process.env.LOG_LEVEL ?? 'info',
      database: process.env.DATABASE_URL,
    })

    const { startMonitoringJobs } = await import('./src/jobs/scheduler')
    await startMonitoringJobs()

    logger.info('system', 'Monitoring jobs started')
  }
}
```

---

## 11. Security — What NOT to log

Never log these values even at debug level:
- Passwords (any field named password, passwordHash, secret)
- TOTP secrets
- API tokens (full value — prefix only is fine)
- Stalwart API tokens (log integrationId instead)
- ENCRYPTION_KEY or BETTER_AUTH_SECRET env vars
- Lemon Squeezy API key
- Full email body content (log subject + size only)
- Full DMARC XML (log reportId + orgName + counts only)

Add a sanitiseLogDetail() helper:
```typescript
export function sanitiseLogDetail(
  detail: Record<string, unknown>,
): Record<string, unknown> {
  const SENSITIVE_KEYS = [
    'password', 'secret', 'token', 'key', 'apiKey',
    'encryptionKey', 'totpSecret', 'passwordHash',
  ]
  const result = { ...detail }
  for (const key of Object.keys(result)) {
    if (SENSITIVE_KEYS.some(s => key.toLowerCase().includes(s.toLowerCase()))) {
      result[key] = '[REDACTED]'
    }
  }
  return result
}
```

---

## 12. Docker volume addition

```yaml
# docker-compose.yml — add logs volume
services:
  mxwatch:
    volumes:
      - mxwatch_data:/app/data
      - mxwatch_logs:/app/data/logs  # separate volume for logs

volumes:
  mxwatch_data:
  mxwatch_logs:
```

Separate volume means logs survive container rebuilds independently
and can be mounted by a Promtail/Loki sidecar without touching
the main data volume.

---

## 13. Environment Variables

```env
# Add to .env.example:
LOG_LEVEL=info           # debug | info | warn | error
LOG_DIR=/app/data/logs   # where log files are written
```

---

## 14. Build Order

Confirm after each step:

STEP 1 — DB schema + migration
  Add appLogs and jobRuns tables. Add logLevel to users.
  Run pnpm db:migrate.

STEP 2 — Logger implementation
  packages/db/logger.ts — full logger with SQLite + file output
  sanitiseLogDetail() helper
  setLogLevel() / getLogLevel()

STEP 3 — Wire into instrumentation
  Startup log in instrumentation.ts
  Log level loaded from DB on startup (or env var fallback)

STEP 4 — Wire into all monitoring jobs
  DNS check, RBL check, SMTP check, cert check
  Each job wrapped with logger.job() pattern
  Per-check debug logging inside each job

STEP 5 — Wire into DMARC ingest + Stalwart
  SMTP listener logs every received email
  Stalwart pull logs every API call result

STEP 6 — Log rotation cron job
  Daily file rotation
  30-day SQLite pruning

STEP 7 — tRPC logs router
  All routes from section 6

STEP 8 — Log level settings UI
  Add to /settings page (not /settings/security)
  Level selector with immediate apply

STEP 9 — Global /logs page
  Filter bar, job runs section, log entries list
  Expandable rows, level colour coding

STEP 10 — Domain detail Logs tab
  Add tab to domain detail
  Pre-filtered log list + job runs for this domain

STEP 11 — Dashboard error indicator
  errorSummary query
  Amber badge in topbar if errors exist

STEP 12 — Docker compose volume update

tsc --noEmit after each step.
Do not log sensitive values — use sanitiseLogDetail() on all detail objects.
```
