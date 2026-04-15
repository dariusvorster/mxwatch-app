import dns from 'node:dns';
import { getDb, schema, nanoid } from '@mxwatch/db';
import { checkMx, checkDmarc, checkIpAgainstAllBlacklists } from '@mxwatch/monitor';
import { and, desc, eq } from 'drizzle-orm';
import { sendAlert, decryptJSON, type AlertChannelRecord } from '@mxwatch/alerts';
import type { Alert, ChannelConfig } from '@mxwatch/types';

async function firstIpForMx(mxHost: string): Promise<string | null> {
  try {
    const a = await dns.promises.resolve4(mxHost);
    return a[0] ?? null;
  } catch {
    return null;
  }
}

async function loadActiveChannels(userId: string): Promise<AlertChannelRecord[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.alertChannels)
    .where(and(eq(schema.alertChannels.userId, userId), eq(schema.alertChannels.isActive, true)));
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    config: decryptJSON<ChannelConfig>(r.config),
  }));
}

async function dispatch(userId: string, alert: Alert) {
  const channels = await loadActiveChannels(userId);
  for (const ch of channels) {
    try { await sendAlert(ch, alert); }
    catch (e) { console.error(`[watched-check] channel ${ch.id} dispatch failed`, e); }
  }
}

export async function runWatchedCheck(watchedDomainId: string) {
  const db = getDb();
  const [wd] = await db
    .select()
    .from(schema.watchedDomains)
    .where(eq(schema.watchedDomains.id, watchedDomainId))
    .limit(1);
  if (!wd) return null;

  // Pull the previous snapshot before inserting the new one so we can detect
  // state transitions (clean → listed, DMARC record changed, etc).
  const [prev] = await db
    .select()
    .from(schema.watchedDomainSnapshots)
    .where(eq(schema.watchedDomainSnapshots.watchedDomainId, watchedDomainId))
    .orderBy(desc(schema.watchedDomainSnapshots.checkedAt))
    .limit(1);

  const mx = await checkMx(wd.domain);
  const resolvedIp = mx[0] ? await firstIpForMx(mx[0]) : null;
  const dmarc = await checkDmarc(wd.domain);
  const rbl = resolvedIp ? await checkIpAgainstAllBlacklists(resolvedIp) : null;

  await db.insert(schema.watchedDomainSnapshots).values({
    id: nanoid(),
    watchedDomainId,
    checkedAt: new Date(),
    mxRecords: JSON.stringify(mx),
    resolvedIp,
    dmarcRecord: dmarc.record,
    dmarcPolicy: dmarc.policy,
    dmarcValid: dmarc.valid,
    rblListedCount: rbl ? rbl.listedOn.length : null,
    rblListedOn: rbl ? JSON.stringify(rbl.listedOn) : null,
  });

  // Alert evaluation — only fire on a real transition, never on first snapshot
  // (otherwise existing listings would alert immediately on add).
  if (prev) {
    const newListed = rbl ? rbl.listedOn.length : 0;
    const prevListed = prev.rblListedCount ?? 0;
    if (wd.alertOnRblListing && prevListed === 0 && newListed > 0) {
      await dispatch(wd.userId, {
        id: nanoid(),
        domainId: wd.id,
        domainName: wd.domain,
        type: 'blacklist_listed',
        severity: 'high',
        message: `Watched domain ${wd.domain} (${resolvedIp ?? 'unknown IP'}) is now listed on: ${rbl?.listedOn.join(', ')}`,
        firedAt: new Date(),
      });
    }
    if (wd.alertOnDmarcChange && (prev.dmarcRecord ?? '') !== (dmarc.record ?? '')) {
      await dispatch(wd.userId, {
        id: nanoid(),
        domainId: wd.id,
        domainName: wd.domain,
        type: 'dns_record_changed',
        severity: 'medium',
        message: `Watched domain ${wd.domain} DMARC record changed.\nBefore: ${prev.dmarcRecord ?? '(none)'}\nAfter:  ${dmarc.record ?? '(none)'}`,
        firedAt: new Date(),
      });
    }
  }

  return { mx, resolvedIp, dmarc, rbl };
}

export async function runAllWatchedChecks(): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(schema.watchedDomains);
  for (const w of rows) {
    try { await runWatchedCheck(w.id); }
    catch (e) { console.error(`[watched-check] ${w.domain} failed`, e); }
  }
}
