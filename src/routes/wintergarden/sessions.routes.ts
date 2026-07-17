import type { FastifyInstance } from 'fastify';
import { memberOriginAuth } from '../../middleware/origin-auth.js';
import { idempotency } from '../../middleware/idempotency.js';
import { pendingChaincode } from '../_pending.js';

/**
 * wintergarden/sessions — WintergardenContract.
 * PENDING: WintergardenContract not yet built in centuries-chaincode.
 * Records session scores (audit). Merit badge qualifies at score >= 75.
 */
export async function wintergardenSessionsRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/',
    {
      preHandler: [
        memberOriginAuth('wintergarden'),
        idempotency('wg:session', (req) => (req.body as { eventId?: string })?.eventId),
      ],
    },
    async () => pendingChaincode('WintergardenContract', 'Recording a scored session'),
  );

  app.get(
    '/:sessionId',
    { preHandler: memberOriginAuth('wintergarden') },
    async () => pendingChaincode('WintergardenContract', 'Reading a session'),
  );
}
