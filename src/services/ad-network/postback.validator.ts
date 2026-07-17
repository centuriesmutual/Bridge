import { z } from 'zod';
import { verifyHmac } from '../../lib/hmac.js';
import { ValidationError } from '../../lib/errors.js';

/**
 * Validates signed ad-delivery postbacks from ad-network partners
 * (Medicare Reviews "Sponsored Advertising Engagement Wallet").
 *
 * Ad networks retry deliveries, so `adDeliveryId` is the idempotency key and
 * MUST be deduped upstream (see idempotency middleware) before crediting.
 *
 * Signature verification uses the raw request body (not the parsed object) —
 * re-serialization could change bytes and break the HMAC.
 */

export const AdPostbackSchema = z.object({
  /** Unique per delivery; the idempotency key. Ad networks retry. */
  adDeliveryId: z.string().min(1),
  adId: z.string().min(1),
  memberId: z.string().min(1),
  /** Epoch ms when the sponsored ad was delivered. */
  deliveredAt: z.coerce.number().int().positive(),
});

export type AdPostback = z.infer<typeof AdPostbackSchema>;

export function parseAdPostback(payload: unknown): AdPostback {
  const parsed = AdPostbackSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('Malformed ad-network postback.', parsed.error.flatten());
  }
  return parsed.data;
}

/**
 * Verify the ad network's HMAC signature over the raw body.
 * Returns true when valid; callers must reject on false.
 */
export function verifyAdPostbackSignature(
  secret: string,
  rawBody: string | Buffer,
  signature: string,
): boolean {
  return verifyHmac(secret, rawBody, signature);
}
