import { Queue } from 'bullmq';
import { bullConnection } from '../lib/redis.js';
import type { NormalizedActivitySample } from '../services/wearables/aggregator.client.js';
import type { AdPostback } from '../services/ad-network/postback.validator.js';

/**
 * BullMQ queue definitions.
 *
 * Webhook processing (wearable syncs, ad postbacks) is queued rather than run
 * synchronously because Fabric commits are not instant. Jobs retry with
 * exponential backoff and land in a dead-letter queue after max attempts.
 */

export const WEARABLE_SYNC_QUEUE = 'wearable-sync';
export const AD_POSTBACK_QUEUE = 'ad-postback';
export const DEAD_LETTER_QUEUE = 'dead-letter';

export interface WearableSyncJob {
  property: 'mybrotherskeeper';
  samples: NormalizedActivitySample[];
}

export interface AdPostbackJob {
  property: 'medicare-reviews';
  postback: AdPostback;
}

/** Shared default job options: 5 attempts, exponential backoff from 2s. */
export const DEFAULT_JOB_OPTS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: 1000,
  removeOnFail: false,
} as const;

let wearableSyncQueue: Queue<WearableSyncJob> | null = null;
let adPostbackQueue: Queue<AdPostbackJob> | null = null;
let deadLetterQueue: Queue | null = null;

export function getWearableSyncQueue(): Queue<WearableSyncJob> {
  if (!wearableSyncQueue) {
    wearableSyncQueue = new Queue<WearableSyncJob>(WEARABLE_SYNC_QUEUE, {
      connection: bullConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTS,
    });
  }
  return wearableSyncQueue;
}

export function getAdPostbackQueue(): Queue<AdPostbackJob> {
  if (!adPostbackQueue) {
    adPostbackQueue = new Queue<AdPostbackJob>(AD_POSTBACK_QUEUE, {
      connection: bullConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTS,
    });
  }
  return adPostbackQueue;
}

export function getDeadLetterQueue(): Queue {
  if (!deadLetterQueue) {
    deadLetterQueue = new Queue(DEAD_LETTER_QUEUE, { connection: bullConnection() });
  }
  return deadLetterQueue;
}

/** Enqueue a wearable sync batch. `batchId` is the idempotency/job key. */
export function enqueueWearableSync(job: WearableSyncJob, batchId: string) {
  return getWearableSyncQueue().add('sync', job, { jobId: batchId });
}

/** Enqueue an ad-delivery postback. `adDeliveryId` is the idempotency/job key. */
export function enqueueAdPostback(job: AdPostbackJob, adDeliveryId: string) {
  return getAdPostbackQueue().add('postback', job, { jobId: adDeliveryId });
}
