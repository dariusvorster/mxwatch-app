import { getDb, schema, nanoid } from '@mxwatch/db';
import { checkDomainHealth } from '@mxwatch/monitor';
import type { DomainHealth } from '@mxwatch/types';
import { eq } from 'drizzle-orm';

export async function runDnsCheckForDomain(domainId: string): Promise<DomainHealth | null> {
  const db = getDb();
  const [domain] = await db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.id, domainId))
    .limit(1);
  if (!domain) return null;

  const selectors = await db
    .select()
    .from(schema.dkimSelectors)
    .where(eq(schema.dkimSelectors.domainId, domainId));

  const health = await checkDomainHealth(domain.domain, selectors.map((s) => s.selector));
  const firstDkim = health.dkim[0];

  await db.insert(schema.dnsSnapshots).values({
    id: nanoid(),
    domainId,
    checkedAt: new Date(),
    spfRecord: health.spf.record,
    spfValid: health.spf.valid,
    spfLookupCount: health.spf.lookupCount,
    dkimSelector: firstDkim?.selector ?? null,
    dkimRecord: firstDkim?.record ?? null,
    dkimValid: firstDkim?.valid ?? null,
    dmarcRecord: health.dmarc.record,
    dmarcPolicy: health.dmarc.policy,
    dmarcValid: health.dmarc.valid,
    mxRecords: JSON.stringify(health.mx),
    healthScore: health.healthScore,
  });

  await db
    .update(schema.checkSchedules)
    .set({ lastDnsCheck: new Date() })
    .where(eq(schema.checkSchedules.domainId, domainId));

  return health;
}
