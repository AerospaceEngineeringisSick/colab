// Servers: #/servers (list) and #/servers/:id (detail) share this module.
import { h, ensureCss } from '../core/dom.js';
import { api, pollJob } from '../core/api.js';
import { ago, date, uptime } from '../core/fmt.js';
import { toast } from '../core/toast.js';
import { AreaChart } from '../ui/charts.js';
import { icon } from '../ui/icons.js';
import {
  PageHeader, Card, Button, Badge, StatusBadge, Meter, Ring, Table, Empty, ErrorState, Skeleton,
  loadInto, setLoading, Modal, Confirm, JobProgress,
} from '../ui/components.js';

const REFRESH_MS = 30_000;
const OS_LABEL = { 'ubuntu-24.04': 'Ubuntu 24.04', 'ubuntu-22.04': 'Ubuntu 22.04', 'debian-12': 'Debian 12', 'debian-11': 'Debian 11' };
const TYPE_LABEL = { php: 'PHP', nodejs: 'Node.js', static: 'Static', python: 'Python', 'reverse-proxy': 'Reverse proxy' };
const SSL = { active: ['ok', 'Secured'], pending: ['warn', 'SSL pending'], none: ['neutral', 'No SSL'] };

const enc = encodeURIComponent;
const osLabel = (v) => OS_LABEL[v] || v || 'Unknown OS';
const isPending = (s) => s.status === 'pending';
const clockFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const hhmm = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : clockFmt.format(d);
};

export default async function mount(root, ctx) {
  await ensureCss('css/view-servers.css');
  return ctx.params.id ? mountDetail(root, ctx) : mountList(root, ctx);
}

/* ---------- shared helpers ---------- */

function outcomeCallout(ok, message) {
  return h('div', { class: ['callout', ok ? 'callout--ok' : 'callout--bad'], role: ok ? 'status' : 'alert' },
    icon(ok ? 'check' : 'alert', { size: 18 }),
    h('div', {}, h('strong', {}, ok ? 'Check passed' : 'Check failed'), h('p', {}, message)));
}

/** Runs server.check in a modal and streams its steps. onDone(ok) fires once the job settles. Used by the list and the detail. */
function runServerCheck(server, { signal, onDone } = {}) {
  const ac = new AbortController();
  const body = h('div', { class: 'stack' });
  const closeBtn = Button({ variant: 'glass', onclick: () => m.close() }, 'Close');
  const onAbort = () => m.close();
  const m = Modal({
    title: 'Checking server', subtitle: `${server.name} · ${server.host}`, size: 'md', content: body, actions: [closeBtn],
    onClose: () => { ac.abort(); signal?.removeEventListener('abort', onAbort); },
  });
  signal?.addEventListener('abort', onAbort, { once: true });

  (async () => {
    try {
      const job = await api.post(`/api/servers/${enc(server.id)}/check`, {}, { signal: ac.signal });
      const progress = JobProgress(job);
      body.append(progress);
      const done = await pollJob(job.id, (j) => progress.update(j), { signal: ac.signal });
      const ok = done.status === 'done' && done.result?.ok !== false;
      const message = ok
        ? (done.result?.os ? `Detected ${done.result.os}.` : 'All checks passed.')
        : (done.error || done.result?.error || 'The check failed.');
      body.append(outcomeCallout(ok, message));
      toast({ title: ok ? 'Server check passed' : 'Server check failed', message: ok ? server.name : message, kind: ok ? 'ok' : 'bad' });
      onDone?.(ok);
    } catch (e) {
      if (e?.name === 'AbortError') return;
      body.append(outcomeCallout(false, e.message));
      toast({ title: 'Check could not run', message: e.message, kind: 'bad' });
    }
  })();
  return m;
}

