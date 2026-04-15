import type { MailServerType } from '../server-detect';

export interface AdapterConfig {
  baseUrl: string;
  apiToken: string;
  // Optional extras adapters may read (e.g. Mailcow agent URL, Postfix log path).
  extras?: Record<string, string | undefined>;
}

export interface AdapterTestResult {
  ok: boolean;
  message: string;
  version?: string;
}

export interface ServerStats {
  queueDepth: number;
  queueFailed: number;
  delivered24h: number;
  bounced24h: number;
  rejected24h: number;
  deferred24h: number;
  tlsPercent: number;
  serverVersion: string;
  uptime?: number;
}

export interface QueueMessage {
  id: string;
  from: string;
  to: string[];
  size: number;
  attempts: number;
  lastAttempt: Date;
  nextAttempt: Date;
  lastError: string | null;
  age: number;
}

export interface QueueStats {
  total: number;
  active: number;
  deferred: number;
  failed: number;
  oldestMessageAge: number;
  messages: QueueMessage[];
}

export interface DeliveryEvent {
  id: string;
  timestamp: Date;
  type: 'delivered' | 'bounced' | 'deferred' | 'rejected';
  from: string;
  to: string;
  recipientDomain: string;
  size: number;
  delay: number;
  tlsUsed: boolean;
  errorCode?: string;
  errorMessage?: string;
  bounceType?: 'hard' | 'soft' | 'policy';
}

export interface AuthFailureEvent {
  timestamp: Date;
  ip: string;
  username?: string;
  mechanism: string;
  failCount: number;
}

export interface RecipientDomainStat {
  domain: string;
  sent: number;
  delivered: number;
  bounced: number;
  deferred: number;
  deliveryRate: number;
  avgDelayMs: number;
  lastBounceReason?: string;
}

export interface RelayInboxSetupResult {
  ok: boolean;
  /** `mxwatch-test-*@<domain>` — the wildcard that Mx will receive at. */
  catchallAddressPattern: string;
  /** Non-null when automatic setup failed and the user must finish
   *  configuration in the provider's dashboard. */
  setupInstructions?: string | null;
  message: string;
}

export interface MailServerAdapter {
  readonly type: MailServerType;
  readonly displayName: string;
  test(config: AdapterConfig): Promise<AdapterTestResult>;
  getStats(config: AdapterConfig): Promise<ServerStats>;
  getQueue(config: AdapterConfig): Promise<QueueStats>;
  getDeliveryEvents(config: AdapterConfig, since: Date, limit: number): Promise<DeliveryEvent[]>;
  getAuthFailures(config: AdapterConfig, since: Date): Promise<AuthFailureEvent[]>;
  getRecipientDomainStats(config: AdapterConfig, since: Date): Promise<RecipientDomainStat[]>;

  /** Optional: create the provider-side route / inbound parse config that
   *  forwards `mxwatch-test-*@<domain>` to the webhook URL. Adapters that
   *  don't support inbound routing omit this method. */
  setupRelayInbox?(params: {
    config: AdapterConfig;
    webhookUrl: string;
    webhookSecret: string;
    inboundDomain: string;
  }): Promise<RelayInboxSetupResult>;
}

/**
 * Thrown by adapters when a capability isn't supported for the given server
 * type. Callers should treat this as "feature unavailable, skip" rather than
 * a hard error.
 */
export class AdapterUnsupportedError extends Error {
  constructor(adapter: string, capability: string) {
    super(`${adapter} does not support ${capability}`);
    this.name = 'AdapterUnsupportedError';
  }
}
