// Sites: every site LRWeb provisioned, filtered client-side, plus the provisioning modal.
import { h, debounce, ensureCss } from '../core/dom.js';
import { api, pollJob } from '../core/api.js';
import { bytes } from '../core/fmt.js';
import { toast } from '../core/toast.js';
import { icon } from '../ui/icons.js';
import { PageHeader, Card, Button, Badge, StatusBadge, Input, Select, Segmented, Table, Empty, Modal, Confirm, JobProgress, CopyBlock, loadInto, setLoading } from '../ui/components.js';
import { SiteForm } from '../ui/site-form.js';

const TYPE_LABEL = { php: 'PHP', nodejs: 'Node.js', static: 'Static', python: 'Python', 'reverse-proxy': 'Proxy' };
const TYPE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'php', label: 'PHP' },
  { value: 'nodejs', label: 'Node.js' },
  { value: 'static', label: 'Static' },
  { value: 'python', label: 'Python' },
  { value: 'reverse-proxy', label: 'Proxy' },
];
const SSL = { active: ['ok', 'Secured'], pending: ['warn', 'Pending'], none: ['neutral', 'No SSL'] };

const typeLabel = (s) => {
  const base = TYPE_LABEL[s.type] || s.type;
  return s.runtime && s.type !== 'static' && s.type !== 'reverse-proxy' ? `${base} ${s.runtime}` : base;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Same label as the provisioning form's client picker: company first, then the contact name.
const clientLabel = (c) => (c ? (c.company ? `${c.company} (${c.name})` : c.name) : '');

/**
 * Modal() fixes `dismissible` at construction, so while a job runs we hide the X and
 * swallow Esc and scrim clicks in the capture phase (before the modal's own handlers).
 */
function lockDismiss(m) {
  const x = m.el.querySelector('.modal__head .icon-btn');
  const ac = new AbortController();
  const swallow = (e) => {
    const hit = e.type === 'keydown' ? e.key === 'Escape' : e.target instanceof Element && e.target.classList.contains('scrim');
    if (hit) e.stopPropagation();
  };
  if (x) x.hidden = true;
  window.addEventListener('keydown', swallow, { capture: true, signal: ac.signal });
  window.addEventListener('mousedown', swallow, { capture: true, signal: ac.signal });
  return () => { ac.abort(); if (x) x.hidden = false; };
}

export default async function mount(root, ctx) {
  await ensureCss('css/view-sites.css');

  let sites = [];
  let servers = [];
  let clients = [];
  let meta = null;
  let serverById = new Map();
  let clientById = new Map();
  let search;
  let serverSel;
  let clientSel;
  let typeSeg;
  let tableHost;
  let modal = null;

  const newBtn = Button({ variant: 'primary', icon: 'plus', disabled: true, onclick: () => openProvision() }, 'New site');
  const header = PageHeader({ title: 'Sites', subtitle: 'Loading…', actions: newBtn });
  const subtitle = header.querySelector('.page-head__text p');
  const content = h('div', { class: 'stack' });
  root.append(header, content);
  ctx.signal.addEventListener('abort', () => modal?.close(), { once: true });

  /* ---------- cells ---------- */

  const domainCell = (s) => h('div', { class: 'cell-user' },
    h('span', { class: 'site-globe', 'aria-hidden': 'true' }, icon('globe', { size: 18 })),
    h('div', { class: 'site-domain' },
      h('a', { class: 'site-domain__link', href: `https://${s.domain}`, target: '_blank', rel: 'noopener' }, s.domain, icon('external', { size: 12 })),
      s.siteUser && h('small', { class: 'mono' }, s.siteUser)));

  const serverCell = (s) => {
    const name = serverById.get(s.serverId)?.name || s.serverName;
    return name
      ? h('a', { class: 'link', href: `#/servers/${encodeURIComponent(s.serverId)}` }, name)
      : h('span', { class: 'muted' }, 'Unknown');
  };

  const clientCell = (s) => {
    if (!s.clientId) return h('span', { class: 'muted' }, 'Internal');
    const name = s.clientName || clientLabel(clientById.get(s.clientId)) || 'Client';
    return h('a', { class: 'link', href: `#/clients/${encodeURIComponent(s.clientId)}` }, name);
  };

  const sslCell = (s) => {
    const [kind, label] = SSL[s.ssl] || ['neutral', s.ssl || 'Unknown'];
    return Badge({ kind }, label);
  };

  const actionsCell = (s) => Button({
    variant: 'ghost', size: 'sm', icon: 'trash', class: 'site-delete',
    'aria-label': `Delete ${s.domain}`, title: `Delete ${s.domain}`,
    onclick: (e) => removeSite(s, e.currentTarget),
  });

  const columns = [
    { key: 'domain', label: 'Domain', class: 'cell-main', render: domainCell },
    { key: 'type', label: 'Type', render: (s) => h('span', { class: 'chip' }, typeLabel(s)) },
    { key: 'server', label: 'Server', render: serverCell },
    { key: 'client', label: 'Client', render: clientCell },
    { key: 'ssl', label: 'SSL', render: sslCell },
    { key: 'status', label: 'Status', render: (s) => StatusBadge(s.status) },
    { key: 'disk', label: 'Disk', align: 'right', render: (s) => h('span', { class: 'num' }, bytes((s.diskMb || 0) * 1048576)) },
    { key: 'actions', label: 'Actions', align: 'right', class: 'cell-actions', render: actionsCell },
  ];

  /* ---------- filtering & rendering ---------- */

  const summary = () => `${plural(sites.length, 'site')} across ${plural(new Set(sites.map((s) => s.serverId)).size, 'server')}`;

  function visibleSites() {
    const q = search.value.trim().toLowerCase();
    const serverId = serverSel.value;
    const clientId = clientSel.value;
    const type = typeSeg.value;
    return sites.filter((s) => (!q || s.domain.toLowerCase().includes(q))
      && (!serverId || s.serverId === serverId)
      && (!clientId || s.clientId === clientId)
      && (type === 'all' || s.type === type));
  }

  function clearFilters() {
    search.value = '';
    serverSel.value = '';
    clientSel.value = '';
    typeSeg.querySelector('input[value="all"]').checked = true;
    typeSeg.value = 'all';
    renderTable();
  }

  const noMatch = () => Empty({
    icon: 'search', title: 'No sites match', message: 'Try another domain or clear the filters.',
    action: Button({ variant: 'glass', size: 'sm', onclick: clearFilters }, 'Clear filters'),
  });

  const noSites = () => Empty({
    icon: 'globe', title: 'No sites yet', message: 'Provision a site on one of your servers. CloudPanel sets up the vhost, database and SSL.',
    action: Button({ variant: 'primary', icon: 'plus', onclick: () => openProvision() }, 'Provision your first site'),
  });

  function renderTable() {
    if (ctx.signal.aborted || !tableHost) return;
    const rows = visibleSites();
    const empty = rows.length ? undefined : sites.length ? noMatch() : noSites();
    tableHost.replaceChildren(Card({ flush: true, class: 'sites-card' }, Table({ columns, rows, empty })));
  }

  function renderAll() {
    subtitle.textContent = summary();
    renderTable();
  }

  function toolbar() {
    const typeInit = TYPE_FILTERS.some((o) => o.value === ctx.query.type) ? ctx.query.type : 'all';
    search = Input({
      type: 'search', placeholder: 'Search domains', 'aria-label': 'Search domains',
      value: ctx.query.q || '', oninput: debounce(renderTable, 120),
    });
    serverSel = Select({
      options: [{ value: '', label: 'All servers' }, ...servers.map((s) => ({ value: s.id, label: s.name }))],
      value: ctx.query.serverId || '', 'aria-label': 'Filter by server', onchange: renderTable,
    });
    clientSel = Select({
      options: [{ value: '', label: 'All clients' }, ...clients.map((c) => ({ value: c.id, label: clientLabel(c) }))],
      value: ctx.query.clientId || '', 'aria-label': 'Filter by client', onchange: renderTable,
    });
    typeSeg = Segmented({ label: 'Filter by application type', options: TYPE_FILTERS, value: typeInit, onchange: renderTable });
    return Card({ class: 'sites-toolbar-card' },
      h('div', { class: 'sites-toolbar' }, h('div', { class: 'sites-search' }, search), serverSel, clientSel, typeSeg));
  }

  /* ---------- data ---------- */

  async function refresh(highlightDomain) {
    try {
      sites = await api.get('/api/sites', { signal: ctx.signal });
    } catch (e) {
      if (e.name !== 'AbortError') toast({ title: 'Could not refresh sites', message: e.message, kind: 'bad' });
      return;
    }
    renderAll();
    const created = highlightDomain && sites.find((s) => s.domain === highlightDomain);
    const row = created && tableHost.querySelector(`tr[data-key="${CSS.escape(created.id)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    row.classList.add('is-new');
    setTimeout(() => row.classList.remove('is-new'), 2400);
  }

  async function removeSite(site, btn) {
    const ok = await Confirm({
      danger: true, title: 'Delete site?', confirmLabel: 'Delete',
      message: `This removes ${site.domain} from the server. This cannot be undone.`,
    });
    if (!ok) return;
    setLoading(btn, true);
    try {
      await api.del(`/api/sites/${encodeURIComponent(site.id)}`, { signal: ctx.signal });
    } catch (e) {
      if (e.name === 'AbortError') return;
      setLoading(btn, false);
      toast({ title: 'Could not delete site', message: e.message, kind: 'bad' });
      return;
    }
    sites = sites.filter((s) => s.id !== site.id);
    toast({ title: 'Site deleted', message: site.domain, kind: 'ok' });
    renderAll();
  }

  /* ---------- provisioning modal ---------- */

  function openProvision() {
    if (modal || !meta) return;
    const form = SiteForm({ meta, servers, clients, showClient: true, initial: { serverId: ctx.query.serverId, clientId: ctx.query.clientId } });
    const cancel = Button({ variant: 'ghost', onclick: () => m.close() }, 'Cancel');
    const provision = Button({ variant: 'primary', icon: 'rocket', onclick: () => submit() }, 'Provision');
    let unlock = null;
    let outcome = null; // { domain, ok } once a job has finished, so the list refreshes on close

    const m = Modal({
      title: 'Provision a site',
      subtitle: 'Creates the site on CloudPanel, then a database and SSL if selected',
      size: 'lg',
      content: form.el,
      actions: [cancel, provision],
      onClose: () => {
        unlock?.();
        modal = null;
        if (outcome) refresh(outcome.ok ? outcome.domain : null);
      },
    });
    modal = m;
    const foot = m.el.querySelector('.modal__foot');

    async function submit() {
      if (!form.validate()) return;
      const spec = form.value();
      setLoading(provision, true);
      unlock = lockDismiss(m);
      let job;
      try {
        job = await api.post('/api/sites', spec, { signal: ctx.signal });
      } catch (e) {
        unlock();
        unlock = null;
        if (e.name === 'AbortError') return;
        setLoading(provision, false);
        if (e.field) form.setError(e.field, e.message);
        else toast({ title: 'Could not provision site', message: e.message, kind: 'bad' });
        return;
      }

      const progress = JobProgress(job);
      const stack = h('div', { class: 'stack' }, progress);
      m.body.replaceChildren(stack);
      foot.replaceChildren(Button({ variant: 'glass', disabled: true }, 'Working…'));

      let final;
      try {
        final = await pollJob(job.id, (j) => progress.update(j), { signal: ctx.signal });
      } catch (e) {
        if (e.name === 'AbortError') return;
        final = { status: 'failed', error: e.message };
      }
      unlock();
      unlock = null;
      outcome = { domain: spec.domain, ok: final.status === 'done' };

      if (outcome.ok) {
        const secrets = Object.entries(final.secrets || {});
        if (secrets.length) {
          const warn = h('div', { class: 'callout callout--warn', role: 'status' },
            icon('alert', { size: 18 }), h('p', {}, 'Credentials are shown once - copy them now.'));
          stack.append(warn, ...secrets.map(([label, text]) => CopyBlock({ label, text })));
        }
        foot.replaceChildren(Button({ variant: 'primary', onclick: () => m.close() }, 'Done'));
        toast({ title: 'Site provisioned', message: spec.domain, kind: 'ok' });
      } else {
        progress.querySelector('.job__foot').hidden = true; // the callout carries the error instead
        stack.append(h('div', { class: 'callout callout--bad', role: 'alert' },
          icon('alert', { size: 18 }), h('p', {}, final.error || 'The job failed.')));
        foot.replaceChildren(Button({ variant: 'glass', onclick: () => m.close() }, 'Close'));
        toast({ title: 'Provisioning failed', message: spec.domain, kind: 'bad' });
      }
    }

    return m;
  }

  /* ---------- load ---------- */

  let loaded = false;
  await loadInto(content, () => Promise.all([
    api.get('/api/sites', { signal: ctx.signal }),
    api.get('/api/servers', { signal: ctx.signal }),
    api.get('/api/clients', { signal: ctx.signal }),
    api.get('/api/meta', { signal: ctx.signal }),
  ]), ([siteList, serverList, clientList, options]) => {
    sites = siteList;
    servers = serverList;
    clients = clientList;
    meta = options;
    serverById = new Map(servers.map((s) => [s.id, s]));
    clientById = new Map(clients.map((c) => [c.id, c]));
    tableHost = h('div');
    const bar = toolbar();
    renderAll();
    newBtn.disabled = false;
    loaded = true;
    return [bar, tableHost];
  });

  if (loaded && ctx.query.new) openProvision();
}
