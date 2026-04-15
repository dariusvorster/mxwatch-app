import dns from 'node:dns';
import type { DomainHealth, SpfResult, DkimResult, DmarcResult } from '@mxwatch/types';

const SPF_LOOKUP_MECHANISMS = /\b(include|a|mx|ptr|exists|redirect)\b/gi;

export function countSpfLookups(spf: string): number {
  // Count each mechanism that triggers a DNS lookup. Naive but spec-compliant for V1.
  const matches = spf.match(SPF_LOOKUP_MECHANISMS);
  return matches?.length ?? 0;
}

export async function checkSpf(domain: string): Promise<SpfResult> {
  try {
    const txt = await dns.promises.resolveTxt(domain);
    const spf = txt.flat().find((r) => r.startsWith('v=spf1'));
    if (!spf) return { valid: false, record: null, lookupCount: 0, issues: ['No SPF record found'] };

    const lookupCount = countSpfLookups(spf);
    const issues: string[] = [];
    if (lookupCount > 10) issues.push(`SPF exceeds 10 DNS lookup limit (${lookupCount} found)`);
    if (spf.includes('+all')) issues.push('SPF uses +all — extremely dangerous, allows any sender');
    if (!spf.includes('~all') && !spf.includes('-all')) issues.push('SPF missing ~all or -all qualifier');

    return { valid: issues.length === 0, record: spf, lookupCount, issues };
  } catch {
    return { valid: false, record: null, lookupCount: 0, issues: ['No SPF record found'] };
  }
}

/**
 * Strips `._domainkey.<anything>` from the selector so callers can pass either
 * `mail` or `mail._domainkey.example.com` and we construct a single, correct
 * DNS name for the TXT lookup.
 */
export function normalizeDkimSelector(selector: string): string {
  const idx = selector.toLowerCase().indexOf('._domainkey');
  return idx >= 0 ? selector.slice(0, idx) : selector;
}

export async function checkDkim(domain: string, selector: string): Promise<DkimResult> {
  const bare = normalizeDkimSelector(selector);
  try {
    const txt = await dns.promises.resolveTxt(`${bare}._domainkey.${domain}`);
    const record = txt.flat().join('');
    const issues: string[] = [];
    if (record.includes('k=rsa') && !record.includes('p=')) issues.push('DKIM public key missing');
    const keyMatch = record.match(/p=([A-Za-z0-9+/=]+)/);
    if (keyMatch?.[1]) {
      const keyLength = Buffer.from(keyMatch[1], 'base64').length * 8;
      if (keyLength < 1024) issues.push(`DKIM key too short (${keyLength} bits, minimum 1024)`);
      else if (keyLength < 2048) issues.push(`DKIM key should be 2048 bits (currently ${keyLength})`);
    }
    return { selector: bare, valid: issues.length === 0, record, issues };
  } catch {
    return { selector: bare, valid: false, record: null, issues: [`DKIM selector '${bare}' not found`] };
  }
}

export async function checkDmarc(domain: string): Promise<DmarcResult> {
  try {
    const txt = await dns.promises.resolveTxt(`_dmarc.${domain}`);
    const record = txt.flat().join('');
    const issues: string[] = [];

    const policyMatch = record.match(/p=(none|quarantine|reject)/);
    const policy = (policyMatch?.[1] ?? null) as DmarcResult['policy'];
    if (!policy) issues.push('DMARC policy not set');
    if (policy === 'none') issues.push('DMARC policy is p=none — emails not protected yet');

    const hasRua = record.includes('rua=');
    if (!hasRua) issues.push('No DMARC aggregate report address (rua) — you are flying blind');

    const pct = record.match(/pct=(\d+)/)?.[1];
    if (pct && parseInt(pct, 10) < 100) issues.push(`DMARC pct=${pct} — policy only applies to ${pct}% of mail`);

    return { valid: issues.length === 0, record, policy, hasRua, issues };
  } catch {
    return { valid: false, record: null, policy: null, hasRua: false, issues: ['No DMARC record found'] };
  }
}

export async function checkMx(domain: string): Promise<string[]> {
  try {
    const mx = await dns.promises.resolveMx(domain);
    return mx.sort((a, b) => a.priority - b.priority).map((r) => r.exchange);
  } catch {
    return [];
  }
}

export function calculateHealthScore(results: {
  spf: SpfResult;
  dkim: DkimResult[];
  dmarc: DmarcResult;
  mx: string[];
}): number {
  let score = 100;
  if (!results.spf.valid) score -= 25;
  else if (results.spf.issues.length) score -= 10;
  if (!results.dkim.some((d) => d.valid)) score -= 25;
  if (!results.dmarc.valid) score -= 30;
  else if (results.dmarc.policy === 'none') score -= 10;
  if (!results.mx.length) score -= 20;
  return Math.max(0, score);
}

export async function checkDomainHealth(
  domain: string,
  dkimSelectors: string[],
): Promise<DomainHealth> {
  const selectors = dkimSelectors.length > 0 ? dkimSelectors : ['default'];
  const [spf, dkim, dmarc, mx] = await Promise.all([
    checkSpf(domain),
    Promise.all(selectors.map((s) => checkDkim(domain, s))),
    checkDmarc(domain),
    checkMx(domain),
  ]);
  const results = { spf, dkim, dmarc, mx };
  return { ...results, healthScore: calculateHealthScore(results) };
}
