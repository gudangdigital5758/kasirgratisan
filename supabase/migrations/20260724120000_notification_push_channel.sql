-- Allow push channel in notification_log (OneSignal)
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on e.enumtypid = t.oid
    where t.typname = 'notification_channel' and e.enumlabel = 'push'
  ) then
    alter type public.notification_channel add value 'push';
  end if;
end $$;
