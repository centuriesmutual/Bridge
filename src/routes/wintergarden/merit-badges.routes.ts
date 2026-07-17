import type { FastifyInstance } from 'fastify';
import { memberOriginAuth } from '../../middleware/origin-auth.js';
import { pendingChaincode } from '../_pending.js';

/**
 * wintergarden/merit-badges — WintergardenContract.
 * PENDING: WintergardenContract not yet built in centuries-chaincode.
 *
 * Non-transferable, permanent, publicly-verifiable merit badges per qualifying
 * session (score >= 75). Fabric holds the audit record; the badge itself MAY
 * also be a public-chain NFT — TODO: confirm whether badges mint on a public
 * chain in addition to the Fabric record.
 */
export async function wintergardenMeritBadgeRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/members/:memberId',
    { preHandler: memberOriginAuth('wintergarden') },
    async () => pendingChaincode('WintergardenContract', "Listing a member's merit badges"),
  );

  app.get(
    '/:sessionId',
    { preHandler: memberOriginAuth('wintergarden') },
    async () => pendingChaincode('WintergardenContract', 'Reading a merit badge'),
  );
}
