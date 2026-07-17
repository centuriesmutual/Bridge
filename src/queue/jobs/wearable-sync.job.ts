import type { Job } from 'bullmq';
import { getContracts } from '../../fabric/contracts.js';
import { scopedMemberId } from '../../config/origins.js';
import { logger } from '../../lib/logger.js';
import type { WearableSyncJob } from '../queues.js';

/**
 * Processor for wearable sync batches.
 *
 * Calls WalkToEarnContract.RecordActivityEvent per normalized sample.
 * PENDING: WalkToEarnContract is not yet built in centuries-chaincode, so in
 * production these jobs will fail (and retry/dead-letter) until it ships. The
 * processing logic is written now so it works the moment the contract lands.
 */
export async function processWearableSync(job: Job<WearableSyncJob>): Promise<void> {
  const contracts = getContracts();
  const { samples } = job.data;
  for (const sample of samples) {
    await contracts.recordActivityEvent({
      memberId: scopedMemberId('mybrotherskeeper', sample.externalUserId),
      batchId: sample.batchId,
      steps: sample.steps,
      recordedAt: sample.recordedAt,
    });
  }
  logger.info({ jobId: job.id, count: samples.length }, 'Processed wearable sync batch');
}
