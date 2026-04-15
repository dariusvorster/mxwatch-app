import { getDb, schema, nanoid } from '@mxwatch/db';
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import type { Alert, AlertType, AlertRuleType, Severity, ChannelConfig } from '@mxwatch/types';
import { sendAlert, decryptJSON, type AlertChannelRecord } from '@mxwatch/alerts';

export type Trigger = 'dns' | 'blacklist' | 'dmarc';

const DEFAULT_RULE_TYPES: AlertRuleType[] = [
  'blacklist_listed',
  'dns_record_changed',
  'health_score_drop',
  'dmarc_report_received',
  'dmarc_fail_spike',
];

function defaultThreshold(type: AlertType): number | null {
  if (type === 'health_score_drop') return 20;
  if (type === 'dmarc_fail_spike') return 10; // percent
  return null;
}

export async function insertDefaultAlertRules(domainId: string): Promise<void> {
  const db = getDb();
  const rows = DEFAULT_RULE_TYPES.map((type) => ({
    id: nanoid(),
    domainId,
    type,
    threshold: defaultThreshold(type),
    isActive: true,
  }));
  await db.insert(schema.alertRules).values(rows);
}

/**
 * Ensure every default rule type exists for a domain. Used to backfill
 * rule types added after the domain was created (e.g. dmarc_fail_spike in V2).
 * Idempotent — only inserts missing types.
 */
export async function ensureDefaultAlertRules(domainId: string): Promise<void> {
  const db = getDb();
  const existing = await db
    .select({ type: schema.alertRules.type })
    .from(schema.alertRules)
    .where(eq(schema.alertRules.domainId, domainId));
  const present = new Set(existing.map((r) => r.type));
  const missing = DEFAULT_RULE_TYPES.filter((t) => !present.has(t));
  if (missing.length === 0) return;
  await db.insert(schema.alertRules).values(missing.map((type) => ({
    id: nanoid(),
    domainId,
    type,
    threshold: defaultThreshold(type),
    isActive: true,
  })));
}

function severityFor(type: AlertType): Severity {
  switch (type) {
    case 'blacklist_listed':
      return 'critical';
    case 'dmarc_fail_spike':
      return 'high';
    case 'health_score_drop':
      return 'high';
    case 'dns_record_changed':
      return 'medium';
    case 'dmarc_report_received':
      return 'low';
    default:
      return 'medium';
  }
}

async function loadActiveRules(domainId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.alertRules)
    .where(and(eq(schema.alertRules.domainId, domainId), eq(schema.alertRules.isActive, true)));
}

async function loadUserChannels(userId: string): Promise<AlertChannelRecord[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.alertChannels)
    .where(and(eq(schema.alertChannels.userId, userId), eq(schema.alertChannels.isActive, true)));
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    config: decryptJSON<ChannelConfig>(r.config),
  }));
}

async function findActiveAlert(domainId: string, type: AlertType) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.alertHistory)
    .where(and(
      eq(schema.alertHistory.domainId, domainId),
      eq(schema.alertHistory.type, type),
      isNull(schema.alertHistory.resolvedAt),
    ))
    .limit(1);
  return row ?? null;
}

async function fireAlert(params: {
  domainId: string;
  domainName: string;
  userId: string;
  ruleId: string;
  type: AlertType;
  message: string;
}): Promise<void> {
  const db = getDb();
  const severity = severityFor(params.type);
  const firedAt = new Date();
  const alertId = nanoid();

  const channels = await loadUserChannels(params.userId);
  const alert: Alert = {
    id: alertId,
    domainId: params.domainId,
    domainName: params.domainName,
    type: params.type,
    severity,
    message: params.message,
    firedAt,
  };

  const sent: string[] = [];
  for (const ch of channels) {
    try {
      await sendAlert(ch, alert);
      sent.push(ch.id);
    } catch (e) {
      console.error(`[alert-evaluator] channel ${ch.id} dispatch failed`, e);
    }
  }

  await db.insert(schema.alertHistory).values({
    id: alertId,
    domainId: params.domainId,
    ruleId: params.ruleId,
    firedAt,
    type: params.type,
    message: params.message,
    resolvedAt: null,
    channelsSent: JSON.stringify(sent),
  });
}

async function resolveActive(alertHistoryId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.alertHistory)
    .set({ resolvedAt: new Date() })
    .where(eq(schema.alertHistory.id, alertHistoryId));
}

