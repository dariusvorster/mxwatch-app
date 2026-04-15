import crypto from 'node:crypto';

/**
 * Per-provider webhook signature verification. Each helper returns
 * `{ ok: true }` when the signature is valid against the configured env-var
 * secret, or `{ ok: false, reason }` with a human-readable reason otherwise.
 * Missing env-var → fail closed with reason='not_configured' so the handler
 * returns 503 and the operator sees the misconfiguration.
 */

export type VerifyResult = { ok: true } | { ok: false; reason: string };

function timingSafeEqualStrings(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Resend uses Svix webhooks: headers `svix-id`, `svix-timestamp`,
 * `svix-signature` (space-separated list of `v1,<base64>`). The signed
 * payload is `${id}.${timestamp}.${body}` with a key that starts with
 * `whsec_`.
 */
export function verifyResend(opts: {
  rawBody: string;
  headers: Headers;
  secretEnv?: string;
}): VerifyResult {
  const secret = opts.secretEnv ?? process.env.MXWATCH_WEBHOOK_RESEND_SECRET;
  if (!secret) return { ok: false, reason: 'not_configured' };

  const id = opts.headers.get('svix-id');
  const ts = opts.headers.get('svix-timestamp');
  const sigHeader = opts.headers.get('svix-signature');
  if (!id || !ts || !sigHeader) return { ok: false, reason: 'missing_headers' };

  const key = secret.startsWith('whsec_')
    ? Buffer.from(secret.slice('whsec_'.length), 'base64')
    : Buffer.from(secret, 'utf8');
  const toSign = `${id}.${ts}.${opts.rawBody}`;
  const expected = crypto.createHmac('sha256', key).update(toSign).digest('base64');

  // svix-signature may carry multiple signatures; match any.
  const sigs = sigHeader
    .split(' ')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('v1,'))
    .map((s) => s.slice('v1,'.length));
  for (const s of sigs) if (timingSafeEqualStrings(s, expected)) return { ok: true };
  return { ok: false, reason: 'signature_mismatch' };
}

/**
 * Mailgun signs each webhook with HMAC-SHA256 over `timestamp + token` using
 * the HTTP Webhook signing key. Body shape: JSON `{ signature: { timestamp,
 * token, signature }, event-data: {...} }`.
 */
export function verifyMailgun(opts: {
  signature?: { timestamp?: string; token?: string; signature?: string };
  secretEnv?: string;
}): VerifyResult {
  const key = opts.secretEnv ?? process.env.MXWATCH_WEBHOOK_MAILGUN_SIGNING_KEY;
  if (!key) return { ok: false, reason: 'not_configured' };
  const s = opts.signature;
  if (!s?.timestamp || !s?.token || !s?.signature) return { ok: false, reason: 'missing_fields' };

  const expected = crypto
    .createHmac('sha256', key)
    .update(`${s.timestamp}${s.token}`)
    .digest('hex');
  return timingSafeEqualStrings(s.signature, expected)
    ? { ok: true }
    : { ok: false, reason: 'signature_mismatch' };
}

/**
 * SendGrid's Event Webhook signs each POST with Ed25519. Headers:
 *   X-Twilio-Email-Event-Webhook-Signature  (base64)
 *   X-Twilio-Email-Event-Webhook-Timestamp  (epoch seconds)
 * Signed payload: `${timestamp}${rawBody}`.
 */
export function verifySendGrid(opts: {
  rawBody: string;
  headers: Headers;
  pubkeyEnv?: string;
}): VerifyResult {
  const pub = opts.pubkeyEnv ?? process.env.MXWATCH_WEBHOOK_SENDGRID_PUBKEY;
  if (!pub) return { ok: false, reason: 'not_configured' };

  const sig = opts.headers.get('x-twilio-email-event-webhook-signature');
  const ts = opts.headers.get('x-twilio-email-event-webhook-timestamp');
  if (!sig || !ts) return { ok: false, reason: 'missing_headers' };

  try {
    // SendGrid ships the public key as base64 DER. Convert to PEM for Node.
    const pem = `-----BEGIN PUBLIC KEY-----\n${pub.replace(/(.{64})/g, '$1\n')}\n-----END PUBLIC KEY-----\n`;
    const keyObj = crypto.createPublicKey(pem);
    const data = Buffer.from(`${ts}${opts.rawBody}`, 'utf8');
    const signature = Buffer.from(sig, 'base64');
    const valid = crypto.verify(null, data, keyObj, signature);
    return valid ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
  } catch (e: any) {
    return { ok: false, reason: `verify_error: ${e?.message ?? 'unknown'}` };
  }
}

/**
 * Postmark doesn't sign payloads; it supports HTTP Basic auth on the
 * webhook URL itself. We match the Authorization header against a
 * configured `user:password` string.
 */
export function verifyPostmark(opts: {
  authHeader?: string | null;
  secretEnv?: string;
}): VerifyResult {
  const expected = opts.secretEnv ?? process.env.MXWATCH_WEBHOOK_POSTMARK_BASIC_AUTH;
  if (!expected) return { ok: false, reason: 'not_configured' };
  if (!opts.authHeader?.startsWith('Basic ')) return { ok: false, reason: 'missing_basic_auth' };
  const decoded = Buffer.from(opts.authHeader.slice('Basic '.length), 'base64').toString('utf8');
  return timingSafeEqualStrings(decoded, expected)
    ? { ok: true }
    : { ok: false, reason: 'auth_mismatch' };
}
