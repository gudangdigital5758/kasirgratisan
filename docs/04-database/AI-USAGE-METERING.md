# AI Usage Metering

## Per-user attribution
Every AI Marketing request must have `user_id` and `request_id`.

## Usage
```text
input_tokens
cache_tokens
output_tokens
total_tokens
measurement_source
is_estimated
```

Prefer provider/9Router usage. Use tokenizer estimation only as a documented fallback. Aggregate 9Router global totals for reconciliation.
