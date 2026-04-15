export type Severity = 'critical' | 'high' | 'medium' | 'low';

/** Rule-driven alerts — configurable per domain via the alert_rules table. */
export type AlertRuleType =
  | 'blacklist_listed'
  | 'dns_record_changed'
  | 'dmarc_fail_spike'
  | 'health_score_drop'
  | 'dmarc_report_received';

/** Full alert type union — rules + ad-hoc dispatch events (rbl_delisted
 *  fires from the delist poller when a listing clears). */
export type AlertType = AlertRuleType | 'rbl_delisted';

export type AlertChannelType = 'email' | 'slack' | 'webhook' | 'ntfy';

export interface Alert {
  id: string;
  domainId: string;
  domainName: string;
  type: AlertType;
  severity: Severity;
  message: string;
  firedAt: Date;
}

export interface SpfResult {
  valid: boolean;
  record: string | null;
  lookupCount: number;
  issues: string[];
}

export interface DkimResult {
  selector: string;
  valid: boolean;
  record: string | null;
  issues: string[];
}

export interface DmarcResult {
  valid: boolean;
  record: string | null;
  policy: 'none' | 'quarantine' | 'reject' | null;
  hasRua: boolean;
  issues: string[];
}

export interface DomainHealth {
  spf: SpfResult;
  dkim: DkimResult[];
  dmarc: DmarcResult;
  mx: string[];
  healthScore: number;
}

export interface ParsedDmarcReport {
  reportId: string;
  orgName: string;
  email: string;
  dateRangeBegin: Date;
  dateRangeEnd: Date;
  domain: string;
  policy: string;
  rows: Array<{
    sourceIp: string;
    count: number;
    disposition?: string;
    dkimResult?: string;
    spfResult?: string;
    headerFrom?: string;
  }>;
}

export interface EmailChannelConfig {
  to: string;
}
export interface SlackChannelConfig {
  webhookUrl: string;
}
export interface NtfyChannelConfig {
  /** Base URL, e.g. https://ntfy.sh or https://ntfy.yourhost */
  url: string;
  topic: string;
  /** Optional access token for protected topics */
  token?: string;
}
export interface WebhookChannelConfig {
  url: string;
  /** Optional bearer token sent as Authorization header */
  secret?: string;
}

export type ChannelConfig =
  | EmailChannelConfig
  | SlackChannelConfig
  | NtfyChannelConfig
  | WebhookChannelConfig;
