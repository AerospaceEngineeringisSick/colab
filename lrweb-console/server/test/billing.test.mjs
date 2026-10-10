import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../store.mjs';
import { seedIfEmpty } from '../seed.mjs';
import { loadConfig } from '../config.mjs';
import { createBilling } from '../adapters/billing.mjs';

const NOW = Date.UTC(2026, 9, 10, 12);
const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();
const sec = (ms) => Math.floor(ms / 1000);

function seededStore() {
  const store = createStore({ memory: true });
  seedIfEmpty(store, NOW);
  return store;
}

function billingWith({ env = {}, store = seededStore(), fetch } = {}) {
  const config = loadConfig(env);
  if (fetch) config.fetch = fetch;
  return { store, billing: createBilling({ config, store, now: () => NOW }) };
}

/** Fake fetch. handler(call) returns { status?, body } where body is an object (sent as JSON) or a string. */
function fakeFetch(handler) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const form = new URLSearchParams(typeof init.body === 'string' ? init.body : '');
    const call = {
      url: new URL(url),
      method: init.method,
      headers: new Headers(init.headers),
      form,
      action: form.get('action'),
    };
    calls.push(call);
    const { status = 200, body } = handler(call);
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(text, { status, headers: { 'content-type': 'application/json' } });
  };
  return Object.assign(fetch, { calls });
}

