import type { FastifyInstance } from 'fastify';
import { memberOriginAuth } from '../../middleware/origin-auth.js';
import { idempotency, runIdempotent } from '../../middleware/idempotency.js';
import { getContracts } from '../../fabric/contracts.js';
import { parseOrThrow } from '../../schemas/common.js';
import { ConsentScopeQuery, SetConsentBody } from '../../schemas/centuries-mutual.js';
import type { SetConsentBody as SetBody } from '../../schemas/centuries-mutual.js';

/**
 * centuries-mutual/consent — ConsentContract (existing chaincode).
 * Members read/update their own consent flags.
 */
export async function consentRoutes(app: FastifyInstance): Promise<void> {
  const contracts = getContracts();

  app.get('/', { preHandler: memberOriginAuth('centuries-mutual') }, async (req) => {
    const { scope } = parseOrThrow(ConsentScopeQuery, req.query);
    return contracts.getConsent(req.auth!.memberId!, scope);
  });

  app.put(
    '/',
    {
      preHandler: [
        memberOriginAuth('centuries-mutual'),
        idempotency('cm:consent:set', (req) => (req.body as SetBody)?.eventId),
      ],
    },
    async (req, reply) => {
      const body = parseOrThrow(SetConsentBody, req.body);
      await runIdempotent(req, reply, 200, () =>
        contracts.setConsent({
          memberId: req.auth!.memberId!,
          scope: body.scope,
          granted: body.granted,
          eventId: body.eventId,
        }),
      );
    },
  );
}
