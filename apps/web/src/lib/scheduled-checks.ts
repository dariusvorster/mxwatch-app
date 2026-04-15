import { getDb, schema, logger } from '@mxwatch/db';
import { eq } from 'drizzle-orm';
import { runDnsCheckForDomain } from './run-dns-check';
import { runBlacklistCheckForDomain } from './run-blacklist-check';
import { runSmtpCheckForDomain } from './run-smtp-check';
import { runCertCheckForDomain } from './run-cert-check';
import { runAllWatchedChecks } from './run-watched-check';
import { pullAllStalwart } from './run-stalwart-pull';
import { evaluateAlertsForDomain } from '@/server/alert-evaluator';

export { runAllWatchedChecks, pullAllStalwart };

// Each aggregate job logs a single job_runs row with items_* counters
// rolled across the per-domain work. Per-domain failures are logged at
// warn/error inside the loop but don't fail the whole job.

export async function runAllDnsChecks(): Promise<void> {
  const run = await logger.job('dns-health-check');
  let succeeded = 0, failed = 0;
  try {
    const activeDomains = await getDb()
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.isActive, true));
    for (const d of activeDomains) {
      try {
        await runDnsCheckForDomain(d.id);
        await evaluateAlertsForDomain(d.id, 'dns');
        succeeded += 1;
        void logger.debug('dns', 'DNS check complete', { domain: d.domain });
      } catch (e) {
        failed += 1;
        void logger.error('dns', 'DNS check failed', e, { domain: d.domain });
      }
    }
    await run.success({ itemsProcessed: activeDomains.length, itemsSucceeded: succeeded, itemsFailed: failed });
  } catch (e) {
    await run.fail(e);
    throw e;
  }
}

export async function runAllBlacklistChecks(): Promise<void> {
  const run = await logger.job('blacklist-check');
  let succeeded = 0, failed = 0, processed = 0;
  try {
    const activeDomains = await getDb()
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.isActive, true));
    const { getSendingIps } = await import('./domain-topology');
    for (const d of activeDomains) {
      const ips = getSendingIps(d);
      if (ips.length === 0) continue;
      for (const ip of ips) {
        processed += 1;
        try {
          await runBlacklistCheckForDomain(d.id, ip);
          succeeded += 1;
          void logger.debug('rbl', 'RBL sweep complete', { domain: d.domain, ip });
        } catch (e) {
          failed += 1;
          const msg = (e as any)?.message ?? '';
          const errorType = msg.includes('ETIMEDOUT') ? 'timeout'
            : msg.includes('ENOTFOUND') ? 'nxdomain'
            : 'network_error';
          void logger.warn('rbl', `RBL check failed for ${d.domain} (${ip})`, { domain: d.domain, ip, errorType, error: msg });
        }
      }
      try { await evaluateAlertsForDomain(d.id, 'blacklist'); }
      catch (e) { void logger.error('rbl', 'Alert evaluation failed', e, { domain: d.domain }); }
    }
    await run.success({ itemsProcessed: processed, itemsSucceeded: succeeded, itemsFailed: failed });
  } catch (e) {
    await run.fail(e);
    throw e;
  }
}

export async function runAllSmtpChecks(): Promise<void> {
  const run = await logger.job('smtp-check');
  let succeeded = 0, failed = 0;
  try {
    const active = await getDb().select().from(schema.domains).where(eq(schema.domains.isActive, true));
    for (const d of active) {
      try {
        await runSmtpCheckForDomain(d.id, 25);
        succeeded += 1;
      } catch (e) {
        failed += 1;
        void logger.error('smtp', 'SMTP check failed', e, { domain: d.domain });
      }
    }
    await run.success({ itemsProcessed: active.length, itemsSucceeded: succeeded, itemsFailed: failed });
  } catch (e) {
    await run.fail(e);
    throw e;
  }
}

export async function runAllCertChecks(): Promise<void> {
  const run = await logger.job('cert-check');
  let succeeded = 0, failed = 0;
  try {
    const active = await getDb().select().from(schema.domains).where(eq(schema.domains.isActive, true));
    for (const d of active) {
      try {
        await runCertCheckForDomain(d.id);
        succeeded += 1;
      } catch (e) {
        failed += 1;
        void logger.error('cert', 'Cert check failed', e, { domain: d.domain });
      }
    }
    await run.success({ itemsProcessed: active.length, itemsSucceeded: succeeded, itemsFailed: failed });
  } catch (e) {
    await run.fail(e);
    throw e;
  }
}
