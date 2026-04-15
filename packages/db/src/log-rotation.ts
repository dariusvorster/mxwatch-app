import fs from 'node:fs';
import path from 'node:path';
import { lt } from 'drizzle-orm';
import { getDb } from './client';
import * as schema from './schema';
import { LOG_DIR, logger } from './logger';

const LOG_FILE = path.join(LOG_DIR, 'mxwatch.log');
const RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS ?? 30);

export async function rotateAndPruneLogs(): Promise<void> {
  // Rotate the active file → mxwatch.YYYY-MM-DD.log so today's entries
  // start fresh.
  if (fs.existsSync(LOG_FILE)) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().slice(0, 10);
    const target = path.join(LOG_DIR, `mxwatch.${dateStr}.log`);
    try { fs.renameSync(LOG_FILE, target); }
    catch (e) { console.error('[log-rotation] rename failed:', e); }
  }

  // Drop rotated files older than RETENTION_DAYS.
  if (fs.existsSync(LOG_DIR)) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    for (const file of fs.readdirSync(LOG_DIR)) {
      const m = file.match(/^mxwatch\.(\d{4}-\d{2}-\d{2})\.log$/);
      if (!m) continue;
      const fileDate = new Date(m[1]!);
      if (fileDate < cutoff) {
        try { fs.unlinkSync(path.join(LOG_DIR, file)); }
        catch (e) { console.error('[log-rotation] unlink failed:', e); }
      }
    }
  }

  // Prune SQLite — same retention window.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const db = getDb();
  await db.delete(schema.appLogs).where(lt(schema.appLogs.createdAt, cutoff));

  await logger.info('system', 'Log rotation complete', { retentionDays: RETENTION_DAYS });
}
