const TOKEN_KEY = 'lrweb.token';

export class ApiError extends Error {
  constructor(status, code, message, field) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export const getToken = () => {
  try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
};
export const setToken = (t) => {
  try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
};

async function request(method, path, { params, body, signal } = {}) {
  const url = new URL(path, location.origin);
  if (params) for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v);
  const headers = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(url, { method, headers, signal, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'network', 'Cannot reach the LRWeb server. Is it running?');
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }
  if (res.status === 401) window.dispatchEvent(new CustomEvent('lrweb:auth-required'));
  if (!res.ok || json?.ok === false) {
    const e = json?.error;
    throw new ApiError(res.status, e?.code || 'error', e?.message || res.statusText || 'Request failed', e?.field);
  }
  return json?.data ?? null;
}

export const api = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts) => request('POST', path, { ...opts, body: body ?? {} }),
  put: (path, body, opts) => request('PUT', path, { ...opts, body: body ?? {} }),
  del: (path, opts) => request('DELETE', path, opts),
};

export const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });

/** Poll a job until it is done/failed. onUpdate fires on every poll. */
export async function pollJob(id, onUpdate, { interval = 650, signal } = {}) {
  for (;;) {
    const job = await api.get(`/api/jobs/${id}`, { signal });
    onUpdate?.(job);
    if (job.status === 'done' || job.status === 'failed') return job;
    await sleep(interval, signal);
  }
}
