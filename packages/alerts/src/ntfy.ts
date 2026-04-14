import type { Alert, NtfyChannelConfig } from '@mxwatch/types';

const PRIORITY: Record<Alert['severity'], string> = {
  critical: 'urgent',
  high: 'high',
  medium: 'default',
  low: 'low',
};

export async function sendNtfyAlert(cfg: NtfyChannelConfig, alert: Alert): Promise<void> {
  const base = cfg.url.replace(/\/$/, '');
  const headers: Record<string, string> = {
    Title: `MxWatch: ${alert.domainName}`,
    Priority: PRIORITY[alert.severity] ?? 'default',
    Tags: `${alert.type},${alert.severity}`,
  };
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
  const res = await fetch(`${base}/${encodeURIComponent(cfg.topic)}`, {
    method: 'POST',
    headers,
    body: alert.message,
  });
  if (!res.ok) {
    throw new Error(`ntfy returned ${res.status} ${res.statusText}`);
  }
}
