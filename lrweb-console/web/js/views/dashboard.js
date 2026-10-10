// Dashboard (#/): KPIs, revenue, activity, server health and quick actions from GET /api/overview.
import { h, ensureCss } from '../core/dom.js';
import { api } from '../core/api.js';
import { state } from '../core/store.js';
import { money, num, ago } from '../core/fmt.js';
import { PageHeader, Card, Button, Badge, Stat, Meter, StatusBadge, Empty, Skeleton, loadInto } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { AreaChart } from '../ui/charts.js';
import { Term } from '../ui/glossary.js';

const REFRESH_MS = 30_000;
const CURRENCY = 'GBP'; // LRWeb's currency, used only if the overview has none

const ACTIVITY_ICON = {
  client: { icon: 'users', color: 'var(--accent)' },
  site: { icon: 'globe', color: 'var(--accent-3)' },
  billing: { icon: 'card', color: 'var(--ok)' },
  server: { icon: 'server', color: 'var(--accent-2)' },
};

const SERVER_STATUS = { online: 'Online', degraded: 'Needs attention', offline: 'Offline', pending: 'Not set up yet' };

const QUICK = [
  { title: 'Add a new client', hint: 'Client, care plan and first website', icon: 'rocket', href: '#/onboard', color: 'var(--accent)' },
  { title: 'Add a server', hint: 'Connect a server you already have', icon: 'server', href: '#/servers/new', color: 'var(--accent-3)' },
  { title: 'Set up a website', hint: 'Pick the kind of website first', icon: 'globe', href: '#/sites', color: 'var(--accent-2)' },
  { title: 'Review billing', hint: 'Invoices and late payments', icon: 'card', href: '#/billing', color: 'var(--warn)' },
];

const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });
/** 'YYYY-MM' -> 'Jan' (UTC, so the timezone cannot shift the month). */
const monthShort = (ym) => {
  const [y, m] = String(ym).split('-').map(Number);
  return y && m ? monthFmt.format(new Date(Date.UTC(y, m - 1, 1))) : String(ym);
};

/** First name of the signed-in person, or '' for the local/system principal or when it is unknown. */
const firstName = () => {
  const me = state.get('me');
  const user = me && !me.system && !me.local ? me : null;
  return user?.name?.trim().split(/\s+/)[0] || '';
};

const greeting = () => {
  const hr = new Date().getHours();
  const word = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const name = firstName();
  return name ? `${word}, ${name}` : word;
};

/** Change between the last two revenue months as Stat delta props. */
function revenueChange(revenue) {
  if (revenue.length < 2) return {};
  const last = revenue.at(-1).cents;
  const prev = revenue.at(-2).cents;
  if (!prev) return last > 0 ? { delta: 'New', deltaKind: 'up' } : {};
  const p = Number((((last - prev) / prev) * 100).toFixed(1));
  return { delta: `${p > 0 ? '+' : ''}${p.toFixed(1)}%`, deltaKind: p > 0 ? 'up' : p < 0 ? 'down' : 'flat' };
}

function kpiRow({ kpis, revenue, servers }) {
  const cur = kpis.currency || CURRENCY;
  const change = revenueChange(revenue);
  const troubled = servers.some((s) => s.status === 'offline' || s.status === 'degraded');
  return h('div', { class: 'grid grid--4 dash-kpis' },
    Stat({
      label: h('span', {}, 'Monthly income from ', Term('care plan', 'care plans')),
      value: money(kpis.mrrCents, cur), icon: 'card', accent: 'accent',
      spark: revenue.map((r) => r.cents), ...change,
    }),
    Stat({ label: 'Clients', value: num(kpis.clients.total), hint: `${num(kpis.clients.active)} active`, icon: 'users', accent: 'accent-3' }),
    Stat({
      label: 'Servers', value: num(kpis.servers.total), hint: troubled ? `${num(kpis.servers.online)} online · needs attention` : 'All online',
      icon: 'server', accent: troubled ? 'warn' : 'ok',
    }),
    Stat({
      label: 'Sites', value: num(kpis.sites.total), icon: 'globe', accent: 'accent-2',
      hint: h('span', {}, `${num(kpis.sites.sslActive)} with a `, Term('ssl', 'padlock (SSL)')),
    }));
}

function revenueCard({ kpis, revenue }) {
  const cur = kpis.currency || CURRENCY;
  return Card({
    title: 'Revenue', subtitle: 'Last 12 months',
    actions: Badge({ kind: kpis.outstandingCents > 0 ? 'warn' : 'neutral' }, `Waiting to be paid ${money(kpis.outstandingCents, cur)}`),
  }, AreaChart({
    series: [{ name: 'Revenue', values: revenue.map((r) => r.cents / 100) }],
    labels: revenue.map((r) => r.month),
    labelFormat: monthShort,
    // Compact axis ticks fit the 360px layout; the tooltip shows the exact amount.
    format: (v) => money(v * 100, cur, { compact: true }),
    tipFormat: (v) => money(Math.round(v * 100), cur),
  }));
}

