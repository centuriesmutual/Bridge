import type { FastifyInstance } from 'fastify';
import { memberOriginAuth } from '../../middleware/origin-auth.js';
import { apiKeyScopes } from '../../middleware/api-key.js';
import { idempotency, runIdempotent } from '../../middleware/idempotency.js';
import { getContracts } from '../../fabric/contracts.js';
import { scopedMemberId } from '../../config/origins.js';
import { parseOrThrow } from '../../schemas/common.js';
import { EnrollmentMilestoneBody, MemberIdParam } from '../../schemas/centuries-mutual.js';
import type { EnrollmentMilestoneBody as MilestoneBody } from '../../schemas/centuries-mutual.js';

/**
 * centuries-mutual/enrollment — EnrollmentContract (existing chaincode).
 * Members read their enrollment state; enrollment milestones are recorded
 * server-to-server (API key `enrollment:write`).
 */
export async function enrollmentRoutes(app: FastifyInstance): Promise<void> {
  const contracts = getContracts();

  app.get('/', { preHandler: memberOriginAuth('centuries-mutual') }, async (req) => {
    return contracts.getEnrollment(req.auth!.memberId!);
  });

  app.post(
    '/members/:memberId/milestone',
    {
      preHandler: [
        apiKeyScopes(['enrollment:write']),
        idempotency('cm:enrollment:milestone', (req) => (req.body as MilestoneBody)?.eventId),
      ],
    },
    async (req, reply) => {
      const { memberId: rawMemberId } = parseOrThrow(MemberIdParam, req.params);
      const body = parseOrThrow(EnrollmentMilestoneBody, req.body);
      await runIdempotent(req, reply, 201, () =>
        contracts.recordEnrollmentMilestone({
          memberId: scopedMemberId('centuries-mutual', rawMemberId),
          milestone: body.milestone,
          eventId: body.eventId,
        }),
      );
    },
  );
}
