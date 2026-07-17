import type { FastifyInstance } from 'fastify';
import { memberOriginAuth } from '../../middleware/origin-auth.js';
import { idempotency } from '../../middleware/idempotency.js';
import { pendingChaincode } from '../_pending.js';

/**
 * mybrotherskeeper/walk-to-earn — WalkToEarnContract.
 * PENDING: WalkToEarnContract not yet built in centuries-chaincode.
 * Internal points ledger. Tiers: Bronze 500 / Silver 2,000 / Gold 5,000.
 */
export async function walkToEarnRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/members/:memberId/points',
    { preHandler: memberOriginAuth('mybrotherskeeper') },
    async () => pendingChaincode('WalkToEarnContract', 'Reading walk-to-earn points'),
  );

  app.post(
    '/redeem',
    {
      preHandler: [
        memberOriginAuth('mybrotherskeeper'),
        idempotency('mbk:redeem', (req) => (req.body as { eventId?: string })?.eventId),
      ],
    },
    async () => pendingChaincode('WalkToEarnContract', 'Redeeming a reward tier'),
  );
}
