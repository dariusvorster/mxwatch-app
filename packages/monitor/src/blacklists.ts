import dns from 'node:dns';

export interface BlacklistDef {
  name: string;
  host: string;
  severity: 'critical' | 'high' | 'medium';
  removalUrl?: string;
}

// Full RBL suite per spec §6.1 (12 lists).
export const BLACKLISTS: BlacklistDef[] = [
  { name: 'Spamhaus ZEN', host: 'zen.spamhaus.org', severity: 'critical', removalUrl: 'https://check.spamhaus.org/' },
  { name: 'Spamhaus PBL', host: 'pbl.spamhaus.org', severity: 'critical', removalUrl: 'https://www.spamhaus.org/pbl/query/REMOVEPBL' },
  { name: 'Spamhaus SBL', host: 'sbl.spamhaus.org', severity: 'critical', removalUrl: 'https://check.spamhaus.org/' },
  { name: 'Spamhaus DBL', host: 'dbl.spamhaus.org', severity: 'critical' },
  { name: 'Barracuda BRBL', host: 'b.barracudacentral.org', severity: 'critical', removalUrl: 'https://www.barracudacentral.org/rbl/removal-request' },
  { name: 'SORBS DUHL', host: 'dul.sorbs.net', severity: 'high' },
  { name: 'SORBS SPAM', host: 'spam.sorbs.net', severity: 'high' },
  { name: 'Invaluement ivmSIP', host: 'sip.invaluement.com', severity: 'high' },
  { name: 'SpamCop', host: 'bl.spamcop.net', severity: 'high' },
  { name: 'UCEPROTECT L1', host: 'dnsbl-1.uceprotect.net', severity: 'medium' },
  { name: 'MXToolbox Top', host: 'dnsbl.mxtoolbox.com', severity: 'medium' },
  { name: 'Passive Spam Block', host: 'psbl.surriel.com', severity: 'medium' },
];

export interface BlacklistCheckResult {
  listed: boolean;
  blacklist: string;
}

export async function checkIpAgainstBlacklist(
  ip: string,
  blacklist: BlacklistDef,
): Promise<BlacklistCheckResult> {
  const reversed = ip.split('.').reverse().join('.');
  const lookup = `${reversed}.${blacklist.host}`;
  try {
    await dns.promises.resolve4(lookup);
    return { listed: true, blacklist: blacklist.name };
  } catch {
    return { listed: false, blacklist: blacklist.name };
  }
}

export async function checkIpAgainstAllBlacklists(ip: string) {
  const results = await Promise.all(
    BLACKLISTS.map((bl) => checkIpAgainstBlacklist(ip, bl)),
  );
  const listedOn = results.filter((r) => r.listed).map((r) => r.blacklist);
  return { ip, isListed: listedOn.length > 0, listedOn };
}
