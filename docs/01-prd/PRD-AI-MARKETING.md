# PRD — AI Marketing

## Goal
Provide paid AI Marketing capabilities through LLMs routed by 9Router.

## Pricing
Initial price: **Rp100 / 1,000,000 tokens**. Pricing must be configurable.

## Flow
User → Profitku → metering/reservation → 9Router → LLM → usage → billing → response.

## Acceptance
- Usage is attributable to `user_id` and `request_id`.
- Input/cache/output/total usage is recorded when available.
- Estimated usage is explicitly marked.
- Billing is idempotent.
