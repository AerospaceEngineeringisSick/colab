// Servers: #/servers (list) and #/servers/:id (detail) share this module.
import { h, ensureCss } from '../core/dom.js';
import { api, pollJob } from '../core/api.js';
import { ago, date, uptime } from '../core/fmt.js';
import { toast } from '../core/toast.js';
import { AreaChart } from '../ui/charts.js';
import { icon } from '../ui/icons.js';
import { Term } from '../ui/glossary.js';
import {
  PageHeader, Card, Button, Badge, StatusBadge, Meter, Ring, Table, Empty, ErrorState, Skeleton,
  loadInto, setLoading, Modal, Confirm, JobProgress,
} from '../ui/components.js';

const REFRESH_MS = 30_000;
const OS_LABEL = { 'ubuntu-24.04': 'Ubuntu 24.04', 'ubuntu-22.04': 'Ubuntu 22.04', 'debian-12': 'Debian 12', 'debian-11': 'Debian 11' };
const TYPE_LABEL = { php: 'PHP', nodejs: 'Node.js', static: 'Static', python: 'Python', 'reverse-proxy': 'Proxy' };
const SSL = { active: ['ok', 'Secured'], pending: ['warn', 'Being set up'], none: ['neutral', 'Not secured'] };
const SITE_STATUS = { active: 'Active', provisioning: 'Being set up', failed: 'Failed', suspended: 'Suspended' };
// Server words in plain English. "Degraded" keeps its meaning in the tooltip.
const SERVER_STATUS = {
  online: ['Online'],
  degraded: ['Struggling', 'Degraded: the server is running, but slowly or with problems.'],
  offline: ['Offline'],
  pending: ['Waiting for setup'],
};
const TEST_HINT = 'Test connection checks that LRWeb can reach this server and that CloudPanel is ready.';
// The job steps come from the server with technical labels; these plain ones are matched by step key.
const STEP_COPY = {
  ssh: 'Signing in to the server',
  clpctl: "Checking CloudPanel's tools are installed",
  panel: 'Checking CloudPanel is responding',
  os: 'Reading the operating system',
};

const enc = encodeURIComponent;
const osLabel = (v) => OS_LABEL[v] || v || 'Unknown OS';
const isPending = (s) => s.status === 'pending';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const clockFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const hhmm = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : clockFmt.format(d);
};
const plainSteps = (job) => (job?.steps
  ? { ...job, steps: job.steps.map((s) => (STEP_COPY[s.key] ? { ...s, label: STEP_COPY[s.key] } : s)) }
  : job);

function serverStatus(status) {
  const [label, tip] = SERVER_STATUS[status] || [status];
  const badge = StatusBadge(status, label);
  if (tip) badge.title = tip;
  return badge;
}

export default async function mount(root, ctx) {
  await ensureCss('css/view-servers.css');
  return ctx.params.id ? mountDetail(root, ctx) : mountList(root, ctx);
}

/* ---------- shared helpers ---------- */

function outcomeCallout(ok, message) {
  return h('div', { class: ['callout', ok ? 'callout--ok' : 'callout--bad'], role: ok ? 'status' : 'alert' },
    icon(ok ? 'check' : 'alert', { size: 18 }),
    h('div', {}, h('strong', {}, ok ? 'Connection works' : 'Connection failed'), h('p', {}, message)));
}

/** Runs server.check in a modal and streams its steps. onDone(ok) fires once the job settles. Used by the list and the detail. */
function runServerCheck(server, { signal, onDone } = {}) {
  const ac = new AbortController();
  const body = h('div', { class: 'stack' }, h('p', { class: 'muted' }, TEST_HINT));
  const closeBtn = Button({ variant: 'glass', onclick: () => m.close() }, 'Close');
  const onAbort = () => m.close();
  const m = Modal({
    title: 'Testing connection', subtitle: `${server.name} · ${server.host}`, size: 'md', content: body, actions: [closeBtn],
    onClose: () => { ac.abort(); signal?.removeEventListener('abort', onAbort); },
  });
  signal?.addEventListener('abort', onAbort, { once: true });

  (async () => {
    try {
      const job = await api.post(`/api/servers/${enc(server.id)}/check`, {}, { signal: ac.signal });
      const progress = JobProgress(plainSteps(job));
      body.append(progress);
      const done = await pollJob(job.id, (j) => progress.update(plainSteps(j)), { signal: ac.signal });
      const ok = done.status === 'done' && done.result?.ok !== false;
      const message = ok
        ? (done.result?.os ? `Everything looks good. The server runs ${osLabel(done.result.os)}.` : 'Everything looks good.')
        : (done.error || done.result?.error || 'The test did not finish. Check the steps above to see which one went wrong.');
      body.append(outcomeCallout(ok, message));
      toast({ title: ok ? 'Connection works' : 'Connection failed', message: ok ? server.name : message, kind: ok ? 'ok' : 'bad' });
      onDone?.(ok);
    } catch (e) {
      if (e?.name === 'AbortError') return;
      body.append(outcomeCallout(false, e.message));
      toast({ title: 'Could not run the test', message: e.message, kind: 'bad' });
    }
  })();
  return m;
}

