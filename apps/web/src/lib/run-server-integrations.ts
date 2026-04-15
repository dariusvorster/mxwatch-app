import { getDb, schema, nanoid, logger } from '@mxwatch/db';
import { eq, gte } from 'drizzle-orm';
import { decryptJSON } from '@mxwatch/alerts';
import {
  AdapterUnsupportedError,
  getAdapter,
  PostfixLogParser,
  type AdapterConfig,
  type MailServerType,
} from '@mxwatch/monitor';

type IntegrationRow = typeof schema.serverIntegrations.$inferSelect;

async function listActiveIntegrations(): Promise<IntegrationRow[]> {
  const db = getDb();
  const rows = await db.select().from(schema.serverIntegrations);
  return rows.filter((r) => r.baseUrl && r.encryptedToken);
}

function buildConfig(row: IntegrationRow): AdapterConfig {
  return {
    baseUrl: row.baseUrl ?? '',
    apiToken: row.encryptedToken ? decryptJSON<string>(row.encryptedToken) : '',
  };
}

function handleAdapterError(row: IntegrationRow, where: string, err: unknown) {
  if (err instanceof AdapterUnsupportedError) {
    // Expected for stub adapters — don't log at error level.
    return;
  }
  console.error(`[server-integrations] ${where} ${row.name}:`, err);
}

/**
 * Every 60s — pull ServerStats from every active integration, persist a
 * QueueSnapshot row in one go so the queue history chart stays populated
 * without a separate call.
 */
export async function pullAllServerStats(): Promise<void> {
  const run = await logger.job('server-stats-pull');
  let succeeded = 0, failed = 0;
  const db = getDb();
  const rows = await listActiveIntegrations();
  for (const row of rows) {
    const adapter = getAdapter(row.serverType as MailServerType);
    try {
      const stats = await adapter.getStats(buildConfig(row));
      await db
        .update(schema.serverIntegrations)
        .set({ status: 'ok', lastError: null, lastPulledAt: new Date() })
        .where(eq(schema.serverIntegrations.id, row.id));
      if (stats.queueDepth != null) {
        await db.insert(schema.queueSnapshots).values({
          id: nanoid(),
          integrationId: row.id,
          total: stats.queueDepth,
          active: 0,
          deferred: 0,
          failed: stats.queueFailed ?? 0,
          oldestMessageAge: null,
          recordedAt: new Date(),
        });
      }
      succeeded += 1;
    } catch (e) {
      handleAdapterError(row, 'getStats', e);
      if (!(e instanceof AdapterUnsupportedError)) failed += 1;
      await db
        .update(schema.serverIntegrations)
        .set({ status: 'error', lastError: (e as any)?.message ?? String(e), lastPulledAt: new Date() })
        .where(eq(schema.serverIntegrations.id, row.id));
    }
  }
  await run.success({ itemsProcessed: rows.length, itemsSucceeded: succeeded, itemsFailed: failed });
}

/**
 * Every 5m — detailed queue snapshot (total/active/deferred/failed +
 * oldest message age). Separate from stats because it's a richer pull and
 * doesn't need to happen every minute.
 */
export async function pullAllQueueSnapshots(): Promise<void> {
  const run = await logger.job('queue-snapshot');
  let succeeded = 0, failed = 0;
  const db = getDb();
  const rows = await listActiveIntegrations();
  for (const row of rows) {
    const adapter = getAdapter(row.serverType as MailServerType);
    try {
      const q = await adapter.getQueue(buildConfig(row));
      await db.insert(schema.queueSnapshots).values({
        id: nanoid(),
        integrationId: row.id,
        total: q.total,
        active: q.active,
        deferred: q.deferred,
        failed: q.failed,
        oldestMessageAge: q.oldestMessageAge,
        recordedAt: new Date(),
      });
      succeeded += 1;
    } catch (e) {
      handleAdapterError(row, 'getQueue', e);
      if (!(e instanceof AdapterUnsupportedError)) failed += 1;
    }
  }
  await run.success({ itemsProcessed: rows.length, itemsSucceeded: succeeded, itemsFailed: failed });
}

