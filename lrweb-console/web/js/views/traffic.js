// Traffic: the pool list (#/traffic) and one pool (#/traffic/:id). Saved changes go through the API.
// The live map and "Try it yourself" are practice only: they run the shared balancer in the browser
// and never call the server.
import { h, svg, ensureCss } from '../core/dom.js';
import { api, pollJob } from '../core/api.js';
import { ago } from '../core/fmt.js';
import { toast } from '../core/toast.js';
import { icon } from '../ui/icons.js';
import { AreaChart, Donut } from '../ui/charts.js';
import { Term } from '../ui/glossary.js';
import {
  ALGORITHMS, DEFAULT_HEALTH_CHECK, createBalancer, isValidAddress, isValidDomain, validateHealthCheck, validateWeights,
} from '../lib/lb-algorithms.js';
import {
  PageHeader, Card, Button, Badge, Table, Empty, ErrorState, Skeleton, Field, Input, Select, Segmented, Switch,
  Modal, Confirm, JobProgress, CopyBlock, loadInto, setLoading,
} from '../ui/components.js';

const REFRESH_MS = 30_000;
const CAP_DOTS = 24; // visible dots on the map at once; the counts still include every visit
const RATE = [6, 10]; // simulated visits a second
const FLIGHT_MS = 1100;
const MIN_MEMBERS = 2;
const MAX_MEMBERS = 4;

const POOL_STATUS = { healthy: ['ok', 'All good'], degraded: ['warn', 'Needs attention'], down: ['bad', 'Down'] };
const MODE = { balanced: ['info', 'Sharing visitors'], failover: ['neutral', 'Using one server'] };
const MEMBER_STATUS = { healthy: ['ok', 'All good'], unhealthy: ['bad', 'Not responding'], draining: ['warn', 'Finishing up'], unknown: ['warn', 'Checking'] };
const ROLE = { active: 'Active', standby: 'Spare', drain: 'Stopped' };
const ALGO = Object.fromEntries(ALGORITHMS.map((a) => [a.id, a]));
const ALGO_TERM = { round_robin: 'round robin', least_conn: 'least connections', ip_hash: 'ip hash', random_two: 'random two' };
const SERIES_COLORS = ['var(--accent)', 'var(--accent-3)', 'var(--accent-2)', 'var(--warn)', 'var(--bad)'];

const enc = encodeURIComponent;
const poolPath = (id) => `/api/lb/pools/${enc(id)}`;
const requestsText = (v) => `${Number(v || 0).toFixed(1)} requests a second`;
const msText = (v) => `${Math.round(v || 0)} ms`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const clockFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const hhmm = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : clockFmt.format(d);
};
const totalRps = (pool) => pool.members.reduce((sum, m) => sum + (m.rps || 0), 0);
const toneOf = (status) => (status === 'healthy' ? 'ok' : status === 'unhealthy' ? 'bad' : 'warn');
const currentMember = (pool) => pool.members.find((m) => m.id === pool.activeMemberId)
  || pool.members.find((m) => m.role === 'active') || pool.members[0];

function algoLabel(id) {
  const a = ALGO[id];
  if (!a) return id;
  const key = ALGO_TERM[id] || (id === 'weighted' ? 'weight' : null);
  return key ? Term(key, a.label) : a.label;
}

function callout(kind, message, title) {
  const ic = kind === 'ok' ? 'check' : kind === 'bad' ? 'alert' : kind === 'warn' ? 'alert' : 'info';
  return h('div', { class: ['callout', kind !== 'info' && `callout--${kind}`], role: kind === 'bad' ? 'alert' : 'status' },
    icon(ic, { size: 18 }),
    h('div', {}, title && h('strong', {}, title), h('p', {}, message)));
}

export default async function mount(root, ctx) {
  await ensureCss('css/view-traffic.css');
  return ctx.params.id ? mountDetail(root, ctx) : mountList(root, ctx);
}

/* ---------- list ---------- */

function mountList(root, ctx) {
  const fetchList = () => api.get('/api/lb/pools', { signal: ctx.signal });
  const list = h('div', { class: 'stack' });
  const newPool = () => openCreate(ctx, (pool) => ctx.navigate(`/traffic/${enc(pool.id)}`));
  const refreshBtn = Button({
    variant: 'glass', icon: 'refresh',
    onclick: () => { setLoading(refreshBtn, true); loadInto(list, fetchList, render).finally(() => setLoading(refreshBtn, false)); },
  }, 'Refresh');
  const head = PageHeader({
    title: 'Traffic',
    subtitle: 'Spread visitors across servers, and move them between servers safely',
    actions: [refreshBtn, Button({ variant: 'primary', icon: 'plus', onclick: newPool }, 'New traffic pool')],
  });
  root.append(head, list);

  function render(pools) {
    const intro = h('p', { class: 'traffic-intro' },
      'Each site below has a ', Term('load balancer'),
      ', a traffic director that sends every visitor to one of your servers and skips any that are not responding.');
    if (!pools.length) {
      return [intro, Card({}, Empty({
        icon: 'activity', title: 'No traffic pools yet',
        message: 'A pool puts one website address in front of two or more servers. Visitors are shared between them, and a spare can take over if a main server stops responding.',
        action: Button({ variant: 'primary', icon: 'plus', onclick: newPool }, 'New traffic pool'),
      }))];
    }
    return [intro, h('div', { class: 'grid grid--3 traffic-grid' }, pools.map(poolCard))];
  }

  // Background refresh: no skeleton, and a failed poll keeps the last good list.
  async function quiet() {
    try { list.replaceChildren(...[].concat(render(await fetchList())).filter(Boolean)); } catch { /* keep what is on screen */ }
  }

  loadInto(list, fetchList, render);
  const timer = setInterval(quiet, REFRESH_MS);
  return () => clearInterval(timer);
}

function poolCard(p) {
  const href = `#/traffic/${enc(p.id)}`;
  const [kind, text] = POOL_STATUS[p.status] || ['neutral', p.status];
  const [modeKind, modeText] = MODE[p.mode] || ['neutral', p.mode];
  return h('article', { class: 'glass glass--interactive card traffic-card' },
    h('div', { class: 'traffic-card__top' },
      h('div', { class: 'traffic-card__id' },
        h('a', { class: 'traffic-card__domain', href }, p.domain),
        h('p', { class: 'muted traffic-card__name' }, p.name)),
      Badge({ kind }, text)),
    h('div', { class: 'row traffic-card__chips' },
      h('span', { class: 'chip' }, algoLabel(p.algorithm)),
      Badge({ kind: modeKind, dot: false }, modeText),
      p.sticky && h('span', { class: 'chip' }, Term('sticky sessions', 'Same server per visitor'))),
    h('ul', { class: 'traffic-dots', 'aria-label': 'Servers in this pool' }, p.members.map((m) => {
      const [mk, mt] = MEMBER_STATUS[m.status] || ['warn', m.status];
      return h('li', { class: ['traffic-dot', `traffic-dot--${mk}`], title: `${m.name}: ${mt}`, 'aria-label': `${m.name}: ${mt}`, tabindex: 0 }, h('span', { class: 'traffic-dot__name' }, m.name));
    })),
    h('div', { class: 'traffic-card__foot muted' },
      h('span', { class: 'num' }, requestsText(totalRps(p))),
      h('span', {}, `${plural(p.members.length, 'server')}`)));
}

