'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

const SERVER_TYPES = [
  'stalwart', 'mailcow', 'postfix', 'postfix_dovecot', 'mailu', 'maddy', 'haraka', 'exchange',
  'resend', 'postmark', 'mailgun', 'sendgrid', 'ses',
  'unknown',
] as const;
const ARCHITECTURES = ['direct', 'nat_relay', 'split', 'managed'] as const;

export default function NewServerPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const domains = trpc.domains.list.useQuery(undefined, { enabled: !!session });
  const detect = trpc.serverIntegrations.detect.useMutation();
  const create = trpc.serverIntegrations.create.useMutation();
  const test = trpc.serverIntegrations.test.useMutation();

  const [host, setHost] = useState('');
  const [internalHost, setInternalHost] = useState('');
  const [name, setName] = useState('');
  const [serverType, setServerType] = useState<typeof SERVER_TYPES[number]>('unknown');
  const [architecture, setArchitecture] = useState<typeof ARCHITECTURES[number]>('direct');
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [domainId, setDomainId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  async function onDetect() {
    setError(null);
    if (!host.trim()) return setError('Enter a host');
    try {
      const fp = await detect.mutateAsync({ host: host.trim(), internalHost: internalHost.trim() || undefined });
      if (fp.detectedType) setServerType(fp.detectedType);
      if (fp.suggestedArchitecture) setArchitecture(fp.suggestedArchitecture);
      if (fp.apiEndpoint && !baseUrl) setBaseUrl(fp.apiEndpoint);
      if (!name) setName(host.trim());
    } catch (e: any) {
      setError(e?.message ?? 'Detection failed');
    }
  }

  async function onSave() {
    setError(null);
    if (!name.trim()) return setError('Name required');
    try {
      const res = await create.mutateAsync({
        name: name.trim(),
        serverType,
        architecture,
        baseUrl: baseUrl.trim() || undefined,
        token: token.trim() || undefined,
        domainId: domainId || undefined,
        internalHost: internalHost.trim() || undefined,
        autoDetected: !!detect.data,
        detectionConfidence: detect.data?.confidence,
      });
      if (baseUrl.trim() && token.trim()) {
        try { await test.mutateAsync({ id: res.id }); } catch { /* status persisted inside */ }
      }
      router.push(`/servers/${res.id}`);
    } catch (e: any) {
      setError(e?.message ?? 'Save failed');
    }
  }

  if (isPending || !session) return <main>Loading…</main>;
  const fp = detect.data;

  return (
    <div style={{ maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
        Add mail server
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>Step 1 — Detect</CardTitle>
          <CardDescription>Enter the public hostname or IP. We'll probe ports + banner + API endpoints to identify what you're running.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="host">Host</Label>
            <Input id="host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="mail.example.com" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="internalHost">Internal host (NAT relay only)</Label>
            <Input id="internalHost" value={internalHost} onChange={(e) => setInternalHost(e.target.value)} placeholder="10.0.0.5" />
          </div>
          <Button onClick={onDetect} disabled={detect.isPending}>
            {detect.isPending ? 'Scanning…' : 'Run detection'}
          </Button>

          {fp && (
            <div style={{ marginTop: 8, background: 'var(--surf2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 12, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>
              <div><span style={{ color: 'var(--text3)' }}>Detected:</span> <span style={{ color: 'var(--text)' }}>{fp.detectedType ?? 'unknown'}</span> (confidence: {fp.confidence})</div>
              {fp.smtpBanner && <div style={{ marginTop: 4 }}><span style={{ color: 'var(--text3)' }}>Banner:</span> {fp.smtpBanner.slice(0, 100)}</div>}
              <div style={{ marginTop: 4 }}><span style={{ color: 'var(--text3)' }}>Open ports:</span> {fp.openPorts.join(', ') || 'none'}</div>
              {fp.apiEndpoint && <div style={{ marginTop: 4 }}><span style={{ color: 'var(--text3)' }}>API:</span> {fp.apiEndpoint}</div>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Step 2 — Configure</CardTitle>
          <CardDescription>Review + provide API credentials for deep stats. Skip the token to monitor externally only.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Primary mail server" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="space-y-2">
              <Label htmlFor="serverType">Server type</Label>
              <select id="serverType" value={serverType} onChange={(e) => setServerType(e.target.value as any)}
                style={{ width: '100%', padding: '8px 10px', background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--sans)', fontSize: 13 }}>
                {SERVER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="architecture">Architecture</Label>
              <select id="architecture" value={architecture} onChange={(e) => setArchitecture(e.target.value as any)}
                style={{ width: '100%', padding: '8px 10px', background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--sans)', fontSize: 13 }}>
                {ARCHITECTURES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="baseUrl">API base URL</Label>
            <Input id="baseUrl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://mail.example.com" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="token">API token</Label>
            <Input id="token" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="domain">Link to domain (optional)</Label>
            <select id="domain" value={domainId} onChange={(e) => setDomainId(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--sans)', fontSize: 13 }}>
              <option value="">— none —</option>
              {(domains.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.domain}</option>)}
            </select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={onSave} disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Save + test'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
