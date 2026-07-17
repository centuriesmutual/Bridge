import type { FastifyInstance } from 'fastify';
import { rewardsRoutes } from './centuries-mutual/rewards.routes.js';
import { consentRoutes } from './centuries-mutual/consent.routes.js';
import { enrollmentRoutes } from './centuries-mutual/enrollment.routes.js';
import { wellnessRoutes } from './centuries-mutual/wellness.routes.js';
import { sponsoredEngagementRoutes } from './medicare-reviews/sponsored-engagement.routes.js';
import { wintergardenSessionsRoutes } from './wintergarden/sessions.routes.js';
import { wintergardenMeritBadgeRoutes } from './wintergarden/merit-badges.routes.js';
import { wintergardenPayoutRoutes } from './wintergarden/usdc-payouts.routes.js';
import { walkToEarnRoutes } from './mybrotherskeeper/walk-to-earn.routes.js';
import { wearableWebhookRoutes } from './mybrotherskeeper/wearable-webhook.routes.js';

/**
 * Registers every route group under `/v1`, namespaced per property.
 * Property scoping is enforced in each route's auth preHandler + in the
 * least-privilege matrix in src/fabric/contracts.ts.
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // ---- centuries-mutual (existing chaincode; fully implemented) ------------
  await app.register(rewardsRoutes, { prefix: '/v1/centuries-mutual/rewards' });
  await app.register(consentRoutes, { prefix: '/v1/centuries-mutual/consent' });
  await app.register(enrollmentRoutes, { prefix: '/v1/centuries-mutual/enrollment' });
  await app.register(wellnessRoutes, { prefix: '/v1/centuries-mutual/wellness' });

  // ---- medicare-reviews (pending SponsoredEngagementContract) --------------
  await app.register(sponsoredEngagementRoutes, {
    prefix: '/v1/medicare-reviews/sponsored-engagement',
  });

  // ---- wintergarden (pending WintergardenContract) -------------------------
  await app.register(wintergardenSessionsRoutes, { prefix: '/v1/wintergarden/sessions' });
  await app.register(wintergardenMeritBadgeRoutes, { prefix: '/v1/wintergarden/merit-badges' });
  await app.register(wintergardenPayoutRoutes, { prefix: '/v1/wintergarden/usdc-payouts' });

  // ---- mybrotherskeeper (pending WalkToEarnContract) -----------------------
  await app.register(walkToEarnRoutes, { prefix: '/v1/mybrotherskeeper/walk-to-earn' });
  await app.register(wearableWebhookRoutes, { prefix: '/v1/mybrotherskeeper/wearable-webhook' });
}
