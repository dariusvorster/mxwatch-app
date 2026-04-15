import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import {
  verifyResend, verifyMailgun, verifySendGrid, verifyPostmark,
} from '@/lib/webhook-verify';

// Each verifier is env-driven. Tests use the `*Env` override to avoid
// leaking global state between cases.

describe('verifyResend (Svix HMAC-SHA256)', () => {
  const secret = 'whsec_' + Buffer.from('a'.repeat(32)).toString('base64');
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const body = JSON.stringify({ type: 'email.delivered', data: { to: 'x@y.com' } });
  const id = 'msg_2NMcTxQSsyOYzMdl7FvXxDlTl1r';
  const ts = '1700000000';
  const sig = crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');

  function buildHeaders(signature: string) {
    return new Headers({
      'svix-id': id,
      'svix-timestamp': ts,
      'svix-signature': `v1,${signature}`,
    });
  }

  it('returns ok for a valid signature', () => {
    const r = verifyResend({ rawBody: body, headers: buildHeaders(sig), secretEnv: secret });
    expect(r.ok).toBe(true);
  });

  it('accepts space-separated multi-signature headers', () => {
    const multi = `v1,bogus v1,${sig} v1,other`;
    const r = verifyResend({
      rawBody: body,
      headers: new Headers({ 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': multi }),
      secretEnv: secret,
    });
    expect(r.ok).toBe(true);
  });

  it('rejects a tampered body', () => {
    const r = verifyResend({ rawBody: body + 'x', headers: buildHeaders(sig), secretEnv: secret });
    expect(r).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('returns not_configured when no secret is available', () => {
    const prev = process.env.MXWATCH_WEBHOOK_RESEND_SECRET;
    delete process.env.MXWATCH_WEBHOOK_RESEND_SECRET;
    try {
      const r = verifyResend({ rawBody: body, headers: buildHeaders(sig) });
      expect(r).toEqual({ ok: false, reason: 'not_configured' });
    } finally {
      if (prev !== undefined) process.env.MXWATCH_WEBHOOK_RESEND_SECRET = prev;
    }
  });

  it('reports missing_headers when required ones are absent', () => {
    const r = verifyResend({ rawBody: body, headers: new Headers(), secretEnv: secret });
    expect(r).toEqual({ ok: false, reason: 'missing_headers' });
  });
});

describe('verifyMailgun (HMAC-SHA256)', () => {
  const key = 'signingkey-abc123';
  const timestamp = '1700000000';
  const token = 'abc-token';
  const signature = crypto.createHmac('sha256', key).update(`${timestamp}${token}`).digest('hex');

  it('ok on matching signature', () => {
    const r = verifyMailgun({ signature: { timestamp, token, signature }, secretEnv: key });
    expect(r.ok).toBe(true);
  });

  it('rejects mismatched signature', () => {
    const r = verifyMailgun({ signature: { timestamp, token, signature: 'deadbeef' }, secretEnv: key });
    expect(r).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('returns missing_fields when the signature block is partial', () => {
    const r = verifyMailgun({ signature: { timestamp, token }, secretEnv: key });
    expect(r).toEqual({ ok: false, reason: 'missing_fields' });
  });

  it('not_configured without an env key', () => {
    const prev = process.env.MXWATCH_WEBHOOK_MAILGUN_SIGNING_KEY;
    delete process.env.MXWATCH_WEBHOOK_MAILGUN_SIGNING_KEY;
    try {
      const r = verifyMailgun({ signature: { timestamp, token, signature } });
      expect(r).toEqual({ ok: false, reason: 'not_configured' });
    } finally {
      if (prev !== undefined) process.env.MXWATCH_WEBHOOK_MAILGUN_SIGNING_KEY = prev;
    }
  });
});

describe('verifySendGrid (Ed25519)', () => {
  // Generate a fresh keypair per test run. SendGrid distributes the public
  // key as base64-encoded DER (subjectPublicKeyInfo).
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubDerBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

  const body = JSON.stringify([{ event: 'delivered', email: 'a@b.com' }]);
  const ts = '1700000000';
  const sig = crypto.sign(null, Buffer.from(`${ts}${body}`, 'utf8'), privateKey).toString('base64');

  function headers(signature: string, timestamp: string) {
    return new Headers({
      'x-twilio-email-event-webhook-signature': signature,
      'x-twilio-email-event-webhook-timestamp': timestamp,
    });
  }

  it('ok on a valid signature', () => {
    const r = verifySendGrid({ rawBody: body, headers: headers(sig, ts), pubkeyEnv: pubDerBase64 });
    expect(r.ok).toBe(true);
  });

  it('rejects a modified body', () => {
    const r = verifySendGrid({ rawBody: body + 'x', headers: headers(sig, ts), pubkeyEnv: pubDerBase64 });
    expect(r.ok).toBe(false);
  });

  it('rejects a truncated signature', () => {
    const r = verifySendGrid({ rawBody: body, headers: headers('aaa', ts), pubkeyEnv: pubDerBase64 });
    expect(r.ok).toBe(false);
  });

  it('missing_headers when one of the two headers is absent', () => {
    const r = verifySendGrid({
      rawBody: body,
      headers: new Headers({ 'x-twilio-email-event-webhook-signature': sig }),
      pubkeyEnv: pubDerBase64,
    });
    expect(r).toEqual({ ok: false, reason: 'missing_headers' });
  });
});

describe('verifyPostmark (HTTP Basic)', () => {
  const creds = 'mxwatch:correct-horse-battery-staple';
  const header = `Basic ${Buffer.from(creds).toString('base64')}`;

  it('ok on matching creds', () => {
    expect(verifyPostmark({ authHeader: header, secretEnv: creds })).toEqual({ ok: true });
  });

  it('rejects different creds', () => {
    const other = `Basic ${Buffer.from('mxwatch:wrong').toString('base64')}`;
    expect(verifyPostmark({ authHeader: other, secretEnv: creds })).toEqual({ ok: false, reason: 'auth_mismatch' });
  });

  it('missing_basic_auth when no Authorization header', () => {
    expect(verifyPostmark({ authHeader: null, secretEnv: creds })).toEqual({ ok: false, reason: 'missing_basic_auth' });
  });

  it('not_configured when no secret is set', () => {
    const prev = process.env.MXWATCH_WEBHOOK_POSTMARK_BASIC_AUTH;
    delete process.env.MXWATCH_WEBHOOK_POSTMARK_BASIC_AUTH;
    try {
      expect(verifyPostmark({ authHeader: header })).toEqual({ ok: false, reason: 'not_configured' });
    } finally {
      if (prev !== undefined) process.env.MXWATCH_WEBHOOK_POSTMARK_BASIC_AUTH = prev;
    }
  });
});
