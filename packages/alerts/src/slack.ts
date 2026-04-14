import type { Alert, SlackChannelConfig } from '@mxwatch/types';

const SEVERITY_EMOJI: Record<Alert['severity'], string> = {
  critical: ':rotating_light:',
  high: ':warning:',
  medium: ':large_yellow_circle:',
  low: ':information_source:',
};

export async function sendSlackAlert(cfg: SlackChannelConfig, alert: Alert): Promise<void> {
  const emoji = SEVERITY_EMOJI[alert.severity] ?? '';
  const payload = {
    text: `${emoji} *MxWatch — ${alert.domainName}*\n*${alert.type}* (${alert.severity})\n${alert.message}`,
  };
  const res = await fetch(cfg.webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook returned ${res.status} ${res.statusText}`);
  }
}
