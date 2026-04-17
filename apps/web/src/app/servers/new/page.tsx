'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

type ServerType =
  | 'stalwart' | 'mailcow' | 'postfix' | 'postfix_dovecot' | 'mailu' | 'maddy'
  | 'haraka' | 'exchange' | 'miab' | 'postal' | 'modoboa' | 'exim' | 'zimbra'
  | 'dovecot' | 'hmailserver'
  | 'resend' | 'postmark' | 'mailgun' | 'sendgrid' | 'ses'
  | 'brevo' | 'sparkpost' | 'mandrill' | 'mailjet' | 'zoho'
  | 'unknown';

const ARCHITECTURES = ['direct', 'nat_relay', 'split', 'managed'] as const;

interface Platform {
  type: ServerType;
  label: string;
  description: string;
  color: string;
  initials: string;
  apiSupport: boolean;
}

const PLATFORMS: { group: string; items: Platform[] }[] = [
  {
    group: 'Self-hosted mail servers',
    items: [
      { type: 'stalwart',       label: 'Stalwart',          description: 'Rust-based all-in-one mail server with REST API',    color: '#185FA5', initials: 'SW', apiSupport: true  },
      { type: 'mailcow',        label: 'Mailcow',           description: 'Docker-based mail stack (Postfix + Dovecot + SOGo)', color: '#4A9EFF', initials: 'MC', apiSupport: true  },
      { type: 'postfix',        label: 'Postfix',           description: 'Battle-tested Unix MTA, industry standard',          color: '#854F0B', initials: 'PF', apiSupport: false },
      { type: 'postfix_dovecot',label: 'Postfix + Dovecot', description: 'Postfix MTA with Dovecot IMAP/POP3',                 color: '#854F0B', initials: 'PD', apiSupport: false },
      { type: 'exim',           label: 'Exim',              description: 'Flexible MTA common on cPanel servers',              color: '#0F6E56', initials: 'EX', apiSupport: false },
      { type: 'dovecot',        label: 'Dovecot',           description: 'IMAP/POP3 server, often paired with Postfix',        color: '#378ADD', initials: 'DV', apiSupport: false },
      { type: 'mailu',          label: 'Mailu',             description: 'Simple Docker mail server with web UI',              color: '#185FA5', initials: 'ML', apiSupport: true  },
      { type: 'maddy',          label: 'Maddy',             description: 'Composable all-in-one mail server in Go',            color: '#4A9EFF', initials: 'MD', apiSupport: false },
      { type: 'haraka',         label: 'Haraka',            description: 'High-performance Node.js SMTP server',               color: '#0F6E56', initials: 'HK', apiSupport: false },
      { type: 'miab',           label: 'Mail-in-a-Box',     description: 'Turn-key self-hosted email for individuals',         color: '#185FA5', initials: 'MB', apiSupport: true  },
      { type: 'postal',         label: 'Postal',            description: 'Open source mail delivery platform with dashboard',  color: '#A32D2D', initials: 'PS', apiSupport: true  },
      { type: 'modoboa',        label: 'Modoboa',           description: 'Django-based mail hosting platform',                 color: '#0F6E56', initials: 'MO', apiSupport: true  },
      { type: 'zimbra',         label: 'Zimbra',            description: 'Enterprise collaboration + email suite',             color: '#854F0B', initials: 'ZM', apiSupport: true  },
      { type: 'hmailserver',    label: 'hMailServer',       description: 'Free Windows-based email server',                    color: '#4A5568', initials: 'HM', apiSupport: false },
      { type: 'exchange',       label: 'Exchange',          description: 'Microsoft Exchange Server / Exchange Online',        color: '#185FA5', initials: 'EX', apiSupport: true  },
    ],
  },
  {
    group: 'Cloud email providers',
    items: [
      { type: 'resend',     label: 'Resend',      description: 'Developer-first transactional email API',              color: '#0D1117', initials: 'RS', apiSupport: true },
      { type: 'postmark',   label: 'Postmark',    description: 'Fast, reliable transactional email delivery',          color: '#FFCE44', initials: 'PM', apiSupport: true },
      { type: 'mailgun',    label: 'Mailgun',     description: 'Email API service for developers by Sinch',            color: '#F55A5A', initials: 'MG', apiSupport: true },
      { type: 'sendgrid',   label: 'SendGrid',    description: 'Twilio SendGrid — high-volume email delivery',         color: '#1A82E2', initials: 'SG', apiSupport: true },
      { type: 'ses',        label: 'Amazon SES',  description: 'AWS Simple Email Service',                             color: '#FF9900', initials: 'SE', apiSupport: true },
      { type: 'brevo',      label: 'Brevo',       description: 'Formerly Sendinblue — marketing + transactional',     color: '#0B996E', initials: 'BV', apiSupport: true },
      { type: 'sparkpost',  label: 'SparkPost',   description: 'Bird (SparkPost) email delivery platform',             color: '#FA6423', initials: 'SP', apiSupport: true },
      { type: 'mandrill',   label: 'Mandrill',    description: 'Mailchimp Transactional Email (formerly Mandrill)',    color: '#FFE01B', initials: 'MC', apiSupport: true },
      { type: 'mailjet',    label: 'Mailjet',     description: 'Email delivery by Sinch — EU-hosted option',          color: '#6CC4F5', initials: 'MJ', apiSupport: true },
      { type: 'zoho',       label: 'Zoho Mail',   description: 'Zoho Mail for business — GDPR-friendly',              color: '#E42527', initials: 'ZO', apiSupport: true },
    ],
  },
  {
    group: 'Other',
    items: [
      { type: 'unknown', label: 'Other / Unknown', description: 'Manual configuration — monitor externally only', color: '#8892A4', initials: '?', apiSupport: false },
    ],
  },
];

