'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';

export default function GoogleSettingsPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const oauthError = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('error')
    : null;
  const status = trpc.google.status.useQuery(undefined, { enabled: !!session });
  const disconnect = trpc.google.disconnect.useMutation({ onSuccess: () => status.refetch() });
  const syncNow = trpc.google.syncNow.useMutation({ onSuccess: () => status.refetch() });

  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) return <main className="p-6">Loading…</main>;

  const connected = status.data?.connected;
  const enabled = status.data?.enabled;

  async function onSync() {
    setSyncMsg('Syncing…');
    try {
      const res = await syncNow.mutateAsync();
      setSyncMsg(`Checked ${res.domainsChecked} verified domain(s), wrote ${res.statsWritten} stat row(s)${res.errors.length ? `, ${res.errors.length} error(s)` : ''}.`);
    } catch (e: any) {
      setSyncMsg(e.message ?? 'Sync failed');
    }
  }

  return (
    <div className="space-y-6" style={{ maxWidth: 900 }}>
      <PageHeader
        title="Google Postmaster Tools"
        subtitle="Pull Gmail-side spam rate, IP reputation, and delivery errors for your verified domains."
      />

      {oauthError && (
        <Card className="border-l-4 border-l-[hsl(0_84%_60%)]">
          <CardContent className="py-3 text-sm text-destructive">OAuth error: {oauthError}</CardContent>
        </Card>
      )}

      {!enabled ? (
        <Card>
          <CardHeader>
            <CardTitle>Not configured</CardTitle>
            <CardDescription>Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in your environment to enable this integration.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ol className="ml-5 list-decimal space-y-2">
              <li>Create a project in Google Cloud Console and enable the <strong>Gmail Postmaster Tools API</strong>.</li>
              <li>Configure OAuth consent (user type: External or Internal) with the scope <code>postmaster.readonly</code>.</li>
              <li>Create an OAuth 2.0 Client ID (type: Web application) with the redirect URI:
                <pre className="mt-1 rounded border border-border bg-muted/50 p-2 text-xs font-mono">{typeof window !== 'undefined' ? `${window.location.origin}/api/oauth/google/callback` : '/api/oauth/google/callback'}</pre>
              </li>
              <li>Drop <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> into <code>.env</code> and restart the server.</li>
              <li>Verify each domain in Postmaster Tools (<a href="https://postmaster.google.com" target="_blank" rel="noreferrer" className="underline">postmaster.google.com</a>) via a DNS TXT record.</li>
            </ol>
          </CardContent>
        </Card>
      ) : connected ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Connected</span>
              <Badge variant="success">Active</Badge>
            </CardTitle>
            <CardDescription>{status.data?.googleEmail ?? 'Google account linked'}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last sync</span>
              <span>{status.data?.lastSyncAt ? new Date(status.data.lastSyncAt).toLocaleString() : 'never'}</span>
            </div>
            {status.data?.lastSyncError && (
              <p className="rounded border border-border bg-[hsl(0_84%_60%/0.08)] p-2 text-xs text-destructive whitespace-pre-wrap">{status.data.lastSyncError}</p>
            )}
            <div className="flex gap-2">
              <Button onClick={onSync} disabled={syncNow.isPending}>{syncNow.isPending ? 'Syncing…' : 'Sync now'}</Button>
              <Button variant="destructive" onClick={() => { if (confirm('Disconnect Google?')) disconnect.mutate(); }} disabled={disconnect.isPending}>Disconnect</Button>
            </div>
            {syncMsg && <p className="text-sm text-muted-foreground">{syncMsg}</p>}
            <p className="text-xs text-muted-foreground">
              Automatic sync runs daily at 04:00 UTC. Stats land in the Postmaster tab on each verified domain.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Connect Google Postmaster Tools</CardTitle>
            <CardDescription>Grants MxWatch read-only access to traffic stats for domains you've verified in Postmaster Tools.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><a href="/api/oauth/google/start">Connect</a></Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
