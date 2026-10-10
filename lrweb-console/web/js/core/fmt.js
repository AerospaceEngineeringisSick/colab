const moneyFmt = new Map();
export function money(cents, currency = 'USD', { compact = false } = {}) {
  const key = `${currency}${compact}`;
  if (!moneyFmt.has(key)) {
    moneyFmt.set(key, new Intl.NumberFormat(undefined, { style: 'currency', currency, ...(compact ? { notation: 'compact', maximumFractionDigits: 1 } : {}) }));
  }
  return moneyFmt.get(key).format((cents || 0) / 100);
}

const numFmt = new Intl.NumberFormat();
export const num = (n) => numFmt.format(n || 0);
export const pct = (n, digits = 0) => `${(n || 0).toFixed(digits)}%`;

export function bytes(n) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n || 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
export function ago(iso) {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const steps = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, secs] of steps) if (Math.abs(s) >= secs) return rtf.format(Math.round(s / secs), unit);
  return 'just now';
}

export const date = (iso, opts = { year: 'numeric', month: 'short', day: 'numeric' }) =>
  iso ? new Intl.DateTimeFormat(undefined, opts).format(new Date(iso)) : '';

export function uptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

export const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
