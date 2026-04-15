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
  const [testingAll, setTestingAll] = useState(false);
  const [lastRun, setLastRun] = useState<{ ok: number; fail: number } | null>(null);

  async function testAll() {
    const rows = list.data ?? [];
    if (rows.length === 0) return;
    setTestingAll(true);
    setLastRun(null);
    let ok = 0, fail = 0;
    for (const r of rows) {
      try { await test.mutateAsync({ id: r.id }); ok += 1; }
      catch { fail += 1; }
    }
    setTestingAll(false);
    setLastRun({ ok, fail });
    await list.refetch();
  }

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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {rows.length > 0 && (
            <Button variant="outline" onClick={() => void testAll()} disabled={testingAll}>
              {testingAll ? `Testing ${rows.length}…` : 'Test all'}
            </Button>
          )}
          <Link href="/servers/new"><Button>+ Add integration</Button></Link>
        </div>
      </div>

      {lastRun && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)',
            background: lastRun.fail > 0 ? 'var(--red-dim)' : 'var(--green-dim)',
            color: lastRun.fail > 0 ? 'var(--red)' : 'var(--green)',
            fontFamily: 'var(--mono)',
            fontSize: 12,
          }}
        >
          Tested {lastRun.ok + lastRun.fail}: {lastRun.ok} ok · {lastRun.fail} failed
        </div>
      )}

      <WebhookSigningPanel />

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

function copyToClipboard(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    void navigator.clipboard.writeText(text);
  }
}

function WebhookSigningPanel() {
  const q = trpc.serverIntegrations.webhookConfig.useQuery();
  const [copied, setCopied] = useState<string | null>(null);

  function copy(value: string, key: string) {
    copyToClipboard(value);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  }

  const rows = q.data ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhook signing</CardTitle>
        <CardDescription>
          Point each provider's event webhook at MxWatch, then set the matching env var on the server so incoming
          webhooks can be verified. Without the env var set, requests are rejected.
        </CardDescription>
      </CardHeader>
      <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((p) => (
          <div
            key={p.provider}
            style={{
              padding: 12,
              background: 'var(--surf2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{p.label}</div>
              <StatusBadge tone={p.configured ? 'healthy' : 'warning'}>
                {p.configured ? 'env set' : 'env missing'}
              </StatusBadge>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, color: 'var(--text3)', minWidth: 70 }}>Webhook URL</span>
              <code style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text)', userSelect: 'all', flex: 1, minWidth: 260 }}>
                {p.path}
              </code>
              <Button size="sm" variant="outline" onClick={() => copy(p.path, `url-${p.provider}`)}>
                {copied === `url-${p.provider}` ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, color: 'var(--text3)', minWidth: 70 }}>Env var</span>
              <code style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text)', userSelect: 'all', flex: 1, minWidth: 260 }}>
                {p.envVar}
              </code>
              <Button size="sm" variant="outline" onClick={() => copy(p.envVar, `env-${p.provider}`)}>
                {copied === `env-${p.provider}` ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{p.envDescription}</div>
          </div>
        ))}
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
