'use client';
import * as React from 'react';
import Link from 'next/link';

export type AlertRowTone = 'critical' | 'warning' | 'info';

const TONES: Record<AlertRowTone, {
  bg: string; border: string; title: string; icon: string; iconBg: string;
}> = {
  critical: {
    bg: 'var(--red-dim)', border: 'var(--red-border)',
    title: 'var(--red)', icon: '#fff', iconBg: 'var(--red)',
  },
  warning: {
    bg: 'var(--amber-dim)', border: 'var(--amber-border)',
    title: 'var(--amber)', icon: '#fff', iconBg: 'var(--amber)',
  },
  info: {
    bg: 'var(--blue-dim)', border: 'var(--blue-border)',
    title: 'var(--blue)', icon: '#fff', iconBg: 'var(--blue)',
  },
};

export interface AlertRowProps {
  tone?: AlertRowTone;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Short mono timestamp e.g. "2h ago". */
  timestamp?: string;
  /** Icon element (typically from components/icons). Rendered 14×14 inside a 28×28 square. */
  icon?: React.ReactNode;
  /** Primary action — either a button (onClick) or a link (href). */
  action?:
    | { label: string; onClick: () => void; disabled?: boolean }
    | { label: string; href: string };
}

export function AlertRow({ tone = 'critical', title, subtitle, timestamp, icon, action }: AlertRowProps) {
  const t = TONES[tone];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: 10,
        padding: '12px 14px',
      }}
    >
      <div
        style={{
          width: 28, height: 28, flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: t.iconBg, color: t.icon,
          borderRadius: 8,
        }}
        aria-hidden="true"
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 500, color: t.title }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontFamily: 'var(--sans)', fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
            {subtitle}
          </div>
        )}
      </div>
      {timestamp && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
          {timestamp}
        </div>
      )}
      {action && ('href' in action ? (
        <Link href={action.href} style={actionStyle(t.title)}>{action.label}</Link>
      ) : (
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          style={actionStyle(t.title)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

function actionStyle(color: string): React.CSSProperties {
  return {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    fontWeight: 600,
    padding: '6px 10px',
    borderRadius: 7,
    background: 'transparent',
    color,
    border: `1px solid ${color}`,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  };
}
