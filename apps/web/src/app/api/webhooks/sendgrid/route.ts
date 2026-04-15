import { NextResponse } from 'next/server';
import { handleDeliveryEvent } from '@/lib/handle-delivery-event';
import { verifySendGrid } from '@/lib/webhook-verify';
import { logger } from '@mxwatch/db';

// SendGrid Event Webhook (Ed25519-signed). Posts a JSON array of events.
// MXWATCH_WEBHOOK_SENDGRID_PUBKEY carries the base64-DER public key that
// SendGrid shows in the Event Webhook settings when Signed Event Webhook
// is enabled.
export async function POST(req: Request) {
  const rawBody = await req.text();
  const verify = verifySendGrid({ rawBody, headers: req.headers });
  if (!verify.ok) {
    if (verify.reason === 'not_configured') {
      void logger.warn('webhook', 'SendGrid webhook rejected: public key not configured');
      return new NextResponse('Webhook public key not configured', { status: 503 });
    }
    void logger.warn('webhook', `SendGrid signature failed: ${verify.reason}`);
    return new NextResponse('Unauthorized', { status: 401 });
  }

  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return new NextResponse('Bad JSON', { status: 400 }); }
  const events: any[] = Array.isArray(payload) ? payload : [payload];
  for (const e of events) {
    if (!e?.event) continue;
    const from = e.from ?? e['smtp-id'] ?? null;
    const to = e.email ?? null;
    switch (e.event) {
      case 'delivered':
        await handleDeliveryEvent({ type: 'delivered', provider: 'sendgrid', from, to });
        break;
      case 'bounce':
      case 'dropped':
        await handleDeliveryEvent({
          type: e.type === 'blocked' ? 'deferred' : 'bounced',
          provider: 'sendgrid', from, to,
          errorCode: e.status ?? null,
          errorMessage: e.reason ?? e.response ?? null,
        });
        break;
      case 'spamreport':
        await handleDeliveryEvent({ type: 'complaint', provider: 'sendgrid', from, to });
        break;
      case 'deferred':
        await handleDeliveryEvent({ type: 'deferred', provider: 'sendgrid', from, to });
        break;
    }
  }
  return new NextResponse('OK');
}
