import { createHash, randomUUID } from 'node:crypto';
import type {
  PayoutRequest,
  PayoutResult,
  PayoutStatus,
  PayoutWebhookEvent,
  USDCSettlementProvider,
} from './provider.interface.js';
import { loadEnv } from '../../config/env.js';
import { UpstreamError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

/**
 * Circle (Circle Internet Group) implementation of USDCSettlementProvider.
 *
 * Provider is CONFIRMED. USDC payouts to a member's external wallet are made
 * via Circle's Transfers API (`POST /v1/transfers`): funds move from a Circle
 * Mint source wallet to a blockchain address. Fabric never moves USDC — it
 * only records the audit event and, later, the settled public-chain tx hash.
 *
 * SECURITY: the API key is the full Circle key string
 * ("TEST_API_KEY:<id>:<secret>" in sandbox) and is passed as a Bearer token.
 * It is read from env / injected config and never logged.
 *
 * If no API key is configured the provider runs in STUB mode (returns a
 * simulated "submitted" result) so local/dev flows work without credentials.
 */

export interface CircleProviderConfig {
  apiKey?: string;
  apiBase?: string;
  sourceWalletId?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/** Map our settlement-chain strings to Circle chain codes. */
const CIRCLE_CHAIN_CODES: Record<string, string> = {
  base: 'BASE',
  'base-sepolia': 'BASE',
  eth: 'ETH',
  ethereum: 'ETH',
  'ethereum-sepolia': 'ETH',
  sepolia: 'ETH',
  sol: 'SOL',
  solana: 'SOL',
  'solana-devnet': 'SOL',
  matic: 'MATIC',
  polygon: 'MATIC',
  avax: 'AVAX',
  avalanche: 'AVAX',
  arb: 'ARB',
  arbitrum: 'ARB',
  op: 'OP',
  optimism: 'OP',
};

function toCircleChain(chain: string): string {
  const key = chain.trim().toLowerCase();
  const mapped = CIRCLE_CHAIN_CODES[key];
  if (mapped) return mapped;
  // Fall back to the uppercased first segment (e.g. "base-sepolia" -> "BASE").
  return (key.split('-')[0] ?? key).toUpperCase();
}

/** Circle transfer status -> our normalized status. */
function mapStatus(circleStatus: string, whenPending: PayoutStatus): PayoutStatus {
  if (circleStatus === 'complete') return 'confirmed';
  if (circleStatus === 'failed') return 'failed';
  return whenPending;
}

/**
 * Deterministic UUIDv5-shaped id derived from a seed, so retries for the same
 * fabricEventId reuse the same Circle idempotencyKey (Circle requires a UUID).
 */
function deterministicUuid(seed: string): string {
  const h = createHash('sha1').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

interface CircleTransferData {
  id: string;
  status: string;
  transactionHash?: string;
  idempotencyKey?: string;
}

export class CircleUSDCProvider implements USDCSettlementProvider {
  readonly name = 'circle';
  private readonly config: CircleProviderConfig;

  constructor(config: CircleProviderConfig = {}) {
    this.config = config;
  }

  private get apiKey(): string | undefined {
    return this.config.apiKey ?? loadEnv().USDC_PROVIDER_API_KEY;
  }

  private get apiBase(): string {
    return this.config.apiBase ?? loadEnv().USDC_PROVIDER_API_BASE;
  }

  private get sourceWalletId(): string | undefined {
    return this.config.sourceWalletId ?? loadEnv().USDC_SOURCE_WALLET_ID;
  }

  private get fetchImpl(): typeof fetch {
    return this.config.fetchImpl ?? fetch;
  }

  private isConfigured(): boolean {
    const key = this.apiKey;
    return !!key && !key.startsWith('set-in') && !key.startsWith('TODO');
  }

  private async call<T>(path: string, init: RequestInit): Promise<T> {
    const res = await this.fetchImpl(`${this.apiBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      // Body may contain Circle's error code/message; do not include auth headers.
      let detail: unknown;
      try {
        detail = await res.json();
      } catch {
        detail = undefined;
      }
      throw new UpstreamError(`Circle API ${init.method ?? 'GET'} ${path} failed (${res.status}).`, {
        status: res.status,
        detail,
      });
    }
    return (await res.json()) as T;
  }

  async createPayout(req: PayoutRequest): Promise<PayoutResult> {
    if (!this.isConfigured()) {
      logger.warn(
        { fabricEventId: req.fabricEventId },
        'CircleUSDCProvider running in stub mode (no API key configured)',
      );
      return { providerPayoutId: `circle_stub_${randomUUID()}`, status: 'submitted' };
    }
    if (!this.sourceWalletId) {
      throw new UpstreamError('Circle source wallet id is not configured (USDC_SOURCE_WALLET_ID).');
    }
    const idempotencyKey = req.idempotencyKey ?? deterministicUuid(req.fabricEventId);
    const body = {
      idempotencyKey,
      source: { type: 'wallet', id: this.sourceWalletId },
      destination: {
        type: 'blockchain',
        address: req.destinationAddress,
        chain: toCircleChain(req.chain),
      },
      amount: { amount: req.amountUsdc, currency: 'USD' },
    };
    const json = await this.call<{ data: CircleTransferData }>('/v1/transfers', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data = json.data;
    return {
      providerPayoutId: data.id,
      status: mapStatus(data.status, 'submitted'),
      ...(data.transactionHash ? { publicChainTxHash: data.transactionHash } : {}),
    };
  }

  async getPayoutStatus(providerPayoutId: string): Promise<PayoutResult> {
    if (!this.isConfigured()) {
      return { providerPayoutId, status: 'pending' };
    }
    const json = await this.call<{ data: CircleTransferData }>(
      `/v1/transfers/${encodeURIComponent(providerPayoutId)}`,
      { method: 'GET' },
    );
    const data = json.data;
    return {
      providerPayoutId: data.id,
      status: mapStatus(data.status, 'pending'),
      ...(data.transactionHash ? { publicChainTxHash: data.transactionHash } : {}),
    };
  }

  parseWebhook(payload: unknown): PayoutWebhookEvent {
    // Circle delivers notifications either directly or SNS-wrapped in `Message`.
    let p = (payload ?? {}) as Record<string, unknown>;
    if (typeof p.Message === 'string') {
      try {
        p = JSON.parse(p.Message) as Record<string, unknown>;
      } catch {
        /* keep original */
      }
    }
    const transfer = (p.transfer ?? p) as CircleTransferData & { idempotencyKey?: string };
    return {
      providerPayoutId: String(transfer?.id ?? ''),
      // NOTE: Circle echoes our idempotencyKey, not the fabricEventId. Once the
      // Wintergarden payout flow lands, resolve fabricEventId from a stored
      // idempotencyKey -> fabricEventId map. TODO(centuries-chaincode).
      fabricEventId: String(transfer?.idempotencyKey ?? p?.fabricEventId ?? ''),
      status: mapStatus(String(transfer?.status ?? 'pending'), 'pending'),
      ...(typeof transfer?.transactionHash === 'string'
        ? { publicChainTxHash: transfer.transactionHash }
        : {}),
    };
  }
}
