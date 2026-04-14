import { getDb, schema, nanoid } from '@mxwatch/db';
import { checkCertificate } from '@mxwatch/monitor';
import { desc, eq } from 'drizzle-orm';

function hostsForDomain(domainName: string, mx: string[]): Array<{ hostname: string; port: number }> {
  const hosts = new Set<string>();
  hosts.add(`mail.${domainName}`);
  hosts.add(domainName);
  for (const h of mx) hosts.add(h);
  return Array.from(hosts).map((hostname) => ({ hostname, port: 443 }));
}

export async function runCertCheckForDomain(domainId: string) {
  const db = getDb();
  const [domain] = await db.select().from(schema.domains).where(eq(schema.domains.id, domainId)).limit(1);
  if (!domain) return [];
  const [snap] = await db
    .select({ mxRecords: schema.dnsSnapshots.mxRecords })
    .from(schema.dnsSnapshots)
    .where(eq(schema.dnsSnapshots.domainId, domainId))
    .orderBy(desc(schema.dnsSnapshots.checkedAt))
    .limit(1);
  const mx = snap?.mxRecords ? (JSON.parse(snap.mxRecords) as string[]) : [];

  const targets = hostsForDomain(domain.domain, mx);
  const results = await Promise.all(
    targets.map((t) => checkCertificate(t.hostname, t.port).catch((e) => ({
      hostname: t.hostname, port: t.port, authorized: false, issuer: null, subject: null,
      validFrom: null, validTo: null, daysUntilExpiry: null, fingerprint: null, altNames: [],
      error: e?.message ?? 'error', checkedAt: new Date(),
    }))),
  );

  if (results.length > 0) {
    await db.insert(schema.certChecks).values(results.map((r) => ({
      id: nanoid(),
      domainId,
      hostname: r.hostname,
      port: r.port,
      checkedAt: r.checkedAt,
      authorized: r.authorized,
      issuer: r.issuer,
      subject: r.subject,
      validFrom: r.validFrom,
      validTo: r.validTo,
      daysUntilExpiry: r.daysUntilExpiry,
      fingerprint: r.fingerprint,
      altNames: JSON.stringify(r.altNames),
      error: r.error,
    })));
  }
  return results;
}