describe('mock mode', () => {
  test('plans come from the catalogue with integer cents and the popular flag', async () => {
    const { billing } = billingWith();
    const plans = await billing.listPlans();
    assert.deepEqual(plans.map((p) => p.id), ['plan_starter', 'plan_business', 'plan_agency']);
    assert.deepEqual(plans.map((p) => p.priceCents), [1500, 3900, 9900]);
    assert.equal(plans.find((p) => p.id === 'plan_business').popular, true);
    assert.ok(plans.every((p) => p.currency === 'USD' && p.interval === 'month' && p.features.length >= 3));
  });

  test('describe reports a ready mock integration', () => {
    const info = billingWith().billing.describe();
    assert.equal(info.mode, 'mock');
    assert.equal(info.ready, true);
  });

  test('seeding is deterministic across fresh stores', async () => {
    const snapshot = async () => {
      const { billing } = billingWith();
      return (await billing.listInvoices({ limit: 500 }))
        .map((i) => `${i.number}|${i.clientId}|${i.amountCents}|${i.status}|${i.issuedAt}`);
    };
    const a = await snapshot();
    const b = await snapshot();
    assert.ok(a.length > 20);
    assert.deepEqual(a, b);
    assert.equal(new Set(a.map((s) => s.split('|')[0])).size, a.length, 'invoice numbers are unique');
  });

  test('summary has 12 revenue buckets and flags the suspended client as overdue', async () => {
    const { billing } = billingWith();
    const s = await billing.summary();
    assert.equal(s.currency, 'USD');
    assert.equal(s.revenue.length, 12);
    assert.equal(s.revenue[0].month, '2025-11');
    assert.equal(s.revenue[11].month, '2026-10');
    assert.ok(s.revenue.every((r) => Number.isInteger(r.cents) && r.cents >= 0));
    assert.ok(s.revenue[11].cents > 0);
    // Six active clients on Starter, Business and Agency: 1500 + 3900 + 3900 + 9900 + 9900 + 9900.
    assert.equal(s.activeSubscriptions, 6);
    assert.equal(s.mrrCents, 39000);
    assert.equal(s.arrCents, 468000);
    assert.ok(s.overdueCents > 0);
    assert.ok(s.outstandingCents >= s.overdueCents);
    const overdue = await billing.listInvoices({ status: 'overdue', limit: 500 });
    assert.ok(overdue.some((i) => i.clientId === 'cli_verdant'));
    assert.equal(overdue.reduce((sum, i) => sum + i.amountCents, 0), s.overdueCents);
  });

  test('trial clients get a trialing subscription and no invoices', async () => {
    const { store, billing } = billingWith();
    // History is seeded lazily on the first billing call, so make one before inspecting the store.
    assert.deepEqual(await billing.listInvoices({ clientId: 'cli_lumen' }), []);
    assert.equal(store.find('subscriptions', (x) => x.status === 'trialing').length, 1);
  });

  test('createCustomer -> subscribe -> send -> markPaid flow', async () => {
    const { store, billing } = billingWith();
    store.insert('clients', {
      id: 'cli_new', name: 'Ada Lovelace', company: 'Analytical Co', email: 'ada@analytical.example',
      phone: '', planId: 'plan_starter', status: 'pending', billingCustomerId: '', createdAt: iso(NOW),
    });
    const { customerId } = await billing.createCustomer({ name: 'Ada Lovelace', email: 'ada@analytical.example', company: 'Analytical Co' });
    assert.match(customerId, /^cus_[0-9a-f]{8}$/);
    store.update('clients', 'cli_new', { billingCustomerId: customerId });

    const { subscriptionId, invoice } = await billing.subscribe({ customerId, planId: 'plan_business' });
    assert.ok(subscriptionId);
    assert.equal(invoice.status, 'open');
    assert.equal(invoice.amountCents, 3900);
    assert.equal(invoice.clientId, 'cli_new');
    assert.equal(invoice.clientName, 'Analytical Co');
    assert.equal(invoice.issuedAt, iso(NOW));
    assert.equal(invoice.dueAt, iso(NOW + 7 * DAY));
    assert.match(invoice.number, /^LR-2026-\d{4}$/);

    assert.deepEqual(await billing.sendInvoice(invoice.id), { sent: true });
    const events = store.find('events', (e) => e.kind === 'billing' && e.text.includes(invoice.number));
    assert.equal(events.length, 1);
    assert.match(events[0].text, /Analytical Co/);

    const paid = await billing.markPaid(invoice.id);
    assert.equal(paid.status, 'paid');
    assert.equal(paid.paidAt, iso(NOW));

    const forClient = await billing.listInvoices({ clientId: 'cli_new' });
    assert.equal(forClient.length, 1);
    assert.equal(forClient[0].status, 'paid');
    assert.deepEqual(await billing.listInvoices({ clientId: 'cli_new', status: 'open' }), []);
  });

  test('status filter applies to the computed status; limit and order are honoured', async () => {
    const { billing } = billingWith();
    const open = await billing.listInvoices({ status: 'open', limit: 500 });
    assert.ok(open.every((i) => i.status === 'open' && Date.parse(i.dueAt) >= NOW));
    const paid = await billing.listInvoices({ status: 'paid', limit: 500 });
    assert.ok(paid.length > 0 && paid.every((i) => i.status === 'paid' && i.paidAt));
    const newest = await billing.listInvoices({ limit: 500 });
    assert.ok(newest.every((inv, i) => i === 0 || newest[i - 1].issuedAt >= inv.issuedAt));
    assert.equal((await billing.listInvoices({ limit: 3 })).length, 3);
    await assert.rejects(billing.listInvoices({ status: 'refunded' }), { status: 400, code: 'validation' });
  });

  test('error cases: unknown plan, unknown invoice, void invoice', async () => {
    const { store, billing } = billingWith();
    await assert.rejects(billing.subscribe({ customerId: 'cus_x', planId: 'plan_nope' }), { status: 404, code: 'plan_not_found' });
    await assert.rejects(billing.sendInvoice('inv_missing'), { status: 404, code: 'invoice_not_found' });
    await assert.rejects(billing.markPaid('inv_missing'), { status: 404, code: 'invoice_not_found' });
    const [any] = await billing.listInvoices({ limit: 1 });
    store.update('invoices', any.id, { status: 'void' });
    await assert.rejects(billing.markPaid(any.id), { status: 409 });
  });
});

