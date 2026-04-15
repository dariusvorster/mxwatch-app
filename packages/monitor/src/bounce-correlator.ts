import type { ParsedBounce } from './bounce-parser';

export interface RBLListing {
  rblName: string;
  delistUrl?: string;
}

export interface BounceCorrelationInput {
  bounce: ParsedBounce;
  recentBouncesToSameDomain: number;
  activeRBLListing: RBLListing | null;
}

export interface BounceCorrelation {
  bounce: ParsedBounce;
  relatedRBLListing: RBLListing | null;
  severity: 'info' | 'warning' | 'critical';
  suggestedAction: string | null;
}

/**
 * Pure correlator — takes a parsed bounce plus pre-fetched context (recent
 * bounce count to the same recipient domain, active RBL listing for the
 * sending IP) and returns severity + suggested action. DB access is kept out
 * of this module so it stays testable and reusable across the SMTP listener
 * and tRPC paths.
 */
export function correlateBounce(input: BounceCorrelationInput): BounceCorrelation {
  const { bounce, recentBouncesToSameDomain, activeRBLListing } = input;

  let severity: BounceCorrelation['severity'] = 'info';
  let suggestedAction: string | null = null;
  let relatedRBLListing: RBLListing | null = null;

  // Policy bounce with an active RBL listing → critical: the listing is
  // almost certainly the root cause.
  if ((bounce.relatedRBL || bounce.bounceType === 'policy') && activeRBLListing) {
    relatedRBLListing = activeRBLListing;
    severity = 'critical';
    suggestedAction =
      `Your IP is listed on ${activeRBLListing.rblName}. This is causing ` +
      `delivery failures to ${bounce.recipientDomain}.` +
      (activeRBLListing.delistUrl ? ` Request delist at ${activeRBLListing.delistUrl}.` : '');
  } else if (bounce.relatedRBL) {
    // RBL mentioned in the bounce but we aren't currently listed — still
    // worth surfacing; could be a stale cache on the recipient side.
    severity = 'warning';
    suggestedAction =
      `Recipient cited ${bounce.relatedRBL} in the bounce. Your IP is not ` +
      `currently listed — the listing may have been cached on their end.`;
  } else if (bounce.bounceType === 'hard') {
    severity = 'info';
    suggestedAction = `Hard bounce — address ${bounce.originalTo} likely invalid.`;
  }

  // Spike detection trumps info-level severity only, not critical.
  if (recentBouncesToSameDomain >= 3 && severity !== 'critical') {
    severity = severity === 'info' ? 'warning' : severity;
    suggestedAction =
      `${recentBouncesToSameDomain} bounces to ${bounce.recipientDomain} in ` +
      `the last hour. Check your sending reputation with this provider.`;
  }

  return { bounce, relatedRBLListing, severity, suggestedAction };
}
