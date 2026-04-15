'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { BrandMark } from '@/components/brand-mark';

type Architecture = 'direct' | 'nat_relay' | 'split' | 'managed';

const ARCH_OPTIONS: { value: Architecture; title: string; desc: string }[] = [
  { value: 'direct', title: 'Direct', desc: 'Your mail server has a public IP and sends directly.' },
  { value: 'nat_relay', title: 'NAT relay / VPS', desc: 'Mail routes through a VPS relay in front of an internal server.' },
  { value: 'split', title: 'Split sending', desc: 'Inbound and outbound use different hosts or providers.' },
  { value: 'managed', title: 'Managed provider', desc: 'Resend, SendGrid, Postmark, or similar.' },
];

const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i, 'Invalid domain');

export default function OnboardingPage() {
  const router = useRouter();
  const { data: session, isPending: sessionPending } = useSession();
  const utils = trpc.useUtils();

  const status = trpc.onboarding.status.useQuery(undefined, { enabled: !!session });
  const domains = trpc.domains.list.useQuery(undefined, { enabled: !!session });

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [domainId, setDomainId] = useState<string | null>(null);
  const [domainName, setDomainName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionPending && !session) router.replace('/login');
  }, [sessionPending, session, router]);

  useEffect(() => {
    if (!status.data || !domains.data) return;
    const latest = domains.data[0];
    if (latest) {
      setDomainId((prev) => prev ?? latest.id);
      setDomainName((prev) => prev ?? latest.domain);
    }
    const s = status.data.step;
    if (s >= 4) return;
    setStep((prev) => {
      const target = (Math.max(s + 1, 1) as 1 | 2 | 3 | 4);
      return prev > 1 ? prev : target;
    });
  }, [status.data, domains.data]);

  if (sessionPending || !session || status.isLoading) {
    return <main className="mx-auto max-w-2xl p-6"><p style={{ color: 'var(--text3)' }}>Loading…</p></main>;
  }

  if (status.data?.complete) {
    return (
      <main className="mx-auto max-w-2xl p-6 space-y-4">
        <BrandMark size={22} />
        <Card>
          <CardHeader>
            <CardTitle>Setup already complete</CardTitle>
            <CardDescription>You can revisit individual settings any time.</CardDescription>
          </CardHeader>
          <CardContent>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => router.push('/')}>Go to dashboard</Button>
              <Button variant="outline" onClick={() => { void utils.onboarding.status.invalidate(); setStep(1); }}>
                Redo wizard
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-5">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <BrandMark size={22} />
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
          Step {step} of 4
        </div>
      </div>
      <StepDots step={step} />
      <h1 style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
        Welcome to MxWatch
      </h1>

      {step === 1 && (
        <Step1Domain
          onDone={(id, name) => { setDomainId(id); setDomainName(name); setStep(2); setError(null); }}
          onExit={() => router.push('/')}
          error={error}
          setError={setError}
        />
      )}

      {step === 2 && domainId && domainName && (
        <Step2Architecture
          domainId={domainId}
          domainName={domainName}
          onDone={() => { setStep(3); setError(null); }}
          onSkip={() => { setStep(3); setError(null); }}
          error={error}
          setError={setError}
        />
      )}

      {step === 3 && (
        <Step3Integration
          onDone={() => { setStep(4); setError(null); }}
          onSkip={() => { setStep(4); setError(null); }}
        />
      )}

      {step === 4 && domainId && (
        <Step4Alerts
          domainId={domainId}
          defaultEmail={session.user.email ?? ''}
          onFinish={() => router.push('/')}
          error={error}
          setError={setError}
        />
      )}
    </main>
  );
}

function StepDots({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            background: i <= step ? 'var(--blue)' : 'var(--border2)',
            transition: 'background 0.2s',
          }}
        />
      ))}
    </div>
  );
}

