'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';
import { useSession, authClient } from '@/lib/auth-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/status-badge';
import { relativeTime } from '@/lib/alert-display';

const SCOPE_OPTIONS = ['domains:read', 'checks:read', 'reports:read', 'alerts:read', 'alerts:write'] as const;

export default function SecuritySettingsPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  useEffect(() => { if (!isPending && !session) router.push('/login'); }, [isPending, session, router]);
  if (isPending || !session) return <main>Loading…</main>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 860 }}>
      <div>
        <h1 style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
          Security
        </h1>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
          TOTP, sessions, API tokens, IP allowlist, password, activity log
        </div>
      </div>

      <TwoFactorSection twoFactorEnabled={(session.user as any).twoFactorEnabled === true} />
      <SessionsSection />
      <ApiTokensSection />
      <IpAllowlistSection />
      <PasswordSection />
      <ActivitySection />
      <DangerZone />
    </div>
  );
}

function TwoFactorSection({ twoFactorEnabled }: { twoFactorEnabled: boolean }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function disable() {
    setErr(null); setBusy(true);
    try {
      await authClient.twoFactor.disable({ password });
      window.location.reload();
    } catch (e: any) {
      setErr(e?.message ?? 'Disable failed');
    } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-factor authentication</CardTitle>
        <CardDescription>TOTP via your authenticator app + one-time backup codes.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {twoFactorEnabled
            ? <StatusBadge tone="healthy">enabled</StatusBadge>
            : <StatusBadge tone="warning">not configured</StatusBadge>}
        </div>
        {!twoFactorEnabled && (
          <Link href="/setup/2fa"><Button>Set up 2FA</Button></Link>
        )}
        {twoFactorEnabled && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ maxWidth: 220 }} />
            <Button variant="outline" onClick={disable} disabled={!password || busy}>
              {busy ? 'Disabling…' : 'Disable 2FA'}
            </Button>
          </div>
        )}
        {err && <p style={{ color: 'var(--red)', fontSize: 12 }}>{err}</p>}
      </CardContent>
    </Card>
  );
}

function SessionsSection() {
  const list = trpc.security.sessionsList.useQuery();
  const revoke = trpc.security.sessionRevoke.useMutation({ onSuccess: () => list.refetch() });
  const revokeAll = trpc.security.sessionRevokeAll.useMutation({ onSuccess: () => list.refetch() });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>Every browser / device currently signed in. Revoke any you don't recognize.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {list.isLoading && <p style={{ fontSize: 13, color: 'var(--text3)' }}>Loading…</p>}
        {list.data?.map((s) => (
          <div key={s.id} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
            padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
          }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.userAgent ?? 'unknown client'}
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                {s.ipAddress ?? 'unknown IP'} · created {relativeTime(s.createdAt)}
              </div>
            </div>
            {s.isCurrent
              ? <StatusBadge tone="info">current</StatusBadge>
              : <Button size="sm" variant="ghost" onClick={() => revoke.mutate({ sessionId: s.id })}>Revoke</Button>}
          </div>
        ))}
        {(list.data?.length ?? 0) > 1 && (
          <Button variant="outline" onClick={() => revokeAll.mutate()}>Log out all other sessions</Button>
        )}
      </CardContent>
    </Card>
  );
}

