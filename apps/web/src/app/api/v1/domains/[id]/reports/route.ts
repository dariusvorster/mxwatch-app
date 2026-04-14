import { getDb, schema } from '@mxwatch/db';
import { and, desc, eq, gte } from 'drizzle-orm';
import { authenticateApiRequest, unauthorized } from '@/lib/user-api-auth';
import { csvResponse, toCsv } from '@/lib/csv';

export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiRequest(req);
  if (!auth) return unauthorized();
  const { id } = await params;
  const url = new URL(req.url);
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') ?? 30)));
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 100)));

  const format = url.searchParams.get('format');
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
    .orderBy(desc(schema.dmarcReports.receivedAt))
    .limit(limit);

  const totalPass = reports.reduce((s, r) => s + (r.passCount ?? 0), 0);
  const totalFail = reports.reduce((s, r) => s + (r.failCount ?? 0), 0);
  const totalMessages = totalPass + totalFail;

  if (format === 'csv') {
    const csv = toCsv(reports, [
      { header: 'receivedAt', get: (r) => r.receivedAt },
      { header: 'orgName', get: (r) => r.orgName },
      { header: 'reportId', get: (r) => r.reportId },
      { header: 'dateRangeBegin', get: (r) => r.dateRangeBegin },
      { header: 'dateRangeEnd', get: (r) => r.dateRangeEnd },
      { header: 'totalMessages', get: (r) => r.totalMessages },
      { header: 'passCount', get: (r) => r.passCount },
      { header: 'failCount', get: (r) => r.failCount },
    ]);
    return csvResponse(csv, `${owned.domain}-dmarc-reports-${days}d.csv`);
  }

  return Response.json({
    windowDays: days,
    totals: {
      reports: reports.length,
      messages: totalMessages,
      pass: totalPass,
      fail: totalFail,
      passRate: totalMessages > 0 ? totalPass / totalMessages : null,
    },
    reports: reports.map((r) => ({
      id: r.id,
      reportId: r.reportId,
      orgName: r.orgName,
      dateRangeBegin: r.dateRangeBegin,
      dateRangeEnd: r.dateRangeEnd,
      receivedAt: r.receivedAt,
      totalMessages: r.totalMessages,
      passCount: r.passCount,
      failCount: r.failCount,
    })),
  });
}
