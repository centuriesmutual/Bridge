import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import {
  LedgerBridgeContracts,
  setContracts,
  type ChaincodeTransport,
} from '../../src/fabric/contracts.js';
import { processWearableSync } from '../../src/queue/jobs/wearable-sync.job.js';
import { processAdPostback } from '../../src/queue/jobs/ad-postback.job.js';
import type { WearableSyncJob, AdPostbackJob } from '../../src/queue/queues.js';

const submit = vi.fn(async () => ({ result: '{}', txId: 'tx' }));
const transport = { evaluate: vi.fn(), submit } as unknown as ChaincodeTransport;

beforeEach(() => {
  submit.mockClear();
  setContracts(new LedgerBridgeContracts(transport));
});

describe('queue job processors', () => {
  it('records each wearable sample scoped to mybrotherskeeper', async () => {
    const job = {
      id: 'j1',
      data: {
        property: 'mybrotherskeeper',
        samples: [
          { externalUserId: 'u1', provider: 'terra', batchId: 'b1', steps: 500, recordedAt: 1 },
          { externalUserId: 'u1', provider: 'terra', batchId: 'b1', steps: 200, recordedAt: 2 },
        ],
      } satisfies WearableSyncJob,
    } as unknown as Job<WearableSyncJob>;
    await processWearableSync(job);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenNthCalledWith(1, 'WalkToEarnContract', 'RecordActivityEvent', [
      'mbk:u1',
      'b1',
      '500',
      '1',
    ]);
  });

  it('records an ad postback scoped to medicare-reviews', async () => {
    const job = {
      id: 'j2',
      data: {
        property: 'medicare-reviews',
        postback: { adDeliveryId: 'd1', adId: 'a1', memberId: 'm1', deliveredAt: 99 },
      } satisfies AdPostbackJob,
    } as unknown as Job<AdPostbackJob>;
    await processAdPostback(job);
    expect(submit).toHaveBeenCalledWith('SponsoredEngagementContract', 'RecordAdDeliveryCredit', [
      'mr:m1',
      'd1',
      'a1',
      '99',
    ]);
  });
});
