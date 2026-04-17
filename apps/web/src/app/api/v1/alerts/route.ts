export const dynamic = 'force-dynamic';

import { getDb, schema } from '@mxwatch/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { authenticateApiRequest, unauthorized } from '@/lib/user-api-auth';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = await authenticateApiRequest(req);
  if (!auth) return unauthorized();
  const url = new URL(req.url);
  const onlyActive = url.searchParams.get('onlyActive') === '1';

  const db = getDb();
  const conditions = [eq(schema.domains.userId, auth.userId)];
  if (onlyActive) conditions.push(isNull(schema.alertHistory.resolvedAt));

  const rows = await db
    .select({
      id: schema.alertHistory.id,
      domainId: schema.alertHistory.domainId,
      domainName: schema.domains.domain,
      type: schema.alertHistory.type,
      message: schema.alertHistory.message,
      firedAt: schema.alertHistory.firedAt,
      resolvedAt: schema.alertHistory.resolvedAt,
    })
    .from(schema.alertHistory)
    .innerJoin(schema.domains, eq(schema.alertHistory.domainId, schema.domains.id))
    .where(and(...conditions))
    .orderBy(desc(schema.alertHistory.firedAt))
    .limit(200);

  return Response.json({ alerts: rows });
}
