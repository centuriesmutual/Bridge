import { z } from 'zod';
import { EventId, MemberId } from './common.js';

/**
 * Wintergarden music scoring platform.
 * - Sessions with a score; merit badge qualifies at score >= 75.
 * - Weekly REAL USDC payouts by rank to a connected external wallet
 *   (real settlement leg + Fabric audit record).
 * Blocked pending WintergardenContract in `centuries-chaincode`.
 */

export const MERIT_BADGE_MIN_SCORE = 75;

export const RecordSessionBody = z.object({
  sessionId: z.string().min(1).max(200),
  score: z.number().min(0).max(100),
  eventId: EventId,
});
export type RecordSessionBody = z.infer<typeof RecordSessionBody>;

export const SessionIdParam = z.object({ sessionId: z.string().min(1) });
export const MemberIdParam = z.object({ memberId: MemberId });

// ---- USDC payout initiation ------------------------------------------------
// EVM address or Solana base58 address — chain confirmed at settlement time.
const WalletAddress = z
  .string()
  .min(20)
  .max(120)
  .regex(/^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/, 'Invalid wallet address');

export const InitiatePayoutBody = z.object({
  sessionId: z.string().min(1),
  rank: z.number().int().positive(),
  amountUsdc: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/, 'amountUsdc must be a decimal string, e.g. "12.50"'),
  destinationAddress: WalletAddress,
  eventId: EventId,
});
export type InitiatePayoutBody = z.infer<typeof InitiatePayoutBody>;

// Inbound USDC settlement webhook (provider-agnostic envelope).
export const UsdcSettlementWebhook = z.object({
  providerPayoutId: z.string().min(1),
  fabricEventId: z.string().min(1),
  status: z.enum(['pending', 'submitted', 'confirmed', 'failed']),
  publicChainTxHash: z.string().optional(),
});
export type UsdcSettlementWebhook = z.infer<typeof UsdcSettlementWebhook>;
