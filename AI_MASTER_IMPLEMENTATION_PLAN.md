# AI MASTER IMPLEMENTATION PLAN — PROFITKU + MSC STUDIO

## Purpose
This is the master execution roadmap for refactoring and hardening Profitku and MSC Studio while allowing an AI coding agent to work from the Profitku repository.

## Target architecture

```text
                         PROFITKU
                            |
          +-----------------+-----------------+
          |                                   |
          v                                   v
     AI MARKETING                         AI MEDIA
          |                                   |
       9Router                               MSC
          |                           +-------+-------+
         LLM                          |       |       |
                                     Image   Video  Telegram

AI CODING
    |
  9Router
    |
   LLM
```

## Core ownership
- Profitku: users, billing, wallet, subscriptions, pricing, Admin, AI Marketing, AI Coding integration.
- MSC Studio: image/video/Telegram generation infrastructure.
- 9Router: LLM routing for AI Marketing and AI Coding only.

## Phases

### Phase 0 — Discovery and baseline
- [ ] Repository inventory
- [ ] Runtime/build/deployment audit
- [ ] Database/schema audit
- [ ] Authentication/RBAC audit
- [ ] Billing/wallet audit
- [ ] Admin audit
- [ ] AI/MSC integration audit
- [ ] Security audit
- [ ] Test baseline
- [ ] Record findings in `PROJECT_STATUS.md`
Score: __/100

### Phase 1 — Architecture stabilization
- [ ] Confirm service boundaries
- [ ] Confirm Admin remains in Profitku repo but modular
- [ ] Confirm MSC remains separate infrastructure
- [ ] Confirm 9Router is outside MSC media architecture
- [ ] Define service authentication
- [ ] Define API contracts
Score: __/100

### Phase 2 — Authentication and authorization
- [ ] Google OAuth for Admin
- [ ] Admin RBAC
- [ ] Service-to-service authentication
- [ ] Secret management
- [ ] Audit logging
Score: __/100

### Phase 3 — Billing and wallet hardening
- [ ] Wallet ledger
- [ ] Atomic balance operations
- [ ] Idempotency
- [ ] Reservation/capture/release
- [ ] Refunds
- [ ] Subscription renewal
- [ ] Concurrency tests
- [ ] Double-charge tests
Score: __/100

### Phase 4 — Admin Control Center
- [ ] Modular Admin architecture
- [ ] Users
- [ ] Wallet/finance
- [ ] AI usage
- [ ] Jobs
- [ ] Provider health
- [ ] Live logs/traffic
- [ ] Audit logs
- [ ] System health
Score: __/100

### Phase 5 — AI Marketing + 9Router
- [ ] AI Marketing API
- [ ] 9Router integration
- [ ] Per-user request tracking
- [ ] Token metering
- [ ] Usage normalization
- [ ] Tokenizer fallback
- [ ] Rp100 / 1M token pricing
- [ ] Wallet reservation
- [ ] Final capture/release
- [ ] Streaming handling
- [ ] Retry/idempotency
- [ ] Reconciliation against 9Router global usage
Score: __/100

### Phase 6 — MSC API contract
- [ ] Stable Profitku → MSC contract
- [ ] Media job lifecycle
- [ ] Image generation
- [ ] Video generation
- [ ] Telegram generation
- [ ] Actual-cost/usage reporting
- [ ] Retry/timeout/fallback behavior
Score: __/100

### Phase 7 — MSC refactor
- [ ] Remove browser automation
- [ ] Remove unnecessary login/team features
- [ ] Google OAuth for authorized MSC access
- [ ] Provider abstraction
- [ ] Queue/worker
- [ ] Redis
- [ ] Service authentication
- [ ] Credential hardening
Score: __/100

### Phase 8 — Production infrastructure
- [ ] VPS deployment
- [ ] Docker
- [ ] Redis
- [ ] Cloudflare
- [ ] Monitoring
- [ ] Backups
- [ ] Recovery procedure
- [ ] Remove dependency on developer PC
Score: __/100

### Phase 9 — Security hardening
- [ ] Threat model
- [ ] RBAC review
- [ ] API security
- [ ] Rate limiting
- [ ] Secret rotation
- [ ] Network isolation
- [ ] Log redaction
- [ ] Dependency audit
Score: __/100

### Phase 10 — Testing and production readiness
- [ ] Unit tests
- [ ] Integration tests
- [ ] Billing concurrency tests
- [ ] AI usage tests
- [ ] MSC failure tests
- [ ] Security tests
- [ ] Load tests
- [ ] Backup restore test
- [ ] Production checklist
Score: __/100

## Definition of Done
A phase is complete only when code, tests, security review, documentation, and operational impact are addressed.

## Global rules
- Customer pricing is controlled only by Profitku.
- Initial AI Marketing price is Rp100 / 1M tokens.
- 9Router is only for LLM AI Marketing and AI Coding.
- MSC is the media generation infrastructure.
- Browser automation in MSC is removed.
- Financial records are append-only/immutable where appropriate.
