import type { FastifyInstance } from 'fastify';
import { memberOriginAuth } from '../../middleware/origin-auth.js';
import { apiKeyScopes } from '../../middleware/api-key.js';
import { idempotency, runIdempotent } from '../../middleware/idempotency.js';
import { getContracts } from '../../fabric/contracts.js';
import { scopedMemberId } from '../../config/origins.js';
import { parseOrThrow } from '../../schemas/common.js';
import { MemberIdParam, WellnessActivityBody } from '../../schemas/centuries-mutual.js';
import type { WellnessActivityBody as ActivityBody } from '../../schemas/centuries-mutual.js';

/**
 * centuries-mutual/wellness — WellnessContract (existing chaincode).
 * Members read their wellness status; activities are recorded
 * server-to-server (API key `wellness:write`).
 */
export async function wellnessRoutes(app: FastifyInstance): Promise<void> {
  const contracts = getContracts();

  app.get('/', { preHandler: memberOriginAuth('centuries-mutual') }, async (req) => {
    return contracts.getWellnessStatus(req.auth!.memberId!);
  });

  app.post(
    '/members/:memberId/activity',
    {
      preHandler: [
        apiKeyScopes(['wellness:write']),
        idempotency('cm:wellness:activity', (req) => (req.body as ActivityBody)?.eventId),
      ],
    },
    async (req, reply) => {
      const { memberId: rawMemberId } = parseOrThrow(MemberIdParam, req.params);
      const body = parseOrThrow(WellnessActivityBody, req.body);
      await runIdempotent(req, reply, 201, () =>
        contracts.recordWellnessActivity({
          memberId: scopedMemberId('centuries-mutual', rawMemberId),
          activityType: body.activityType,
          value: body.value,
          eventId: body.eventId,
        }),
      );
    },
  );
}
