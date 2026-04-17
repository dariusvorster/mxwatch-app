export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { handleDeliveryEvent } from '@/lib/handle-delivery-event';
import { verifyMailgun } from '@/lib/webhook-verify';
import { logger } from '@mxwatch/db';

// Mailgun webhook. Payload shape: { signature: { timestamp, token, signature },
// event-data: {...} }. HMAC-SHA256(signingKey, timestamp+token) must match
// signature.signature. MXWATCH_WEBHOOK_MAILGUN_SIGNING_KEY supplies the key.
export async function POST(req: Request) {
  const ct = req.headers.get('content-type') ?? '';
  let payload: any = null;
  if (ct.includes('application/json')) {
    payload = await req.json().catch(() => null);
  } else {
    const fd = await req.formData().catch(() => null);
    if (fd) {
      const raw = fd.get('event-data');
      const sig = fd.get('signature');
      payload = {
        'event-data': raw ? JSON.parse(String(raw)) : null,
        signature: sig ? JSON.parse(String(sig)) : {
          timestamp: fd.get('timestamp'), token: fd.get('token'), signature: fd.get('signature'),
        },
      };
    }
  }

  const verify = verifyMailgun({ signature: payload?.signature });
  if (!verify.ok) {
    if (verify.reason === 'not_configured') {
      void logger.warn('webhook', 'Mailgun webhook rejected: signing key not configured');
      return new NextResponse('Webhook signing key not configured', { status: 503 });
    }
    void logger.warn('webhook', `Mailgun signature failed: ${verify.reason}`);
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const e = payload?.['event-data'];
  if (!e?.event) return new NextResponse('Bad payload', { status: 400 });

  const from = e?.envelope?.sender ?? e?.message?.headers?.from;
  const to = e?.recipient;

  switch (e.event) {
    case 'delivered':
      await handleDeliveryEvent({ type: 'delivered', provider: 'mailgun', from, to });
      break;
    case 'failed':
      await handleDeliveryEvent({
        type: e.severity === 'temporary' ? 'deferred' : 'bounced',
        provider: 'mailgun', from, to,
        errorCode: e['delivery-status']?.code ? String(e['delivery-status'].code) : null,
        errorMessage: e['delivery-status']?.description ?? e.reason ?? null,
      });
      break;
    case 'complained':
      await handleDeliveryEvent({ type: 'complaint', provider: 'mailgun', from, to });
      break;
    case 'rejected':
      await handleDeliveryEvent({ type: 'rejected', provider: 'mailgun', from, to });
      break;
  }
  return new NextResponse('OK');
}
