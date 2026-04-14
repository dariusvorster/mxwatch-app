import type { Alert, WebhookChannelConfig } from '@mxwatch/types';

export async function sendWebhookAlert(cfg: WebhookChannelConfig, alert: Alert): Promise<void> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.secret) headers.Authorization = `Bearer ${cfg.secret}`;
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...alert,
      firedAt: alert.firedAt.toISOString(),
    }),
  });
  if (!res.ok) {
    throw new Error(`Webhook returned ${res.status} ${res.statusText}`);
  }
}
