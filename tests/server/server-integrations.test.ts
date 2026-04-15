import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import { serverIntegrationsRouter } from '@/server/routers/server-integrations';
import { makeTestDb, ctxFor } from './_helpers';

async function fixture() {
  const t = makeTestDb();
  const u1 = await t.seedUser('u1@x');
  const u2 = await t.seedUser('u2@x');
  const d1 = await t.seedDomain(u1.id);
  return { t, u1, u2, d1 };
}

describe('serverIntegrations router', () => {
  it('create + list returns owned rows only and never leaks the encrypted token', async () => {
    const { t, u1, u2, d1 } = await fixture();
    const c1 = serverIntegrationsRouter.createCaller(ctxFor(t.db, u1.id));
    await c1.create({
      name: 'mail-prod', serverType: 'stalwart', architecture: 'direct',
      baseUrl: 'https://mail.example.com', token: 'sekret', domainId: d1.id,
    });
    const list = await c1.list();
    expect(list).toHaveLength(1);
    expect((list[0] as any).encryptedToken).toBeUndefined();
    // u2 sees nothing.
    const c2 = serverIntegrationsRouter.createCaller(ctxFor(t.db, u2.id));
    expect(await c2.list()).toHaveLength(0);
  });

  it('get throws NOT_FOUND for cross-tenant access', async () => {
    const { t, u1, u2 } = await fixture();
    const c1 = serverIntegrationsRouter.createCaller(ctxFor(t.db, u1.id));
    const created = await c1.create({ name: 'mine', serverType: 'unknown', architecture: 'direct' });
    const c2 = serverIntegrationsRouter.createCaller(ctxFor(t.db, u2.id));
    await expect(c2.get({ id: created.id })).rejects.toBeInstanceOf(TRPCError);
  });

  it('remove deletes the row and frees the name', async () => {
    const { t, u1 } = await fixture();
    const c1 = serverIntegrationsRouter.createCaller(ctxFor(t.db, u1.id));
    const r = await c1.create({ name: 'tmp', serverType: 'unknown', architecture: 'direct' });
    await c1.remove({ id: r.id });
    expect(await c1.list()).toHaveLength(0);
  });
});
