import type { AlertType, Severity } from '@mxwatch/types';

export function severityFor(type: string): Severity {
  switch (type as AlertType) {
    case 'blacklist_listed':
      return 'critical';
    case 'health_score_drop':
      return 'high';
    case 'dns_record_changed':
      return 'medium';
    case 'dmarc_fail_spike':
      return 'medium';
    case 'dmarc_report_received':
      return 'low';
    default:
      return 'medium';
  }
}

const TYPE_LABELS: Record<string, string> = {
  blacklist_listed: 'Blacklist listed',
  dns_record_changed: 'DNS record changed',
  dmarc_fail_spike: 'DMARC fail spike',
  health_score_drop: 'Health score drop',
  dmarc_report_received: 'DMARC report received',
};

export function humanizeAlertType(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

export function severityBorderClass(sev: Severity): string {
  switch (sev) {
    case 'critical': return 'border-l-4 border-l-[hsl(0_84%_60%)]';
    case 'high':     return 'border-l-4 border-l-[hsl(25_95%_53%)]';
    case 'medium':   return 'border-l-4 border-l-[hsl(38_92%_50%)]';
    case 'low':      return 'border-l-4 border-l-[hsl(210_40%_60%)]';
  }
}

export function relativeTime(date: Date | string | number): string {
  const t = new Date(date).getTime();
  const diff = Date.now() - t;
  if (diff < 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(date).toLocaleDateString();
}
