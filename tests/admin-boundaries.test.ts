import { describe, expect, it, vi } from 'vitest';
import { createAdminRequest } from '../admin/src/lib/api';
import {
  validateActionButtons,
  validatePlatformSettings,
} from '../workers/api/src/lib/settings-validation';

describe('admin request auth boundary', () => {
  it('refreshes once after 401 and retries with the fresh token', async () => {
    const getToken = vi.fn(async (forceRefresh: boolean) =>
      forceRefresh ? 'fresh-token' : 'expired-token',
    );
    const onUnauthorized = vi.fn(async () => undefined);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"error":"unauthorized"}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));

    const request = createAdminRequest(
      { getToken, onUnauthorized },
      { baseUrl: 'https://api.example.test', fetcher },
    );

    await expect(request<{ ok: boolean }>('/admin/api/settings')).resolves.toEqual({ ok: true });
    expect(getToken.mock.calls).toEqual([[false], [true]]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('Authorization')).toBe(
      'Bearer fresh-token',
    );
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('clears local auth after the refreshed request is still unauthorized', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"error":"unauthorized"}', { status: 401 }),
    );
    const onUnauthorized = vi.fn(async () => undefined);
    const request = createAdminRequest(
      {
        getToken: async () => 'token',
        onUnauthorized,
      },
      { baseUrl: 'https://api.example.test', fetcher },
    );

    await expect(request('/admin/api/settings')).rejects.toThrow('HTTP 401');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});

describe('settings validation boundary', () => {
  const validButtons = {
    whatsNew: { enabled: true },
    requestFeature: { enabled: true, url: 'https://profitku.my.id/request' },
    donate: { enabled: true, url: 'mailto:support@profitku.my.id' },
    telegram: { enabled: true, url: 'https://t.me/profitku' },
  };

  it('accepts supported links and rejects executable URL protocols', () => {
    expect(validateActionButtons(validButtons)).toBeNull();
    expect(
      validateActionButtons({
        ...validButtons,
        telegram: { enabled: true, url: 'javascript:alert(1)' },
      }),
    ).toMatch(/protokol URL/);
  });

  it('rejects invalid platform flag types', () => {
    expect(validatePlatformSettings({ maintenance_mode: 'yes' })).toMatch(/harus boolean/);
    expect(validatePlatformSettings({ unexpected_flag: true })).toMatch(/tidak diizinkan/);
  });
});