import type { MailServerType } from '../server-detect';
import { grabSMTPBanner } from '../server-detect';
import type {
  AdapterConfig, AdapterTestResult, AuthFailureEvent, DeliveryEvent,
  MailServerAdapter, QueueStats, RecipientDomainStat, ServerStats,
} from './types';
import { AdapterUnsupportedError } from './types';

/**
 * Fallback adapter used when the detected server has no management API
 * MxWatch can talk to (or the type is unknown). Only the SMTP banner test
 * is meaningful — all other capabilities throw AdapterUnsupportedError.
 */
export class GenericSMTPAdapter implements MailServerAdapter {
  readonly type: MailServerType = 'unknown';
  readonly displayName = 'Generic SMTP (external monitoring only)';

  async test(config: AdapterConfig): Promise<AdapterTestResult> {
    // baseUrl is treated as host:port here — strip scheme if someone passed a URL.
    const raw = config.baseUrl.replace(/^\w+:\/\//, '').replace(/\/.*$/, '');
    const [host, portStr] = raw.split(':');
    const port = portStr ? Number(portStr) : 25;
    if (!host) return { ok: false, message: 'Missing host' };
    const result = await grabSMTPBanner(host, port);
    if (!result.banner) return { ok: false, message: 'No SMTP banner' };
    return { ok: true, message: `Banner: ${result.banner}` };
  }

  async getStats(): Promise<ServerStats> {
    throw new AdapterUnsupportedError('GenericSMTPAdapter', 'getStats');
  }
  async getQueue(): Promise<QueueStats> {
    throw new AdapterUnsupportedError('GenericSMTPAdapter', 'getQueue');
  }
  async getDeliveryEvents(): Promise<DeliveryEvent[]> {
    throw new AdapterUnsupportedError('GenericSMTPAdapter', 'getDeliveryEvents');
  }
  async getAuthFailures(): Promise<AuthFailureEvent[]> {
    throw new AdapterUnsupportedError('GenericSMTPAdapter', 'getAuthFailures');
  }
  async getRecipientDomainStats(): Promise<RecipientDomainStat[]> {
    throw new AdapterUnsupportedError('GenericSMTPAdapter', 'getRecipientDomainStats');
  }
}
