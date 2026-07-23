/**
 * Cetak perintah wrangler secret put (copy-paste).
 * Tidak menyimpan secret.
 */

console.log(`
# Dari folder workers/api — isi secret production (interaktif):

cd workers/api

npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_FROM
npx wrangler secret put FONNTE_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put PAYMENT_PROVIDER

# Lihat nama secret yang sudah ada:
npx wrangler secret list

# Deploy setelah secret:
npx wrangler deploy

# Panduan lengkap:
# docs/DEPLOY-CLOUD.md
`);