function activityCard(activity) {
  return Card({ title: 'Recent activity' },
    activity.length
      ? h('ul', { class: 'list' }, activity.map((a) => {
        const k = ACTIVITY_ICON[a.kind] || { icon: 'sparkle', color: 'var(--ink-3)' };
        return h('li', { class: 'list__item' },
          h('span', { class: 'dash-ico', style: { '--c': k.color } }, icon(k.icon, { size: 18 })),
          h('span', { class: 'grow dash-activity__text' }, a.text),
          h('time', { class: 'muted dash-activity__time', datetime: a.ts }, ago(a.ts)));
      }))
      : Empty({ icon: 'activity', title: 'No activity yet', message: 'Clients, websites, invoices and server checks will show up here.' }));
}

function serverRow(s) {
  const metrics = [['CPU', s.cpu], ['Memory', s.mem], ['Disk', s.disk]];
  const numeric = metrics.filter(([, v]) => typeof v === 'number');
  let body;
  if (s.status === 'pending') body = h('p', { class: 'muted dash-server__note' }, 'Health appears once it is set up.');
  else if (!numeric.length) body = h('p', { class: 'muted dash-server__note' }, 'No readings yet');
  else body = numeric.map(([label, v]) => Meter({ value: v, label }));
  return h('li', { class: 'list__item dash-server' },
    h('div', { class: 'spread' },
      h('a', { class: 'dash-server__name', href: `#/servers/${encodeURIComponent(s.id)}` }, s.name),
      StatusBadge(s.status, SERVER_STATUS[s.status])),
    body);
}

function healthCard(servers, navigate) {
  return Card({ title: 'Server health' },
    servers.length
      ? h('ul', { class: 'list' }, servers.map(serverRow))
      : Empty({
        icon: 'server', title: 'No servers yet', message: 'Add a server to start keeping an eye on it.',
        action: Button({ variant: 'primary', size: 'sm', icon: 'server', onclick: () => navigate('/servers/new') }, 'Add a server'),
      }),
    h('a', { class: 'link row dash-more', href: '#/servers' }, 'View all servers', icon('arrow-right', { size: 16 })));
}

function quickCard() {
  return Card({ title: 'Quick actions' },
    h('nav', { class: 'grid dash-tiles', 'aria-label': 'Quick actions' }, QUICK.map((q) =>
      h('a', { class: 'glass glass--thin glass--interactive dash-tile', href: q.href },
        h('span', { class: 'dash-ico', style: { '--c': q.color } }, icon(q.icon, { size: 20 })),
        h('strong', {}, q.title),
        h('span', { class: 'muted dash-tile__hint' }, q.hint)))));
}

function dashboardSkeleton() {
  return h('div', { class: 'stack' },
    h('div', { class: 'grid grid--4 dash-kpis' }, Array.from({ length: 4 }, () => h('div', { class: 'glass stat' }, Skeleton({ lines: 2 })))),
    h('div', { class: 'split' }, Card({}, Skeleton({ lines: 6 })), Card({}, Skeleton({ lines: 6 }))));
}

export default async function mount(root, ctx) {
  await ensureCss('css/view-dashboard.css');
  if (ctx.signal.aborted) return;

  const navigate = ctx.navigate;
  const body = h('div', { class: 'stack' });
  let busy = false;

  const content = (ov) => {
    const { kpis, revenue = [], servers = [], activity = [] } = ov;
    return [
      kpiRow({ kpis, revenue, servers }),
      h('div', { class: 'split' },
        h('div', { class: 'stack' }, revenueCard({ kpis, revenue }), activityCard(activity)),
        h('div', { class: 'stack' }, healthCard(servers, navigate), quickCard())),
    ];
  };

  // Marks the loader busy so the timer never overlaps a request that is already in flight.
  const load = () => {
    busy = true;
    return api.get('/api/overview', { signal: ctx.signal }).finally(() => { busy = false; });
  };

  root.append(PageHeader({
    title: greeting(),
    subtitle: "Here's what's happening with your clients, websites and servers.",
    actions: [
      Button({ variant: 'primary', icon: 'rocket', onclick: () => navigate('/onboard') }, 'Add a new client'),
      Button({ variant: 'glass', icon: 'server', onclick: () => navigate('/servers/new') }, 'Add a server'),
    ],
  }), body);

  loadInto(body, load, content, { skeleton: dashboardSkeleton() });

  // Quiet refresh: swap the content in place. On failure keep what is on screen and try again next tick.
  async function refresh() {
    if (busy || document.hidden) return;
    try {
      const ov = await load();
      if (!ctx.signal.aborted) body.replaceChildren(...content(ov));
    } catch { /* keep the last good content */ }
  }

  const timer = setInterval(refresh, REFRESH_MS);
  const stop = () => clearInterval(timer);
  ctx.signal.addEventListener('abort', stop, { once: true });
  return stop;
}
