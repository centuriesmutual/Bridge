import { describe, expect, it } from 'vitest';
import { parseOrThrow } from '../../src/schemas/common.js';
import {
  CreditRewardBody,
  RedeemRewardBody,
  SetConsentBody,
  WellnessActivityBody,
} from '../../src/schemas/centuries-mutual.js';
import { SetOptInBody, SponsoredEngagementPostback } from '../../src/schemas/medicare-reviews.js';
import {
  InitiatePayoutBody,
  MERIT_BADGE_MIN_SCORE,
  RecordSessionBody,
  UsdcSettlementWebhook,
} from '../../src/schemas/wintergarden.js';
import { REDEMPTION_TIERS, RedeemTierBody, WearableWebhookBody } from '../../src/schemas/mybrotherskeeper.js';
import { ValidationError } from '../../src/lib/errors.js';

describe('schemas', () => {
  it('parses valid centuries-mutual bodies', () => {
    expect(parseOrThrow(CreditRewardBody, { amount: 5, reason: 'x', eventId: 'e' }).amount).toBe(5);
    expect(parseOrThrow(RedeemRewardBody, { amount: 5, rewardSku: 's', eventId: 'e' }).rewardSku).toBe('s');
    expect(parseOrThrow(SetConsentBody, { scope: 'm', granted: true, eventId: 'e' }).granted).toBe(true);
    expect(parseOrThrow(WellnessActivityBody, { activityType: 'steps', value: 10, eventId: 'e' }).value).toBe(10);
  });

  it('throws ValidationError on bad input', () => {
    expect(() => parseOrThrow(CreditRewardBody, { amount: -1, reason: '', eventId: '' })).toThrow(
      ValidationError,
    );
  });

  it('parses medicare-reviews bodies', () => {
    expect(parseOrThrow(SetOptInBody, { optedIn: true, eventId: 'e' }).optedIn).toBe(true);
    const pb = parseOrThrow(SponsoredEngagementPostback, {
      adDeliveryId: 'd',
      adId: 'a',
      memberId: 'm',
      deliveredAt: 123,
    });
    expect(pb.adId).toBe('a');
  });

  it('parses wintergarden bodies incl. wallet address validation', () => {
    expect(MERIT_BADGE_MIN_SCORE).toBe(75);
    expect(parseOrThrow(RecordSessionBody, { sessionId: 's', score: 80, eventId: 'e' }).score).toBe(80);
    const payout = parseOrThrow(InitiatePayoutBody, {
      sessionId: 's',
      rank: 1,
      amountUsdc: '12.50',
      destinationAddress: '0x' + 'a'.repeat(40),
      eventId: 'e',
    });
    expect(payout.rank).toBe(1);
    expect(() =>
      parseOrThrow(InitiatePayoutBody, {
        sessionId: 's',
        rank: 1,
        amountUsdc: 'not-a-number',
        destinationAddress: 'nope',
        eventId: 'e',
      }),
    ).toThrow(ValidationError);
    expect(parseOrThrow(UsdcSettlementWebhook, {
      providerPayoutId: 'p',
      fabricEventId: 'f',
      status: 'confirmed',
    }).status).toBe('confirmed');
  });

  it('parses mybrotherskeeper bodies', () => {
    expect(REDEMPTION_TIERS.gold).toBe(5000);
    expect(parseOrThrow(RedeemTierBody, { tier: 'silver', eventId: 'e' }).tier).toBe('silver');
    const w = parseOrThrow(WearableWebhookBody, {
      batchId: 'b',
      provider: 'terra',
      user: { externalUserId: 'u' },
      data: [{ steps: 100, recordedAt: 1 }],
    });
    expect(w.data?.[0]?.steps).toBe(100);
  });
});
