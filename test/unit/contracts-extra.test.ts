import { describe, expect, it, vi } from 'vitest';
import { LedgerBridgeContracts, type ChaincodeTransport } from '../../src/fabric/contracts.js';

function mk() {
  const evaluate = vi.fn(async () => '');
  const submit = vi.fn(async () => ({ result: '{}', txId: 'tx' }));
  const transport = { evaluate, submit } as unknown as ChaincodeTransport;
  return { transport, evaluate, submit, c: new LedgerBridgeContracts(transport) };
}

describe('LedgerBridgeContracts wrappers', () => {
  it('covers rewards history + redeem', async () => {
    const { c, evaluate, submit } = mk();
    evaluate.mockResolvedValueOnce(JSON.stringify([{ eventId: 'e', amount: 1, reason: 'r', timestamp: 't' }]));
    expect(await c.getRewardsHistory('cm:1')).toHaveLength(1);
    // Empty history returns [].
    evaluate.mockResolvedValueOnce('');
    expect(await c.getRewardsHistory('cm:1')).toEqual([]);
    await c.redeemReward({ memberId: 'cm:1', amount: 5, rewardSku: 'sku', eventId: 'e' });
    expect(submit).toHaveBeenCalledWith('RewardsContract', 'RedeemReward', ['cm:1', '5', 'sku', 'e']);
  });

  it('covers consent get/set', async () => {
    const { c, evaluate, submit } = mk();
    evaluate.mockResolvedValueOnce(JSON.stringify({ memberId: 'cm:1', scope: 's', granted: true, updatedAt: 'x' }));
    expect((await c.getConsent('cm:1', 's')).granted).toBe(true);
    await c.setConsent({ memberId: 'cm:1', scope: 's', granted: false, eventId: 'e' });
    expect(submit).toHaveBeenCalledWith('ConsentContract', 'SetConsent', ['cm:1', 's', 'false', 'e']);
  });

  it('covers enrollment get/record', async () => {
    const { c, evaluate, submit } = mk();
    evaluate.mockResolvedValueOnce(JSON.stringify({ memberId: 'cm:1', milestones: [] }));
    expect((await c.getEnrollment('cm:1')).memberId).toBe('cm:1');
    await c.recordEnrollmentMilestone({ memberId: 'cm:1', milestone: 'm', eventId: 'e' });
    expect(submit).toHaveBeenCalledWith('EnrollmentContract', 'RecordEnrollmentMilestone', ['cm:1', 'm', 'e']);
  });

  it('covers wellness get/record', async () => {
    const { c, evaluate, submit } = mk();
    evaluate.mockResolvedValueOnce(JSON.stringify({ memberId: 'cm:1', activities: [] }));
    expect((await c.getWellnessStatus('cm:1')).activities).toEqual([]);
    await c.recordWellnessActivity({ memberId: 'cm:1', activityType: 'steps', value: 10, eventId: 'e' });
    expect(submit).toHaveBeenCalledWith('WellnessContract', 'RecordWellnessActivity', ['cm:1', 'steps', '10', 'e']);
  });

  it('covers pending-contract wrappers (mbk/medicare)', async () => {
    const { c, submit } = mk();
    await c.recordActivityEvent({ memberId: 'mbk:1', batchId: 'b', steps: 100, recordedAt: 5 });
    expect(submit).toHaveBeenCalledWith('WalkToEarnContract', 'RecordActivityEvent', ['mbk:1', 'b', '100', '5']);
    await c.recordAdDeliveryCredit({ memberId: 'mr:1', adDeliveryId: 'd', adId: 'a', creditedAt: 9 });
    expect(submit).toHaveBeenCalledWith('SponsoredEngagementContract', 'RecordAdDeliveryCredit', ['mr:1', 'd', 'a', '9']);
  });
});
