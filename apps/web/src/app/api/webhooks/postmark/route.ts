import { NextResponse } from 'next/server';
import { handleDeliveryEvent } from '@/lib/handle-delivery-event';
import { verifyPostmark } from '@/lib/webhook-verify';
import { logger } from '@mxwatch/db';

// Postmark webhook. Authenticated via HTTP Basic auth — set
// MXWATCH_WEBHOOK_POSTMARK_BASIC_AUTH to 'user:password' and configure the
// same creds in Postmark's webhook settings.
export async function POST(req: Request) {
  const verify = verifyPostmark({ authHeader: req.headers.get('authorization') });
  if (!verify.ok) {
    if (verify.reason === 'not_configured') {
      void logger.warn('webhook', 'Postmark webhook rejected: basic-auth not configured');
      return new NextResponse('Webhook auth not configured', { status: 503 });
    }
    void logger.warn('webhook', `Postmark auth failed: ${verify.reason}`);
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const payload = await req.json().catch(() => null) as any;
  if (!payload?.RecordType) return new NextResponse('Bad payload', { status: 400 });

  const from = payload.From ?? payload.OriginalFrom;
  const to = payload.Email ?? payload.Recipient;

  switch (payload.RecordType) {
    case 'Delivery':
      await handleDeliveryEvent({ type: 'delivered', provider: 'postmark', from, to });
      break;
    case 'Bounce':
      await handleDeliveryEvent({
        type: payload.Type === 'HardBounce' ? 'bounced' : 'deferred',
        provider: 'postmark',
        from, to,
        errorCode: payload.Code ? String(payload.Code) : null,
        errorMessage: payload.Description ?? payload.Details ?? null,
      });
      break;
    case 'SpamComplaint':
      await handleDeliveryEvent({ type: 'complaint', provider: 'postmark', from, to });
      break;
  }
  return new NextResponse('OK');
}
