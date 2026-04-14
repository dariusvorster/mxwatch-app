'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
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

const createSchema = z.object({
  ipAddress: z.string().ip(),
  label: z.string().max(100).optional(),
  planDays: z.coerce.number().int().min(1).max(180).default(30),
  targetDailyVolume: z.coerce.number().int().min(1).max(10_000_000),
  startDate: z.string().optional(),
});

export default function WarmupPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const plans = trpc.warmup.list.useQuery(undefined, { enabled: !!session });
  const create = trpc.warmup.create.useMutation({ onSuccess: () => plans.refetch() });
  const remove = trpc.warmup.remove.useMutation({ onSuccess: () => plans.refetch() });

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) return <main className="p-6">Loading…</main>;

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const raw = {
      ipAddress: fd.get('ipAddress'),
      label: (fd.get('label') as string) || undefined,
      planDays: (fd.get('planDays') as string) || 30,
      targetDailyVolume: fd.get('targetDailyVolume'),
      startDate: (fd.get('startDate') as string) || undefined,
    };
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Invalid input');
    try {
      const startDate = parsed.data.startDate ? new Date(parsed.data.startDate) : undefined;
      await create.mutateAsync({ ...parsed.data, startDate });
      form.reset();
    } catch (err: any) {
      setError(err.message ?? 'Failed to create plan');
    }
  }

  return (
    <div className="space-y-6" style={{ maxWidth: 900 }}>
      <PageHeader
        title="IP warm-up"
        subtitle="Ramp send volume gradually on a new sending IP so receivers learn your reputation without the first big burst looking like spam."
      />

      <Card>
        <CardHeader>
          <CardTitle>New plan</CardTitle>
          <CardDescription>Geometric ramp from 50 msgs/day to your target over the plan window.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onCreate} className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ipAddress">Sending IP</Label>
              <Input id="ipAddress" name="ipAddress" placeholder="185.199.108.153" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="label">Label (optional)</Label>
              <Input id="label" name="label" placeholder="stalwart-primary" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="targetDailyVolume">Target daily volume</Label>
              <Input id="targetDailyVolume" name="targetDailyVolume" type="number" min={1} placeholder="10000" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="planDays">Plan length (days)</Label>
              <Input id="planDays" name="planDays" type="number" min={1} max={180} defaultValue={30} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="startDate">Start date (optional — defaults to today)</Label>
              <Input id="startDate" name="startDate" type="date" />
            </div>
            {error && <p className="md:col-span-2 text-sm text-destructive">{error}</p>}
            <div className="md:col-span-2">
              <Button type="submit" disabled={create.isPending}>Create plan</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {plans.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : plans.data && plans.data.length > 0 ? (
          plans.data.map((p) => <PlanCard key={p.id} plan={p} onRemove={() => remove.mutate({ id: p.id })} />)
        ) : (
          <p className="text-sm text-muted-foreground">No plans yet.</p>
        )}
      </div>
    </div>
  );
}

import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@/server/routers/_app';
type PlanRow = inferRouterOutputs<AppRouter>['warmup']['list'][number];

function PlanCard({ plan, onRemove }: { plan: PlanRow; onRemove: () => void }) {
  const { progress, actualToday, utilisation } = plan;
  const pct = progress.todayTarget > 0 && actualToday != null
    ? Math.min(1.5, actualToday / progress.todayTarget)
    : 0;
  const barPct = Math.min(100, pct * 100);
  const overshoot = utilisation != null && utilisation > 1.2;
  const undershoot = utilisation != null && utilisation > 0 && utilisation < 0.3 && progress.status === 'in_progress';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="font-mono text-base">{plan.ipAddress}</span>
            {plan.label && <span className="ml-2 text-sm font-normal text-muted-foreground">{plan.label}</span>}
          </span>
          {progress.status === 'graduated' ? <Badge variant="success">Graduated</Badge> :
           progress.status === 'not_started' ? <Badge variant="outline">Not started</Badge> :
           overshoot ? <Badge variant="destructive">Over target</Badge> :
           undershoot ? <Badge variant="warning">Under target</Badge> :
           <Badge variant="success">On track</Badge>}
        </CardTitle>
        <CardDescription>
          Day {Math.max(0, progress.dayIndex)} of {progress.planDays} · target {plan.targetDailyVolume.toLocaleString()} msgs/day
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 text-sm md:grid-cols-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Today's target</p>
            <p className="text-lg font-bold tabular-nums">{progress.todayTarget.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Sent today</p>
            <p className="text-lg font-bold tabular-nums">{actualToday.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Utilisation</p>
            <p className="text-lg font-bold tabular-nums">{utilisation != null ? `${(utilisation * 100).toFixed(0)}%` : '—'}</p>
          </div>
        </div>
        {progress.todayTarget > 0 && (
          <div className="h-2 w-full overflow-hidden rounded bg-muted">
            <div
              className="h-full transition-all"
              style={{
                width: `${barPct}%`,
                background: overshoot ? 'hsl(0 84% 60%)' : undershoot ? 'hsl(38 92% 50%)' : 'hsl(142 71% 45%)',
              }}
            />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Started {new Date(plan.startDate).toLocaleDateString()} ·{' '}
          {actualToday === 0 && 'No outbound events from this IP in the last 24h. '}
          Sent count comes from ingested mail-log events; set up log ingestion on a domain to see real numbers.
        </p>
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="destructive"
            onClick={() => { if (confirm('Remove this warm-up plan?')) onRemove(); }}
          >
            Remove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