/* ---------- create a pool ---------- */

function openCreate(ctx, onCreated) {
  const banner = h('div', { class: 'stack' });
  const body = h('div', { class: 'stack' }, Skeleton({ lines: 5 }));
  const create = Button({ variant: 'primary', icon: 'plus', disabled: true, onclick: () => submit() }, 'Create pool');
  const m = Modal({
    title: 'New traffic pool',
    subtitle: 'Visitors to one website address are shared across the servers you choose.',
    size: 'lg', content: body,
    actions: [Button({ variant: 'ghost', onclick: () => m.close() }, 'Cancel'), create],
  });
  ctx.signal.addEventListener('abort', () => m.close(), { once: true });

  let form = null;
  api.get('/api/servers', { signal: ctx.signal }).then((servers) => {
    form = buildCreateForm(servers, banner);
    body.replaceChildren(banner, form.el);
    create.disabled = !form.canCreate;
    form.focusFirst();
  }).catch((e) => { if (e.name !== 'AbortError') body.replaceChildren(ErrorState(e)); });

  async function submit() {
    if (!form.validate()) return;
    setLoading(create, true);
    try {
      const pool = await api.post('/api/lb/pools', form.payload(), { signal: ctx.signal });
      toast({ title: 'Traffic pool created', message: pool.domain, kind: 'ok' });
      m.close();
      onCreated(pool);
    } catch (e) {
      if (e.name === 'AbortError') return;
      setLoading(create, false);
      form.showError(e);
    }
  }
}

function buildCreateForm(servers, banner) {
  const usable = servers.filter((s) => s.status !== 'pending');
  const online = servers.filter((s) => s.status === 'online');
  const optsFor = (list) => list.map((s) => ({ value: s.id, label: `${s.name} (${s.host})` }));

  const name = Input({ placeholder: 'Tidewater main site', maxlength: 80 });
  const domain = Input({ placeholder: 'tidewater.example', autocapitalize: 'off' });
  const entry = Select({
    options: [{ value: '', label: online.length ? 'Choose a server' : 'No online servers yet' }, ...optsFor(online)],
    value: '',
  });
  const algo = Select({ options: ALGORITHMS.map((a) => ({ value: a.id, label: a.label })), value: 'weighted' });
  const algoText = h('span', {}, ALGO.weighted.description);
  algo.addEventListener('change', () => { algoText.textContent = ALGO[algo.value]?.description ?? ''; });

  const fName = Field({ label: 'Pool name', hint: 'Only you see this name.', required: true }, name);
  const fDomain = Field({ label: 'Website address', hint: 'The address visitors type, without https://', required: true }, domain);
  const fEntry = Field({ label: 'Entry server', hint: 'The server that receives every visitor first. Only online servers are listed.', required: true }, entry);
  const fAlgo = Field({ label: 'How visitors are shared', hint: algoText }, algo);

  const sticky = Switch({ label: 'Keep visitors on the same server' });
  const stickyBox = sticky.querySelector('input');
  const stickyHint = h('p', { class: 'field__hint muted' }, Term('sticky sessions'),
    ': stops a visit from jumping between servers part way through, so a shopping basket is not lost.');

  const rowsHost = h('div', { class: 'tpool-rows' });
  const rows = [];
  const addBtn = Button({ variant: 'glass', size: 'sm', icon: 'plus', onclick: () => addRow() }, 'Add a server');

  function syncRows() {
    addBtn.disabled = rows.length >= MAX_MEMBERS;
    rows.forEach((r) => { r.remove.disabled = rows.length <= MIN_MEMBERS; });
  }

  function removeRow(row) {
    if (rows.length <= MIN_MEMBERS) return;
    rows.splice(rows.indexOf(row), 1);
    row.el.remove();
    syncRows();
  }

  function addRow(init = {}) {
    const i = rows.length;
    const pick = usable.find((s) => s.id === init.serverId) ?? usable[i % Math.max(1, usable.length)];
    const serverSel = Select({ options: optsFor(usable), value: pick?.id ?? '' });
    const addr = Input({ value: pick ? `${pick.host}:80` : '', placeholder: 'host:port' });
    const weight = Input({ type: 'number', min: 1, max: 100, step: 1, value: init.weight ?? 1, inputmode: 'numeric' });
    const role = Select({
      options: [{ value: 'active', label: 'Active' }, { value: 'standby', label: 'Spare' }],
      value: init.role ?? (i < 2 ? 'active' : 'standby'),
    });
    const row = {
      serverSel, addr, weight, role,
      fServer: Field({ label: 'Server' }, serverSel),
      fAddr: Field({ label: 'Address (host:port)' }, addr),
      fWeight: Field({ label: 'Weight' }, weight),
      fRole: Field({ label: 'Role' }, role),
    };
    row.remove = Button({
      variant: 'ghost', size: 'sm', icon: 'x', class: 'tpool-remove', title: 'Remove this server',
      'aria-label': `Remove server ${i + 1}`, onclick: () => removeRow(row),
    });
    row.el = h('div', { class: 'tpool-row' }, row.fServer, row.fAddr, row.fWeight, row.fRole, row.remove);
    serverSel.addEventListener('change', () => {
      const s = usable.find((x) => x.id === serverSel.value);
      if (s) { addr.value = `${s.host}:80`; row.fAddr.setError(''); }
    });
    rows.push(row);
    rowsHost.append(row.el);
    syncRows();
  }

  const el = h('div', { class: 'stack tpool-form' },
    h('div', { class: 'form-grid' }, fName, fDomain, fEntry, fAlgo),
    h('div', { class: 'tpool-sticky' }, sticky, stickyHint),
    h('div', { class: 'tpool-members' },
      h('div', { class: 'spread' }, h('h3', { class: 'tpool-members__title' }, 'Servers in this pool'), addBtn),
      h('p', { class: 'muted' }, 'Two to four servers. Active servers share visits, using the weight as each one\'s share (1 to 100). Spares only take visits when no Active server is up. The address is usually the server address with port 80.'),
      rowsHost));

  if (!online.length) banner.append(callout('warn', 'No server is online yet. Check a server first, then come back to create the pool.'));
  addRow({ serverId: usable[0]?.id, role: 'active' });
  addRow({ serverId: usable[1]?.id ?? usable[0]?.id, role: 'active' });

  function validate() {
    const all = [fName, fDomain, fEntry, fAlgo, ...rows.flatMap((r) => [r.fServer, r.fAddr, r.fWeight, r.fRole])];
    all.forEach((x) => x.setError(''));
    let ok = true;
    const fail = (field, msg) => { field.setError(msg); ok = false; };
    if (!name.value.trim()) fail(fName, 'Give the pool a name, for example "Tidewater main site".');
    if (!isValidDomain(domain.value.trim().toLowerCase())) fail(fDomain, 'Enter a website address such as tidewater.example.');
    if (!entry.value) fail(fEntry, 'Choose the server that receives visitors first.');
    rows.forEach((r) => {
      if (!r.serverSel.value) fail(r.fServer, 'Choose a server.');
      if (!isValidAddress(r.addr.value.trim())) fail(r.fAddr, 'Use host:port, for example 192.0.2.10:80.');
      const w = Number(r.weight.value);
      if (!Number.isInteger(w) || w < 1 || w > 100) fail(r.fWeight, 'Weight must be a whole number from 1 to 100.');
    });
    if (!rows.some((r) => r.role.value === 'active')) fail(rows[0].fRole, 'At least one server must be Active.');
    if (!ok) el.querySelector('.has-error .input, .has-error .select')?.focus();
    return ok;
  }

  function payload() {
    return {
      name: name.value.trim(),
      domain: domain.value.trim().toLowerCase(),
      serverId: entry.value,
      algorithm: algo.value,
      sticky: stickyBox.checked,
      members: rows.map((r) => ({ serverId: r.serverSel.value, address: r.addr.value.trim(), weight: Number(r.weight.value), role: r.role.value })),
    };
  }

  // Field errors from the API land on the matching control; anything else goes in the banner.
  function showError(e) {
    const direct = { name: fName, domain: fDomain, serverId: fEntry, algorithm: fAlgo };
    const hit = /^members\[(\d+)\]\.(\w+)$/.exec(e.field || '');
    if (hit && rows[Number(hit[1])]) {
      const r = rows[Number(hit[1])];
      const target = { serverId: r.fServer, address: r.fAddr, weight: r.fWeight, role: r.fRole }[hit[2]] || r.fAddr;
      target.setError(e.message);
      return;
    }
    if (e.field && direct[e.field]) { direct[e.field].setError(e.message); return; }
    banner.replaceChildren(callout('bad', e.message));
  }

  return {
    el,
    canCreate: online.length > 0,
    validate,
    payload,
    showError,
    focusFirst: () => name.focus({ preventScroll: true }),
  };
}