function Step1Domain({
  onDone, onExit, error, setError,
}: {
  onDone: (id: string, name: string) => void;
  onExit: () => void;
  error: string | null;
  setError: (e: string | null) => void;
}) {
  const createDomain = trpc.domains.create.useMutation();
  const advance = trpc.onboarding.advance.useMutation();
  const utils = trpc.useUtils();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const parsed = domainSchema.safeParse(fd.get('domain'));
    const selector = String(fd.get('dkimSelector') ?? 'mail').trim() || 'mail';
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Invalid domain');
    try {
      const res = await createDomain.mutateAsync({ domain: parsed.data, dkimSelector: selector });
      await advance.mutateAsync({ minStep: 1 });
      await Promise.all([utils.domains.list.invalidate(), utils.onboarding.status.invalidate()]);
      onDone(res.id, parsed.data);
    } catch (e: any) {
      setError(e.message ?? 'Failed to add domain');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add your first domain</CardTitle>
        <CardDescription>We'll check SPF, DKIM, DMARC and blacklists immediately.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="domain">Domain</Label>
            <Input id="domain" name="domain" placeholder="example.com" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dkimSelector">DKIM selector</Label>
            <Input id="dkimSelector" name="dkimSelector" placeholder="mail" defaultValue="mail" />
            <p className="text-xs text-muted-foreground">
              The part before <code>._domainkey</code>. Usually <code>mail</code> or <code>default</code>.
            </p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button type="submit" disabled={createDomain.isPending}>
              {createDomain.isPending ? 'Adding…' : 'Continue'}
            </Button>
            <button
              type="button"
              onClick={onExit}
              style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 12, cursor: 'pointer' }}
            >
              I'll add a domain later
            </button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Step2Architecture({
  domainId, domainName, onDone, onSkip, error, setError,
}: {
  domainId: string;
  domainName: string;
  onDone: () => void;
  onSkip: () => void;
  error: string | null;
  setError: (e: string | null) => void;
}) {
  const detect = trpc.onboarding.detectMailServer.useQuery(
    { domainId },
    { staleTime: 60_000, refetchOnWindowFocus: false },
  );
  const setTopology = trpc.domains.setTopology.useMutation();
  const advance = trpc.onboarding.advance.useMutation();
  const utils = trpc.useUtils();

  const [architecture, setArchitecture] = useState<Architecture>('direct');
  const [internalHost, setInternalHost] = useState('');
  const [sendingIp, setSendingIp] = useState('');

  useEffect(() => {
    if (detect.data?.primaryIp && !sendingIp) setSendingIp(detect.data.primaryIp);
  }, [detect.data, sendingIp]);

  async function submit() {
    setError(null);
    try {
      const ips = sendingIp.trim() ? [sendingIp.trim()] : [];
      await setTopology.mutateAsync({
        id: domainId,
        architecture,
        sendingIps: ips,
        smtpCheckHost: detect.data?.primaryMx ?? null,
        relayHost: architecture === 'nat_relay' ? detect.data?.primaryMx ?? null : null,
        internalHost: architecture === 'nat_relay' && internalHost.trim() ? internalHost.trim() : null,
      });
      await advance.mutateAsync({ minStep: 2 });
      await Promise.all([utils.domains.list.invalidate(), utils.onboarding.status.invalidate()]);
      onDone();
    } catch (e: any) {
      setError(e.message ?? 'Failed to save topology');
    }
  }

  async function skip() {
    await advance.mutateAsync({ minStep: 2 });
    await utils.onboarding.status.invalidate();
    onSkip();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mail server architecture</CardTitle>
        <CardDescription>We use this to decide what to probe and which IPs to check against blacklists.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div
          style={{
            background: 'var(--surf2)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: '12px 14px',
            fontFamily: 'var(--mono)',
            fontSize: 12,
          }}
        >
          {detect.isLoading && <span style={{ color: 'var(--text3)' }}>Scanning {domainName}…</span>}
          {detect.isError && <span style={{ color: 'var(--red)' }}>Detection failed.</span>}
          {detect.data && !detect.data.primaryMx && (
            <span style={{ color: 'var(--amber)' }}>No MX record found for {domainName}.</span>
          )}
          {detect.data?.primaryMx && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, color: 'var(--text2)' }}>
              <div>
                <span style={{ color: 'var(--text3)' }}>MX:</span>{' '}
                <span style={{ color: 'var(--text)' }}>{detect.data.primaryMx}</span>
                {detect.data.primaryIp && (
                  <> <span style={{ color: 'var(--text3)' }}>→</span>{' '}
                  <span style={{ color: 'var(--text)' }}>{detect.data.primaryIp}</span></>
                )}
              </div>
              {detect.data.banner && (
                <div style={{ color: 'var(--text3)', fontSize: 11 }}>Banner: {detect.data.banner.slice(0, 80)}</div>
              )}
              {detect.data.detectedServer !== 'unknown' && (
                <div style={{ color: 'var(--green)', fontSize: 11 }}>Detected: {detect.data.detectedServer}</div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          {ARCH_OPTIONS.map((o) => (
            <label
              key={o.value}
              style={{
                display: 'flex',
                gap: 10,
                padding: '10px 12px',
                border: `1px solid ${architecture === o.value ? 'var(--blue-border)' : 'var(--border)'}`,
                background: architecture === o.value ? 'var(--blue-dim)' : 'var(--surf)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="arch"
                value={o.value}
                checked={architecture === o.value}
                onChange={() => setArchitecture(o.value)}
                style={{ marginTop: 3 }}
              />
              <div>
                <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text)' }}>{o.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{o.desc}</div>
              </div>
            </label>
          ))}
        </div>

        <div className="space-y-2">
          <Label htmlFor="sendingIp">Sending IP</Label>
          <Input
            id="sendingIp"
            value={sendingIp}
            onChange={(e) => setSendingIp(e.target.value)}
            placeholder={detect.data?.primaryIp ?? '203.0.113.5'}
          />
          <p className="text-xs text-muted-foreground">We pre-filled this from your MX record. Edit if your outbound IP differs.</p>
        </div>

        {architecture === 'nat_relay' && (
          <div className="space-y-2">
            <Label htmlFor="internalHost">Internal mail server IP</Label>
            <Input
              id="internalHost"
              value={internalHost}
              onChange={(e) => setInternalHost(e.target.value)}
              placeholder="10.0.0.5"
            />
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button onClick={submit} disabled={setTopology.isPending}>
            {setTopology.isPending ? 'Saving…' : 'Continue'}
          </Button>
          <button
            type="button"
            onClick={skip}
            style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 12, cursor: 'pointer' }}
          >
            Skip for now
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

function Step3Integration({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const createStalwart = trpc.stalwart.create.useMutation();
  const testStalwart = trpc.stalwart.test.useMutation();
  const advance = trpc.onboarding.advance.useMutation();
  const utils = trpc.useUtils();

  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    setTestResult(null);
    if (!baseUrl || !token) return setErr('Base URL and API token are required.');
    try {
      const created = await createStalwart.mutateAsync({ name: 'Primary mail server', baseUrl, token });
      const test = await testStalwart.mutateAsync({ id: created.id });
      setTestResult({ ok: !!test.ok, message: test.ok ? 'Connected — pulling stats.' : (test.error ?? 'Test failed') });
      if (test.ok) {
        await advance.mutateAsync({ minStep: 3 });
        await utils.onboarding.status.invalidate();
        onDone();
      }
    } catch (e: any) {
      setErr(e.message ?? 'Failed to connect');
    }
  }

  async function skip() {
    await advance.mutateAsync({ minStep: 3 });
    await utils.onboarding.status.invalidate();
    onSkip();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect to your mail server (optional)</CardTitle>
        <CardDescription>Deep stats — queue depth, delivery rates, TLS percent — require an API connection. External monitoring works without it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="baseUrl">Stalwart base URL</Label>
          <Input id="baseUrl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://mail.example.com" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="token">API token</Label>
          <Input id="token" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Create a read-only token in Stalwart admin. Postfix/Mailcow users: skip this and use the agent install (Settings → Integrations).
          </p>
        </div>
        {testResult && (
          <p style={{ fontSize: 12, color: testResult.ok ? 'var(--green)' : 'var(--red)' }}>{testResult.message}</p>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button onClick={submit} disabled={createStalwart.isPending || testStalwart.isPending}>
            {createStalwart.isPending || testStalwart.isPending ? 'Connecting…' : 'Connect & test'}
          </Button>
          <button
            type="button"
            onClick={skip}
            style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 12, cursor: 'pointer' }}
          >
            Skip — monitor from outside only
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

const ALERT_OPTIONS: { type: 'blacklist_listed' | 'dns_record_changed' | 'health_score_drop'; label: string; desc: string }[] = [
  { type: 'blacklist_listed', label: 'Blacklist listing', desc: 'Any of your sending IPs appears on an RBL.' },
  { type: 'dns_record_changed', label: 'DNS record changed', desc: 'SPF, DKIM, DMARC, or MX record is modified.' },
  { type: 'health_score_drop', label: 'SMTP / health drop', desc: 'SMTP unreachable or health score falls below threshold.' },
];

function Step4Alerts({
  domainId, defaultEmail, onFinish, error, setError,
}: {
  domainId: string;
  defaultEmail: string;
  onFinish: () => void;
  error: string | null;
  setError: (e: string | null) => void;
}) {
  const addEmail = trpc.alerts.addEmailChannel.useMutation();
  const upsertRule = trpc.alerts.upsertRule.useMutation();
  const existingRules = trpc.alerts.listRules.useQuery({ domainId });
  const existingChannels = trpc.alerts.listChannels.useQuery();
  const advance = trpc.onboarding.advance.useMutation();
  const utils = trpc.useUtils();

  const [email, setEmail] = useState(defaultEmail);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    blacklist_listed: true,
    dns_record_changed: true,
    health_score_drop: true,
  });

  const ruleByType = useMemo(() => {
    const m: Record<string, { id: string; isActive: boolean | null }> = {};
    for (const r of existingRules.data ?? []) m[r.type] = { id: r.id, isActive: r.isActive };
    return m;
  }, [existingRules.data]);

  async function finish() {
    setError(null);
    try {
      const emailTrimmed = email.trim();
      const hasEmail = (existingChannels.data ?? []).some((c) => c.type === 'email' && c.isActive);
      if (!emailTrimmed && !hasEmail) return setError('Enter an alert email or add one in Settings first.');
      if (emailTrimmed && !z.string().email().safeParse(emailTrimmed).success) return setError('Invalid email.');

      if (emailTrimmed) {
        const already = (existingChannels.data ?? []).some((c) => c.label === emailTrimmed);
        if (!already) await addEmail.mutateAsync({ email: emailTrimmed, label: 'Primary email' });
      }

      for (const opt of ALERT_OPTIONS) {
        const existing = ruleByType[opt.type];
        await upsertRule.mutateAsync({
          id: existing?.id,
          domainId,
          type: opt.type,
          threshold: null,
          isActive: enabled[opt.type] ?? true,
        });
      }

      await advance.mutateAsync({ minStep: 4 });
      await Promise.all([
        utils.onboarding.status.invalidate(),
        utils.alerts.listChannels.invalidate(),
        utils.alerts.listRules.invalidate({ domainId }),
      ]);
      onFinish();
    } catch (e: any) {
      setError(e.message ?? 'Failed to save alerts');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alert preferences</CardTitle>
        <CardDescription>Where to send alerts and which events matter.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Alert email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          {ALERT_OPTIONS.map((o) => (
            <label
              key={o.type}
              style={{
                display: 'flex',
                gap: 10,
                padding: '10px 12px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                background: 'var(--surf)',
              }}
            >
              <input
                type="checkbox"
                checked={enabled[o.type] ?? false}
                onChange={(e) => setEnabled((p) => ({ ...p, [o.type]: e.target.checked }))}
                style={{ marginTop: 3 }}
              />
              <div>
                <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text)' }}>{o.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{o.desc}</div>
              </div>
            </label>
          ))}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button onClick={finish} disabled={addEmail.isPending || upsertRule.isPending}>
          {addEmail.isPending || upsertRule.isPending ? 'Saving…' : 'Finish setup'}
        </Button>
      </CardContent>
    </Card>
  );
}
