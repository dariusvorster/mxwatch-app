import { NextResponse } from 'next/server';
import { handleDeliveryEvent } from '@/lib/handle-delivery-event';

// SendGrid Event Webhook. Posts a JSON array of events.
// ECDSA signature verification (Ed25519) is TODO.
export async function POST(req: Request) {
  const payload = await req.json().catch(() => null) as any;
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
