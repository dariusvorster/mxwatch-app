export const dynamic = 'force-dynamic';

import { getDb, schema } from '@mxwatch/db';
import { and, desc, eq } from 'drizzle-orm';
import { authenticateApiRequest, unauthorized } from '@/lib/user-api-auth';
import { csvResponse, toCsv } from '@/lib/csv';

export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiRequest(req);
  if (!auth) return unauthorized();
  const { id } = await params;
  const url = new URL(req.url);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
  const format = url.searchParams.get('format');

  const db = getDb();
  const [owned] = await db
    .select({ id: schema.domains.id, domain: schema.domains.domain })
    .from(schema.domains)
    .where(and(eq(schema.domains.id, id), eq(schema.domains.userId, auth.userId)))
    .limit(1);
  if (!owned) return Response.json({ error: 'Not found' }, { status: 404 });

  const rows = await db
    .select()
    .from(schema.dnsSnapshots)
    .where(eq(schema.dnsSnapshots.domainId, id))
    .orderBy(desc(schema.dnsSnapshots.checkedAt))
    .limit(limit);

  if (format === 'csv') {
    const csv = toCsv(rows, [
      { header: 'checkedAt', get: (r) => r.checkedAt },
      { header: 'healthScore', get: (r) => r.healthScore },
      { header: 'spfValid', get: (r) => r.spfValid },
      { header: 'spfLookupCount', get: (r) => r.spfLookupCount },
      { header: 'spfRecord', get: (r) => r.spfRecord },
      { header: 'dkimSelector', get: (r) => r.dkimSelector },
      { header: 'dkimValid', get: (r) => r.dkimValid },
      { header: 'dkimRecord', get: (r) => r.dkimRecord },
      { header: 'dmarcValid', get: (r) => r.dmarcValid },
      { header: 'dmarcPolicy', get: (r) => r.dmarcPolicy },
      { header: 'dmarcRecord', get: (r) => r.dmarcRecord },
      { header: 'mxRecords', get: (r) => (r.mxRecords ? (JSON.parse(r.mxRecords) as string[]).join(' ') : '') },
    ]);
    return csvResponse(csv, `${owned.domain}-dns-history.csv`);
  }

  return Response.json({
    snapshots: rows.map((r) => ({
      ...r,
      mxRecords: r.mxRecords ? JSON.parse(r.mxRecords) : [],
    })),
  });
}
