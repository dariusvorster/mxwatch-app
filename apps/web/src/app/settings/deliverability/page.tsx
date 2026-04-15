'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { relativeTime } from '@/lib/alert-display';

const MODE_LABEL: Record<string, string> = {
  own_domain: 'Own domain inbox',
  stalwart_relay: 'Stalwart relay',
  manual: 'Manual header paste',
  cloud: 'Cloud (*@inbox.mxwatch.app)',
};

export default function DeliverabilitySettingsPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  useEffect(() => { if (!isPending && !session) router.push('/login'); }, [isPending, session, router]);

  const config = trpc.inboxSetup.getConfig.useQuery(undefined, { enabled: !!session });
  const stalwart = trpc.inboxSetup.stalwartScript.useQuery(undefined, {
    enabled: !!session && config.data?.mode === 'stalwart_relay',
  });
  const history = trpc.deliverability.history.useQuery({ limit: 10 }, { enabled: !!session });

  if (isPending || !session) return <main>Loading…</main>;
  const c = config.data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 760 }}>
      <div>
        <h1 style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
          Deliverability inbox
        </h1>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
          Which inbox mode MxWatch uses to receive your deliverability test emails.
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Current configuration</CardTitle></CardHeader>
        <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!c ? (
            <>
              <div style={{ fontSize: 13, color: 'var(--text3)' }}>Not configured yet.</div>
              <Link href="/setup/inbox"><Button>Run the inbox setup wizard</Button></Link>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ fontFamily: 'var(--sans)', fontSize: 14, fontWeight: 500 }}>
                  {MODE_LABEL[c.mode] ?? c.mode}
                </div>
                {c.verified
                  ? <StatusBadge tone="healthy">verified</StatusBadge>
                  : <StatusBadge tone="warning">not verified</StatusBadge>}
              </div>
              {c.mode === 'own_domain' && c.inboxDomain && (
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
                  Inbox domain: <span style={{ color: 'var(--text)' }}>{c.inboxDomain}</span>
                </div>
              )}
              {c.mode === 'stalwart_relay' && c.stalwartCatchallAddress && (
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
                  Catchall: <span style={{ color: 'var(--text)' }}>{c.stalwartCatchallAddress}</span>
                </div>
              )}
              {c.verifiedAt && (
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
                  Verified {relativeTime(c.verifiedAt)}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <Link href="/setup/inbox"><Button variant="outline">Change mode / re-run wizard</Button></Link>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {stalwart.data?.script && (
        <Card>
          <CardHeader>
            <CardTitle>Sieve script</CardTitle>
            <CardDescription>If your Stalwart admin API didn't accept the auto-upload, paste this into the Sieve editor.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre style={{
              fontFamily: 'var(--mono)', fontSize: 11, padding: 10,
              background: 'var(--surf2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              whiteSpace: 'pre-wrap', userSelect: 'all',
            }}>{stalwart.data.script}</pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent tests</CardTitle>
          <CardDescription>Last 10 deliverability tests across all modes.</CardDescription>
        </CardHeader>
        <CardContent>
          {(history.data?.length ?? 0) === 0 ? (
            <div style={{ color: 'var(--text3)', fontSize: 12 }}>No tests yet.</div>
          ) : (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
              {(history.data ?? []).map((h: any) => (
                <div key={h.id} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1.5fr 1fr', padding: '6px 0', borderBottom: '1px solid var(--border)', gap: 8 }}>
                  <span style={{ color: h.scoreOutOf10 != null && h.scoreOutOf10 >= 8 ? 'var(--green)' : h.scoreOutOf10 != null && h.scoreOutOf10 >= 6 ? 'var(--amber)' : 'var(--red)' }}>
                    {h.scoreOutOf10 != null ? `${h.scoreOutOf10.toFixed(1)} / 10` : '—'}
                  </span>
                  <span style={{ color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {h.subject ?? '—'}
                  </span>
                  <span style={{ color: 'var(--text3)' }}>
                    {h.inboxMode ?? h.sendingMode ?? '—'}
                  </span>
                  <span style={{ color: 'var(--text3)' }}>{relativeTime(h.createdAt)}</span>
                </div>
              ))}
              <div style={{ marginTop: 10 }}>
                <Link href="/tools/deliverability" style={{ color: 'var(--blue)', fontSize: 12 }}>View all tests →</Link>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