/** Waiting-for-setup prompt for a pending server (list card and detail). */
function setupPrompt(server, ctx, onChanged, size = 'md') {
  return h('div', { class: 'stack' },
    h('div', { class: 'callout' }, icon('info', { size: 18 }), h('p', {}, 'Waiting for CloudPanel setup')),
    h('div', { class: 'btn-row' },
      Button({ variant: 'primary', size, icon: 'arrow-right', onclick: () => ctx.navigate(`/servers/new?serverId=${enc(server.id)}`) }, 'Continue setup'),
      Button({ variant: 'glass', size, icon: 'activity', onclick: () => runServerCheck(server, { signal: ctx.signal, onDone: (ok) => { if (ok) onChanged(); } }) }, 'Run check')));
}

/* ---------- list ---------- */

function serverCard(s, ctx, onChanged) {
  const m = s.metrics;
  const place = [s.host, s.provider, s.region].filter(Boolean).join(' · ');
  return h('article', { class: 'glass glass--interactive card server-card' },
    h('div', { class: 'server-card__top' },
      h('div', { class: 'server-card__id' },
        h('a', { class: 'server-card__name', href: `#/servers/${enc(s.id)}` }, s.name),
        h('p', { class: 'muted server-card__host' }, place)),
      StatusBadge(s.status)),
    h('div', { class: 'row server-card__chips' },
      h('span', { class: 'chip' }, osLabel(s.os)),
      h('span', { class: 'chip' }, `${s.siteCount ?? 0} ${s.siteCount === 1 ? 'site' : 'sites'}`)),
    isPending(s)
      ? setupPrompt(s, ctx, onChanged, 'sm')
      : h('div', { class: 'server-card__meters' },
        Meter({ value: m?.cpu ?? 0, label: 'CPU' }),
        Meter({ value: m?.mem ?? 0, label: 'Memory' }),
        Meter({ value: m?.disk ?? 0, label: 'Disk' })),
    h('div', { class: 'server-card__foot muted' },
      h('span', {}, `Uptime ${m ? uptime(m.uptimeSec) : '—'}`),
      h('span', {}, s.panelVersion ? `CloudPanel ${s.panelVersion}` : 'CloudPanel —')));
}

function mountList(root, ctx) {
  const fetchList = () => api.get('/api/servers', { signal: ctx.signal });
  const list = h('div', { class: 'server-list' });

  const refreshBtn = Button({
    variant: 'glass', icon: 'refresh',
    onclick: () => { setLoading(refreshBtn, true); loadInto(list, fetchList, render).finally(() => setLoading(refreshBtn, false)); },
  }, 'Refresh');
  const head = PageHeader({
    title: 'Servers', subtitle: 'Loading…',
    actions: [refreshBtn, Button({ variant: 'primary', icon: 'plus', onclick: () => ctx.navigate('/servers/new') }, 'Add server')],
  });
  root.append(head, list);

  function setSubtitle(text) {
    const p = head.querySelector('.page-head__text p');
    if (p) p.textContent = text;
  }

  function render(servers) {
    const online = servers.filter((s) => s.status === 'online').length;
    setSubtitle(servers.length ? `${online} of ${servers.length} online` : 'No servers yet');
    if (!servers.length) {
      return h('section', { class: 'glass card' }, Empty({
        icon: 'server', title: 'No servers yet',
        message: 'Add a Linux server and LRWeb will install CloudPanel on it, then you can provision sites.',
        action: Button({ variant: 'primary', icon: 'plus', onclick: () => ctx.navigate('/servers/new') }, 'Add your first server'),
      }));
    }
    return h('div', { class: 'grid grid--3' }, servers.map((s) => serverCard(s, ctx, quiet)));
  }

  // Background refresh: no skeleton, and a failed poll keeps the last good list.
  async function quiet() {
    try { list.replaceChildren(render(await fetchList())); } catch { /* keep what is on screen */ }
  }

  loadInto(list, fetchList, render);
  const timer = setInterval(quiet, REFRESH_MS);
  return () => clearInterval(timer);
}

/* ---------- detail ---------- */

function gauge(label, value, caption) {
  return h('section', { class: 'glass card gauge' },
    h('h2', { class: 'card__title' }, label),
    Ring({ value: value ?? 0, size: 96 }),
    h('p', { class: 'muted gauge__caption' }, caption));
}

