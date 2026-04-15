'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useSession } from '@/lib/auth-client';
import { SummaryCard } from '@/components/summary-card';
import { StatusBadge } from '@/components/status-badge';
import { ScoreRing, scoreTier } from '@/components/score-ring';
import { AlertRow } from '@/components/alert-row';
import { IconBell, IconShield, IconActivity } from '@/components/icons';
import { humanizeAlertType, severityFor, relativeTime } from '@/lib/alert-display';

import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@/server/routers/_app';
type DomainRow = inferRouterOutputs<AppRouter>['domains']['list'][number];

export default function DashboardPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const domains = trpc.domains.list.useQuery(undefined, { enabled: !!session });
  const activeAlerts = trpc.alerts.history.useQuery({ onlyActive: true }, { enabled: !!session });
  const onboarding = trpc.onboarding.status.useQuery(undefined, { enabled: !!session });

  // Per-domain latest DNS snapshot + blacklist check — fan out with useQueries.
  const snapQueries = trpc.useQueries((t) =>
    (domains.data ?? []).map((d) => t.checks.latestDns({ domainId: d.id }, { enabled: !!session }))
  );
  const blQueries = trpc.useQueries((t) =>
    (domains.data ?? []).map((d) => t.checks.latestBlacklist({ domainId: d.id }, { enabled: !!session }))
  );
  const smtpQueries = trpc.useQueries((t) =>
    (domains.data ?? []).map((d) => t.checks.latestSmtp({ domainId: d.id }, { enabled: !!session }))
  );

  useEffect(() => {
    if (!isPending && !session) router.push('/login');
  }, [isPending, session, router]);

  useEffect(() => {
    if (onboarding.data && onboarding.data.step === 0) router.replace('/onboarding');
  }, [onboarding.data, router]);

  if (isPending || !session) return <main>Loading…</main>;

  const domainList = domains.data ?? [];

  // Summary metrics
  const scores = snapQueries
    .map((q) => (q.data?.healthScore ?? null) as number | null)
    .filter((n): n is number => n != null);
  const overallScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const healthyCount = scores.filter((s) => s >= 80).length;
  const issuesCount = scores.filter((s) => s < 80).length;

  // RBL status — count current listings across all domains' latest checks
  let listedCount = 0;
  for (const q of blQueries) {
    const rows = q.data ?? [];
    if (rows.length > 0 && rows[0]?.isListed) listedCount += 1;
  }

  // DMARC reports total (placeholder: derive from domain count; real aggregate
  // would need a new endpoint which is out of scope for the redesign phase).
  const dmarcDomains = domainList.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <PageTitle
        title="Dashboard"
        subtitle={`${domainList.length} domain${domainList.length === 1 ? '' : 's'} monitored`}
      />

      {onboarding.data && onboarding.data.step > 0 && onboarding.data.step < 4 && (
        <Link
          href="/onboarding"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 16px',
            background: 'var(--blue-dim)',
            border: '1px solid var(--blue-border)',
            borderRadius: 'var(--radius)',
            color: 'var(--text)',
            textDecoration: 'none',
          }}
        >
          <div>
            <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 500 }}>
              Continue setup — step {onboarding.data.step + 1} of 4
            </div>
            <div style={{ fontFamily: 'var(--sans)', fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              Finish configuring architecture, server integration, and alerts.
            </div>
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--blue)' }}>Resume →</div>
        </Link>
      )}

      {/* Summary row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 12,
        }}
      >
        <SummaryCard
          label="Overall health"
          value={overallScore != null ? overallScore : '—'}
          valueScore={overallScore ?? undefined}
          subtext={scores.length > 0 ? `across ${scores.length} domain${scores.length === 1 ? '' : 's'}` : 'awaiting first checks'}
        />
        <SummaryCard
          label="Domains"
          value={domainList.length}
          valueTone="blue"
          subtext={
            <span>
              <span style={{ color: 'var(--green)' }}>{healthyCount} healthy</span>
              {' · '}
              <span style={{ color: issuesCount > 0 ? 'var(--red)' : 'var(--text3)' }}>{issuesCount} issues</span>
            </span>
          }
        />
        <SummaryCard
          label="RBL status"
          value={listedCount}
          valueTone={listedCount > 0 ? 'red' : 'green'}
          subtext={listedCount > 0 ? `${listedCount} IP${listedCount === 1 ? '' : 's'} listed` : 'all clean'}
        />
        <SummaryCard
          label="DMARC reports"
          value={dmarcDomains}
          valueTone="blue"
          subtext="domains ingesting"
        />
      </div>

      {/* Domain grid */}
      <section>
        <SectionLabel>Domains</SectionLabel>
        {domainList.length === 0 ? (
          <EmptyCard message="No domains yet." cta={{ href: '/onboarding', label: 'Add your first domain' }} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            {domainList.map((d, i) => (
              <DomainHealthCard
                key={d.id}
                domain={d}
                snap={snapQueries[i]?.data as any}
                blacklist={blQueries[i]?.data as any}
                smtp={smtpQueries[i]?.data as any}
              />
            ))}
          </div>
        )}
      </section>

      {/* Active alerts */}
      <section>
        <SectionLabel>Active alerts</SectionLabel>
        {activeAlerts.data && activeAlerts.data.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activeAlerts.data.map((a) => (
              <AlertRow
                key={a.id}
                tone={alertTone(severityFor(a.type))}
                title={<>{humanizeAlertType(a.type)} — <Link href={`/domains/${a.domainId}`} style={{ textDecoration: 'underline' }}>{a.domainName}</Link></>}
                subtitle={a.message}
                timestamp={relativeTime(a.firedAt)}
                icon={iconForType(a.type)}
                action={{ href: `/domains/${a.domainId}`, label: 'Open' }}
              />
            ))}
          </div>
        ) : (
          <div
            style={{
              background: 'var(--surf)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '16px 18px',
              fontFamily: 'var(--sans)',
              fontSize: 13,
              color: 'var(--text3)',
            }}
          >
            No active alerts.
          </div>
        )}
      </section>
    </div>
  );
}

