-- Menu baru: 'products' (Produk) & 'suppliers' (Supplier) — RBAC, 2026-08-16
update public.cloud_team_roles
   set menus = case when menus @> array['products', 'suppliers'] then menus else menus || array['products', 'suppliers'] end,
       updated_at = now()
 where key = 'admin';

update public.cloud_team_roles
   set menus = case when menus @> array['suppliers'] then menus else menus || array['suppliers'] end,
       updated_at = now()
 where key = 'kepala_gudang';
