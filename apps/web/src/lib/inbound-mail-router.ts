import type { ParsedMail, SMTPServerSession } from '@mxwatch/monitor/smtp-listener';
import { extractDmarcXml, firstRecipient } from '@mxwatch/monitor/smtp-listener';
import { getDb, schema } from '@mxwatch/db';
import { and, eq, gte } from 'drizzle-orm';
import { ingestDmarcXml } from './dmarc-ingest';
import { scoreDeliverability } from './deliverability-scorer';

function remoteIp(session: SMTPServerSession): string | null {
  const ra = (session as any).remoteAddress as string | undefined;
  if (!ra) return null;
  // Strip IPv6-mapped IPv4 prefix if present.
  return ra.replace(/^::ffff:/, '');
}

function clientHostname(session: SMTPServerSession): string | null {
  return (session as any).clientHostname ?? (session as any).hostNameAppearsAs ?? null;
}

async function handleDeliverabilityTest(mail: ParsedMail, session: SMTPServerSession, testAddress: string) {
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .select()
    .from(schema.deliverabilityTests)
    .where(and(
      eq(schema.deliverabilityTests.testAddress, testAddress.toLowerCase()),
      gte(schema.deliverabilityTests.expiresAt, now),
    ))
    .limit(1);
  if (!row) return;

  // Collect raw headers blob for display
  const headerEntries: string[] = [];
  for (const [k, v] of mail.headers) {
    headerEntries.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
  const rawHeaders = headerEntries.join('\n');

  const fromAddress = mail.from?.value?.[0]?.address ?? null;
  const sourceIp = remoteIp(session);
  const helo = clientHostname(session);

  await db
    .update(schema.deliverabilityTests)
    .set({
      status: 'received',
      receivedAt: now,
      fromAddress,
      sourceIp,
      subject: mail.subject ?? null,
      rawHeaders,
    })
    .where(eq(schema.deliverabilityTests.id, row.id));

  // Analyze asynchronously but in-process; the UI polls for the score.
  try {
    const result = await scoreDeliverability(mail, sourceIp, helo);
    await db
      .update(schema.deliverabilityTests)
      .set({
        status: 'analyzed',
        score: Math.round(result.score * 10), // store 0..100 (one decimal precision)
        results: JSON.stringify(result.checks),
      })
      .where(eq(schema.deliverabilityTests.id, row.id));
  } catch (e) {
    console.error('[inbound-mail-router] scoring failed', e);
  }
}

/** Routes every inbound mail to the right pipeline. */
export async function routeInboundMail(mail: ParsedMail, session: SMTPServerSession): Promise<void> {
  const rcpt = firstRecipient(session);

  // Deliverability test: recipient local-part starts with `test-`.
  if (rcpt && rcpt.local.startsWith('test-')) {
    const addr = `${rcpt.local}@${rcpt.domain}`;
    await handleDeliverabilityTest(mail, session, addr);
    return;
  }

  // DMARC aggregate reports: XML / ZIP / GZIP attachments.
  const xmls = extractDmarcXml(mail);
  if (xmls.length > 0) {
    const from = session.envelope.mailFrom ? session.envelope.mailFrom.address : 'unknown';
    for (const xml of xmls) {
      await ingestDmarcXml(xml, from);
    }
    return;
  }
  // Anything else: drop silently.
}
