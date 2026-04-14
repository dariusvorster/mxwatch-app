'use client';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';

type ChannelKind = 'email' | 'slack' | 'ntfy' | 'webhook';

const addSchemas = {
  email: z.object({ email: z.string().email(), label: z.string().max(100).optional() }),
  slack: z.object({
    webhookUrl: z.string().url().refine((u) => u.startsWith('https://hooks.slack.com/'), 'Must be a Slack incoming webhook URL'),
    label: z.string().max(100).optional(),
  }),
  ntfy: z.object({
    url: z.string().url(),
    topic: z.string().trim().min(1).max(64),
    token: z.string().max(200).optional(),
    label: z.string().max(100).optional(),
  }),
  webhook: z.object({
    url: z.string().url(),
    secret: z.string().max(200).optional(),
    label: z.string().max(100).optional(),
  }),
};

export default function AlertChannelsPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const channels = trpc.alerts.listChannels.useQuery(undefined, { enabled: !!session });

  const refetch = () => channels.refetch();
  const addEmail = trpc.alerts.addEmailChannel.useMutation({ onSuccess: refetch });
  const addSlack = trpc.alerts.addSlackChannel.useMutation({ onSuccess: refetch });
  const addNtfy = trpc.alerts.addNtfyChannel.useMutation({ onSuccess: refetch });
  const addWebhook = trpc.alerts.addWebhookChannel.useMutation({ onSuccess: refetch });
  const removeChannel = trpc.alerts.removeChannel.useMutation({ onSuccess: refetch });
  const toggleActive = trpc.alerts.setChannelActive.useMutation({ onSuccess: refetch });
  const sendTest = trpc.alerts.sendTest.useMutation();

  const [kind, setKind] = useState<ChannelKind>('email');
  const [error, setError] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) return <main className="p-6">Loading…</main>;

  async function onAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const raw = Object.fromEntries(fd.entries()) as Record<string, string>;
    for (const k of Object.keys(raw)) if (raw[k] === '') delete raw[k];
    try {
      if (kind === 'email') {
        const p = addSchemas.email.parse(raw);
        await addEmail.mutateAsync(p);
      } else if (kind === 'slack') {
        const p = addSchemas.slack.parse(raw);
        await addSlack.mutateAsync(p);
      } else if (kind === 'ntfy') {
        const p = addSchemas.ntfy.parse(raw);
        await addNtfy.mutateAsync(p);
      } else {
        const p = addSchemas.webhook.parse(raw);
        await addWebhook.mutateAsync(p);
      }
      form.reset();
    } catch (err: any) {
      setError(err.issues?.[0]?.message ?? err.message ?? 'Failed to add channel');
    }
  }

  async function onTest(channelId: string) {
    setTestMsg((m) => ({ ...m, [channelId]: 'Sending…' }));
    try {
      await sendTest.mutateAsync({ channelId });
      setTestMsg((m) => ({ ...m, [channelId]: 'Sent ✓' }));
    } catch (err: any) {
      setTestMsg((m) => ({ ...m, [channelId]: err.message ?? 'Failed' }));
    }
    setTimeout(() => setTestMsg((m) => { const n = { ...m }; delete n[channelId]; return n; }), 4000);
  }

  return (
    <div className="space-y-6" style={{ maxWidth: 900 }}>
      <PageHeader
        title="Alert channels"
        subtitle="Where MxWatch delivers alerts when something breaks."
      />

      <Card>
        <CardHeader>
          <CardTitle>Add channel</CardTitle>
          <CardDescription>Pick a delivery method — you can add multiple of any type.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            {(['email', 'slack', 'ntfy', 'webhook'] as ChannelKind[]).map((k) => (
              <Button
                key={k}
                type="button"
                variant={kind === k ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setKind(k); setError(null); }}
              >
                {k}
              </Button>
            ))}
          </div>

          <form key={kind} onSubmit={onAdd} className="space-y-3">
            {kind === 'email' && (
              <>
                <Field name="email" label="Email" type="email" required placeholder="alerts@yourdomain.com" />
                <Field name="label" label="Label (optional)" placeholder="Primary" />
              </>
            )}
            {kind === 'slack' && (
              <>
                <Field name="webhookUrl" label="Incoming webhook URL" required placeholder="https://hooks.slack.com/services/…" />
                <Field name="label" label="Label (optional)" placeholder="#alerts" />
              </>
            )}
            {kind === 'ntfy' && (
              <>
                <Field name="url" label="ntfy server" required placeholder="https://ntfy.sh" />
                <Field name="topic" label="Topic" required placeholder="mxwatch-alerts-xyz" />
                <Field name="token" label="Access token (optional)" placeholder="tk_…" />
                <Field name="label" label="Label (optional)" placeholder="ntfy phone" />
              </>
            )}
            {kind === 'webhook' && (
              <>
                <Field name="url" label="POST URL" required placeholder="https://example.com/hooks/mxwatch" />
                <Field name="secret" label="Bearer token (optional)" placeholder="sent as Authorization header" />
                <Field name="label" label="Label (optional)" />
              </>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={addEmail.isPending || addSlack.isPending || addNtfy.isPending || addWebhook.isPending}>
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Channels ({channels.data?.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          {channels.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : channels.data && channels.data.length > 0 ? (
            <div className="divide-y divide-border">
              {channels.data.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{c.label ?? c.type}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="uppercase">{c.type}</span>
                      {!c.isActive && <span className="ml-2">· paused</span>}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {testMsg[c.id] && <span className="text-xs text-muted-foreground">{testMsg[c.id]}</span>}
                    {c.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="outline">Paused</Badge>}
                    <Button size="sm" variant="outline" onClick={() => onTest(c.id)} disabled={sendTest.isPending}>
                      Test
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleActive.mutate({ id: c.id, isActive: !c.isActive })}
                      disabled={toggleActive.isPending}
                    >
                      {c.isActive ? 'Pause' : 'Resume'}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        if (confirm('Remove this channel? Alerts will no longer be delivered here.')) {
                          removeChannel.mutate({ id: c.id });
                        }
                      }}
                      disabled={removeChannel.isPending}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No channels yet. Add one above to start receiving alerts.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ name, label, type, required, placeholder }: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type ?? 'text'} required={required} placeholder={placeholder} />
    </div>
  );
}
