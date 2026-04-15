/**
 * Client-safe mirror of packages/monitor/src/delist/rbl-knowledge.ts's
 * DISPLAY_NAME_TO_KEY map. Keeping it here lets /domains/[id] reference
 * the mapping without importing @mxwatch/monitor's full index — which
 * pulls in mailparser / node:dns / node:tls and breaks the Next.js
 * client bundle.
 */

const DISPLAY_NAME_TO_KEY: Record<string, string> = {
  'Spamhaus ZEN': 'spamhaus-zen',
  'Spamhaus PBL': 'spamhaus-zen',
  'Spamhaus SBL': 'spamhaus-zen',
  'Spamhaus DBL': 'spamhaus-dbl',
  'Barracuda BRBL': 'barracuda',
  'SORBS DUHL': 'sorbs',
  'SORBS SPAM': 'sorbs',
  'Invaluement ivmSIP': 'invaluement-ivmsip',
  SpamCop: 'spamcop',
  Spamrats: 'spamrats',
  Mailspike: 'mailspike',
  'SEM-BACKSCATTER': 'sem-backscatter',
  URIBL: 'uribl',
  'Microsoft SNDS': 'microsoft-snds',
};

export function rblKeyForDisplayName(name: string): string | null {
  return DISPLAY_NAME_TO_KEY[name] ?? null;
}
