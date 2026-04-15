import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { schema, logActivity } from '@mxwatch/db';
import { eq } from 'drizzle-orm';

// Cap stored avatar images — anything larger bloats the DB row and
// breaks the sidebar layout anyway. ~200KB accommodates a decent 200×200
// JPEG/PNG after base64 encoding.
const MAX_IMAGE_CHARS = 280_000;

export const profileRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const [u] = await ctx.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        image: schema.users.image,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, ctx.user.id))
      .limit(1);
    return u ?? null;
  }),

  update: protectedProcedure
    .input(z.object({
      name: z.string().trim().max(100).nullable().optional(),
      // Data URL string or null to clear the avatar.
      image: z.string()
        .max(MAX_IMAGE_CHARS)
        .regex(/^data:image\/(png|jpe?g|gif|webp);base64,/, 'Must be a data:image/ PNG/JPEG/GIF/WEBP')
        .nullable()
        .optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.image !== undefined) patch.image = input.image;
      if (Object.keys(patch).length === 1) return { ok: true };
      await ctx.db.update(schema.users).set(patch).where(eq(schema.users.id, ctx.user.id));
      await logActivity({
        userId: ctx.user.id, action: 'profile_updated',
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
        detail: { fields: Object.keys(patch).filter((k) => k !== 'updatedAt') },
      });
      return { ok: true };
    }),
});
