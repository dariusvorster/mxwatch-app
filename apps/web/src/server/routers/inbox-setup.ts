import { z } from 'zod';
import dns from 'node:dns';
import { randomBytes } from 'node:crypto';
import { router, protectedProcedure } from '../trpc';
import { schema, nanoid, logger } from '@mxwatch/db';
import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { decryptJSON } from '@mxwatch/alerts';
import { setupStalwartCatchall, buildSieveScript } from '@mxwatch/monitor';

function getAppHostname(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  try { return new URL(url).hostname; } catch { return 'localhost'; }
}

function getAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

async function upsert(userId: string, db: any, patch: Record<string, unknown>) {
  const [existing] = await db
    .select()
    .from(schema.deliverabilityInboxConfig)
    .where(eq(schema.deliverabilityInboxConfig.userId, userId))
    .limit(1);
  const now = new Date();
  if (existing) {
    await db
      .update(schema.deliverabilityInboxConfig)
      .set({ ...patch, updatedAt: now })
      .where(eq(schema.deliverabilityInboxConfig.userId, userId));
    return existing.id;
  }
  const id = nanoid();
  await db.insert(schema.deliverabilityInboxConfig).values({
    id, userId, createdAt: now, updatedAt: now, ...patch,
  });
  return id;
}

export const inboxSetupRouter = router({
  getConfig: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select()
      .from(schema.deliverabilityInboxConfig)
      .where(eq(schema.deliverabilityInboxConfig.userId, ctx.user.id))
      .limit(1);
    return row ?? null;
  }),

  configure: protectedProcedure
    .input(z.discriminatedUnion('mode', [
      z.object({
        mode: z.literal('own_domain'),
        inboxDomain: z.string().trim().toLowerCase().min(3).max(253),
      }),
      z.object({
        mode: z.literal('stalwart_relay'),
        stalwartIntegrationId: z.string(),
      }),
      z.object({ mode: z.literal('manual') }),
    ]))
    .mutation(async ({ ctx, input }) => {
      if (input.mode === 'own_domain') {
        await upsert(ctx.user.id, ctx.db, {
          mode: 'own_domain',
          inboxDomain: input.inboxDomain,
          setupStep: 2,
        });
        return {
          dnsRecords: [{
            type: 'MX',
            name: input.inboxDomain,
            value: `10 ${getAppHostname()}`,
          }],
        };
      }

      if (input.mode === 'stalwart_relay') {
        const [integration] = await ctx.db
          .select()
          .from(schema.stalwartIntegrations)
          .where(and(
            eq(schema.stalwartIntegrations.id, input.stalwartIntegrationId),
            eq(schema.stalwartIntegrations.userId, ctx.user.id),
          ))
          .limit(1);
        if (!integration) throw new TRPCError({ code: 'NOT_FOUND', message: 'Stalwart integration not found' });

        const webhookSecret = randomBytes(32).toString('hex');
        const webhookUrl = `${getAppUrl()}/api/webhooks/stalwart-delivery`;
        let token: string;
        try { token = decryptJSON<string>(integration.encryptedToken); }
        catch { throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Stalwart token decrypt failed' }); }

        const primaryDomain = new URL(integration.baseUrl).hostname;
        const setup = await setupStalwartCatchall({
          baseUrl: integration.baseUrl,
          apiToken: token,
          webhookUrl,
          webhookSecret,
          primaryDomain,
        });

        await upsert(ctx.user.id, ctx.db, {
          mode: 'stalwart_relay',
          stalwartIntegrationId: integration.id,
          stalwartCatchallAddress: setup.catchallAddressPattern,
          webhookSecret,
          setupStep: 2,
        });
        void logger.info('delivery', 'Stalwart inbox configured', {
          userId: ctx.user.id, uploaded: setup.uploaded,
        });
        return {
          catchallAddressPattern: setup.catchallAddressPattern,
          sieveScript: setup.sieveScript,
          uploaded: setup.uploaded,
          message: setup.message,
        };
      }

      // manual
      await upsert(ctx.user.id, ctx.db, {
        mode: 'manual',
        verified: true,
        verifiedAt: new Date(),
        setupStep: 3,
      });
      return {};
    }),

  verifyDns: protectedProcedure
    .input(z.object({ domain: z.string().trim().toLowerCase() }))
    .query(async ({ input }) => {
      try {
        const mx = await dns.promises.resolveMx(input.domain);
        const appHostname = getAppHostname();
        const exchanges = mx.map((m) => m.exchange.toLowerCase().replace(/\.$/, ''));
        const propagated = exchanges.some((e) => e === appHostname.toLowerCase());
        return { propagated, expected: appHostname, found: exchanges };
      } catch (e: any) {
        return { propagated: false, expected: getAppHostname(), found: [] as string[], error: e?.code ?? e?.message ?? 'resolve failed' };
      }
    }),

  markVerified: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(schema.deliverabilityInboxConfig)
      .set({ verified: true, verifiedAt: new Date(), setupStep: 3, updatedAt: new Date() })
      .where(eq(schema.deliverabilityInboxConfig.userId, ctx.user.id));
    void logger.info('delivery', 'Inbox verified', { userId: ctx.user.id });
    return { ok: true };
  }),

  /** Returns the current Sieve script for the user's Stalwart setup so the
   *  UI can show it for manual install if the API upload didn't take. */
  stalwartScript: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select()
      .from(schema.deliverabilityInboxConfig)
      .where(eq(schema.deliverabilityInboxConfig.userId, ctx.user.id))
      .limit(1);
    if (!row || row.mode !== 'stalwart_relay' || !row.webhookSecret) return null;
    return {
      script: buildSieveScript(`${getAppUrl()}/api/webhooks/stalwart-delivery`, row.webhookSecret),
      catchallAddressPattern: row.stalwartCatchallAddress,
    };
  }),
});
