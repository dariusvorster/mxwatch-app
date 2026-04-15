import { getDb, schema, logger } from '@mxwatch/db';
import { and, eq } from 'drizzle-orm';
import {
  RBL_KNOWLEDGE, appendTimelineEvent, getRBLHost,
  checkSingleRBL, hasAutoExpired,
} from '@mxwatch/monitor';

/**
 * Polls a single delist request. Exported so the UI can trigger an
 * immediate re-check via tRPC (delist.checkNow).
 */
export async function pollDelistRequest(requestId: string): Promise<void> {
  const db = getDb();
  const [r] = await db
    .select()
    .from(schema.delistRequests)
    .where(eq(schema.delistRequests.id, requestId))
    .limit(1);
  if (!r) return;

  const rbl = RBL_KNOWLEDGE[r.rblName];
  const host = getRBLHost(r.rblName);
  if (!rbl || !host) {
    void logger.warn('rbl', 'Delist poll skipped: unknown RBL', { rblName: r.rblName });
    return;
  }

  // Auto-expire paths (SpamCop, Mailspike) — mark expired without a DNS
  // lookup when the window has passed. Still worth one DNS check first
  // to catch the "already cleared" race.
  const result = await checkSingleRBL({
    value: r.listedValue,
    rblHost: host,
    type: r.listingType as 'ip' | 'domain',
  });

  const now = new Date();
  if (!result.listed) {
    await db
      .update(schema.delistRequests)
      .set({
        status: 'cleared',
        clearedAt: now,
        pollingEnabled: false,
        lastPolledAt: now,
        timeline: appendTimelineEvent(r.timeline, {
          event: 'cleared', detail: `${r.listedValue} no longer listed on ${rbl.name}`,
        }),
        updatedAt: now,
      })
      .where(eq(schema.delistRequests.id, r.id));
    void logger.info('rbl', `Delist confirmed: ${r.listedValue} cleared from ${rbl.name}`, {
      requestId: r.id, domainId: r.domainId,
    });
    return;
  }

  // Still listed — if we've passed the auto-expire threshold, mark expired
  // so users know to stop waiting.
  if (hasAutoExpired(r.rblName, r.submittedAt)) {
    await db
      .update(schema.delistRequests)
      .set({
        status: 'expired',
        lastPolledAt: now,
        pollingEnabled: false,
        timeline: appendTimelineEvent(r.timeline, {
          event: 'auto_expire_reached',
          detail: `Past ${rbl.autoExpireHours}h auto-expire window — listing unexpectedly persists`,
        }),
        updatedAt: now,
      })
      .where(eq(schema.delistRequests.id, r.id));
    return;
  }

  await db
    .update(schema.delistRequests)
    .set({ lastPolledAt: now, updatedAt: now })
    .where(eq(schema.delistRequests.id, r.id));
}

/**
 * Cron entry point: poll every pending delist request. Uses the logger.job
 * controller so a job_runs row records timing + succeeded/failed counters.
 */
export async function pollPendingDelistRequests(): Promise<void> {
  const run = await logger.job('delist-poll');
  let succeeded = 0, failed = 0;
  try {
    const db = getDb();
    const pending = await db
      .select()
      .from(schema.delistRequests)
      .where(and(
        eq(schema.delistRequests.status, 'pending'),
        eq(schema.delistRequests.pollingEnabled, true),
      ));
    for (const r of pending) {
      try { await pollDelistRequest(r.id); succeeded += 1; }
      catch (e) {
        failed += 1;
        void logger.error('rbl', 'Delist poll failed', e, { requestId: r.id });
      }
    }
    await run.success({ itemsProcessed: pending.length, itemsSucceeded: succeeded, itemsFailed: failed });
  } catch (e) {
    await run.fail(e);
    throw e;
  }
}
