import { h } from './core/dom.js';
import { createRouter } from './core/router.js';
import { api, setToken } from './core/api.js';
import { openSignIn, userChip } from './ui/signin.js';
import { state, prefs } from './core/store.js';
import { icon } from './ui/icons.js';
import { openPalette } from './ui/palette.js';

const routes = [
  { path: '/', title: 'Dashboard', nav: 'dashboard', load: () => import('./views/dashboard.js') },
  { path: '/onboard', title: 'Add a new client', nav: 'onboard', load: () => import('./views/onboard-client.js') },
  { path: '/clients', title: 'Clients', nav: 'clients', load: () => import('./views/clients.js') },
  { path: '/clients/:id', title: 'Client', nav: 'clients', load: () => import('./views/clients.js') },
  { path: '/servers/new', title: 'Add server', nav: 'servers', load: () => import('./views/server-onboard.js') },
  { path: '/servers', title: 'Servers', nav: 'servers', load: () => import('./views/servers.js') },
  { path: '/servers/:id', title: 'Server', nav: 'servers', load: () => import('./views/servers.js') },
  { path: '/traffic', title: 'Traffic', nav: 'traffic', load: () => import('./views/traffic.js') },
  { path: '/traffic/:id', title: 'Traffic', nav: 'traffic', load: () => import('./views/traffic.js') },
  { path: '/migrate', title: 'Move a website', nav: 'migrate', load: () => import('./views/migrate.js') },
  { path: '/sites', title: 'Sites', nav: 'sites', load: () => import('./views/sites.js') },
  { path: '/billing', title: 'Billing', nav: 'billing', load: () => import('./views/billing.js') },
  { path: '/chat', title: 'Secure chat', nav: 'chat', load: () => import('./views/chat.js') },
  { path: '/team', title: 'Team', nav: 'team', load: () => import('./views/team.js') },
  { path: '/settings', title: 'Settings', nav: 'settings', load: () => import('./views/settings.js') },
];

// `dock: true` items stay on the phone dock; the rest live behind "More".
const NAV_GROUPS = [
  { label: 'Run the business', items: [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', path: '/', dock: true },
    { id: 'onboard', label: 'New client', icon: 'rocket', path: '/onboard' },
    { id: 'clients', label: 'Clients', icon: 'users', path: '/clients', dock: true },
    { id: 'sites', label: 'Sites', icon: 'globe', path: '/sites' },
    { id: 'billing', label: 'Billing', icon: 'card', path: '/billing' },
  ] },
  { label: 'Servers', items: [
    { id: 'servers', label: 'Servers', icon: 'server', path: '/servers', dock: true },
    { id: 'traffic', label: 'Traffic', icon: 'activity', path: '/traffic', dock: true },
    { id: 'migrate', label: 'Move a website', icon: 'swap', path: '/migrate' },
  ] },
  { label: 'Together', items: [
    { id: 'chat', label: 'Secure chat', icon: 'chat', path: '/chat', dock: true },
    { id: 'team', label: 'Team', icon: 'key', path: '/team' },
  ] },
  { label: 'System', items: [{ id: 'settings', label: 'Settings', icon: 'settings', path: '/settings' }] },
];
const NAV = NAV_GROUPS.flatMap((g) => g.items);

/* ---------- theme & effects ---------- */

