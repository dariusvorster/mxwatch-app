'use client';
import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import { relativeTime } from '@/lib/alert-display';

type Tab = 'overview' | 'queue' | 'auth' | 'bounces' | 'delivery';

export default function ServerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [tab, setTab] = useState<Tab>('overview');

  const server = trpc.serverIntegrations.get.useQuery({ id }, { enabled: !!session });
  const testMut = trpc.serverIntegrations.test.useMutation({ onSuccess: () => server.refetch() });
  const removeMut = trpc.serverIntegrations.remove.useMutation();

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session || !server.data) return <main>Loading…</main>;
  const s = server.data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 600, color: 'var(--text)' }}>{s.name}</h1>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
            {s.serverType} · {s.architecture} · {s.baseUrl ?? 'no API'}
          </div>
          {s.lastPulledAt && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
              last pulled {relativeTime(s.lastPulledAt)}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="outline" onClick={() => testMut.mutate({ id })} disabled={testMut.isPending}>
            {testMut.isPending ? 'Testing…' : 'Test'}
          </Button>
          <Button variant="outline" onClick={async () => {
            if (!confirm(`Remove "${s.name}"?`)) return;
            await removeMut.mutateAsync({ id });
            router.push('/servers');
          }}>Remove</Button>
        </div>
      </div>

      {s.lastError && (
        <Card>
          <CardContent style={{ padding: 12, fontSize: 12, color: 'var(--red)' }}>{s.lastError}</CardContent>
        </Card>
      )}

      <TabBar tab={tab} onChange={setTab} />

      {tab === 'overview' && <OverviewTab id={id} />}
      {tab === 'queue' && <QueueTab id={id} />}
      {tab === 'auth' && <AuthTab id={id} />}
      {tab === 'bounces' && <BouncesTab domainId={s.domainId} />}
      {tab === 'delivery' && <DeliveryTab domainId={s.domainId} />}
    </div>
  );
}

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'queue', label: 'Queue' },
    { key: 'auth', label: 'Auth failures' },
    { key: 'bounces', label: 'Bounces' },
    { key: 'delivery', label: 'Delivery rates' },
  ];
  return (
    <div style={{ display: 'inline-flex', gap: 3, padding: 3, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          style={{
            padding: '6px 14px', fontSize: 12, fontFamily: 'var(--sans)', cursor: 'pointer',
            border: 'none', borderRadius: 6,
            background: tab === t.key ? 'var(--surf)' : 'transparent',
            color: tab === t.key ? 'var(--text)' : 'var(--text3)',
            boxShadow: tab === t.key ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
            fontWeight: tab === t.key ? 500 : 400,
          }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function OverviewTab({ id }: { id: string }) {
  const queue = trpc.queue.current.useQuery({ integrationId: id });
  return (
    <Card>
      <CardHeader><CardTitle>Snapshot</CardTitle></CardHeader>
      <CardContent>
        {queue.data ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, fontFamily: 'var(--mono)' }}>
            <Stat label="Queue total" value={queue.data.total} />
            <Stat label="Active" value={queue.data.active} />
            <Stat label="Deferred" value={queue.data.deferred} />
            <Stat label="Failed" value={queue.data.failed} tone={queue.data.failed > 0 ? 'red' : undefined} />
          </div>
        ) : (
          <div style={{ color: 'var(--text3)', fontSize: 12 }}>No snapshot yet — stats pull runs every 60s.</div>
        )}
      </CardContent>
    </Card>
  );
}

function QueueTab({ id }: { id: string }) {
  const history = trpc.queue.history.useQuery({ integrationId: id, hours: 24 });
  return (
    <Card>
      <CardHeader><CardTitle>Queue depth — last 24h</CardTitle></CardHeader>
      <CardContent>
        {(history.data?.length ?? 0) === 0 ? (
          <div style={{ color: 'var(--text3)', fontSize: 12 }}>No history yet.</div>
        ) : (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
            {(history.data ?? []).slice(-12).map((r) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--text3)' }}>{relativeTime(r.recordedAt)}</span>
                <span>{r.total} total, {r.failed} failed</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AuthTab({ id }: { id: string }) {
  const byIp = trpc.authFailures.byIp.useQuery({ integrationId: id, hours: 24 });
  return (
    <Card>
      <CardHeader><CardTitle>Top failing IPs — last 24h</CardTitle></CardHeader>
      <CardContent>
        {(byIp.data?.length ?? 0) === 0 ? (
          <div style={{ color: 'var(--text3)', fontSize: 12 }}>No auth failures recorded.</div>
        ) : (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
            {(byIp.data ?? []).map((r) => (
              <div key={r.ip} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span>{r.ip}</span>
                <span style={{ color: r.attempts > 10 ? 'var(--red)' : 'var(--text2)' }}>
                  {r.attempts} attempts · last {relativeTime(r.lastSeen)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BouncesTab({ domainId }: { domainId: string | null }) {
  const list = trpc.bounces.list.useQuery({ domainId: domainId ?? undefined, limit: 50 }, { enabled: !!domainId });
  if (!domainId) return <Card><CardContent style={{ color: 'var(--text3)', fontSize: 12, padding: 16 }}>Link this server to a domain to see bounces.</CardContent></Card>;
  return (
    <Card>
      <CardHeader><CardTitle>Recent bounces</CardTitle></CardHeader>
      <CardContent>
        {(list.data?.length ?? 0) === 0 ? (
          <div style={{ color: 'var(--text3)', fontSize: 12 }}>No bounces yet.</div>
        ) : (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
            {(list.data ?? []).map((b) => (
              <div key={b.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{b.recipientDomain} · {b.errorCode}</span>
                  <span style={{ color: 'var(--text3)' }}>{relativeTime(b.timestamp)}</span>
                </div>
                <div style={{ color: 'var(--text3)', fontSize: 10, marginTop: 2 }}>{b.errorMessage?.slice(0, 140)}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DeliveryTab({ domainId }: { domainId: string | null }) {
  const stats = trpc.recipientDomains.stats.useQuery({ domainId: domainId ?? '', period: '24h' }, { enabled: !!domainId });
  if (!domainId) return <Card><CardContent style={{ color: 'var(--text3)', fontSize: 12, padding: 16 }}>Link this server to a domain to see delivery stats.</CardContent></Card>;
  return (
    <Card>
      <CardHeader><CardTitle>Delivery rates — last 24h</CardTitle></CardHeader>
      <CardContent>
        {(stats.data?.length ?? 0) === 0 ? (
          <div style={{ color: 'var(--text3)', fontSize: 12 }}>No data yet — rollups run hourly.</div>
        ) : (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', padding: '4px 0', color: 'var(--text3)', fontSize: 10, textTransform: 'uppercase' }}>
              <span>Provider</span><span>Sent</span><span>Delivered</span><span>Deferred</span><span>Bounced</span><span>Rate</span>
            </div>
            {(stats.data ?? []).map((r) => {
              const rate = ((r.deliveryRate ?? 0) / 10).toFixed(1);
              const rateColor = (r.deliveryRate ?? 0) >= 950 ? 'var(--green)' : (r.deliveryRate ?? 0) >= 900 ? 'var(--amber)' : 'var(--red)';
              return (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--text)' }}>{r.recipientDomain}</span>
                  <span>{r.sent}</span>
                  <span>{r.delivered}</span>
                  <span>{r.deferred}</span>
                  <span>{r.bounced}</span>
                  <span style={{ color: rateColor }}>{rate}%</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'red' }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontFamily: 'var(--sans)', fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 600, color: tone === 'red' ? 'var(--red)' : 'var(--text)', marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}
