import { getDb, schema, nanoid } from '@mxwatch/db';
import { checkSmtp } from '@mxwatch/monitor';
import { desc, eq } from 'drizzle-orm';

/** Returns the primary MX host for a domain from its latest DNS snapshot. */
async function firstMxHost(domainId: string): Promise<string | null> {
  const db = getDb();
  const [snap] = await db
    .select({ mxRecords: schema.dnsSnapshots.mxRecords })
    .from(schema.dnsSnapshots)
    .where(eq(schema.dnsSnapshots.domainId, domainId))
    .orderBy(desc(schema.dnsSnapshots.checkedAt))
    .limit(1);
  if (!snap?.mxRecords) return null;
  try {
    const arr = JSON.parse(snap.mxRecords) as string[];
    return arr[0] ?? null;
  } catch {
    return null;
  }
}

export async function runSmtpCheckForDomain(domainId: string, port: number = 25) {
  const db = getDb();
  const [domain] = await db.select().from(schema.domains).where(eq(schema.domains.id, domainId)).limit(1);
  if (!domain) return null;
  const host = await firstMxHost(domainId);
  if (!host) return null;
  const result = await checkSmtp(host, port);
  await db.insert(schema.smtpChecks).values({
    id: nanoid(),
    domainId,
    checkedAt: new Date(),
    host: result.host,
    port: result.port,
    connected: result.connected,
    responseTimeMs: result.responseTimeMs,
    banner: result.banner,
    tlsVersion: result.tlsVersion,
    tlsAuthorized: result.tlsAuthorized,
    starttlsOffered: result.starttlsOffered,
    error: result.error,
  });
  return result;
}
