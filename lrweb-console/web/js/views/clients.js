// Clients: one module for the list (#/clients) and the detail (#/clients/:id).
import { h, ensureCss, debounce } from '../core/dom.js';
import { api } from '../core/api.js';
import { money, num, date, ago } from '../core/fmt.js';
import { toast } from '../core/toast.js';
import { PageHeader, Card, Button, Badge, StatusBadge, Avatar, Segmented, Input, Table, Empty, Stat, loadInto, setLoading } from '../ui/components.js';
import { icon } from '../ui/icons.js';

const PLAN_TYPE = { php: 'PHP', nodejs: 'Node.js', static: 'Static', python: 'Python', 'reverse-proxy': 'Reverse proxy' };
const SSL = { active: ['ok', 'SSL on'], pending: ['info', 'SSL pending'], none: ['warn', 'No SSL'] };

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const isDue = (inv) => inv.status === 'open' || inv.status === 'overdue';
const dueTotal = (invoices) => invoices.filter(isDue).reduce((sum, inv) => sum + (inv.amountCents || 0), 0);
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const countLabel = (text, n) => [`${text} `, h('small', { class: 'num' }, n)];

function setSegment(seg, value) {
  seg.querySelectorAll('input').forEach((i) => { i.checked = i.value === value; });
  seg.value = value;
}

function setSubtitle(head, text) {
  const wrap = head.querySelector('.page-head__text');
  let p = wrap.querySelector('p');
  if (!p) {
    p = h('p', { class: 'muted' });
    wrap.append(p);
  }
  p.textContent = text;
}

export default async function mount(root, ctx) {
  await ensureCss('css/view-clients.css');
  return ctx.params.id ? mountDetail(root, ctx) : mountList(root, ctx);
}

/* ---------- list ---------- */

async function mountList(root, ctx) {
  const head = PageHeader({
    title: 'Clients',
    actions: Button({ variant: 'primary', icon: 'rocket', onclick: () => ctx.navigate('/onboard') }, 'Onboard client'),
  });
  const body = h('div', { class: 'stack' });
  root.append(head, body);
  await loadInto(body,
    () => Promise.all([api.get('/api/clients', { signal: ctx.signal }), api.get('/api/billing/plans', { signal: ctx.signal })]),
    ([clients, plans]) => clientList({ clients, plans, head, ctx }));
}

function clientList({ clients, plans, head, ctx }) {
  setSubtitle(head, plural(clients.length, 'client'));
  if (!clients.length) {
    return Card({}, Empty({
      icon: 'users',
      title: 'No clients yet',
      message: 'Onboard your first client to set up their billing account and first site in one flow.',
      action: Button({ variant: 'primary', icon: 'rocket', onclick: () => ctx.navigate('/onboard') }, 'Onboard your first client'),
    }));
  }

  const planById = new Map(plans.map((p) => [p.id, p]));
  const currencyOf = (c) => planById.get(c.planId)?.currency || 'USD';
  const planName = (c) => planById.get(c.planId)?.name || c.planId;
  const countOf = (s) => clients.filter((c) => c.status === s).length;

  let status = 'all';
  const tableBody = h('div');

  const search = Input({
    type: 'search', placeholder: 'Search clients…', 'aria-label': 'Search clients',
    oninput: debounce(() => draw(), 120),
  });
  const filter = Segmented({
    label: 'Filter by status',
    value: status,
    onchange: (v) => { status = v; draw(); },
    options: [
      { value: 'all', label: countLabel('All', clients.length) },
      { value: 'active', label: countLabel('Active', countOf('active')) },
      { value: 'trial', label: countLabel('Trial', countOf('trial')) },
      { value: 'suspended', label: countLabel('Suspended', countOf('suspended')) },
    ],
  });
  filter.classList.add('clients-filter');

  const columns = [
    {
      label: 'Client', class: 'client-main',
      render: (c) => h('div', { class: 'cell-user' }, Avatar({ name: c.name }),
        h('div', { class: 'client-cell' }, h('strong', {}, c.name), h('small', {}, [c.company, c.email].filter(Boolean).join(' · ')))),
    },
    { label: 'Plan', render: (c) => h('span', { class: 'chip' }, planName(c)) },
    { label: 'Status', render: (c) => StatusBadge(c.status) },
    { label: 'Sites', align: 'right', class: 'num', render: (c) => num(c.siteCount) },
    { label: 'MRR', align: 'right', class: 'num', render: (c) => money(c.mrrCents, currencyOf(c)) },
    {
      label: 'Balance', align: 'right', class: 'num',
      render: (c) => (c.balanceCents > 0
        ? h('span', { class: 'client-due' }, money(c.balanceCents, currencyOf(c)))
        : h('span', { class: 'muted' }, '—')),
    },
    {
      label: 'Added',
      render: (c) => h('time', { class: 'muted', datetime: c.createdAt, title: date(c.createdAt) }, ago(c.createdAt)),
    },
  ];

  function clearFilters() {
    search.value = '';
    status = 'all';
    setSegment(filter, 'all');
    draw();
    search.focus();
  }

  function draw() {
    const q = search.value.trim().toLowerCase();
    const rows = clients.filter((c) => (status === 'all' || c.status === status)
      && (!q || [c.name, c.company, c.email].some((v) => (v || '').toLowerCase().includes(q))));
    tableBody.replaceChildren(Table({
      columns,
      rows,
      onRowClick: (c) => ctx.navigate(`/clients/${c.id}`),
      empty: Empty({
        icon: 'search',
        title: 'No clients match',
        message: 'Try another name, company or email, or clear the filters.',
        action: Button({ variant: 'glass', icon: 'x', onclick: clearFilters }, 'Clear filters'),
      }),
    }));
  }

  const toolbar = Card({ class: 'clients-toolbar' },
    h('div', { class: 'row' }, h('div', { class: 'clients-search' }, icon('search', { size: 18 }), search), filter));
  const tableCard = Card({ flush: true, class: 'clients-table' }, tableBody);
  draw();
  return [toolbar, tableCard];
}

