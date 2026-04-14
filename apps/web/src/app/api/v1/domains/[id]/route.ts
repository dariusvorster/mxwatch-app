import { getDb, schema } from '@mxwatch/db';
import { and, desc, eq } from 'drizzle-orm';
import { authenticateApiRequest, unauthorized } from '@/lib/user-api-auth';

export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiRequest(req);
  if (!auth) return unauthorized();
  const { id } = await params;
  const db = getDb();

  const [domain] = await db
    .select()
    .from(schema.domains)
    .where(and(eq(schema.domains.id, id), eq(schema.domains.userId, auth.userId)))
    .limit(1);
  if (!domain) return Response.json({ error: 'Not found' }, { status: 404 });

  const [snap] = await db
    .select()
    .from(schema.dnsSnapshots)
    .where(eq(schema.dnsSnapshots.domainId, id))
    .orderBy(desc(schema.dnsSnapshots.checkedAt))
    .limit(1);

  const selectors = await db
    .select()
    .from(schema.dkimSelectors)
    .where(eq(schema.dkimSelectors.domainId, id));

  return Response.json({
    domain: {
      id: domain.id,
      domain: domain.domain,
      isActive: domain.isActive,
      addedAt: domain.addedAt,
      notes: domain.notes,
    },
    dkimSelectors: selectors.map((s) => s.selector),
    latestSnapshot: snap ? {
      checkedAt: snap.checkedAt,
      healthScore: snap.healthScore,
      spfValid: snap.spfValid,
      spfRecord: snap.spfRecord,
      spfLookupCount: snap.spfLookupCount,
      dkimValid: snap.dkimValid,
      dkimSelector: snap.dkimSelector,
      dkimRecord: snap.dkimRecord,
      dmarcValid: snap.dmarcValid,
      dmarcPolicy: snap.dmarcPolicy,
      dmarcRecord: snap.dmarcRecord,
      mxRecords: snap.mxRecords ? JSON.parse(snap.mxRecords) : [],
    } : null,
  });
}
