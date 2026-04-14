import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { schema } from '@mxwatch/db';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { ipCoveredBySpf } from '@/lib/spf-ips';

async function assertOwned(ctx: any, domainId: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.domains)
    .where(and(eq(schema.domains.id, domainId), eq(schema.domains.userId, ctx.user.id)))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
}

export const reportsRouter = router({
  list: protectedProcedure
    .input(z.object({ domainId: z.string(), limit: z.number().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      await assertOwned(ctx, input.domainId);
      return ctx.db
        .select()
        .from(schema.dmarcReports)
        .where(eq(schema.dmarcReports.domainId, input.domainId))
        .orderBy(desc(schema.dmarcReports.receivedAt))
        .limit(input.limit);
    }),

  detail: protectedProcedure
    .input(z.object({ reportId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [report] = await ctx.db
        .select()
        .from(schema.dmarcReports)
        .where(eq(schema.dmarcReports.id, input.reportId))
        .limit(1);
      if (!report) throw new TRPCError({ code: 'NOT_FOUND' });
      await assertOwned(ctx, report.domainId);
      const rows = await ctx.db
        .select()
        .from(schema.dmarcReportRows)
        .where(eq(schema.dmarcReportRows.reportId, report.id));
      return { report, rows };
    }),

  unexpectedSenders: protectedProcedure
    .input(z.object({ domainId: z.string(), days: z.number().min(1).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      await assertOwned(ctx, input.domainId);
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);

      // Recent reports in window
      const reports = await ctx.db
        .select({ id: schema.dmarcReports.id })
        .from(schema.dmarcReports)
        .where(and(
          eq(schema.dmarcReports.domainId, input.domainId),
          gte(schema.dmarcReports.receivedAt, since),
        ));
      const reportIds = reports.map((r) => r.id);

      // Most recent DNS snapshot to pull the current SPF record
      const [snap] = await ctx.db
        .select({ spfRecord: schema.dnsSnapshots.spfRecord })
        .from(schema.dnsSnapshots)
        .where(eq(schema.dnsSnapshots.domainId, input.domainId))
        .orderBy(desc(schema.dnsSnapshots.checkedAt))
        .limit(1);
      const spfRecord = snap?.spfRecord ?? null;

      if (reportIds.length === 0) {
        return { windowDays: input.days, spfRecord, rows: [] };
      }

      const rows = await ctx.db
        .select()
        .from(schema.dmarcReportRows)
        .where(inArray(schema.dmarcReportRows.reportId, reportIds));

      const agg = new Map<string, {
        sourceIp: string;
        volume: number;
        spfPass: number;
        spfFail: number;
        dkimPass: number;
        dkimFail: number;
        quarantine: number;
        reject: number;
      }>();

      for (const r of rows) {
        const a = agg.get(r.sourceIp) ?? {
          sourceIp: r.sourceIp, volume: 0,
          spfPass: 0, spfFail: 0, dkimPass: 0, dkimFail: 0,
          quarantine: 0, reject: 0,
        };
        a.volume += r.count;
        if (r.spfResult === 'pass') a.spfPass += r.count; else a.spfFail += r.count;
        if (r.dkimResult === 'pass') a.dkimPass += r.count; else a.dkimFail += r.count;
        if (r.disposition === 'quarantine') a.quarantine += r.count;
        if (r.disposition === 'reject') a.reject += r.count;
        agg.set(r.sourceIp, a);
      }

      const unexpected = Array.from(agg.values())
        .filter((a) => !ipCoveredBySpf(a.sourceIp, spfRecord))
        .sort((a, b) => b.volume - a.volume);

      return { windowDays: input.days, spfRecord, rows: unexpected };
    }),

  summary: protectedProcedure
    .input(z.object({ domainId: z.string(), days: z.number().min(1).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      await assertOwned(ctx, input.domainId);
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);

      const reports = await ctx.db
        .select()
        .from(schema.dmarcReports)
        .where(and(
          eq(schema.dmarcReports.domainId, input.domainId),
          gte(schema.dmarcReports.receivedAt, since),
        ))
        .orderBy(desc(schema.dmarcReports.receivedAt));

      // Daily timeline — bucket pass/fail counts by report date_range_begin.
      const bucket = new Map<string, { date: string; pass: number; fail: number }>();
      for (const r of reports) {
        const d = r.dateRangeBegin ?? r.receivedAt;
        const key = new Date(d).toISOString().slice(0, 10);
        const b = bucket.get(key) ?? { date: key, pass: 0, fail: 0 };
        b.pass += r.passCount ?? 0;
        b.fail += r.failCount ?? 0;
        bucket.set(key, b);
      }
      const timeline = Array.from(bucket.values()).sort((a, b) => a.date.localeCompare(b.date));

      // Source IP breakdown — aggregate across all rows of these reports.
      const ipAgg = new Map<string, {
        sourceIp: string;
        total: number;
        spfPass: number;
        dkimPass: number;
        quarantine: number;
        reject: number;
      }>();
      if (reports.length > 0) {
        const reportIds = reports.map((r) => r.id);
        const rows = await ctx.db
          .select()
          .from(schema.dmarcReportRows)
          .where(inArray(schema.dmarcReportRows.reportId, reportIds));
        for (const row of rows) {
          const agg = ipAgg.get(row.sourceIp) ?? {
            sourceIp: row.sourceIp,
            total: 0,
            spfPass: 0,
            dkimPass: 0,
            quarantine: 0,
            reject: 0,
          };
          agg.total += row.count;
          if (row.spfResult === 'pass') agg.spfPass += row.count;
          if (row.dkimResult === 'pass') agg.dkimPass += row.count;
          if (row.disposition === 'quarantine') agg.quarantine += row.count;
          if (row.disposition === 'reject') agg.reject += row.count;
          ipAgg.set(row.sourceIp, agg);
        }
      }
      // Correlate each source IP with locally-ingested mail-log events in the same window.
      const eventCounts = await ctx.db
        .select({
          remoteIp: schema.mailEvents.remoteIp,
          outbound: sql<number>`sum(case when ${schema.mailEvents.direction} = 'outbound' then 1 else 0 end)`,
          total: sql<number>`count(*)`,
        })
        .from(schema.mailEvents)
        .where(and(
          eq(schema.mailEvents.domainId, input.domainId),
          gte(schema.mailEvents.receivedAt, since),
        ))
        .groupBy(schema.mailEvents.remoteIp);
      const countByIp = new Map<string, { outbound: number; total: number }>();
      for (const row of eventCounts) {
        if (!row.remoteIp) continue;
        countByIp.set(row.remoteIp, {
          outbound: Number(row.outbound ?? 0),
          total: Number(row.total ?? 0),
        });
      }

      const sourceIps = Array.from(ipAgg.values())
        .map((ip) => {
          const ec = countByIp.get(ip.sourceIp);
          return {
            ...ip,
            localEvents: ec?.total ?? 0,
            localOutbound: ec?.outbound ?? 0,
            recognised: (ec?.outbound ?? 0) > 0,
          };
        })
        .sort((a, b) => b.total - a.total);

      const totalPass = reports.reduce((s, r) => s + (r.passCount ?? 0), 0);
      const totalFail = reports.reduce((s, r) => s + (r.failCount ?? 0), 0);
      const totalMessages = totalPass + totalFail;

      return {
        totalReports: reports.length,
        totalMessages,
        totalPass,
        totalFail,
        passRate: totalMessages > 0 ? totalPass / totalMessages : null,
        timeline,
        sourceIps,
      };
    }),
});
