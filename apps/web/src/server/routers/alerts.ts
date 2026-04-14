import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { schema, nanoid } from '@mxwatch/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { encryptJSON, decryptJSON, sendAlert, type AlertChannelRecord } from '@mxwatch/alerts';
import type { Alert, ChannelConfig } from '@mxwatch/types';
import { ensureDefaultAlertRules } from '../alert-evaluator';

const ruleTypes = z.enum([
  'blacklist_listed',
  'dns_record_changed',
  'dmarc_fail_spike',
  'health_score_drop',
  'dmarc_report_received',
]);

async function assertOwned(ctx: any, domainId: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.domains)
    .where(and(eq(schema.domains.id, domainId), eq(schema.domains.userId, ctx.user.id)))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
}

export const alertsRouter = router({
  listRules: protectedProcedure
    .input(z.object({ domainId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertOwned(ctx, input.domainId);
      await ensureDefaultAlertRules(input.domainId);
      return ctx.db
        .select()
        .from(schema.alertRules)
        .where(eq(schema.alertRules.domainId, input.domainId));
    }),

  upsertRule: protectedProcedure
    .input(z.object({
      id: z.string().optional(),
      domainId: z.string(),
      type: ruleTypes,
      threshold: z.number().int().min(0).max(100).nullable(),
      isActive: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertOwned(ctx, input.domainId);
      const id = input.id ?? nanoid();
      if (input.id) {
        await ctx.db
          .update(schema.alertRules)
          .set({ type: input.type, threshold: input.threshold, isActive: input.isActive })
          .where(eq(schema.alertRules.id, input.id));
      } else {
        await ctx.db.insert(schema.alertRules).values({
          id,
          domainId: input.domainId,
          type: input.type,
          threshold: input.threshold,
          isActive: input.isActive,
        });
      }
      return { id };
    }),

  listChannels: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(schema.alertChannels)
      .where(eq(schema.alertChannels.userId, ctx.user.id));
    return rows.map(({ config: _omitted, ...rest }) => rest);
  }),

  removeChannel: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(schema.alertChannels)
        .where(and(eq(schema.alertChannels.id, input.id), eq(schema.alertChannels.userId, ctx.user.id)))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.db.delete(schema.alertChannels).where(eq(schema.alertChannels.id, input.id));
      return { ok: true };
    }),

  setChannelActive: protectedProcedure
    .input(z.object({ id: z.string(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(schema.alertChannels)
        .where(and(eq(schema.alertChannels.id, input.id), eq(schema.alertChannels.userId, ctx.user.id)))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.db
        .update(schema.alertChannels)
        .set({ isActive: input.isActive })
        .where(eq(schema.alertChannels.id, input.id));
      return { ok: true };
    }),

  addEmailChannel: protectedProcedure
    .input(z.object({ email: z.string().email(), label: z.string().max(100).optional() }))
    .mutation(async ({ ctx, input }) => {
      const id = nanoid();
      await ctx.db.insert(schema.alertChannels).values({
        id,
        userId: ctx.user.id,
        type: 'email',
        config: encryptJSON({ to: input.email }),
        isActive: true,
        label: input.label ?? input.email,
      });
      return { id };
    }),

  addSlackChannel: protectedProcedure
    .input(z.object({
      webhookUrl: z.string().url().refine((u) => u.startsWith('https://hooks.slack.com/'), 'Must be a Slack incoming webhook URL'),
      label: z.string().max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = nanoid();
      await ctx.db.insert(schema.alertChannels).values({
        id,
        userId: ctx.user.id,
        type: 'slack',
        config: encryptJSON({ webhookUrl: input.webhookUrl }),
        isActive: true,
        label: input.label ?? 'Slack',
      });
      return { id };
    }),

  addNtfyChannel: protectedProcedure
    .input(z.object({
      url: z.string().url(),
      topic: z.string().trim().min(1).max(64),
      token: z.string().max(200).optional(),
      label: z.string().max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = nanoid();
      await ctx.db.insert(schema.alertChannels).values({
        id,
        userId: ctx.user.id,
        type: 'ntfy',
        config: encryptJSON({
          url: input.url,
          topic: input.topic,
          ...(input.token ? { token: input.token } : {}),
        }),
        isActive: true,
        label: input.label ?? `ntfy/${input.topic}`,
      });
      return { id };
    }),

  addWebhookChannel: protectedProcedure
    .input(z.object({
      url: z.string().url(),
      secret: z.string().max(200).optional(),
      label: z.string().max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = nanoid();
      await ctx.db.insert(schema.alertChannels).values({
        id,
        userId: ctx.user.id,
        type: 'webhook',
        config: encryptJSON({
          url: input.url,
          ...(input.secret ? { secret: input.secret } : {}),
        }),
        isActive: true,
        label: input.label ?? 'Webhook',
      });
      return { id };
    }),

  sendTest: protectedProcedure
    .input(z.object({ channelId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(schema.alertChannels)
        .where(and(eq(schema.alertChannels.id, input.channelId), eq(schema.alertChannels.userId, ctx.user.id)))
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      const channel: AlertChannelRecord = {
        id: row.id,
        type: row.type,
        config: decryptJSON<ChannelConfig>(row.config),
      };
      const alert: Alert = {
        id: nanoid(),
        domainId: 'test',
        domainName: 'mxwatch-test',
        type: 'dmarc_report_received',
        severity: 'low',
        message: 'This is a test alert from MxWatch. If you can read this, the channel works.',
        firedAt: new Date(),
      };
      try {
        await sendAlert(channel, alert);
        return { ok: true };
      } catch (e: any) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: e?.message ?? 'Dispatch failed' });
      }
    }),

  history: protectedProcedure
    .input(z.object({ domainId: z.string().optional(), onlyActive: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      if (input.domainId) await assertOwned(ctx, input.domainId);
      const conditions = [eq(schema.domains.userId, ctx.user.id)];
      if (input.domainId) conditions.push(eq(schema.alertHistory.domainId, input.domainId));
      if (input.onlyActive) conditions.push(isNull(schema.alertHistory.resolvedAt));

      const rows = await ctx.db
        .select({
          id: schema.alertHistory.id,
          domainId: schema.alertHistory.domainId,
          domainName: schema.domains.domain,
          ruleId: schema.alertHistory.ruleId,
          firedAt: schema.alertHistory.firedAt,
          type: schema.alertHistory.type,
          message: schema.alertHistory.message,
          resolvedAt: schema.alertHistory.resolvedAt,
        })
        .from(schema.alertHistory)
        .innerJoin(schema.domains, eq(schema.alertHistory.domainId, schema.domains.id))
        .where(and(...conditions))
        .orderBy(desc(schema.alertHistory.firedAt))
        .limit(100);
      return rows;
    }),

  resolve: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ h: schema.alertHistory, userId: schema.domains.userId })
        .from(schema.alertHistory)
        .innerJoin(schema.domains, eq(schema.alertHistory.domainId, schema.domains.id))
        .where(eq(schema.alertHistory.id, input.id))
        .limit(1);
      if (!row || row.userId !== ctx.user.id) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.db
        .update(schema.alertHistory)
        .set({ resolvedAt: new Date() })
        .where(eq(schema.alertHistory.id, input.id));
      return { ok: true };
    }),
});