/** Waiting-for-setup prompt for a pending server (list card and detail). */
function setupPrompt(server, ctx, onChanged, size = 'md') {
  return h('div', { class: 'stack' },
    h('div', { class: 'callout' }, icon('info', { size: 18 }),
      h('p', {}, 'This server is not connected yet. Continue the setup, or test the connection once the setup script has run on it.')),
    h('div', { class: 'btn-row' },
      Button({ variant: 'primary', size, icon: 'arrow-right', onclick: () => ctx.navigate(`/servers/new?serverId=${enc(server.id)}`) }, 'Continue setup'),
      Button({ variant: 'glass', size, icon: 'activity', title: TEST_HINT, onclick: () => runServerCheck(server, { signal: ctx.signal, onDone: (ok) => { if (ok) onChanged(); } }) }, 'Test connection')),
    h('p', { class: 'muted setup-hint' }, TEST_HINT));
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
      serverStatus(s.status)),
    h('div', { class: 'row server-card__chips' },
      h('span', { class: 'chip' }, osLabel(s.os)),
      h('span', { class: 'chip' }, plural(s.siteCount ?? 0, 'site'))),
    isPending(s)
      ? setupPrompt(s, ctx, onChanged, 'sm')
      : h('div', { class: 'server-card__meters' },
        Meter({ value: m?.cpu ?? 0, label: 'CPU' }),
        Meter({ value: m?.mem ?? 0, label: 'Memory' }),
        Meter({ value: m?.disk ?? 0, label: 'Disk space' })),
    h('div', { class: 'server-card__foot muted' },
      h('span', {}, m ? `Running for ${uptime(m.uptimeSec)}` : 'No readings yet'),
      h('span', {}, s.panelVersion ? `CloudPanel ${s.panelVersion}` : 'CloudPanel not set up yet')));
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
    actions: [refreshBtn, Button({ variant: 'primary', icon: 'plus', onclick: () => ctx.navigate('/servers/new') }, 'Add a server')],
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
        message: 'Add a Linux server to host your websites. LRWeb walks you through setting it up, one step at a time.',
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
  const fmtLoad = (v) => (typeof v === 'number' ? v.toFixed(2) : 'Not known');
  return h('section', { class: 'glass card load-card' },
    h('h2', { class: 'card__title' }, 'Workload'),
    h('dl', { class: 'kv' }, [
      ['Last minute', fmtLoad(l1)], ['Last 5 minutes', fmtLoad(l5)], ['Last 15 minutes', fmtLoad(l15)],
      ['Running for', c.uptimeSec != null ? uptime(c.uptimeSec) : 'Not known'],
    ].flatMap(([k, v]) => [h('dt', {}, k), h('dd', { class: 'num' }, v)])));
}

const SITE_COLUMNS = [
  { label: 'Domain', render: (x) => h('a', { class: 'link site-domain', href: `https://${x.domain}`, target: '_blank', rel: 'noopener' }, x.domain, icon('external', { size: 14 })) },
  { label: 'Type', render: (x) => h('div', { class: 'row site-type' },
    h('span', { class: 'chip' }, TYPE_LABEL[x.type] || x.type),
    x.runtime ? h('span', { class: 'chip mono' }, x.runtime) : null) },
  { label: 'Client', render: (x) => (x.clientId
    ? h('a', { class: 'link', href: `#/clients/${enc(x.clientId)}` }, x.clientName || x.clientId)
    : h('span', { class: 'muted' }, 'No client')) },
  { label: 'Padlock', render: (x) => { const [kind, text] = SSL[x.ssl] || ['neutral', x.ssl || 'Unknown']; return Badge({ kind }, text); } },
  { label: 'Status', render: (x) => StatusBadge(x.status, SITE_STATUS[x.status]) },
];

