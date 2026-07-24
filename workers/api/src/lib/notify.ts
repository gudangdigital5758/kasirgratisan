import type { Env } from '../env';

/**
 * Push via OneSignal REST API (opsional).
 * External ID = Supabase user id (sama dengan oneSignalLogin di client).
 * Docs: https://documentation.onesignal.com/reference/create-notification
 */
export async function sendPush(
  env: Env,
  opts: {
    externalUserId: string;
    title: string;
    body: string;
    url?: string;
    data?: Record<string, string>;
  },
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const appId = env.ONESIGNAL_APP_ID;
  const restKey = env.ONESIGNAL_REST_API_KEY;
  if (!appId || !restKey) {
    console.log('[notify] OneSignal belum dikonfigurasi — skip push', opts.externalUserId);
    return { ok: false, error: 'onesignal_not_configured' };
  }
  if (!opts.externalUserId) {
    return { ok: false, error: 'missing_external_id' };
  }

  const payload: Record<string, unknown> = {
    app_id: appId,
    include_aliases: {
      external_id: [opts.externalUserId],
    },
    target_channel: 'push',
    headings: { en: opts.title, id: opts.title },
    contents: { en: opts.body, id: opts.body },
  };
  if (opts.url) {
    payload.url = opts.url;
  }
  if (opts.data) {
    payload.data = opts.data;
  }

  try {
    const res = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: {
        Authorization: `Key ${restKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      errors?: unknown;
      error?: string;
    };
    if (!res.ok) {
      console.warn('[notify] OneSignal gagal', res.status, data);
      // Fallback API key style (Basic) untuk key format lama
      if (res.status === 401 || res.status === 403) {
        const res2 = await fetch('https://onesignal.com/api/v1/notifications', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${restKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            app_id: appId,
            include_external_user_ids: [opts.externalUserId],
            channel_for_external_user_ids: 'push',
            headings: { en: opts.title, id: opts.title },
            contents: { en: opts.body, id: opts.body },
            url: opts.url,
            data: opts.data,
          }),
        });
        const data2 = (await res2.json().catch(() => ({}))) as { id?: string; errors?: unknown };
        if (!res2.ok) {
          console.warn('[notify] OneSignal v1 fallback gagal', res2.status, data2);
          return { ok: false, error: JSON.stringify(data2.errors || data2) };
        }
        return { ok: true, id: data2.id };
      }
      return { ok: false, error: JSON.stringify(data.errors || data.error || res.status) };
    }
    return { ok: true, id: data.id };
  } catch (err) {
    console.warn('[notify] OneSignal exception', err);
    return { ok: false, error: err instanceof Error ? err.message : 'push_failed' };
  }
}

/** Kirim email via Resend (opsional — no-op jika key kosong). */
export async function sendEmail(
  env: Env,
  opts: { to: string; subject: string; html: string },
): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!env.RESEND_API_KEY) {
    console.log('[notify] RESEND_API_KEY kosong — skip email', opts.to, opts.subject);
    return { ok: false, error: 'resend_not_configured' };
  }
  const from = env.RESEND_FROM || 'Profitku <noreply@profitku.my.id>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) {
    console.warn('[notify] Resend gagal', res.status, data);
    return { ok: false, error: data.message || String(res.status) };
  }
  return { ok: true, id: data.id };
}

/** Kirim WhatsApp via Fonnte (opsional). */
export async function sendWhatsApp(
  env: Env,
  opts: { target: string; message: string },
): Promise<{ ok: boolean; error?: string }> {
  if (!env.FONNTE_TOKEN) {
    console.log('[notify] FONNTE_TOKEN kosong — skip WA', opts.target);
    return { ok: false, error: 'fonnte_not_configured' };
  }
  // Normalisasi nomor ID: 08… → 628…
  let target = opts.target.replace(/\D/g, '');
  if (target.startsWith('0')) target = `62${target.slice(1)}`;

  const res = await fetch('https://api.fonnte.com/send', {
    method: 'POST',
    headers: {
      Authorization: env.FONNTE_TOKEN,
    },
    body: new URLSearchParams({
      target,
      message: opts.message,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { status?: boolean; reason?: string };
  if (!res.ok || data.status === false) {
    console.warn('[notify] Fonnte gagal', res.status, data);
    return { ok: false, error: data.reason || String(res.status) };
  }
  return { ok: true };
}
