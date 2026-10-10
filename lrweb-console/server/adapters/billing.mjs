// Billing adapter. 'mock' keeps demo history in the store; 'whmcs' and 'stripe' call the live APIs
// through config.fetch. Money is integer cents; timestamps are ISO-8601 (UTC).
import { randomBytes, randomUUID } from 'node:crypto';
import { randomPassword } from '../validate.mjs';

const DAY = 86_400_000;
const STATUSES = ['paid', 'open', 'overdue', 'draft', 'void'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const iso = (ms) => new Date(ms).toISOString();
const asArray = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
const invoiceSeq = (n) => String(n).padStart(4, '0');
const hostOf = (url) => {
  try { return new URL(url).host; } catch { return url ? 'invalid URL' : ''; }
};

function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

/** Every upstream failure goes through here: known secrets and key-shaped strings are removed. */
function upstreamError(message, secrets) {
  let text = String(message);
  for (const s of secrets) if (s) text = text.split(s).join('[redacted]');
  text = text.replace(/\b(?:sk|rk|pk)_[A-Za-z0-9_]+/g, '[redacted]');
  return httpError(502, text, 'billing_upstream');
}

/** "1,234.50", "15.00" or 15 -> integer cents. Unparseable input is 0. */
function toCents(v) {
  const n = Number(String(v ?? '0').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** WHMCS dates are "YYYY-MM-DD[ HH:MM:SS]"; "0000-00-00 ..." means unset. */
function parseUpstreamDate(v) {
  const s = String(v ?? '').trim();
  if (!s || s.startsWith('0000')) return undefined;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(t) ? undefined : iso(t);
}

/** Unpaid invoices whose due date has passed are overdue; paid, draft and void pass through. */
function settleStatus(status, dueAt, nowMs) {
  if (status !== 'open' && status !== 'overdue') return status;
  return Date.parse(dueAt) < nowMs ? 'overdue' : 'open';
}

/** Public Invoice shape. Client identity is resolved at read time from billingCustomerId, never stored. */
function toInvoice(raw, { store, now, currency }) {
  const client = raw.customerId ? store.findOne('clients', (c) => c.billingCustomerId === raw.customerId) : undefined;
  return {
    id: raw.id,
    number: raw.number,
    clientId: client?.id ?? '',
    clientName: client ? client.company || client.name || '' : raw.clientName || '',
    amountCents: raw.amountCents,
    currency,
    status: settleStatus(raw.status, raw.dueAt, now()),
    issuedAt: raw.issuedAt,
    dueAt: raw.dueAt,
    ...(raw.paidAt ? { paidAt: raw.paidAt } : {}),
    description: raw.description || `Invoice ${raw.number}`,
  };
}

/** Active subscriptions for the live modes: CRM clients that are active on a plan. */
const activeClientSubs = (store) =>
  store.find('clients', (c) => c.status === 'active' && c.planId).map((c) => ({ planId: c.planId }));

/** Pure summary over listInvoices() output, active subscriptions ({ planId }) and the plan list. */
function computeSummary({ invoices, activeSubs, plans, currency, now }) {
  const byId = new Map(plans.map((p) => [p.id, p]));
  const mrrCents = activeSubs.reduce((sum, s) => {
    const p = byId.get(s.planId);
    if (!p) return sum;
    return sum + (p.interval === 'year' ? Math.round(p.priceCents / 12) : p.priceCents);
  }, 0);

  const nowMs = now();
  const d = new Date(nowMs);
  const thisMonth = iso(nowMs).slice(0, 7);
  const buckets = new Map();
  for (let i = 11; i >= 0; i--) {
    buckets.set(iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).slice(0, 7), 0);
  }

  let outstandingCents = 0;
  let overdueCents = 0;
  let paidThisMonthCents = 0;
  for (const inv of invoices) {
    if (inv.status === 'open' || inv.status === 'overdue') outstandingCents += inv.amountCents;
    if (inv.status === 'overdue') overdueCents += inv.amountCents;
    if (inv.status === 'paid' && inv.paidAt) {
      const key = inv.paidAt.slice(0, 7);
      if (key === thisMonth) paidThisMonthCents += inv.amountCents;
      if (buckets.has(key)) buckets.set(key, buckets.get(key) + inv.amountCents);
    }
  }

  return {
    currency,
    mrrCents,
    arrCents: mrrCents * 12,
    outstandingCents,
    overdueCents,
    paidThisMonthCents,
    activeSubscriptions: activeSubs.length,
    revenue: [...buckets].map(([month, cents]) => ({ month, cents })),
  };
}

// ---- mock: deterministic demo history kept in the store ----

const PLANS = [
  { id: 'plan_starter', name: 'Starter', priceCents: 1500, interval: 'month', popular: false,
    features: ['1 website', '10 GB disk', '100 GB bandwidth', 'Free SSL certificates'],
    limits: { sites: 1, diskGb: 10, bandwidthGb: 100 } },
  { id: 'plan_business', name: 'Business', priceCents: 3900, interval: 'month', popular: true,
    features: ['5 websites', '50 GB disk', '500 GB bandwidth', 'Staging environment', 'Priority support'],
    limits: { sites: 5, diskGb: 50, bandwidthGb: 500 } },
  { id: 'plan_agency', name: 'Agency', priceCents: 9900, interval: 'month', popular: false,
    features: ['25 websites', '200 GB disk', '2000 GB bandwidth', 'Multiple PHP and Node.js versions', 'Dedicated onboarding'],
    limits: { sites: 25, diskGb: 200, bandwidthGb: 2000 } },
];

const invoiceId = (seq) => `inv_${invoiceSeq(seq)}`;
const invoiceNumber = (ms, seq) => `LR-${new Date(ms).getUTCFullYear()}-${invoiceSeq(seq)}`;
const monthYear = (ms) => `${MONTHS[new Date(ms).getUTCMonth()]} ${new Date(ms).getUTCFullYear()}`;

/** FNV-1a: string -> 32-bit seed. */
function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** mulberry32: small seeded PRNG so the demo history is identical on every boot. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Monthly invoices for one active or suspended client, oldest first (max 12). Depends only on client, now and rng. */
function monthlyHistory(client, nowMs, rng) {
  const created = new Date(client.createdAt);
  const day = Math.min(created.getUTCDate(), 28);
  const endIdx = new Date(nowMs).getUTCFullYear() * 12 + new Date(nowMs).getUTCMonth();
  const startIdx = created.getUTCFullYear() * 12 + created.getUTCMonth();
  const issued = [];
  for (let idx = Math.max(startIdx, endIdx - 11); idx <= endIdx; idx++) {
    const ms = Date.UTC(Math.floor(idx / 12), idx % 12, day, 9);
    if (ms <= nowMs) issued.push(ms);
  }
  const latestOpen = rng() < 0.25;
  const suspended = client.status === 'suspended';
  return issued.map((issuedMs, i) => {
    const fromLatest = issued.length - 1 - i;
    const unpaid = suspended ? fromLatest < 2 : fromLatest === 0 && latestOpen;
    const paidDays = 2 + Math.floor(rng() * 4);
    return { issuedMs, unpaid, paidMs: Math.min(issuedMs + paidDays * DAY, nowMs) };
  });
}

function mockBackend({ ctx }) {
  const { store, now, currency } = ctx;

  function seedHistory() {
    const subs = [];
    const rows = [];
    for (const c of store.all('clients')) {
      const plan = PLANS.find((p) => p.id === c.planId);
      if (!plan || !c.billingCustomerId) continue;
      const sub = { id: `sub_${c.id.replace(/^cli_/, '')}`, clientId: c.id, customerId: c.billingCustomerId, planId: plan.id, startedAt: c.createdAt };
      if (c.status === 'trial') {
        subs.push({ ...sub, status: 'trialing' });
        continue;
      }
      if (c.status !== 'active' && c.status !== 'suspended') continue;
      subs.push({ ...sub, status: c.status === 'suspended' ? 'past_due' : 'active' });
      const rng = mulberry32(hash32(c.id));
      for (const h of monthlyHistory(c, now(), rng)) {
        rows.push({ ...h, customerId: c.billingCustomerId, amountCents: plan.priceCents, description: `${plan.name} plan, ${monthYear(h.issuedMs)}` });
      }
    }
    subs.forEach((s) => store.insert('subscriptions', s));
    // Sequence numbers follow issue order, with customerId as the tie-break, so they never depend on store order.
    rows.sort((a, b) => a.issuedMs - b.issuedMs || (a.customerId < b.customerId ? -1 : a.customerId > b.customerId ? 1 : 0));
    rows.forEach((r, i) => {
      const seq = i + 1;
      store.insert('invoices', {
        id: invoiceId(seq),
        number: invoiceNumber(r.issuedMs, seq),
        customerId: r.customerId,
        description: r.description,
        amountCents: r.amountCents,
        status: r.unpaid ? 'open' : 'paid',
        issuedAt: iso(r.issuedMs),
        dueAt: iso(r.issuedMs + 7 * DAY),
        ...(r.unpaid ? {} : { paidAt: iso(r.paidMs) }),
      });
    });
  }

  /** Runs once, the first time any billing state is touched. Needs clients to exist, so an empty store is not marked. */
  function ensureSeeded() {
    if (store.meta.get('billing_mock_seeded') || store.all('clients').length === 0) return;
    seedHistory();
    store.meta.set('billing_mock_seeded', true);
  }

  return {
    describe: () => ({ mode: 'mock', label: 'Mock billing', ready: true, details: { currency, history: 'generated from seeded clients' } }),

    async listPlans() {
      return PLANS.map((p) => ({ ...p, currency }));
    },

    async createCustomer() {
      return { customerId: `cus_${randomBytes(4).toString('hex')}` };
    },

    async subscribe({ customerId, planId }) {
      ensureSeeded();
      const plan = PLANS.find((p) => p.id === planId);
      if (!plan) throw httpError(404, `Unknown plan ${planId}`, 'plan_not_found');
      const nowMs = now();
      const client = store.findOne('clients', (c) => c.billingCustomerId === customerId);
      const sub = store.insert('subscriptions', { clientId: client?.id ?? '', customerId, planId, status: 'active', startedAt: iso(nowMs) });
      const seq = store.all('invoices').length + 1;
      const inv = store.insert('invoices', {
        id: invoiceId(seq),
        number: invoiceNumber(nowMs, seq),
        customerId,
        description: `${plan.name} plan, ${monthYear(nowMs)}`,
        amountCents: plan.priceCents,
        status: 'open',
        issuedAt: iso(nowMs),
        dueAt: iso(nowMs + 7 * DAY),
      });
      return { subscriptionId: sub.id, invoice: toInvoice(inv, ctx) };
    },

    /** Unfiltered by status and limit: the adapter wrapper applies both to every mode. */
    async list({ customerId }) {
      ensureSeeded();
      return store.find('invoices', (r) => !customerId || r.customerId === customerId).map((r) => toInvoice(r, ctx));
    },

    async activeSubscriptions() {
      ensureSeeded();
      return store.find('subscriptions', (s) => s.status === 'active').map((s) => ({ planId: s.planId }));
    },

    async sendInvoice(id) {
      ensureSeeded();
      const row = store.get('invoices', id);
      if (!row) throw httpError(404, 'Invoice not found', 'invoice_not_found');
      const { number, clientName } = toInvoice(row, ctx);
      store.insert('events', { ts: iso(now()), kind: 'billing', text: `Invoice ${number} emailed to ${clientName || 'client'}` });
      return { sent: true };
    },

    async markPaid(id) {
      ensureSeeded();
      const row = store.get('invoices', id);
      if (!row) throw httpError(404, 'Invoice not found', 'invoice_not_found');
      if (row.status === 'void') throw httpError(409, 'A void invoice cannot be marked paid', 'invoice_void');
      if (row.status === 'paid') return toInvoice(row, ctx);
      return toInvoice(store.update('invoices', id, { status: 'paid', paidAt: iso(now()) }), ctx);
    },
  };
}

// ---- WHMCS: form-encoded API at {url}/includes/api.php ----

const WHMCS_STATUS_IN = { Paid: 'paid', Unpaid: 'open', 'Payment Pending': 'open', Overdue: 'overdue', Collections: 'overdue', Cancelled: 'void', Refunded: 'void', Draft: 'draft' };
const WHMCS_STATUS_OUT = { paid: 'Paid', open: 'Unpaid', overdue: 'Overdue', void: 'Cancelled', draft: 'Draft' };

function whmcsBackend({ config, ctx }) {
  const { store, now, currency } = ctx;
  const w = config.billing.whmcs;
  const secrets = [w.identifier, w.secret];

  /** POST one API action. WHMCS reports failures as result:'error' even on HTTP 200, so both are checked. */
  async function call(action, fields = [], extraSecrets = []) {
    const all = [...secrets, ...extraSecrets];
    const body = new URLSearchParams([
      ['identifier', w.identifier],
      ['secret', w.secret],
      ['responsetype', 'json'],
      ['action', action],
      ...fields,
    ]);
    let res;
    try {
      res = await (config.fetch ?? globalThis.fetch)(`${w.url}/includes/api.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: body.toString(),
      });
    } catch (err) {
      throw upstreamError(`WHMCS ${action} request failed: ${err?.message}`, all);
    }
    let data = null;
    try { data = JSON.parse(await res.text()); } catch { data = null; }
    if (!data || typeof data !== 'object') throw upstreamError(`WHMCS ${action} returned HTTP ${res.status} with a non-JSON body`, all);
    if (!res.ok || data.result === 'error') throw upstreamError(`WHMCS ${action} failed: ${data.message || `HTTP ${res.status}`}`, all);
    return data;
  }

  /** Raw WHMCS invoice -> record for toInvoice(). A datepaid of 0000-00-00 means unpaid. */
  function fromWhmcs(raw) {
    const issuedAt = parseUpstreamDate(raw.date) ?? iso(now());
    const paidAt = parseUpstreamDate(raw.datepaid);
    return {
      id: String(raw.id ?? raw.invoiceid ?? ''),
      number: String(raw.invoicenum || raw.id || raw.invoiceid || ''),
      customerId: String(raw.userid ?? ''),
      clientName: raw.companyname || [raw.firstname, raw.lastname].filter(Boolean).join(' '),
      amountCents: toCents(raw.total),
      status: WHMCS_STATUS_IN[raw.status] ?? 'open',
      issuedAt,
      dueAt: parseUpstreamDate(raw.duedate) ?? iso(Date.parse(issuedAt) + 7 * DAY),
      ...(paidAt ? { paidAt } : {}),
    };
  }

  return {
    describe: () => ({
      mode: 'whmcs',
      label: 'WHMCS',
      ready: Boolean(w.url && w.identifier && w.secret),
      details: { host: hostOf(w.url), paymentMethod: w.paymentMethod, credentials: w.identifier && w.secret ? 'configured' : 'missing' },
    }),

    async listPlans() {
      const data = await call('GetProducts');
      return asArray(data.products?.product).flatMap((p) => {
        const priceCents = toCents(p.pricing?.[currency]?.monthly);
        if (priceCents <= 0) return [];
        return [{
          id: `whmcs_${p.pid}`,
          name: String(p.name ?? `Product ${p.pid}`),
          priceCents,
          interval: 'month',
          currency,
          // Shown via textContent in the UI, so only tags are stripped here.
          features: String(p.description ?? '')
            .split(/<br\s*\/?>|\r?\n/i)
            .map((line) => line.replace(/<[^>]*>/g, '').trim())
            .filter(Boolean),
          limits: { sites: 0, diskGb: 0, bandwidthGb: 0 },
        }];
      });
    },

    async createCustomer({ name, email, company }) {
      const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
      const firstname = parts.shift() ?? '';
      const password = randomPassword();
      const data = await call('AddClient', [
        ['firstname', firstname],
        ['lastname', parts.join(' ') || '-'],
        ['email', email],
        ['companyname', company ?? ''],
        ['skipvalidation', 'true'],
        ['password2', password],
      ], [password]);
      if (data.clientid == null) throw upstreamError('WHMCS AddClient returned no clientid', secrets);
      return { customerId: String(data.clientid) };
    },

    async subscribe({ customerId, planId }) {
      const pid = /^whmcs_(.+)$/.exec(String(planId ?? ''))?.[1];
      if (!pid) throw httpError(404, `Unknown plan ${planId}`, 'plan_not_found');
      const order = await call('AddOrder', [
        ['clientid', customerId],
        ['pid[]', pid],
        ['billingcycle[]', 'monthly'],
        ['paymentmethod', w.paymentMethod],
      ]);
      const latest = await call('GetInvoices', [['userid', customerId], ['orderby', 'id'], ['order', 'desc'], ['limitnum', '1']]);
      const raw = asArray(latest.invoices?.invoice)[0];
      if (!raw) throw upstreamError('WHMCS returned no invoice for the new order', secrets);
      return { subscriptionId: String(order.orderid), invoice: toInvoice(fromWhmcs(raw), ctx) };
    },

    /** Newest first at the source; the wrapper re-applies status and limit for every mode. */
    async list({ customerId, status, limit }) {
      const fields = [['orderby', 'id'], ['order', 'desc'], ['limitnum', String(limit)]];
      if (customerId) fields.push(['userid', customerId]);
      if (status) fields.push(['status', WHMCS_STATUS_OUT[status]]);
      const data = await call('GetInvoices', fields);
      return asArray(data.invoices?.invoice).map((raw) => toInvoice(fromWhmcs(raw), ctx));
    },

    async activeSubscriptions() {
      return activeClientSubs(store);
    },

    async sendInvoice(invoiceId) {
      await call('SendEmail', [['messagename', 'Invoice Created'], ['id', invoiceId]]);
      return { sent: true };
    },

    async markPaid(invoiceId) {
      await call('AddInvoicePayment', [['invoiceid', invoiceId], ['transid', `lrweb-${now()}`], ['gateway', w.paymentMethod]]);
      const raw = await call('GetInvoice', [['invoiceid', invoiceId]]);
      return toInvoice(fromWhmcs(raw), ctx);
    },
  };
}

// ---- Stripe: REST API, form-encoded bodies, Bearer auth ----

const STRIPE_STATUS = { draft: 'draft', open: 'open', paid: 'paid', void: 'void', uncollectible: 'void' };
const intOf = (v) => Number.parseInt(v ?? '', 10) || 0;

/** Shows only the key type and last four characters, e.g. sk_…p7dc. */
function maskKey(key) {
  const k = String(key ?? '');
  if (!k) return 'missing';
  if (k.length < 8) return 'set';
  const m = /^([a-z]{2,4})_/.exec(k);
  return `${m ? m[1] : 'key'}_…${k.slice(-4)}`;
}

function stripeBackend({ config, ctx }) {
  const { store, now, currency } = ctx;
  const s = config.billing.stripe;
  const base = s.apiBase.replace(/\/+$/, '');
  const secrets = [s.secretKey];

  /** One API call. POSTs carry a fresh Idempotency-Key so a retried request cannot double-charge. */
  async function call(method, path, { query, form } = {}) {
    const headers = { Authorization: `Bearer ${s.secretKey}` };
    const init = { method, headers };
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = form.toString();
    }
    if (method === 'POST') headers['Idempotency-Key'] = randomUUID();
    const url = `${base}${path}${query ? `?${query.toString()}` : ''}`;
    let res;
    try {
      res = await (config.fetch ?? globalThis.fetch)(url, init);
    } catch (err) {
      throw upstreamError(`Stripe ${method} ${path} request failed: ${err?.message}`, secrets);
    }
    let data = null;
    try { data = JSON.parse(await res.text()); } catch { data = null; }
    if (!res.ok) throw upstreamError(`Stripe ${method} ${path} failed: ${data?.error?.message || `HTTP ${res.status}`}`, secrets);
    return data ?? {};
  }

  /** Stripe invoice (expanded or not) -> record for toInvoice(). Stripe times are Unix seconds. */
  function fromStripe(inv) {
    const createdMs = Number(inv.created) * 1000;
    const issuedMs = createdMs > 0 ? createdMs : now();
    const paidMs = Number(inv.status_transitions?.paid_at) * 1000;
    const paid = inv.status === 'paid';
    return {
      id: String(inv.id),
      number: String(inv.number || inv.id),
      customerId: typeof inv.customer === 'string' ? inv.customer : String(inv.customer?.id ?? ''),
      clientName: inv.customer_name || '',
      amountCents: paid ? (inv.total ?? inv.amount_paid ?? 0) : (inv.amount_due ?? inv.total ?? 0),
      status: STRIPE_STATUS[inv.status] ?? 'open',
      issuedAt: iso(issuedMs),
      dueAt: inv.due_date ? iso(Number(inv.due_date) * 1000) : iso(issuedMs + 7 * DAY),
      ...(paidMs > 0 ? { paidAt: iso(paidMs) } : {}),
      ...(inv.description ? { description: inv.description } : {}),
    };
  }

  return {
    describe: () => ({
      mode: 'stripe',
      label: 'Stripe',
      ready: Boolean(s.secretKey),
      details: { apiHost: hostOf(base), key: maskKey(s.secretKey) },
    }),

    async listPlans() {
      const data = await call('GET', '/v1/prices', {
        query: new URLSearchParams([['active', 'true'], ['type', 'recurring'], ['limit', '20'], ['expand[]', 'data.product']]),
      });
      return asArray(data.data).flatMap((price) => {
        const product = price.product && typeof price.product === 'object' ? price.product : {};
        const interval = price.recurring?.interval;
        if (!(price.unit_amount > 0) || (interval !== 'month' && interval !== 'year')) return [];
        if (String(price.currency ?? '').toUpperCase() !== currency) return [];
        const meta = product.metadata ?? {};
        return [{
          id: price.id,
          name: product.name || price.nickname || price.id,
          priceCents: price.unit_amount,
          interval,
          currency,
          features: asArray(product.marketing_features).map((f) => f?.name).filter(Boolean),
          limits: { sites: intOf(meta.sites), diskGb: intOf(meta.disk_gb), bandwidthGb: intOf(meta.bandwidth_gb) },
        }];
      });
    },

    async createCustomer({ name, email, company }) {
      const form = new URLSearchParams([['name', String(name ?? '')], ['email', String(email ?? '')]]);
      if (company) form.append('metadata[company]', company);
      const data = await call('POST', '/v1/customers', { form });
      if (!data.id) throw upstreamError('Stripe returned a customer without an id', secrets);
      return { customerId: String(data.id) };
    },

    async subscribe({ customerId, planId }) {
      const sub = await call('POST', '/v1/subscriptions', {
        form: new URLSearchParams([
          ['customer', customerId],
          ['items[0][price]', planId],
          ['collection_method', 'send_invoice'],
          ['days_until_due', '7'],
          ['expand[]', 'latest_invoice'],
        ]),
      });
      let inv = sub.latest_invoice;
      if (typeof inv === 'string') inv = await call('GET', `/v1/invoices/${encodeURIComponent(inv)}`);
      if (!inv || typeof inv !== 'object') throw upstreamError('Stripe returned a subscription without an invoice', secrets);
      return { subscriptionId: String(sub.id), invoice: toInvoice(fromStripe(inv), ctx) };
    },

    /** Stripe caps a page at 100; the wrapper re-applies status and limit for every mode. */
    async list({ customerId, limit }) {
      const query = new URLSearchParams([['limit', String(Math.min(limit, 100))]]);
      if (customerId) query.set('customer', customerId);
      const data = await call('GET', '/v1/invoices', { query });
      return asArray(data.data).map((inv) => toInvoice(fromStripe(inv), ctx));
    },

    async activeSubscriptions() {
      return activeClientSubs(store);
    },

    async sendInvoice(invoiceId) {
      await call('POST', `/v1/invoices/${encodeURIComponent(invoiceId)}/send`);
      return { sent: true };
    },

    async markPaid(invoiceId) {
      const inv = await call('POST', `/v1/invoices/${encodeURIComponent(invoiceId)}/pay`, {
        form: new URLSearchParams([['paid_out_of_band', 'true']]),
      });
      return toInvoice(fromStripe(inv), ctx);
    },
  };
}

// ---- public factory ----

const MODES = { mock: mockBackend, whmcs: whmcsBackend, stripe: stripeBackend };

/**
 * Billing adapter, chosen by config.billing.mode. Every method is async except describe().
 * Live modes go through config.fetch; secrets never appear in thrown errors or describe().
 */
export function createBilling({ config, store, now = () => Date.now() }) {
  const { mode, currency } = config.billing;
  const make = MODES[mode];
  if (!make) throw new Error(`Unknown billing mode "${mode}"`);
  const ctx = { store, now, currency };
  const impl = make({ config, ctx });

  /** Status, limit and newest-first order are applied here so every mode behaves the same. */
  async function listInvoices({ clientId, status, limit } = {}) {
    if (status && !STATUSES.includes(status)) throw httpError(400, `status must be one of: ${STATUSES.join(', ')}`, 'validation');
    const n = Number.parseInt(limit, 10);
    const max = n > 0 ? Math.min(n, 500) : 100;
    let customerId;
    if (clientId) {
      // An unknown client has no billing history, so it gets an empty list rather than everyone's invoices.
      customerId = store.get('clients', clientId)?.billingCustomerId;
      if (!customerId) return [];
    }
    const rows = await impl.list({ customerId, status, limit: max });
    return rows
      .filter((inv) => !status || inv.status === status)
      .sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : a.issuedAt > b.issuedAt ? -1 : 0))
      .slice(0, max);
  }

  async function summary() {
    const [invoices, plans, activeSubs] = await Promise.all([
      listInvoices({ limit: 500 }),
      impl.listPlans(),
      impl.activeSubscriptions(),
    ]);
    return computeSummary({ invoices, activeSubs, plans, currency, now });
  }

  return {
    mode,
    describe: () => impl.describe(),
    listPlans: () => impl.listPlans(),
    createCustomer: (input) => impl.createCustomer(input),
    subscribe: (input) => impl.subscribe(input),
    listInvoices,
    summary,
    sendInvoice: (invoiceId) => impl.sendInvoice(invoiceId),
    markPaid: (invoiceId) => impl.markPaid(invoiceId),
  };
}
