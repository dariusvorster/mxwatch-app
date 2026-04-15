import { grabSMTPBanner } from '../server-detect';
import type {
  AdapterConfig, AdapterTestResult, AuthFailureEvent, DeliveryEvent,
  MailServerAdapter, QueueStats, RecipientDomainStat, ServerStats,
} from './types';
import { AdapterUnsupportedError } from './types';

/**
 * Maddy adapter. Maddy is a single-binary Go SMTP server with no first-class
 * HTTP management API — operators run `maddyctl` over a Unix socket. From
 * outside the host all we can do reliably is the SMTP banner check; deep
 * stats need either log shipping (future) or a maddyctl bridge (out of scope
 * for V4.1).
 */
export class MaddyAdapter implements MailServerAdapter {
  readonly type = 'maddy' as const;
  readonly displayName = 'Maddy';

  async test(config: AdapterConfig): Promise<AdapterTestResult> {
    const raw = config.baseUrl.replace(/^\w+:\/\//, '').replace(/\/.*$/, '');
    const [host, portStr] = raw.split(':');
    const port = portStr ? Number(portStr) : 25;
    if (!host) return { ok: false, message: 'Missing host (provide host[:port] in baseUrl)' };
    const result = await grabSMTPBanner(host, port);
    if (!result.banner) return { ok: false, message: 'No SMTP banner from Maddy host' };
    if (!/maddy/i.test(result.banner)) {
      return { ok: false, message: `Banner did not advertise Maddy: ${result.banner.slice(0, 80)}` };
    }
    return { ok: true, message: `Maddy responding — ${result.banner.slice(0, 80)}` };
  }

  async getStats(): Promise<ServerStats> {
    throw new AdapterUnsupportedError('MaddyAdapter', 'getStats');
  }
  async getQueue(): Promise<QueueStats> {
    throw new AdapterUnsupportedError('MaddyAdapter', 'getQueue');
  }
  async getDeliveryEvents(): Promise<DeliveryEvent[]> {
    throw new AdapterUnsupportedError('MaddyAdapter', 'getDeliveryEvents');
  }
  async getAuthFailures(): Promise<AuthFailureEvent[]> {
    throw new AdapterUnsupportedError('MaddyAdapter', 'getAuthFailures');
  }
  async getRecipientDomainStats(): Promise<RecipientDomainStat[]> {
    throw new AdapterUnsupportedError('MaddyAdapter', 'getRecipientDomainStats');
  }
}
