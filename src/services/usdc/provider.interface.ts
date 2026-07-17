/**
 * USDCSettlementProvider — swappable custody/settlement provider abstraction.
 *
 * Fabric CANNOT custody or move real USDC. Real settlement happens on a public
 * chain via a custody provider (CONFIRMED: Circle Internet Group), kept behind
 * this interface so the provider stays swappable. The Wintergarden payout flow
 * is:
 *
 *   1. Fabric: RecordMeritEvent()          -> pending audit record
 *   2. provider.createPayout()             -> real USDC settlement on-chain
 *   3. provider webhook confirms status    -> publicChainTxHash known
 *   4. Fabric: SettleMeritPayout(id, hash) -> mark settled, cross-reference
 */

export type PayoutStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';

export interface PayoutRequest {
  /** Fabric audit event id this settlement corresponds to (idempotency key). */
  fabricEventId: string;
  /** Member's connected external wallet address on the settlement chain. */
  destinationAddress: string;
  /** Amount in USDC, as a decimal string (e.g. "12.50"). */
  amountUsdc: string;
  /** Public chain to settle on (e.g. "base-sepolia"). */
  chain: string;
  /** Optional idempotency key forwarded to the provider. */
  idempotencyKey?: string;
}

export interface PayoutResult {
  /** Provider-side payout/transfer id. */
  providerPayoutId: string;
  status: PayoutStatus;
  /** Present once settled on-chain; used for the Fabric cross-reference. */
  publicChainTxHash?: string;
}

export interface PayoutWebhookEvent {
  providerPayoutId: string;
  fabricEventId: string;
  status: PayoutStatus;
  publicChainTxHash?: string;
}

export interface USDCSettlementProvider {
  readonly name: string;
  /** Initiate a real USDC payout to a member's external wallet. */
  createPayout(req: PayoutRequest): Promise<PayoutResult>;
  /** Poll current status of a previously-created payout. */
  getPayoutStatus(providerPayoutId: string): Promise<PayoutResult>;
  /**
   * Verify + normalize an inbound settlement webhook from the provider.
   * Signature verification of the raw body is handled by webhook middleware;
   * this parses the provider-specific payload into a common shape.
   */
  parseWebhook(payload: unknown): PayoutWebhookEvent;
}