/** Builds the detail body for one server snapshot. paint(metrics) redraws gauges and charts (null for pending servers). */
function detailBody(s, m, { ctx, onChanged }) {
  const pending = isPending(s);
  const sites = s.sites ?? [];

  const header = PageHeader({
    title: h('span', { class: 'row server-title' }, s.name, serverStatus(s.status)),
    subtitle: s.host,
    actions: [
      s.panelUrl ? h('a', { class: 'btn btn--glass btn--md', href: s.panelUrl, target: '_blank', rel: 'noopener' },
        icon('external', { size: 18 }), h('span', { class: 'btn__label' }, 'Open CloudPanel')) : null,
      Button({ variant: 'glass', icon: 'activity', title: TEST_HINT, onclick: () => runServerCheck(s, { signal: ctx.signal, onDone: (ok) => { if (ok) onChanged(); } }) }, 'Test connection'),
      Button({ variant: 'ghost', icon: 'trash', class: 'btn--danger-ghost', onclick: (e) => removeServer(s, e.currentTarget, ctx) }, 'Remove'),
    ],
  });

  const details = Card({ title: 'Details' },
    h('dl', { class: 'kv' }, [
      ['Address', s.host],
      ['Signs in as', `${s.sshUser}@${s.host}:${s.sshPort}`, true],
      ['OS', osLabel(s.os)],
      ['Provider', s.provider || 'Not added'],
      ['Region', s.region || 'Not added'],
      [h('span', {}, Term('cloudpanel', 'CloudPanel'), ' version'), s.panelVersion || 'Not set up yet'],
      ['Added', `${date(s.createdAt)} · ${ago(s.createdAt)}`],
    ].flatMap(([k, v, mono]) => [h('dt', {}, k), h('dd', { class: mono ? 'mono' : null }, v)])));

  if (pending) {
    return {
      nodes: [header, Card({}, setupPrompt(s, ctx, onChanged)), details],
      paint: null,
    };
  }

  const gauges = h('div', { class: 'grid grid--4 gauge-grid' });
  const usage = h('div');
  const network = h('div');

  const sitesCard = Card({ title: 'Sites on this server', subtitle: plural(sites.length, 'site'), flush: true },
    Table({
      columns: SITE_COLUMNS, rows: sites,
      empty: Empty({
        icon: 'globe', title: 'No sites on this server', message: 'Set up a site here and it will appear in this list.',
        action: Button({ variant: 'primary', icon: 'plus', onclick: () => ctx.navigate(`/sites?serverId=${enc(s.id)}&new=1`) }, 'Set up a site'),
      }),
    }));

  // Charts are recreated on every repaint; charts.js never disconnects its ResizeObserver (see report).
  const paint = (metrics) => {
    const cur = metrics?.current ?? s.metrics ?? {};
    gauges.replaceChildren(
      gauge('CPU', cur.cpu, 'Busy right now'),
      gauge('Memory', cur.mem, 'Memory in use'),
      gauge('Disk', cur.disk, 'Disk space used'),
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
      series: [{ name: 'Data moving', values: metrics?.net ?? [], color: 'var(--accent-3)' }],
      labels, format: (v) => `${Number(v).toFixed(1)} Mbps`,
    }));
  };
  paint(m);

  return {
    nodes: [
      header,
      gauges,
      h('div', { class: 'split' },
        Card({ title: 'CPU and memory · last hour' }, usage),
        Card({ title: 'Network', subtitle: 'How much data is moving, last hour' }, network)),
      h('div', { class: 'split' }, sitesCard, details),
    ],
    paint,
  };
}

async function removeServer(s, btn, ctx) {
  const yes = await Confirm({
    title: `Remove ${s.name}?`,
    message: 'LRWeb will stop tracking this server. The server itself and its CloudPanel installation are left as they are.',
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
    toast({ title: e.status === 409 ? 'Remove its sites first' : 'Could not remove server', message: e.message, kind: 'bad' });
  }
}

function notFound(ctx) {
  return h('section', { class: 'glass card' }, Empty({
    icon: 'server', title: 'Server not found',
    message: 'This server could not be found. It may have been removed.',
    action: Button({ variant: 'glass', icon: 'chevron-left', onclick: () => ctx.navigate('/servers') }, 'Back to servers'),
  }));
}

function mountDetail(root, ctx) {
  const id = ctx.params.id;
  const page = h('div', { class: 'stack' });
  root.append(h('a', { class: 'link back-link', href: '#/servers' }, icon('chevron-left', { size: 18 }), 'All servers'), page);

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
      page.replaceChildren(e.status === 404 ? notFound(ctx) : ErrorState(e, () => load()));
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
