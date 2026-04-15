import { NextResponse } from 'next/server';
import { simpleParser } from 'mailparser';
import { getDb, schema, logger } from '@mxwatch/db';
import { eq } from 'drizzle-orm';
import { processDeliverabilityTestEmail } from '@/lib/process-deliverability-test';

/**
 * Receives a full RFC822 email from a Stalwart catchall sieve script. The
 * Sieve script POSTs here with header X-Webhook-Secret — we match it
 * against the relay-mode config for any active user. No per-user prefix in
 * the URL since the secret is effectively the credential.
 */
export async function POST(req: Request) {
  const secret = req.headers.get('x-webhook-secret');
  if (!secret) return new NextResponse('Unauthorized', { status: 401 });

  const db = getDb();
  const [cfg] = await db
    .select()
    .from(schema.deliverabilityInboxConfig)
    .where(eq(schema.deliverabilityInboxConfig.webhookSecret, secret))
    .limit(1);
  if (!cfg || cfg.mode !== 'stalwart_relay') {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const rawEmail = await req.text();
  const parsed = await simpleParser(rawEmail);

  // Route to the first `mxwatch-test-*` recipient in the To header.
  const toHeader = parsed.headers.get('to');
  const toStr = typeof toHeader === 'string'
    ? toHeader
    : (toHeader as any)?.value?.[0]?.address ?? String(toHeader ?? '');
  const match = toStr.match(/([\w.\-+]+@[\w.-]+)/);
  const testAddress = match?.[1]?.toLowerCase();
  if (!testAddress) {
    await logger.warn('delivery', 'Stalwart webhook missing test address', { toHeader: String(toHeader).slice(0, 120) });
    return new NextResponse('OK', { status: 200 });
  }

  const testId = await processDeliverabilityTestEmail({
    rawEmail, parsed, testAddress,
    sourceIp: null, // Stalwart relay strips SMTP session info; IP lives in Received chain.
    heloName: null,
    inboxMode: 'stalwart_relay',
  });
  if (!testId) {
    await logger.warn('delivery', 'Stalwart webhook: no pending test for address', { testAddress });
  }

  return new NextResponse('OK', { status: 200 });
}