const root = document.documentElement;
function applyTheme() {
  const pref = prefs.get('theme', 'auto');
  const dark = pref === 'dark' || (pref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#070824' : '#f5f8fa');
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
navList.append(...NAV_GROUPS.flatMap((g) => [
  h('li', { class: 'nav-group', 'aria-hidden': 'true' }, g.label),
  ...g.items.map((n) => h('li', { 'data-dock': n.dock ? '1' : '0' }, h('a', { class: 'nav-item', href: `#${n.path}`, 'data-nav': n.id, title: n.label },
    icon(n.icon, { size: 20 }), h('span', { class: 'nav-item__label' }, n.label)))),
]));

// Phone dock: a "More" button opens a glass sheet with everything that doesn't fit.
const moreSheet = h('div', { class: 'glass glass--thick more-sheet', id: 'more-sheet', hidden: true, role: 'menu', 'aria-label': 'More pages' },
  NAV.filter((n) => !n.dock).map((n) => h('a', { class: 'more-sheet__item', href: `#${n.path}`, 'data-nav': n.id, role: 'menuitem' }, icon(n.icon, { size: 22 }), h('span', {}, n.label))));
document.body.append(moreSheet);
const moreBtn = h('button', { type: 'button', class: 'nav-item nav-more', 'aria-label': 'More pages', 'aria-expanded': 'false', 'aria-controls': 'more-sheet' }, icon('more', { size: 22 }), h('span', { class: 'nav-item__label' }, 'More'));
navList.append(h('li', { class: 'nav-more-li' }, moreBtn));
const setMore = (open) => { moreSheet.hidden = !open; moreBtn.setAttribute('aria-expanded', String(open)); moreBtn.classList.toggle('is-active', open); };
moreBtn.addEventListener('click', () => setMore(moreSheet.hidden));
document.addEventListener('pointerdown', (e) => { if (!moreSheet.hidden && !moreSheet.contains(e.target) && !moreBtn.contains(e.target)) setMore(false); });
moreSheet.addEventListener('click', (e) => { if (e.target.closest('a')) setMore(false); });

const router = createRouter({
  routes,
  outlet: document.getElementById('main'),
  onChange: ({ route }) => {
    setMore(false);
    moreBtn.classList.toggle('has-active', NAV.some((n) => !n.dock && n.id === route.nav));
    document.querySelectorAll('.nav-item[data-nav], .more-sheet__item').forEach((a) => {
      const on = a.dataset.nav === route.nav;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  },
});

const commands = [
  ...NAV.map((n) => ({ id: `go-${n.id}`, label: `Go to ${n.label}`, icon: n.icon, run: () => router.navigate(n.path) })),
  { id: 'new-client', label: 'Add a new client', hint: 'Wizard', icon: 'rocket', keywords: 'add create customer', run: () => router.navigate('/onboard') },
  { id: 'new-server', label: 'Add a Linux server', hint: 'Wizard', icon: 'server', keywords: 'onboard cloudpanel vps install', run: () => router.navigate('/servers/new') },
  { id: 'move-site', label: 'Move a website to another server', hint: 'Wizard', icon: 'swap', keywords: 'migrate migration transfer', run: () => router.navigate('/migrate') },
  { id: 'switch-traffic', label: 'Switch visitors to another server', icon: 'activity', keywords: 'failover load balance traffic', run: () => router.navigate('/traffic') },
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

/* ---------- who is signed in ---------- */

const userSlot = document.getElementById('user-slot');
function renderUser() {
  const me = state.get('me');
  userSlot.replaceChildren(me ? userChip({ me, goto: (p) => router.navigate(p), onSignOut: signOut }) : '');
}
state.on('me', renderUser);

async function loadMe() {
  try {
    const r = await api.get('/api/auth/me');
    state.set('me', r.user ? { ...r.user, mode: r.mode } : { mode: r.mode });
    if (r.user?.mustChangePassword && !location.hash.startsWith('#/team')) router.navigate('/team'); // one-time password: pick your own first
  } catch { state.set('me', null); }
}

async function signOut() {
  try { await api.post('/api/auth/logout', {}); } catch { /* the token may already be gone */ }
  setToken('');
  try { (await import('./chat/instance.js')).resetChat(); } catch { /* chat module not loaded */ }
  state.set('me', null);
  location.reload();
}

// Idle sign-out safety net: if a session expires while the tab is open, the next request asks for sign-in again.
window.addEventListener('lrweb:auth-required', async () => {
  const health = state.get('health') ?? await api.get('/api/health').catch(() => null);
  openSignIn({
    accountsEnabled: Boolean(health?.accounts?.enabled),
    onDone: async () => { await Promise.all([loadHealth(), loadMe()]); router.start(); },
  });
});

loadHealth();
loadMe();
router.start();
