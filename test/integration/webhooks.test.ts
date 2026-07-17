import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createFakeRedis } from '../fakes/redis.js';
import { computeHmac } from '../../src/lib/hmac.js';

const fakeRedis = vi.hoisted(() => ({ instance: null as ReturnType<typeof createFakeRedis> | null }));

vi.mock('../../src/lib/redis.js', async () => {
  const mod = await import('../fakes/redis.js');
  fakeRedis.instance = mod.createFakeRedis();
  return {
    getRedis: () => fakeRedis.instance,
    bullConnection: () => ({}),
    closeRedis: async () => undefined,
  };
});

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import('../../src/app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  fakeRedis.instance?._store.clear();
});

describe('ad-network postback webhook signature verification', () => {
  const url = '/v1/medicare-reviews/sponsored-engagement/postback';
  const secret = 'test-adnetwork-secret';
  const rawBody = JSON.stringify({
    adDeliveryId: 'del-1',
    adId: 'ad-1',
    memberId: 'm-1',
    deliveredAt: 1700000000000,
  });

  it('rejects an invalid signature (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json', 'x-webhook-signature': 'deadbeef' },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('BAD_SIGNATURE');
  });

  it('rejects a missing signature (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json' },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts a valid signature and reaches the pending-chaincode 501', async () => {
    const signature = computeHmac(secret, rawBody);
    const res = await app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json', 'x-webhook-signature': signature },
      payload: rawBody,
    });
    // Signature verified + payload valid; blocked only on pending chaincode.
    expect(res.statusCode).toBe(501);
    expect(res.json().error).toMatchObject({
      category: 'not_implemented',
      details: { contract: 'SponsoredEngagementContract' },
    });
  });
});

describe('pending route groups return 501', () => {
  it('wintergarden payout initiation is 501', async () => {
    const { setMemberTokenVerifier } = await import('../../src/middleware/origin-auth.js');
    setMemberTokenVerifier(async () => ({ sub: 'wg-1' }));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/wintergarden/usdc-payouts',
      headers: {
        origin: 'https://wintergarden.cc',
        authorization: 'Bearer t',
        'content-type': 'application/json',
      },
      payload: { eventId: 'e1' },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json().error.details.contract).toBe('WintergardenContract');
  });
});
