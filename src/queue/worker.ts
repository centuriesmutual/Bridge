import '../config/loadDotenv.js';
import { Worker, type Job } from 'bullmq';
import { bullConnection } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import {
  AD_POSTBACK_QUEUE,
  DEFAULT_JOB_OPTS,
  WEARABLE_SYNC_QUEUE,
  getDeadLetterQueue,
  type AdPostbackJob,
  type WearableSyncJob,
} from './queues.js';
import { processWearableSync } from './jobs/wearable-sync.job.js';
import { processAdPostback } from './jobs/ad-postback.job.js';

/**
 * BullMQ worker entrypoint (`npm run worker`).
 *
 * On terminal failure (attempts exhausted) a job is copied to the dead-letter
 * queue and an alerting hook fires.
 * TODO: wire alerting to the real alerting system (PagerDuty/Opsgenie/Slack).
 */

function alertDeadLetter(queue: string, job: Job | undefined, err: Error): void {
  logger.error(
    { queue, jobId: job?.id, attemptsMade: job?.attemptsMade, err: err.message },
    'Job exhausted retries -> dead-letter',
  );
  // TODO: wire to actual alerting.
}

async function toDeadLetter(queue: string, job: Job | undefined, err: Error): Promise<void> {
  if (!job) return;
  await getDeadLetterQueue().add(
    'dead',
    { queue, jobId: job.id, name: job.name, data: job.data, failedReason: err.message },
    { jobId: `${queue}:${job.id}` },
  );
  alertDeadLetter(queue, job, err);
}

export function startWorkers(): Worker[] {
  const connection = bullConnection();

  const wearableWorker = new Worker<WearableSyncJob>(WEARABLE_SYNC_QUEUE, processWearableSync, {
    connection,
  });
  const adWorker = new Worker<AdPostbackJob>(AD_POSTBACK_QUEUE, processAdPostback, {
    connection,
  });

  const maxAttempts = DEFAULT_JOB_OPTS.attempts;

  wearableWorker.on('failed', (job, err) => {
    if (job && job.attemptsMade >= maxAttempts) void toDeadLetter(WEARABLE_SYNC_QUEUE, job, err);
  });
  adWorker.on('failed', (job, err) => {
    if (job && job.attemptsMade >= maxAttempts) void toDeadLetter(AD_POSTBACK_QUEUE, job, err);
  });

  logger.info('Queue workers started');
  return [wearableWorker, adWorker];
}

// Run directly when invoked as the worker process.
if (process.argv[1] && process.argv[1].endsWith('worker.js')) {
  startWorkers();
}
