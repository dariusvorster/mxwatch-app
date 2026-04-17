import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@mxwatch/db';
import { eq, desc } from 'drizzle-orm';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const db = getDb();

  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.statusToken, token))
    .limit(1);

  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const domains = await db
    .select({ id: schema.domains.id, domain: schema.domains.domain })
    .from(schema.domains)
    .where(eq(schema.domains.userId, user.id));

  const domainData = await Promise.all(
    domains.map(async (d) => {
      const [dns] = await db
        .select()
        .from(schema.dnsSnapshots)
        .where(eq(schema.dnsSnapshots.domainId, d.id))
        .orderBy(desc(schema.dnsSnapshots.checkedAt))
        .limit(1);

      const [rbl] = await db
        .select()
        .from(schema.blacklistChecks)
        .where(eq(schema.blacklistChecks.domainId, d.id))
        .orderBy(desc(schema.blacklistChecks.checkedAt))
        .limit(1);

      const [smtp] = await db
        .select()
        .from(schema.smtpChecks)
        .where(eq(schema.smtpChecks.domainId, d.id))
        .orderBy(desc(schema.smtpChecks.checkedAt))
        .limit(1);

      return {
        id: d.id,
        domain: d.domain,
        score: dns?.healthScore ?? null,
        spfValid: dns?.spfValid ?? null,
        dkimValid: dns?.dkimValid ?? null,
        dmarcPolicy: dns?.dmarcPolicy ?? null,
        dmarcValid: dns?.dmarcValid ?? null,
        rblListed: rbl?.isListed ?? false,
        rblListedOn: rbl?.listedOn ?? null,
        smtpConnected: smtp?.connected ?? null,
        smtpTlsAuthorized: smtp?.tlsAuthorized ?? null,
        checkedAt: dns?.checkedAt ?? null,
      };
    }),
  );

  return NextResponse.json(
    { domains: domainData, generatedAt: new Date().toISOString() },
    { headers: { 'Cache-Control': 'public, max-age=300' } },
  );
}
