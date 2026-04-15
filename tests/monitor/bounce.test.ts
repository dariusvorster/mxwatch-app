import { describe, it, expect } from 'vitest';
import { parseDSN, extractDSNField, detectRBLMention, correlateBounce } from '@mxwatch/monitor';

const HARD_DSN = [
  'From: MAILER-DAEMON@mail.example.com',
  'Subject: Undeliverable mail',
  'Content-Type: multipart/report; report-type=delivery-status; boundary="=_bndry"',
  '',
  '--=_bndry',
  'Content-Type: text/plain',
  '',
  'Delivery to the following recipient failed permanently.',
  '',
  '--=_bndry',
  'Content-Type: message/delivery-status',
  '',
  'Reporting-MTA: dns; mail.example.com',
  'Arrival-Date: Tue, 14 Apr 2026 10:00:00 +0000',
  '',
  'Final-Recipient: rfc822; noone@icloud.com',
  'Action: failed',
  'Status: 5.1.1',
  'Remote-MTA: dns; mx01.mail.icloud.com',
  'Diagnostic-Code: smtp; 550 5.1.1 The email account that you tried to reach does not exist',
  '',
  '--=_bndry--',
  '',
].join('\r\n');

const POLICY_DSN = HARD_DSN
  .replace('Status: 5.1.1', 'Status: 5.7.1')
  .replace(
    '550 5.1.1 The email account that you tried to reach does not exist',
    '550 5.7.1 Service unavailable; client blocked using zen.spamhaus.org',
  );

describe('extractDSNField', () => {
  it('reads folded continuation lines', () => {
    const txt = 'Diagnostic-Code: smtp;\r\n 550 5.1.1 reason\r\nStatus: 5.1.1';
    expect(extractDSNField(txt, 'Diagnostic-Code')).toBe('smtp; 550 5.1.1 reason');
    expect(extractDSNField(txt, 'Status')).toBe('5.1.1');
  });
});

describe('detectRBLMention', () => {
  it('finds spamhaus zen reference', () => {
    expect(detectRBLMention('blocked using zen.spamhaus.org for policy reasons')).toBe('zen.spamhaus.org');
  });
  it('returns null when nothing matches', () => {
    expect(detectRBLMention('temporary failure please retry')).toBeNull();
  });
});

describe('parseDSN', () => {
  it('parses a hard bounce with Final-Recipient + Status', async () => {
    const r = await parseDSN(HARD_DSN);
    expect(r).not.toBeNull();
    expect(r!.bounceType).toBe('hard');
    expect(r!.errorCode).toBe('5.1.1');
    expect(r!.originalTo).toBe('noone@icloud.com');
    expect(r!.recipientDomain).toBe('icloud.com');
    expect(r!.relatedRBL).toBeNull();
    expect(r!.remoteMTA).toBe('mx01.mail.icloud.com');
  });

  it('classifies 5.7.x as policy and flags the cited RBL', async () => {
    const r = await parseDSN(POLICY_DSN);
    expect(r!.bounceType).toBe('policy');
    expect(r!.relatedRBL).toBe('zen.spamhaus.org');
  });

  it('returns null for a non-DSN message', async () => {
    const plain = 'From: a@x\r\nSubject: hello\r\nContent-Type: text/plain\r\n\r\nbody\r\n';
    expect(await parseDSN(plain)).toBeNull();
  });
});

describe('correlateBounce', () => {
  const baseBounce = {
    timestamp: new Date(),
    originalTo: 'x@icloud.com',
    originalFrom: 'me@ours.com',
    recipientDomain: 'icloud.com',
    errorCode: '5.7.1',
    errorMessage: '',
    remoteMTA: null,
    relatedRBL: null,
  } as const;

  it('raises critical severity when policy bounce + active RBL listing', () => {
    const c = correlateBounce({
      bounce: { ...baseBounce, bounceType: 'policy', relatedRBL: 'zen.spamhaus.org' },
      recentBouncesToSameDomain: 1,
      activeRBLListing: { rblName: 'zen.spamhaus.org', delistUrl: 'https://check.spamhaus.org/' },
    });
    expect(c.severity).toBe('critical');
    expect(c.suggestedAction).toMatch(/zen\.spamhaus/);
  });

  it('upgrades info → warning on spike (3+ bounces)', () => {
    const c = correlateBounce({
      bounce: { ...baseBounce, bounceType: 'hard' },
      recentBouncesToSameDomain: 4,
      activeRBLListing: null,
    });
    expect(c.severity).toBe('warning');
    expect(c.suggestedAction).toMatch(/4 bounces/);
  });

  it('stays info for a single hard bounce with no correlations', () => {
    const c = correlateBounce({
      bounce: { ...baseBounce, bounceType: 'hard' },
      recentBouncesToSameDomain: 0,
      activeRBLListing: null,
    });
    expect(c.severity).toBe('info');
  });
});
