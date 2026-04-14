import * as React from 'react';

type IconProps = React.SVGProps<SVGSVGElement> & { size?: number };

function svg(
  path: React.ReactNode,
  defaults?: { viewBox?: string; fill?: string; stroke?: string; strokeWidth?: number },
) {
  return function Icon({ size = 14, ...props }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox={defaults?.viewBox ?? '0 0 24 24'}
        fill={defaults?.fill ?? 'none'}
        stroke={defaults?.stroke ?? 'currentColor'}
        strokeWidth={defaults?.strokeWidth ?? 1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {path}
      </svg>
    );
  };
}

export const IconPulse = svg(
  <polyline points="3 12 7 12 9 6 13 18 15 10 17 12 21 12" />,
);
export const IconDashboard = svg(
  <>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </>,
);
export const IconActivity = svg(<polyline points="3 12 7 12 10 5 14 19 17 12 21 12" />);
export const IconGlobe = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
  </>,
);
export const IconShield = svg(<path d="M12 3 4 6v6c0 4.5 3.3 7.9 8 9 4.7-1.1 8-4.5 8-9V6l-8-3z" />);
export const IconMail = svg(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 7l9 6 9-6" />
  </>,
);
export const IconCert = svg(
  <>
    <rect x="3" y="4" width="18" height="12" rx="1.5" />
    <path d="M8 20l2-3 2 2 2-2 2 3" />
    <path d="M7 9h10M7 12h6" />
  </>,
);
export const IconBell = svg(
  <>
    <path d="M6 8a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </>,
);
export const IconHistory = svg(
  <>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <polyline points="3 3 3 8 8 8" />
    <path d="M12 7v5l3 2" />
  </>,
);
export const IconMoon = svg(<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />);
export const IconSun = svg(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>,
);
export const IconPlus = svg(<path d="M12 5v14M5 12h14" />);
export const IconSettings = svg(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.4 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 4.4l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </>,
);
export const IconDot = svg(<circle cx="12" cy="12" r="4" />, { fill: 'currentColor', stroke: 'none' });
export const IconCheck = svg(<polyline points="4 12 10 18 20 6" />);
