import { getDb, schema, nanoid, logger } from '@mxwatch/db';
import { eq } from 'drizzle-orm';

export interface IncomingDeliveryEvent {
  type: 'delivered' | 'bounced' | 'deferred' | 'rejected' | 'complaint';
  provider: 'resend' | 'postmark' | 'mailgun' | 'sendgrid' | 'ses';
  from?: string | null;
  to?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  remoteMTA?: string | null;
  timestamp?: Date;
}

/**
 * Best-effort persistence for webhook-delivered events. Only `bounced`
 * and `complaint` land in the bounce_events table since that's what
 * drives the UI. Others get logged for observability.
 *
 * Domain resolution: matches the sender's address to an owned domain.
 * No match → skipped (we don't persist bounces for domains the user
 * doesn't monitor).
 */
export async function handleDeliveryEvent(e: IncomingDeliveryEvent): Promise<void> {
  const db = getDb();

  if (e.type === 'delivered' || e.type === 'deferred' || e.type === 'rejected') {
    void logger.debug('delivery', `${e.provider} ${e.type}`, {
      provider: e.provider, to: e.to, from: e.from,
    });
    return;
  }

  const senderDomain = (e.from ?? '').toLowerCase().split('@').pop();
  if (!senderDomain) return;

  const [owned] = await db
    .select({ id: schema.domains.id, domain: schema.domains.domain })
    .from(schema.domains)
    .where(eq(schema.domains.domain, senderDomain))
    .limit(1);
  if (!owned) {
    void logger.debug('delivery', 'Ignoring webhook event for unowned domain', {
      provider: e.provider, domain: senderDomain,
    });
    return;
  }

  const to = (e.to ?? '').toLowerCase();
  const recipientDomain = to.includes('@') ? to.split('@').pop()! : '';
  await db.insert(schema.bounceEvents).values({
    id: nanoid(),
    domainId: owned.id,
    timestamp: e.timestamp ?? new Date(),
    originalTo: to,
    recipientDomain,
    bounceType: e.type === 'complaint' ? 'policy' : 'hard',
    errorCode: e.errorCode ?? null,
    errorMessage: e.errorMessage ?? null,
    remoteMTA: e.remoteMTA ?? null,
    severity: e.type === 'complaint' ? 'warning' : 'info',
  });

  void logger.info('delivery', `Webhook bounce persisted from ${e.provider}`, {
    provider: e.provider, domain: owned.domain, recipientDomain, errorCode: e.errorCode,
  });
}
