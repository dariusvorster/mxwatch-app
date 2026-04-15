export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Run idempotent DB migrations before anything else touches the DB.
  // Adds V3.6+ columns (users.onboarding_step) and V4 tables.
  const { applyPendingMigrations } = await import('@mxwatch/db');
  try {
    applyPendingMigrations(process.env.DATABASE_URL ?? './data/mxwatch.db');
  } catch (e) {
    console.error('[instrumentation] migration failed', e);
  }

  const { startSmtpListener } = await import('@mxwatch/monitor/smtp-listener');
  const { scheduleJob } = await import('@mxwatch/monitor/scheduler');
  const { routeInboundMail } = await import('./lib/inbound-mail-router');
  const { runAllDnsChecks, runAllBlacklistChecks, runAllSmtpChecks, runAllCertChecks, runAllWatchedChecks, pullAllStalwart } = await import('./lib/scheduled-checks');

  // SMTP listener — routes DMARC XML and deliverability-test mail
  const smtpPort = Number(process.env.SMTP_PORT ?? 2525);
  if (process.env.MXWATCH_DISABLE_SMTP !== '1') {
    try {
      startSmtpListener(smtpPort, routeInboundMail);
    } catch (e) {
      console.error('[instrumentation] failed to start SMTP listener', e);
    }
  }

  // Hourly DNS health checks for all active domains
  const { HOUR } = await import('@mxwatch/monitor/scheduler');
  scheduleJob({
    name: 'dns-health-check',
    intervalMs: HOUR,
    task: runAllDnsChecks,
  });

  // Every 6 hours: blacklist sweep for domains with a configured sending IP
  scheduleJob({
    name: 'blacklist-check',
    intervalMs: 6 * HOUR,
    task: runAllBlacklistChecks,
  });

  // Every 2 hours: SMTP health check against each domain's primary MX
  scheduleJob({
    name: 'smtp-check',
    intervalMs: 2 * HOUR,
    task: runAllSmtpChecks,
  });

  // Every 2 hours: watched external domains sweep (DMARC + MX + RBL)
  scheduleJob({
    name: 'watched-check',
    intervalMs: 2 * HOUR,
    task: runAllWatchedChecks,
  });

  // Every 60 seconds: Stalwart management-API pull for any active integrations
  scheduleJob({
    name: 'stalwart-pull',
    intervalMs: 60 * 1000,
    task: pullAllStalwart,
  });

  // V4 server intelligence — per-integration pulls backed by the adapter
  // registry. Unsupported capabilities (e.g. Postfix without agent) are
  // swallowed inside each runner so a single stub doesn't kill the loop.
  const { MINUTE } = await import('@mxwatch/monitor/scheduler');
  const {
    pullAllServerStats, pullAllQueueSnapshots, pullAllAuthFailures, aggregateAllRecipientDomainStats,
  } = await import('./lib/run-server-integrations');
  scheduleJob({ name: 'server-stats-pull', intervalMs: MINUTE, task: pullAllServerStats });
  scheduleJob({ name: 'queue-snapshot', intervalMs: 5 * MINUTE, task: pullAllQueueSnapshots });
  scheduleJob({ name: 'auth-failure-pull', intervalMs: 5 * MINUTE, task: pullAllAuthFailures });
  scheduleJob({ name: 'recipient-domain-aggregate', intervalMs: HOUR, task: aggregateAllRecipientDomainStats });

  // Daily at 03:00 UTC: TLS certificate check for mail/web/mx hostnames
  const { scheduleDailyUtc: scheduleDailyCert } = await import('@mxwatch/monitor/scheduler');
  scheduleDailyCert('cert-check', 3, runAllCertChecks);

  // Daily at 04:00 UTC: Google Postmaster Tools sync (skipped when integration not configured)
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    const { scheduleDailyUtc } = await import('@mxwatch/monitor/scheduler');
    const { syncAllPostmaster } = await import('./lib/sync-postmaster');
    scheduleDailyUtc('postmaster-sync', 4, syncAllPostmaster);
  }
}
