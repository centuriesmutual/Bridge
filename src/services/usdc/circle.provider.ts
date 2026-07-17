import { randomUUID } from 'node:crypto';
import type {
  PayoutRequest,
  PayoutResult,
  PayoutWebhookEvent,
  USDCSettlementProvider,
} from './provider.interface.js';
import { loadEnv } from '../../config/env.js';
import { UpstreamError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

/**
 * Circle (Circle Internet Group) implementation of USDCSettlementProvider —
 * STUBBED.
 *
 * Provider is CONFIRMED: USDC custody/settlement is handled by Circle Internet
 * Group. DO NOT hardcode real Circle credentials — they are provisioned in
 * production via USDC_PROVIDER_API_KEY. The real integration calls Circle's
 * Payouts / Crypto Payments API; this stub simulates the flow shape so the
 * bridge is testable end-to-end.
 *
 * TODO: wire real Circle API calls + retries once production credentials exist.
 */
export class CircleUSDCProvider implements USDCSettlementProvider {
  readonly name = 'circle';

  private get apiKey(): string | undefined {
    return loadEnv().USDC_PROVIDER_API_KEY;
  }

  async createPayout(req: PayoutRequest): Promise<PayoutResult> {
    if (!this.apiKey || this.apiKey.startsWith('TODO')) {
      // Guard against accidentally shipping without real credentials.
      logger.warn(
        { fabricEventId: req.fabricEventId },
        'CircleUSDCProvider running in stub mode (no real API key configured)',
      );
    }
    // TODO: POST {USDC_PROVIDER_API_BASE}/v1/... with Authorization: Bearer <key>
    // and Idempotency-Key: req.idempotencyKey ?? req.fabricEventId.
    // For now, simulate an accepted-but-not-yet-confirmed payout.
    try {
      return {
        providerPayoutId: `circle_${randomUUID()}`,
        status: 'submitted',
      };
    } catch (err) {
      throw new UpstreamError('Circle payout creation failed.', {
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async getPayoutStatus(providerPayoutId: string): Promise<PayoutResult> {
    // TODO: GET {USDC_PROVIDER_API_BASE}/v1/payouts/{id}
    return { providerPayoutId, status: 'pending' };
  }

  parseWebhook(payload: unknown): PayoutWebhookEvent {
    // TODO: map Circle's actual webhook envelope. This shape is a placeholder.
    const p = payload as Record<string, unknown>;
    const statusMap: Record<string, PayoutWebhookEvent['status']> = {
      complete: 'confirmed',
      confirmed: 'confirmed',
      failed: 'failed',
      pending: 'pending',
    };
    const rawStatus = String(p?.status ?? 'pending');
    return {
      providerPayoutId: String(p?.id ?? ''),
      fabricEventId: String(p?.fabricEventId ?? p?.idempotencyKey ?? ''),
      status: statusMap[rawStatus] ?? 'pending',
      publicChainTxHash:
        typeof p?.txHash === 'string' ? p.txHash : undefined,
    };
  }
}
