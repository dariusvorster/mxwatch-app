import { getDb, schema } from '@mxwatch/db';
import { eq, desc } from 'drizzle-orm';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

async function getStatusData(token: string) {
  const db = getDb();

  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.statusToken, token))
    .limit(1);

  if (!user) return null;

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
        smtpConnected: smtp?.connected ?? null,
        checkedAt: dns?.checkedAt ?? null,
      };
    }),
  );

  return domainData;
}

function scoreColor(score: number | null) {
  if (score === null) return 'var(--text3)';
  if (score >= 80) return 'var(--green)';
  if (score >= 60) return 'var(--amber)';
  return 'var(--red)';
}

function scoreBg(score: number | null) {
  if (score === null) return 'var(--surf2)';
  if (score >= 80) return 'var(--green-dim)';
  if (score >= 60) return 'var(--amber-dim)';
  return 'var(--red-dim)';
}

function Check({ ok, label }: { ok: boolean | null; label: string }) {
  const color = ok === null ? 'var(--text3)' : ok ? 'var(--green)' : 'var(--red)';
  const bg = ok === null ? 'var(--surf2)' : ok ? 'var(--green-dim)' : 'var(--red-dim)';
  const symbol = ok === null ? '?' : ok ? '✓' : '✗';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600,
      padding: '3px 8px', borderRadius: 6,
      background: bg, color,
    }}>
      {symbol} {label}
    </span>
  );
}

export default async function StatusPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const domains = await getStatusData(token);
  if (!domains) notFound();

  const allHealthy = domains.every((d) => (d.score ?? 0) >= 80 && !d.rblListed);
  const issueCount = domains.filter((d) => (d.score ?? 0) < 80 || d.rblListed).length;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '48px 24px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <svg width="28" height="28" viewBox="0 0 64 64" fill="none">
              <rect width="64" height="64" rx="14" fill="#185FA5"/>
              <path d="M12 38 L22 24 L32 34 L42 20 L52 38" stroke="#E6F1FB" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
              mx<span style={{ color: 'var(--blue)' }}>watch</span>
            </span>
          </div>
          <h1 style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
            Email infrastructure status
          </h1>
          <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '6px 14px', borderRadius: 99,
            background: allHealthy ? 'var(--green-dim)' : 'var(--amber-dim)',
            border: `1px solid ${allHealthy ? 'var(--green-border)' : 'var(--amber-border)'}`,
            fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 500,
            color: allHealthy ? 'var(--green)' : 'var(--amber)',
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
            {allHealthy
              ? `All ${domains.length} domain${domains.length !== 1 ? 's' : ''} healthy`
              : `${issueCount} domain${issueCount !== 1 ? 's' : ''} with issues`}
          </div>
        </div>

        {/* Domain cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {domains.map((d) => (
            <div key={d.id} style={{
              background: 'var(--surf)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '16px 20px',
              borderLeft: `3px solid ${d.rblListed || (d.score !== null && d.score < 60) ? 'var(--red)' : (d.score !== null && d.score < 80) ? 'var(--amber)' : 'var(--green)'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                  {d.domain}
                </span>
                {d.score !== null && (
                  <span style={{
                    fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700,
                    padding: '4px 12px', borderRadius: 8,
                    background: scoreBg(d.score), color: scoreColor(d.score),
                  }}>
                    {d.score}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                <Check ok={d.spfValid} label="SPF" />
                <Check ok={d.dkimValid} label="DKIM" />
                <Check ok={d.dmarcValid} label="DMARC" />
                <Check ok={d.smtpConnected} label="SMTP" />
                <Check ok={!d.rblListed} label="RBL clean" />
              </div>
              {d.checkedAt && (
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginTop: 8 }}>
                  Last checked {new Date(d.checkedAt).toUTCString()}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ marginTop: 40, textAlign: 'center', fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--text3)' }}>
          Monitored by{' '}
          <span style={{ fontFamily: 'var(--mono)', color: 'var(--blue)' }}>MxWatch</span>
          {' · '}
          Updated {new Date().toUTCString()}
        </div>
      </div>
    </div>
  );
}
