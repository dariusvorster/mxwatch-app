import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { schema } from '@mxwatch/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

export type ActivityEventType =
  | 'alert_fired'
  | 'alert_resolved'
  | 'rbl_check'
  | 'dns_snapshot'
  | 'dmarc_report';

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  domainId: string;
  domainName: string;
  timestamp: Date;
  title: string;
  subtitle?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'info';
  ref?: string;
}

async function assertOwned(ctx: any, domainId: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.domains)
    .where(and(eq(schema.domains.id, domainId), eq(schema.domains.userId, ctx.user.id)))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
}

export const activityRouter = router({
  feed: protectedProcedure
    .input(z.object({
      domainId: z.string().optional(),
      limit: z.number().min(1).max(500).default(100),
      types: z.array(z.enum(['alert_fired', 'alert_resolved', 'rbl_check', 'dns_snapshot', 'dmarc_report'])).optional(),
    }))
    .query(async ({ ctx, input }): Promise<ActivityEvent[]> => {
      if (input.domainId) await assertOwned(ctx, input.domainId);

      // Resolve the set of domain IDs we'll query against.
      let domainRows: Array<{ id: string; domain: string }>;
      if (input.domainId) {
        const [row] = await ctx.db
          .select({ id: schema.domains.id, domain: schema.domains.domain })
          .from(schema.domains)
          .where(eq(schema.domains.id, input.domainId))
          .limit(1);
        domainRows = row ? [row] : [];
      } else {
        domainRows = await ctx.db
          .select({ id: schema.domains.id, domain: schema.domains.domain })
          .from(schema.domains)
          .where(eq(schema.domains.userId, ctx.user.id));
      }
      if (domainRows.length === 0) return [];
      const domainIds = domainRows.map((d) => d.id);
      const nameById = new Map(domainRows.map((d) => [d.id, d.domain]));

      const wantType = (t: ActivityEventType) => !input.types || input.types.includes(t);

      const events: ActivityEvent[] = [];

      // Alerts (fired + resolved)
      if (wantType('alert_fired') || wantType('alert_resolved')) {
        const rows = await ctx.db
          .select()
          .from(schema.alertHistory)
          .where(inArray(schema.alertHistory.domainId, domainIds))
          .orderBy(desc(schema.alertHistory.firedAt))
          .limit(input.limit);
        for (const r of rows) {
          if (wantType('alert_fired')) {
            events.push({
              id: `${r.id}:fired`,
              type: 'alert_fired',
              domainId: r.domainId,
              domainName: nameById.get(r.domainId) ?? '—',
              timestamp: r.firedAt,
              title: `Alert fired: ${humanizeAlertType(r.type)}`,
              subtitle: r.message,
              severity: severityForAlertType(r.type),
              ref: r.id,
            });
          }
          if (r.resolvedAt && wantType('alert_resolved')) {
            events.push({
              id: `${r.id}:resolved`,
              type: 'alert_resolved',
              domainId: r.domainId,
              domainName: nameById.get(r.domainId) ?? '—',
              timestamp: r.resolvedAt,
              title: `Alert resolved: ${humanizeAlertType(r.type)}`,
              severity: 'info',
              ref: r.id,
            });
          }
        }
      }

      // RBL checks
      if (wantType('rbl_check')) {
        const rows = await ctx.db
          .select()
          .from(schema.blacklistChecks)
          .where(inArray(schema.blacklistChecks.domainId, domainIds))
          .orderBy(desc(schema.blacklistChecks.checkedAt))
          .limit(input.limit);
        for (const r of rows) {
          const listed = r.listedOn ? (JSON.parse(r.listedOn) as string[]) : [];
          events.push({
            id: r.id,
            type: 'rbl_check',
            domainId: r.domainId,
            domainName: nameById.get(r.domainId) ?? '—',
            timestamp: r.checkedAt,
            title: r.isListed
              ? `Listed on ${listed.length} RBL${listed.length === 1 ? '' : 's'}`
              : 'RBL check clean',
            subtitle: r.isListed ? `${r.ipAddress ?? 'IP'} · ${listed.join(', ')}` : r.ipAddress ?? undefined,
            severity: r.isListed ? 'critical' : 'info',
            ref: r.id,
          });
        }
      }

      // DNS snapshots
      if (wantType('dns_snapshot')) {
        const rows = await ctx.db
          .select()
          .from(schema.dnsSnapshots)
          .where(inArray(schema.dnsSnapshots.domainId, domainIds))
          .orderBy(desc(schema.dnsSnapshots.checkedAt))
          .limit(input.limit);
        for (const r of rows) {
          events.push({
            id: r.id,
            type: 'dns_snapshot',
            domainId: r.domainId,
            domainName: nameById.get(r.domainId) ?? '—',
            timestamp: r.checkedAt,
            title: `DNS check — score ${r.healthScore ?? '—'}/100`,
            subtitle: `SPF ${r.spfValid ? '✓' : '✗'} · DKIM ${r.dkimValid ? '✓' : '✗'} · DMARC ${r.dmarcValid ? '✓' : '✗'}`,
            severity: (r.healthScore ?? 100) < 60 ? 'high' : 'info',
            ref: r.id,
          });
        }
      }

      // DMARC reports
      if (wantType('dmarc_report')) {
        const rows = await ctx.db
          .select()
          .from(schema.dmarcReports)
          .where(inArray(schema.dmarcReports.domainId, domainIds))
          .orderBy(desc(schema.dmarcReports.receivedAt))
          .limit(input.limit);
        for (const r of rows) {
          events.push({
            id: r.id,
            type: 'dmarc_report',
            domainId: r.domainId,
            domainName: nameById.get(r.domainId) ?? '—',
            timestamp: r.receivedAt,
            title: `DMARC report from ${r.orgName}`,
            subtitle: `${r.totalMessages ?? 0} messages · ${r.passCount ?? 0} pass / ${r.failCount ?? 0} fail`,
            severity: (r.failCount ?? 0) > 0 ? 'medium' : 'info',
            ref: r.id,
          });
        }
      }

      events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      return events.slice(0, input.limit);
    }),

  blacklistOverview: protectedProcedure.query(async ({ ctx }) => {
    const domains = await ctx.db
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.userId, ctx.user.id))
      .orderBy(desc(schema.domains.addedAt));
    if (domains.length === 0) return [];

    const ids = domains.map((d) => d.id);
    // Pull the latest blacklist check per domain via window function.
    const latestRows = await ctx.db
      .select({
        id: schema.blacklistChecks.id,
        domainId: schema.blacklistChecks.domainId,
        checkedAt: schema.blacklistChecks.checkedAt,
        ipAddress: schema.blacklistChecks.ipAddress,
        isListed: schema.blacklistChecks.isListed,
        listedOn: schema.blacklistChecks.listedOn,
        rn: sql<number>`row_number() over (partition by ${schema.blacklistChecks.domainId} order by ${schema.blacklistChecks.checkedAt} desc)`,
      })
      .from(schema.blacklistChecks)
      .where(inArray(schema.blacklistChecks.domainId, ids));

    const latestByDomain = new Map<string, { checkedAt: Date; ipAddress: string | null; isListed: boolean | null; listedOn: string | null }>();
    for (const r of latestRows) {
      if (Number(r.rn) !== 1) continue;
      latestByDomain.set(r.domainId, { checkedAt: r.checkedAt, ipAddress: r.ipAddress, isListed: r.isListed, listedOn: r.listedOn });
    }

    return domains.map((d) => {
      const latest = latestByDomain.get(d.id);
      const listed = latest?.listedOn ? (JSON.parse(latest.listedOn) as string[]) : [];
      return {
        id: d.id,
        domain: d.domain,
        sendingIp: d.sendingIp ?? null,
        lastCheckedAt: latest?.checkedAt ?? null,
        checkedIp: latest?.ipAddress ?? null,
        isListed: !!latest?.isListed,
        listedOn: listed,
      };
    });
  }),

  reportOverview: protectedProcedure
    .input(z.object({ days: z.number().min(1).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      const domains = await ctx.db
        .select()
        .from(schema.domains)
        .where(eq(schema.domains.userId, ctx.user.id))
        .orderBy(desc(schema.domains.addedAt));
      if (domains.length === 0) return { windowDays: input.days, rows: [] };

      const ids = domains.map((d) => d.id);
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const agg = await ctx.db
        .select({
          domainId: schema.dmarcReports.domainId,
          reports: sql<number>`count(*)`,
          totalMessages: sql<number>`sum(coalesce(${schema.dmarcReports.totalMessages}, 0))`,
          passCount: sql<number>`sum(coalesce(${schema.dmarcReports.passCount}, 0))`,
          failCount: sql<number>`sum(coalesce(${schema.dmarcReports.failCount}, 0))`,
        })
        .from(schema.dmarcReports)
        .where(and(
          inArray(schema.dmarcReports.domainId, ids),
          sql`${schema.dmarcReports.receivedAt} >= ${Math.floor(since.getTime() / 1000)}`,
        ))
        .groupBy(schema.dmarcReports.domainId);
      const byId = new Map(agg.map((a) => [a.domainId, a]));

      const rows = domains.map((d) => {
        const a = byId.get(d.id);
        const reports = Number(a?.reports ?? 0);
        const totalMessages = Number(a?.totalMessages ?? 0);
        const passCount = Number(a?.passCount ?? 0);
        const failCount = Number(a?.failCount ?? 0);
        return {
          id: d.id,
          domain: d.domain,
          reports,
          totalMessages,
          passCount,
          failCount,
          passRate: totalMessages > 0 ? passCount / totalMessages : null,
        };
      });
      return { windowDays: input.days, rows };
    }),
});

function humanizeAlertType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function severityForAlertType(t: string): ActivityEvent['severity'] {
  if (t === 'blacklist_listed') return 'critical';
  if (t === 'health_score_drop' || t === 'dmarc_fail_spike') return 'high';
  if (t === 'dns_record_changed') return 'medium';
  return 'info';
}
