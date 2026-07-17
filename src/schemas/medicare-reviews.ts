import { z } from 'zod';
import { EventId, MemberId } from './common.js';

/**
 * Medicare Reviews "Sponsored Advertising Engagement Wallet".
 * Internal credit ledger tied to ad-delivery events — NOT crypto.
 * Blocked pending SponsoredEngagementContract in `centuries-chaincode`.
 */

export const SetOptInBody = z.object({
  optedIn: z.boolean(),
  eventId: EventId,
});
export type SetOptInBody = z.infer<typeof SetOptInBody>;

export const MemberIdParam = z.object({ memberId: MemberId });

// Inbound ad-network postback (also validated in postback.validator.ts).
export const SponsoredEngagementPostback = z.object({
  adDeliveryId: z.string().min(1),
  adId: z.string().min(1),
  memberId: MemberId,
  deliveredAt: z.coerce.number().int().positive(),
});
export type SponsoredEngagementPostback = z.infer<typeof SponsoredEngagementPostback>;
