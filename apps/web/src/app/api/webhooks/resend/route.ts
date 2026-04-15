import { NextResponse } from 'next/server';
import { handleDeliveryEvent } from '@/lib/handle-delivery-event';
import { verifyResend } from '@/lib/webhook-verify';
import { logger } from '@mxwatch/db';

// Resend webhook (Svix-signed). MXWATCH_WEBHOOK_RESEND_SECRET must be set —
// the endpoint returns 503 until it is so misconfiguration is loud.
export async function POST(req: Request) {
  const rawBody = await req.text();
  const verify = verifyResend({ rawBody, headers: req.headers });
  if (!verify.ok) {
    if (verify.reason === 'not_configured') {
      void logger.warn('webhook', 'Resend webhook rejected: secret not configured');
      return new NextResponse('Webhook secret not configured', { status: 503 });
    }
    void logger.warn('webhook', `Resend signature failed: ${verify.reason}`);
    return new NextResponse('Unauthorized', { status: 401 });
  }

  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return new NextResponse('Bad JSON', { status: 400 }); }
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