function ApiTokensSection() {
  const list = trpc.security.apiTokensList.useQuery();
  const create = trpc.security.apiTokenCreate.useMutation({ onSuccess: () => list.refetch() });
  const revoke = trpc.security.apiTokenRevoke.useMutation({ onSuccess: () => list.refetch() });
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['domains:read']);
  const [expiresInDays, setExpiresInDays] = useState<string>('');
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null); setPlaintext(null);
    try {
      const res = await create.mutateAsync({
        name,
        scopes: scopes as any,
        expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
      });
      setPlaintext(res.token);
      setName(''); setExpiresInDays('');
    } catch (e: any) { setErr(e?.message ?? 'Create failed'); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>API tokens</CardTitle>
        <CardDescription>Bearer tokens for the REST API. Shown in plaintext exactly once.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {list.isLoading && <p style={{ fontSize: 13, color: 'var(--text3)' }}>Loading…</p>}
        <div style={{ display: 'grid', gap: 6 }}>
          {(list.data ?? []).map((t) => {
            const revoked = !!t.revokedAt;
            const expired = t.expiresAt && t.expiresAt.getTime() < Date.now();
            return (
              <div key={t.id} style={{
                display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 12px',
                border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                opacity: revoked || expired ? 0.55 : 1,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--text)' }}>{t.name}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
                    {t.prefix}… · {t.scopes.join(', ')}
                    {t.lastUsedAt && <> · last used {relativeTime(t.lastUsedAt)}</>}
                    {t.expiresAt && <> · expires {t.expiresAt.toISOString().slice(0, 10)}</>}
                    {revoked && <> · <span style={{ color: 'var(--red)' }}>revoked</span></>}
                  </div>
                </div>
                {!revoked && (
                  <Button size="sm" variant="ghost" onClick={() => revoke.mutate({ tokenId: t.id })}>Revoke</Button>
                )}
              </div>
            );
          })}
        </div>

        <div style={{
          padding: 12, border: '1px dashed var(--border2)', borderRadius: 'var(--radius-sm)',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>Create a new token</div>
          <Input placeholder="Name (e.g. Grafana pull)" value={name} onChange={(e) => setName(e.target.value)} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
            {SCOPE_OPTIONS.map((s) => (
              <label key={s} style={{ display: 'flex', gap: 6, fontSize: 12, color: 'var(--text2)' }}>
                <input type="checkbox" checked={scopes.includes(s)}
                  onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))} />
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{s}</span>
              </label>
            ))}
          </div>
          <Input placeholder="Expires in days (blank = never)" inputMode="numeric"
            value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} style={{ maxWidth: 240 }} />
          {err && <p style={{ color: 'var(--red)', fontSize: 12 }}>{err}</p>}
          {plaintext && (
            <div style={{
              padding: 10, background: 'var(--amber-dim)', border: '1px solid var(--amber-border)',
              borderRadius: 'var(--radius-sm)', fontFamily: 'var(--mono)', fontSize: 11,
            }}>
              <div style={{ color: 'var(--amber)', fontWeight: 500, marginBottom: 6 }}>
                Copy this token now — it won't be shown again.
              </div>
              <code style={{ userSelect: 'all', wordBreak: 'break-all' }}>{plaintext}</code>
            </div>
          )}
          <Button onClick={submit} disabled={!name || scopes.length === 0 || create.isPending}>
            {create.isPending ? 'Creating…' : 'Create token'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function IpAllowlistSection() {
  const data = trpc.security.ipAllowlistGet.useQuery();
  const set = trpc.security.ipAllowlistSet.useMutation({ onSuccess: () => data.refetch() });
  const [entry, setEntry] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (data.data?.currentIp && !entry) setEntry(data.data.currentIp); }, [data.data?.currentIp]);

  const entries = data.data?.entries ?? [];
  const currentMatched = data.data?.currentIp && entries.includes(data.data.currentIp);

  async function add() {
    setErr(null);
    const next = [...entries, entry.trim()].filter((e, i, arr) => e && arr.indexOf(e) === i);
    try { await set.mutateAsync({ entries: next }); setEntry(''); }
    catch (e: any) { setErr(e?.message ?? 'Invalid IP/CIDR'); }
  }
  async function remove(ip: string) {
    await set.mutateAsync({ entries: entries.filter((e) => e !== ip) });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>IP allowlist</CardTitle>
        <CardDescription>When non-empty, only requests from these IPs/CIDRs are accepted. Empty = no restriction.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.data && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
            Your current IP:{' '}
            <span style={{ color: currentMatched || entries.length === 0 ? 'var(--text)' : 'var(--red)' }}>
              {data.data.currentIp ?? 'unknown'}
            </span>
            {entries.length > 0 && !currentMatched && (
              <span style={{ color: 'var(--red)' }}> — not in allowlist; saving will lock this session out.</span>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <Input placeholder="IP or CIDR (e.g. 192.168.0.0/24)" value={entry} onChange={(e) => setEntry(e.target.value)} />
          <Button onClick={add} disabled={!entry.trim() || set.isPending}>Add</Button>
        </div>
        {err && <p style={{ color: 'var(--red)', fontSize: 12 }}>{err}</p>}
        <div>
          {entries.length === 0
            ? <div style={{ fontSize: 12, color: 'var(--text3)' }}>No entries — all IPs accepted.</div>
            : entries.map((ip) => (
              <div key={ip} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{ip}</span>
                <Button size="sm" variant="ghost" onClick={() => remove(ip)}>Remove</Button>
              </div>
            ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PasswordSection() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const change = trpc.security.changePassword.useMutation();

  async function submit() {
    setErr(null); setOk(false);
    try {
      await change.mutateAsync({ currentPassword: current, newPassword: next, confirmPassword: confirm });
      setOk(true); setCurrent(''); setNext(''); setConfirm('');
    } catch (e: any) { setErr(e?.message ?? 'Change failed'); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Minimum 12 characters. Changing logs out other sessions.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!open
          ? <Button variant="outline" onClick={() => setOpen(true)}>Change password</Button>
          : (
            <>
              <div className="space-y-2"><Label>Current password</Label>
                <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
              <div className="space-y-2"><Label>New password (min 12)</Label>
                <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} /></div>
              <div className="space-y-2"><Label>Confirm</Label>
                <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
              {err && <p style={{ color: 'var(--red)', fontSize: 12 }}>{err}</p>}
              {ok && <p style={{ color: 'var(--green)', fontSize: 12 }}>Password changed.</p>}
              <div style={{ display: 'flex', gap: 6 }}>
                <Button onClick={submit} disabled={change.isPending}>{change.isPending ? 'Saving…' : 'Save'}</Button>
                <Button variant="outline" onClick={() => { setOpen(false); setErr(null); setOk(false); }}>Cancel</Button>
              </div>
            </>
          )}
      </CardContent>
    </Card>
  );
}

function ActivitySection() {
  const log = trpc.security.activityLog.useQuery({ limit: 50 });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Account activity</CardTitle>
        <CardDescription>Last 50 security-relevant events on your account.</CardDescription>
      </CardHeader>
      <CardContent>
        {(log.data?.length ?? 0) === 0
          ? <div style={{ fontSize: 12, color: 'var(--text3)' }}>No activity yet.</div>
          : (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
              {(log.data ?? []).map((e) => (
                <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', padding: '6px 0', borderBottom: '1px solid var(--border)', gap: 6 }}>
                  <span style={{ color: 'var(--text)' }}>{e.action}</span>
                  <span style={{ color: 'var(--text3)' }}>{e.ipAddress ?? '—'}</span>
                  <span style={{ color: 'var(--text3)' }}>{relativeTime(e.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
      </CardContent>
    </Card>
  );
}

function DangerZone() {
  return (
    <Card style={{ borderColor: 'var(--red-border)' }}>
      <CardHeader>
        <CardTitle style={{ color: 'var(--red)' }}>Danger zone</CardTitle>
        <CardDescription>Destructive actions. Export + delete are scheduled for a follow-up release.</CardDescription>
      </CardHeader>
      <CardContent style={{ display: 'flex', gap: 8 }}>
        <Button variant="outline" disabled>Export my data</Button>
        <Button variant="outline" disabled style={{ color: 'var(--red)' }}>Delete account</Button>
      </CardContent>
    </Card>
  );
}
