import { getDb, schema, nanoid } from '@mxwatch/db';
import { and, eq } from 'drizzle-orm';
import { listVerifiedDomains, getTrafficStats, normalizeStats } from './google-postmaster';

function formatGoogleDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function formatIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface SyncResult {
  userId: string;
  domainsChecked: number;
  statsWritten: number;
  errors: string[];
}

/**
 * Pull yesterday's traffic stats for every MxWatch domain that is also
 * verified in the user's Postmaster Tools account. Upserts by (domainId, date).
 */
export async function syncPostmasterForUser(userId: string, daysBack = 1): Promise<SyncResult> {
  const db = getDb();
  const errors: string[] = [];
  const result: SyncResult = { userId, domainsChecked: 0, statsWritten: 0, errors };

  const verified = new Set((await listVerifiedDomains(userId)).map((d) => d.toLowerCase()));
  const mxDomains = await db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.userId, userId));

  const now = new Date();
  const target = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const googleDate = formatGoogleDate(target);
  const isoDate = formatIsoDate(target);

  for (const d of mxDomains) {
    if (!verified.has(d.domain.toLowerCase())) continue;
    result.domainsChecked += 1;

    try {
      const raw = await getTrafficStats(userId, d.domain, googleDate);
      if (!raw) continue;
      const n = normalizeStats(raw);

      const [existing] = await db
        .select({ id: schema.postmasterStats.id })
        .from(schema.postmasterStats)
        .where(and(
          eq(schema.postmasterStats.domainId, d.id),
          eq(schema.postmasterStats.date, isoDate),
        ))
        .limit(1);

      const payload = {
        spamRate: n.spamRate,
        ipReputations: n.ipReputations ? JSON.stringify(n.ipReputations) : null,
        domainReputation: n.domainReputation,
        dkimSuccessRatio: n.dkimSuccessRatio,
        spfSuccessRatio: n.spfSuccessRatio,
        dmarcSuccessRatio: n.dmarcSuccessRatio,
        inboundEncryptionRatio: n.inboundEncryptionRatio,
        outboundEncryptionRatio: n.outboundEncryptionRatio,
        deliveryErrors: n.deliveryErrors ? JSON.stringify(n.deliveryErrors) : null,
        fetchedAt: new Date(),
      };

      if (existing) {
        await db.update(schema.postmasterStats).set(payload).where(eq(schema.postmasterStats.id, existing.id));
      } else {
        await db.insert(schema.postmasterStats).values({
          id: nanoid(),
          domainId: d.id,
          date: isoDate,
          ...payload,
        });
      }
      result.statsWritten += 1;
    } catch (e: any) {
      errors.push(`${d.domain}: ${e?.message ?? 'unknown'}`);
    }
  }

  await db
    .update(schema.userGoogleOAuth)
    .set({
      lastSyncAt: new Date(),
      lastSyncError: errors.length ? errors.join('\n').slice(0, 500) : null,
    })
    .where(eq(schema.userGoogleOAuth.userId, userId));

  return result;
}

/** Sync every connected user's stats — called by the daily cron. */
export async function syncAllPostmaster(): Promise<void> {
  const db = getDb();
  const connections = await db.select().from(schema.userGoogleOAuth);
  for (const c of connections) {
    try {
      await syncPostmasterForUser(c.userId);
    } catch (e) {
      console.error(`[sync-postmaster] ${c.userId} failed`, e);
    }
  }
}
