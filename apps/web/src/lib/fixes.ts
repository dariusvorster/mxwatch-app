export interface FixCopy {
  title: string;
  explanation: string;
  /** Suggested DNS record value(s). Shown in a copyable code block. */
  suggested?: Array<{ host: string; type: 'TXT' | 'MX'; value: string }>;
  /** Shell commands to verify the fix. */
  verify?: string[];
  /** Optional external docs. */
  links?: Array<{ label: string; href: string }>;
}

export type FixResolver = (domain: string, detail?: string) => FixCopy;

interface Rule {
  match: RegExp;
  resolve: FixResolver;
}

// Ordered: first match wins. Keep patterns specific.
const RULES: Rule[] = [
  {
    match: /^No SPF record found$/i,
    resolve: (domain) => ({
      title: 'No SPF record found',
      explanation:
        'SPF tells receiving servers which hosts are allowed to send mail for your domain. Without one, your mail is easy to spoof and more likely to be rejected.',
      suggested: [{
        host: domain,
        type: 'TXT',
        value: 'v=spf1 mx ~all',
      }],
      verify: [`dig +short TXT ${domain}`],
    }),
  },
  {
    match: /SPF exceeds 10 DNS lookup limit/i,
    resolve: (domain) => ({
      title: 'SPF has too many DNS lookups',
      explanation:
        'RFC 7208 caps SPF at 10 DNS lookups per check. When you exceed it, many receivers treat the result as PermError and your mail fails SPF. Flatten heavy includes (e.g. replace `include:_spf.google.com` with its resolved IPs) or remove services you no longer use.',
      verify: [
        `dig +short TXT ${domain}`,
        // dmarcian / EasyDMARC have free SPF flattening tools — doc link surfaces below
      ],
      links: [
        { label: 'Check lookup count', href: 'https://www.kitterman.com/spf/validate.html' },
      ],
    }),
  },
  {
    match: /SPF uses \+all/i,
    resolve: (domain) => ({
      title: 'SPF allows any sender (+all)',
      explanation:
        '`+all` makes SPF pass for everyone on the internet — it is equivalent to having no SPF. Replace it with `~all` (softfail) or `-all` (hardfail).',
      suggested: [{ host: domain, type: 'TXT', value: 'v=spf1 mx -all' }],
      verify: [`dig +short TXT ${domain}`],
    }),
  },
  {
    match: /SPF missing ~all or -all qualifier/i,
    resolve: (domain) => ({
      title: 'SPF missing terminating qualifier',
      explanation:
        'Your SPF record has no `~all` or `-all` at the end, so unauthorised senders are implicitly allowed. Add `-all` (strict) or `~all` (soft).',
      suggested: [{ host: domain, type: 'TXT', value: 'v=spf1 mx -all' }],
      verify: [`dig +short TXT ${domain}`],
    }),
  },
  {
    match: /^DKIM selector '(.+)' not found$/i,
    resolve: (domain, detail) => {
      const selector = detail?.match(/'(.+)'/)?.[1] ?? 'mail';
      return {
        title: `DKIM selector "${selector}" not found`,
        explanation:
          'Your MTA signs outbound mail with DKIM, but receivers can\'t find the public key at this selector. Publish the DKIM key your mail server generated at the expected DNS location.',
        suggested: [{
          host: `${selector}._domainkey.${domain}`,
          type: 'TXT',
          value: 'v=DKIM1; k=rsa; p=<YOUR_PUBLIC_KEY_BASE64>',
        }],
        verify: [`dig +short TXT ${selector}._domainkey.${domain}`],
      };
    },
  },
  {
    match: /DKIM key too short/i,
    resolve: (domain, detail) => ({
      title: 'DKIM key is too short',
      explanation:
        'Keys under 1024 bits are considered broken. Rotate to a 2048-bit RSA key in your mail server and publish the new public key.',
      verify: detail ? [`# current: ${detail}`] : undefined,
    }),
  },
  {
    match: /DKIM key should be 2048 bits/i,
    resolve: () => ({
      title: 'DKIM key should be upgraded to 2048 bits',
      explanation:
        '1024-bit keys still validate but are the minimum. Rotating to 2048 bits is the current best practice; most mail servers (Stalwart, Postfix+OpenDKIM, Mailcow) can regenerate and publish a new key in minutes.',
    }),
  },
  {
    match: /^No DMARC record found$/i,
    resolve: (domain) => ({
      title: 'No DMARC record found',
      explanation:
        'Without DMARC you cannot enforce SPF/DKIM alignment, and you receive no visibility into who is sending as you. Start with `p=none` to gather data, then move to `quarantine`, then `reject`.',
      suggested: [{
        host: `_dmarc.${domain}`,
        type: 'TXT',
        value: `v=DMARC1; p=none; rua=mailto:dmarc@${domain}; fo=1`,
      }],
      verify: [`dig +short TXT _dmarc.${domain}`],
    }),
  },
  {
    match: /DMARC policy is p=none/i,
    resolve: (domain) => ({
      title: 'DMARC policy is p=none — mail not protected',
      explanation:
        '`p=none` is monitoring-only. Once your aggregate reports show SPF/DKIM alignment holding for a week or two, step up to `p=quarantine; pct=25`, then 100%, then `p=reject`.',
      suggested: [{
        host: `_dmarc.${domain}`,
        type: 'TXT',
        value: `v=DMARC1; p=quarantine; pct=25; rua=mailto:dmarc@${domain}; fo=1`,
      }],
      verify: [`dig +short TXT _dmarc.${domain}`],
    }),
  },
  {
    match: /No DMARC aggregate report address \(rua\)/i,
    resolve: (domain) => ({
      title: 'No DMARC rua address — you are flying blind',
      explanation:
        'Without `rua=`, reporting providers have nowhere to send aggregate XML reports. Point rua at the MxWatch SMTP listener (port 2525) or a mailbox you control.',
      suggested: [{
        host: `_dmarc.${domain}`,
        type: 'TXT',
        value: `v=DMARC1; p=none; rua=mailto:dmarc@${domain}; fo=1`,
      }],
      verify: [`dig +short TXT _dmarc.${domain}`],
    }),
  },
  {
    match: /DMARC pct=\d+/i,
    resolve: (domain, detail) => ({
      title: 'DMARC pct < 100',
      explanation:
        `Your DMARC policy only applies to ${detail?.match(/pct=(\d+)/)?.[1] ?? 'a fraction'}% of messages. Once reports look clean, raise pct to 100 and remove the attribute.`,
      suggested: [{
        host: `_dmarc.${domain}`,
        type: 'TXT',
        value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}; fo=1`,
      }],
    }),
  },
];

export function resolveFix(issue: string, domain: string): FixCopy | null {
  for (const rule of RULES) {
    if (rule.match.test(issue)) return rule.resolve(domain, issue);
  }
  return null;
}

export interface BlacklistFixCopy {
  title: string;
  explanation: string;
  steps: string[];
  removalUrl?: string;
}

export function resolveBlacklistFix(name: string, ip: string): BlacklistFixCopy {
  const common = [
    `Confirm the listing: dig +short ${ip.split('.').reverse().join('.')}.${nameToHost(name) ?? '<rbl-host>'}`,
    'Stop any open relay, compromised accounts, or rogue scripts sending mail.',
    'Review your MTA logs for the 24 hours before the listing to identify the trigger.',
  ];
  if (/spamhaus pbl/i.test(name)) {
    return {
      title: 'Listed on Spamhaus PBL',
      explanation:
        'The PBL is a list of IP ranges that should not be delivering unauthenticated mail directly — typically residential or dynamic IPs. You usually cannot delist; instead relay outbound mail through a static IP (VPS) or your ISP\'s smarthost.',
      steps: [
        ...common,
        'Route outbound mail through a static-IP relay (e.g. a WireGuard tunnel to a VPS, or an SMTP smarthost) so your PBL-listed IP is never the visible source.',
        'If you control the IP range and it is not residential, submit a PBL removal request.',
      ],
      removalUrl: 'https://www.spamhaus.org/pbl/query/REMOVEPBL',
    };
  }
  if (/spamhaus/i.test(name)) {
    return {
      title: `Listed on ${name}`,
      explanation:
        'Spamhaus lists are the most impactful for deliverability — many receivers block anything on ZEN/SBL/DBL outright. Investigate the listing before requesting removal; relisting is fast.',
      steps: [...common, 'Request removal via Spamhaus Blocklist Removal Center once the root cause is fixed.'],
      removalUrl: 'https://check.spamhaus.org/',
    };
  }
  if (/barracuda/i.test(name)) {
    return {
      title: 'Listed on Barracuda BRBL',
      explanation:
        'Barracuda Reputation Block List. Request removal via their form after confirming and fixing the issue; a valid reverse DNS (PTR) matching your HELO is required.',
      steps: [
        ...common,
        'Ensure your reverse DNS (PTR) matches the hostname your MTA uses in HELO/EHLO.',
      ],
      removalUrl: 'https://www.barracudacentral.org/rbl/removal-request',
    };
  }
  return {
    title: `Listed on ${name}`,
    explanation:
      'Investigate the root cause of the listing before requesting removal — re-listings within a short window usually result in harder-to-remove blocks.',
    steps: common,
  };
}

function nameToHost(name: string): string | null {
  // Minimal map for the dig hint; not authoritative.
  const table: Record<string, string> = {
    'Spamhaus ZEN': 'zen.spamhaus.org',
    'Spamhaus PBL': 'pbl.spamhaus.org',
    'Spamhaus SBL': 'sbl.spamhaus.org',
    'Spamhaus DBL': 'dbl.spamhaus.org',
    'Barracuda BRBL': 'b.barracudacentral.org',
    'SORBS DUHL': 'dul.sorbs.net',
    'SORBS SPAM': 'spam.sorbs.net',
    'Invaluement ivmSIP': 'sip.invaluement.com',
    'SpamCop': 'bl.spamcop.net',
    'UCEPROTECT L1': 'dnsbl-1.uceprotect.net',
    'MXToolbox Top': 'dnsbl.mxtoolbox.com',
    'Passive Spam Block': 'psbl.surriel.com',
  };
  return table[name] ?? null;
}