/* ---------- detail: loading and the cards ---------- */

function mountDetail(root, ctx) {
  const id = ctx.params.id;
  const page = h('div', { class: 'stack traffic-detail' });
  root.append(h('a', { class: 'link back-link', href: '#/traffic' }, icon('chevron-left', { size: 18 }), 'Traffic'), page);

  const d = {
    ctx, id, pool: null, traffic: null, config: null, servers: [], v: null, sim: null, popover: null,
    overrides: new Map(), // practice only: member id -> true (pretend up) or false (pretend down)
    counts: new Map(), // visits sent to each member since this page opened (practice only)
    visits: 0, failed: 0, seq: 0,
  };
  let timer = null;

  function notFound() {
    return Card({}, Empty({
      icon: 'activity', title: 'Traffic pool not found',
      message: 'No pool matches this address. It may have been deleted.',
      action: Button({ variant: 'glass', icon: 'chevron-left', onclick: () => ctx.navigate('/traffic') }, 'Back to traffic'),
    }));
  }

  async function load() {
    const mine = ++d.seq;
    page.replaceChildren(Skeleton({ lines: 6 }));
    try {
      const [pool, traffic, config, servers] = await Promise.all([
        api.get(poolPath(id), { signal: ctx.signal }),
        api.get(`${poolPath(id)}/traffic`, { signal: ctx.signal }),
        api.get(`${poolPath(id)}/config`, { signal: ctx.signal }),
        api.get('/api/servers', { signal: ctx.signal }).catch(() => []),
      ]);
      if (mine !== d.seq) return;
      Object.assign(d, { pool, traffic, config, servers });
      build();
    } catch (e) {
      if (e.name === 'AbortError' || mine !== d.seq) return;
      page.replaceChildren(e.status === 404 ? notFound() : ErrorState(e, load));
    }
  }

  function build() {
    stopSim(d);
    closePopover(d, { focus: false });
    d.v = {
      header: h('div'), map: h('div'), sharing: h('div'), check: h('div'), health: h('div'),
      traffic: h('div', { class: 'split' }), switchCard: h('div'), setup: h('div'), statusHost: null,
    };
    page.replaceChildren(
      d.v.header,
      d.v.map,
      h('div', { class: 'split' }, d.v.sharing, d.v.check),
      d.v.health,
      d.v.traffic,
      h('div', { class: 'split' }, d.v.switchCard, d.v.setup));
    paintAll(d);
    if (!timer) timer = setInterval(() => refreshLive(d), REFRESH_MS);
  }

  load();
  return () => {
    clearInterval(timer);
    stopSim(d);
    closePopover(d, { focus: false });
    d.v = null;
  };
}

function paintAll(d) {
  paintHeader(d);
  paintMap(d);
  paintSharing(d);
  paintCheck(d);
  paintHealth(d);
  paintTraffic(d);
  paintSwitch(d);
  paintSetup(d);
}

// Full reload after a change the user made: rebuilds every card, so the map and popovers start clean.
async function refreshAll(d, pool) {
  const pid = poolPath(d.id);
  const signal = d.ctx.signal;
  try {
    const [fresh, traffic, config] = await Promise.all([
      pool ?? api.get(pid, { signal }),
      api.get(`${pid}/traffic`, { signal }).catch(() => d.traffic),
      api.get(`${pid}/config`, { signal }).catch(() => d.config),
    ]);
    if (!d.v) return;
    Object.assign(d, { pool: fresh, traffic, config });
    paintAll(d);
  } catch (e) {
    if (e.name !== 'AbortError') toast({ title: 'Could not refresh this page', message: e.message, kind: 'bad' });
  }
}

// Background refresh every 30 s: numbers only, so forms and open popovers are left alone.
async function refreshLive(d) {
  if (!d.v) return;
  const pid = poolPath(d.id);
  try {
    const [pool, traffic] = await Promise.all([
      api.get(pid, { signal: d.ctx.signal }),
      api.get(`${pid}/traffic`, { signal: d.ctx.signal }),
    ]);
    if (!d.v) return;
    const sameShape = d.sim && d.sim.algorithm === pool.algorithm && d.sim.sticky === pool.sticky
      && pool.members.length === d.pool.members.length && pool.members.every((m, i) => m.id === d.pool.members[i].id);
    d.pool = pool;
    d.traffic = traffic;
    d.v.statusHost.replaceChildren(...statusBadges(pool));
    if (sameShape) updateMap(d);
    else paintMap(d);
    paintHealth(d);
    paintTraffic(d);
  } catch { /* keep the last good numbers; the next tick retries */ }
}

function statusBadges(p) {
  const [kind, text] = POOL_STATUS[p.status] || ['neutral', p.status];
  const [modeKind, modeText] = MODE[p.mode] || ['neutral', p.mode];
  return [Badge({ kind }, text), Badge({ kind: modeKind, dot: false }, modeText)];
}

function paintHeader(d) {
  const p = d.pool;
  d.v.statusHost = h('span', { class: 'row traffic-title__tags' }, ...statusBadges(p));
  d.v.header.replaceChildren(PageHeader({
    title: h('span', { class: 'row traffic-title' }, p.domain, d.v.statusHost),
    subtitle: p.name,
    actions: [
      Button({ variant: 'primary', icon: 'arrow-right', onclick: () => focusSwitch(d) }, 'Switch visitors'),
      Button({ variant: 'glass', icon: 'shield', onclick: () => runDrill(d) }, 'Run safety drill'),
    ],
  }));
}

