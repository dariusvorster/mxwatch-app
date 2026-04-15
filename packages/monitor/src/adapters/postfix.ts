import type {
  AdapterConfig, AdapterTestResult, AuthFailureEvent, DeliveryEvent,
  MailServerAdapter, QueueStats, RecipientDomainStat, ServerStats,
} from './types';
import { AdapterUnsupportedError } from './types';

/**
 * Postfix adapter — log-based via an MxWatch agent. The agent is not
 * implemented yet; this stub returns a clear message from `test()` and
 * throws AdapterUnsupportedError for data-fetching methods so callers
 * can treat Postfix hosts as "configured but deep stats unavailable".
 *
 * Once the agent ships (planned follow-up), this adapter will tail
 * /var/log/mail.log via WebSocket and reuse PostfixLogParser.
 */
export class PostfixAdapter implements MailServerAdapter {
  readonly type = 'postfix' as const;
  readonly displayName = 'Postfix (agent required)';

  async test(_config: AdapterConfig): Promise<AdapterTestResult> {
    return {
      ok: false,
      message:
        'Postfix adapter requires the MxWatch agent, which is not available in this build. ' +
        'External monitoring (RBL, DNS, SMTP banner) still runs from MxWatch directly.',
    };
  }

  async getStats(): Promise<ServerStats> {
    throw new AdapterUnsupportedError('PostfixAdapter', 'getStats');
  }
  async getQueue(): Promise<QueueStats> {
    throw new AdapterUnsupportedError('PostfixAdapter', 'getQueue');
  }
  async getDeliveryEvents(): Promise<DeliveryEvent[]> {
    throw new AdapterUnsupportedError('PostfixAdapter', 'getDeliveryEvents');
  }
  async getAuthFailures(): Promise<AuthFailureEvent[]> {
    throw new AdapterUnsupportedError('PostfixAdapter', 'getAuthFailures');
  }
  async getRecipientDomainStats(): Promise<RecipientDomainStat[]> {
    throw new AdapterUnsupportedError('PostfixAdapter', 'getRecipientDomainStats');
  }
}
