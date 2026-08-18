function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

// Lazy accessors so `next build` (no runtime env) doesn't explode at import time.
export const env = {
  get appUrl() {
    return optional("APP_URL", "http://localhost:3000").replace(/\/$/, "");
  },
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get sessionSecret() {
    return required("SESSION_SECRET");
  },
  get tokenEncKey() {
    return required("TOKEN_ENC_KEY");
  },
  get anthropicApiKey() {
    return optional("ANTHROPIC_API_KEY");
  },
  get vapidPublicKey() {
    return optional("VAPID_PUBLIC_KEY");
  },
  get vapidPrivateKey() {
    return optional("VAPID_PRIVATE_KEY");
  },
  get vapidSubject() {
    return optional("VAPID_SUBJECT", "mailto:admin@localhost");
  },
  get monzoClientId() {
    return optional("MONZO_CLIENT_ID");
  },
  get monzoClientSecret() {
    return optional("MONZO_CLIENT_SECRET");
  },
  get monzoRedirectUri() {
    return optional("MONZO_REDIRECT_URI") || `${this.appUrl}/api/oauth/monzo/callback`;
  },
  get monzoWebhookSecret() {
    return optional("MONZO_WEBHOOK_SECRET");
  },
  get lunchflowApiKey() {
    return optional("LUNCHFLOW_API_KEY");
  },
  get timezone() {
    return optional("APP_TZ", "Europe/London");
  },
};

// rpID is the registrable domain of APP_URL — WebAuthn credentials are scoped to it
export function rpID(): string {
  return new URL(env.appUrl).hostname;
}

export function expectedOrigin(): string {
  return new URL(env.appUrl).origin;
}
