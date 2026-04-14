import { getDb, schema, nanoid } from '@mxwatch/db';
import { parseDmarcReport } from '@mxwatch/monitor';
import { eq } from 'drizzle-orm';
import { evaluateAlertsForDomain } from '@/server/alert-evaluator';

export async function ingestDmarcXml(xml: string, fromDomain: string): Promise<void> {
  const db = getDb();
  const parsed = parseDmarcReport(xml);

  const [matchingDomain] = await db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.domain, parsed.domain))
    .limit(1);

  if (!matchingDomain) {
    console.warn(`[dmarc-ingest] no matching domain for ${parsed.domain} (from ${fromDomain})`);
    return;
  }

  let passCount = 0;
  let failCount = 0;
  let totalMessages = 0;
  for (const row of parsed.rows) {
    totalMessages += row.count;
    const pass = row.spfResult === 'pass' || row.dkimResult === 'pass';
    if (pass) passCount += row.count;
    else failCount += row.count;
  }

  const reportRowId = nanoid();
  await db.insert(schema.dmarcReports).values({
    id: reportRowId,
    domainId: matchingDomain.id,
    reportId: parsed.reportId,
    orgName: parsed.orgName,
    dateRangeBegin: parsed.dateRangeBegin,
    dateRangeEnd: parsed.dateRangeEnd,
    receivedAt: new Date(),
    totalMessages,
    passCount,
    failCount,
    rawXml: xml,
  });

  if (parsed.rows.length > 0) {
    await db.insert(schema.dmarcReportRows).values(
      parsed.rows.map((r) => ({
        id: nanoid(),
        reportId: reportRowId,
        sourceIp: r.sourceIp,
        count: r.count,
        disposition: r.disposition ?? null,
        spfResult: r.spfResult ?? null,
        dkimResult: r.dkimResult ?? null,
        headerFrom: r.headerFrom ?? null,
      })),
    );
  }

  await evaluateAlertsForDomain(matchingDomain.id, 'dmarc');
}
