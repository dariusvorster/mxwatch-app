'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Period = '1h' | '24h' | '7d' | '30d';

export default function DeliveryRatesPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [period, setPeriod] = useState<Period>('24h');
  const stats = trpc.recipientDomains.crossStats.useQuery({ period }, { enabled: !!session });

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) return <main>Loading…</main>;

  const rows = stats.data ?? [];
  const totalSent = rows.reduce((sum, r) => sum + r.sent, 0);
  const totalDelivered = rows.reduce((sum, r) => sum + r.delivered, 0);
  const overallRate = totalSent > 0 ? ((totalDelivered / totalSent) * 100).toFixed(1) : '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
            Delivery rates
          </h1>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
            Postmaster-Tools-for-everyone — your deliverability across {rows.length} recipient provider{rows.length === 1 ? '' : 's'}
          </div>
        </div>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <Stat label="Total sent" value={totalSent.toLocaleString()} />
        <Stat label="Total delivered" value={totalDelivered.toLocaleString()} />
        <Stat label="Overall rate" value={`${overallRate}%`} tone={
          typeof overallRate === 'string' && overallRate !== '—'
            ? Number(overallRate) >= 95 ? 'green' : Number(overallRate) >= 90 ? 'amber' : 'red'
            : undefined
        } />
      </div>

      <Card>
        <CardHeader><CardTitle>By recipient provider</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div style={{ color: 'var(--text3)', fontSize: 12 }}>
              No data yet. Connect a mail server at <a href="/servers/new" style={{ color: 'var(--blue)' }}>/servers/new</a> and rollups will populate hourly.
            </div>
          ) : (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', padding: '6px 0', color: 'var(--text3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border2)' }}>
                <span>Provider</span><span>Sent</span><span>Delivered</span><span>Deferred</span><span>Bounced</span><span>Rate</span>
              </div>
              {rows.map((r) => {
                const ratePct = r.deliveryRate != null ? (r.deliveryRate / 10).toFixed(1) : '—';
                const rateColor = r.deliveryRate == null ? 'var(--text3)'
                  : r.deliveryRate >= 950 ? 'var(--green)'
                  : r.deliveryRate >= 900 ? 'var(--amber)'
                  : 'var(--red)';
                const flag = r.deliveryRate != null && r.deliveryRate < 950 ? ' ⚠' : '';
                return (
                  <div key={r.recipientDomain}>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ color: 'var(--text)' }}>{r.recipientDomain}</span>
                      <span>{r.sent}</span>
                      <span>{r.delivered}</span>
                      <span>{r.deferred}</span>
                      <span style={{ color: r.bounced > 0 ? 'var(--red)' : 'var(--text2)' }}>{r.bounced}</span>
                      <span style={{ color: rateColor }}>{ratePct}%{flag}</span>
                    </div>
                    {r.lastBounceReason && r.bounced > 0 && (
                      <div style={{ paddingLeft: 12, paddingBottom: 6, fontSize: 10, color: 'var(--text3)' }}>
                        last bounce: {r.lastBounceReason.slice(0, 140)}
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

function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const periods: Period[] = ['1h', '24h', '7d', '30d'];
  return (
    <div style={{ display: 'inline-flex', gap: 3, padding: 3, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
      {periods.map((p) => (
        <button key={p} onClick={() => onChange(p)}
          style={{
            padding: '5px 12px', fontSize: 11, fontFamily: 'var(--mono)', cursor: 'pointer',
            border: 'none', borderRadius: 6,
            background: value === p ? 'var(--surf)' : 'transparent',
            color: value === p ? 'var(--text)' : 'var(--text3)',
            fontWeight: value === p ? 500 : 400,
          }}>{p}</button>
      ))}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'amber' | 'red' }) {
  const color = tone === 'green' ? 'var(--green)' : tone === 'amber' ? 'var(--amber)' : tone === 'red' ? 'var(--red)' : 'var(--text)';
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
