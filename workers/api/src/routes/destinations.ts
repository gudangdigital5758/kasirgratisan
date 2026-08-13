/**
 * Profitku API — Destinations (/api/destinations/*)
 * Data wilayah Indonesia statis (CC0/CC-BY, sumber: emsifa/api-wilayah-indonesia).
 * Di-vendor ke src/data/*.json — update: ganti file + redeploy.
 */
import { Hono } from 'hono';
import type { AppEnv, AppContext } from './helpers';
import provinces from '../data/provinces.json';
import regencies from '../data/regencies.json';
import districts from '../data/districts.json';

const destinationsRoutes = new Hono<AppEnv>();

type Item = { id: number; name: string };

destinationsRoutes.get('/destinations/provinces', (c: AppContext) => {
  return c.json({ data: provinces as Item[] });
});

destinationsRoutes.get('/destinations/cities/:provinceId', (c: AppContext) => {
  const provinceId = Number(c.req.param('provinceId'));
  if (!Number.isInteger(provinceId)) return c.json({ error: 'provinceId tidak valid' }, 400);
  const data = (regencies as { id: number; province_id: number; name: string }[]).filter(
    (r) => r.province_id === provinceId,
  );
  return c.json({ data });
});

destinationsRoutes.get('/destinations/districts/:cityId', (c: AppContext) => {
  const cityId = Number(c.req.param('cityId'));
  if (!Number.isInteger(cityId)) return c.json({ error: 'cityId tidak valid' }, 400);
  const data = (districts as { id: number; regency_id: number; name: string }[]).filter(
    (d) => d.regency_id === cityId,
  );
  return c.json({ data });
});

export default destinationsRoutes;
