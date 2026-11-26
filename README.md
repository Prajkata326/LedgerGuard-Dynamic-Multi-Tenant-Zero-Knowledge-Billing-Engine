# LedgerGuard

LedgerGuard is a multi-tenant SaaS billing engine with isolated tenant data, authenticated APIs, idempotent charge creation, and usage analytics.

## Current implementation

- Express API with strict TypeScript settings, security headers, request limits, CORS, and basic rate limiting.
- RS256 JWT verification. A verified `org` claim is mapped through a server-owned organization-to-database registry; clients cannot select a database.
- Separate Mongoose connection pools per configured organization.
- `POST /v1/billing/charges` validates a charge, acquires a short Redis lock for its idempotency key, and atomically stores the charge and idempotency record in a MongoDB transaction. Replays return the original charge; reusing a key for different data returns `409`.
- `GET /v1/billing/summary` returns charge counts and totals grouped by currency.
- `GET /v1/billing/charges` returns a tenant-scoped, newest-first charge history with bounded pagination.
- React billing dashboard with tenant-scoped charge volume, customer counts, recent charges, and currency totals. Paste an RS256 access token to load live analytics.

The dashboard reports only metrics backed by the current charge model. Subscription, refund, and failed-payment analytics are not included yet.

## Requirements

- Node.js 20 or later
- MongoDB replica set (transactions require replica-set support)
- Redis 6 or later
- An RS256 JWT public key and a trusted database URI for each organization

## Run locally

1. Copy `.env.example` to `.env` and configure trusted tenant database URIs.
2. Put the JWT verification public key at the configured path (default `./keys/jwt-public.pem`). Keep the private signing key in the identity provider or secret manager; do not add keys to source control.
3. Start MongoDB as a replica set and Redis.
4. Install and run:

   ```sh
   npm install
   npm run dev
   ```

   The API listens on `http://localhost:4000` and the dashboard on `http://localhost:5173`.

## API

Send `Authorization: Bearer <RS256 token>` with `iss=ledgerguard`, `aud=ledgerguard-api`, and an `org` claim present in the server-side tenant registry.

```http
POST /v1/billing/charges
Idempotency-Key: invoice-2026-0001
Content-Type: application/json

{"amountMinor":24000,"currency":"USD","customerId":"cus_123","description":"Pro plan"}
```

Amounts use minor currency units (for example, `24000` is USD 240.00). Each tenant database is expected to be provisioned separately. Provision tenant databases and credentials through a trusted administrative workflow, not through the public API.

```http
GET /v1/billing/summary?period=7d
Authorization: Bearer <RS256 token>
```

The summary accepts `period=7d` (default) or `period=24h`. Results include charge and unique-customer counts, totals grouped by currency, a time series, and up to eight recent charges. The history endpoint accepts `page` (default `1`) and `limit` (default `20`, maximum `50`) and returns page counts and charge records. Both endpoints are scoped to the organization verified from the token; the client cannot choose a tenant database.

## Next milestones

1. Replace development tenant URI configuration with a managed secret-backed tenant registry and onboarding workflow.
2. Add charge history, customer and subscription schemas, webhook/outbox delivery, and reversible refund workflows.
3. Extend analytics with explicit payment statuses, refunds, subscriptions, and billing-model breakdowns.
4. Add observability, operational migrations, deployment configuration, and integration/load validation.