describe('whmcs mode', () => {
  const ENV = {
    LRWEB_BILLING_MODE: 'whmcs',
    WHMCS_URL: 'https://billing.example.com/',
    WHMCS_API_IDENTIFIER: 'api-ident-123',
    WHMCS_API_SECRET: 'super-secret-456',
    WHMCS_PAYMENT_METHOD: 'banktransfer',
  };
  const API_URL = 'https://billing.example.com/includes/api.php';
  const whmcsInvoice = (over = {}) => ({
    id: 501, invoicenum: 'INV-501', userid: 42, date: '2026-10-09', duedate: '2026-10-16',
    datepaid: '0000-00-00 00:00:00', total: '15.00', status: 'Unpaid',
    firstname: 'Maya', lastname: 'Fernandez', companyname: 'Acme Roasters', ...over,
  });

  test('describe shows the host only and never the credentials', () => {
    const { billing } = billingWith({ env: ENV, fetch: fakeFetch(() => ({ body: {} })) });
    const info = billing.describe();
    assert.equal(info.mode, 'whmcs');
    assert.equal(info.ready, true);
    assert.equal(info.details.host, 'billing.example.com');
    const text = JSON.stringify(info);
    assert.ok(!text.includes('super-secret-456'));
    assert.ok(!text.includes('api-ident-123'));
  });

  test('listPlans maps GetProducts to whmcs_<pid> plans and strips tags from features', async () => {
    const fetch = fakeFetch(() => ({
      body: {
        result: 'success',
        products: {
          product: [
            { pid: 7, name: 'Hosting', description: '5 sites<br>50 GB <b>SSD</b>\nPriority support', pricing: { USD: { monthly: '15.00' } } },
            { pid: 8, name: 'Free', description: '', pricing: { USD: { monthly: '0.00' } } },
          ],
        },
      },
    }));
    const { billing } = billingWith({ env: ENV, fetch });
    const plans = await billing.listPlans();
    assert.equal(plans.length, 1);
    assert.equal(plans[0].id, 'whmcs_7');
    assert.equal(plans[0].priceCents, 1500);
    assert.deepEqual(plans[0].features, ['5 sites', '50 GB SSD', 'Priority support']);
    const call = fetch.calls[0];
    assert.equal(call.url.href, API_URL);
    assert.equal(call.method, 'POST');
    assert.equal(call.action, 'GetProducts');
    assert.equal(call.form.get('identifier'), 'api-ident-123');
    assert.equal(call.form.get('secret'), 'super-secret-456');
    assert.equal(call.form.get('responsetype'), 'json');
  });

  test('createCustomer splits the name, sends skipvalidation and returns the clientid as a string', async () => {
    const fetch = fakeFetch(() => ({ body: { result: 'success', clientid: 42 } }));
    const { billing } = billingWith({ env: ENV, fetch });
    const out = await billing.createCustomer({ name: 'Maya Fernandez Ruiz', email: 'maya@acme.example', company: 'Acme Roasters' });
    assert.deepEqual(out, { customerId: '42' });
    const f = fetch.calls[0].form;
    assert.equal(fetch.calls[0].action, 'AddClient');
    assert.equal(f.get('firstname'), 'Maya');
    assert.equal(f.get('lastname'), 'Fernandez Ruiz');
    assert.equal(f.get('email'), 'maya@acme.example');
    assert.equal(f.get('companyname'), 'Acme Roasters');
    assert.equal(f.get('skipvalidation'), 'true');
    assert.match(f.get('password2'), /^[A-Za-z0-9]{22}$/);

    await billing.createCustomer({ name: 'Cher', email: 'cher@acme.example', company: '' });
    assert.equal(fetch.calls[1].form.get('lastname'), '-');
  });

  test('subscribe sends AddOrder then reads the newest invoice', async () => {
    const fetch = fakeFetch((call) => {
      if (call.action === 'AddOrder') return { body: { result: 'success', orderid: 99, invoiceid: 501 } };
      return { body: { result: 'success', totalresults: 1, invoices: { invoice: [whmcsInvoice({ invoicenum: '' })] } } };
    });
    const { billing } = billingWith({ env: ENV, fetch });
    const out = await billing.subscribe({ customerId: '42', planId: 'whmcs_7' });
    assert.equal(out.subscriptionId, '99');
    assert.equal(out.invoice.id, '501');
    assert.equal(out.invoice.number, '501');
    assert.equal(out.invoice.amountCents, 1500);
    assert.equal(out.invoice.status, 'open');

    const [order, latest] = fetch.calls;
    assert.equal(order.action, 'AddOrder');
    assert.equal(order.form.get('clientid'), '42');
    assert.equal(order.form.get('pid[]'), '7');
    assert.equal(order.form.get('billingcycle[]'), 'monthly');
    assert.equal(order.form.get('paymentmethod'), 'banktransfer');
    assert.equal(latest.action, 'GetInvoices');
    assert.equal(latest.form.get('userid'), '42');
    assert.equal(latest.form.get('orderby'), 'id');
    assert.equal(latest.form.get('order'), 'desc');
    assert.equal(latest.form.get('limitnum'), '1');

    const count = fetch.calls.length;
    await assert.rejects(billing.subscribe({ customerId: '42', planId: 'plan_starter' }), { status: 404, code: 'plan_not_found' });
    assert.equal(fetch.calls.length, count, 'an unknown plan never reaches WHMCS');
  });

  test('listInvoices maps status and client filters to GetInvoices and re-applies the status locally', async () => {
    const fetch = fakeFetch(() => ({
      body: {
        result: 'success',
        invoices: {
          invoice: [
            whmcsInvoice({ id: 601, invoicenum: 'INV-601', date: '2026-08-01', duedate: '2026-08-08', status: 'Unpaid' }),
            whmcsInvoice({ id: 602, invoicenum: 'INV-602', date: '2026-10-09', duedate: '2026-10-16', status: 'Unpaid' }),
            whmcsInvoice({ id: 603, invoicenum: 'INV-603', date: '2026-09-01', duedate: '2026-09-08', datepaid: '2026-09-02 10:00:00', status: 'Paid' }),
          ],
        },
      },
    }));
    const store = seededStore();
    store.update('clients', 'cli_acme', { billingCustomerId: '42' });
    const { billing } = billingWith({ env: ENV, store, fetch });

    // 601 is past due, so it is overdue and drops out of an 'open' filter even though WHMCS returned it.
    const open = await billing.listInvoices({ clientId: 'cli_acme', status: 'open', limit: 10 });
    assert.deepEqual(open.map((i) => i.id), ['602']);
    assert.equal(open[0].clientId, 'cli_acme');
    assert.equal(open[0].clientName, 'Acme Roasters');
    const call = fetch.calls[0];
    assert.equal(call.action, 'GetInvoices');
    assert.equal(call.form.get('userid'), '42');
    assert.equal(call.form.get('status'), 'Unpaid');
    assert.equal(call.form.get('limitnum'), '10');

    const all = await billing.listInvoices({ limit: 10 });
    assert.deepEqual(all.map((i) => i.status), ['open', 'paid', 'overdue']);
    assert.equal(all[1].paidAt, '2026-09-02T10:00:00.000Z');
    assert.equal(fetch.calls[1].form.get('status'), null, 'no status param when none is requested');
    assert.equal(fetch.calls[1].form.get('userid'), null, 'no userid param when no client is requested');
  });

  test('listInvoices for an unknown client returns [] without calling WHMCS', async () => {
    const fetch = fakeFetch(() => ({ body: { result: 'success', invoices: { invoice: [whmcsInvoice()] } } }));
    const { billing } = billingWith({ env: ENV, fetch });
    assert.deepEqual(await billing.listInvoices({ clientId: 'cli_missing' }), []);
    assert.equal(fetch.calls.length, 0);
  });

  test('sendInvoice uses SendEmail; markPaid records a payment and re-reads the invoice', async () => {
    const fetch = fakeFetch((call) => {
      if (call.action === 'GetInvoice') return { body: { result: 'success', ...whmcsInvoice({ datepaid: '2026-10-10 12:00:00', status: 'Paid' }) } };
      return { body: { result: 'success' } };
    });
    const { billing } = billingWith({ env: ENV, fetch });
    assert.deepEqual(await billing.sendInvoice('501'), { sent: true });
    assert.equal(fetch.calls[0].action, 'SendEmail');
    assert.equal(fetch.calls[0].form.get('messagename'), 'Invoice Created');
    assert.equal(fetch.calls[0].form.get('id'), '501');

    const paid = await billing.markPaid('501');
    const [, pay, reread] = fetch.calls;
    assert.equal(pay.action, 'AddInvoicePayment');
    assert.equal(pay.form.get('invoiceid'), '501');
    assert.equal(pay.form.get('transid'), `lrweb-${NOW}`);
    assert.equal(pay.form.get('gateway'), 'banktransfer');
    assert.equal(reread.action, 'GetInvoice');
    assert.equal(reread.form.get('invoiceid'), '501');
    assert.equal(paid.status, 'paid');
    assert.equal(paid.paidAt, '2026-10-10T12:00:00.000Z');
  });

  test('WHMCS result:"error" on HTTP 200 throws a 502 with credentials redacted', async () => {
    const fetch = fakeFetch(() => ({ body: { result: 'error', message: 'Invalid credentials: api-ident-123 / super-secret-456' } }));
    const { billing } = billingWith({ env: ENV, fetch });
    const err = await billing.listPlans().catch((e) => e);
    assert.ok(err instanceof Error);
    assert.equal(err.status, 502);
    assert.equal(err.code, 'billing_upstream');
    assert.ok(!err.message.includes('super-secret-456'));
    assert.ok(!err.message.includes('api-ident-123'));
    assert.match(err.message, /\[redacted\]/);
  });

  test('a non-JSON HTTP 500 is a 502 that never echoes the secret', async () => {
    const fetch = fakeFetch(() => ({ status: 500, body: 'gateway said: super-secret-456' }));
    const { billing } = billingWith({ env: ENV, fetch });
    await assert.rejects(billing.listInvoices({ limit: 5 }), (err) =>
      err.status === 502 && err.code === 'billing_upstream' && !err.message.includes('super-secret-456'));
  });
});