/* ---------- detail ---------- */

async function mountDetail(root, ctx) {
  const id = ctx.params.id;
  const body = h('div', { class: 'stack' });
  root.append(body);
  await loadInto(body,
    () => Promise.all([
      api.get(`/api/clients/${encodeURIComponent(id)}`, { signal: ctx.signal }).catch((e) => {
        if (e.status === 404) return null;
        throw e;
      }),
      api.get('/api/billing/plans', { signal: ctx.signal }),
    ]),
    ([client, plans]) => (client ? clientDetail({ client, plans, id, ctx }) : notFound(ctx)));
}

function notFound(ctx) {
  return Card({}, Empty({
    icon: 'search',
    title: 'Client not found',
    message: 'It may have been removed, or the link is out of date.',
    action: Button({ variant: 'glass', icon: 'chevron-left', onclick: () => ctx.navigate('/clients') }, 'Back to clients'),
  }));
}

const siteColumns = [
  {
    label: 'Domain', class: 'client-main',
    render: (s) => h('div', { class: 'site-cell' },
      h('a', { class: 'link site-domain', href: `https://${s.domain}`, target: '_blank', rel: 'noopener' }, s.domain, icon('external', { size: 14 })),
      s.serverName && h('small', { class: 'muted' }, s.serverName)),
  },
  { label: 'Type', render: (s) => h('span', { class: 'chip' }, `${PLAN_TYPE[s.type] || s.type}${s.runtime ? ` ${s.runtime}` : ''}`) },
  {
    label: 'SSL',
    render: (s) => {
      const [kind, text] = SSL[s.ssl] || ['neutral', s.ssl];
      return Badge({ kind }, text);
    },
  },
  { label: 'Status', render: (s) => StatusBadge(s.status) },
];

