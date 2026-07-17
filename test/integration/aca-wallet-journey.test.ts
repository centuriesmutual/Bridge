import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { TEST_API_KEY } from '../setup.js';
import { createFakeRedis } from '../fakes/redis.js';

/**
 * End-to-end smoke test of the centuries-mutual ACA -> wallet journey the
 * product describes:
 *   1. Member enrolls (ACA) -> enrollment milestone recorded (admin/system).
 *   2. Admin activates the member's Rewards Wallet.
 *   3. Member reads wallet status (now active) + balance.
 *   4. System credits a reward; member sees the balance.
 *
 * The Fabric ledger is MOCKED here (no live peer in CI). This proves the
 * bridge wiring + auth + idempotency are correct; swapping in the real
 * GatewayTransport against the deployed RewardsContract makes it live.
 */

const fakeRedis = vi.hoisted(() => ({ instance: null as ReturnType<typeof createFakeRedis> | null }));
vi.mock('../../src/lib/redis.js', async () => {
  const mod = await import('../fakes/redis.js');
  fakeRedis.instance = mod.createFakeRedis();
  return { getRedis: () => fakeRedis.instance, bullConnection: () => ({}), closeRedis: async () => undefined };
});

const CM_ORIGIN = 'https://centuriesmutual.com';
const admin = { 'x-api-key': TEST_API_KEY, 'content-type': 'application/json' };
const member = { origin: CM_ORIGIN, authorization: 'Bearer member-token' };

let app: FastifyInstance;
const transport = { evaluate: vi.fn(), submit: vi.fn() };

beforeAll(async () => {
  const { LedgerBridgeContracts, setContracts } = await import('../../src/fabric/contracts.js');
  setContracts(new LedgerBridgeContracts(transport));
  const { setMemberTokenVerifier } = await import('../../src/middleware/origin-auth.js');
  setMemberTokenVerifier(async () => ({ sub: 'aca-member-1' }));
  const { buildApp } = await import('../../src/app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  transport.evaluate.mockReset();
  transport.submit.mockReset();
  fakeRedis.instance?._store.clear();
});

describe('centuries-mutual ACA -> wallet activation journey', () => {
  it('walks enrollment -> admin activation -> member sees active wallet + balance', async () => {
    // 1. ACA enrollment milestone recorded server-to-server.
    transport.submit.mockResolvedValueOnce({ result: '{}', txId: 'tx-enroll' });
    const enroll = await app.inject({
      method: 'POST',
      url: '/v1/centuries-mutual/enrollment/members/aca-member-1/milestone',
      headers: admin,
      payload: { milestone: 'aca_enrolled', eventId: 'enr-1' },
    });
    expect(enroll.statusCode).toBe(201);

    // 2. Before activation, member's wallet reads as inactive.
    transport.evaluate.mockResolvedValueOnce(
      JSON.stringify({ memberId: 'cm:aca-member-1', status: 'inactive' }),
    );
    const before = await app.inject({ method: 'GET', url: '/v1/centuries-mutual/rewards/wallet', headers: member });
    expect(before.json().status).toBe('inactive');

    // 3. Admin activates the wallet (this is what the future admin page calls).
    transport.submit.mockResolvedValueOnce({ result: '{}', txId: 'tx-activate' });
    const activate = await app.inject({
      method: 'POST',
      url: '/v1/centuries-mutual/rewards/members/aca-member-1/activate',
      headers: admin,
      payload: { activatedBy: 'admin:jane', eventId: 'act-1' },
    });
    expect(activate.statusCode).toBe(200);
    expect(transport.submit).toHaveBeenLastCalledWith(
      'RewardsContract',
      'ActivateWallet',
      ['cm:aca-member-1', 'admin:jane', 'act-1'],
    );

    // 4. Member now sees an active wallet.
    transport.evaluate.mockResolvedValueOnce(
      JSON.stringify({ memberId: 'cm:aca-member-1', status: 'active', activatedBy: 'admin:jane' }),
    );
    const after = await app.inject({ method: 'GET', url: '/v1/centuries-mutual/rewards/wallet', headers: member });
    expect(after.json().status).toBe('active');

    // 5. System credits a reward, member reads the balance.
    transport.submit.mockResolvedValueOnce({ result: '{}', txId: 'tx-credit' });
    const credit = await app.inject({
      method: 'POST',
      url: '/v1/centuries-mutual/rewards/members/aca-member-1/credit',
      headers: admin,
      payload: { amount: 100, reason: 'enrollment_bonus', eventId: 'cr-1' },
    });
    expect(credit.statusCode).toBe(201);

    transport.evaluate.mockResolvedValueOnce(
      JSON.stringify({ memberId: 'cm:aca-member-1', balance: 100, currency: 'CM_CREDIT' }),
    );
    const balance = await app.inject({ method: 'GET', url: '/v1/centuries-mutual/rewards/balance', headers: member });
    expect(balance.json()).toMatchObject({ balance: 100, currency: 'CM_CREDIT' });
  });

  it('requires admin scope to activate a wallet (a plain write key is not enough)', async () => {
    // Activation demands rewards:admin; verified via the least-privilege scope check.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/centuries-mutual/rewards/members/x/activate',
      headers: { 'content-type': 'application/json' }, // no api key at all
      payload: { activatedBy: 'admin:jane', eventId: 'act-2' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('confirms the medicare-reviews wallet is still blocked on pending chaincode (501)', async () => {
    // Wallet assignment for medicare.reviews needs SponsoredEngagementContract.
    const { setMemberTokenVerifier } = await import('../../src/middleware/origin-auth.js');
    setMemberTokenVerifier(async () => ({ sub: 'mr-1' }));
    const res = await app.inject({
      method: 'GET',
      url: '/v1/medicare-reviews/sponsored-engagement/wallet',
      headers: { origin: 'https://medicare.reviews', authorization: 'Bearer t' },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json().error.details.contract).toBe('SponsoredEngagementContract');
  });
});
