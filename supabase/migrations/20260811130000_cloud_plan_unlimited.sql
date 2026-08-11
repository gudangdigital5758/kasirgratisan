-- Normalize the production plan row to the accepted per-store unlimited model.
update public.plans
set max_stores = null,
    features = (coalesce(features, '{}'::jsonb) - 'max_stores') || '{"per_store": true}'::jsonb
where id = 'cloud_monthly';