describe('stripe mode', () => {
  // Assembled at runtime so secret scanners don't mistake this obviously fake fixture for a real key.
  const KEY = ['sk', 'test', 'FAKEFIXTUREKEYFORTESTSONLY0000'].join('_');
  const ENV = { LRWEB_BILLING_MODE: 'stripe', STRIPE_SECRET_KEY: KEY };
  const BASE = 'https://api.stripe.com';

  test('describe masks the key to its type and last four characters', () => {
    const { billing } = billingWith({ env: ENV, fetch: fakeFetch(() => ({ body: {} })) });
    const info = billing.describe();
    assert.equal(info.mode, 'stripe');
    assert.equal(info.ready, true);
    assert.equal(info.details.key, 'sk_…0000');
    assert.ok(!JSON.stringify(info).includes(KEY));
  });

  test('listPlans queries active recurring prices with the product expanded', async () => {
    const fetch = fakeFetch(() => ({
      body: {
        data: [
          {
            id: 'price_starter', unit_amount: 1500, currency: 'usd', recurring: { interval: 'month' },
            product: { id: 'prod_1', name: 'Starter', marketing_features: [{ name: '1 site' }, { name: 'Free SSL' }], metadata: { sites: '1', disk_gb: '10', bandwidth_gb: '100' } },
          },
          { id: 'price_free', unit_amount: null, currency: 'usd', recurring: { interval: 'month' }, product: { name: 'Free' } },
        ],
      },
    }));
    const { billing } = billingWith({ env: ENV, fetch });
    const plans = await billing.listPlans();
    assert.deepEqual(plans, [{
      id: 'price_starter', name: 'Starter', priceCents: 1500, interval: 'month', currency: 'USD',
      features: ['1 site', 'Free SSL'], limits: { sites: 1, diskGb: 10, bandwidthGb: 100 },
    }]);
    const call = fetch.calls[0];
    assert.equal(call.method, 'GET');
    assert.equal(call.url.origin + call.url.pathname, `${BASE}/v1/prices`);
    assert.equal(call.url.searchParams.get('active'), 'true');
    assert.equal(call.url.searchParams.get('type'), 'recurring');
    assert.equal(call.url.searchParams.get('limit'), '20');
    assert.equal(call.url.searchParams.get('expand[]'), 'data.product');
    assert.equal(call.headers.get('authorization'), `Bearer ${KEY}`);
  });

  test('createCustomer posts form fields with an Idempotency-Key', async () => {
    const fetch = fakeFetch(() => ({ body: { id: 'cus_123', object: 'customer' } }));
    const { billing } = billingWith({ env: ENV, fetch });
    const out = await billing.createCustomer({ name: 'Maya Fernandez', email: 'maya@acme.example', company: 'Acme Roasters' });
    assert.deepEqual(out, { customerId: 'cus_123' });
    const call = fetch.calls[0];
    assert.equal(call.method, 'POST');
    assert.equal(call.url.href, `${BASE}/v1/customers`);
    assert.equal(call.headers.get('content-type'), 'application/x-www-form-urlencoded');
    assert.equal(call.form.get('name'), 'Maya Fernandez');
    assert.equal(call.form.get('email'), 'maya@acme.example');
    assert.equal(call.form.get('metadata[company]'), 'Acme Roasters');
    assert.match(call.headers.get('idempotency-key'), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test('subscribe posts send_invoice with days_until_due and returns the expanded invoice', async () => {
    const fetch = fakeFetch(() => ({
      body: {
        id: 'sub_1', object: 'subscription',
        latest_invoice: { id: 'in_1', object: 'invoice', number: null, customer: 'cus_123', created: sec(NOW), due_date: sec(NOW + 7 * DAY), amount_due: 1500, total: 1500, status: 'open' },
      },
    }));
    const { billing } = billingWith({ env: ENV, fetch });
    const out = await billing.subscribe({ customerId: 'cus_123', planId: 'price_starter' });
    assert.equal(out.subscriptionId, 'sub_1');
    assert.equal(out.invoice.id, 'in_1');
    assert.equal(out.invoice.number, 'in_1');
    assert.equal(out.invoice.amountCents, 1500);
    assert.equal(out.invoice.status, 'open');
    assert.equal(out.invoice.issuedAt, iso(NOW));
    assert.equal(out.invoice.dueAt, iso(NOW + 7 * DAY));
    const call = fetch.calls[0];
    assert.equal(call.url.href, `${BASE}/v1/subscriptions`);
    assert.equal(call.form.get('customer'), 'cus_123');
    assert.equal(call.form.get('items[0][price]'), 'price_starter');
    assert.equal(call.form.get('collection_method'), 'send_invoice');
    assert.equal(call.form.get('days_until_due'), '7');
    assert.equal(call.form.get('expand[]'), 'latest_invoice');
  });

  test('listInvoices maps Stripe statuses, amounts and paid_at, filtered by customer', async () => {
    const fetch = fakeFetch(() => ({
      body: {
        object: 'list',
        data: [
          { id: 'in_paid', number: 'LR-2026-0002', customer: { id: 'cus_123' }, created: sec(Date.UTC(2026, 8, 1)), due_date: sec(Date.UTC(2026, 8, 8)), amount_due: 0, total: 3900, status: 'paid', status_transitions: { paid_at: sec(Date.UTC(2026, 8, 2, 9)) } },
          { id: 'in_due', number: null, customer: 'cus_123', created: sec(Date.UTC(2026, 7, 1)), due_date: sec(Date.UTC(2026, 7, 8)), amount_due: 2000, total: 2000, status: 'open' },
          { id: 'in_bad', number: null, customer: 'cus_123', created: sec(Date.UTC(2026, 7, 1)), due_date: null, amount_due: 500, total: 500, status: 'uncollectible' },
        ],
      },
    }));
    const store = seededStore();
    store.update('clients', 'cli_acme', { billingCustomerId: 'cus_123' });
    const { billing } = billingWith({ env: ENV, store, fetch });
    const invoices = await billing.listInvoices({ clientId: 'cli_acme', limit: 50 });

    const call = fetch.calls[0];
    assert.equal(call.url.pathname, '/v1/invoices');
    assert.equal(call.url.searchParams.get('customer'), 'cus_123');
    assert.equal(call.url.searchParams.get('limit'), '50');

    const byId = Object.fromEntries(invoices.map((i) => [i.id, i]));
    assert.equal(byId.in_paid.status, 'paid');
    assert.equal(byId.in_paid.amountCents, 3900);
    assert.equal(byId.in_paid.paidAt, iso(Date.UTC(2026, 8, 2, 9)));
    assert.equal(byId.in_paid.number, 'LR-2026-0002');
    assert.equal(byId.in_paid.clientId, 'cli_acme');
    assert.equal(byId.in_paid.clientName, 'Acme Roasters');
    assert.equal(byId.in_due.status, 'overdue');
    assert.equal(byId.in_due.amountCents, 2000);
    assert.equal(byId.in_due.number, 'in_due');
    assert.equal(byId.in_bad.status, 'void');
  });

  test('sendInvoice posts to /send; markPaid posts paid_out_of_band and returns the paid invoice', async () => {
    const fetch = fakeFetch(() => ({
      body: { id: 'in_due', object: 'invoice', customer: 'cus_123', created: sec(Date.UTC(2026, 7, 1)), due_date: sec(Date.UTC(2026, 7, 8)), amount_due: 0, total: 2000, status: 'paid', status_transitions: { paid_at: sec(NOW) } },
    }));
    const { billing } = billingWith({ env: ENV, fetch });
    assert.deepEqual(await billing.sendInvoice('in_due'), { sent: true });
    assert.equal(fetch.calls[0].method, 'POST');
    assert.equal(fetch.calls[0].url.href, `${BASE}/v1/invoices/in_due/send`);
    assert.ok(fetch.calls[0].headers.get('idempotency-key'));

    const paid = await billing.markPaid('in_due');
    assert.equal(fetch.calls[1].method, 'POST');
    assert.equal(fetch.calls[1].url.href, `${BASE}/v1/invoices/in_due/pay`);
    assert.equal(fetch.calls[1].form.get('paid_out_of_band'), 'true');
    assert.equal(paid.status, 'paid');
    assert.equal(paid.amountCents, 2000);
    assert.equal(paid.paidAt, iso(NOW));
  });

  test('Stripe errors are 502s with the secret key redacted', async () => {
    const fetch = fakeFetch(() => ({ status: 401, body: { error: { message: `Invalid API Key provided: ${KEY}` } } }));
    const { billing } = billingWith({ env: ENV, fetch });
    const err = await billing.createCustomer({ name: 'Maya Fernandez', email: 'maya@acme.example', company: '' }).catch((e) => e);
    assert.equal(err.status, 502);
    assert.equal(err.code, 'billing_upstream');
    assert.ok(!err.message.includes(KEY));
    assert.match(err.message, /\[redacted\]/);
  });
});
