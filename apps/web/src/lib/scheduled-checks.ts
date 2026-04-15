import { getDb, schema } from '@mxwatch/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import { runDnsCheckForDomain } from './run-dns-check';
import { runBlacklistCheckForDomain } from './run-blacklist-check';
import { runSmtpCheckForDomain } from './run-smtp-check';
import { runCertCheckForDomain } from './run-cert-check';
import { runAllWatchedChecks } from './run-watched-check';
import { pullAllStalwart } from './run-stalwart-pull';
import { evaluateAlertsForDomain } from '@/server/alert-evaluator';

export { runAllWatchedChecks, pullAllStalwart };

export async function runAllDnsChecks(): Promise<void> {
  const db = getDb();
  const activeDomains = await db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.isActive, true));

  for (const d of activeDomains) {
    try {
      await runDnsCheckForDomain(d.id);
      await evaluateAlertsForDomain(d.id, 'dns');
    } catch (e) {
      console.error(`[scheduled-checks] dns ${d.domain} failed`, e);
    }
  }
}

export async function runAllBlacklistChecks(): Promise<void> {
  const db = getDb();
  const activeDomains = await db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.isActive, true));

  const { getSendingIps } = await import('./domain-topology');
  for (const d of activeDomains) {
    const ips = getSendingIps(d);
    if (ips.length === 0) continue;
    for (const ip of ips) {
      try {
        await runBlacklistCheckForDomain(d.id, ip);
      } catch (e) {
        console.error(`[scheduled-checks] blacklist ${d.domain} (${ip}) failed`, e);
      }
    }
    // Evaluate once per domain after all IPs are checked
    try { await evaluateAlertsForDomain(d.id, 'blacklist'); }
    catch (e) { console.error(`[scheduled-checks] blacklist alert eval ${d.domain} failed`, e); }
  }
}

export async function runAllSmtpChecks(): Promise<void> {
  const db = getDb();
  const active = await db.select().from(schema.domains).where(eq(schema.domains.isActive, true));
  for (const d of active) {
    try { await runSmtpCheckForDomain(d.id, 25); }
    catch (e) { console.error(`[scheduled-checks] smtp ${d.domain} failed`, e); }
  }
}

export async function runAllCertChecks(): Promise<void> {
  const db = getDb();
  const active = await db.select().from(schema.domains).where(eq(schema.domains.isActive, true));
  for (const d of active) {
    try { await runCertCheckForDomain(d.id); }
    catch (e) { console.error(`[scheduled-checks] cert ${d.domain} failed`, e); }
  }
}
