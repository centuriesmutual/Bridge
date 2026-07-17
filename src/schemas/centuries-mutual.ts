import { z } from 'zod';
import { EventId, MemberId, PositiveAmount } from './common.js';

/**
 * Zod schemas for centuries-mutual routes.
 * Rewards Wallet credits are an INTERNAL ledger balance (CM_CREDIT), not crypto.
 */

// ---- Rewards ---------------------------------------------------------------
export const CreditRewardBody = z.object({
  amount: PositiveAmount,
  reason: z.string().min(1).max(280),
  eventId: EventId,
});
export type CreditRewardBody = z.infer<typeof CreditRewardBody>;

export const RedeemRewardBody = z.object({
  amount: PositiveAmount,
  rewardSku: z.string().min(1).max(120),
  eventId: EventId,
});
export type RedeemRewardBody = z.infer<typeof RedeemRewardBody>;

export const MemberIdParam = z.object({ memberId: MemberId });

// ---- Consent ---------------------------------------------------------------
export const ConsentScopeQuery = z.object({ scope: z.string().min(1).max(120) });

export const SetConsentBody = z.object({
  scope: z.string().min(1).max(120),
  granted: z.boolean(),
  eventId: EventId,
});
export type SetConsentBody = z.infer<typeof SetConsentBody>;

// ---- Enrollment ------------------------------------------------------------
export const EnrollmentMilestoneBody = z.object({
  milestone: z.string().min(1).max(120),
  eventId: EventId,
});
export type EnrollmentMilestoneBody = z.infer<typeof EnrollmentMilestoneBody>;

// ---- Wellness --------------------------------------------------------------
export const WellnessActivityBody = z.object({
  activityType: z.string().min(1).max(120),
  value: z.number().finite(),
  eventId: EventId,
});
export type WellnessActivityBody = z.infer<typeof WellnessActivityBody>;
