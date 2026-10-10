// Billing view (#/billing): KPIs, 12-month revenue, care plans and a filterable invoice table.
import { h, debounce, ensureCss } from '../core/dom.js';
import { api } from '../core/api.js';
import { state } from '../core/store.js';
import { toast } from '../core/toast.js';
import { money, date, num } from '../core/fmt.js';
import { PageHeader, Card, Button, setLoading, Badge, StatusBadge, Stat, Table, Segmented, Input, Modal, Empty, Skeleton, loadInto } from '../ui/components.js';
import { AreaChart } from '../ui/charts.js';
import { Term } from '../ui/glossary.js';

const CURRENCY = 'GBP'; // LRWeb's currency, used only if the data has none
const STATUS_FILTERS = [['all', 'All'], ['open', 'Waiting'], ['overdue', 'Overdue'], ['paid', 'Paid']];
const INVOICE_STATUS = { open: 'Waiting to be paid', overdue: 'Overdue (late)', paid: 'Paid', draft: 'Draft', void: 'Cancelled' };
const isOpen = (inv) => inv.status === 'open' || inv.status === 'overdue';
const isOverdue = (inv) => inv.status === 'overdue';
const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);
const swap = (oldEl, newEl) => { oldEl?.replaceWith(newEl); return newEl; };
const invoiceStatus = (inv) => StatusBadge(inv.status, INVOICE_STATUS[inv.status]);

/** Integration for the subtitle and badge. Uses the store, falling back to GET /api/health. */
async function billingIntegration(signal) {
  const cached = state.get('health')?.integrations?.billing;
  if (cached) return cached;
  try {
    const health = await api.get('/api/health', { signal });
    state.set('health', health);
    return health?.integrations?.billing ?? null;
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    return null;
  }
}

