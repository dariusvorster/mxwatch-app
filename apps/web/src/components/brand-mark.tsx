import { IconPulse } from '@/components/icons';

export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <IconPulse size={size} style={{ color: 'var(--blue-mid)' }} />
      <div
        style={{
          fontFamily: 'var(--mono)',
          fontWeight: 600,
          fontSize: Math.round(size * 0.8),
          letterSpacing: '-0.01em',
          display: 'flex',
          alignItems: 'baseline',
          gap: 2,
        }}
      >
        <span style={{ color: 'var(--text)' }}>mx</span>
        <span style={{ color: 'var(--blue-mid)' }}>watch</span>
      </div>
      <span
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 8,
          fontWeight: 600,
          padding: '2px 5px',
          borderRadius: 4,
          background: 'var(--blue-dim)',
          color: 'var(--blue)',
          border: '1px solid var(--blue-border)',
          letterSpacing: '0.04em',
        }}
      >
        v4
      </span>
    </div>
  );
}
