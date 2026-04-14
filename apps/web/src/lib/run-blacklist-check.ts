import { getDb, schema, nanoid } from '@mxwatch/db';
import { checkIpAgainstAllBlacklists } from '@mxwatch/monitor';
import { eq } from 'drizzle-orm';

export async function runBlacklistCheckForDomain(domainId: string, ip: string) {
  const db = getDb();
  const [domain] = await db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.id, domainId))
    .limit(1);
  if (!domain) return null;

  const result = await checkIpAgainstAllBlacklists(ip);
  await db.insert(schema.blacklistChecks).values({
    id: nanoid(),
    domainId,
    checkedAt: new Date(),
    ipAddress: ip,
    listedOn: JSON.stringify(result.listedOn),
    isListed: result.isListed,
  });
  await db
    .update(schema.checkSchedules)
    .set({ lastBlacklistCheck: new Date() })
    .where(eq(schema.checkSchedules.domainId, domainId));
  return result;
}