/**
 * Every 5m — pull auth failures, deduplicate against what we already have
 * so we don't insert the same event twice across overlapping time windows.
 */
export async function pullAllAuthFailures(): Promise<void> {
  const run = await logger.job('auth-failure-pull');
  let succeeded = 0, failed = 0;
  const db = getDb();
  const since = new Date(Date.now() - 10 * 60 * 1000);
  const integrations = await listActiveIntegrations();
  for (const row of integrations) {
    const adapter = getAdapter(row.serverType as MailServerType);
    try {
      const events = await adapter.getAuthFailures(buildConfig(row), since);
      if (events.length === 0) continue;
      const existing = await db
        .select({ ip: schema.authFailureEvents.ip, detectedAt: schema.authFailureEvents.detectedAt })
        .from(schema.authFailureEvents)
        .where(gte(schema.authFailureEvents.detectedAt, since));
      const seen = new Set(existing.map((r) => `${r.ip}|${r.detectedAt.getTime()}`));
      const toInsert = events
        .filter((e) => !seen.has(`${e.ip}|${e.timestamp.getTime()}`))
        .map((e) => ({
          id: nanoid(),
          integrationId: row.id,
          ip: e.ip,
          count: e.failCount,
          sampleUsername: e.username ?? null,
          mechanism: e.mechanism,
          detectedAt: e.timestamp,
        }));
      if (toInsert.length > 0) await db.insert(schema.authFailureEvents).values(toInsert);
      succeeded += 1;
    } catch (e) {
      handleAdapterError(row, 'getAuthFailures', e);
      if (!(e instanceof AdapterUnsupportedError)) failed += 1;
    }
  }
  await run.success({ itemsProcessed: integrations.length, itemsSucceeded: succeeded, itemsFailed: failed });
}

/**
 * Every 1h — aggregate the last 24h of delivery events per recipient
 * domain and upsert a `period='24h'` rollup row. Uses the shared
 * PostfixLogParser aggregator so the math stays consistent with adapter-
 * reported stats.
 */
export async function aggregateAllRecipientDomainStats(): Promise<void> {
  const run = await logger.job('recipient-domain-aggregate');
  let succeeded = 0, failed = 0, processed = 0;
  const db = getDb();
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  for (const row of await listActiveIntegrations()) {
    if (!row.domainId) continue;
    processed += 1;
    const adapter = getAdapter(row.serverType as MailServerType);
    try {
      const events = await adapter.getDeliveryEvents(buildConfig(row), since, 10000);
      const agg = events.length > 0
        ? PostfixLogParser.aggregateByDomain(events)
        : await adapter.getRecipientDomainStats(buildConfig(row), since);
      if (agg.length === 0) continue;
      const now = new Date();
      await db.insert(schema.recipientDomainStats).values(
        agg.map((r) => ({
          id: nanoid(),
          domainId: row.domainId!,
          serverIntegrationId: row.id,
          recipientDomain: r.domain,
          period: '24h' as const,
          sent: r.sent,
          delivered: r.delivered,
          bounced: r.bounced,
          deferred: r.deferred,
          // Stored ×10 so we can keep one decimal in an integer column.
          deliveryRate: Math.round((r.deliveryRate ?? 0) * 10),
          avgDelayMs: r.avgDelayMs,
          lastBounceReason: r.lastBounceReason ?? null,
          recordedAt: now,
        })),
      );
      succeeded += 1;
    } catch (e) {
      handleAdapterError(row, 'aggregateRecipientDomainStats', e);
      if (!(e instanceof AdapterUnsupportedError)) failed += 1;
    }
  }
  await run.success({ itemsProcessed: processed, itemsSucceeded: succeeded, itemsFailed: failed });
}
