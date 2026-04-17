import nodemailer from 'nodemailer';
import { getDb, schema } from '@mxwatch/db';
import { eq, desc } from 'drizzle-orm';

// Only runs on Monday — called from a daily scheduleDailyUtc job.
export async function sendWeeklyDigests(): Promise<void> {
  if (new Date().getDay() !== 1) return; // 0=Sun, 1=Mon

  const host = process.env.ALERT_SMTP_HOST;
  if (!host) {
    console.warn('[weekly-digest] ALERT_SMTP_HOST not set — skipping');
    return;
  }

  const db = getDb();
  const users = await db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.digestEnabled, true));

  if (users.length === 0) return;

  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.ALERT_SMTP_PORT ?? 587),
    secure: Number(process.env.ALERT_SMTP_PORT ?? 587) === 465,
    auth: process.env.ALERT_SMTP_USER
      ? { user: process.env.ALERT_SMTP_USER, pass: process.env.ALERT_SMTP_PASS }
      : undefined,
  });

  const from = process.env.ALERT_SMTP_FROM ?? 'mxwatch@localhost';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  for (const user of users) {
    try {
      const body = await buildDigest(db, user.id, appUrl);
      if (!body) continue; // no domains
      await transport.sendMail({
        from,
        to: user.email,
        subject: `MxWatch weekly digest — ${new Date().toDateString()}`,
        text: body,
      });
    } catch (err) {
      console.error(`[weekly-digest] failed to send to ${user.email}:`, err);
    }
  }
}

async function buildDigest(
  db: ReturnType<typeof getDb>,
  userId: string,
  appUrl: string,
): Promise<string | null> {
  const domains = await db
    .select({ id: schema.domains.id, domain: schema.domains.domain })
    .from(schema.domains)
    .where(eq(schema.domains.userId, userId));

  if (domains.length === 0) return null;

  const lines: string[] = [
    'MxWatch — Weekly Domain Health Digest',
    '=' .repeat(40),
    '',
  ];

  let issueCount = 0;

  for (const d of domains) {
    const [dns] = await db
      .select()
      .from(schema.dnsSnapshots)
      .where(eq(schema.dnsSnapshots.domainId, d.id))
      .orderBy(desc(schema.dnsSnapshots.checkedAt))
      .limit(1);

    const [rbl] = await db
      .select()
      .from(schema.blacklistChecks)
      .where(eq(schema.blacklistChecks.domainId, d.id))
      .orderBy(desc(schema.blacklistChecks.checkedAt))
      .limit(1);

    const [smtp] = await db
      .select()
      .from(schema.smtpChecks)
      .where(eq(schema.smtpChecks.domainId, d.id))
      .orderBy(desc(schema.smtpChecks.checkedAt))
      .limit(1);

    const score = dns?.healthScore ?? '—';
    const spf = dns?.spfValid ? '✓' : '✗';
    const dkim = dns?.dkimValid ? '✓' : '✗';
    const dmarc = dns?.dmarcValid ? '✓' : `✗ (policy: ${dns?.dmarcPolicy ?? 'missing'})`;
    const rblStatus = rbl?.isListed ? `⚠ listed on ${rbl.listedOn ?? 'unknown'}` : '✓ clean';
    const smtpStatus = smtp?.connected === false ? '✗ unreachable' : smtp?.connected ? '✓ connected' : '—';

    if (rbl?.isListed || (typeof score === 'number' && score < 80)) issueCount++;

    lines.push(`${d.domain}`);
    lines.push(`  Score : ${score}`);
    lines.push(`  SPF   : ${spf}`);
    lines.push(`  DKIM  : ${dkim}`);
    lines.push(`  DMARC : ${dmarc}`);
    lines.push(`  RBL   : ${rblStatus}`);
    lines.push(`  SMTP  : ${smtpStatus}`);
    lines.push('');
  }

  lines.push('-'.repeat(40));
  lines.push(
    issueCount === 0
      ? `All ${domains.length} domain${domains.length !== 1 ? 's' : ''} healthy.`
      : `${issueCount} domain${issueCount !== 1 ? 's' : ''} need attention.`,
  );
  lines.push('');
  lines.push(`View dashboard: ${appUrl}`);
  lines.push(`Unsubscribe: ${appUrl}/settings/status`);

  return lines.join('\n');
}
