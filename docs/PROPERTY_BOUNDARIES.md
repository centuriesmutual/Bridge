# Property Boundaries

`ledger-bridge` serves **four functionally distinct properties**, all owned by
Centuries Mutual. They are **not** one generic rewards model — each has its own
namespace, reward mechanic, and chaincode contract(s). This document is the
authoritative map of what belongs to which property and which chaincode
contract each route group invokes.

## Member identity is property-scoped

Member IDs are namespaced per property (`cm:`, `mr:`, `wg:`, `mbk:`). We do
**not** assume a shared member identity across brands. If a shared identity
system is later confirmed, only `config/origins.ts` (`memberIdPrefix`) and the
scoping helper need to change — nothing downstream breaks.

> **OPEN QUESTION (do not guess):** Is a person who uses both
> `mybrotherskeeper.cc` and `centuriesmutual.com` the *same* member identity,
> or deliberately separate member bases per brand? Default is **separate /
> property-scoped**.

## Property → reward mechanic → contract

| Property | Domain(s) | Reward mechanic | Chaincode contract(s) | Status |
|---|---|---|---|---|
| `centuries-mutual` | `centuriesmutual.com` | **Internal credit** (Rewards Wallet, `CM_CREDIT`) — not crypto | `RewardsContract`, `ConsentContract`, `EnrollmentContract`, `WellnessContract` | **Implemented** (existing chaincode) |
| `medicare-reviews` | `medicare.reviews` | **Internal credit** (Sponsored Advertising Engagement Wallet) tied to ad-delivery events | `SponsoredEngagementContract` | ⛔ **Pending chaincode** |
| `wintergarden` | `wintergarden.cc`, `wintergarden.software` | **Real USDC** weekly payouts by rank to a connected external wallet + non-transferable on-chain **merit badges** (score ≥ 75) | `WintergardenContract` + `services/usdc/` | ⛔ **Pending chaincode** |
| `mybrotherskeeper` | `mybrotherskeeper.cc` | **Internal points** (Walk-to-Earn; Bronze 500 / Silver 2,000 / Gold 5,000) | `WalkToEarnContract` | ⛔ **Pending chaincode** |

## Route → chaincode function mapping

Least-privilege is enforced in `src/fabric/contracts.ts`
(`CONTRACT_PERMISSIONS`): each property may only invoke the functions listed
for it. A route attempting a function outside its property's set throws
`ForbiddenError` **before** any transport call.

### centuries-mutual (implemented)

| Route | Method | Chaincode call | Auth |
|---|---|---|---|
| `/v1/centuries-mutual/rewards/balance` | GET | `RewardsContract.GetBalance` | member (origin + Supabase JWT) |
| `/v1/centuries-mutual/rewards/history` | GET | `RewardsContract.GetHistory` | member |
| `/v1/centuries-mutual/rewards/redeem` | POST | `RewardsContract.RedeemReward` | member (idempotent) |
| `/v1/centuries-mutual/rewards/members/:memberId/credit` | POST | `RewardsContract.CreditReward` | API key `rewards:write` (idempotent) |
| `/v1/centuries-mutual/rewards/members/:memberId/balance` | GET | `RewardsContract.GetBalance` | OAuth `rewards:read` (Developer Portal) |
| `/v1/centuries-mutual/consent` | GET | `ConsentContract.GetConsent` | member |
| `/v1/centuries-mutual/consent` | PUT | `ConsentContract.SetConsent` | member (idempotent) |
| `/v1/centuries-mutual/enrollment` | GET | `EnrollmentContract.GetEnrollment` | member |
| `/v1/centuries-mutual/enrollment/members/:memberId/milestone` | POST | `EnrollmentContract.RecordEnrollmentMilestone` | API key `enrollment:write` (idempotent) |
| `/v1/centuries-mutual/wellness` | GET | `WellnessContract.GetWellnessStatus` | member |
| `/v1/centuries-mutual/wellness/members/:memberId/activity` | POST | `WellnessContract.RecordWellnessActivity` | API key `wellness:write` (idempotent) |

### medicare-reviews (pending `SponsoredEngagementContract`)

| Route | Method | Would call | Auth | Status |
|---|---|---|---|---|
| `/v1/medicare-reviews/sponsored-engagement/opt-in` | POST | `SponsoredEngagementContract.SetOptInState` | member | 501 |
| `/v1/medicare-reviews/sponsored-engagement/wallet` | GET | `SponsoredEngagementContract.GetOptInState` | member | 501 |
| `/v1/medicare-reviews/sponsored-engagement/postback` | POST | `SponsoredEngagementContract.RecordAdDeliveryCredit` | ad-network HMAC (dedupe by `adDeliveryId`) | 501 (signature verified) |

### wintergarden (pending `WintergardenContract`)

| Route | Method | Would call | Auth | Status |
|---|---|---|---|---|
| `/v1/wintergarden/sessions` | POST | `WintergardenContract.RecordSession` | member (idempotent) | 501 |
| `/v1/wintergarden/sessions/:sessionId` | GET | `WintergardenContract.GetSession` | member | 501 |
| `/v1/wintergarden/merit-badges/members/:memberId` | GET | `WintergardenContract.GetMeritBadges` | member | 501 |
| `/v1/wintergarden/merit-badges/:sessionId` | GET | `WintergardenContract.GetMeritBadges` | member | 501 |
| `/v1/wintergarden/usdc-payouts` | POST | `WintergardenContract.RecordMeritEvent` + `services/usdc` + `SettleMeritPayout` | member (idempotent) | 501 |
| `/v1/wintergarden/usdc-payouts/webhook` | POST | `WintergardenContract.SettleMeritPayout` | USDC provider HMAC | 501 (signature verified) |

### mybrotherskeeper (pending `WalkToEarnContract`)

| Route | Method | Would call | Auth | Status |
|---|---|---|---|---|
| `/v1/mybrotherskeeper/walk-to-earn/members/:memberId/points` | GET | `WalkToEarnContract.GetPoints` | member | 501 |
| `/v1/mybrotherskeeper/walk-to-earn/redeem` | POST | `WalkToEarnContract.RedeemTier` | member (idempotent) | 501 |
| `/v1/mybrotherskeeper/wearable-webhook` | POST | queued → `WalkToEarnContract.RecordActivityEvent` | wearable aggregator HMAC (dedupe by `batchId`) | 501 (signature verified) |

## USDC settlement boundary (Wintergarden)

Hyperledger Fabric is a **permissioned audit ledger**. It **cannot custody or
move real USDC**. USDC settlement happens on a public chain via a swappable
`USDCSettlementProvider` (`services/usdc/`). Fabric's role is **audit only**:

```
session scored
   → WintergardenContract.RecordMeritEvent()          [Fabric: pending audit record]
   → USDCSettlementProvider.createPayout()             [public chain: real settlement]
   → provider settlement webhook (status confirmed)    [publicChainTxHash known]
   → WintergardenContract.SettleMeritPayout(id, hash)  [Fabric: mark settled, cross-ref]
```

No code moves USDC through Fabric.