function alertTone(sev: ReturnType<typeof severityFor>): 'critical' | 'warning' | 'info' {
  if (sev === 'critical' || sev === 'high') return 'critical';
  if (sev === 'medium') return 'warning';
  return 'info';
}

function iconForType(type: string) {
  if (type === 'blacklist_listed') return <IconShield size={14} />;
  if (type === 'dmarc_fail_spike' || type === 'dmarc_report_received') return <IconBell size={14} />;
  return <IconActivity size={14} />;
}

function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h1 style={{ fontFamily: 'var(--sans)', fontSize: 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
        {title}
      </h1>
      {subtitle && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--sans)',
        fontSize: 10,
        fontWeight: 600,
        color: 'var(--text3)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

function EmptyCard({ message, cta }: { message: string; cta?: { href: string; label: string } }) {
  return (
    <div
      style={{
        background: 'var(--surf)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '22px 20px',
        textAlign: 'center',
        color: 'var(--text3)',
        fontFamily: 'var(--sans)',
        fontSize: 13,
      }}
    >
      {message}
      {cta && (
        <>
          {' '}
          <Link href={cta.href} style={{ color: 'var(--blue)', fontWeight: 500 }}>{cta.label}</Link>
        </>
      )}
    </div>
  );
}

/* ---------- Domain health card ---------- */

type Snap = {
  healthScore: number | null;
  checkedAt: Date;
  spfValid: boolean | null;
  dkimValid: boolean | null;
  dmarcValid: boolean | null;
  dmarcPolicy: 'none' | 'quarantine' | 'reject' | null;
} | null;

type BlacklistRow = {
  id: string;
  isListed: boolean | null;
  listedOn: string | null;
  checkedAt: Date;
} | null;

type SmtpRow = {
  connected: boolean | null;
  tlsVersion: string | null;
  responseTimeMs: number | null;
  error: string | null;
} | null;

function DomainHealthCard({
  domain,
  snap,
  blacklist,
  smtp,
}: {
  domain: DomainRow;
  snap?: Snap;
  blacklist?: BlacklistRow[];
  smtp?: SmtpRow;
}) {
  const score = snap?.healthScore ?? null;
  const tier = score != null ? scoreTier(score) : 'good';
  const accent =
    score == null ? 'var(--border)' :
    tier === 'bad' ? 'var(--red)' :
    tier === 'warn' ? 'var(--amber)' :
    'var(--green)';

  const latest = blacklist?.[0];
  const rblListed = latest?.isListed ? (JSON.parse(latest.listedOn ?? '[]') as string[]).length : 0;
  const rblChecked = !!latest;

  return (
    <Link
      href={`/domains/${domain.id}`}
      style={{
        display: 'block',
        background: 'var(--surf)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        transition: 'border-color 120ms ease',
      }}
    >
      {/* Left accent bar */}
      <div style={{ display: 'flex' }}>
        <div style={{ width: 3, background: accent }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Header */}
          <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <ScoreRing score={score ?? 0} size={44} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600,
                  color: 'var(--text)', letterSpacing: '-0.01em',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}
              >
                {domain.domain}
              </div>
              <div style={{ fontFamily: 'var(--sans)', fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>
                {snap?.checkedAt ? `checked ${relativeTime(snap.checkedAt)}` : 'awaiting first check'}
              </div>
            </div>
            {score == null ? (
              <StatusBadge tone="neutral">pending</StatusBadge>
            ) : tier === 'bad' ? (
              <StatusBadge tone="critical">critical</StatusBadge>
            ) : tier === 'warn' ? (
              <StatusBadge tone="warning">warning</StatusBadge>
            ) : (
              <StatusBadge tone="healthy">healthy</StatusBadge>
            )}
          </div>

          {/* Checks grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              borderTop: '1px solid var(--border)',
            }}
          >
            <CheckCell label="SPF" ok={snap?.spfValid} />
            <CheckCell label="DKIM" ok={snap?.dkimValid} divider />
            <CheckCell
              label="DMARC"
              ok={snap?.dmarcValid}
              note={snap?.dmarcPolicy ? `p=${snap.dmarcPolicy}` : undefined}
              divider
            />
            <CheckCell
              label="SMTP"
              ok={smtp == null ? null : smtp.error ? false : !!smtp.connected}
              note={smtp?.tlsVersion ?? (smtp?.responseTimeMs != null ? `${smtp.responseTimeMs}ms` : undefined)}
              divider
            />
          </div>

          {/* Footer */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 16px',
              background: 'var(--bg)',
              borderTop: '1px solid var(--border)',
              fontFamily: 'var(--mono)',
              fontSize: 10,
              color: 'var(--text3)',
            }}
          >
            <span>
              {snap?.checkedAt ? `checked ${relativeTime(snap.checkedAt)}` : '—'}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {!rblChecked ? (
                <span>RBL: —</span>
              ) : rblListed > 0 ? (
                <span style={{ color: 'var(--red)' }}>⚠ {rblListed} listed</span>
              ) : (
                <span style={{ color: 'var(--green)' }}>✓ clean</span>
              )}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function CheckCell({ label, ok, note, divider }: {
  label: string;
  ok?: boolean | null;
  note?: string;
  divider?: boolean;
}) {
  const color = ok === true ? 'var(--green)' : ok === false ? 'var(--red)' : 'var(--text3)';
  const value = ok === true ? 'pass' : ok === false ? 'fail' : note ?? '—';
  return (
    <div
      style={{
        padding: '10px 12px',
        borderLeft: divider ? '1px solid var(--border)' : 'none',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--sans)',
          fontSize: 9,
          fontWeight: 600,
          color: 'var(--text3)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 11,
          fontWeight: 500,
          color,
          marginTop: 3,
        }}
      >
        {note && ok !== null ? note : value}
      </div>
    </div>
  );
}