function PlatformCard({ platform, selected, onClick }: { platform: Platform; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left',
        padding: '10px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
        background: selected ? 'var(--blue-dim)' : 'var(--surf)',
        border: `1px solid ${selected ? 'var(--blue-border)' : 'var(--border)'}`,
        transition: 'border-color 120ms, background 120ms',
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 7, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: platform.color, color: '#fff',
        fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
      }}>
        {platform.initials}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 600, color: selected ? 'var(--blue)' : 'var(--text)' }}>
          {platform.label}
        </div>
        <div style={{ fontFamily: 'var(--sans)', fontSize: 11, color: 'var(--text3)', marginTop: 2, lineHeight: 1.35 }}>
          {platform.description}
        </div>
        {platform.apiSupport && (
          <span style={{
            display: 'inline-block', marginTop: 4,
            fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 600,
            padding: '1px 5px', borderRadius: 4,
            background: 'var(--green-dim)', color: 'var(--green)',
            border: '1px solid var(--green-border)',
          }}>
            API
          </span>
        )}
      </div>
    </button>
  );
}

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
  const [serverType, setServerType] = useState<ServerType>('unknown');
  const [architecture, setArchitecture] = useState<typeof ARCHITECTURES[number]>('direct');
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [domainId, setDomainId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  async function onDetect() {
    setError(null);
    if (!host.trim()) return setError('Enter a host');
    try {
      const fp = await detect.mutateAsync({ host: host.trim(), internalHost: internalHost.trim() || undefined });
      if (fp.detectedType) setServerType(fp.detectedType as ServerType);
      if (fp.suggestedArchitecture) setArchitecture(fp.suggestedArchitecture);
      if (fp.apiEndpoint && !baseUrl) setBaseUrl(fp.apiEndpoint);
      if (!name) setName(host.trim());
      setStep(2);
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

  const selectedPlatform = PLATFORMS.flatMap((g) => g.items).find((p) => p.type === serverType);
  const fp = detect.data;

  return (
    <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h1 style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
          Add mail server
        </h1>
        <div style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>
          Connect a self-hosted mail server or cloud ESP so MxWatch can pull stats and monitor delivery.
        </div>
      </div>

      {/* Step 1: Platform picker */}
      <Card>
        <CardHeader>
          <CardTitle>Choose platform</CardTitle>
          <CardDescription>Select the mail server or cloud provider you want to connect.</CardDescription>
        </CardHeader>
        <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {PLATFORMS.map((group) => (
            <div key={group.group}>
              <div style={{
                fontFamily: 'var(--sans)', fontSize: 10, fontWeight: 600,
                letterSpacing: '0.07em', textTransform: 'uppercase',
                color: 'var(--text3)', marginBottom: 8,
              }}>
                {group.group}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                {group.items.map((p) => (
                  <PlatformCard
                    key={p.type}
                    platform={p}
                    selected={serverType === p.type}
                    onClick={() => setServerType(p.type)}
                  />
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Step 2: Detect + configure */}
      <Card>
        <CardHeader>
          <CardTitle>
            Configure
            {selectedPlatform && (
              <span style={{ marginLeft: 8, fontWeight: 400, color: 'var(--text3)', fontSize: 13 }}>
                — {selectedPlatform.label}
              </span>
            )}
          </CardTitle>
          <CardDescription>
            Enter connection details. Run detection to auto-fill where possible.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="space-y-2">
              <Label htmlFor="host">Host / domain</Label>
              <Input id="host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="mail.example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="internalHost">Internal host (NAT relay only)</Label>
              <Input id="internalHost" value={internalHost} onChange={(e) => setInternalHost(e.target.value)} placeholder="10.0.0.5" />
            </div>
          </div>
          <Button variant="outline" onClick={onDetect} disabled={detect.isPending}>
            {detect.isPending ? 'Scanning…' : 'Run auto-detection'}
          </Button>

          {fp && (
            <div style={{ background: 'var(--surf2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 12, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>
              <div><span style={{ color: 'var(--text3)' }}>Detected:</span> {fp.detectedType ?? 'unknown'} (confidence: {fp.confidence})</div>
              {fp.smtpBanner && <div style={{ marginTop: 4 }}><span style={{ color: 'var(--text3)' }}>Banner:</span> {fp.smtpBanner.slice(0, 100)}</div>}
              <div style={{ marginTop: 4 }}><span style={{ color: 'var(--text3)' }}>Open ports:</span> {fp.openPorts.join(', ') || 'none'}</div>
              {fp.apiEndpoint && <div style={{ marginTop: 4 }}><span style={{ color: 'var(--text3)' }}>API:</span> {fp.apiEndpoint}</div>}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Primary mail server" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="space-y-2">
              <Label htmlFor="architecture">Architecture</Label>
              <select id="architecture" value={architecture} onChange={(e) => setArchitecture(e.target.value as any)}
                style={{ width: '100%', padding: '8px 10px', background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--sans)', fontSize: 13 }}>
                {ARCHITECTURES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="domain">Link to domain (optional)</Label>
              <select id="domain" value={domainId} onChange={(e) => setDomainId(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--sans)', fontSize: 13 }}>
                <option value="">— none —</option>
                {(domains.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.domain}</option>)}
              </select>
            </div>
          </div>

          {selectedPlatform?.apiSupport && (
            <>
              <div className="space-y-2">
                <Label htmlFor="baseUrl">API base URL</Label>
                <Input id="baseUrl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://mail.example.com" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="token">API token</Label>
                <Input id="token" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
              </div>
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={onSave} disabled={create.isPending || !name.trim()}>
            {create.isPending ? 'Saving…' : 'Save + test'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
