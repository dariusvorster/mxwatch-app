import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { schema } from '@mxwatch/db';
import { eq } from 'drizzle-orm';
import type { Context } from './context';

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(async ({ ctx, next, path }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });

  // IP-allowlist enforcement (Phase 3e). Skipped for security.* itself so a
  // user who locks themselves out can still get back via /auth/blocked.
  if (!path.startsWith('security.')) {
    const [u] = await ctx.db
      .select({ ipAllowlist: schema.users.ipAllowlist })
      .from(schema.users)
      .where(eq(schema.users.id, ctx.user.id))
      .limit(1);
    if (u?.ipAllowlist) {
      const list = JSON.parse(u.ipAllowlist) as string[];
      if (list.length > 0) {
        const ok = ctx.ipAddress != null && ipMatchesAny(ctx.ipAddress, list);
        if (!ok) throw new TRPCError({ code: 'FORBIDDEN', message: 'IP not in allowlist' });
      }
    }
  }

  return next({ ctx: { ...ctx, user: ctx.user } });
});

// Tiny IPv4-only matcher — exact match for plain IPs, naive /N CIDR for
// ranges. Sufficient for self-host single-tenant; swap for `is-in-subnet`
// later if v6 / complex ranges become a real need.
function ipMatchesAny(ip: string, list: string[]): boolean {
  for (const entry of list) {
    if (entry === ip) return true;
    if (entry.includes('/')) {
      const [base, bitsStr] = entry.split('/');
      const bits = Number(bitsStr);
      if (!base || !Number.isFinite(bits)) continue;
      if ((ipv4ToInt(ip) >>> (32 - bits)) === (ipv4ToInt(base) >>> (32 - bits))) return true;
    }
  }
  return false;
}
function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return -1;
  return (((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0);
}
