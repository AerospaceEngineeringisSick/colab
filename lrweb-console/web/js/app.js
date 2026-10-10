import { h } from './core/dom.js';
import { createRouter } from './core/router.js';
import { api, setToken } from './core/api.js';
import { state, prefs } from './core/store.js';
import { toast } from './core/toast.js';
import { icon } from './ui/icons.js';
import { Modal, Button, Field, Input } from './ui/components.js';
import { openPalette } from './ui/palette.js';

const routes = [
  { path: '/', title: 'Dashboard', nav: 'dashboard', load: () => import('./views/dashboard.js') },
  { path: '/onboard', title: 'Onboard client', nav: 'onboard', load: () => import('./views/onboard-client.js') },
  { path: '/clients', title: 'Clients', nav: 'clients', load: () => import('./views/clients.js') },
  { path: '/clients/:id', title: 'Client', nav: 'clients', load: () => import('./views/clients.js') },
  { path: '/servers/new', title: 'Add server', nav: 'servers', load: () => import('./views/server-onboard.js') },
  { path: '/servers', title: 'Servers', nav: 'servers', load: () => import('./views/servers.js') },
  { path: '/servers/:id', title: 'Server', nav: 'servers', load: () => import('./views/servers.js') },
  { path: '/sites', title: 'Sites', nav: 'sites', load: () => import('./views/sites.js') },
  { path: '/billing', title: 'Billing', nav: 'billing', load: () => import('./views/billing.js') },
  { path: '/settings', title: 'Settings', nav: 'settings', load: () => import('./views/settings.js') },
];

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', path: '/' },
  { id: 'onboard', label: 'Onboard client', icon: 'rocket', path: '/onboard' },
  { id: 'clients', label: 'Clients', icon: 'users', path: '/clients' },
  { id: 'servers', label: 'Servers', icon: 'server', path: '/servers' },
  { id: 'sites', label: 'Sites', icon: 'globe', path: '/sites' },
  { id: 'billing', label: 'Billing', icon: 'card', path: '/billing' },
  { id: 'settings', label: 'Settings', icon: 'settings', path: '/settings' },
];

/* ---------- theme & effects ---------- */

const root = document.documentElement;
function applyTheme() {
  const pref = prefs.get('theme', 'auto');
  const dark = pref === 'dark' || (pref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#07080d' : '#eef1fb');
  state.set('theme', pref);
}
function applyFx() {
  const pref = prefs.get('fx', 'auto');
  state.set('fx', pref);
  root.dataset.fx = pref === 'auto' ? (state.get('autoLite') ? 'lite' : 'full') : pref;
}
state.on('prefs', () => { applyTheme(); applyFx(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
if (/Chrome\//.test(navigator.userAgent)) root.classList.add('can-refract'); // Chromium family: SVG backdrop refraction
applyTheme();
applyFx();

// Adaptive quality: if the first ~1.5s of frames are slow, drop heavy effects (user can override in Settings).
if (prefs.get('fx', 'auto') === 'auto') {
  let frames = 0;
  let start = 0;
  const probe = (t) => {
    if (!start) start = t;
    frames++;
    if (t - start < 1500) return requestAnimationFrame(probe);
    const fps = (frames * 1000) / (t - start);
    if (fps < 40) { state.set('autoLite', true); applyFx(); }
  };
  requestAnimationFrame(probe);
}

/* ---------- liquid sheen follows the pointer (one delegated, rAF-throttled listener) ---------- */

let sheenRaf = 0;
document.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' || sheenRaf) return;
  sheenRaf = requestAnimationFrame(() => {
    sheenRaf = 0;
    const g = e.target.closest?.('.glass');
    if (!g) return;
    const r = g.getBoundingClientRect();
    g.style.setProperty('--mx', `${e.clientX - r.left}px`);
    g.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
}, { passive: true });

/* ---------- shell ---------- */

const navList = document.getElementById('nav-list');
navList.append(...NAV.map((n) => h('li', {}, h('a', { class: 'nav-item', href: `#${n.path}`, 'data-nav': n.id, title: n.label },
  icon(n.icon, { size: 20 }), h('span', { class: 'nav-item__label' }, n.label)))));

const router = createRouter({
  routes,
  outlet: document.getElementById('main'),
  onChange: ({ route }) => {
    navList.querySelectorAll('.nav-item').forEach((a) => {
      const on = a.dataset.nav === route.nav;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  },
});

const commands = [
  ...NAV.map((n) => ({ id: `go-${n.id}`, label: `Go to ${n.label}`, icon: n.icon, run: () => router.navigate(n.path) })),
  { id: 'new-client', label: 'Onboard a new client', hint: 'Wizard', icon: 'rocket', keywords: 'add create customer', run: () => router.navigate('/onboard') },
  { id: 'new-server', label: 'Add a Linux server', hint: 'Wizard', icon: 'server', keywords: 'onboard cloudpanel vps install', run: () => router.navigate('/servers/new') },
  { id: 'theme', label: 'Toggle light / dark theme', icon: 'moon', keywords: 'appearance', run: () => { prefs.set('theme', root.dataset.theme === 'dark' ? 'light' : 'dark'); state.set('prefs', Date.now()); } },
];
const palette = () => openPalette(commands);
document.getElementById('open-palette').addEventListener('click', palette);
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); palette(); }
});
document.getElementById('toggle-theme').addEventListener('click', () => {
  prefs.set('theme', root.dataset.theme === 'dark' ? 'light' : 'dark');
  state.set('prefs', Date.now());
});

/* ---------- integration pills in the top bar ---------- */

const pills = document.getElementById('integration-pills');
function renderPills(health) {
  if (!health) return;
  const mk = (name, i) => h('a', { class: ['pill', i.ready ? 'pill--ok' : 'pill--warn'], href: '#/settings', title: `${name}: ${i.label}` },
    h('i', { class: 'pill__dot' }), h('span', {}, name), h('b', {}, i.mode));
  pills.replaceChildren(mk('CloudPanel', health.integrations.cloudpanel), mk('Billing', health.integrations.billing));
}
async function loadHealth() {
  try { const health = await api.get('/api/health'); state.set('health', health); renderPills(health); }
  catch (e) { pills.replaceChildren(h('span', { class: 'pill pill--bad' }, h('i', { class: 'pill__dot' }), 'API offline')); }
}
state.on('health', renderPills);

/* ---------- auth prompt (only when LRWEB_ADMIN_TOKEN is set on the server) ---------- */

let authModal = null;
window.addEventListener('lrweb:auth-required', () => {
  if (authModal) return;
  const input = Input({ type: 'password', placeholder: 'Admin token', autocomplete: 'current-password', autofocus: true });
  const field = Field({ label: 'Admin token', hint: 'Set with LRWEB_ADMIN_TOKEN on the server. Kept for this tab only.' }, input);
  const submit = () => {
    if (!input.value.trim()) return field.setError('Enter the token');
    setToken(input.value.trim());
    authModal.close();
    authModal = null;
    toast({ title: 'Token saved', kind: 'ok' });
    loadHealth();
    router.start();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  authModal = Modal({ title: 'Unlock LRWeb Console', subtitle: 'This server requires an admin token.', size: 'sm', dismissible: false, content: field, actions: [Button({ variant: 'primary', icon: 'lock', onclick: submit }, 'Unlock')] });
});

loadHealth();
router.start();
