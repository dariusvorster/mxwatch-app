'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { DmarcSetup } from '@/components/dmarc-setup';
import { BrandMark } from '@/components/brand-mark';

const step1Schema = z.object({
  domain: z.string().trim().toLowerCase().regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i, 'Invalid domain'),
  dkimSelector: z.string().trim().min(1).max(64).default('mail'),
});
const step3Schema = z.object({ email: z.string().email() });

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [createdDomain, setCreatedDomain] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createDomain = trpc.domains.create.useMutation();
  const addChannel = trpc.alerts.addEmailChannel.useMutation();
  const smtp = trpc.settings.smtpConfig.useQuery(undefined, { enabled: step >= 2 });

  async function onStep1(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const parsed = step1Schema.safeParse({
      domain: fd.get('domain'),
      dkimSelector: fd.get('dkimSelector') || 'mail',
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Invalid input');
    try {
      await createDomain.mutateAsync(parsed.data);
      setCreatedDomain(parsed.data.domain);
      setStep(2);
    } catch (e: any) {
      setError(e.message ?? 'Failed to add domain');
    }
  }

  async function onStep3(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const parsed = step3Schema.safeParse({ email: fd.get('email') });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Invalid email');
    try {
      await addChannel.mutateAsync({ email: parsed.data.email, label: 'Primary email' });
      router.push('/');
    } catch (e: any) {
      setError(e.message ?? 'Failed to set alert email');
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-5">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <BrandMark size={22} />
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
          Step {step} of 3
        </div>
      </div>
      <h1 style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
        Welcome to MxWatch
      </h1>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Add your first domain</CardTitle>
            <CardDescription>We'll check SPF, DKIM, DMARC and blacklists immediately.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onStep1} className="space-y-4">
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
              <Button type="submit" disabled={createDomain.isPending}>
                {createDomain.isPending ? 'Adding…' : 'Continue'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Configure DMARC reporting</CardTitle>
            <CardDescription>
              Publish this TXT record so aggregate reports start flowing into MxWatch. You can skip and come back
              to this from <code>Settings → SMTP ingest</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {smtp.data ? (
              <DmarcSetup smtp={smtp.data} domain={createdDomain ?? undefined} />
            ) : (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(3)}>Skip</Button>
              <Button onClick={() => setStep(3)}>Continue</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Where should we send alerts?</CardTitle>
            <CardDescription>We'll email you when something breaks.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onStep3} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Alert email</Label>
                <Input id="email" name="email" type="email" required />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={addChannel.isPending}>
                {addChannel.isPending ? 'Saving…' : 'Finish'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
