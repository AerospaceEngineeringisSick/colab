// Minimal reactive key/value state with optional localStorage persistence for UI prefs.
const data = new Map();
const subs = new Map();

export const state = {
  get: (k, d) => (data.has(k) ? data.get(k) : d),
  set(k, v) {
    if (data.get(k) === v) return;
    data.set(k, v);
    subs.get(k)?.forEach((fn) => fn(v));
  },
  on(k, fn) {
    if (!subs.has(k)) subs.set(k, new Set());
    subs.get(k).add(fn);
    return () => subs.get(k).delete(fn);
  },
};

export const prefs = {
  get(k, d) {
    try { const v = localStorage.getItem(`lrweb.${k}`); return v ?? d; } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem(`lrweb.${k}`, v); } catch { /* storage unavailable */ }
  },
};
