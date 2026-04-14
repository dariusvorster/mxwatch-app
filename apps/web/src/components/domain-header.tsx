'use client';
import Link from 'next/link';
import { ScoreRing, scoreTier } from '@/components/score-ring';
import { StatusBadge } from '@/components/status-badge';
import { IconDot } from '@/components/icons';

export interface DomainHeaderProps {
  domain: string;
  score: number | null;
  mailServer?: string | null;
  sendingIp?: string | null;
  authTone: 'healthy' | 'warning' | 'critical' | 'neutral';
  authLabel: string;
  rblTone: 'healthy' | 'warning' | 'critical' | 'neutral';
  rblLabel: string;
  smtpTone?: 'healthy' | 'warning' | 'critical' | 'neutral';
  smtpLabel?: string;
  onRunChecks?: () => void;
  runChecksPending?: boolean;
}

function dotColor(tone: 'healthy' | 'warning' | 'critical' | 'neutral'): string {
  if (tone === 'healthy') return 'var(--green)';
  if (tone === 'warning') return 'var(--amber)';
  if (tone === 'critical') return 'var(--red)';
  return 'var(--text3)';
}

function MetaItem({ tone, label }: { tone: 'healthy' | 'warning' | 'critical' | 'neutral'; label: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'var(--sans)',
        fontSize: 12,
        color: 'var(--text2)',
      }}
    >
      <IconDot size={8} style={{ color: dotColor(tone) }} />
      {label}
    </span>
  );
}

export function DomainHeader(props: DomainHeaderProps) {
  const { domain, score, mailServer, sendingIp, authTone, authLabel, rblTone, rblLabel, smtpTone = 'neutral', smtpLabel = 'SMTP —' } = props;
  const tier = score != null ? scoreTier(score) : null;
  const headline: Parameters<typeof StatusBadge>[0]['tone'] =
    tier === 'bad' ? 'critical' : tier === 'warn' ? 'warning' : tier === 'good' ? 'healthy' : 'neutral';
  const headlineLabel = tier === 'bad' ? 'critical' : tier === 'warn' ? 'warning' : tier === 'good' ? 'healthy' : 'pending';

  return (
    <div
      style={{
        background: 'var(--surf)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '20px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 20,
      }}
    >
      <ScoreRing score={score ?? 0} size={64} strokeWidth={5} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--text)',
              letterSpacing: '-0.01em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {domain}
          </h1>
          <StatusBadge tone={headline}>{headlineLabel}</StatusBadge>
        </div>
        {(mailServer || sendingIp) && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
            {mailServer ?? '—'}
            {sendingIp && <span style={{ marginLeft: 8 }}>· {sendingIp}</span>}
          </div>
        )}
        <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
          <MetaItem tone={authTone} label={authLabel} />
          <MetaItem tone={rblTone} label={rblLabel} />
          <MetaItem tone={smtpTone} label={smtpLabel} />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
        <button
          type="button"
          onClick={props.onRunChecks}
          disabled={props.runChecksPending}
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 12,
            fontWeight: 600,
            padding: '8px 14px',
            borderRadius: 7,
            background: 'var(--blue)',
            color: '#fff',
            border: '1px solid var(--blue)',
            cursor: 'pointer',
            opacity: props.runChecksPending ? 0.7 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          {props.runChecksPending ? 'Running…' : 'Run checks'}
        </button>
        <Link
          href="/settings"
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 12,
            fontWeight: 600,
            padding: '8px 14px',
            borderRadius: 7,
            background: 'transparent',
            color: 'var(--text2)',
            border: '1px solid var(--border2)',
            textAlign: 'center',
            whiteSpace: 'nowrap',
          }}
        >
          Settings
        </Link>
      </div>
    </div>
  );
}
