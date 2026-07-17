import { NotImplementedError } from '../lib/errors.js';
import type { ContractName } from '../fabric/contracts.js';

/**
 * Helper for endpoints blocked on chaincode that does not yet exist in
 * `centuries-chaincode`. Returns a clear, actionable 501 payload.
 *
 * TODO(centuries-chaincode): implement the referenced contract, then wire the
 * route to the typed wrapper in src/fabric/contracts.ts and remove this stub.
 */
export function pendingChaincode(contract: ContractName, capability: string): never {
  throw new NotImplementedError(
    `${capability} is blocked pending "${contract}" in centuries-chaincode.`,
    {
      contract,
      status: 'pending-chaincode',
      // TODO: replace with the real tracking issue URL in centuries-chaincode.
      tracking: 'https://gitlab.com/centuries.mutual/centuries-chaincode/-/issues',
    },
  );
}
