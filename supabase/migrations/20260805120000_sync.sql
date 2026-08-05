-- Sync M1 (Phase A): metadata, devices, dan mirror records dengan LWW server-side.
-- Jalankan via: supabase db push | SQL Editor

-- === sync_meta: satu baris per store ===
create table if not exists public.sync_meta (
  store_id uuid primary key references public.stores (id) on delete cascade,
  last_push_at timestamptz,
  last_pull_cursor timestamptz,
  device_count integer not null default 0,
  updated_at timestamptz not null default now()
);

-- === sync_devices: device yang terhubung ke store ===
create table if not exists public.sync_devices (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  device_id text not null,
  device_name text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (store_id, device_id)
);

-- === sync_records: satu baris per (store, table, syncId) ===
-- Tombstone direpresentasikan sebagai deleted=true (bukan tabel terpisah —
-- sesuai keputusan desain: deletedRecords tetap lokal, dikirim sebagai metadata).
create table if not exists public.sync_records (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.stores (id) on delete cascade,
  table_name text not null,
  sync_id text not null,
  data jsonb not null default '{}'::jsonb,
  server_updated_at timestamptz not null,
  deleted boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (store_id, table_name, sync_id)
);
create index if not exists sync_records_pull_idx on public.sync_records (store_id, server_updated_at);
create index if not exists sync_records_table_idx on public.sync_records (store_id, table_name, deleted);

-- === LWW upsert batch (atomik) ===
-- Setiap item: { table_name, sync_id, data, updated_at, deleted?, deleted_at? }
-- Server time dianggap penentu: baris dengan updated_at lebih baru menang.
create or replace function public.sync_upsert_batch(p_store_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  accepted text[] := '{}';
begin
  for item in select jsonb_array_elements(p_items)
  loop
    insert into public.sync_records (store_id, table_name, sync_id, data, server_updated_at, deleted, deleted_at)
    values (
      p_store_id,
      item->>'table_name',
      item->>'sync_id',
      coalesce(item->'data', '{}'::jsonb),
      (item->>'updated_at')::timestamptz,
      coalesce((item->>'deleted')::boolean, false),
      (item->>'deleted_at')::timestamptz
    )
    on conflict (store_id, table_name, sync_id)
    do update set
      data = case when excluded.server_updated_at > sync_records.server_updated_at then excluded.data else sync_records.data end,
      deleted = case when excluded.server_updated_at > sync_records.server_updated_at then excluded.deleted else sync_records.deleted end,
      deleted_at = case when excluded.server_updated_at > sync_records.server_updated_at then excluded.deleted_at else sync_records.deleted_at end,
      server_updated_at = greatest(sync_records.server_updated_at, excluded.server_updated_at);
    accepted := array_append(accepted, item->>'sync_id');
  end loop;
  return to_jsonb(accepted);
end;
$$;

-- === Register device (best-effort, idempotent) ===
create or replace function public.sync_register_device(p_store_id uuid, p_device_id text, p_device_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.sync_devices (store_id, device_id, device_name)
  values (p_store_id, p_device_id, p_device_name)
  on conflict (store_id, device_id)
  do update set
    last_seen_at = now(),
    device_name = coalesce(excluded.device_name, sync_devices.device_name);
end;
$$;

-- === RLS: hanya service role (Worker) yang mengakses ===
alter table public.sync_meta enable row level security;
alter table public.sync_devices enable row level security;
alter table public.sync_records enable row level security;

-- (Tidak ada policy yang diizinkan untuk anon/authenticated — service role bypass.)
