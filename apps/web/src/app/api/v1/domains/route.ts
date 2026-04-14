import { getDb, schema } from '@mxwatch/db';
import { desc, eq } from 'drizzle-orm';
import { authenticateApiRequest, unauthorized } from '@/lib/user-api-auth';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = await authenticateApiRequest(req);
  if (!auth) return unauthorized();
  const rows = await getDb()
    .select({
      id: schema.domains.id,
      domain: schema.domains.domain,
      isActive: schema.domains.isActive,
      addedAt: schema.domains.addedAt,
      notes: schema.domains.notes,
    })
    .from(schema.domains)
    .where(eq(schema.domains.userId, auth.userId))
    .orderBy(desc(schema.domains.addedAt));
  return Response.json({ domains: rows });
}
