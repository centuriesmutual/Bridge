# ledger-bridge

**`ledger-bridge` is the single integration service** that sits between four
Centuries Mutual-owned frontend properties and a Hyperledger Fabric network. It
is the only repo that talks to all four properties.

It receives requests/webhooks from the properties, authenticates and validates
them, translates them into Fabric transactions or queries, calls out to any
required third-party services (wearable aggregators, ad networks, USDC
custody), and returns clean JSON.

## What this repo is NOT

- ❌ It does **not** implement business rules — those live in
  **`centuries-chaincode`** (invoked here via the Fabric Gateway SDK only).
- ❌ It does **not** implement Fabric network infrastructure (MSP/CA, channels,
  peers/orderers) — that lives in **`centuries-ledger`**.
- ❌ It contains **no frontend code**.
- ❌ It never moves real USDC through Fabric — Fabric is **audit-only** for the
  Wintergarden payout flow.

## Properties served

| Property | Reward mechanic |
|---|---|
| **centuriesmutual.com** | Insurance brokerage + Rewards Wallet — **internal credit** (`CM_CREDIT`), not crypto. Also a Carrier Portal and a public Developer Portal (OAuth 2.0 + API keys). |
| **medicare.reviews** | Medicare plan comparison — **internal credit** "Sponsored Advertising Engagement Wallet" tied to ad-delivery events (opt-in). |
| **wintergarden.cc / .software** | Music scoring — **real USDC** weekly payouts by rank to a connected external wallet (real custody/settlement) + non-transferable on-chain **merit badges** (score ≥ 75). |
| **mybrotherskeeper.cc** | Fitness accountability — **internal points** "Walk-to-Earn" from wearable activity, redeemable at Bronze 500 / Silver 2,000 / Gold 5,000. |

See [`docs/PROPERTY_BOUNDARIES.md`](docs/PROPERTY_BOUNDARIES.md) for the full
route → chaincode mapping and [`docs/API.md`](docs/API.md) for endpoints.

## ⛔ Pending chaincode work

Three contracts do **not yet exist** in `centuries-chaincode`. The bridge is
written against typed interfaces (`src/fabric/contracts.ts`) so it compiles and
is testable now, and the affected endpoints return `501 NOT_IMPLEMENTED`
(after still enforcing auth + webhook signature verification):

- `SponsoredEngagementContract` (medicare-reviews)
- `WintergardenContract` (wintergarden sessions, merit badges, USDC payouts)
- `WalkToEarnContract` (mybrotherskeeper walk-to-earn + wearable webhook)

> Track in `centuries-chaincode`:
> `https://gitlab.com/centuries.mutual/centuries-chaincode/-/issues` _(TODO:
> replace with real tracking issue links)._

## Architecture: Fabric vs. public chain

Fabric is a **permissioned ledger** — ideal for tamper-evident internal audit
records. It **cannot custody or transfer real USDC**. For Wintergarden's USDC
payouts:

```
session scored
   → WintergardenContract.RecordMeritEvent()          [Fabric: pending audit record]
   → USDCSettlementProvider.createPayout()             [public chain: real settlement]
   → provider settlement webhook (status confirmed)    [publicChainTxHash known]
   → WintergardenContract.SettleMeritPayout(id, hash)  [Fabric: mark settled, cross-ref]
```

Real settlement is behind the swappable `USDCSettlementProvider` interface
(`src/services/usdc/`). The custody provider is **Circle Internet Group**
(confirmed); the implementation is currently a **stub** pending production
credentials — no real keys committed.

## Tech stack

TypeScript (Node 20+) · Fastify 5 · `@hyperledger/fabric-gateway` · Zod ·
BullMQ + Redis · Vitest.

## Getting started

```bash
npm install
cp .env.example .env      # fill in values; see "Open questions" below
npm run dev               # API server (tsx watch)
npm run worker            # BullMQ worker (separate process)
```

Quality gates:

```bash
npm run lint              # ESLint + tsc --noEmit
npm run typecheck
npm test                  # Vitest
npm run test:coverage     # enforces 80% coverage
npm run build             # tsc -> dist/
```

Requires a running **Redis** for idempotency + queues (`REDIS_URL`) and, for
live chaincode calls, a reachable **Fabric Gateway** peer (`FABRIC_*`). Tests
mock both, so no external services are needed to run the suite.

## Security

- **TLS at the edge** on Railway/PaaS (`TLS_ENABLED=false` is fine when the
  platform terminates TLS). Set `TLS_ENABLED=true` + cert paths only if this
  process serves HTTPS itself.
- **Per-property origin allowlist** + member JWT; **least-privilege** chaincode
  access enforced in `src/fabric/contracts.ts` (a property cannot invoke
  another property's contract functions).
- **Rate limiting** per API key / origin / IP (`@fastify/rate-limit`).
- **Secret redaction**: Fabric certs/keys, webhook secrets, and USDC provider
  keys are never logged.
- **Webhook HMAC verification** over the raw body before any payload is trusted.
- **Idempotency** on every write and webhook (Redis TTL keys).

## Open questions (flagged, not guessed)

These are stubbed behind interfaces / env placeholders with `TODO: confirm`
markers. Pin them down before production:

1. **Supabase JWT** — actual project ref / issuer / JWKS URL / audience.
2. **Wearable aggregator vendor** — Terra / Spike / Vital / … and its real
   webhook payload shape (`src/services/wearables/aggregator.client.ts`).
3. ✅ **USDC custody provider** — CONFIRMED **Circle Internet Group**
   (`src/services/usdc/circle.provider.ts`). Real API wiring + credentials are
   provisioned in production.
4. **Shared vs. separate member identity** across properties — defaulted to
   **property-scoped** IDs (`cm:`, `mr:`, `wg:`, `mbk:`).

## Repo layout

```
src/
  config/       typed env + per-property origin allowlist
  fabric/       gateway connection, identity loading, typed least-privilege contracts
  services/     usdc (swappable provider), wearables aggregator, ad-network postbacks
  middleware/   origin-auth, oauth, api-key, webhook-signature, idempotency
  schemas/      Zod payload schemas per route group
  routes/       four property namespaces under /v1
  queue/        BullMQ queues, worker, jobs (wearable-sync, ad-postback)
  app.ts        Fastify app builder (testable)
  server.ts     entrypoint (TLS + listen + graceful shutdown)
docs/           API.md, PROPERTY_BOUNDARIES.md
test/           Vitest unit + integration suites
```
