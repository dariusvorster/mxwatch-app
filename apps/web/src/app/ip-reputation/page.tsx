'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import { relativeTime } from '@/lib/alert-display';

function tone(score: number | null): { color: string; label: 'healthy' | 'warning' | 'critical' | 'neutral' } {
  if (score == null) return { color: 'var(--text3)', label: 'neutral' };
  if (score >= 90) return { color: 'var(--green)', label: 'healthy' };
  if (score >= 70) return { color: 'var(--amber)', label: 'warning' };
  return { color: 'var(--red)', label: 'critical' };
}

export default function IpReputationPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const summary = trpc.ipReputation.summary.useQuery(undefined, { enabled: !!session });

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) return <main>Loading…</main>;

  const rows = summary.data ?? [];
  const totalListed = rows.reduce((sum, r) => sum + r.listedCount, 0);
  const problemCount = rows.filter((r) => r.listedCount > 0).length;
  const healthyCount = rows.filter((r) => r.listedCount === 0 && r.score != null).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h1 style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
          IP reputation
        </h1>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
          Latest blacklist snapshot per domain · {rows.length} domain{rows.length === 1 ? '' : 's'}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <Stat label="Domains clean" value={healthyCount} tone={healthyCount === rows.length && rows.length > 0 ? 'green' : undefined} />
        <Stat label="Domains with listings" value={problemCount} tone={problemCount > 0 ? 'red' : undefined} />
        <Stat label="Total RBL listings" value={totalListed} tone={totalListed > 0 ? 'red' : 'green'} />
      </div>

      <Card>
        <CardHeader><CardTitle>Reputation snapshot</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div style={{ color: 'var(--text3)', fontSize: 12 }}>No domains yet.</div>
          ) : (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 0.8fr 0.8fr 1fr 1fr', padding: '6px 0', color: 'var(--text3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border2)' }}>
                <span>Domain</span><span>IP</span><span>Score</span><span>Listed</span><span>Status</span><span>Checked</span>
              </div>
              {rows.map((r) => {
                const t = tone(r.score);
                return (
                  <div key={r.domainId} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 0.8fr 0.8fr 1fr 1fr', alignItems: 'center', gap: 6 }}>
                      <Link href={`/domains/${r.domainId}`} style={{ color: 'var(--blue)', textDecoration: 'underline' }}>{r.domain}</Link>
                      <span style={{ color: 'var(--text2)' }}>{r.ip ?? '—'}</span>
                      <span style={{ color: t.color, fontWeight: 600 }}>{r.score ?? '—'}</span>
                      <span style={{ color: r.listedCount > 0 ? 'var(--red)' : 'var(--text2)' }}>{r.listedCount}</span>
                      <StatusBadge tone={t.label}>{t.label}</StatusBadge>
                      <span style={{ color: 'var(--text3)' }}>{r.checkedAt ? relativeTime(r.checkedAt) : '—'}</span>
                    </div>
                    {r.listedCount > 0 && (
                      <div style={{ paddingLeft: 4, marginTop: 4, color: 'var(--red)', fontSize: 10 }}>
                        on: {r.listedOn.join(', ')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'red' }) {
  const color = tone === 'green' ? 'var(--green)' : tone === 'red' ? 'var(--red)' : 'var(--text)';
  return (
    <Card>
      <CardContent style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 9, fontFamily: 'var(--sans)', fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {label}
        </div>
        <div style={{ fontSize: 22, fontWeight: 600, color, marginTop: 6, fontFamily: 'var(--mono)' }}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
