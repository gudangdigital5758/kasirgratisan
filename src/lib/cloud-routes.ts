/**
 * Canonical client routes for Profitku Cloud hub.
 * Use these instead of hard-coded `/settings/cloud-backup` paths.
 */
export const CLOUD_ROUTES = {
  hub: '/settings/cloud',
  auto: '/settings/cloud/auto',
  files: '/settings/cloud/files',
  history: '/settings/cloud/history',
  stores: '/settings/cloud/stores',
  onlineStore: '/settings/cloud/online-store',
} as const;

export type CloudRouteKey = keyof typeof CLOUD_ROUTES;

/** Legacy paths → hub tree (for redirects & migration). */
export const CLOUD_LEGACY_REDIRECTS: ReadonlyArray<{ from: string; to: string }> = [
  { from: '/settings/cloud-backup', to: CLOUD_ROUTES.hub },
  { from: '/settings/cloud-backup/auto', to: CLOUD_ROUTES.auto },
  { from: '/settings/cloud-backup/files', to: CLOUD_ROUTES.files },
  { from: '/settings/cloud-backup/history', to: CLOUD_ROUTES.history },
  { from: '/settings/cloud-backup/stores', to: CLOUD_ROUTES.stores },
  { from: '/settings/cloud-backup/online-store', to: CLOUD_ROUTES.onlineStore },
];
