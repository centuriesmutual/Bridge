import { TextDecoder } from 'node:util';
import { getChaincodeContract } from './gateway.js';
import { ForbiddenError, LedgerError } from '../lib/errors.js';
import type { PropertyId } from '../config/origins.js';
import { logger } from '../lib/logger.js';

/**
 * Typed, least-privilege wrappers around chaincode contracts.
 *
 * SECURITY (least privilege): a property may only invoke the chaincode
 * functions listed for it in CONTRACT_PERMISSIONS. This is enforced in code
 * (see `guard()`), not merely by routing convention. A route calling a
 * function its property is not permitted to touch throws ForbiddenError before
 * any transport call is made.
 *
 * NOTE: `SponsoredEngagementContract`, `WintergardenContract`, and
 * `WalkToEarnContract` DO NOT YET EXIST in `centuries-chaincode`. Their
 * wrappers are typed here so the bridge compiles and is testable, but the
 * corresponding routes return 501 until the chaincode ships.
 */

export const CONTRACT_NAMES = [
  'RewardsContract',
  'ConsentContract',
  'EnrollmentContract',
  'WellnessContract',
  'SponsoredEngagementContract',
  'WintergardenContract',
  'WalkToEarnContract',
] as const;

export type ContractName = (typeof CONTRACT_NAMES)[number];

/** Contracts whose chaincode is not yet implemented in `centuries-chaincode`. */
export const PENDING_CONTRACTS: ReadonlySet<ContractName> = new Set([
  'SponsoredEngagementContract',
  'WintergardenContract',
  'WalkToEarnContract',
]);

/**
 * Per-property allowlist of `Contract.Function` names.
 * The bridge will refuse any invocation outside this matrix.
 */
export const CONTRACT_PERMISSIONS: Record<PropertyId, ReadonlySet<string>> = {
  'centuries-mutual': new Set([
    'RewardsContract.GetBalance',
    'RewardsContract.GetHistory',
    'RewardsContract.CreditReward',
    'RewardsContract.RedeemReward',
    'RewardsContract.GetWalletStatus',
    'RewardsContract.ActivateWallet',
    'ConsentContract.GetConsent',
    'ConsentContract.SetConsent',
    'EnrollmentContract.GetEnrollment',
    'EnrollmentContract.RecordEnrollmentMilestone',
    'WellnessContract.GetWellnessStatus',
    'WellnessContract.RecordWellnessActivity',
  ]),
  'medicare-reviews': new Set([
    'SponsoredEngagementContract.GetOptInState',
    'SponsoredEngagementContract.SetOptInState',
    'SponsoredEngagementContract.RecordAdDeliveryCredit',
  ]),
  wintergarden: new Set([
    'WintergardenContract.RecordSession',
    'WintergardenContract.GetSession',
    'WintergardenContract.IssueMeritBadge',
    'WintergardenContract.GetMeritBadges',
    'WintergardenContract.RecordMeritEvent',
    'WintergardenContract.SettleMeritPayout',
  ]),
  mybrotherskeeper: new Set([
    'WalkToEarnContract.GetPoints',
    'WalkToEarnContract.RecordActivityEvent',
    'WalkToEarnContract.RedeemTier',
  ]),
};

/**
 * Low-level chaincode transport. The gateway-backed implementation is the
 * default; tests inject a mock so routes/services are testable without a
 * running Fabric network.
 */
export interface ChaincodeTransport {
  evaluate(contract: ContractName, fn: string, args: string[]): Promise<string>;
  submit(
    contract: ContractName,
    fn: string,
    args: string[],
  ): Promise<{ result: string; txId: string }>;
}

const decoder = new TextDecoder();

/** Real transport backed by the Fabric Gateway SDK. */
export class GatewayTransport implements ChaincodeTransport {
  async evaluate(contract: ContractName, fn: string, args: string[]): Promise<string> {
    try {
      const c = await getChaincodeContract(contract);
      const bytes = await c.evaluateTransaction(fn, ...args);
      return decoder.decode(bytes);
    } catch (err) {
      throw wrapLedgerError(contract, fn, err);
    }
  }

  async submit(
    contract: ContractName,
    fn: string,
    args: string[],
  ): Promise<{ result: string; txId: string }> {
    try {
      const c = await getChaincodeContract(contract);
      const proposal = c.newProposal(fn, { arguments: args });
      const txn = await proposal.endorse();
      const commit = await txn.submit();
      const status = await commit.getStatus();
      if (!status.successful) {
        throw new LedgerError(
          `Chaincode commit failed for ${contract}.${fn} (validation code ${status.code}).`,
          { txId: status.transactionId, code: status.code },
        );
      }
      return { result: decoder.decode(txn.getResult()), txId: commit.getTransactionId() };
    } catch (err) {
      throw wrapLedgerError(contract, fn, err);
    }
  }
}

function wrapLedgerError(contract: ContractName, fn: string, err: unknown): Error {
  if (err instanceof LedgerError || err instanceof ForbiddenError) return err;
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ contract, fn, err: message }, 'Fabric transaction failed');
  return new LedgerError(`Ledger did not confirm ${contract}.${fn}.`, { reason: message });
}

