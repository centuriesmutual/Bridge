# ledger-bridge API

Base path: `/v1`. All responses are JSON. Prefer HTTPS at the edge
(Railway / ingress); app-level TLS is optional via `TLS_ENABLED`.

## Authentication

Every request resolves to exactly **one** property before any chaincode is
touched. Three auth surfaces:

1. **Member (browser):** `Origin`/`Referer` must be on the property allowlist
   (`config/origins.ts`) **and** a Supabase-issued JWT must be presented as
   `Authorization: Bearer <jwt>`.
   - `TODO: confirm` the Supabase issuer / JWKS URL / audience
     (`SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER`). Until configured, member
     auth fails closed.
2. **Partner (centuriesmutual.com Developer Portal only):** OAuth 2.0 bearer
   with scopes (`rewards:read`, `wellness:read`, `enrollment:read`, ...) **or**
   a server-to-server API key in `x-api-key` (only SHA-256 hashes stored).
3. **Inbound webhooks:** HMAC signature in `x-webhook-signature` over the raw
   body, one secret per source. Payloads are never trusted before verification.

## Error envelope

Errors use a single shape. The `category` and `retryable` fields let the
frontend distinguish "your request was invalid" from "the ledger didn't
confirm — retry".

```json
{
  "error": {
    "code": "LEDGER_NOT_CONFIRMED",
    "category": "ledger",
    "message": "Ledger did not confirm RewardsContract.CreditReward.",
    "retryable": true,
    "details": { "reason": "..." }
  }
}
```

| HTTP | code | category | retryable | Meaning |
|---|---|---|---|---|
| 400 | `VALIDATION_FAILED` | `validation` | false | Bad input; fix before retrying |
| 401 | `UNAUTHORIZED` / `BAD_SIGNATURE` / `INVALID_API_KEY` | `auth` | false | Authentication failed |
| 403 | `FORBIDDEN` | `auth` | false | Wrong property / missing scope / least-privilege |
| 404 | `NOT_FOUND` | `not_found` | false | Unknown route/resource |
| 409 | `DUPLICATE_REQUEST` | `conflict` | false | Idempotency key already in-flight |
| 429 | `RATE_LIMITED` | `upstream` | true | Rate limit exceeded |
| 501 | `NOT_IMPLEMENTED` | `not_implemented` | false | Blocked on pending chaincode |
| 502 | `LEDGER_NOT_CONFIRMED` | `ledger` | true | Fabric endorsement/commit failed — retry |
| 502 | `UPSTREAM_FAILED` | `upstream` | true | Third-party (USDC/wearable/ad) failed |
| 500 | `INTERNAL_ERROR` | `internal` | false | Unexpected |

## Idempotency

Every write endpoint and webhook handler is idempotent. Supply an
`Idempotency-Key` header (or the natural event id: `eventId`, `adDeliveryId`,
`batchId`, USDC `publicChainTxHash`). The key is reserved in Redis with a TTL;
a completed duplicate replays the stored response with
`idempotent-replay: true`; an in-flight duplicate returns `409`.

---

## centuries-mutual — IMPLEMENTED

Rewards Wallet credits are an **internal ledger balance (`CM_CREDIT`)**, not
crypto.

### `GET /v1/centuries-mutual/rewards/wallet` (member)

Returns the caller's Rewards Wallet status. Wallets start **`inactive`** and
become **`active`** once an admin activates them (e.g. after ACA enrollment).

```json
{ "memberId": "cm:123", "status": "active", "activatedBy": "admin:jane", "activatedAt": "..." }
```

### `POST /v1/centuries-mutual/rewards/members/:memberId/activate` (API key `rewards:admin`, idempotent)

Admin-only. Called by the admin page's backend to activate a member's wallet.

```json
{ "activatedBy": "admin:jane", "eventId": "act-1" }
```

> Depends on `RewardsContract.ActivateWallet` / `GetWalletStatus` —
> **TODO: confirm** these exist in `centuries-chaincode` (function names may
> differ).

### `GET /v1/centuries-mutual/rewards/balance` (member)

Returns the caller's balance.

```json
{ "memberId": "cm:123", "balance": 250, "currency": "CM_CREDIT" }
```

### `GET /v1/centuries-mutual/rewards/history` (member)

```json
{ "memberId": "cm:123", "entries": [ { "eventId": "e1", "amount": 50, "reason": "enrollment", "timestamp": "..." } ] }
```

### `POST /v1/centuries-mutual/rewards/redeem` (member, idempotent)

```json
{ "amount": 100, "rewardSku": "GIFTCARD_25", "eventId": "evt-1" }
```

### `POST /v1/centuries-mutual/rewards/members/:memberId/credit` (API key `rewards:write`, idempotent)

```json
{ "amount": 100, "reason": "rent-pay", "eventId": "evt-1" }
```

### `GET /v1/centuries-mutual/rewards/members/:memberId/balance` (OAuth `rewards:read`)

### `GET /v1/centuries-mutual/consent?scope=marketing` (member)

### `PUT /v1/centuries-mutual/consent` (member, idempotent)

```json
{ "scope": "marketing", "granted": true, "eventId": "evt-1" }
```

### `GET /v1/centuries-mutual/enrollment` (member)

### `POST /v1/centuries-mutual/enrollment/members/:memberId/milestone` (API key `enrollment:write`, idempotent)

```json
{ "milestone": "plan_selected", "eventId": "evt-1" }
```

### `GET /v1/centuries-mutual/wellness` (member)

### `POST /v1/centuries-mutual/wellness/members/:memberId/activity` (API key `wellness:write`, idempotent)

```json
{ "activityType": "steps", "value": 8000, "eventId": "evt-1" }
```

---

## ⛔ Blocked pending chaincode

The following endpoints exist and enforce auth + signature verification, but
return **`501 NOT_IMPLEMENTED`** because their chaincode contract is not yet
built in [`centuries-chaincode`](https://gitlab.com/centuries.mutual/centuries-chaincode)
_(TODO: replace with the real tracking issue URLs)_.

### medicare-reviews — pending `SponsoredEngagementContract`

- `POST /v1/medicare-reviews/sponsored-engagement/opt-in` (member)
- `GET  /v1/medicare-reviews/sponsored-engagement/wallet` (member)
- `POST /v1/medicare-reviews/sponsored-engagement/postback` (ad-network HMAC; deduped by `adDeliveryId`)

### wintergarden — pending `WintergardenContract`

- `POST /v1/wintergarden/sessions` (member)
- `GET  /v1/wintergarden/sessions/:sessionId` (member)
- `GET  /v1/wintergarden/merit-badges/members/:memberId` (member)
- `GET  /v1/wintergarden/merit-badges/:sessionId` (member)
- `POST /v1/wintergarden/usdc-payouts` (member) — two-phase Fabric record → real USDC settlement → Fabric confirm
- `POST /v1/wintergarden/usdc-payouts/webhook` (USDC provider HMAC)

> Merit badges may also mint as a public-chain NFT in addition to the Fabric
> audit record — **TODO: confirm**.

### mybrotherskeeper — pending `WalkToEarnContract`

- `GET  /v1/mybrotherskeeper/walk-to-earn/members/:memberId/points` (member)
- `POST /v1/mybrotherskeeper/walk-to-earn/redeem` (member)
- `POST /v1/mybrotherskeeper/wearable-webhook` (aggregator HMAC; deduped by `batchId`; enqueues once chaincode ships)

---

## Health

- `GET /healthz` → `{ "status": "ok", "service": "ledger-bridge" }`