function focusSwitch(d) {
  d.v.switchCard.scrollIntoView({ block: 'start' });
  d.v.switchCard.querySelector('select')?.focus({ preventScroll: true });
}

function paintSharing(d) {
  const p = d.pool;
  const a = ALGO[p.algorithm] || {};
  const key = ALGO_TERM[p.algorithm];
  const seg = Segmented({
    label: 'How visitors are shared',
    options: ALGORITHMS.map((x) => ({ value: x.id, label: x.label })),
    value: p.algorithm,
    onchange: (id) => saveSettings(d, { algorithm: id }, `input[value="${id}"]`),
  });
  const sticky = Switch({
    checked: p.sticky,
    label: 'Keep visitors on the same server',
    onchange: (e) => saveSettings(d, { sticky: e.target.checked }, '.sharing__sticky .switch__input'),
  });
  d.v.sharing.replaceChildren(Card({
    title: 'How visitors are shared',
    subtitle: 'Choose how the load balancer picks a server for each visit. Changes are saved to the live pool.',
  },
    seg,
    h('div', { class: 'sharing__now stack' },
      h('p', {}, a.description),
      h('p', { class: 'muted' }, a.hint),
      key && h('p', { class: 'muted' }, 'In technical terms, this is ', Term(key, a.label), '.')),
    h('div', { class: 'sharing__sticky' },
      sticky,
      h('p', { class: 'muted' }, Term('sticky sessions'), ': a visitor keeps the same server for the whole visit.'))));
}

async function saveSettings(d, patch, focusSel) {
  try {
    const pool = await api.put(poolPath(d.id), patch, { signal: d.ctx.signal });
    const message = patch.algorithm
      ? `Visitors are now shared by: ${ALGO[patch.algorithm].label}.`
      : patch.sticky ? 'Visitors stay on the same server for their whole visit.' : 'Visitors can be sent to a different server on each visit.';
    toast({ title: 'Saved to the live pool', message, kind: 'ok' });
    await refreshAll(d, pool);
    if (focusSel) d.v?.sharing.querySelector(focusSel)?.focus({ preventScroll: true });
  } catch (e) {
    if (e.name === 'AbortError') return;
    toast({ title: 'Could not save', message: e.message, kind: 'bad' });
    if (d.v) paintSharing(d);
  }
}

