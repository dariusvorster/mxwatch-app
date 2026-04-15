/**
 * Helpers for working with the network-topology fields on a domain row.
 * These encapsulate the legacy `sendingIp` fallback so call sites don't
 * need to know about it.
 */

export type DomainArchitecture = 'direct' | 'nat_relay' | 'split' | 'managed';
export type OutboundProvider = 'resend' | 'sendgrid' | 'postmark' | 'custom';

export interface DomainTopology {
  architecture: DomainArchitecture | null;
  sendingIp: string | null;             // legacy
  sendingIps: string | null;            // JSON array
  smtpCheckHost: string | null;
  relayHost: string | null;
  internalHost: string | null;
  outboundProvider: OutboundProvider | null;
}

/** Returns the full list of IPs to RBL-check for a domain. */
export function getSendingIps(d: DomainTopology): string[] {
  if (d.sendingIps) {
    try {
      const arr = JSON.parse(d.sendingIps) as unknown;
      if (Array.isArray(arr)) {
        const out = arr.filter((v): v is string => typeof v === 'string' && v.length > 0);
        if (out.length > 0) return out;
      }
    } catch {}
  }
  return d.sendingIp ? [d.sendingIp] : [];
}

/** True when the topology says SMTP reachability is N/A (managed providers). */
export function smtpCheckDisabled(d: DomainTopology): boolean {
  return d.architecture === 'managed';
}

/** Returns the host our outbound-SMTP probe should connect to, if any. */
export function getSmtpCheckHost(d: DomainTopology): string | null {
  if (smtpCheckDisabled(d)) return null;
  if (d.smtpCheckHost) return d.smtpCheckHost;
  // For nat_relay the relay is what outbound mail leaves through.
  if (d.architecture === 'nat_relay' && d.relayHost) return d.relayHost;
  return null;
}
