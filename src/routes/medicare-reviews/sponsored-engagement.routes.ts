import type { FastifyInstance } from 'fastify';
import { memberOriginAuth } from '../../middleware/origin-auth.js';
import { webhookSignature } from '../../middleware/webhook-signature.js';
import { idempotency } from '../../middleware/idempotency.js';
import { pendingChaincode } from '../_pending.js';
import { parseAdPostback } from '../../services/ad-network/postback.validator.js';

/**
 * medicare-reviews/sponsored-engagement — SponsoredEngagementContract.
 *
 * PENDING: SponsoredEngagementContract is not yet built in centuries-chaincode.
 * Auth + signature verification ARE wired (so the security layer is exercised),
 * but the ledger write returns 501 until the chaincode ships.
 */
export async function sponsoredEngagementRoutes(app: FastifyInstance): Promise<void> {
  // Member opts in/out of the Sponsored Advertising Engagement Wallet.
  app.post('/opt-in', { preHandler: memberOriginAuth('medicare-reviews') }, async () => {
    return pendingChaincode('SponsoredEngagementContract', 'Opt-in state changes');
  });

  app.get('/wallet', { preHandler: memberOriginAuth('medicare-reviews') }, async () => {
    return pendingChaincode('SponsoredEngagementContract', 'Reading the engagement wallet');
  });

  // Ad-network postback: signature verified + deduped by adDeliveryId BEFORE
  // any credit. Ad networks retry, so idempotency is mandatory.
  app.post(
    '/postback',
    {
      preHandler: [
        webhookSignature('ad-network'),
        idempotency('mr:ad-postback', (req) => {
          const body = req.body as { adDeliveryId?: string } | undefined;
          return body?.adDeliveryId;
        }),
      ],
    },
    async (req) => {
      // Signature already verified; validate the payload shape.
      parseAdPostback(req.body);
      return pendingChaincode('SponsoredEngagementContract', 'Crediting ad-delivery engagement');
    },
  );
}