/**
 * High-level, typed, property-scoped contract client.
 *
 * Every method takes the caller's `property` and is guarded against the
 * permission matrix before touching the transport.
 */
export class LedgerBridgeContracts {
  constructor(private readonly transport: ChaincodeTransport) {}

  private guard(property: PropertyId, contract: ContractName, fn: string): void {
    const key = `${contract}.${fn}`;
    const allowed = CONTRACT_PERMISSIONS[property];
    if (!allowed.has(key)) {
      throw new ForbiddenError(
        `Property "${property}" is not permitted to invoke ${key}.`,
        { property, attempted: key },
      );
    }
  }

  private evaluate(
    property: PropertyId,
    contract: ContractName,
    fn: string,
    args: string[],
  ): Promise<string> {
    this.guard(property, contract, fn);
    return this.transport.evaluate(contract, fn, args);
  }

  private submit(
    property: PropertyId,
    contract: ContractName,
    fn: string,
    args: string[],
  ): Promise<{ result: string; txId: string }> {
    this.guard(property, contract, fn);
    return this.transport.submit(contract, fn, args);
  }

  private parse<T>(raw: string): T {
    return raw ? (JSON.parse(raw) as T) : (null as unknown as T);
  }

  // ---- RewardsContract (centuries-mutual, existing) ------------------------
  //
  // Wallet lifecycle: a member's Rewards Wallet starts INACTIVE and is
  // activated by an admin (e.g. after ACA enrollment is confirmed). Balance
  // reads/credits are only meaningful once active.
  //
  // TODO(centuries-chaincode): confirm RewardsContract exposes GetWalletStatus
  // and ActivateWallet; if named differently, adjust the fn strings + the
  // CONTRACT_PERMISSIONS entries above.
  async getWalletStatus(memberId: string): Promise<WalletStatus> {
    const raw = await this.evaluate('centuries-mutual', 'RewardsContract', 'GetWalletStatus', [
      memberId,
    ]);
    return this.parse<WalletStatus>(raw);
  }

  async activateWallet(input: ActivateWalletInput): Promise<TxResult> {
    const { txId } = await this.submit('centuries-mutual', 'RewardsContract', 'ActivateWallet', [
      input.memberId,
      input.activatedBy,
      input.eventId,
    ]);
    return { txId, eventId: input.eventId };
  }

  async getRewardsBalance(memberId: string): Promise<RewardsBalance> {
    const raw = await this.evaluate('centuries-mutual', 'RewardsContract', 'GetBalance', [
      memberId,
    ]);
    return this.parse<RewardsBalance>(raw);
  }

  async getRewardsHistory(memberId: string): Promise<RewardsEntry[]> {
    const raw = await this.evaluate('centuries-mutual', 'RewardsContract', 'GetHistory', [
      memberId,
    ]);
    return this.parse<RewardsEntry[]>(raw) ?? [];
  }

  async creditReward(input: CreditRewardInput): Promise<TxResult> {
    const { txId } = await this.submit(
      'centuries-mutual',
      'RewardsContract',
      'CreditReward',
      [input.memberId, String(input.amount), input.reason, input.eventId],
    );
    return { txId, eventId: input.eventId };
  }

  async redeemReward(input: RedeemRewardInput): Promise<TxResult> {
    const { txId } = await this.submit(
      'centuries-mutual',
      'RewardsContract',
      'RedeemReward',
      [input.memberId, String(input.amount), input.rewardSku, input.eventId],
    );
    return { txId, eventId: input.eventId };
  }

  // ---- ConsentContract (centuries-mutual, existing) ------------------------
  async getConsent(memberId: string, scope: string): Promise<ConsentState> {
    const raw = await this.evaluate('centuries-mutual', 'ConsentContract', 'GetConsent', [
      memberId,
      scope,
    ]);
    return this.parse<ConsentState>(raw);
  }

  async setConsent(input: SetConsentInput): Promise<TxResult> {
    const { txId } = await this.submit('centuries-mutual', 'ConsentContract', 'SetConsent', [
      input.memberId,
      input.scope,
      String(input.granted),
      input.eventId,
    ]);
    return { txId, eventId: input.eventId };
  }

  // ---- EnrollmentContract (centuries-mutual, existing) ---------------------
  async getEnrollment(memberId: string): Promise<EnrollmentState> {
    const raw = await this.evaluate(
      'centuries-mutual',
      'EnrollmentContract',
      'GetEnrollment',
      [memberId],
    );
    return this.parse<EnrollmentState>(raw);
  }

  async recordEnrollmentMilestone(input: EnrollmentMilestoneInput): Promise<TxResult> {
    const { txId } = await this.submit(
      'centuries-mutual',
      'EnrollmentContract',
      'RecordEnrollmentMilestone',
      [input.memberId, input.milestone, input.eventId],
    );
    return { txId, eventId: input.eventId };
  }

