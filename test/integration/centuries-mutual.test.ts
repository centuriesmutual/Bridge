import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { TEST_API_KEY } from '../setup.js';
import { createFakeRedis } from '../fakes/redis.js';

// In-memory Redis for the idempotency middleware.
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

const CM_ORIGIN = 'https://centuriesmutual.com';

let app: FastifyInstance;
const transport = {
  evaluate: vi.fn(),
  submit: vi.fn(),
};

beforeAll(async () => {
  const { LedgerBridgeContracts, setContracts } = await import('../../src/fabric/contracts.js');
  setContracts(new LedgerBridgeContracts(transport));

  const { setMemberTokenVerifier } = await import('../../src/middleware/origin-auth.js');
  setMemberTokenVerifier(async () => ({ sub: '123' }));

  const { setPartnerTokenVerifier } = await import('../../src/middleware/oauth.js');
  setPartnerTokenVerifier(async () => ({ sub: 'partner-1', scope: 'rewards:read' }));

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

describe('centuries-mutual rewards (member)', () => {
  it('returns a member balance from the ledger', async () => {
    transport.evaluate.mockResolvedValueOnce(
      JSON.stringify({ memberId: 'cm:123', balance: 250, currency: 'CM_CREDIT' }),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/v1/centuries-mutual/rewards/balance',
      headers: { origin: CM_ORIGIN, authorization: 'Bearer member-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ balance: 250 });
    // Member id is property-scoped before hitting chaincode.
    expect(transport.evaluate).toHaveBeenCalledWith('RewardsContract', 'GetBalance', ['cm:123']);
  });

  it('rejects a request with no allowlisted origin (403)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/centuries-mutual/rewards/balance',
      headers: { authorization: 'Bearer member-token' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an origin from a different property (403)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/centuries-mutual/rewards/balance',
      headers: { origin: 'https://medicare.reviews', authorization: 'Bearer member-token' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('centuries-mutual rewards (partner / api key)', () => {
  const url = '/v1/centuries-mutual/rewards/members/999/credit';
  const body = { amount: 100, reason: 'referral', eventId: 'evt-1' };

  it('credits via API key and is idempotent on replay', async () => {
    transport.submit.mockResolvedValue({ result: '{}', txId: 'txCredit' });
    const first = await app.inject({
      method: 'POST',
      url,
      headers: { 'x-api-key': TEST_API_KEY, 'content-type': 'application/json' },
      payload: body,
    });
    expect(first.statusCode).toBe(201);
    expect(transport.submit).toHaveBeenCalledWith(
      'RewardsContract',
      'CreditReward',
      ['cm:999', '100', 'referral', 'evt-1'],
    );

    const replay = await app.inject({
      method: 'POST',
      url,
      headers: { 'x-api-key': TEST_API_KEY, 'content-type': 'application/json' },
      payload: body,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotent-replay']).toBe('true');
    // Chaincode invoked only once despite two identical requests.
    expect(transport.submit).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing API key (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json' },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns a validation error shape for a bad payload (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url,
      headers: { 'x-api-key': TEST_API_KEY, 'content-type': 'application/json' },
      payload: { amount: -5, reason: '', eventId: 'evt-2' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ category: 'validation', retryable: false });
  });

  it('returns a distinct ledger error shape when the commit fails (502)', async () => {
    const { LedgerError } = await import('../../src/lib/errors.js');
    transport.submit.mockRejectedValueOnce(new LedgerError('commit failed'));
    const res = await app.inject({
      method: 'POST',
      url,
      headers: { 'x-api-key': TEST_API_KEY, 'content-type': 'application/json' },
      payload: { amount: 10, reason: 'x', eventId: 'evt-ledger' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatchObject({ category: 'ledger', retryable: true });
  });

  it('releases the idempotency reservation on failure so a retry can succeed', async () => {
    const { LedgerError } = await import('../../src/lib/errors.js');
    transport.submit.mockRejectedValueOnce(new LedgerError('transient'));
    const payload = { amount: 10, reason: 'x', eventId: 'evt-retry' };
    const failed = await app.inject({
      method: 'POST',
      url,
      headers: { 'x-api-key': TEST_API_KEY, 'content-type': 'application/json' },
      payload,
    });
    expect(failed.statusCode).toBe(502);
    // Reservation released -> the identical retry is processed, not 409'd.
    transport.submit.mockResolvedValueOnce({ result: '{}', txId: 'ok' });
    const retry = await app.inject({
      method: 'POST',
      url,
      headers: { 'x-api-key': TEST_API_KEY, 'content-type': 'application/json' },
      payload,
    });
    expect(retry.statusCode).toBe(201);
  });

  it('returns 409 when an idempotency key is already in-flight', async () => {
    fakeRedis.instance?._store.set(
      'idem:cm:rewards:credit:evt-inflight',
      JSON.stringify({ status: 'in_flight' }),
    );
    const res = await app.inject({
      method: 'POST',
      url,
      headers: { 'x-api-key': TEST_API_KEY, 'content-type': 'application/json' },
      payload: { amount: 10, reason: 'x', eventId: 'evt-inflight' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('DUPLICATE_REQUEST');
  });

  it('rejects a write with no idempotency key (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url,
      headers: { 'x-api-key': TEST_API_KEY, 'content-type': 'application/json' },
      payload: { amount: 10, reason: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('centuries-mutual consent / enrollment / wellness', () => {
  const member = { origin: CM_ORIGIN, authorization: 'Bearer t' };

  it('reads consent for a member', async () => {
    transport.evaluate.mockResolvedValueOnce(
      JSON.stringify({ memberId: 'cm:123', scope: 'marketing', granted: true, updatedAt: 'x' }),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/v1/centuries-mutual/consent?scope=marketing',
      headers: member,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().granted).toBe(true);
  });

  it('sets consent (idempotent PUT)', async () => {
    transport.submit.mockResolvedValue({ result: '{}', txId: 'tx' });
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/centuries-mutual/consent',
      headers: { ...member, 'content-type': 'application/json' },
      payload: { scope: 'marketing', granted: false, eventId: 'c-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(transport.submit).toHaveBeenCalledWith(
      'ConsentContract',
      'SetConsent',
      ['cm:123', 'marketing', 'false', 'c-1'],
    );
  });

  it('reads enrollment + redeems rewards + reads history', async () => {
    transport.evaluate.mockResolvedValueOnce(JSON.stringify({ memberId: 'cm:123', milestones: [] }));
    const enroll = await app.inject({ method: 'GET', url: '/v1/centuries-mutual/enrollment', headers: member });
    expect(enroll.statusCode).toBe(200);

    transport.submit.mockResolvedValueOnce({ result: '{}', txId: 'tx' });
    const redeem = await app.inject({
      method: 'POST',
      url: '/v1/centuries-mutual/rewards/redeem',
      headers: { ...member, 'content-type': 'application/json' },
      payload: { amount: 50, rewardSku: 'GC_25', eventId: 'r-1' },
    });
    expect(redeem.statusCode).toBe(200);

    transport.evaluate.mockResolvedValueOnce(JSON.stringify([]));
    const hist = await app.inject({ method: 'GET', url: '/v1/centuries-mutual/rewards/history', headers: member });
    expect(hist.json().entries).toEqual([]);
  });

  it('reads wellness + records an activity via API key', async () => {
    transport.evaluate.mockResolvedValueOnce(JSON.stringify({ memberId: 'cm:123', activities: [] }));
    const status = await app.inject({ method: 'GET', url: '/v1/centuries-mutual/wellness', headers: member });
    expect(status.statusCode).toBe(200);

    transport.submit.mockResolvedValueOnce({ result: '{}', txId: 'tx' });
    const activity = await app.inject({
      method: 'POST',
      url: '/v1/centuries-mutual/wellness/members/77/activity',
      headers: { 'x-api-key': TEST_API_KEY, 'content-type': 'application/json' },
      payload: { activityType: 'steps', value: 8000, eventId: 'w-1' },
    });
    expect(activity.statusCode).toBe(201);
    expect(transport.submit).toHaveBeenCalledWith(
      'WellnessContract',
      'RecordWellnessActivity',
      ['cm:77', 'steps', '8000', 'w-1'],
    );
  });

  it('records an enrollment milestone via API key', async () => {
    transport.submit.mockResolvedValueOnce({ result: '{}', txId: 'tx' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/centuries-mutual/enrollment/members/77/milestone',
      headers: { 'x-api-key': TEST_API_KEY, 'content-type': 'application/json' },
      payload: { milestone: 'plan_selected', eventId: 'm-1' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('serves a partner OAuth balance read', async () => {
    transport.evaluate.mockResolvedValueOnce(
      JSON.stringify({ memberId: 'cm:5', balance: 10, currency: 'CM_CREDIT' }),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/v1/centuries-mutual/rewards/members/5/balance',
      headers: { authorization: 'Bearer partner-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().balance).toBe(10);
  });
});

describe('health + unknown routes', () => {
  it('serves /healthz', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('returns the JSON envelope for unknown routes (404)', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});