function clientDetail({ client, plans, id, ctx }) {
  const plan = plans.find((p) => p.id === client.planId);
  const currency = plan?.currency || 'USD';
  const sites = client.sites ?? [];
  const invoices = client.invoices ?? [];
  let balance = client.balanceCents ?? dueTotal(invoices);
  document.title = `${client.name} · LRWeb Console`;

  const provision = () => ctx.navigate(`/sites?clientId=${encodeURIComponent(id)}`);

  const balanceStat = (cents) => Stat({
    label: 'Balance due',
    icon: 'receipt',
    value: money(cents, currency),
    accent: cents > 0 ? 'bad' : 'ok',
    hint: cents > 0 ? plural(invoices.filter(isDue).length, 'unpaid invoice') : 'All paid',
  });
  let balanceEl = balanceStat(balance);

  async function refreshBalance() {
    try {
      const fresh = await api.get(`/api/clients/${encodeURIComponent(id)}`, { signal: ctx.signal });
      balance = fresh.balanceCents ?? dueTotal(invoices);
    } catch (e) {
      if (e.name === 'AbortError') return;
      balance = dueTotal(invoices);
    }
    const next = balanceStat(balance);
    balanceEl.replaceWith(next);
    balanceEl = next;
  }

  async function sendInvoice(inv, btn) {
    setLoading(btn, true);
    try {
      await api.post(`/api/billing/invoices/${inv.id}/send`, {}, { signal: ctx.signal });
      setLoading(btn, false);
      toast({ title: 'Invoice sent', message: `${inv.number} emailed to ${client.email}`, kind: 'ok' });
    } catch (e) {
      setLoading(btn, false);
      if (e.name !== 'AbortError') toast({ title: 'Invoice not sent', message: e.message, kind: 'bad' });
    }
  }

  async function markPaid(inv, btn) {
    setLoading(btn, true);
    try {
      Object.assign(inv, await api.post(`/api/billing/invoices/${inv.id}/pay`, {}, { signal: ctx.signal }));
    } catch (e) {
      setLoading(btn, false);
      if (e.name !== 'AbortError') toast({ title: 'Could not mark paid', message: e.message, kind: 'bad' });
      return;
    }
    toast({ title: 'Invoice marked paid', message: `${inv.number} · ${money(inv.amountCents, inv.currency)}`, kind: 'ok' });
    refreshInvoiceRow(inv);
    await refreshBalance();
  }

  const invoiceActions = (inv) => (isDue(inv)
    ? h('div', { class: 'row client-row-actions' },
      Button({ size: 'sm', variant: 'glass', icon: 'mail', onclick: (e) => sendInvoice(inv, e.currentTarget) }, 'Send'),
      Button({ size: 'sm', variant: 'primary', icon: 'check', onclick: (e) => markPaid(inv, e.currentTarget) }, 'Mark paid'))
    : null);

  const invoiceColumns = [
    { label: 'Invoice', class: 'client-main', render: (i) => h('span', { class: 'mono' }, i.number) },
    { label: 'Issued', render: (i) => date(i.issuedAt) },
    { label: 'Due', render: (i) => date(i.dueAt) },
    { label: 'Amount', align: 'right', class: 'num', render: (i) => money(i.amountCents, i.currency) },
    { label: 'Status', render: (i) => StatusBadge(i.status) },
    { label: 'Actions', align: 'right', render: (i) => invoiceActions(i) },
  ];

  // Swaps only the status and actions cells, so the rest of the table keeps its state.
  function refreshInvoiceRow(inv) {
    const tr = invoiceBody.querySelector(`tr[data-key="${CSS.escape(inv.id)}"]`);
    if (!tr) return;
    tr.querySelector('td[data-label="Status"]').replaceChildren(StatusBadge(inv.status));
    const actions = invoiceActions(inv);
    tr.querySelector('td[data-label="Actions"]').replaceChildren(...(actions ? [actions] : []));
    tr.tabIndex = -1;
    tr.focus({ preventScroll: true });
  }

  const invoiceBody = h('div');
  invoiceBody.append(Table({
    columns: invoiceColumns,
    rows: invoices,
    empty: Empty({ icon: 'receipt', title: 'No invoices yet', message: 'Invoices appear here once the plan is billed.' }),
  }));
  const invoicesCard = Card({ title: 'Invoices', flush: true }, invoiceBody);

  const scrollToInvoices = () => {
    invoicesCard.tabIndex = -1;
    invoicesCard.scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });
    invoicesCard.focus({ preventScroll: true });
  };

  const back = h('a', { class: 'client-back', href: '#/clients' }, icon('chevron-left', { size: 18 }), 'Clients');

  const hero = Card({ class: 'client-hero' },
    h('div', { class: 'client-hero__who' },
      Avatar({ name: client.name, size: 56 }),
      h('div', { class: 'client-hero__text' },
        h('h1', {}, client.name),
        client.company && h('p', { class: 'muted' }, client.company),
        h('div', { class: 'row client-hero__meta' },
          StatusBadge(client.status),
          h('a', { class: 'chip client-chip', href: `mailto:${client.email}`, title: client.email }, icon('mail', { size: 14 }), h('span', {}, client.email)),
          client.phone && h('a', { class: 'chip client-chip', href: `tel:${client.phone}` }, h('span', {}, client.phone))))),
    h('div', { class: 'client-hero__actions' },
      Button({ variant: 'primary', icon: 'globe', onclick: provision }, 'Provision site'),
      Button({ variant: 'glass', icon: 'receipt', onclick: scrollToInvoices }, 'View invoices')));

  const stats = h('div', { class: 'grid grid--4' },
    Stat({
      label: 'Plan', icon: 'card', value: plan?.name || client.planId,
      hint: plan ? `${money(plan.priceCents, plan.currency || 'USD')} per ${plan.interval === 'year' ? 'year' : 'month'}` : 'No plan',
    }),
    Stat({ label: 'MRR', icon: 'bolt', value: money(client.mrrCents, currency), hint: 'Monthly recurring' }),
    balanceEl,
    Stat({ label: 'Sites', icon: 'globe', value: num(sites.length), hint: sites.length ? 'Provisioned' : 'None yet' }));

  const sitesCard = Card({ title: 'Sites', subtitle: plural(sites.length, 'site'), flush: true },
    Table({
      columns: siteColumns,
      rows: sites,
      empty: Empty({
        icon: 'globe',
        title: 'No sites yet',
        message: 'Provision the first site for this client.',
        action: Button({ variant: 'primary', icon: 'globe', onclick: provision }, 'Provision a site'),
      }),
    }));

  const billing = Card({ title: 'Billing details' },
    h('dl', { class: 'kv' },
      h('dt', {}, 'Billing customer ID'), h('dd', { class: 'mono' }, client.billingCustomerId || '—'),
      h('dt', {}, 'Member since'), h('dd', {}, date(client.createdAt)),
      h('dt', {}, 'Plan'), h('dd', {}, plan?.name || client.planId),
      h('dt', {}, 'Interval'), h('dd', {}, plan ? (plan.interval === 'year' ? 'Yearly' : 'Monthly') : '—')));

  return [back, hero, stats, h('div', { class: 'split' }, sitesCard, billing), invoicesCard];
}
