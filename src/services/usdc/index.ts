import type {
  PayoutRequest,
  PayoutResult,
  PayoutWebhookEvent,
  USDCSettlementProvider,
} from './provider.interface.js';
import { CircleUSDCProvider } from './circle.provider.js';
import { loadEnv } from '../../config/env.js';
import { randomUUID } from 'node:crypto';

/**
 * In-memory mock provider for development/tests. Confirms payouts instantly
 * with a fake tx hash. Never used when USDC_PROVIDER=circle.
 */
export class MockUSDCProvider implements USDCSettlementProvider {
  readonly name = 'mock';

  async createPayout(req: PayoutRequest): Promise<PayoutResult> {
    return {
      providerPayoutId: `mock_${randomUUID()}`,
      status: 'confirmed',
      publicChainTxHash: `0xmock${req.fabricEventId}`,
    };
  }

  async getPayoutStatus(providerPayoutId: string): Promise<PayoutResult> {
    return { providerPayoutId, status: 'confirmed', publicChainTxHash: `0xmock_${providerPayoutId}` };
  }

  parseWebhook(payload: unknown): PayoutWebhookEvent {
    const p = (payload ?? {}) as Record<string, unknown>;
    return {
      providerPayoutId: String(p.providerPayoutId ?? ''),
      fabricEventId: String(p.fabricEventId ?? ''),
      status: 'confirmed',
      publicChainTxHash: String(p.publicChainTxHash ?? `0xmock_${String(p.fabricEventId ?? '')}`),
    };
  }
}

let provider: USDCSettlementProvider | null = null;

export function getUsdcProvider(): USDCSettlementProvider {
  if (provider) return provider;
  const env = loadEnv();
  provider = env.USDC_PROVIDER === 'circle' ? new CircleUSDCProvider() : new MockUSDCProvider();
  return provider;
}

export function setUsdcProvider(instance: USDCSettlementProvider): void {
  provider = instance;
}

export type {
  USDCSettlementProvider,
  PayoutRequest,
  PayoutResult,
  PayoutWebhookEvent,
} from './provider.interface.js';
