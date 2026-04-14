import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { schema, nanoid } from '@mxwatch/db';
import { and, desc, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { randomBytes } from 'node:crypto';

function generateLocalPart() {
  return `test-${randomBytes(4).toString('hex')}`;
}

function testAddressFor(localPart: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  let host: string;
  try { host = new URL(appUrl).hostname; } catch { host = 'localhost'; }
  return `${localPart}@${host}`;
}

async function assertOwned(ctx: any, id: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.deliverabilityTests)
    .where(and(eq(schema.deliverabilityTests.id, id), eq(schema.deliverabilityTests.userId, ctx.user.id)))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
  return row;
}

export const deliverabilityRouter = router({
  create: protectedProcedure
    .input(z.object({ domainId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const id = nanoid();
      const local = generateLocalPart();
      const testAddress = testAddressFor(local).toLowerCase();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 min window
      await ctx.db.insert(schema.deliverabilityTests).values({
        id,
        userId: ctx.user.id,
        domainId: input.domainId ?? null,
        testAddress,
        sendingMode: 'manual',
        status: 'pending',
        createdAt: now,
        expiresAt,
      });
      return { id, testAddress, expiresAt };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await assertOwned(ctx, input.id);
      return {
        ...row,
        scoreOutOf10: row.score != null ? row.score / 10 : null,
        results: row.results ? (JSON.parse(row.results) as Record<string, unknown>) : null,
      };
    }),

  history: protectedProcedure
    .input(z.object({ domainId: z.string().optional(), limit: z.number().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const conditions = [eq(schema.deliverabilityTests.userId, ctx.user.id)];
      if (input.domainId) conditions.push(eq(schema.deliverabilityTests.domainId, input.domainId));
      const rows = await ctx.db
        .select()
        .from(schema.deliverabilityTests)
        .where(and(...conditions))
        .orderBy(desc(schema.deliverabilityTests.createdAt))
        .limit(input.limit);
      return rows.map((r) => ({
        id: r.id,
        domainId: r.domainId,
        status: r.status,
        scoreOutOf10: r.score != null ? r.score / 10 : null,
        subject: r.subject,
        fromAddress: r.fromAddress,
        createdAt: r.createdAt,
        receivedAt: r.receivedAt,
      }));
    }),
});
