-- P1b — mapping order Midtrans → user untuk top-up credit (Profitku Cloud).
-- Dipakai worker middleware: checkout membuat baris pending; webhook settlement
-- mencocokkan order_id lalu memanggil fn_credit_topup (idempotent).

create table if not exists public.topup_pending (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id text not null unique,
  package_id bigint not null references public.credit_packages(id),
  amount_rp bigint not null check (amount_rp > 0),
  credits bigint not null check (credits > 0),
  status text not null default 'pending' check (status in ('pending','settled','failed')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create index if not exists topup_pending_user_idx on public.topup_pending (user_id, created_at desc);
create index if not exists topup_pending_order_idx on public.topup_pending (order_id);

alter table public.topup_pending enable row level security;

drop policy if exists topup_pending_owner on public.topup_pending;
create policy topup_pending_owner on public.topup_pending for select using (auth.uid() = user_id);
