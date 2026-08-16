# PRD — Billing & Wallet

## Core principles
- Profitku is the sole customer billing authority.
- Financial history must be auditable.
- Use atomic operations and idempotency.
- Avoid negative balances and double charges.

## AI reservation
Estimate → reserve → execute → actual usage → capture → release excess.

## Acceptance
Concurrency, retries, failures, refunds, renewals, and idempotency are covered by tests.