export async function evaluateAlertsForDomain(domainId: string, trigger: Trigger): Promise<void> {
  const db = getDb();
  const [domain] = await db.select().from(schema.domains).where(eq(schema.domains.id, domainId)).limit(1);
  if (!domain) return;

  const rules = await loadActiveRules(domainId);
  if (rules.length === 0) return;

  if (trigger === 'dns') {
    const snapshots = await db
      .select()
      .from(schema.dnsSnapshots)
      .where(eq(schema.dnsSnapshots.domainId, domainId))
      .orderBy(desc(schema.dnsSnapshots.checkedAt))
      .limit(2);
    const latest = snapshots[0];
    const prev = snapshots[1];
    if (!latest) return;

    for (const rule of rules) {
      if (rule.type === 'dns_record_changed' && prev) {
        const diffs: string[] = [];
        if ((latest.spfRecord ?? '') !== (prev.spfRecord ?? '')) diffs.push('SPF');
        if ((latest.dkimRecord ?? '') !== (prev.dkimRecord ?? '')) diffs.push('DKIM');
        if ((latest.dmarcRecord ?? '') !== (prev.dmarcRecord ?? '')) diffs.push('DMARC');
        if (diffs.length > 0) {
          await fireAlert({
            domainId,
            domainName: domain.domain,
            userId: domain.userId,
            ruleId: rule.id,
            type: 'dns_record_changed',
            message: `${diffs.join(', ')} record${diffs.length > 1 ? 's' : ''} changed on ${domain.domain}.`,
          });
        }
      }

      if (rule.type === 'health_score_drop' && prev) {
        const threshold = rule.threshold ?? 20;
        const newScore = latest.healthScore ?? 100;
        const oldScore = prev.healthScore ?? 100;
        if (oldScore - newScore >= threshold) {
          await fireAlert({
            domainId,
            domainName: domain.domain,
            userId: domain.userId,
            ruleId: rule.id,
            type: 'health_score_drop',
            message: `Health score dropped from ${oldScore} to ${newScore} (≥${threshold} point drop).`,
          });
        }
      }
    }
  }

  if (trigger === 'blacklist') {
    const [latest] = await db
      .select()
      .from(schema.blacklistChecks)
      .where(eq(schema.blacklistChecks.domainId, domainId))
      .orderBy(desc(schema.blacklistChecks.checkedAt))
      .limit(1);
    if (!latest) return;

    const rule = rules.find((r) => r.type === 'blacklist_listed');
    if (!rule) return;

    const active = await findActiveAlert(domainId, 'blacklist_listed');
    if (latest.isListed) {
      const listedOn = JSON.parse(latest.listedOn ?? '[]') as string[];
      if (!active) {
        await fireAlert({
          domainId,
          domainName: domain.domain,
          userId: domain.userId,
          ruleId: rule.id,
          type: 'blacklist_listed',
          message: `${latest.ipAddress} is listed on: ${listedOn.join(', ')}`,
        });
      }
    } else if (active) {
      await resolveActive(active.id);
    }
  }

  if (trigger === 'dmarc') {
    const receivedRule = rules.find((r) => r.type === 'dmarc_report_received');
    const [latest] = await db
      .select()
      .from(schema.dmarcReports)
      .where(eq(schema.dmarcReports.domainId, domainId))
      .orderBy(desc(schema.dmarcReports.receivedAt))
      .limit(1);

    if (receivedRule && latest) {
      await fireAlert({
        domainId,
        domainName: domain.domain,
        userId: domain.userId,
        ruleId: receivedRule.id,
        type: 'dmarc_report_received',
        message: `New DMARC report from ${latest.orgName}: ${latest.totalMessages} messages (${latest.passCount} pass / ${latest.failCount} fail).`,
      });
    }

    const spikeRule = rules.find((r) => r.type === 'dmarc_fail_spike');
    if (spikeRule) {
      const thresholdPct = spikeRule.threshold ?? 10;
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const windowReports = await db
        .select()
        .from(schema.dmarcReports)
        .where(and(
          eq(schema.dmarcReports.domainId, domainId),
          gte(schema.dmarcReports.receivedAt, since),
        ));
      const totalPass = windowReports.reduce((s, r) => s + (r.passCount ?? 0), 0);
      const totalFail = windowReports.reduce((s, r) => s + (r.failCount ?? 0), 0);
      const total = totalPass + totalFail;
      const failPct = total > 0 ? (totalFail / total) * 100 : 0;
      const active = await findActiveAlert(domainId, 'dmarc_fail_spike');
      if (total > 0 && failPct >= thresholdPct) {
        if (!active) {
          await fireAlert({
            domainId,
            domainName: domain.domain,
            userId: domain.userId,
            ruleId: spikeRule.id,
            type: 'dmarc_fail_spike',
            message: `DMARC fail rate is ${failPct.toFixed(1)}% (${totalFail}/${total} messages, last 24h). Threshold: ${thresholdPct}%.`,
          });
        }
      } else if (active) {
        await resolveActive(active.id);
      }
    }
  }
}
