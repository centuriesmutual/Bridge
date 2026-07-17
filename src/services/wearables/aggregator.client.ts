import { z } from 'zod';
import { loadEnv } from '../../config/env.js';
import { ValidationError } from '../../lib/errors.js';

/**
 * Wearable data aggregator client — STUBBED against a GENERIC shape.
 *
 * MyBrothersKeeper advertises Apple Watch, Garmin, Fitbit, Oura, Samsung,
 * Whoop, Polar, Coros, Amazfit, Suunto, Huawei. That breadth is almost
 * certainly served by ONE aggregator (Terra / Spike / Vital / ...), not eleven
 * direct integrations.
 *
 * TODO: confirm actual vendor and replace this generic envelope with the
 * vendor's real webhook/payload format. We deliberately do NOT guess a
 * specific vendor's field names here.
 */

/** Generic normalized activity sample the rest of the bridge understands. */
export interface NormalizedActivitySample {
  externalUserId: string;
  provider: string;
  batchId: string;
  steps: number;
  recordedAt: number; // epoch ms
}

/**
 * Generic aggregator webhook envelope. Intentionally permissive; a real vendor
 * schema will replace this once confirmed.
 */
export const AggregatorWebhookSchema = z.object({
  // Aggregator-assigned id for the sync batch — used as the idempotency key.
  batchId: z.string().min(1),
  provider: z.string().min(1),
  user: z.object({
    externalUserId: z.string().min(1),
  }),
  data: z
    .array(
      z.object({
        steps: z.number().int().nonnegative(),
        recordedAt: z.union([z.number(), z.string()]),
      }),
    )
    .default([]),
});

export type AggregatorWebhook = z.infer<typeof AggregatorWebhookSchema>;

export function normalizeAggregatorWebhook(payload: unknown): NormalizedActivitySample[] {
  const parsed = AggregatorWebhookSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('Malformed aggregator webhook payload.', parsed.error.flatten());
  }
  const body = parsed.data;
  return body.data.map((sample) => ({
    externalUserId: body.user.externalUserId,
    provider: body.provider,
    batchId: body.batchId,
    steps: sample.steps,
    recordedAt:
      typeof sample.recordedAt === 'number'
        ? sample.recordedAt
        : Date.parse(sample.recordedAt),
  }));
}

/**
 * Thin client for pulling data from the aggregator (e.g. backfills). Stubbed.
 */
export class WearableAggregatorClient {
  private get baseUrl(): string | undefined {
    return loadEnv().WEARABLE_AGGREGATOR_API_BASE;
  }

  // TODO: confirm vendor auth + endpoints. Placeholder signature only.
  async fetchUserActivity(_externalUserId: string): Promise<NormalizedActivitySample[]> {
    if (!this.baseUrl || this.baseUrl.includes('TODO')) {
      // Not configured; callers should rely on webhook push in stub mode.
      return [];
    }
    // TODO: GET {WEARABLE_AGGREGATOR_API_BASE}/... with vendor auth header.
    return [];
  }
}
