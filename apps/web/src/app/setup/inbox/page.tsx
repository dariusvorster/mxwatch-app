'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/status-badge';

type Mode = 'own_domain' | 'stalwart_relay' | 'manual';

export default function InboxSetupPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const config = trpc.inboxSetup.getConfig.useQuery(undefined, { enabled: !!session });
  const stalwarts = trpc.stalwart.list.useQuery(undefined, { enabled: !!session });
  const configure = trpc.inboxSetup.configure.useMutation();
  const utils = trpc.useUtils();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [mode, setMode] = useState<Mode>('own_domain');
  const [inboxDomain, setInboxDomain] = useState('');
  const [stalwartId, setStalwartId] = useState('');
  const [dnsRecords, setDnsRecords] = useState<{ type: string; name: string; value: string }[] | null>(null);
  const [catchall, setCatchall] = useState<{ pattern: string; script: string; uploaded: boolean; message: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (!isPending && !session) router.push('/login'); }, [isPending, session, router]);

  async function saveMode() {
    setErr(null);
    try {
      if (mode === 'own_domain') {
        if (!inboxDomain.trim()) return setErr('Enter an inbox domain.');
        const res = await configure.mutateAsync({ mode, inboxDomain });
        setDnsRecords(res.dnsRecords ?? null);
        setStep(2);
      } else if (mode === 'stalwart_relay') {
        if (!stalwartId) return setErr('Pick a Stalwart integration.');
        const res = await configure.mutateAsync({ mode, stalwartIntegrationId: stalwartId });
        setCatchall({
          pattern: res.catchallAddressPattern!,
          script: res.sieveScript!,
          uploaded: !!res.uploaded,
          message: res.message ?? '',
        });
        setStep(2);
      } else {
        await configure.mutateAsync({ mode: 'manual' });
        await utils.inboxSetup.getConfig.invalidate();
        router.push('/tools/deliverability');
      }
    } catch (e: any) { setErr(e?.message ?? 'Failed'); }
  }

  if (isPending || !session || config.isLoading) return <main>Loading…</main>;

  if (config.data?.verified) {
    return (
      <main style={{ maxWidth: 520, margin: '60px auto', padding: 24 }}>
        <Card>
          <CardHeader><CardTitle>Inbox already configured</CardTitle></CardHeader>
          <CardContent>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 10 }}>
              Mode: <b>{config.data.mode}</b>
            </div>
            <Button onClick={() => router.push('/tools/deliverability')}>Go to deliverability tests</Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 680, margin: '40px auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <h1 style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 600, color: 'var(--text)' }}>
        Set up your deliverability inbox
      </h1>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Step 1 — Choose a mode</CardTitle>
            <CardDescription>How should MxWatch receive your deliverability test emails?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ModeOption value="own_domain" current={mode} onPick={setMode}
              title="Own domain inbox" flag="RECOMMENDED"
              desc="You own a domain and can publish an MX record. MxWatch accepts *@<your-inbox-domain>. Full automated scoring." />
            <ModeOption value="stalwart_relay" current={mode} onPick={setMode}
              title="Stalwart relay"
              desc="You have a Stalwart integration in MxWatch. We install a Sieve route so Stalwart forwards test email to MxWatch." />
            <ModeOption value="manual" current={mode} onPick={setMode}
              title="Manual header paste" flag="ALWAYS WORKS"
              desc="No infrastructure needed. You send a test, copy raw headers from your mail client, and paste them here." />

            {mode === 'own_domain' && (
              <div className="space-y-2">
                <Label>Test inbox domain</Label>
                <Input value={inboxDomain} onChange={(e) => setInboxDomain(e.target.value)} placeholder="mail-test.example.com" />
              </div>
            )}
            {mode === 'stalwart_relay' && (
              <div className="space-y-2">
                <Label>Stalwart integration</Label>
                <select value={stalwartId} onChange={(e) => setStalwartId(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--surf)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 13 }}>
                  <option value="">— pick one —</option>
                  {(stalwarts.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.baseUrl})</option>)}
                </select>
                {(stalwarts.data?.length ?? 0) === 0 && (
                  <p style={{ fontSize: 12, color: 'var(--text3)' }}>
                    No Stalwart integrations configured. <a href="/integrations/stalwart" style={{ color: 'var(--blue)' }}>Add one</a> first.
                  </p>
                )}
              </div>
            )}

            {err && <p style={{ color: 'var(--red)', fontSize: 12 }}>{err}</p>}
            <Button onClick={saveMode} disabled={configure.isPending}>
              {configure.isPending ? 'Saving…' : mode === 'manual' ? 'Finish' : 'Next'}
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 2 && mode === 'own_domain' && dnsRecords && (
        <OwnDomainVerify
          inboxDomain={inboxDomain}
          dnsRecords={dnsRecords}
          onVerified={() => setStep(3)}
          onBack={() => setStep(1)}
        />
      )}

      {step === 2 && mode === 'stalwart_relay' && catchall && (
        <StalwartInstructions
          catchall={catchall}
          onDone={() => { void utils.inboxSetup.getConfig.invalidate(); router.push('/tools/deliverability'); }}
        />
      )}

      {step === 3 && (
        <Card>
          <CardHeader><CardTitle>All set</CardTitle></CardHeader>
          <CardContent>
            <p style={{ color: 'var(--text2)', marginBottom: 10 }}>Inbox configured. You can run deliverability tests now.</p>
            <Button onClick={() => router.push('/tools/deliverability')}>Go to deliverability tests</Button>
          </CardContent>
        </Card>
      )}
    </main>
  );
}