function loadCard(c) {
  const [l1, l5, l15] = c.load ?? [];
  const fmtLoad = (v) => (typeof v === 'number' ? v.toFixed(2) : '—');
  return h('section', { class: 'glass card' },
    h('h2', { class: 'card__title' }, 'Load average'),
    h('dl', { class: 'kv' }, [
      ['1 min', fmtLoad(l1)], ['5 min', fmtLoad(l5)], ['15 min', fmtLoad(l15)],
      ['Uptime', c.uptimeSec != null ? uptime(c.uptimeSec) : '—'],
    ].flatMap(([k, v]) => [h('dt', {}, k), h('dd', { class: 'num' }, v)])));
}

const SITE_COLUMNS = [
  { label: 'Domain', render: (x) => h('a', { class: 'link site-domain', href: `https://${x.domain}`, target: '_blank', rel: 'noopener' }, x.domain, icon('external', { size: 14 })) },
  { label: 'Type', render: (x) => h('div', { class: 'row site-type' },
    h('span', { class: 'chip' }, TYPE_LABEL[x.type] || x.type),
    x.runtime ? h('span', { class: 'chip mono' }, x.runtime) : null) },
  { label: 'Client', render: (x) => (x.clientId
    ? h('a', { class: 'link', href: `#/clients/${enc(x.clientId)}` }, x.clientName || x.clientId)
    : h('span', { class: 'muted' }, '—')) },
  { label: 'SSL', render: (x) => { const [kind, text] = SSL[x.ssl] || ['neutral', x.ssl || 'Unknown']; return Badge({ kind }, text); } },
  { label: 'Status', render: (x) => StatusBadge(x.status) },
];

/** Builds the detail body for one server snapshot. paint(metrics) redraws gauges and charts (null for pending servers). */
function detailBody(s, m, { ctx, onChanged }) {
  const pending = isPending(s);
  const sites = s.sites ?? [];

  const header = PageHeader({
    title: h('span', { class: 'row server-title' }, s.name, StatusBadge(s.status)),
    subtitle: s.host,
    actions: [
      s.panelUrl ? h('a', { class: 'btn btn--glass btn--md', href: s.panelUrl, target: '_blank', rel: 'noopener' },
        icon('external', { size: 18 }), h('span', { class: 'btn__label' }, 'Open CloudPanel')) : null,
      Button({ variant: 'glass', icon: 'activity', onclick: () => runServerCheck(s, { signal: ctx.signal, onDone: (ok) => { if (ok) onChanged(); } }) }, 'Run check'),
      Button({ variant: 'ghost', icon: 'trash', class: 'btn--danger-ghost', onclick: (e) => removeServer(s, e.currentTarget, ctx) }, 'Remove'),
    ],
  });

  const details = Card({ title: 'Details' },
    h('dl', { class: 'kv' }, [
      ['Host', s.host],
      ['SSH', `${s.sshUser}@${s.host}:${s.sshPort}`],
      ['OS', osLabel(s.os)],
      ['Provider', s.provider || '—'],
      ['Region', s.region || '—'],
      ['CloudPanel version', s.panelVersion || '—'],
      ['Added', `${date(s.createdAt)} · ${ago(s.createdAt)}`],
    ].flatMap(([k, v]) => [h('dt', {}, k), h('dd', { class: k === 'SSH' ? 'mono' : null }, v)])));

  if (pending) {
    return {
      nodes: [header, Card({}, setupPrompt(s, ctx, onChanged)), details],
      paint: null,
    };
  }

  const gauges = h('div', { class: 'grid grid--4 gauge-grid' });
  const usage = h('div');
  const network = h('div');

  const siteCount = `${sites.length} ${sites.length === 1 ? 'site' : 'sites'}`;
  const sitesCard = Card({ title: 'Sites on this server', subtitle: siteCount, flush: true },
    Table({
      columns: SITE_COLUMNS, rows: sites,
      empty: Empty({
        icon: 'globe', title: 'No sites on this server', message: 'Provision a site here and it will appear in this list.',
        action: Button({ variant: 'primary', icon: 'plus', onclick: () => ctx.navigate(`/sites?serverId=${enc(s.id)}`) }, 'Provision a site'),
      }),
    }));

  // Charts are recreated on every repaint; charts.js never disconnects its ResizeObserver (see report).
  const paint = (metrics) => {
    const cur = metrics?.current ?? s.metrics ?? {};
    gauges.replaceChildren(
      gauge('CPU', cur.cpu, 'Current load'),
      gauge('Memory', cur.mem, 'RAM in use'),
      gauge('Disk', cur.disk, 'Root filesystem'),
      loadCard(cur));
    const labels = (metrics?.labels ?? []).map(hhmm);
    usage.replaceChildren(AreaChart({
      series: [
        { name: 'CPU', values: metrics?.cpu ?? [], color: 'var(--accent)' },
        { name: 'Memory', values: metrics?.mem ?? [], color: 'var(--accent-2)' },
      ],
      labels, yMax: 100, format: (v) => `${Math.round(v)}%`,
    }));
    network.replaceChildren(AreaChart({
      series: [{ name: 'Throughput', values: metrics?.net ?? [], color: 'var(--accent-3)' }],
      labels, format: (v) => `${Number(v).toFixed(1)} Mbps`,
    }));
  };
  paint(m);

  return {
    nodes: [
      header,
      gauges,
      h('div', { class: 'split' },
        Card({ title: 'Resource usage · last hour' }, usage),
        Card({ title: 'Network', subtitle: 'Throughput, last hour' }, network)),
      h('div', { class: 'split' }, sitesCard, details),
    ],
    paint,
  };
}

