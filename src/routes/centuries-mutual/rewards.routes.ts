import type { FastifyInstance } from 'fastify';
import { memberOriginAuth } from '../../middleware/origin-auth.js';
import { apiKeyScopes } from '../../middleware/api-key.js';
import { oauthScopes } from '../../middleware/oauth.js';
import { idempotency, runIdempotent } from '../../middleware/idempotency.js';
import { getContracts } from '../../fabric/contracts.js';
import { scopedMemberId } from '../../config/origins.js';
import { parseOrThrow } from '../../schemas/common.js';
import {
  ActivateWalletBody,
  CreditRewardBody,
  MemberIdParam,
  RedeemRewardBody,
} from '../../schemas/centuries-mutual.js';
import type {
  ActivateWalletBody as ActivateBody,
  CreditRewardBody as CreditBody,
  RedeemRewardBody as RedeemBody,
} from '../../schemas/centuries-mutual.js';

/**
 * centuries-mutual/rewards — RewardsContract (existing chaincode).
 * Internal Rewards Wallet balance (CM_CREDIT); not crypto.
 *
 * Auth surfaces:
 *   - Member browser (Supabase JWT + origin) reads/redeems their own balance.
 *   - Developer Portal partner (OAuth `rewards:read`) reads a specific member.
 *   - Server-to-server (API key `rewards:write`) credits rewards.
 */
export async function rewardsRoutes(app: FastifyInstance): Promise<void> {
  const contracts = getContracts();

  // ---- Member: own wallet status (inactive until admin activates) ----------
  app.get(
    '/wallet',
    { preHandler: memberOriginAuth('centuries-mutual') },
    async (req) => contracts.getWalletStatus(req.auth!.memberId!),
  );

  // ---- Admin: activate a member's wallet after ACA enrollment (idempotent) -
  // Server-to-server call from the (future) admin page's backend.
  app.post(
    '/members/:memberId/activate',
    {
      preHandler: [
        apiKeyScopes(['rewards:admin']),
        idempotency('cm:rewards:activate', (req) => (req.body as ActivateBody)?.eventId),
      ],
    },
    async (req, reply) => {
      const { memberId: rawMemberId } = parseOrThrow(MemberIdParam, req.params);
      const body = parseOrThrow(ActivateWalletBody, req.body);
      await runIdempotent(req, reply, 200, () =>
        contracts.activateWallet({
          memberId: scopedMemberId('centuries-mutual', rawMemberId),
          activatedBy: body.activatedBy,
          eventId: body.eventId,
        }),
      );
    },
  );

  // ---- Member: own balance -------------------------------------------------
  app.get(
    '/balance',
    { preHandler: memberOriginAuth('centuries-mutual') },
    async (req) => {
      const memberId = req.auth!.memberId!;
      return contracts.getRewardsBalance(memberId);
    },
  );

  // ---- Member: own history -------------------------------------------------
  app.get(
    '/history',
    { preHandler: memberOriginAuth('centuries-mutual') },
    async (req) => {
      const memberId = req.auth!.memberId!;
      return { memberId, entries: await contracts.getRewardsHistory(memberId) };
    },
  );

  // ---- Member: redeem own rewards (idempotent) -----------------------------
  app.post(
    '/redeem',
    {
      preHandler: [
        memberOriginAuth('centuries-mutual'),
        idempotency('cm:rewards:redeem', (req) => (req.body as RedeemBody)?.eventId),
      ],
    },
    async (req, reply) => {
      const body = parseOrThrow(RedeemRewardBody, req.body);
      const memberId = req.auth!.memberId!;
      await runIdempotent(req, reply, 200, () =>
        contracts.redeemReward({
          memberId,
          amount: body.amount,
          rewardSku: body.rewardSku,
          eventId: body.eventId,
        }),
      );
    },
  );

  // ---- System/partner: credit rewards (idempotent) -------------------------
  app.post(
    '/members/:memberId/credit',
    {
      preHandler: [
        apiKeyScopes(['rewards:write']),
        idempotency('cm:rewards:credit', (req) => (req.body as CreditBody)?.eventId),
      ],
    },
    async (req, reply) => {
      const { memberId: rawMemberId } = parseOrThrow(MemberIdParam, req.params);
      const body = parseOrThrow(CreditRewardBody, req.body);
      const memberId = scopedMemberId('centuries-mutual', rawMemberId);
      await runIdempotent(req, reply, 201, () =>
        contracts.creditReward({
          memberId,
          amount: body.amount,
          reason: body.reason,
          eventId: body.eventId,
        }),
      );
    },
  );

  // ---- Partner (Developer Portal): read a specific member's balance --------
  app.get(
    '/members/:memberId/balance',
    { preHandler: oauthScopes(['rewards:read']) },
    async (req) => {
      const { memberId: rawMemberId } = parseOrThrow(MemberIdParam, req.params);
      return contracts.getRewardsBalance(scopedMemberId('centuries-mutual', rawMemberId));
    },
  );
}
