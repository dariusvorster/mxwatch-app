import dns from 'node:dns';
import { getDb, schema, nanoid } from '@mxwatch/db';
import { checkMx, checkDmarc, checkIpAgainstAllBlacklists } from '@mxwatch/monitor';
import { eq } from 'drizzle-orm';

async function firstIpForMx(mxHost: string): Promise<string | null> {
  try {
    const a = await dns.promises.resolve4(mxHost);
    return a[0] ?? null;
  } catch {
    return null;
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
