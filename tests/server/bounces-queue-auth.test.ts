import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import { schema, nanoid } from '@mxwatch/db';
import { bouncesRouter } from '@/server/routers/bounces';
import { queueRouter } from '@/server/routers/queue';
import { authFailuresRouter } from '@/server/routers/auth-failures';
import { makeTestDb, ctxFor } from './_helpers';

async function fixture() {
  const t = makeTestDb();
  const u1 = await t.seedUser('u1@x');
  const u2 = await t.seedUser('u2@x');
  const d1 = await t.seedDomain(u1.id);
  const integrationId = nanoid();
  await t.db.insert(schema.serverIntegrations).values({
    id: integrationId, userId: u1.id, name: 'srv', serverType: 'stalwart',
    architecture: 'direct', createdAt: new Date(),
  });
  return { t, u1, u2, d1, integrationId };
}

describe('bounces router', () => {
  it('list filters by domain ownership and acknowledge requires it', async () => {
    const { t, u1, u2, d1 } = await fixture();
    const id = nanoid();
    await t.db.insert(schema.bounceEvents).values({
      id, domainId: d1.id, timestamp: new Date(), originalTo: 'x@gmail.com',
      recipientDomain: 'gmail.com', bounceType: 'hard', errorCode: '5.1.1',
      errorMessage: 'no such user',
    });
    const c1 = bouncesRouter.createCaller(ctxFor(t.db, u1.id));
    const list = await c1.list({ limit: 100 });
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(id);

    // u2 (no domains) gets nothing.
    const c2 = bouncesRouter.createCaller(ctxFor(t.db, u2.id));
    expect(await c2.list({ limit: 100 })).toHaveLength(0);
    await expect(c2.acknowledge({ id })).rejects.toBeInstanceOf(TRPCError);

    // u1 ack flips the row.
    await c1.acknowledge({ id });
    const after = await c1.list({ limit: 100, onlyUnacknowledged: true });
    expect(after).toHaveLength(0);
  });
});

describe('queue router', () => {
  it('current returns latest snapshot and history is range-bounded', async () => {
    const { t, u1, integrationId } = await fixture();
    const old = new Date(Date.now() - 30 * 3600 * 1000);
    const fresh = new Date();
    await t.db.insert(schema.queueSnapshots).values([
      { id: nanoid(), integrationId, total: 1, active: 0, deferred: 0, failed: 0, recordedAt: old },
      { id: nanoid(), integrationId, total: 7, active: 1, deferred: 2, failed: 4, recordedAt: fresh },
    ]);
    const c = queueRouter.createCaller(ctxFor(t.db, u1.id));
    const cur = await c.current({ integrationId });
    expect(cur?.total).toBe(7);
    const hist24h = await c.history({ integrationId, hours: 24 });
    expect(hist24h).toHaveLength(1);
    const hist72h = await c.history({ integrationId, hours: 72 });
    expect(hist72h).toHaveLength(2);
  });
});

describe('authFailures router', () => {
  it('byIp aggregates attempts per source IP', async () => {
    const { t, u1, integrationId } = await fixture();
    const now = new Date();
    await t.db.insert(schema.authFailureEvents).values([
      { id: nanoid(), integrationId, ip: '1.2.3.4', count: 3, mechanism: 'PLAIN', detectedAt: now },
      { id: nanoid(), integrationId, ip: '1.2.3.4', count: 5, mechanism: 'PLAIN', detectedAt: now },
      { id: nanoid(), integrationId, ip: '5.6.7.8', count: 1, mechanism: 'LOGIN', detectedAt: now },
    ]);
    const c = authFailuresRouter.createCaller(ctxFor(t.db, u1.id));
    const agg = await c.byIp({ integrationId, hours: 24 });
    expect(agg).toHaveLength(2);
    expect(agg.find((r) => r.ip === '1.2.3.4')?.attempts).toBe(8);
  });
});
