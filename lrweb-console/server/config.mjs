// Central configuration. Everything comes from environment variables so secrets never touch the browser.
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const int = (v, d) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};

export function loadConfig(env = process.env) {
  return {
    root: ROOT,
    publicDir: fileURLToPath(new URL('../web/', import.meta.url)),
    port: int(env.PORT ?? env.LRWEB_PORT, 8787),
    host: env.LRWEB_HOST || '127.0.0.1',
    dataDir: env.LRWEB_DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url)),
    adminToken: env.LRWEB_ADMIN_TOKEN || '',
    // Artificial latency (ms) per step in mock mode so the UI can show live progress. 0 disables.
    demoDelayMs: int(env.LRWEB_DEMO_DELAY_MS, 700),
    cloudpanel: {
      // 'mock' | 'ssh'  (CloudPanel has no REST API; live mode drives `clpctl` over SSH)
      mode: (env.LRWEB_CLOUDPANEL_MODE || 'mock').toLowerCase(),
      ssh: {
        keyPath: env.LRWEB_SSH_KEY || '',
        knownHostsPath: env.LRWEB_SSH_KNOWN_HOSTS || '',
        connectTimeoutSec: int(env.LRWEB_SSH_TIMEOUT, 10),
        useSudo: env.LRWEB_CLPCTL_SUDO !== '0',
      },
    },
    billing: {
      // 'mock' | 'whmcs' | 'stripe'
      mode: (env.LRWEB_BILLING_MODE || 'mock').toLowerCase(),
      currency: (env.LRWEB_CURRENCY || 'USD').toUpperCase(),
      whmcs: {
        url: (env.WHMCS_URL || '').replace(/\/+$/, ''),
        identifier: env.WHMCS_API_IDENTIFIER || '',
        secret: env.WHMCS_API_SECRET || '',
        paymentMethod: env.WHMCS_PAYMENT_METHOD || 'banktransfer',
      },
      stripe: {
        secretKey: env.STRIPE_SECRET_KEY || '',
        apiBase: env.STRIPE_API_BASE || 'https://api.stripe.com',
      },
    },
    // Injectable for tests.
    fetch: globalThis.fetch,
  };
}

/** Returns a list of human-readable problems; an empty list means the config is usable. */
export function validateConfig(cfg) {
  const problems = [];
  const live = cfg.cloudpanel.mode !== 'mock' || cfg.billing.mode !== 'mock';
  if (!['mock', 'ssh'].includes(cfg.cloudpanel.mode)) problems.push(`LRWEB_CLOUDPANEL_MODE must be "mock" or "ssh" (got "${cfg.cloudpanel.mode}")`);
  if (!['mock', 'whmcs', 'stripe'].includes(cfg.billing.mode)) problems.push(`LRWEB_BILLING_MODE must be "mock", "whmcs" or "stripe" (got "${cfg.billing.mode}")`);
  if (live && !cfg.adminToken) problems.push('LRWEB_ADMIN_TOKEN is required when any live integration is enabled');
  if (live && cfg.adminToken && cfg.adminToken.length < 16) problems.push('LRWEB_ADMIN_TOKEN must be at least 16 characters');
  if (cfg.cloudpanel.mode === 'ssh' && !cfg.cloudpanel.ssh.keyPath) problems.push('LRWEB_SSH_KEY is required for CloudPanel ssh mode');
  if (cfg.billing.mode === 'whmcs') {
    const w = cfg.billing.whmcs;
    if (!w.url || !w.identifier || !w.secret) problems.push('WHMCS_URL, WHMCS_API_IDENTIFIER and WHMCS_API_SECRET are required for WHMCS billing');
  }
  if (cfg.billing.mode === 'stripe' && !cfg.billing.stripe.secretKey) problems.push('STRIPE_SECRET_KEY is required for Stripe billing');
  return problems;
}
