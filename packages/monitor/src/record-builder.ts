// ---------- SPF ----------

export type SpfMechanism = 'ip4' | 'ip6' | 'include' | 'a' | 'mx' | 'exists';
export type SpfPolicy = '~all' | '-all' | '?all' | '+all';

export interface SpfComponent {
  type: SpfMechanism;
  /** Optional for plain `a` / `mx`. Required for ip4/ip6/include/exists. */
  value?: string;
}

export const COMMON_SPF_INCLUDES: Array<{ value: string; label: string }> = [
  { value: '_spf.google.com',            label: 'Google Workspace' },
  { value: 'spf.protection.outlook.com', label: 'Microsoft 365' },
  { value: 'spf.mailgun.org',            label: 'Mailgun' },
  { value: 'sendgrid.net',               label: 'SendGrid' },
  { value: 'amazonses.com',              label: 'Amazon SES' },
  { value: '_spf.mx.cloudflare.net',     label: 'Cloudflare Email' },
  { value: 'spf.resend.com',             label: 'Resend' },
  { value: 'mail.zendesk.com',           label: 'Zendesk' },
  { value: 'servers.mcsv.net',           label: 'Mailchimp' },
  { value: 'spf.brevo.com',              label: 'Brevo' },
  { value: 'spf.postmarkapp.com',        label: 'Postmark' },
  { value: 'spf.fastmail.com',           label: 'Fastmail' },
];

export function buildSpfRecord(components: SpfComponent[], policy: SpfPolicy): string {
  const parts: string[] = ['v=spf1'];
  for (const c of components) {
    if (c.type === 'ip4' && c.value) parts.push(`ip4:${c.value}`);
    else if (c.type === 'ip6' && c.value) parts.push(`ip6:${c.value}`);
    else if (c.type === 'include' && c.value) parts.push(`include:${c.value}`);
    else if (c.type === 'a') parts.push(c.value ? `a:${c.value}` : 'a');
    else if (c.type === 'mx') parts.push(c.value ? `mx:${c.value}` : 'mx');
    else if (c.type === 'exists' && c.value) parts.push(`exists:${c.value}`);
  }
  parts.push(policy);
  return parts.join(' ');
}

/** Mechanisms that count toward RFC 7208's 10-lookup limit. */
export function countSpfComponentLookups(components: SpfComponent[]): number {
  return components.filter((c) => ['include', 'a', 'mx', 'exists'].includes(c.type)).length;
}

// ---------- DMARC ----------

export type DmarcPolicy = 'none' | 'quarantine' | 'reject';

export interface DmarcConfig {
  policy: DmarcPolicy;
  subdomainPolicy?: DmarcPolicy;
  percentage?: number; // 1..100, default 100
  ruaEmail: string;
  rufEmail?: string;
  alignmentSpf?: 'r' | 's';
  alignmentDkim?: 'r' | 's';
  /** seconds; default 86400 (24h) */
  reportInterval?: number;
}

export function buildDmarcRecord(c: DmarcConfig): string {
  const parts: string[] = ['v=DMARC1', `p=${c.policy}`];
  if (c.subdomainPolicy && c.subdomainPolicy !== c.policy) parts.push(`sp=${c.subdomainPolicy}`);
  if (c.percentage != null && c.percentage < 100 && c.percentage > 0) parts.push(`pct=${c.percentage}`);
  if (c.ruaEmail) parts.push(`rua=mailto:${c.ruaEmail}`);
  if (c.rufEmail) parts.push(`ruf=mailto:${c.rufEmail}`);
  if (c.alignmentSpf === 's') parts.push('aspf=s');
  if (c.alignmentDkim === 's') parts.push('adkim=s');
  if (c.reportInterval && c.reportInterval !== 86400) parts.push(`ri=${c.reportInterval}`);
  return parts.join('; ');
}
