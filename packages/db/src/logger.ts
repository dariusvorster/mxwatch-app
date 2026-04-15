import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { getDb } from './client';
import * as schema from './schema';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogCategory =
  | 'system' | 'job' | 'dns' | 'rbl' | 'smtp'
  | 'cert' | 'dmarc' | 'stalwart' | 'delivery'
  | 'propagation' | 'auth' | 'billing' | 'api' | 'webhook';

export interface LogEntry {
  level: LogLevel;
  category: LogCategory;
  message: string;
  detail?: Record<string, unknown>;
  error?: string;
  stack?: string;
  domainId?: string;
  jobRunId?: string;
  requestId?: string;
  userId?: string;
  ipAddress?: string;
  durationMs?: number;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';
export const setLogLevel = (level: LogLevel) => { currentLevel = level; };
export const getLogLevel = () => currentLevel;

export const LOG_DIR = process.env.LOG_DIR ?? path.join(process.cwd(), 'data', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'mxwatch.log');

// Keys that must never appear in logs. Match is case-insensitive substring.
const SENSITIVE_KEYS = [
  'password', 'secret', 'token', 'key', 'apikey',
  'encryptionkey', 'totpsecret', 'passwordhash', 'authorization',
];

export function sanitiseLogDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const result = { ...detail };
  for (const key of Object.keys(result)) {
    if (SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s))) {
      result[key] = '[REDACTED]';
    }
  }
  return result;
}

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

export async function log(entry: LogEntry): Promise<void> {
  if (LEVEL_ORDER[entry.level] < LEVEL_ORDER[currentLevel]) return;

  const ts = new Date();
  const safeDetail = entry.detail ? sanitiseLogDetail(entry.detail) : undefined;

  // File sink — append-only NDJSON, one record per line.
  try {
    ensureLogDir();
    const line = JSON.stringify({
      ts: ts.toISOString(), level: entry.level, category: entry.category,
      message: entry.message,
      ...(safeDetail ?? {}),
      ...(entry.error ? { error: entry.error } : {}),
      ...(entry.domainId ? { domainId: entry.domainId } : {}),
      ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
    }) + '\n';
    fs.appendFileSync(LOG_FILE, line);
  } catch (e) {
    console.error('[logger] file write failed:', e);
  }

  // SQLite sink — searchable from the UI.
  try {
    const db = getDb();
    await db.insert(schema.appLogs).values({
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
      createdAt: ts,
    });
  } catch (e) {
    console.error('[logger] sqlite write failed:', e);
  }

  // Console mirror in dev so devs don't have to tail the file.
  if (process.env.NODE_ENV === 'development') {
    const prefix = { debug: '[debug]', info: '[info]', warn: '[warn]', error: '[error]' };
    console.log(`${prefix[entry.level]} [${entry.category}] ${entry.message}`,
      safeDetail ?? '', entry.error ?? '');
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
    const e = err instanceof Error ? err : new Error(String(err));
    return log({
      level: 'error', category: cat, message: msg,
      error: e.message, stack: e.stack, detail,
    });
  },

  /**
   * Job-run helper — records a row in job_runs with timing + status, and
   * emits a paired info/warn/error log on each transition. Returns a
   * controller that the job calls when it finishes.
   */
  job: async (jobName: string, domainId?: string) => {
    const db = getDb();
    const runId = nanoid();
    const startedAt = new Date();
    await db.insert(schema.jobRuns).values({
      id: runId, jobName, domainId: domainId ?? null,
      status: 'running', startedAt,
    });
    await log({
      level: 'info', category: 'job',
      message: `Job started: ${jobName}`,
      domainId, jobRunId: runId, detail: { jobName },
    });

    return {
      runId,
      success: async (detail?: { itemsProcessed?: number; itemsSucceeded?: number; itemsFailed?: number }) => {
        const durationMs = Date.now() - startedAt.getTime();
        await db.update(schema.jobRuns)
          .set({ status: 'success', completedAt: new Date(), durationMs, ...(detail ?? {}) })
          .where(eq(schema.jobRuns.id, runId));
        await log({
          level: 'info', category: 'job',
          message: `Job completed: ${jobName}`,
          domainId, jobRunId: runId, durationMs, detail: { jobName, ...(detail ?? {}) },
        });
      },
      partial: async (detail?: { itemsProcessed?: number; itemsSucceeded?: number; itemsFailed?: number }) => {
        const durationMs = Date.now() - startedAt.getTime();
        await db.update(schema.jobRuns)
          .set({ status: 'partial', completedAt: new Date(), durationMs, ...(detail ?? {}) })
          .where(eq(schema.jobRuns.id, runId));
        await log({
          level: 'warn', category: 'job',
          message: `Job partially completed: ${jobName}`,
          domainId, jobRunId: runId, durationMs, detail: { jobName, ...(detail ?? {}) },
        });
      },
      fail: async (err: unknown, detail?: Record<string, unknown>) => {
        const durationMs = Date.now() - startedAt.getTime();
        const e = err instanceof Error ? err : new Error(String(err));
        await db.update(schema.jobRuns)
          .set({
            status: 'failed', completedAt: new Date(), durationMs,
            errorMessage: e.message,
          })
          .where(eq(schema.jobRuns.id, runId));
        await log({
          level: 'error', category: 'job',
          message: `Job failed: ${jobName}`,
          error: e.message, stack: e.stack,
          domainId, jobRunId: runId, durationMs, detail: { jobName, ...(detail ?? {}) },
        });
      },
    };
  },
};

export type JobController = Awaited<ReturnType<typeof logger.job>>;
