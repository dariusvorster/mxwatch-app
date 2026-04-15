import { simpleParser, type ParsedMail } from 'mailparser';
import { and, eq, gte } from 'drizzle-orm';
import { getDb, schema } from '@mxwatch/db';
import { scoreDeliverability } from './deliverability-scorer';

/**
 * Shared handler for inbound deliverability-test emails. Used by both the
 * SMTP listener (own-domain mode) and the Stalwart-relay webhook. Accepts
 * the raw email (pre-parsed ParsedMail optional) + the recipient address +
 * the source IP / HELO when available.
 *
 * Returns the testId updated, or null if no matching pending test was found.
 */
export async function processDeliverabilityTestEmail(input: {
  rawEmail: string;
  parsed?: ParsedMail;
  testAddress: string;
  sourceIp?: string | null;
  heloName?: string | null;
  inboxMode?: 'own_domain' | 'stalwart_relay' | 'cloud';
}): Promise<string | null> {
  const db = getDb();
  const now = new Date();

  const [row] = await db
    .select()
    .from(schema.deliverabilityTests)
    .where(and(
      eq(schema.deliverabilityTests.testAddress, input.testAddress.toLowerCase()),
      gte(schema.deliverabilityTests.expiresAt, now),
    ))
    .limit(1);
  if (!row) return null;

  const mail = input.parsed ?? (await simpleParser(input.rawEmail));

  const headerEntries: string[] = [];
  for (const [k, v] of mail.headers) {
    headerEntries.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
  const rawHeaders = headerEntries.join('\n');

  const fromAddress = mail.from?.value?.[0]?.address ?? null;

  await db
    .update(schema.deliverabilityTests)
    .set({
      status: 'received',
      receivedAt: now,
      fromAddress,
      sourceIp: input.sourceIp ?? null,
      subject: mail.subject ?? null,
      rawHeaders,
      inboxMode: input.inboxMode ?? null,
      analysisSource: 'headers',
    })
    .where(eq(schema.deliverabilityTests.id, row.id));

  try {
    const result = await scoreDeliverability(mail, input.sourceIp ?? null, input.heloName ?? null);
    await db
      .update(schema.deliverabilityTests)
      .set({
        status: 'analyzed',
        score: Math.round(result.score * 10), // store as 0-100 integer
        results: JSON.stringify(result.checks),
      })
      .where(eq(schema.deliverabilityTests.id, row.id));
  } catch (e) {
    console.error('[deliverability] scoring failed', e);
  }

  return row.id;
}
