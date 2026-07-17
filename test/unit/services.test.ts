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

  it('CircleUSDCProvider stub submits and maps webhook statuses', async () => {
    const p = new CircleUSDCProvider();
    const res = await p.createPayout({
      fabricEventId: 'fe2',
      destinationAddress: '0xabc',
      amountUsdc: '2.00',
      chain: 'base-sepolia',
    });
    expect(res.status).toBe('submitted');
    expect((await p.getPayoutStatus('pp')).status).toBe('pending');
    const evt = p.parseWebhook({ id: 'pp', fabricEventId: 'fe2', status: 'complete', txHash: '0xh' });
    expect(evt.status).toBe('confirmed');
    expect(evt.publicChainTxHash).toBe('0xh');
    expect(p.parseWebhook({ status: 'failed' }).status).toBe('failed');
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
