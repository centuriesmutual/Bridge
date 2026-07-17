import type { Job } from 'bullmq';
import { getContracts } from '../../fabric/contracts.js';
import { scopedMemberId } from '../../config/origins.js';
import { logger } from '../../lib/logger.js';
import type { AdPostbackJob } from '../queues.js';

/**
 * Processor for ad-delivery postbacks.
 *
 * Calls SponsoredEngagementContract.RecordAdDeliveryCredit. Deduping happens at
 * ingestion (idempotency middleware) AND via the BullMQ jobId=adDeliveryId, so
 * ad-network retries never double-credit.
 *
 * PENDING: SponsoredEngagementContract not yet built in centuries-chaincode.
 */
export async function processAdPostback(job: Job<AdPostbackJob>): Promise<void> {
  const contracts = getContracts();
  const { postback } = job.data;
  await contracts.recordAdDeliveryCredit({
    memberId: scopedMemberId('medicare-reviews', postback.memberId),
    adDeliveryId: postback.adDeliveryId,
    adId: postback.adId,
    creditedAt: postback.deliveredAt,
  });
  logger.info({ jobId: job.id, adDeliveryId: postback.adDeliveryId }, 'Processed ad postback');
}
