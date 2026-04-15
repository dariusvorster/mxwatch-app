import { grabSMTPBanner } from '../server-detect';
import type {
  AdapterConfig, AdapterTestResult, AuthFailureEvent, DeliveryEvent,
  MailServerAdapter, QueueStats, RecipientDomainStat, ServerStats,
} from './types';
import { AdapterUnsupportedError } from './types';

/**
 * Haraka adapter. Haraka is a Node.js SMTP server with a plugin model;
 * stats / queue access is plugin-dependent and not standardised. We confirm
 * the banner identifies Haraka, then defer to log shipping (future) for
 * deeper data.
 */
export class HarakaAdapter implements MailServerAdapter {
  readonly type = 'haraka' as const;
  readonly displayName = 'Haraka';

  async test(config: AdapterConfig): Promise<AdapterTestResult> {
    const raw = config.baseUrl.replace(/^\w+:\/\//, '').replace(/\/.*$/, '');
    const [host, portStr] = raw.split(':');
    const port = portStr ? Number(portStr) : 25;
    if (!host) return { ok: false, message: 'Missing host (provide host[:port] in baseUrl)' };
    const result = await grabSMTPBanner(host, port);
    if (!result.banner) return { ok: false, message: 'No SMTP banner from Haraka host' };
    if (!/haraka/i.test(result.banner)) {
      return { ok: false, message: `Banner did not advertise Haraka: ${result.banner.slice(0, 80)}` };
    }
    return { ok: true, message: `Haraka responding — ${result.banner.slice(0, 80)}` };
  }

  async getStats(): Promise<ServerStats> {
    throw new AdapterUnsupportedError('HarakaAdapter', 'getStats');
  }
  async getQueue(): Promise<QueueStats> {
    throw new AdapterUnsupportedError('HarakaAdapter', 'getQueue');
  }
  async getDeliveryEvents(): Promise<DeliveryEvent[]> {
    throw new AdapterUnsupportedError('HarakaAdapter', 'getDeliveryEvents');
  }
  async getAuthFailures(): Promise<AuthFailureEvent[]> {
    throw new AdapterUnsupportedError('HarakaAdapter', 'getAuthFailures');
  }
  async getRecipientDomainStats(): Promise<RecipientDomainStat[]> {
    throw new AdapterUnsupportedError('HarakaAdapter', 'getRecipientDomainStats');
  }
}
