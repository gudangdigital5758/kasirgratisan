# Threat Model

| Threat | Severity | Required control |
|---|---|---|
| Double billing | P0 | Idempotency + atomic ledger |
| Negative wallet | P0 | Reservation + transaction safety |
| Admin takeover | P0 | Google OAuth + RBAC + audit |
| API key leak | P0 | Secret manager/server-side only |
| MSC unauthorized access | P0 | Service authentication |
| Redis exposure | P0 | Private network/firewall |
| AI cost explosion | P1 | Limits + budgets |
| Provider outage | P1 | Retry/circuit/fallback |
