'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';

export default function BillingPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const status = trpc.billing.status.useQuery(undefined, { enabled: !!session });
  const checkout = trpc.billing.createCheckout.useMutation({
    onSuccess: (res) => { window.location.href = res.url; },
  });

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  if (isPending || !session) return <div>Loading…</div>;
  if (status.isLoading) return <div>Loading…</div>;

  if (!status.data?.available) {
    return (
      <div className="space-y-5" style={{ maxWidth: 700 }}>
        <PageHeader title="Billing" subtitle="Not available on self-hosted deployments." />
        <div
          style={{
            background: 'var(--surf)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '18px 20px',
            fontFamily: 'var(--sans)',
            fontSize: 13,
            color: 'var(--text2)',
          }}
        >
          This MxWatch instance runs in self-hosted mode. Every feature is free and unlimited.
        </div>
      </div>
    );
  }

  if (!status.data.configured) {
    return (
      <div className="space-y-5" style={{ maxWidth: 700 }}>
        <PageHeader title="Billing" subtitle="Cloud mode is enabled but the billing provider is not wired up." />
        <div
          style={{
            background: 'var(--surf)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '18px 20px',
            fontFamily: 'var(--sans)',
            fontSize: 13,
            color: 'var(--text2)',
          }}
        >
          Set <code>LEMONSQUEEZY_API_KEY</code>, <code>LEMONSQUEEZY_STORE_ID</code>, and <code>LEMONSQUEEZY_WEBHOOK_SECRET</code> in the environment to activate checkout.
        </div>
      </div>
    );
  }

  const sub = status.data.subscription;
  const plans = status.data.plans!;
  const activeTier = sub?.tier ?? 'self_hosted';

  return (
    <div className="space-y-5" style={{ maxWidth: 820 }}>
      <PageHeader title="Billing" subtitle="Manage your MxWatch Cloud subscription." />

      <div
        style={{
          background: 'var(--surf)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '18px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--sans)', fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Current plan
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 24, fontWeight: 600, color: 'var(--text)', marginTop: 4 }}>
            {activeTier === 'teams' ? 'Cloud Teams' : activeTier === 'solo' ? 'Cloud Solo' : 'Self-hosted'}
          </div>
          {sub && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
              status {sub.status}
              {sub.renewsAt && <span> · renews {new Date(sub.renewsAt).toLocaleDateString()}</span>}
              {sub.endsAt && <span> · ends {new Date(sub.endsAt).toLocaleDateString()}</span>}
            </div>
          )}
        </div>
        <StatusBadge tone={activeTier === 'self_hosted' ? 'neutral' : 'healthy'}>{activeTier}</StatusBadge>
        {sub?.customerPortalUrl && (
          <a
            href={sub.customerPortalUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600,
              padding: '8px 14px', borderRadius: 7,
              background: 'transparent', color: 'var(--text2)',
              border: '1px solid var(--border2)',
            }}
          >
            Manage
          </a>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        {([
          ['solo', plans.solo, 'Up to 10 domains. Hosted, managed, email and Slack alerts.'],
          ['teams', plans.teams, 'Unlimited domains. API access. Team members (once released).'],
        ] as const).map(([tier, plan, description]) => {
          if (!plan) return null;
          const current = activeTier === tier;
          return (
            <div
              key={tier}
              style={{
                background: 'var(--surf)',
                border: `1px solid ${current ? 'var(--blue-border)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)',
                padding: '16px 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 600 }}>{plan.label}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 600 }}>{plan.price}</div>
              <div style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--text3)' }}>{description}</div>
              {current ? (
                <StatusBadge tone="healthy">current plan</StatusBadge>
              ) : (
                <button
                  type="button"
                  onClick={() => checkout.mutate({ tier })}
                  disabled={checkout.isPending}
                  style={{
                    fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600,
                    padding: '8px 14px', borderRadius: 7,
                    background: 'var(--blue)', color: '#fff', border: '1px solid var(--blue)',
                    cursor: 'pointer', alignSelf: 'flex-start',
                  }}
                >
                  {checkout.isPending ? 'Redirecting…' : `Upgrade to ${plan.label}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
