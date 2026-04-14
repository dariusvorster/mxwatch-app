import { getDb, schema } from '@mxwatch/db';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { authenticateApiRequest, unauthorized } from '@/lib/user-api-auth';
import { renderDmarcReportPdf } from '@/lib/dmarc-report-pdf';

export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiRequest(req);
  if (!auth) return unauthorized();
  const { id } = await params;
  const url = new URL(req.url);
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') ?? 30)));

  const db = getDb();
  const [owned] = await db
    .select({ id: schema.domains.id, domain: schema.domains.domain })
    .from(schema.domains)
    .where(and(eq(schema.domains.id, id), eq(schema.domains.userId, auth.userId)))
    .limit(1);
  if (!owned) return Response.json({ error: 'Not found' }, { status: 404 });

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const reports = await db
    .select()
    .from(schema.dmarcReports)
    .where(and(
      eq(schema.dmarcReports.domainId, id),
      gte(schema.dmarcReports.receivedAt, since),
    ))
    .orderBy(desc(schema.dmarcReports.receivedAt));

  let totalPass = 0, totalFail = 0, totalMessages = 0;
  for (const r of reports) {
    totalPass += r.passCount ?? 0;
    totalFail += r.failCount ?? 0;
    totalMessages += (r.passCount ?? 0) + (r.failCount ?? 0);
  }

  // Aggregate source IPs across these reports
  const ipAgg = new Map<string, {
    sourceIp: string;
    total: number;
    spfPass: number;
    dkimPass: number;
    quarantine: number;
    reject: number;
  }>();
  if (reports.length > 0) {
    const reportIds = reports.map((r) => r.id);
    const rows = await db
      .select()
      .from(schema.dmarcReportRows)
      .where(inArray(schema.dmarcReportRows.reportId, reportIds));
    for (const row of rows) {
      const agg = ipAgg.get(row.sourceIp) ?? {
        sourceIp: row.sourceIp,
        total: 0, spfPass: 0, dkimPass: 0, quarantine: 0, reject: 0,
      };
      agg.total += row.count;
      if (row.spfResult === 'pass') agg.spfPass += row.count;
      if (row.dkimResult === 'pass') agg.dkimPass += row.count;
      if (row.disposition === 'quarantine') agg.quarantine += row.count;
      if (row.disposition === 'reject') agg.reject += row.count;
      ipAgg.set(row.sourceIp, agg);
    }
  }
  const sourceIps = Array.from(ipAgg.values()).sort((a, b) => b.total - a.total).slice(0, 30);

  const pdf = await renderDmarcReportPdf({
    domain: owned.domain,
    windowDays: days,
    generatedAt: new Date(),
    totals: {
      reports: reports.length,
      messages: totalMessages,
      pass: totalPass,
      fail: totalFail,
      passRate: totalMessages > 0 ? totalPass / totalMessages : null,
    },
    sourceIps,
    reports: reports.slice(0, 100).map((r) => ({
      orgName: r.orgName,
      receivedAt: r.receivedAt,
      totalMessages: r.totalMessages,
      passCount: r.passCount,
      failCount: r.failCount,
    })),
  });

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${owned.domain}-dmarc-${days}d.pdf"`,
    },
  });
}