  // ---- WellnessContract (centuries-mutual, existing) -----------------------
  async getWellnessStatus(memberId: string): Promise<WellnessState> {
    const raw = await this.evaluate(
      'centuries-mutual',
      'WellnessContract',
      'GetWellnessStatus',
      [memberId],
    );
    return this.parse<WellnessState>(raw);
  }

  async recordWellnessActivity(input: WellnessActivityInput): Promise<TxResult> {
    const { txId } = await this.submit(
      'centuries-mutual',
      'WellnessContract',
      'RecordWellnessActivity',
      [input.memberId, input.activityType, String(input.value), input.eventId],
    );
    return { txId, eventId: input.eventId };
  }

  // ---- WintergardenContract (PENDING chaincode) ----------------------------
  // Full two-phase USDC settlement audit flow. Wired but blocked until the
  // chaincode ships; routes return 501 in the meantime.
  async recordMeritEvent(input: RecordMeritEventInput): Promise<{ fabricEventId: string; txId: string }> {
    const { result, txId } = await this.submit(
      'wintergarden',
      'WintergardenContract',
      'RecordMeritEvent',
      [input.memberId, input.sessionId, String(input.rank), input.payoutAmountUsdc],
    );
    const parsed = this.parse<{ fabricEventId: string }>(result);
    return { fabricEventId: parsed?.fabricEventId ?? txId, txId };
  }

  async settleMeritPayout(fabricEventId: string, publicChainTxHash: string): Promise<TxResult> {
    const { txId } = await this.submit(
      'wintergarden',
      'WintergardenContract',
      'SettleMeritPayout',
      [fabricEventId, publicChainTxHash],
    );
    return { txId, eventId: fabricEventId };
  }

  // ---- WalkToEarnContract (PENDING chaincode) ------------------------------
  async recordActivityEvent(input: RecordActivityEventInput): Promise<TxResult> {
    const { txId } = await this.submit(
      'mybrotherskeeper',
      'WalkToEarnContract',
      'RecordActivityEvent',
      [input.memberId, input.batchId, String(input.steps), String(input.recordedAt)],
    );
    return { txId, eventId: input.batchId };
  }

  // ---- SponsoredEngagementContract (PENDING chaincode) ---------------------
  async recordAdDeliveryCredit(input: AdDeliveryCreditInput): Promise<TxResult> {
    const { txId } = await this.submit(
      'medicare-reviews',
      'SponsoredEngagementContract',
      'RecordAdDeliveryCredit',
      [input.memberId, input.adDeliveryId, input.adId, String(input.creditedAt)],
    );
    return { txId, eventId: input.adDeliveryId };
  }
}

// ---- Domain types ----------------------------------------------------------
export interface TxResult {
  txId: string;
  eventId: string;
}

export interface RewardsBalance {
  memberId: string;
  balance: number;
  currency: 'CM_CREDIT';
}

export type WalletState = 'inactive' | 'active' | 'suspended';

export interface WalletStatus {
  memberId: string;
  status: WalletState;
  activatedAt?: string;
  activatedBy?: string;
}

export interface ActivateWalletInput {
  memberId: string;
  /** Admin/actor id that authorized activation (for the audit record). */
  activatedBy: string;
  eventId: string;
}

export interface RewardsEntry {
  eventId: string;
  amount: number;
  reason: string;
  timestamp: string;
}

export interface CreditRewardInput {
  memberId: string;
  amount: number;
  reason: string;
  eventId: string;
}

export interface RedeemRewardInput {
  memberId: string;
  amount: number;
  rewardSku: string;
  eventId: string;
}

export interface ConsentState {
  memberId: string;
  scope: string;
  granted: boolean;
  updatedAt: string;
}

export interface SetConsentInput {
  memberId: string;
  scope: string;
  granted: boolean;
  eventId: string;
}

export interface EnrollmentState {
  memberId: string;
  milestones: string[];
}

export interface EnrollmentMilestoneInput {
  memberId: string;
  milestone: string;
  eventId: string;
}

export interface WellnessState {
  memberId: string;
  activities: { type: string; value: number; at: string }[];
}

export interface WellnessActivityInput {
  memberId: string;
  activityType: string;
  value: number;
  eventId: string;
}

export interface RecordMeritEventInput {
  memberId: string;
  sessionId: string;
  rank: number;
  payoutAmountUsdc: string;
}

export interface RecordActivityEventInput {
  memberId: string;
  batchId: string;
  steps: number;
  recordedAt: number;
}

export interface AdDeliveryCreditInput {
  memberId: string;
  adDeliveryId: string;
  adId: string;
  creditedAt: number;
}

/** Default singleton used by routes; swappable in tests via setContracts(). */
let contractsSingleton: LedgerBridgeContracts | null = null;

export function getContracts(): LedgerBridgeContracts {
  if (!contractsSingleton) {
    contractsSingleton = new LedgerBridgeContracts(new GatewayTransport());
  }
  return contractsSingleton;
}

export function setContracts(instance: LedgerBridgeContracts): void {
  contractsSingleton = instance;
}
