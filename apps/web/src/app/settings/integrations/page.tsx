'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/status-badge';
import { relativeTime } from '@/lib/alert-display';

const CLOUD_PROVIDERS = new Set(['resend', 'postmark', 'mailgun', 'sendgrid']);

export default function IntegrationsSettingsPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  useEffect(() => { if (!isPending && !session) router.push('/login'); }, [isPending, session, router]);

  const list = trpc.serverIntegrations.list.useQuery(undefined, { enabled: !!session });
  const test = trpc.serverIntegrations.test.useMutation({ onSuccess: () => list.refetch() });
  const remove = trpc.serverIntegrations.remove.useMutation({ onSuccess: () => list.refetch() });

  if (isPending || !session) return <main>Loading…</main>;

  const rows = list.data ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 860 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
            Integrations
          </h1>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
            Every mail-server + cloud-provider adapter MxWatch is connected to.
          </div>
        </div>
        <Link href="/servers/new"><Button>+ Add integration</Button></Link>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent style={{ padding: 22, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
            No integrations yet.{' '}
            <Link href="/servers/new" style={{ color: 'var(--blue)', fontWeight: 500 }}>Connect your first</Link>.
          </CardContent>
        </Card>
      ) : (
        rows.map((r) => (
          <IntegrationCard
            key={r.id}
            row={r}
            onTest={() => test.mutate({ id: r.id })}
            testing={test.isPending && test.variables?.id === r.id}
            onRemove={async () => {
              if (!confirm(`Remove "${r.name}"?`)) return;
              await remove.mutateAsync({ id: r.id });
            }}
          />
        ))
      )}
    </div>
  );
}

import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@/server/routers/_app';
type Row = inferRouterOutputs<AppRouter>['serverIntegrations']['list'][number];

function IntegrationCard({ row, onTest, testing, onRemove }: {
  row: Row;
  onTest: () => void;
  testing: boolean;
  onRemove: () => void | Promise<void>;
}) {
  const isCloud = CLOUD_PROVIDERS.has(row.serverType);
  const tone = row.status === 'ok' ? 'healthy' : row.status === 'error' ? 'critical' : 'neutral';

  return (
    <Card>
      <CardHeader>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div>
            <CardTitle>{row.name}</CardTitle>
            <CardDescription>
              {row.serverType} · {row.architecture}
              {row.baseUrl && <> · <span style={{ fontFamily: 'var(--mono)' }}>{row.baseUrl}</span></>}
            </CardDescription>
          </div>
          <StatusBadge tone={tone}>{row.status ?? 'unknown'}</StatusBadge>
        </div>
      </CardHeader>
      <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {row.lastError && <p style={{ color: 'var(--red)', fontSize: 12, fontFamily: 'var(--mono)' }}>{row.lastError}</p>}
        {row.lastPulledAt && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
            Last pulled {relativeTime(row.lastPulledAt)}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button size="sm" variant="outline" onClick={onTest} disabled={testing}>
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
          <Link href={`/servers/${row.id}`}><Button size="sm" variant="outline">Open</Button></Link>
          <Button size="sm" variant="ghost" onClick={() => void onRemove()}>Remove</Button>
        </div>
        {isCloud && <RelayInboxPanel integrationId={row.id} />}
      </CardContent>
    </Card>
  );
}

function RelayInboxPanel({ integrationId }: { integrationId: string }) {
  const setup = trpc.serverIntegrations.setupRelayInbox.useMutation();
  const [domain, setDomain] = useState('');
  const [result, setResult] = useState<Awaited<ReturnType<typeof setup.mutateAsync>> | null>(null);

  return (
    <div style={{
      padding: 12, background: 'var(--surf2)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ fontSize: 12, fontWeight: 500 }}>Relay inbox for deliverability tests</div>
      <p style={{ fontSize: 11, color: 'var(--text3)' }}>
        Provision a provider-side route so <code>mxwatch-test-*@your-domain</code> forwards to MxWatch.
        Needs an already-verified sending domain on the provider.
      </p>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <Label htmlFor={`dom-${integrationId}`}>Inbound domain</Label>
          <Input id={`dom-${integrationId}`} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
        </div>
        <Button size="sm" onClick={async () => {
          setResult(null);
          try {
            const r = await setup.mutateAsync({ id: integrationId, inboundDomain: domain.trim() });
            setResult(r);
          } catch (e: any) {
            setResult({ ok: false, catchallAddressPattern: '', webhookUrl: '', webhookSecret: '', message: e?.message ?? 'Failed' } as any);
          }
        }} disabled={!domain.trim() || setup.isPending}>
          {setup.isPending ? 'Configuring…' : 'Set up relay'}
        </Button>
      </div>
      {result && (
        <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: result.ok ? 'var(--green)' : 'var(--amber)' }}>
          {result.ok ? '✓' : '⚠'} {result.message}
          {result.catchallAddressPattern && (
            <div style={{ marginTop: 4 }}>
              Send test mail to: <span style={{ color: 'var(--text)' }}>{result.catchallAddressPattern}</span>
            </div>
          )}
          {(result as any).setupInstructions && (
            <div style={{ marginTop: 4, color: 'var(--text2)' }}>{(result as any).setupInstructions}</div>
          )}
          {result.webhookUrl && (
            <div style={{ marginTop: 4, color: 'var(--text3)' }}>
              Webhook URL: <span style={{ color: 'var(--text)', userSelect: 'all' }}>{result.webhookUrl}</span>
            </div>
          )}
          {result.webhookSecret && (
            <div style={{ marginTop: 4, color: 'var(--text3)' }}>
              Secret (save now): <span style={{ color: 'var(--text)', userSelect: 'all' }}>{result.webhookSecret}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