export default async function mount(root, ctx) {
  const { signal } = ctx;
  await ensureCss('css/view-billing.css');
  const integ = await billingIntegration(signal);

  // View state. It survives Refresh; DOM regions are swapped in place.
  let summary = {};
  let plans = [];
  let invoices = [];
  let filter = 'all';
  let query = '';
  let kpiEl = null;
  let revenueEl = null;
  let segEl = null;
  let searchEl = null;
  let tableSlot = null;
  let detail = null; // open invoice modal: { inv, m, close(), refresh() }

  /* ---------- KPIs and revenue (driven by the summary) ---------- */

  function kpiGrid() {
    const cur = summary.currency || CURRENCY;
    const overdueCount = invoices.filter(isOverdue).length;
    const active = num(summary.activeSubscriptions);
    return h('div', { class: 'grid grid--4' },
      Stat({
        label: 'Monthly income from care plans', value: money(summary.mrrCents, cur), icon: 'card', accent: 'accent',
        hint: h('span', {}, `${active} active care ${plural(summary.activeSubscriptions, 'plan')}. Also called `, Term('mrr', 'MRR'), '.'),
      }),
      Stat({ label: 'Yearly value of care plans', value: money(summary.arrCents, cur), icon: 'sparkle', accent: 'accent-2' }),
      Stat({ label: 'Waiting to be paid', value: money(summary.outstandingCents, cur), icon: 'receipt', accent: 'warn' }),
      Stat({
        label: 'Overdue', value: money(summary.overdueCents, cur), icon: 'alert', accent: summary.overdueCents > 0 ? 'bad' : 'ok',
        hint: overdueCount ? `${overdueCount} ${plural(overdueCount, 'invoice')} late` : 'Nothing late',
      }));
  }

  function revenueCard() {
    const cur = summary.currency || CURRENCY;
    const rev = summary.revenue || [];
    return Card({ title: 'Revenue', subtitle: 'Paid invoices, last 12 months' },
      AreaChart({
        series: [{ name: 'Revenue', values: rev.map((r) => r.cents / 100) }],
        labels: rev.map((r) => date(`${r.month}-01`, { month: 'short', timeZone: 'UTC' })),
        format: (v) => money(Math.round(v * 100), cur, { compact: true }),
        tipFormat: (v) => money(Math.round(v * 100), cur),
        height: 240,
      }),
      h('p', { class: 'muted billing-foot' }, `Paid this month: ${money(summary.paidThisMonthCents, cur)}`));
  }

  function paintKpis() { kpiEl = swap(kpiEl, kpiGrid()); }
  function paintRevenue() { revenueEl = swap(revenueEl, revenueCard()); }
  function paintSummary(s) { summary = s || {}; paintKpis(); paintRevenue(); }

  /* ---------- care plans ---------- */

  /** The first three features, then "and N more", so each plan stays compact. */
  const featureSummary = (features) => {
    const shown = features.slice(0, 3).join(' · ');
    const more = features.length - 3;
    return more > 0 ? `${shown} and ${more} more` : shown;
  };

  function planRow(p) {
    return h('li', { class: ['list__item', 'billing-plan', p.popular && 'billing-plan--popular'] },
      h('div', { class: 'grow' },
        h('div', { class: 'row billing-plan__name' }, h('strong', {}, p.name), p.popular && Badge({ kind: 'info' }, 'Most popular')),
        h('small', { class: 'muted' }, featureSummary(p.features || []))),
      h('div', { class: 'ta-right num' },
        h('strong', {}, money(p.priceCents, p.currency || CURRENCY)),
        h('small', { class: 'muted' }, p.interval === 'year' ? ' a year' : ' a month')));
  }

  function plansCard() {
    return Card({ title: 'Care plans' },
      plans.length ? h('ul', { class: 'list' }, plans.map(planRow)) : h('p', { class: 'muted' }, 'No care plans yet.'),
      h('p', { class: 'muted billing-foot' }, 'Prices come from your billing system.'));
  }

  /* ---------- invoices ---------- */

  function rowActions(inv) {
    if (!isOpen(inv)) return null;
    return h('div', { class: 'row billing-acts' },
      Button({ variant: 'ghost', size: 'sm', icon: 'mail', class: 'billing-act', title: 'Email invoice', 'aria-label': `Email invoice ${inv.number}`, onclick: (e) => send(inv, e.currentTarget) }),
      Button({ variant: 'glass', size: 'sm', icon: 'check', class: 'billing-act', title: 'Mark as paid', 'aria-label': `Mark ${inv.number} as paid`, onclick: (e) => pay(inv, e.currentTarget) }));
  }

  const columns = [
    { label: 'Invoice', render: (r) => h('span', { class: 'mono' }, r.number) },
    { label: 'Client', render: (r) => h('a', { class: 'link', href: `#/clients/${encodeURIComponent(r.clientId)}` }, r.clientName) },
    { label: 'Description', render: (r) => h('span', { class: 'muted billing-trunc', title: r.description }, r.description) },
    { label: 'Issued', class: 'billing-nw', render: (r) => date(r.issuedAt) },
    { label: 'Due', class: 'billing-nw', render: (r) => h('span', { class: isOverdue(r) && 'billing-late' }, date(r.dueAt)) },
    { label: 'Amount', align: 'right', class: 'num billing-nw', render: (r) => money(r.amountCents, r.currency || CURRENCY) },
    { label: 'Status', render: invoiceStatus },
    { label: 'Actions', align: 'right', render: (r) => rowActions(r) },
  ];

  function filterControl() {
    const count = (f) => (f === 'all' ? invoices.length : invoices.filter((i) => i.status === f).length);
    return Segmented({
      label: 'Show invoices by status',
      value: filter,
      options: STATUS_FILTERS.map(([value, label]) => ({ value, label: [label, h('b', { class: 'billing-count num' }, count(value))] })),
      onchange: (v) => { filter = v; applyFilters(); },
    });
  }

  function clearFilters() {
    filter = 'all';
    query = '';
    if (searchEl) searchEl.value = '';
    segEl = swap(segEl, filterControl());
    applyFilters();
  }

  function invoiceTable(rows) {
    const empty = invoices.length
      ? Empty({ icon: 'search', title: 'No invoices match', message: 'Try another client name, invoice number or status.', action: Button({ variant: 'glass', size: 'sm', icon: 'x', onclick: clearFilters }, 'Clear filters') })
      : Empty({ icon: 'receipt', title: 'No invoices yet', message: 'They will appear here once a client is on a care plan.' });
    return Table({ columns, rows, empty, onRowClick: openInvoice });
  }

  function applyFilters() {
    const q = query.trim().toLowerCase();
    const hit = (s) => (s || '').toLowerCase().includes(q);
    const rows = invoices.filter((i) => (filter === 'all' || i.status === filter) && (!q || hit(i.number) || hit(i.clientName)));
    tableSlot.replaceChildren(invoiceTable(rows));
  }

  /** Replace one row in place (used after Mark as paid) so focus and scroll stay put. */
  function replaceRow(inv) {
    const old = tableSlot.querySelector(`tr[data-key="${CSS.escape(String(inv.id))}"]`);
    if (!old) return;
    const hadFocus = old.contains(document.activeElement);
    const fresh = Table({ columns, rows: [inv], onRowClick: openInvoice }).querySelector('tbody tr');
    old.replaceWith(fresh);
    if (hadFocus) fresh.focus({ preventScroll: true });
  }

  async function send(inv, btn) {
    // Mutations are not tied to ctx.signal: aborting a POST on navigation could drop a payment.
    setLoading(btn, true);
    try {
      await api.post(`/api/billing/invoices/${encodeURIComponent(inv.id)}/send`);
      toast({ title: `Invoice ${inv.number} sent`, message: `Emailed to ${inv.clientName}.`, kind: 'ok' });
    } catch (e) {
      toast({ title: `Could not send invoice ${inv.number}`, message: e.message, kind: 'bad' });
    } finally {
      setLoading(btn, false);
    }
  }

  async function pay(inv, btn) {
    setLoading(btn, true);
    try {
      Object.assign(inv, await api.post(`/api/billing/invoices/${encodeURIComponent(inv.id)}/pay`));
    } catch (e) {
      setLoading(btn, false);
      toast({ title: `Could not mark invoice ${inv.number} as paid`, message: e.message, kind: 'bad' });
      return;
    }
    toast({ title: `Invoice ${inv.number} marked as paid`, message: money(inv.amountCents, inv.currency || CURRENCY), kind: 'ok' });
    replaceRow(inv);
    segEl = swap(segEl, filterControl());
    paintKpis();
    if (detail?.inv === inv) detail.refresh();
    refreshTotals();
  }

  async function refreshTotals() {
    try {
      paintSummary(await api.get('/api/billing/summary', { signal }));
    } catch (e) {
      if (e.name !== 'AbortError') toast({ title: 'Totals did not update', message: e.message, kind: 'warn' });
    }
  }

  /* ---------- invoice detail modal ---------- */

  function detailKv(inv, onNavigate) {
    return h('dl', { class: 'kv' },
      h('dt', {}, 'Invoice number'), h('dd', { class: 'mono' }, inv.number),
      h('dt', {}, 'Client'), h('dd', {}, h('a', { class: 'link', href: `#/clients/${encodeURIComponent(inv.clientId)}`, onclick: onNavigate }, inv.clientName)),
      h('dt', {}, 'Description'), h('dd', {}, inv.description || 'Not set'),
      h('dt', {}, 'Issued'), h('dd', {}, date(inv.issuedAt)),
      h('dt', {}, 'Due'), h('dd', { class: isOverdue(inv) && 'billing-late' }, date(inv.dueAt)),
      h('dt', {}, 'Paid'), h('dd', {}, inv.paidAt ? date(inv.paidAt) : 'Not yet'),
      h('dt', {}, 'Amount'), h('dd', { class: 'num' }, money(inv.amountCents, inv.currency || CURRENCY)),
      h('dt', {}, 'Status'), h('dd', {}, invoiceStatus(inv)));
  }

  function modalActions(inv) {
    if (!isOpen(inv)) return [];
    return [
      Button({ variant: 'glass', icon: 'mail', onclick: (e) => send(inv, e.currentTarget) }, 'Email invoice'),
      Button({ variant: 'primary', icon: 'check', onclick: (e) => pay(inv, e.currentTarget) }, 'Mark as paid'),
    ];
  }

  function openInvoice(inv) {
    const d = { inv, m: null };
    d.close = () => d.m?.close();
    d.refresh = () => {
      const m = d.m;
      m.body.replaceChildren(detailKv(inv, d.close));
      m.el.querySelector('.modal__foot')?.remove();
      const acts = modalActions(inv);
      if (acts.length) m.body.after(h('footer', { class: 'modal__foot' }, acts));
      // The focused button may have been disabled or removed; keep keyboard focus inside the dialog.
      if (!m.el.contains(document.activeElement)) m.el.focus({ preventScroll: true });
    };
    d.m = Modal({
      title: `Invoice ${inv.number}`,
      subtitle: inv.clientName,
      size: 'md',
      content: detailKv(inv, d.close),
      actions: modalActions(inv),
      onClose: () => { if (detail === d) detail = null; },
    });
    detail = d;
  }

  function invoicesCard() {
    segEl = filterControl();
    searchEl = Input({
      type: 'search', placeholder: 'Search by client or invoice', 'aria-label': 'Search invoices', value: query,
      oninput: debounce(() => { query = searchEl.value; applyFilters(); }, 200),
    });
    tableSlot = h('div', { class: 'billing-table' });
    applyFilters();
    return Card({
      flush: true,
      title: 'Invoices',
      actions: invoices.length ? [segEl, h('div', { class: 'billing-search' }, searchEl)] : null,
    }, tableSlot);
  }

  /* ---------- page ---------- */

  const load = () => Promise.all([
    api.get('/api/billing/summary', { signal }),
    api.get('/api/billing/plans', { signal }),
    api.get('/api/billing/invoices', { params: { limit: 200 }, signal }),
  ]);

  function render([s, p, inv]) {
    summary = s || {};
    plans = p || [];
    invoices = inv || [];
    kpiEl = kpiGrid();
    revenueEl = revenueCard();
    return [kpiEl, h('div', { class: 'split' }, revenueEl, plansCard()), invoicesCard()];
  }

  const body = h('div', { class: 'stack' });
  const reload = () => loadInto(body, load, render, { skeleton: Skeleton({ lines: 6, height: 44 }) });

  const refreshBtn = Button({
    variant: 'glass', icon: 'refresh',
    onclick: async (e) => {
      const btn = e.currentTarget;
      setLoading(btn, true);
      await reload();
      setLoading(btn, false);
    },
  }, 'Refresh');
  const badge = integ && (integ.mode === 'mock' ? Badge({ kind: 'info' }, 'Demo data') : Badge({ kind: 'ok' }, 'Live'));

  root.append(
    PageHeader({
      title: 'Billing',
      subtitle: integ ? `Connected to ${integ.label}` : 'Billing status is unavailable right now.',
      actions: [badge, refreshBtn],
    }),
    body);
  reload();

  return () => detail?.close();
}
