/**
 * Source-of-truth RBL metadata for the delist assistant. Matches the
 * RBLs we actually probe from packages/monitor/src/blacklists.ts; keep
 * both in sync when adding a new list.
 */

export type DelistMethod =
  | 'self_service_form'
  | 'email_request'
  | 'auto_expires'
  | 'reputation_based'
  | 'portal_registration'
  | 'manual_review';

export interface RBLKnowledge {
  name: string;
  shortName: string;
  type: 'ip' | 'domain' | 'both';
  listingReasons: string[];
  delistMethod: DelistMethod;
  delistUrl?: string;
  delistEmail?: string;
  typicalClearTime: string;
  autoExpires: boolean;
  autoExpireHours?: number;
  requiresExplanation: boolean;
  severityNote: string;
  preventionTips: string[];
}

export const RBL_KNOWLEDGE: Record<string, RBLKnowledge> = {
  'spamhaus-zen': {
    name: 'Spamhaus ZEN', shortName: 'spamhaus-zen', type: 'ip',
    listingReasons: [
      'IP is a residential/dynamic IP (PBL)',
      'IP has been used to send spam (SBL)',
      'IP is an open proxy or compromised host (XBL)',
    ],
    delistMethod: 'self_service_form',
    delistUrl: 'https://www.spamhaus.org/lookup/',
    typicalClearTime: 'Instant (PBL) or 1-5 days (SBL)',
    autoExpires: false,
    requiresExplanation: true,
    severityNote: 'Spamhaus ZEN is checked by most major mail providers. A listing here will cause significant delivery failures to Gmail, Outlook, Yahoo, and others.',
    preventionTips: [
      'Use a static, dedicated IP for sending mail',
      'Ensure your IP is not a residential/dynamic IP',
      'Monitor for signs of server compromise',
      'Keep sending volume consistent — spikes trigger automated listings',
    ],
  },
  'spamhaus-dbl': {
    name: 'Spamhaus DBL', shortName: 'spamhaus-dbl', type: 'domain',
    listingReasons: [
      'Domain found in spam message bodies',
      'Domain used in phishing campaigns',
      'Domain associated with malware distribution',
    ],
    delistMethod: 'self_service_form',
    delistUrl: 'https://www.spamhaus.org/dbl/removal/',
    typicalClearTime: '1-5 business days',
    autoExpires: false,
    requiresExplanation: true,
    severityNote: 'Spamhaus DBL lists domains found in spam. If your domain is listed here, recipients using Spamhaus-based filtering will reject or filter emails containing your domain.',
    preventionTips: [
      'Ensure your domain is not being used by third parties in spam',
      'Check for compromised accounts sending spam',
      'Monitor DMARC reports for unauthorized senders',
    ],
  },
  'barracuda': {
    name: 'Barracuda', shortName: 'barracuda', type: 'ip',
    listingReasons: [
      'Spam reports from Barracuda appliance users',
      'High volume sending from this IP',
      'Poor sending reputation score',
    ],
    delistMethod: 'self_service_form',
    delistUrl: 'https://www.barracudacentral.org/rbl/removal-request',
    typicalClearTime: 'Usually instant',
    autoExpires: false,
    requiresExplanation: false,
    severityNote: 'Barracuda is used by many corporate email gateways. A listing here will affect delivery to businesses using Barracuda hardware or cloud filtering.',
    preventionTips: [
      'Ensure all recipients have opted in to your emails',
      'Honor unsubscribe requests immediately',
      'Maintain a low spam complaint rate (< 0.1%)',
    ],
  },
  'sorbs': {
    name: 'SORBS', shortName: 'sorbs', type: 'ip',
    listingReasons: [
      'Open relay detected',
      'Spam sent from this IP',
      'Dynamic/residential IP in DUHL zone',
    ],
    delistMethod: 'self_service_form',
    delistUrl: 'https://www.sorbs.net/lookup.shtml',
    typicalClearTime: '24-72 hours',
    autoExpires: false,
    requiresExplanation: true,
    severityNote: 'SORBS maintains several zone lists. Your listing type determines the removal process. Dynamic IP listings require ISP certification.',
    preventionTips: [
      'Ensure your mail server is not an open relay',
      'Use a static business IP for mail sending',
      'Configure SMTP authentication correctly',
    ],
  },
  'spamcop': {
    name: 'SpamCop', shortName: 'spamcop', type: 'ip',
    listingReasons: [
      'User spam reports submitted to SpamCop',
      'Automated spam trap hits',
    ],
    delistMethod: 'auto_expires',
    autoExpires: true,
    autoExpireHours: 24,
    typicalClearTime: '24-48 hours (auto-expires)',
    requiresExplanation: false,
    severityNote: 'SpamCop listings expire automatically if no new spam reports are received. No delist action needed — just ensure no more spam is sent from this IP.',
    preventionTips: [
      'SpamCop listings are report-driven — check for compromised accounts',
      'Review your mailing list for spam trap addresses',
      'Use double opt-in for all mailing list signups',
    ],
  },
  'spamrats': {
    name: 'Spamrats', shortName: 'spamrats', type: 'ip',
    listingReasons: [
      'IP sending spam without reverse DNS',
      'IP on dynamic/residential range',
      'Botnet activity detected',
    ],
    delistMethod: 'self_service_form',
    delistUrl: 'http://www.spamrats.com/removal.php',
    typicalClearTime: '24-48 hours',
    autoExpires: false,
    requiresExplanation: true,
    severityNote: 'Spamrats focuses on IPs without proper rDNS. Ensure your PTR record is correctly configured before requesting removal.',
    preventionTips: [
      'Configure a proper PTR record for your sending IP',
      'PTR record should resolve back to your mail hostname',
      'Verify PTR with your VPS/hosting provider',
    ],
  },
  'mailspike': {
    name: 'Mailspike', shortName: 'mailspike', type: 'ip',
    listingReasons: [
      'Poor sending reputation score',
      'Spam reports from Mailspike network',
    ],
    delistMethod: 'reputation_based',
    typicalClearTime: '7-14 days (reputation improves automatically)',
    autoExpires: true,
    autoExpireHours: 336,
    requiresExplanation: false,
    severityNote: 'Mailspike uses a reputation scoring system. Listings improve automatically as you send clean email. No explicit delist process exists.',
    preventionTips: [
      'Send consistently low-volume, legitimate email',
      'Maintain low bounce and complaint rates',
      'Patience — reputation scores improve over time',
    ],
  },
  'invaluement-ivmsip': {
    name: 'Invaluement ivmSIP', shortName: 'invaluement-ivmsip', type: 'ip',
    listingReasons: [
      'IP associated with snowshoe spam',
      'IP sending high volumes of unsolicited email',
      'IP linked to known spam networks',
    ],
    delistMethod: 'email_request',
    delistEmail: 'delist@invaluement.com',
    typicalClearTime: '1-5 business days',
    autoExpires: false,
    requiresExplanation: true,
    severityNote: 'Invaluement focuses on snowshoe spam. Listings require manual review. A well-written delist request explaining your sending practices significantly improves approval chances.',
    preventionTips: [
      'Keep sending volume low and consistent',
      'Avoid sending from many IPs simultaneously',
      'Ensure all email is solicited and expected by recipients',
    ],
  },
  'sem-backscatter': {
    name: 'SEM-BACKSCATTER', shortName: 'sem-backscatter', type: 'ip',
    listingReasons: [
      'Server sending backscatter (bounce messages to innocent parties)',
      'Open relay generating delivery failure notices',
    ],
    delistMethod: 'self_service_form',
    delistUrl: 'https://www.senderscore.org/',
    typicalClearTime: '24-72 hours',
    autoExpires: false,
    requiresExplanation: true,
    severityNote: 'Backscatter occurs when your server sends bounce messages for emails it never originally sent. This is usually caused by misconfigured spam filtering.',
    preventionTips: [
      'Configure your mail server to reject spam at SMTP time, not after acceptance',
      'Never accept then bounce — reject at RCPT TO stage instead',
      'This prevents your server from becoming a backscatter source',
    ],
  },
  'uribl': {
    name: 'URIBL', shortName: 'uribl', type: 'domain',
    listingReasons: [
      'Domain found in spam message URLs',
      'Domain registered by known spammers',
    ],
    delistMethod: 'self_service_form',
    delistUrl: 'https://lookup.uribl.com/',
    typicalClearTime: '24-72 hours',
    autoExpires: false,
    requiresExplanation: true,
    severityNote: 'URIBL lists domains that appear in spam URLs. If your domain is listed here, emails containing links to your domain will be flagged as spam.',
    preventionTips: [
      'Check if your domain registrar or IP range is on known spam lists',
      'Newly registered domains are at higher risk — allow a grace period',
      'Monitor who links to your domain in email campaigns',
    ],
  },
  'microsoft-snds': {
    name: 'Microsoft SNDS', shortName: 'microsoft-snds', type: 'ip',
    listingReasons: [
      'High spam complaint rate from Outlook/Hotmail users',
      'IP sending to Microsoft spam traps',
      'Poor sender reputation score with Microsoft',
    ],
    delistMethod: 'portal_registration',
    delistUrl: 'https://sendersupport.olc.protection.outlook.com/pm/delist.aspx',
    typicalClearTime: '24-48 hours',
    autoExpires: false,
    requiresExplanation: true,
    severityNote: 'Microsoft SNDS blocks affect delivery to Outlook.com, Hotmail, and Live.com addresses. This covers a large portion of personal and business email.',
    preventionTips: [
      'Register at https://sendersupport.olc.protection.outlook.com/snds/',
      'Monitor your SNDS dashboard for complaint rates',
      'Keep spam complaint rate below 0.3% for Microsoft',
    ],
  },
};

