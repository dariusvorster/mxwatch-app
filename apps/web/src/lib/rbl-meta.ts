// Client-safe mirror of the RBL list so we can render the grid without
// pulling the full @mxwatch/monitor package into the client bundle.
// Keep in sync with packages/monitor/src/blacklists.ts.
export const BLACKLISTS_META: Array<{ name: string; severity: 'critical' | 'high' | 'medium' }> = [
  { name: 'Spamhaus ZEN', severity: 'critical' },
  { name: 'Spamhaus PBL', severity: 'critical' },
  { name: 'Spamhaus SBL', severity: 'critical' },
  { name: 'Spamhaus DBL', severity: 'critical' },
  { name: 'Barracuda BRBL', severity: 'critical' },
  { name: 'SORBS DUHL', severity: 'high' },
  { name: 'SORBS SPAM', severity: 'high' },
  { name: 'Invaluement ivmSIP', severity: 'high' },
  { name: 'SpamCop', severity: 'high' },
  { name: 'UCEPROTECT L1', severity: 'medium' },
  { name: 'MXToolbox Top', severity: 'medium' },
  { name: 'Passive Spam Block', severity: 'medium' },
];
