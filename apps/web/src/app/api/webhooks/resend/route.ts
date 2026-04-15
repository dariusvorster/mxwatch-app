import { NextResponse } from 'next/server';
import { handleDeliveryEvent } from '@/lib/handle-delivery-event';

// Resend webhook. Payload shape: { type, data: { from, to, bounce: { message } ... } }
// Signature verification (Svix) is TODO — set up a shared secret outside the
// code for now, or rely on path-obscurity in self-host deployments.
export async function POST(req: Request) {
  const payload = await req.json().catch(() => null) as any;
  if (!payload?.type) return new NextResponse('Bad payload', { status: 400 });

  const data = payload.data ?? {};
  const from = data.from ?? (Array.isArray(data.from_email) ? data.from_email[0] : data.from_email);
  const to = Array.isArray(data.to) ? data.to[0] : data.to;

  switch (payload.type) {
    case 'email.sent':
    case 'email.delivered':
      await handleDeliveryEvent({ type: 'delivered', provider: 'resend', from, to });
      break;
    case 'email.bounced':
      await handleDeliveryEvent({
        type: 'bounced', provider: 'resend', from, to,
        errorMessage: data?.bounce?.message ?? null,
      });
      break;
    case 'email.complained':
      await handleDeliveryEvent({ type: 'complaint', provider: 'resend', from, to });
      break;
  }
  return new NextResponse('OK');
}
