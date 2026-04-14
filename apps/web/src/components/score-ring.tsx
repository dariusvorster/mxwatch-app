import * as React from 'react';

export type ScoreTier = 'good' | 'warn' | 'bad';

export function scoreTier(score: number): ScoreTier {
  if (score >= 80) return 'good';
  if (score >= 60) return 'warn';
  return 'bad';
}

const TIER: Record<ScoreTier, { color: string; dim: string }> = {
  good: { color: 'var(--green)', dim: 'var(--green-dim)' },
  warn: { color: 'var(--amber)', dim: 'var(--amber-dim)' },
  bad:  { color: 'var(--red)',   dim: 'var(--red-dim)' },
};

export interface ScoreRingProps {
  /** 0–100 score value. */
  score: number;
  /** Outer diameter in px. Defaults to 44 (dashboard card size). */
  size?: number;
  /** Stroke width in px. Defaults scale with size. */
  strokeWidth?: number;
  /** Hide the number text inside the ring. */
  hideLabel?: boolean;
  /** Additional class on the wrapper. */
  className?: string;
}

/**
 * Circular score indicator. Single source of truth for the colour tiers
 * (green ≥80, amber 60–79, red <60). Same component is used at 44px on
 * dashboard cards and 64px on the domain detail header.
 */
export function ScoreRing({ score, size = 44, strokeWidth, hideLabel, className }: ScoreRingProps) {
  const safe = Math.max(0, Math.min(100, Math.round(score)));
  const tier = TIER[scoreTier(safe)];
  const sw = strokeWidth ?? Math.max(3, Math.round(size * 0.09));
  const radius = (size - sw) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (safe / 100) * circumference;

  // Font size scales with diameter. At 44 → 13, at 64 → ~18.
  const fontSize = Math.max(11, Math.round(size * 0.3));

  return (
    <div
      className={className}
      style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}
      aria-label={`Health score ${safe} of 100`}
      role="img"
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tier.dim}
          strokeWidth={sw}
        />
        {/* Progress arc — rotated so it starts at 12 o'clock */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tier.color}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={`${progress} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 400ms ease, stroke 200ms ease' }}
        />
      </svg>
      {!hideLabel && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--mono)',
            fontWeight: 600,
            fontSize,
            color: tier.color,
            letterSpacing: '-0.02em',
          }}
        >
          {safe}
        </div>
      )}
    </div>
  );
}

/**
 * Client-side fallback score derivation per the design spec. Useful when an
 * API response lacks a pre-computed score.
 */
export function deriveScore(input: {
  spfValid?: boolean | null;
  dkimValid?: boolean | null;
  dmarcValid?: boolean | null;
  dmarcPolicy?: 'none' | 'quarantine' | 'reject' | null;
  rblListingCount?: number;
  smtpUnreachable?: boolean;
  smtpResponseMs?: number | null;
}): number {
  let score = 100;
  if (input.spfValid === false) score -= 15;
  if (input.dkimValid === false) score -= 15;
  if (input.dmarcValid === false) score -= 20;
  else if (input.dmarcPolicy === 'none') score -= 10;
  score -= Math.max(0, input.rblListingCount ?? 0) * 12;
  if (input.smtpUnreachable) score -= 20;
  else if (input.smtpResponseMs != null && input.smtpResponseMs > 500) score -= 5;
  return Math.max(0, Math.min(100, score));
}