/** DNS hosts actually queried by the RBL checker. Kept in sync with
 *  packages/monitor/src/blacklists.ts. */
const RBL_HOSTS: Record<string, string> = {
  'spamhaus-zen': 'zen.spamhaus.org',
  'spamhaus-dbl': 'dbl.spamhaus.org',
  barracuda: 'b.barracudacentral.org',
  sorbs: 'spam.spamrats.com', // placeholder — multiple SORBS zones; see blacklists.ts
  spamcop: 'bl.spamcop.net',
  spamrats: 'spam.spamrats.com',
  mailspike: 'bl.mailspike.net',
  'invaluement-ivmsip': 'sip.invaluement.com',
  'sem-backscatter': 'backscatter.spameatingmonkey.net',
  uribl: 'multi.uribl.com',
  'microsoft-snds': 'snds.microsoft.com',
};

export function getRBLHost(name: string): string | null {
  return RBL_HOSTS[name] ?? null;
}

export interface TimelineEvent {
  ts: string;
  event: string;
  detail?: string;
}

/** Append one event to a JSON-serialized timeline string. Returns the
 *  new JSON string; callers persist it back to delistRequests.timeline. */
export function appendTimelineEvent(current: string | null | undefined, event: Omit<TimelineEvent, 'ts'>): string {
  let arr: TimelineEvent[] = [];
  try { arr = current ? JSON.parse(current) : []; } catch { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  arr.push({ ts: new Date().toISOString(), ...event });
  return JSON.stringify(arr);
}
