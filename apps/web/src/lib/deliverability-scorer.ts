import { simpleParser, type ParsedMail } from 'mailparser';
import { checkIpAgainstAllBlacklists } from '@mxwatch/monitor';
import dns from 'node:dns';

export interface CheckResult {
  pass: boolean;
  score: number;
  max: number;
  message: string;
  fix?: string;
}

export interface DeliverabilityResult {
  score: number; // 0..10 (1 decimal)
  checks: Record<string, CheckResult>;
}

// Point budget — should sum to 10.0
const MAX = {
  spf: 1.0,
  dkim: 1.5,
  dmarc: 1.0,
  reverseDns: 1.0,
  noRbl: 2.0,
  helo: 0.5,
  htmlTextRatio: 0.5,
  noSuspiciousLinks: 1.0,
  subjectOk: 0.5,
  bodyOk: 1.0,
} as const;

// ---------- Helpers ----------

const SPAM_WORDS_SUBJECT = [
  'free!!', 'winner', 'congratulations you', '100% guaranteed', 'act now',
  'click here', 'make money', 'risk-free', 'viagra', 'cialis', 'lottery',
];
const SPAM_WORDS_BODY = ['click here to claim', 'wire transfer', 'urgent reply', 'bank details', 'account suspended'];

function parseAuthResults(raw: string): { spf?: 'pass' | 'fail'; dkim?: 'pass' | 'fail'; dmarc?: 'pass' | 'fail' } {
  const out: { spf?: 'pass' | 'fail'; dkim?: 'pass' | 'fail'; dmarc?: 'pass' | 'fail' } = {};
  const spf = raw.match(/spf=(pass|fail|softfail|neutral|none|temperror|permerror)/i);
  if (spf) out.spf = spf[1]!.toLowerCase() === 'pass' ? 'pass' : 'fail';
  const dkim = raw.match(/dkim=(pass|fail|neutral|none|temperror|permerror)/i);
  if (dkim) out.dkim = dkim[1]!.toLowerCase() === 'pass' ? 'pass' : 'fail';
  const dmarc = raw.match(/dmarc=(pass|fail|none|temperror|permerror)/i);
  if (dmarc) out.dmarc = dmarc[1]!.toLowerCase() === 'pass' ? 'pass' : 'fail';
  return out;
}

function firstHeader(mail: ParsedMail, name: string): string | null {
  const v = mail.headers.get(name.toLowerCase());
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return String(v[0] ?? '');
  return String(v);
}

async function reverseDns(ip: string | null): Promise<string[]> {
  if (!ip) return [];
  try { return await dns.promises.reverse(ip); } catch { return []; }
}

// ---------- Main scorer ----------

