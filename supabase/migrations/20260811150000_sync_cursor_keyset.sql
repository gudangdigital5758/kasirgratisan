-- Sync cursor hardening: support keyset ordering by timestamp + identity.
-- Existing sync_records rows are updated in place by sync_upsert_batch, so the
-- identity alone is not a valid change cursor.

create index if not exists sync_records_pull_keyset_idx
  on public.sync_records (store_id, server_updated_at, id);
