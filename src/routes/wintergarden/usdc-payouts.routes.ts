import type { FastifyInstance } from 'fastify';
import { memberOriginAuth } from '../../middleware/origin-auth.js';
import { webhookSignature } from '../../middleware/webhook-signature.js';
import { idempotency } from '../../middleware/idempotency.js';
import { pendingChaincode } from '../_pending.js';

/**
 * wintergarden/usdc-payouts — WintergardenContract + services/usdc.
 * PENDING: WintergardenContract not yet built in centuries-chaincode.
 *
 * Two-phase settlement (Fabric is AUDIT-ONLY; real USDC never moves through
 * Fabric):
 *   1. WintergardenContract.RecordMeritEvent()  -> pending audit record
 *   2. USDCSettlementProvider.createPayout()     -> real on-chain settlement
 *   3. settlement webhook confirms status        -> publicChainTxHash known
 *   4. WintergardenContract.SettleMeritPayout(fabricEventId, txHash)
 */
export async function wintergardenPayoutRoutes(app: FastifyInstance): Promise<void> {
  // Phase 1 + 2 initiation.
  app.post(
    '/',
    {
      preHandler: [
        memberOriginAuth('wintergarden'),
        idempotency('wg:payout', (req) => (req.body as { eventId?: string })?.eventId),
      ],
    },
    async () =>
      pendingChaincode('WintergardenContract', 'Initiating a USDC merit payout (record + settle)'),
  );

  // Phase 3 + 4: provider settlement webhook -> SettleMeritPayout.
  app.post(
    '/webhook',
    {
      preHandler: [
        webhookSignature('usdc'),
        idempotency('wg:usdc-webhook', (req) => {
          const body = req.body as { providerPayoutId?: string; publicChainTxHash?: string };
          return body?.publicChainTxHash ?? body?.providerPayoutId;
        }),
      ],
    },
    async () =>
      pendingChaincode('WintergardenContract', 'Confirming USDC settlement on the ledger'),
  );
}