function paintCheck(d) {
  const hc = { ...DEFAULT_HEALTH_CHECK, ...(d.pool.healthCheck || {}) };
  const rows = [
    ['Page it asks for', h('span', { class: 'mono' }, hc.path)],
    ['Asks every', `${hc.intervalSec} seconds`],
    ['Gives up after', `${hc.timeoutSec} seconds`],
    ['Marked not responding after', `${hc.unhealthyThreshold} failed checks in a row`],
    ['Marked back after', `${hc.healthyThreshold} good checks in a row`],
    ['A good answer is', `HTTP ${hc.expectStatus}`],
  ];
  d.v.check.replaceChildren(Card({
    title: 'Health check',
    subtitle: h('span', {}, 'A ', Term('health check'), ' asks each server if it is OK. These settings decide when a server is marked as not responding.'),
    actions: Button({ variant: 'glass', size: 'sm', icon: 'settings', onclick: () => openHealthEdit(d) }, 'Edit'),
  },
    h('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))));
}

const HEALTH_COLUMNS = [
  { label: 'Server', render: (m) => h('div', { class: 'traffic-srv' }, h('strong', {}, m.name), h('small', { class: 'mono muted' }, m.address)) },
  { label: 'Role', render: (m) => h('span', { class: 'chip' }, ROLE[m.role] || m.role) },
  { label: 'Status', render: (m) => { const [k, t] = MEMBER_STATUS[m.status] || ['neutral', m.status]; return Badge({ kind: k }, t); } },
  { label: 'Weight', align: 'right', render: (m) => h('span', { class: 'num' }, m.weight) },
  { label: 'Connections', align: 'right', render: (m) => h('span', { class: 'num' }, m.connections ?? 0) },
  { label: 'Requests a second', align: 'right', render: (m) => h('span', { class: 'num' }, Number(m.rps || 0).toFixed(1)) },
  { label: 'Slowest 5%', align: 'right', render: (m) => h('span', { class: 'num' }, msText(m.p95ms)) },
  { label: 'Last check', render: (m) => (m.lastCheckAt ? ago(m.lastCheckAt) : 'Not yet') },
];

function paintHealth(d) {
  const members = d.pool.members;
  d.v.health.replaceChildren(Card({
    title: 'Server health',
    subtitle: `${plural(members.length, 'server')}. "Slowest 5%" means 19 in every 20 replies are faster than the time shown.`,
    flush: true,
  }, Table({ columns: HEALTH_COLUMNS, rows: members })));
}

function paintTraffic(d) {
  const t = d.traffic;
  if (!t) return;
  const series = (t.series || []).map((s, i) => ({ name: s.name, values: s.rps || [], color: SERIES_COLORS[i % SERIES_COLORS.length] }));
  const segments = (t.distribution || []).map((x, i) => ({ label: x.name, value: x.share || 0, color: SERIES_COLORS[i % SERIES_COLORS.length] }));
  const legend = h('ul', { class: 'traffic-legend' }, segments.map((s) => h('li', {},
    h('i', { style: { background: s.color } }), h('span', {}, s.label), h('strong', { class: 'num' }, `${Math.round(s.value * 100)}%`))));
  d.v.traffic.replaceChildren(
    Card({ title: 'Traffic, last hour', subtitle: 'Requests a second, one line per server' },
      AreaChart({ series, labels: t.labels || [], height: 240, format: (v) => Number(v).toFixed(0), tipFormat: requestsText, labelFormat: hhmm })),
    Card({ title: 'Share of visits', subtitle: 'Where visitors went in the last hour' },
      h('div', { class: 'traffic-donut' },
        Donut({ segments, size: 148, center: { value: Number(t.totals?.rps || 0).toFixed(1), label: 'a second' } }),
        legend),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Slowest 5%'), h('dd', { class: 'num' }, msText(t.totals?.p95ms)),
        h('dt', {}, 'Failed replies'), h('dd', { class: 'num' }, `${((t.totals?.errorRate || 0) * 100).toFixed(1)}%`))));
}

function paintSetup(d) {
  const c = d.config;
  const body = c?.nginx
    ? [
      h('h3', { class: 'traffic-setup__head' }, 'For whoever applies it to the server'),
      h('p', { class: 'muted' }, 'LRWeb writes this file but does not change the server itself. Someone with server access needs to put it in place.'),
      CopyBlock({ text: c.nginx, label: 'Load balancer settings', maxHeight: 340 }),
      h('div', { class: 'callout', role: 'note' }, icon('info', { size: 18 }),
        h('div', { class: 'stack traffic-notes' }, (c.notes || []).map((n) => h('p', {}, n)))),
    ]
    : [h('p', { class: 'muted' }, 'The setup file is not available right now.')];
  d.v.setup.replaceChildren(Card({ title: 'Server setup file', subtitle: 'The settings the load balancer needs' }, ...body));
}

/* ---------- live map (practice only: never calls the API) ---------- */

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)');

// Practice state wins over the real status, so "Pretend this server goes down" works on a healthy server.
function simHealthy(d, m) {
  return d.overrides.has(m.id) ? d.overrides.get(m.id) : m.status === 'healthy';
}

function toneFor(d, m) {
  if (d.overrides.has(m.id)) return d.overrides.get(m.id) ? 'ok' : 'bad';
  if (m.role === 'drain') return 'warn';
  return toneOf(m.status);
}

function simMembers(d) {
  return d.pool.members.map((m) => ({ id: m.id, weight: m.weight, role: m.role, healthy: simHealthy(d, m) }));
}

function updateNode(d, n) {
  n.btn.dataset.tone = toneFor(d, n.m);
  n.btn.classList.toggle('is-off', n.m.role === 'drain' || !simHealthy(d, n.m));
  n.btn.classList.toggle('is-spare', n.m.role === 'standby');
}

// Cubic curve between two anchors. Wide layout leaves sideways, stacked layout leaves downwards.
function curve([x1, y1], [x2, y2], wide) {
  const c1 = wide ? [x1 + (x2 - x1) * 0.5, y1] : [x1, y1 + (y2 - y1) * 0.5];
  const c2 = wide ? [x2 - (x2 - x1) * 0.5, y2] : [x2, y2 - (y2 - y1) * 0.5];
  return `M${x1.toFixed(1)} ${y1.toFixed(1)}C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

function layout(sim) {
  const { wrap } = sim;
  const box = wrap.getBoundingClientRect();
  if (!box.width) return;
  const wide = box.width >= 640;
  if (wrap.dataset.layout !== (wide ? 'wide' : 'stack')) wrap.dataset.layout = wide ? 'wide' : 'stack';
  const base = wrap.getBoundingClientRect(); // measured after the CSS layout switch
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return {
      l: r.left - base.left, r: r.right - base.left, t: r.top - base.top, b: r.bottom - base.top,
      cx: (r.left + r.right) / 2 - base.left, cy: (r.top + r.bottom) / 2 - base.top,
    };
  };
  sim.lines.setAttribute('viewBox', `0 0 ${base.width} ${base.height}`);
  const v = rect(sim.visitors);
  const e = rect(sim.entry);
  sim.inPath.setAttribute('d', curve(wide ? [v.r, v.cy] : [v.cx, v.b], wide ? [e.l, e.cy] : [e.cx, e.t], wide));
  sim.inLen = sim.inPath.getTotalLength();
  const out = wide ? [e.r, e.cy] : [e.cx, e.b];
  for (const n of sim.nodes.values()) {
    const r = rect(n.btn);
    n.path.setAttribute('d', curve(out, wide ? [r.l, r.cy] : [r.cx, r.t], wide));
    n.len = n.path.getTotalLength();
  }
}

function paintMap(d) {
  stopSim(d);
  closePopover(d, { focus: false });
  const p = d.pool;
  const serverName = (sid) => d.servers.find((s) => s.id === sid)?.name || 'Entry server';

  const wrap = h('div', { class: 'tmap', 'data-layout': 'wide' });
  const lines = svg('svg', { class: 'tmap__lines', 'aria-hidden': 'true', focusable: 'false' });
  const visitors = h('div', { class: 'tmap__node tmap__node--visitors glass' },
    icon('users', { size: 22 }), h('strong', {}, 'Visitors'), h('small', { class: 'muted' }, p.domain));
  const entry = h('div', { class: 'tmap__node tmap__node--lb glass' },
    icon('server', { size: 22 }), h('strong', {}, Term('load balancer', 'Load balancer')),
    h('small', { class: 'muted' }, serverName(p.serverId)));
  const memberBox = h('div', { class: 'tmap__members' });
  const nodes = new Map();

  for (const m of p.members) {
    const shareEl = h('b', { class: 'num' }, '0%');
    const barEl = h('i');
    const btn = h('button', {
      type: 'button', class: 'tmap__node tmap__node--member glass', 'aria-haspopup': 'dialog', 'aria-expanded': 'false',
      'aria-label': `${m.name}, ${ROLE[m.role] || m.role}. Open to try it yourself.`,
      onclick: () => togglePopover(d, m.id, btn),
    },
      h('span', { class: 'tmap__top' }, h('i', { class: 'tmap__ring', 'aria-hidden': 'true' }), h('strong', {}, m.name)),
      h('span', { class: 'tmap__meta muted' }, h('span', { class: 'tmap__role' }, ROLE[m.role] || m.role), `weight ${m.weight}`),
      h('span', { class: 'tmap__share muted' }, shareEl, ' of visits'),
      h('span', { class: 'tmap__bar', 'aria-hidden': 'true' }, barEl));
    nodes.set(m.id, { btn, m, shareEl, barEl, path: svg('path', { class: 'tmap__path' }), len: 0 });
    memberBox.append(btn);
  }

  const inPath = svg('path', { class: 'tmap__path tmap__path--in' });
  wrap.append(lines, visitors, entry, memberBox);
  lines.append(inPath, ...[...nodes.values()].map((n) => n.path)); // paths first, so dots draw on top

  const card = Card({
    title: 'Live traffic map',
    subtitle: 'Each dot is one visit. Tap a server to try it yourself.',
    actions: Button({ variant: 'ghost', size: 'sm', icon: 'refresh', onclick: () => resetPractice(d) }, 'Reset practice'),
  },
    wrap,
    h('div', { class: 'tmap__foot' },
      h('p', { class: 'tmap__caption' }, Term('simulated', 'Simulation'), ': this is a practice view, nothing here touches the real servers.'),
      h('p', { class: 'tmap__count num muted' }),
      h('p', { class: 'tmap__motion muted', hidden: true }, 'Animation is paused (reduced motion or lite mode). The bars show the current split.')));

  const sim = {
    wrap, lines, visitors, entry, nodes, inPath, inLen: 0,
    algorithm: p.algorithm, sticky: p.sticky,
    counter: card.querySelector('.tmap__count'), motion: card.querySelector('.tmap__motion'),
    bal: createBalancer({ algorithm: p.algorithm, members: simMembers(d), sticky: p.sticky }),
    flights: [], visible: 0, raf: 0, running: false, nextAt: 0, lastPaint: 0,
  };
  for (const n of nodes.values()) updateNode(d, n);

  const onChange = () => syncRun(d, sim);
  const reduce = reducedMotion();
  const mo = new MutationObserver(onChange);
  const ro = new ResizeObserver(() => layout(sim));
  document.addEventListener('visibilitychange', onChange);
  reduce.addEventListener('change', onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-fx'] });
  ro.observe(wrap);
  sim.stop = () => {
    cancelAnimationFrame(sim.raf);
    sim.running = false;
    sim.raf = 0;
    sim.flights.forEach((f) => f.g?.remove());
    sim.flights = [];
    ro.disconnect();
    mo.disconnect();
    document.removeEventListener('visibilitychange', onChange);
    reduce.removeEventListener('change', onChange);
  };

  d.sim = sim;
  d.v.map.replaceChildren(card);
  layout(sim);
  syncRun(d, sim);
}

// Same member set and settings: update statuses and the balancer in place (no restart, no lost popover).
function updateMap(d) {
  const sim = d.sim;
  for (const m of d.pool.members) {
    const n = sim.nodes.get(m.id);
    if (!n) continue;
    n.m = m;
    updateNode(d, n);
  }
  sim.bal.setMembers(simMembers(d));
  renderShares(d, sim);
}

function stopSim(d) {
  if (!d.sim) return;
  d.sim.stop();
  d.sim = null;
}

function resetPractice(d) {
  d.overrides.clear();
  d.counts.clear();
  d.visits = 0;
  d.failed = 0;
  closePopover(d, { focus: false });
  if (d.sim) updateMap(d);
}

const randInt = (n) => Math.floor(Math.random() * n);
const fakeIp = () => `10.${randInt(256)}.${randInt(256)}.${1 + randInt(254)}`;
const sessionKey = () => `s${Math.random().toString(36).slice(2, 9)}`;
const hit = (btn) => { // re-triggers the short pulse on a member when a visit lands
  btn.classList.remove('is-hit');
  void btn.offsetWidth;
  btn.classList.add('is-hit');
};

function dispatch(d, sim, now) {
  const id = sim.bal.pick({ ip: fakeIp(), key: sessionKey() });
  const node = id == null ? null : sim.nodes.get(id) ?? null;
  d.visits += 1;
  if (!node) d.failed += 1;
  else d.counts.set(id, (d.counts.get(id) ?? 0) + 1);
  const flight = { bal: sim.bal, id, node, failed: !node, t0: now, dur: FLIGHT_MS * (0.85 + Math.random() * 0.3), g: null };
  if (sim.visible < CAP_DOTS) {
    flight.g = svg('g', { class: ['tdot', flight.failed && 'is-fail'] }, svg('circle', { r: 5 }));
    sim.lines.append(flight.g);
    sim.visible += 1;
  }
  sim.flights.push(flight);
}

function placeDot(sim, f, p) {
  let pt;
  let fade = 1;
  if (f.failed || !f.node) {
    // no server could take it: travel to the balancer, then fade out in red
    pt = sim.inPath.getPointAtLength(sim.inLen * Math.min(1, p / 0.5));
    fade = p < 0.5 ? 1 : Math.max(0, 1 - (p - 0.5) / 0.5);
  } else if (p < 0.5) {
    pt = sim.inPath.getPointAtLength(sim.inLen * (p / 0.5));
  } else {
    pt = f.node.path.getPointAtLength(f.node.len * ((p - 0.5) / 0.5));
  }
  f.g.setAttribute('transform', `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`);
  if (f.failed || !f.node) f.g.style.opacity = fade.toFixed(2);
}

function tick(d, sim, now) {
  sim.raf = 0;
  if (!sim.running) return;
  if (now >= sim.nextAt) {
    dispatch(d, sim, now);
    sim.nextAt = now + 1000 / (RATE[0] + Math.random() * (RATE[1] - RATE[0]));
  }
  // done() only after the dot arrives, so least busy sees the visits still in progress
  for (let i = sim.flights.length - 1; i >= 0; i -= 1) {
    const f = sim.flights[i];
    const p = (now - f.t0) / f.dur;
    if (p >= 1) {
      if (f.id != null) {
        f.bal.done(f.id);
        if (f.node) hit(f.node.btn);
      }
      if (f.g) { f.g.remove(); sim.visible -= 1; }
      sim.flights.splice(i, 1);
    } else if (f.g) {
      placeDot(sim, f, p);
    }
  }
  if (now - sim.lastPaint > 250) {
    sim.lastPaint = now;
    renderShares(d, sim);
  }
  sim.raf = requestAnimationFrame((t) => tick(d, sim, t));
}

function animationAllowed() {
  return !document.hidden && !reducedMotion().matches && document.documentElement.dataset.fx !== 'lite';
}

function syncRun(d, sim) {
  if (d.sim !== sim) return; // a listener from an earlier paint
  const on = animationAllowed();
  sim.wrap.classList.toggle('is-static', !on);
  sim.motion.hidden = on;
  if (on && !sim.running) {
    sim.running = true;
    sim.nextAt = performance.now();
    sim.raf = requestAnimationFrame((t) => tick(d, sim, t));
  } else if (!on && sim.running) {
    sim.running = false;
    cancelAnimationFrame(sim.raf);
    sim.raf = 0;
    for (const f of sim.flights) {
      if (f.id != null) f.bal.done(f.id);
      f.g?.remove();
    }
    sim.flights = [];
    sim.visible = 0;
  }
  renderShares(d, sim);
}

// Bars show live visits from this page. Before any visit (or while paused), they show the server's own split.
function renderShares(d, sim) {
  const total = [...d.counts.values()].reduce((a, b) => a + b, 0);
  const staticShare = new Map((d.traffic?.distribution || []).map((x) => [x.memberId, x.share || 0]));
  for (const n of sim.nodes.values()) {
    let share = 0;
    if (total) share = (d.counts.get(n.m.id) ?? 0) / total;
    else if (!sim.running) share = staticShare.get(n.m.id) ?? 0;
    n.shareEl.textContent = `${Math.round(share * 100)}%`;
    n.barEl.style.width = `${(share * 100).toFixed(1)}%`;
  }
  sim.counter.textContent = `Since you opened this page: ${plural(d.visits, 'visit')}${d.failed ? `, ${d.failed} with no server up` : ''}.`;
}

/* ---------- "Try it yourself" popover ---------- */

function togglePopover(d, mid, btn) {
  if (d.popover?.memberId === mid) closePopover(d);
  else openPopover(d, mid, btn);
}

function openPopover(d, mid, btn) {
  closePopover(d, { focus: false });
  const sim = d.sim;
  const n = sim?.nodes.get(mid);
  if (!n) return;
  const pop = h('div', { class: 'glass glass--thick tmap__pop', role: 'dialog', 'aria-label': `${n.m.name}: try it yourself` });
  const onDown = (e) => {
    if (pop.contains(e.target) || btn.contains(e.target) || e.target.closest?.('.scrim')) return;
    closePopover(d, { focus: false });
  };
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closePopover(d); }
  });
  document.addEventListener('pointerdown', onDown, true);
  d.popover = { memberId: mid, el: pop, btn, off: () => document.removeEventListener('pointerdown', onDown, true) };
  sim.wrap.append(pop);
  fillPopover(d, mid);
  placePopover(sim, btn, pop);
  btn.setAttribute('aria-expanded', 'true');
  pop.querySelector('button, input, select')?.focus({ preventScroll: true });
}

function closePopover(d, { focus = true } = {}) {
  const p = d.popover;
  if (!p) return;
  p.off();
  p.el.remove();
  p.btn.setAttribute('aria-expanded', 'false');
  d.popover = null;
  if (focus && p.btn.isConnected) p.btn.focus({ preventScroll: true });
}

function fillPopover(d, mid) {
  const p = d.popover;
  if (!p) return;
  const m = d.pool.members.find((x) => x.id === mid);
  if (!m) { closePopover(d, { focus: false }); return; }
  p.el.replaceChildren(popBody(d, m));
}

function placePopover(sim, btn, pop) {
  const box = sim.wrap.getBoundingClientRect();
  const r = btn.getBoundingClientRect();
  const W = box.width;
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  let left;
  let top;
  if (sim.wrap.dataset.layout === 'wide') {
    const right = r.right - box.left;
    left = right + 16 + pw <= W ? right + 16 : r.left - box.left - 16 - pw;
    top = r.top - box.top;
  } else {
    left = (r.left + r.right) / 2 - box.left - pw / 2;
    top = r.bottom - box.top + 12;
  }
  left = Math.max(0, Math.min(left, W - pw));
  top = Math.max(0, Math.min(top, Math.max(0, box.height - ph)));
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

function popBody(d, m) {
  const healthy = simHealthy(d, m);
  const pretend = d.overrides.has(m.id);
  const [, realText] = MEMBER_STATUS[m.status] || ['warn', m.status];
  const head = h('div', { class: 'tmap__pop-head' },
    h('div', {},
      h('h3', {}, m.name),
      h('p', { class: 'muted mono' }, m.address),
      h('p', { class: 'muted' }, `${ROLE[m.role] || m.role} · weight ${m.weight} · real status: ${realText.toLowerCase()}`)),
    Button({ variant: 'ghost', size: 'sm', icon: 'x', 'aria-label': 'Close', onclick: () => closePopover(d) }));

  const toggle = Button({
    variant: 'glass', size: 'sm', icon: healthy ? 'x' : 'refresh',
    onclick: () => { d.overrides.set(m.id, !healthy); updateMap(d); fillPopover(d, m.id); },
  }, healthy ? 'Pretend this server goes down' : 'Pretend it is back');
  const practice = h('section', { class: 'tmap__pop-sec' },
    h('h4', {}, 'Practice: only this picture changes'),
    h('p', { class: 'muted' }, 'Nothing is saved. Watch the visits move to your other servers.'),
    h('div', { class: 'row' }, toggle,
      pretend && Button({ variant: 'ghost', size: 'sm', onclick: () => { d.overrides.delete(m.id); updateMap(d); fillPopover(d, m.id); } }, 'Undo practice')));

  // Real controls: these call the API and change the live pool.
  const range = h('input', { type: 'range', min: 1, max: 100, step: 1, value: m.weight, class: 'tmap__range' });
  const out = h('output', { class: 'num' }, String(m.weight));
  const role = Select({
    options: [{ value: 'active', label: 'Active' }, { value: 'standby', label: 'Spare' }],
    value: m.role === 'standby' ? 'standby' : 'active',
  });
  const save = Button({
    variant: 'primary', size: 'sm', disabled: true,
    onclick: () => saveMember(d, m, { role: role.value, weight: Number(range.value) }, save),
  }, 'Save changes');
  const changed = () => {
    save.disabled = role.value === (m.role === 'standby' ? 'standby' : 'active') && Number(range.value) === m.weight;
  };
  range.addEventListener('input', () => { out.textContent = range.value; changed(); });
  role.addEventListener('change', changed);
  const drain = Button({
    variant: 'glass', size: 'sm', icon: 'shield', disabled: m.role === 'drain',
    onclick: () => drainMember(d, m, drain),
  }, 'Stop sending new visitors');

  const real = h('section', { class: 'tmap__pop-sec tmap__pop-sec--real' },
    h('h4', {}, 'Real changes: saved to the live pool'),
    callout('warn', 'These change the real setup for visitors. Nothing here is practice.'),
    h('div', { class: 'row' }, drain),
    h('p', { class: 'muted' }, 'Visits already in progress finish on this server first.'),
    Field({ label: 'Role' }, role),
    Field({ label: h('span', {}, 'Weight ', out) }, range),
    h('div', { class: 'row' }, save));

  return h('div', { class: 'tmap__pop-inner stack' }, head, practice, real);
}

async function saveMember(d, m, patch, btn) {
  const members = d.pool.members.map((x) => (x.id === m.id ? { ...x, ...patch } : x));
  const problems = validateWeights(members);
  if (problems.length) {
    toast({ title: 'Check the weight', message: problems[0], kind: 'bad' });
    return;
  }
  setLoading(btn, true);
  try {
    const pool = await api.put(poolPath(d.id), {
      members: members.map(({ id, serverId, address, weight, role }) => ({ id, serverId, address, weight, role })),
    }, { signal: d.ctx.signal });
    toast({ title: 'Saved to the live pool', message: `${m.name}: ${ROLE[patch.role]}, weight ${patch.weight}.`, kind: 'ok' });
    closePopover(d, { focus: false });
    await refreshAll(d, pool);
  } catch (e) {
    if (e.name === 'AbortError') return;
    setLoading(btn, false);
    toast({ title: 'Could not save', message: e.message, kind: 'bad' });
  }
}

async function drainMember(d, m, btn) {
  const yes = await Confirm({
    title: `Stop sending visitors to ${m.name}?`,
    message: 'Visits already in progress finish first, and new visitors go to your other servers. This changes the live pool.',
    confirmLabel: 'Stop sending visitors', danger: true,
  });
  if (!yes) return;
  setLoading(btn, true);
  try {
    const pool = await api.post(`${poolPath(d.id)}/members/${enc(m.id)}/drain`, {}, { signal: d.ctx.signal });
    toast({ title: 'Stopped sending new visitors', message: m.name, kind: 'ok' });
    closePopover(d, { focus: false });
    await refreshAll(d, pool);
  } catch (e) {
    if (e.name === 'AbortError') return;
    setLoading(btn, false);
    toast({ title: 'Could not stop visitors', message: e.message, kind: 'bad' });
  }
}

/* ---------- switch visitors, safety drill, health check ---------- */

function paintSwitch(d) {
  const p = d.pool;
  const from = currentMember(p);
  const others = p.members.filter((m) => m.id !== from?.id);
  const target = Select({
    options: others.map((m) => ({ value: m.id, label: `${m.name} (${ROLE[m.role] || m.role})` })),
    value: others[0]?.id,
  });
  const mode = Segmented({
    label: 'How to move visitors',
    options: [{ value: 'instant', label: 'All at once' }, { value: 'gradual', label: 'Gradually (safer)' }],
    value: 'gradual',
    onchange: () => explain(),
  });
  const explainHost = h('div', { class: 'stack switch__explain', 'aria-live': 'polite' });
  const go = Button({ variant: 'primary', icon: 'arrow-right', onclick: () => confirmSwitch() }, 'Move visitors to this server');
  const chosen = () => p.members.find((m) => m.id === target.value);
  target.addEventListener('change', () => explain());

  function explain() {
    const to = chosen();
    if (!to || !from) { explainHost.replaceChildren(); return; }
    const steps = mode.value === 'gradual'
      ? `Visitors move in steps: first 10%, then 25%, then 50%, then everyone. If a check fails, visitors stay on ${from.name}.`
      : `Every new visitor goes to ${to.name} straight away. Visits already in progress finish where they are.`;
    explainHost.replaceChildren(
      h('p', {}, h('strong', {}, 'What will happen: '), steps),
      to.status === 'healthy'
        ? callout('info', `If ${to.name} is not responding when the move starts, traffic stays put. Nothing moves and visitors stay on ${from.name}.`, 'Traffic stays put if the target is down')
        : callout('warn', `${to.name} is not responding right now, so this move will be refused. Visitors would stay on ${from.name}.`, 'Not ready to take visitors'));
  }

  async function confirmSwitch() {
    const to = chosen();
    if (!to || !from) return;
    const gradual = mode.value === 'gradual';
    const yes = await Confirm({
      title: 'Move visitors now?',
      message: `${gradual ? 'Visitors move in steps: 10%, 25%, 50%, then everyone.' : `Every new visitor goes to ${to.name} straight away.`} If the move fails, visitors stay on ${from.name}. This changes the live pool.`,
      confirmLabel: 'Move visitors',
    });
    if (!yes) return;
    runJob(d, {
      title: 'Moving visitors',
      subtitle: `${from.name} to ${to.name}`,
      start: () => api.post(`${poolPath(d.id)}/switch`, { toMemberId: to.id, mode: gradual ? 'gradual' : 'instant' }, { signal: d.ctx.signal }),
      outcome: (final) => (final.status === 'done'
        ? { kind: 'ok', title: 'Visitors moved', message: `Visitors are now on ${to.name}.` }
        : { kind: 'bad', title: 'Visitors did not move', message: `${final.error || 'The move did not finish.'} Visitors stayed on ${from.name}.` }),
    });
  }

  explain();
  d.v.switchCard.replaceChildren(Card({
    title: 'Switch visitors to another server',
    subtitle: 'Moves new visitors to the server you choose. Nothing moves until you confirm.',
  },
    h('div', { class: 'switch__form' },
      Field({ label: 'Move visitors to' }, target),
      h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'How to move'), mode)),
    explainHost,
    h('div', { class: 'row' }, go)));
}

// Runs a background job in a modal: each step appears as it happens, then the outcome in plain English.
function runJob(d, { title, subtitle, start, outcome, refresh = true }) {
  const ac = new AbortController();
  const stop = () => ac.abort();
  d.ctx.signal.addEventListener('abort', stop, { once: true });
  const body = h('div', { class: 'stack' }, Skeleton({ lines: 3 }));
  const close = Button({ variant: 'glass', onclick: () => m.close() }, 'Close');
  const m = Modal({
    title, subtitle, size: 'md', content: body, actions: [close],
    onClose: () => { ac.abort(); d.ctx.signal.removeEventListener('abort', stop); },
  });

  (async () => {
    let job;
    try {
      job = await start();
    } catch (e) {
      if (e.name !== 'AbortError') body.replaceChildren(callout('bad', e.message, 'Could not start'));
      return;
    }
    const progress = JobProgress(job);
    body.replaceChildren(progress);
    let final;
    try {
      final = await pollJob(job.id, (j) => progress.update(j), { signal: ac.signal });
    } catch (e) {
      if (e.name === 'AbortError') return;
      final = { status: 'failed', error: e.message };
    }
    const result = outcome(final);
    body.append(callout(result.kind, result.message, result.title));
    close.querySelector('.btn__label').textContent = 'Done';
    toast({ title: result.title, message: result.message, kind: result.kind });
    if (refresh) refreshAll(d);
  })();
  return m;
}

function runDrill(d) {
  runJob(d, {
    title: 'Safety drill',
    subtitle: 'We pretend your main server dies and check the spare takes over. Nothing real changes.',
    start: () => api.post(`${poolPath(d.id)}/drill`, {}, { signal: d.ctx.signal }),
    outcome: (final) => (final.status === 'done' && final.result?.ok !== false
      ? { kind: 'ok', title: 'Drill passed', message: final.result?.summary || 'The spare took over in the practice run. Nothing real changed.' }
      : { kind: 'bad', title: 'Drill failed', message: final.error || final.result?.summary || 'The drill did not finish. Nothing real changed.' }),
    refresh: false,
  });
}

function openHealthEdit(d) {
  const hc = { ...DEFAULT_HEALTH_CHECK, ...(d.pool.healthCheck || {}) };
  const banner = h('div', { class: 'stack' });
  const numInput = (value, min, max) => Input({ type: 'number', inputmode: 'numeric', min, max, step: 1, value });
  const path = Input({ value: hc.path });
  const interval = numInput(hc.intervalSec, 1, 300);
  const timeout = numInput(hc.timeoutSec, 1, 60);
  const unhealthy = numInput(hc.unhealthyThreshold, 1, 20);
  const healthy = numInput(hc.healthyThreshold, 1, 20);
  const expect = numInput(hc.expectStatus, 100, 599);
  const fields = {
    path: Field({ label: 'Page to check', hint: 'A quick page on the server, usually /. It must start with a slash.' }, path),
    intervalSec: Field({ label: 'Seconds between checks' }, interval),
    timeoutSec: Field({ label: 'Seconds to wait for an answer' }, timeout),
    unhealthyThreshold: Field({ label: 'Failed checks before "not responding"' }, unhealthy),
    healthyThreshold: Field({ label: 'Good checks before "back"' }, healthy),
    expectStatus: Field({ label: 'Code for a good answer' }, expect),
  };

  async function save() {
    const next = {
      path: path.value.trim(),
      intervalSec: Number(interval.value),
      timeoutSec: Number(timeout.value),
      unhealthyThreshold: Number(unhealthy.value),
      healthyThreshold: Number(healthy.value),
      expectStatus: Number(expect.value),
    };
    Object.values(fields).forEach((f) => f.setError(''));
    const problems = validateHealthCheck(next);
    banner.replaceChildren(...problems.map((msg) => callout('bad', msg)));
    if (problems.length) return;
    setLoading(saveBtn, true);
    try {
      const pool = await api.put(poolPath(d.id), { healthCheck: next }, { signal: d.ctx.signal });
      toast({ title: 'Health check saved', message: 'Saved to the live pool.', kind: 'ok' });
      m.close();
      await refreshAll(d, pool);
    } catch (e) {
      if (e.name === 'AbortError') return;
      setLoading(saveBtn, false);
      const key = (e.field || '').replace(/^healthCheck\./, '');
      if (fields[key]) fields[key].setError(e.message);
      else banner.replaceChildren(callout('bad', e.message));
    }
  }

  const saveBtn = Button({ variant: 'primary', icon: 'check', onclick: () => save() }, 'Save');
  const m = Modal({
    title: 'Edit health check', subtitle: 'Changes are saved to the live pool.', size: 'md',
    content: h('div', { class: 'stack' }, banner, h('div', { class: 'form-grid' }, ...Object.values(fields))),
    actions: [Button({ variant: 'ghost', onclick: () => m.close() }, 'Cancel'), saveBtn],
  });
}