function ModeOption({ value, current, onPick, title, desc, flag }:
  { value: Mode; current: Mode; onPick: (m: Mode) => void; title: string; desc: string; flag?: string }) {
  const selected = value === current;
  return (
    <label style={{
      display: 'flex', gap: 10, padding: '12px 14px', cursor: 'pointer',
      border: `1px solid ${selected ? 'var(--blue-border)' : 'var(--border)'}`,
      background: selected ? 'var(--blue-dim)' : 'var(--surf)',
      borderRadius: 'var(--radius-sm)',
    }}>
      <input type="radio" name="mode" value={value} checked={selected} onChange={() => onPick(value)} style={{ marginTop: 3 }} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', display: 'flex', gap: 6, alignItems: 'center' }}>
          {title}
          {flag && <span style={{ fontSize: 9, padding: '1px 6px', background: 'var(--green-dim)', color: 'var(--green)', borderRadius: 3 }}>{flag}</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{desc}</div>
      </div>
    </label>
  );
}

function OwnDomainVerify({ inboxDomain, dnsRecords, onVerified, onBack }: {
  inboxDomain: string;
  dnsRecords: { type: string; name: string; value: string }[];
  onVerified: () => void;
  onBack: () => void;
}) {
  const verify = trpc.inboxSetup.verifyDns.useQuery({ domain: inboxDomain }, {
    refetchInterval: 5_000,
  });
  const mark = trpc.inboxSetup.markVerified.useMutation();

  useEffect(() => {
    if (verify.data?.propagated) {
      void mark.mutateAsync().then(() => onVerified());
    }
  }, [verify.data?.propagated]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 2 — Publish the MX record</CardTitle>
        <CardDescription>Add this record at your DNS provider. MxWatch will poll every 5s.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <pre style={{
          fontFamily: 'var(--mono)', fontSize: 12, padding: 12,
          background: 'var(--surf2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', userSelect: 'all',
        }}>
{dnsRecords.map((r) => `${r.type}  ${r.name}.  ${r.value}`).join('\n')}
        </pre>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>
          Port 25 must be reachable at <b>{dnsRecords[0]?.value.split(' ').pop()}</b>.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {verify.data?.propagated
            ? <StatusBadge tone="healthy">propagated</StatusBadge>
            : <StatusBadge tone="warning">waiting…</StatusBadge>}
          {verify.data && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
              expected {verify.data.expected} · found [{verify.data.found.join(', ') || 'none'}]
            </span>
          )}
        </div>
        <Button variant="outline" onClick={onBack}>← Back</Button>
      </CardContent>
    </Card>
  );
}

function StalwartInstructions({ catchall, onDone }: {
  catchall: { pattern: string; script: string; uploaded: boolean; message: string };
  onDone: () => void;
}) {
  const mark = trpc.inboxSetup.markVerified.useMutation({ onSuccess: onDone });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 2 — Stalwart Sieve script</CardTitle>
        <CardDescription>
          {catchall.uploaded
            ? `Installed automatically. ${catchall.message}`
            : `Automatic upload failed (${catchall.message}) — install this Sieve script manually.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div style={{ fontSize: 12 }}>
          Send test emails to: <code style={{ fontFamily: 'var(--mono)' }}>{catchall.pattern}</code>
        </div>
        <pre style={{
          fontFamily: 'var(--mono)', fontSize: 11, padding: 12,
          background: 'var(--surf2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
          whiteSpace: 'pre-wrap', userSelect: 'all',
        }}>{catchall.script}</pre>
        <Button onClick={() => mark.mutate()} disabled={mark.isPending}>
          {mark.isPending ? 'Saving…' : 'Mark verified'}
        </Button>
      </CardContent>
    </Card>
  );
}
