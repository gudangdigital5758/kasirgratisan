-- Atomic per-scope backup quota reservation (CLOUD-011).
-- R2 is not transactional with Postgres, so a short-lived reservation closes
-- the concurrent upload race before the object is written.

create table if not exists public.backup_quota_reservations (
  id uuid primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  store_id uuid references public.stores (id) on delete cascade,
  file_size bigint not null check (file_size > 0),
  status text not null default 'pending' check (status in ('pending', 'completed', 'released')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists backup_quota_reservations_scope_idx
  on public.backup_quota_reservations (user_id, store_id, status, expires_at);

alter table public.backup_quota_reservations enable row level security;
revoke all on public.backup_quota_reservations from public, anon, authenticated;
grant select, insert, update, delete on public.backup_quota_reservations to service_role;

create or replace function public.reserve_backup_quota(
  p_reservation_id uuid,
  p_user_id uuid,
  p_store_id uuid,
  p_file_size bigint,
  p_limit_mb integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  used_bytes bigint;
  pending_bytes bigint;
  limit_bytes bigint;
  existing_status text;
  scope_key text := 'profitku:backup-quota:' || p_user_id::text || ':' || coalesce(p_store_id::text, 'account');
begin
  if p_file_size <= 0 or p_limit_mb <= 0 then
    raise exception 'invalid_backup_quota_input' using errcode = 'P0001';
  end if;

  select status
    into existing_status
    from public.backup_quota_reservations
   where id = p_reservation_id
   for update;

  if existing_status is not null then
    return existing_status in ('pending', 'completed');
  end if;

  perform pg_advisory_xact_lock(hashtext(scope_key));

  delete from public.backup_quota_reservations
   where status = 'pending'
     and expires_at <= now();

  limit_bytes := p_limit_mb::bigint * 1024 * 1024;

  select coalesce(sum(file_size), 0)
    into used_bytes
    from public.backups
   where user_id = p_user_id
     and store_id is not distinct from p_store_id;

  select coalesce(sum(file_size), 0)
    into pending_bytes
    from public.backup_quota_reservations
   where user_id = p_user_id
     and store_id is not distinct from p_store_id
     and status = 'pending'
     and expires_at > now();

  if used_bytes + pending_bytes + p_file_size > limit_bytes then
    return false;
  end if;

  insert into public.backup_quota_reservations (
    id, user_id, store_id, file_size, status, expires_at
  ) values (
    p_reservation_id, p_user_id, p_store_id, p_file_size, 'pending', now() + interval '15 minutes'
  );
  return true;
end;
$$;

revoke all on function public.reserve_backup_quota(uuid, uuid, uuid, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_backup_quota(uuid, uuid, uuid, bigint, integer)
  to service_role;
