import { getDb, schema } from '@mxwatch/db';
import { sql } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Simple connectivity ping — selects count from a tiny table.
    await getDb().select({ n: sql<number>`1` }).from(schema.users).limit(1);
    return Response.json({ status: 'ok' });
  } catch (e: any) {
    return Response.json({ status: 'error', message: e?.message ?? 'db unreachable' }, { status: 503 });
  }
}
