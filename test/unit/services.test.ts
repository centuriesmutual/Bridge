import { describe, expect, it } from 'vitest';
import { MockUSDCProvider } from '../../src/services/usdc/index.js';
import { CircleUSDCProvider } from '../../src/services/usdc/circle.provider.js';
import {
  normalizeAggregatorWebhook,
  WearableAggregatorClient,
} from '../../src/services/wearables/aggregator.client.js';
import {
  parseAdPostback,
  verifyAdPostbackSignature,
} from '../../src/services/ad-network/postback.validator.js';
import { computeHmac } from '../../src/lib/hmac.js';
import { ValidationError } from '../../src/lib/errors.js';

describe('USDC providers', () => {
  it('MockUSDCProvider confirms instantly', async () => {
    const p = new MockUSDCProvider();
    const res = await p.createPayout({
      fabricEventId: 'fe1',
      destinationAddress: '0xabc',
      amountUsdc: '1.00',
      chain: 'base-sepolia',
    });
    expect(res.status).toBe('confirmed');
    expect(res.publicChainTxHash).toContain('fe1');
    expect((await p.getPayoutStatus('x')).status).toBe('confirmed');
    expect(p.parseWebhook({ fabricEventId: 'fe1', providerPayoutId: 'pp' }).status).toBe('confirmed');
  });

  it('CircleUSDCProvider stub submits when no key is configured', async () => {
    // Test env has no USDC_PROVIDER_API_KEY -> stub mode.
    const p = new CircleUSDCProvider();
    const res = await p.createPayout({
      fabricEventId: 'fe2',
      destinationAddress: '0xabc',
      amountUsdc: '2.00',
      chain: 'base-sepolia',
    });
    expect(res.providerPayoutId).toContain('circle_stub_');
    expect(res.status).toBe('submitted');
    expect((await p.getPayoutStatus('pp')).status).toBe('pending');
  });

  it('CircleUSDCProvider maps webhook statuses (direct + SNS-wrapped)', () => {
    const p = new CircleUSDCProvider();
    const direct = p.parseWebhook({
      id: 'pp',
      idempotencyKey: 'idem-1',
      status: 'complete',
      transactionHash: '0xh',
    });
    expect(direct.status).toBe('confirmed');
    expect(direct.publicChainTxHash).toBe('0xh');
    expect(direct.fabricEventId).toBe('idem-1');

    const wrapped = p.parseWebhook({
      Message: JSON.stringify({ transfer: { id: 'pp2', status: 'failed' } }),
    });
    expect(wrapped.status).toBe('failed');
    expect(wrapped.providerPayoutId).toBe('pp2');
  });

  it('CircleUSDCProvider calls the Transfers API when configured', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { id: 'transfer_1', status: 'pending' } }),
      } as Response;
    }) as unknown as typeof fetch;

    const p = new CircleUSDCProvider({
      apiKey: 'TEST_API_KEY:abc:def',
      apiBase: 'https://api-sandbox.circle.com',
      sourceWalletId: 'wallet-1',
      fetchImpl,
    });
    const res = await p.createPayout({
      fabricEventId: 'fe3',
      destinationAddress: '0x' + '1'.repeat(40),
      amountUsdc: '12.50',
      chain: 'base-sepolia',
    });
    expect(res.providerPayoutId).toBe('transfer_1');
    expect(res.status).toBe('submitted');
    expect(calls[0]!.url).toBe('https://api-sandbox.circle.com/v1/transfers');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.destination.chain).toBe('BASE');
    expect(body.source.id).toBe('wallet-1');
    expect(body.amount).toEqual({ amount: '12.50', currency: 'USD' });
    // Deterministic idempotency key so retries don't double-pay.
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('CircleUSDCProvider surfaces an UpstreamError on API failure', async () => {
    const fetchImpl = (async () =>
      ({ ok: false, status: 400, json: async () => ({ code: 1, message: 'bad' }) }) as Response) as unknown as typeof fetch;
    const p = new CircleUSDCProvider({
      apiKey: 'TEST_API_KEY:abc:def',
      sourceWalletId: 'wallet-1',
      fetchImpl,
    });
    const { UpstreamError } = await import('../../src/lib/errors.js');
    await expect(
      p.createPayout({
        fabricEventId: 'fe4',
        destinationAddress: '0xabc',
        amountUsdc: '1.00',
        chain: 'eth',
      }),
    ).rejects.toBeInstanceOf(UpstreamError);
  });

  it('CircleUSDCProvider errors when the source wallet is unset', async () => {
    const p = new CircleUSDCProvider({ apiKey: 'TEST_API_KEY:abc:def' });
    const { UpstreamError } = await import('../../src/lib/errors.js');
    await expect(
      p.createPayout({
        fabricEventId: 'fe5',
        destinationAddress: '0xabc',
        amountUsdc: '1.00',
        chain: 'eth',
      }),
    ).rejects.toBeInstanceOf(UpstreamError);
  });

  it('CircleUSDCProvider fetches transfer status when configured', async () => {
    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ data: { id: 't9', status: 'complete', transactionHash: '0xabc' } }),
      }) as Response) as unknown as typeof fetch;
    const p = new CircleUSDCProvider({ apiKey: 'TEST_API_KEY:abc:def', fetchImpl });
    const res = await p.getPayoutStatus('t9');
    expect(res.status).toBe('confirmed');
    expect(res.publicChainTxHash).toBe('0xabc');
  });
});

describe('wearable aggregator', () => {
  it('normalizes a valid webhook', () => {
    const samples = normalizeAggregatorWebhook({
      batchId: 'b1',
      provider: 'terra',
      user: { externalUserId: 'u1' },
      data: [
        { steps: 500, recordedAt: 1700000000000 },
        { steps: 100, recordedAt: '2023-01-01T00:00:00Z' },
      ],
    });
    expect(samples).toHaveLength(2);
    expect(samples[0]!.externalUserId).toBe('u1');
    expect(Number.isNaN(samples[1]!.recordedAt)).toBe(false);
  });

  it('rejects a malformed webhook', () => {
    expect(() => normalizeAggregatorWebhook({ nope: true })).toThrow(ValidationError);
  });

  it('returns empty from the stubbed client when unconfigured', async () => {
    const client = new WearableAggregatorClient();
    expect(await client.fetchUserActivity('u1')).toEqual([]);
  });
});

describe('ad-network postback', () => {
  const body = { adDeliveryId: 'd1', adId: 'a1', memberId: 'm1', deliveredAt: 1700000000000 };

  it('parses a valid postback', () => {
    expect(parseAdPostback(body).adDeliveryId).toBe('d1');
  });

  it('throws on a malformed postback', () => {
    expect(() => parseAdPostback({ adId: 'a' })).toThrow(ValidationError);
  });

  it('verifies the signature over the raw body', () => {
    const raw = JSON.stringify(body);
    const sig = computeHmac('secret', raw);
    expect(verifyAdPostbackSignature('secret', raw, sig)).toBe(true);
    expect(verifyAdPostbackSignature('secret', raw, 'bad')).toBe(false);
  });
});
