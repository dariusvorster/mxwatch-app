'use client';

export function ScoreSparkline({
  values,
  width = 120,
  height = 28,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) {
    return (
      <div style={{ width, height, fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {values.length === 0 ? '— no history' : '— 1 data point'}
      </div>
    );
  }
  const pad = 2;
  const min = Math.min(...values, 60);
  const max = Math.max(...values, 100);
  const range = Math.max(1, max - min);
  const step = (width - pad * 2) / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = pad + i * step;
      const y = height - pad - ((v - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const last = values[values.length - 1]!;
  const first = values[0]!;
  const stroke =
    last >= 80 ? 'var(--green)' : last >= 60 ? 'var(--amber)' : 'var(--red)';
  const trend = last - first;
  const trendColor = trend > 1 ? 'var(--green)' : trend < -1 ? 'var(--red)' : 'var(--text3)';

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <svg width={width} height={height} style={{ display: 'block' }}>
        <polyline
          points={points}
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: trendColor }}>
        {trend > 0 ? '↑' : trend < 0 ? '↓' : '·'}
        {Math.abs(Math.round(trend))}
      </span>
    </div>
  );
}
