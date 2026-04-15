import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { schema, nanoid } from '@mxwatch/db';
import { and, desc, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { encryptJSON, decryptJSON } from '@mxwatch/alerts';
import { detectMailServer, getAdapter, type MailServerType } from '@mxwatch/monitor';

const SERVER_TYPES = [
  'stalwart', 'mailcow', 'postfix', 'postfix_dovecot',
  'mailu', 'maddy', 'haraka', 'exchange', 'unknown',
] as const;
const ARCHITECTURES = ['direct', 'nat_relay', 'split', 'managed'] as const;

async function assertOwned(ctx: any, id: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.serverIntegrations)
    .where(and(eq(schema.serverIntegrations.id, id), eq(schema.serverIntegrations.userId, ctx.user.id)))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
  return row;
}

export const serverIntegrationsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: schema.serverIntegrations.id,
        name: schema.serverIntegrations.name,
        serverType: schema.serverIntegrations.serverType,
        architecture: schema.serverIntegrations.architecture,
        baseUrl: schema.serverIntegrations.baseUrl,
        domainId: schema.serverIntegrations.domainId,
        internalHost: schema.serverIntegrations.internalHost,
        relayHost: schema.serverIntegrations.relayHost,
        autoDetected: schema.serverIntegrations.autoDetected,
        detectionConfidence: schema.serverIntegrations.detectionConfidence,
        status: schema.serverIntegrations.status,
        lastError: schema.serverIntegrations.lastError,
        lastPulledAt: schema.serverIntegrations.lastPulledAt,
        createdAt: schema.serverIntegrations.createdAt,
      })
      .from(schema.serverIntegrations)
      .where(eq(schema.serverIntegrations.userId, ctx.user.id))
      .orderBy(desc(schema.serverIntegrations.createdAt));
    return rows;
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await assertOwned(ctx, input.id);
      // Never return encrypted token to the client.
      const { encryptedToken: _omit, ...rest } = row;
      return rest;
    }),

  /** Runs the server-detect engine against a hostname/IP and returns the
   * fingerprint. Does not persist. */
  detect: protectedProcedure
    .input(z.object({
      host: z.string().trim().min(1).max(253),
      internalHost: z.string().trim().min(1).max(253).optional(),
    }))
    .mutation(async ({ input }) => {
      return detectMailServer(input.host, input.internalHost);
    }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().trim().min(1).max(100),
      serverType: z.enum(SERVER_TYPES),
      architecture: z.enum(ARCHITECTURES).default('direct'),
      baseUrl: z.string().url().optional(),
      token: z.string().min(1).max(500).optional(),
      domainId: z.string().optional(),
      internalHost: z.string().trim().max(253).optional(),
      relayHost: z.string().trim().max(253).optional(),
      sendingIps: z.array(z.string()).max(16).optional(),
      autoDetected: z.boolean().default(false),
      detectionConfidence: z.enum(['high', 'medium', 'low']).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = nanoid();
      await ctx.db.insert(schema.serverIntegrations).values({
        id,
        userId: ctx.user.id,
        domainId: input.domainId ?? null,
        name: input.name,
        serverType: input.serverType,
        architecture: input.architecture,
        baseUrl: input.baseUrl ?? null,
        encryptedToken: input.token ? encryptJSON(input.token) : null,
        internalHost: input.internalHost ?? null,
        relayHost: input.relayHost ?? null,
        sendingIps: input.sendingIps ? JSON.stringify(input.sendingIps) : null,
        autoDetected: input.autoDetected,
        detectionConfidence: input.detectionConfidence ?? null,
        status: 'unknown',
        createdAt: new Date(),
      });
      return { id };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwned(ctx, input.id);
      await ctx.db.delete(schema.serverIntegrations).where(eq(schema.serverIntegrations.id, input.id));
      return { ok: true };
    }),

  /** Calls the relevant adapter's test() method, persists status, returns result. */
  test: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await assertOwned(ctx, input.id);
      const token = row.encryptedToken ? decryptJSON<string>(row.encryptedToken) : '';
      const adapter = getAdapter(row.serverType as MailServerType);
      const result = await adapter.test({ baseUrl: row.baseUrl ?? '', apiToken: token });
      await ctx.db
        .update(schema.serverIntegrations)
        .set({
          status: result.ok ? 'ok' : 'error',
          lastError: result.ok ? null : result.message,
          lastPulledAt: new Date(),
        })
        .where(eq(schema.serverIntegrations.id, row.id));
      return result;
    }),
});
