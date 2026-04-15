'use client';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import { relativeTime } from '@/lib/alert-display';

const TYPE_COLOR: Record<string, { bg: string; fg: string }> = {
  delivered: { bg: 'var(--green-dim)', fg: 'var(--green)' },
  bounced: { bg: 'var(--red-dim)', fg: 'var(--red)' },
  deferred: { bg: 'var(--amber-dim)', fg: 'var(--amber)' },
  rejected: { bg: 'var(--red-dim)', fg: 'var(--red)' },
  complaint: { bg: 'var(--amber-dim)', fg: 'var(--amber)' },
};

/**
 * Renders the mail-server integrations linked to this domain plus a
 * compact 24h delivery summary from delivery_events. No data → a nudge
 * to connect an integration from /servers/new.
 */
export function DomainIntegrationsWidget({ domainId }: { domainId: string }) {
  const servers = trpc.serverIntegrations.list.useQuery();
  const events = trpc.bounces.deliveryEvents.useQuery({ domainId, limit: 200 });

  const linked = (servers.data ?? []).filter((s) => s.domainId === domainId);
  const rows = events.data ?? [];
  const counts = rows.reduce<Record<string, number>>((m, r) => {
    m[r.type] = (m[r.type] ?? 0) + 1;
    return m;
  }, {});
  const total = rows.length;
  const since24 = Date.now() - 24 * 3600 * 1000;
  const recent = rows.filter((r) => new Date(r.occurredAt).getTime() >= since24);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mail server integrations</CardTitle>
        <CardDescription>Connected adapters + last 24h of delivery events.</CardDescription>
      </CardHeader>
      <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {linked.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>
            No integrations linked to this domain.{' '}
            <Link href="/servers/new" style={{ color: 'var(--blue)' }}>Connect one →</Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {linked.map((s) => (
              <Link key={s.id} href={`/servers/${s.id}`} style={{
                display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 12px',
                border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                textDecoration: 'none', color: 'var(--text)',
              }}>
                <div>
                  <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 500 }}>{s.name}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
                    {s.serverType}
                    {s.baseUrl && <> · {s.baseUrl}</>}
                  </div>
                </div>
                <StatusBadge tone={s.status === 'ok' ? 'healthy' : s.status === 'error' ? 'critical' : 'neutral'}>
                  {s.status ?? 'unknown'}
                </StatusBadge>
              </Link>
            ))}
          </div>
        )}

        {total > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
            {(['delivered', 'bounced', 'deferred', 'rejected', 'complaint'] as const).map((t) => {
              const n = counts[t] ?? 0;
              const color = TYPE_COLOR[t]!;
              return (
                <div key={t} style={{
                  background: color.bg, border: `1px solid ${color.fg}22`,
                  borderRadius: 'var(--radius-sm)', padding: '8px 10px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {t}
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 600, color: color.fg, marginTop: 2 }}>
                    {n}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {recent.length > 0 && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
              Recent events
            </div>
            {recent.slice(0, 8).map((e) => {
              const color = TYPE_COLOR[e.type] ?? { bg: 'var(--surf2)', fg: 'var(--text2)' };
              return (
                <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '0.8fr 1.2fr 2fr 1fr', padding: '4px 0', borderBottom: '1px solid var(--border)', gap: 6 }}>
                  <span style={{ color: color.fg, textTransform: 'uppercase', fontSize: 10 }}>{e.type}</span>
                  <span style={{ color: 'var(--text3)' }}>{e.provider ?? '—'}</span>
                  <span style={{ color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    → {e.toAddress ?? '—'}
                  </span>
                  <span style={{ color: 'var(--text3)' }}>{relativeTime(e.occurredAt)}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
