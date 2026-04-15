import { NextResponse } from 'next/server';
import { handleDeliveryEvent } from '@/lib/handle-delivery-event';

// Mailgun webhook. Sent as application/json with {signature, event-data}.
// Signature HMAC verification (timestamp + token + signing key) is TODO.
export async function POST(req: Request) {
  const ct = req.headers.get('content-type') ?? '';
  let payload: any = null;
  if (ct.includes('application/json')) {
    payload = await req.json().catch(() => null);
  } else {
    // Legacy multipart form submissions
    const fd = await req.formData().catch(() => null);
    if (fd) {
      const raw = fd.get('event-data');
      payload = { 'event-data': raw ? JSON.parse(String(raw)) : null };
    }
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
