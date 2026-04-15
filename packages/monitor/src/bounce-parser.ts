import { simpleParser } from 'mailparser';

export interface ParsedBounce {
  timestamp: Date;
  originalTo: string;
  originalFrom: string;
  recipientDomain: string;
  bounceType: 'hard' | 'soft' | 'policy' | 'unknown';
  errorCode: string;
  errorMessage: string;
  remoteMTA: string | null;
  relatedRBL: string | null;
  originalSubject?: string;
  originalMsgId?: string;
  originalSentAt?: Date;
}

const RBL_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'zen.spamhaus.org', re: /zen\.spamhaus\.org/i },
  { name: 'b.barracudacentral.org', re: /b\.barracudacentral\.org/i },
  { name: 'bl.spamcop.net', re: /bl\.spamcop\.net/i },
  { name: 'dnsbl.sorbs.net', re: /dnsbl\.sorbs\.net/i },
  { name: 'bl.mailspike.net', re: /bl\.mailspike\.net/i },
  { name: 'spamrats', re: /spamrats/i },
  { name: 'uceprotect', re: /uceprotect/i },
];

/** Matches a "Final-Recipient: rfc822; user@example.com" style line. */
export function extractDSNField(text: string, field: string): string | null {
  // DSN fields can span multiple lines (folded); concatenate continuation
  // whitespace-prefixed lines before matching.
  const unfolded = text.replace(/\r?\n[ \t]+/g, ' ');
  const re = new RegExp(`^${field}:\\s*(.+)$`, 'mi');
  return unfolded.match(re)?.[1]?.trim() ?? null;
}

export function detectRBLMention(text: string): string | null {
  for (const { name, re } of RBL_PATTERNS) {
    if (re.test(text)) return name;
  }
  return null;
}

function classifyBounce(status: string): ParsedBounce['bounceType'] {
  if (status.startsWith('4')) return 'soft';
  if (status.startsWith('5.7')) return 'policy';
  if (status.startsWith('5')) return 'hard';
  return 'unknown';
}

/**
 * Parses a raw RFC 3464 delivery-status notification (DSN) email. Returns
 * `null` when the email isn't a DSN, or when the required Final-Recipient/
 * Status fields can't be extracted.
 */
export async function parseDSN(rawEmail: string): Promise<ParsedBounce | null> {
  const parsed = await simpleParser(rawEmail);

  // simpleParser returns content-type as a structured object whose `value`
  // carries the primary type. Fallback to string matching when older
  // mailparser versions return a raw string.
  const ct = parsed.headers.get('content-type');
  const ctStr = typeof ct === 'string' ? ct : String((ct as any)?.value ?? '');
  const looksLikeReport = ctStr.toLowerCase().includes('report')
    || (parsed.attachments ?? []).some((a) => a.contentType?.includes('delivery-status'));
  if (!looksLikeReport) return null;

  // The delivery-status MIME part may come back as an attachment on older
  // mailparser builds, or be folded into `parsed.text` on newer ones. Try
  // the attachment first, fall back to the collapsed text body.
  const statusPart = (parsed.attachments ?? []).find((a) => a.contentType?.includes('delivery-status'));
  const statusText = statusPart
    ? (Buffer.isBuffer(statusPart.content) ? statusPart.content.toString('utf8') : String(statusPart.content))
    : (parsed.text ?? '');

  const finalRecipient = extractDSNField(statusText, 'Final-Recipient')
    ?? extractDSNField(statusText, 'Original-Recipient');
  const status = extractDSNField(statusText, 'Status');
  const diagnostic = extractDSNField(statusText, 'Diagnostic-Code');
  const remoteMTA = extractDSNField(statusText, 'Remote-MTA');
  const arrival = extractDSNField(statusText, 'Arrival-Date');

  if (!finalRecipient || !status) return null;

  const to = finalRecipient.replace(/^rfc822;\s*/i, '').trim().toLowerCase();
  const recipientDomain = to.includes('@') ? to.split('@').pop()! : '';
  const errorMessage = (diagnostic ?? status).replace(/^smtp;\s*/i, '').trim();
  const fromAddr =
    (typeof parsed.from === 'object' && parsed.from && 'value' in parsed.from
      ? (parsed.from.value[0]?.address ?? '')
      : '') || '';

  const rblMentioned = detectRBLMention(errorMessage);

  return {
    timestamp: arrival ? new Date(arrival) : new Date(),
    originalTo: to,
    originalFrom: fromAddr.toLowerCase(),
    recipientDomain,
    bounceType: classifyBounce(status),
    errorCode: status,
    errorMessage,
    remoteMTA: remoteMTA?.replace(/^dns;\s*/i, '').trim() || null,
    relatedRBL: rblMentioned,
    originalSubject: typeof parsed.subject === 'string' ? parsed.subject : undefined,
    originalMsgId: typeof parsed.messageId === 'string' ? parsed.messageId : undefined,
  };
}
