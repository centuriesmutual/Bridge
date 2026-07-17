import type { FastifyInstance } from 'fastify';
import { webhookSignature } from '../../middleware/webhook-signature.js';
import { idempotency } from '../../middleware/idempotency.js';
import { pendingChaincode } from '../_pending.js';
import { normalizeAggregatorWebhook } from '../../services/wearables/aggregator.client.js';

/**
 * mybrotherskeeper/wearable-webhook — ingest wearable activity via a
 * third-party aggregator, then (once chaincode ships) enqueue a job that calls
 * WalkToEarnContract.RecordActivityEvent. Ingestion is asynchronous because
 * Fabric commits are not instant.
 *
 * PENDING: WalkToEarnContract not yet built in centuries-chaincode.
 * Signature verification, payload normalization, and dedupe ARE wired; when
 * the contract lands, replace the 501 with `enqueueWearableSync(...)` (see
 * src/queue/jobs/wearable-sync.job.ts) and return 202 Accepted.
 */
export async function wearableWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/',
    {
      preHandler: [
        webhookSignature('wearable'),
        // Dedupe by the aggregator's batch id — aggregators retry deliveries.
        idempotency('mbk:wearable', (req) => (req.body as { batchId?: string })?.batchId),
      ],
    },
    async (req) => {
      // Signature verified; normalize to confirm the payload is well-formed.
      normalizeAggregatorWebhook(req.body);
      // TODO(centuries-chaincode): once WalkToEarnContract exists:
      //   const samples = normalizeAggregatorWebhook(req.body);
      //   await enqueueWearableSync({ property: 'mybrotherskeeper', samples });
      //   return reply.code(202).send({ accepted: true });
      return pendingChaincode('WalkToEarnContract', 'Recording wearable activity');
    },
  );
}
