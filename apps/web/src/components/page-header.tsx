import * as React from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}

export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
      <div>
        <h1
          style={{
            fontFamily: 'var(--sans)',
            fontSize: 22,
            fontWeight: 600,
            color: 'var(--text)',
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <div
            style={{
              fontFamily: 'var(--sans)',
              fontSize: 12,
              color: 'var(--text3)',
              marginTop: 4,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}