export async function scoreDeliverability(
  mail: ParsedMail,
  sourceIp: string | null,
  heloName: string | null,
): Promise<DeliverabilityResult> {
  const checks: Record<string, CheckResult> = {};

  // Authentication-Results header (may be multiple, join them)
  const authRaw = firstHeader(mail, 'authentication-results') ?? '';
  const auth = parseAuthResults(authRaw);

  // SPF
  checks.spf = auth.spf === 'pass'
    ? { pass: true, score: MAX.spf, max: MAX.spf, message: 'SPF passed' }
    : { pass: false, score: 0, max: MAX.spf, message: `SPF ${auth.spf ?? 'not present'}`, fix: 'Publish an SPF TXT record and include every sender.' };

  // DKIM
  checks.dkim = auth.dkim === 'pass'
    ? { pass: true, score: MAX.dkim, max: MAX.dkim, message: 'DKIM signature valid' }
    : { pass: false, score: 0, max: MAX.dkim, message: `DKIM ${auth.dkim ?? 'not signed'}`, fix: 'Enable DKIM signing on your mail server and publish the public key.' };

  // DMARC
  checks.dmarc = auth.dmarc === 'pass'
    ? { pass: true, score: MAX.dmarc, max: MAX.dmarc, message: 'DMARC aligned' }
    : { pass: false, score: 0, max: MAX.dmarc, message: `DMARC ${auth.dmarc ?? 'not evaluated'}`, fix: 'Align the From domain with SPF or DKIM and publish a DMARC record.' };

  // Reverse DNS match
  const ptrs = await reverseDns(sourceIp);
  const reverseOk = ptrs.length > 0 && !!heloName && ptrs.some((p) => p.toLowerCase() === heloName.toLowerCase());
  checks.reverseDns = reverseOk
    ? { pass: true, score: MAX.reverseDns, max: MAX.reverseDns, message: `PTR matches HELO (${ptrs[0]})` }
    : { pass: false, score: 0, max: MAX.reverseDns, message: ptrs[0] ? `PTR ${ptrs[0]} ≠ HELO ${heloName ?? '—'}` : 'No reverse DNS', fix: 'Set the PTR record for your sending IP to match the HELO your MTA uses.' };

  // RBL check
  if (sourceIp) {
    const rbl = await checkIpAgainstAllBlacklists(sourceIp);
    checks.noRbl = rbl.isListed
      ? { pass: false, score: 0, max: MAX.noRbl, message: `Listed on ${rbl.listedOn.join(', ')}`, fix: 'Investigate root cause and request delisting from each RBL.' }
      : { pass: true, score: MAX.noRbl, max: MAX.noRbl, message: 'Clean on all monitored RBLs' };
  } else {
    checks.noRbl = { pass: false, score: 0, max: MAX.noRbl, message: 'No source IP captured' };
  }

  // HELO validity (has a dot, not an IP literal or "localhost")
  const heloOk = !!heloName && /\./.test(heloName) && heloName.toLowerCase() !== 'localhost' && !/^\d+(\.\d+){3}$/.test(heloName);
  checks.helo = heloOk
    ? { pass: true, score: MAX.helo, max: MAX.helo, message: `HELO ${heloName}` }
    : { pass: false, score: 0, max: MAX.helo, message: `HELO ${heloName ?? '—'} looks invalid`, fix: 'Configure your MTA to HELO with a fully qualified hostname that matches your PTR.' };

  // HTML/text ratio
  const hasText = !!mail.text && mail.text.trim().length > 10;
  const hasHtml = !!mail.html && (typeof mail.html === 'string' ? mail.html : '').trim().length > 10;
  const ratioOk = hasText && (hasHtml ? (mail.text!.length >= 0.1 * (mail.html as string).length) : true);
  checks.htmlTextRatio = ratioOk
    ? { pass: true, score: MAX.htmlTextRatio, max: MAX.htmlTextRatio, message: hasHtml ? 'Multipart with balanced text / HTML' : 'Plain-text only' }
    : { pass: false, score: 0, max: MAX.htmlTextRatio, message: 'No plain-text alternative or text too short', fix: 'Always include a text/plain alternative with content proportional to the HTML.' };

  // Suspicious links
  const htmlStr = typeof mail.html === 'string' ? mail.html : '';
  const linksSuspicious = /bit\.ly|tinyurl|goo\.gl|t\.co\//i.test(htmlStr + ' ' + (mail.text ?? ''));
  checks.noSuspiciousLinks = linksSuspicious
    ? { pass: false, score: 0, max: MAX.noSuspiciousLinks, message: 'Contains shortener links', fix: 'Remove URL shorteners — receivers treat them as phishing signals.' }
    : { pass: true, score: MAX.noSuspiciousLinks, max: MAX.noSuspiciousLinks, message: 'No shortener links' };

  // Subject / body spam words
  const subject = (mail.subject ?? '').toLowerCase();
  const subjectBad = SPAM_WORDS_SUBJECT.some((w) => subject.includes(w));
  checks.subjectOk = subjectBad
    ? { pass: false, score: 0, max: MAX.subjectOk, message: 'Subject contains spammy phrases', fix: 'Rewrite the subject without loud CTAs or all-caps phrases.' }
    : { pass: true, score: MAX.subjectOk, max: MAX.subjectOk, message: 'Subject is clean' };

  const bodyStr = ((mail.text ?? '') + ' ' + htmlStr).toLowerCase();
  const bodyBad = SPAM_WORDS_BODY.some((w) => bodyStr.includes(w));
  checks.bodyOk = bodyBad
    ? { pass: false, score: 0, max: MAX.bodyOk, message: 'Body contains common spam phrases', fix: 'Remove phrases like "click here to claim", "account suspended".' }
    : { pass: true, score: MAX.bodyOk, max: MAX.bodyOk, message: 'Body text is clean' };

  const total = Object.values(checks).reduce((s, c) => s + c.score, 0);
  return { score: Math.round(total * 10) / 10, checks };
}

/**
 * Mode 3 — manual header paste. User copies full raw headers from their mail
 * client and we parse them as if they were a received email. simpleParser
 * handles header-only input. The sending IP is extracted from the last
 * `Received:` hop (the one where the headers were added by the recipient
 * server); HELO comes from the same line when available.
 */
export async function scoreFromHeaderPaste(headersPaste: string): Promise<DeliverabilityResult> {
  const parsed = await simpleParser(headersPaste);
  const receivedHeaders = parsed.headers.get('received') ?? [];
  const received: string[] = Array.isArray(receivedHeaders)
    ? receivedHeaders.map(String)
    : [String(receivedHeaders)];
  const sourceIp = extractSendingIp(received);
  const heloName = extractHelo(received);
  return scoreDeliverability(parsed, sourceIp, heloName);
}

/** Walks Received headers newest→oldest looking for the earliest `from X (Y [IP])`
 *  clause — that's the originating MTA the user is evaluating. */
function extractSendingIp(received: string[]): string | null {
  for (let i = received.length - 1; i >= 0; i--) {
    const m = received[i]!.match(/\[([0-9a-fA-F.:]+)\]/);
    if (m?.[1] && !m[1].startsWith('127.')) return m[1];
  }
  return null;
}

function extractHelo(received: string[]): string | null {
  for (let i = received.length - 1; i >= 0; i--) {
    const m = received[i]!.match(/from\s+([\w.-]+)/i);
    if (m?.[1] && m[1].includes('.')) return m[1];
  }
  return null;
}