async function removeServer(s, btn, ctx) {
  const yes = await Confirm({
    title: `Remove ${s.name}?`,
    message: 'LRWeb forgets this server. The machine and its CloudPanel install are not touched.',
    confirmLabel: 'Remove server', danger: true,
  });
  if (!yes) return;
  setLoading(btn, true);
  try {
    await api.del(`/api/servers/${enc(s.id)}`, { signal: ctx.signal });
    toast({ title: 'Server removed', message: s.name, kind: 'ok' });
    ctx.navigate('/servers');
  } catch (e) {
    if (e?.name === 'AbortError') return;
    setLoading(btn, false);
    toast({ title: e.status === 409 ? 'Cannot remove server' : 'Could not remove server', message: e.message, kind: 'bad' });
  }
}

function notFound(ctx, id) {
  return h('section', { class: 'glass card' }, Empty({
    icon: 'server', title: 'Server not found',
    message: `No server matches “${id}”. It may have been removed.`,
    action: Button({ variant: 'glass', icon: 'chevron-left', onclick: () => ctx.navigate('/servers') }, 'Back to servers'),
  }));
}

function mountDetail(root, ctx) {
  const id = ctx.params.id;
  const page = h('div', { class: 'stack' });
  root.append(h('a', { class: 'link back-link', href: '#/servers' }, icon('chevron-left', { size: 18 }), 'Servers'), page);

  const fetchMetrics = () => api.get(`/api/servers/${enc(id)}/metrics`, { signal: ctx.signal });
  let seq = 0;
  let paint = null;

  async function load({ quiet = false } = {}) {
    const mine = ++seq;
    if (!quiet) page.replaceChildren(Skeleton({ lines: 6 }));
    let server;
    let metrics = null;
    try {
      server = await api.get(`/api/servers/${enc(id)}`, { signal: ctx.signal });
      if (!isPending(server)) metrics = await fetchMetrics();
    } catch (e) {
      if (e?.name === 'AbortError' || mine !== seq || quiet) return;
      page.replaceChildren(e.status === 404 ? notFound(ctx, id) : ErrorState(e, () => load()));
      return;
    }
    if (mine !== seq) return;
    const view = detailBody(server, metrics, { ctx, onChanged: () => load({ quiet: true }) });
    page.replaceChildren(...view.nodes);
    paint = view.paint;
  }

  async function refreshMetrics() {
    if (!paint) return;
    try { paint(await fetchMetrics()); } catch { /* keep the last good numbers; the next tick retries */ }
  }

  load();
  const timer = setInterval(refreshMetrics, REFRESH_MS);
  return () => clearInterval(timer);
}
