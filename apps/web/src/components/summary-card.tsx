import * as React from 'react';
import { scoreTier } from '@/components/score-ring';

export type ValueTone = 'blue' | 'green' | 'amber' | 'red' | 'text';

export interface SummaryCardProps {
  label: string;
  value: React.ReactNode;
  subtext?: React.ReactNode;
  /** Applies tier colouring to the value. */
  valueTone?: ValueTone;
  /** Colour the value based on a health score (green ≥80, amber 60–79, red <60). */
  valueScore?: number;
  /** Optional trend pill in the top-right (e.g. "↑4", "↓2"). */
  trend?: { text: string; direction: 'up' | 'down' | 'flat' };
  className?: string;
}

const TONE_COLOR: Record<ValueTone, string> = {
  blue: 'var(--blue)',
  green: 'var(--green)',
  amber: 'var(--amber)',
  red: 'var(--red)',
  text: 'var(--text)',
};

function tierTone(score: number): ValueTone {
  const t = scoreTier(score);
  return t === 'good' ? 'green' : t === 'warn' ? 'amber' : 'red';
}

function trendStyle(dir: 'up' | 'down' | 'flat'): { bg: string; color: string; border: string } {
  if (dir === 'up')   return { bg: 'var(--green-dim)', color: 'var(--green)', border: 'var(--green-border)' };
  if (dir === 'down') return { bg: 'var(--red-dim)',   color: 'var(--red)',   border: 'var(--red-border)' };
  return { bg: 'var(--bg2)', color: 'var(--text2)', border: 'var(--border)' };
}

export function SummaryCard({ label, value, subtext, valueTone, valueScore, trend, className }: SummaryCardProps) {
  const tone: ValueTone = valueScore != null ? tierTone(valueScore) : (valueTone ?? 'text');
  const color = TONE_COLOR[tone];
  const ts = trend ? trendStyle(trend.direction) : null;

  return (
    <div
      className={className}
      style={{
        background: 'var(--surf)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minHeight: 90,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div
          style={{
            fontFamily: 'var(--sans)',
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--text3)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          {label}
        </div>
        {trend && ts && (
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600,
              padding: '2px 6px', borderRadius: 6,
              background: ts.bg, color: ts.color, border: `1px solid ${ts.border}`,
              lineHeight: 1,
            }}
          >
            {trend.text}
          </span>
        )}
      </div>
      <div
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 28,
          fontWeight: 600,
          lineHeight: 1.1,
          color,
          letterSpacing: '-0.02em',
        }}
      >
        {value}
      </div>
      {subtext && (
        <div style={{ fontFamily: 'var(--sans)', fontSize: 11, color: 'var(--text3)' }}>
          {subtext}
        </div>
      )}
    </div>
  );
}
