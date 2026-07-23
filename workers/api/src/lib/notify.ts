import type { Env } from '../env';

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
