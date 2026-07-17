import { describe, expect, it, vi } from 'vitest';
import {
  LedgerBridgeContracts,
  type ChaincodeTransport,
  type ContractName,
} from '../../src/fabric/contracts.js';
import { ForbiddenError } from '../../src/lib/errors.js';

function mockTransport(): ChaincodeTransport & {
  evaluate: ReturnType<typeof vi.fn>;
  submit: ReturnType<typeof vi.fn>;
} {
  return {
    evaluate: vi.fn(async () => JSON.stringify({ ok: true })),
    submit: vi.fn(async () => ({ result: '{}', txId: 'tx123' })),
  } as unknown as ChaincodeTransport & {
    evaluate: ReturnType<typeof vi.fn>;
    submit: ReturnType<typeof vi.fn>;
  };
}

describe('LedgerBridgeContracts least-privilege', () => {
  it('routes an allowed centuries-mutual call to the transport', async () => {
    const t = mockTransport();
    t.submit.mockResolvedValueOnce({ result: '{}', txId: 'abc' });
    const c = new LedgerBridgeContracts(t);
    const res = await c.creditReward({
      memberId: 'cm:1',
      amount: 10,
      reason: 'test',
      eventId: 'e1',
    });
    expect(res.txId).toBe('abc');
    expect(t.submit).toHaveBeenCalledWith(
      'RewardsContract',
      'CreditReward',
      ['cm:1', '10', 'test', 'e1'],
    );
  });

  it('parses a balance query result', async () => {
    const t = mockTransport();
    t.evaluate.mockResolvedValueOnce(
      JSON.stringify({ memberId: 'cm:1', balance: 42, currency: 'CM_CREDIT' }),
    );
    const c = new LedgerBridgeContracts(t);
    const balance = await c.getRewardsBalance('cm:1');
    expect(balance.balance).toBe(42);
  });

  it('blocks a property from invoking another property contract', async () => {
    const t = mockTransport();
    const c = new LedgerBridgeContracts(t);
    // Reach into the guard via a wintergarden method that is permitted, then
    // assert a centuries-mutual-only call is blocked when mis-scoped. We test
    // the guard by attempting a submit that is not in the wintergarden set.
    // recordActivityEvent is mybrotherskeeper-only:
    const callCrossProperty = () =>
      (c as unknown as {
        submit: (p: string, c: ContractName, fn: string, a: string[]) => Promise<unknown>;
      }).submit('wintergarden', 'RewardsContract', 'CreditReward', []);
    // The guard throws synchronously, before any transport call.
    expect(callCrossProperty).toThrow(ForbiddenError);
    expect(t.submit).not.toHaveBeenCalled();
  });

  it('executes the two-phase merit settlement calls', async () => {
    const t = mockTransport();
    t.submit
      .mockResolvedValueOnce({ result: JSON.stringify({ fabricEventId: 'fe1' }), txId: 'tx1' })
      .mockResolvedValueOnce({ result: '{}', txId: 'tx2' });
    const c = new LedgerBridgeContracts(t);
    const rec = await c.recordMeritEvent({
      memberId: 'wg:1',
      sessionId: 's1',
      rank: 1,
      payoutAmountUsdc: '12.50',
    });
    expect(rec.fabricEventId).toBe('fe1');
    const settle = await c.settleMeritPayout('fe1', '0xhash');
    expect(settle.txId).toBe('tx2');
    expect(t.submit).toHaveBeenNthCalledWith(
      2,
      'WintergardenContract',
      'SettleMeritPayout',
      ['fe1', '0xhash'],
    );
  });
});
