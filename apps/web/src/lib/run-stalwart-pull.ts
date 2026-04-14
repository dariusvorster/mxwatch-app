import { getDb, schema, nanoid } from '@mxwatch/db';
import { decryptJSON } from '@mxwatch/alerts';
import { StalwartClient } from '@mxwatch/monitor';
import { eq } from 'drizzle-orm';

export async function pullStalwartForIntegration(integrationId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.stalwartIntegrations)
    .where(eq(schema.stalwartIntegrations.id, integrationId))
    .limit(1);
  if (!row || !row.pullEnabled) return;

  let token: string;
  try { token = decryptJSON<string>(row.encryptedToken); }
  catch (e: any) {
    await db.update(schema.stalwartIntegrations).set({ status: 'error', lastError: `token decrypt failed: ${e?.message}`, lastPulledAt: new Date() }).where(eq(schema.stalwartIntegrations.id, row.id));
    return;
  }

  const client = new StalwartClient({ baseUrl: row.baseUrl, token });
  const summary = await client.fetchSnapshotSummary();

  await db.insert(schema.stalwartSnapshots).values({
    id: nanoid(),
    integrationId: row.id,
    recordedAt: new Date(),
    queueDepth: summary.queueDepth,
    queueFailed: summary.queueFailed,
    delivered24h: summary.delivered24h,
    bounced24h: summary.bounced24h,
    rejected24h: summary.rejected24h,
    tlsPercent: summary.tlsPercent,
    rawData: JSON.stringify(summary.raw),
  });

  await db
    .update(schema.stalwartIntegrations)
    .set({
      status: summary.error ? 'error' : 'ok',
      lastError: summary.error ?? null,
      lastPulledAt: new Date(),
    })
    .where(eq(schema.stalwartIntegrations.id, row.id));
}

export async function pullAllStalwart(): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.stalwartIntegrations)
    .where(eq(schema.stalwartIntegrations.pullEnabled, true));
  for (const r of rows) {
    try { await pullStalwartForIntegration(r.id); }
    catch (e) { console.error(`[stalwart-pull] ${r.name} failed`, e); }
  }
}
