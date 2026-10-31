// WhatsApp Cloud API settings, read from the environment at call time (so tests can set them).
// Nothing here is cached: Dokploy "Redeploy" after changing a value is enough.

const env = (name, fallback = '') => (process.env[name] ?? fallback).toString().trim();

const config = {
  get verifyToken() { return env('WHATSAPP_VERIFY_TOKEN'); },
  get accessToken() { return env('WHATSAPP_ACCESS_TOKEN'); },
  get phoneNumberId() { return env('WHATSAPP_PHONE_NUMBER_ID'); },
  get appSecret() { return env('WHATSAPP_APP_SECRET'); },
  get apiVersion() { return env('WHATSAPP_API_VERSION', 'v22.0'); },
  // Public base URL of the Act PDFs (served by the frontend container): <assetsBase>/docs/<file>.pdf
  get assetsBase() { return env('PUBLIC_ASSETS_BASE', 'https://valardemo.welocalhost.com/assets').replace(/\/+$/, ''); },
  // No token = log outgoing messages instead of calling Meta (local development, tests).
  get dryRun() { return env('WHATSAPP_DRY_RUN') === '1' || !this.accessToken || !this.phoneNumberId; },
  // Accept unsigned webhooks only when explicitly allowed (local testing with curl).
  get allowUnsigned() { return env('WHATSAPP_ALLOW_UNSIGNED') === '1'; },
  get adminToken() { return env('ADMIN_TOKEN'); },
  // Optional: POST {phone, name, lang, reason, transcript} here when a chat is handed to an officer.
  get handoverWebhook() { return env('HANDOVER_WEBHOOK_URL'); },
  // Approved template for complaint updates outside the 24-hour window: body param {{1}} = complaint ref.
  get complaintTemplate() { return env('WHATSAPP_TEMPLATE_COMPLAINT_UPDATE'); },
  get stateDir() { return env('STATE_DIR', 'runtime'); },
  get sessionTtlMs() { return Number(env('SESSION_TTL_MIN', '1440')) * 60 * 1000; },
  get handoverTtlMs() { return Number(env('HANDOVER_TTL_MIN', '60')) * 60 * 1000; },
  get ratePerMinute() { return Number(env('WHATSAPP_RATE_LIMIT_PER_MIN', '20')); },
  // True when every value needed to receive from and send to Meta is present.
  get configured() { return Boolean(this.verifyToken && this.accessToken && this.phoneNumberId && this.appSecret); },
  get missing() {
    return [['WHATSAPP_VERIFY_TOKEN', this.verifyToken], ['WHATSAPP_ACCESS_TOKEN', this.accessToken],
      ['WHATSAPP_PHONE_NUMBER_ID', this.phoneNumberId], ['WHATSAPP_APP_SECRET', this.appSecret]]
      .filter(([, v]) => !v).map(([k]) => k);
  },
};

module.exports = config;
