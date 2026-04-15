import type {
  AdapterConfig, AdapterTestResult, AuthFailureEvent, DeliveryEvent,
  MailServerAdapter, QueueStats, RecipientDomainStat, ServerStats,
} from './types';
import { AdapterUnsupportedError } from './types';

/**
 * Amazon SES adapter. Stats + events come via SNS notifications into the
 * /api/webhooks/ses endpoint; the SES REST API itself requires AWS SigV4
 * which we don't ship an SDK for yet. This adapter confirms the SNS
 * webhook is configured and throws on data methods — all real numbers
 * arrive webhook-side.
 */
export class SesAdapter implements MailServerAdapter {
  readonly type = 'ses' as const;
  readonly displayName = 'Amazon SES (webhook-only)';

  async test(config: AdapterConfig): Promise<AdapterTestResult> {
    const topic = config.extras?.snsTopic;
    if (!topic) {
      return { ok: false, message: 'Provide extras.snsTopic with the SNS topic ARN after configuring SES → SNS.' };
    }
    return { ok: true, message: `Subscribed to SNS topic ${topic}. Events will flow via /api/webhooks/ses.` };
  }

  async getStats(): Promise<ServerStats> {
    throw new AdapterUnsupportedError('SesAdapter', 'getStats');
  }
  async getQueue(): Promise<QueueStats> {
    throw new AdapterUnsupportedError('SesAdapter', 'getQueue');
  }
  async getDeliveryEvents(): Promise<DeliveryEvent[]> {
    throw new AdapterUnsupportedError('SesAdapter', 'getDeliveryEvents');
  }
  async getAuthFailures(): Promise<AuthFailureEvent[]> {
    throw new AdapterUnsupportedError('SesAdapter', 'getAuthFailures');
  }
  async getRecipientDomainStats(): Promise<RecipientDomainStat[]> {
    throw new AdapterUnsupportedError('SesAdapter', 'getRecipientDomainStats');
  }
}
