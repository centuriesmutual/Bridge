import { z } from 'zod';
import { EventId, MemberId } from './common.js';

/**
 * My Brother's Keeper "Walk-to-Earn" points.
 * Internal points ledger (no confirmed on-chain component).
 * Redemption tiers: Bronze 500 / Silver 2,000 / Gold 5,000.
 * Blocked pending WalkToEarnContract in `centuries-chaincode`.
 */

export const REDEMPTION_TIERS = {
  bronze: 500,
  silver: 2000,
  gold: 5000,
} as const;

export type RedemptionTier = keyof typeof REDEMPTION_TIERS;

export const MemberIdParam = z.object({ memberId: MemberId });

export const RedeemTierBody = z.object({
  tier: z.enum(['bronze', 'silver', 'gold']),
  eventId: EventId,
});
export type RedeemTierBody = z.infer<typeof RedeemTierBody>;

// Generic aggregator webhook (real vendor shape TBD — see aggregator.client.ts).
export const WearableWebhookBody = z.object({
  batchId: z.string().min(1),
  provider: z.string().min(1),
  user: z.object({ externalUserId: z.string().min(1) }),
  data: z
    .array(
      z.object({
        steps: z.number().int().nonnegative(),
        recordedAt: z.union([z.number(), z.string()]),
      }),
    )
    .default([]),
});
export type WearableWebhookBody = z.infer<typeof WearableWebhookBody>;

export { EventId };
