import * as React from 'react';

export type BadgeTone = 'healthy' | 'warning' | 'critical' | 'info' | 'neutral';

const TONES: Record<BadgeTone, { bg: string; color: string; border: string }> = {
  healthy:  { bg: 'var(--green-dim)', color: 'var(--green)', border: 'var(--green-border)' },
  warning:  { bg: 'var(--amber-dim)', color: 'var(--amber)', border: 'var(--amber-border)' },
  critical: { bg: 'var(--red-dim)',   color: 'var(--red)',   border: 'var(--red-border)' },
  info:     { bg: 'var(--blue-dim)',  color: 'var(--blue)',  border: 'var(--blue-border)' },
  neutral:  { bg: 'var(--bg2)',       color: 'var(--text2)', border: 'var(--border)' },
};

export interface StatusBadgeProps {
  tone: BadgeTone;
  children: React.ReactNode;
  /** Use mono typography (for counts, codes). Defaults to Inter. */
  mono?: boolean;
  className?: string;
}

export function StatusBadge({ tone, children, mono, className }: StatusBadgeProps) {
  const t = TONES[tone];
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontFamily: mono ? 'var(--mono)' : 'var(--sans)',
        fontSize: 10,
        fontWeight: 500,
        lineHeight: 1,
        padding: '3px 8px',
        borderRadius: 10,
        background: t.bg,
        color: t.color,
        border: `1px solid ${t.border}`,
        letterSpacing: mono ? 0 : '0.02em',
        textTransform: mono ? 'none' : 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}
