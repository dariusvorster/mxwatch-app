import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getDb, schema, nanoid } from '@mxwatch/db';
import { eq } from 'drizzle-orm';
import { tierForVariantId } from '@/lib/cloud-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LemonEvent =
  | 'subscription_created'
  | 'subscription_updated'
  | 'subscription_cancelled'
  | 'subscription_resumed'
  | 'subscription_expired'
  | 'subscription_paused'
  | 'subscription_unpaused'
  | 'subscription_payment_success'
  | 'subscription_payment_failed'
  | 'order_created'
  | 'order_refunded';

export async function POST(req: Request) {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'billing not configured' }, { status: 503 });

  // CRITICAL: read raw bytes first — parsing JSON then re-stringifying breaks HMAC.
  const rawBody = await req.text();
  const signature = req.headers.get('x-signature') ?? '';
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))
  ) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  // Parse AFTER verification.
  let payload: any;
  try { payload = JSON.parse(rawBody); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const eventName = String(payload?.meta?.event_name ?? '') as LemonEvent | '';
  const customUserId: string | undefined = payload?.meta?.custom_data?.user_id;

  // Only subscription events populate our table. Orders are logged but ignored.
  if (!eventName.startsWith('subscription_')) {
    return NextResponse.json({ ok: true, ignored: eventName });
  }

  const attrs = payload?.data?.attributes ?? {};
  const lemonSubId = String(payload?.data?.id ?? '');
  if (!lemonSubId) return NextResponse.json({ error: 'missing subscription id' }, { status: 400 });

  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.lemonSubscriptions)
    .where(eq(schema.lemonSubscriptions.lemonSubscriptionId, lemonSubId))
    .limit(1);

  // Resolve userId: prefer existing row's, fall back to custom_data.
  const userId = existing?.userId ?? customUserId;
  if (!userId) {
    console.warn('[lemon-webhook] no user_id for subscription', lemonSubId);
    return NextResponse.json({ ok: true, note: 'no user mapping' });
  }

  const variantId = attrs.variant_id ? String(attrs.variant_id) : null;
  const now = new Date();
  const row = {
    userId,
    lemonSubscriptionId: lemonSubId,
    lemonCustomerId: attrs.customer_id ? String(attrs.customer_id) : null,
    lemonOrderId: attrs.order_id ? String(attrs.order_id) : null,
    lemonVariantId: variantId,
    tier: tierForVariantId(variantId),
    status: String(attrs.status ?? 'unknown'),
    renewsAt: attrs.renews_at ? new Date(attrs.renews_at) : null,
    endsAt: attrs.ends_at ? new Date(attrs.ends_at) : null,
    customerPortalUrl: attrs.urls?.customer_portal ?? null,
    updatePaymentUrl: attrs.urls?.update_payment_method ?? null,
    updatedAt: now,
  } as const;

  if (existing) {
    await db.update(schema.lemonSubscriptions).set(row).where(eq(schema.lemonSubscriptions.id, existing.id));
  } else {
    await db.insert(schema.lemonSubscriptions).values({
      id: nanoid(),
      ...row,
      createdAt: now,
    });
  }
  return NextResponse.json({ ok: true });
}
