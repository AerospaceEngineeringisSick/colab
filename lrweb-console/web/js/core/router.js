import { h } from './dom.js';

const compile = (path) => {
  const keys = [];
  const re = new RegExp(`^${path.replace(/:([a-z]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
  return { re, keys };
};

/**
 * Hash router. routes: [{ path, load: () => import(...), title, nav }]
 * Order matters: put static paths ('/servers/new') before parametrised ones ('/servers/:id').
 */
export function createRouter({ routes, outlet, onChange }) {
  const table = routes.map((r) => ({ ...r, ...compile(r.path) }));
  let controller = null;
  let cleanup = null;
  let ticket = 0;

  const current = () => {
    const raw = location.hash.slice(1) || '/';
    const [path, qs = ''] = raw.split('?');
    return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs)) };
  };

  function match(path) {
    for (const r of table) {
      const m = r.re.exec(path);
      if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }

  async function render() {
    const mine = ++ticket;
    const { path, query } = current();
    const hit = match(path) || match('/');
    controller?.abort();
    try { await cleanup?.(); } catch { /* view cleanup must never block navigation */ }
    cleanup = null;
    controller = new AbortController();
    const { route, params } = hit;
    onChange?.({ path, route, params });
    document.title = `${route.title} · LRWeb Console`;

    const root = h('div', { class: 'view stack', 'data-route': route.nav });
    outlet.replaceChildren(root);
    outlet.scrollTo?.(0, 0);
    window.scrollTo(0, 0);

    try {
      const mod = await route.load();
      if (mine !== ticket) return;
      const ctx = { params, query, navigate, signal: controller.signal };
      const result = await mod.default(root, ctx);
      if (mine !== ticket) { try { await result?.(); } catch { /* ignore */ } return; }
      cleanup = typeof result === 'function' ? result : null;
    } catch (e) {
      if (e.name === 'AbortError' || mine !== ticket) return;
      console.error(e);
      root.replaceChildren(h('div', { class: 'glass card empty' },
        h('h2', {}, 'This view failed to load'), h('p', { class: 'muted' }, e.message),
        h('button', { class: 'btn btn--primary btn--md', onclick: render }, h('span', { class: 'btn__label' }, 'Try again'))));
    }
    outlet.focus({ preventScroll: true });
  }

  function navigate(path) {
    if (`#${path}` === location.hash) render();
    else location.hash = path;
  }

  window.addEventListener('hashchange', render);
  return { start: render, navigate, current };
}
