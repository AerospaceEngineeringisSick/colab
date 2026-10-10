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
const EM_DASH = '\u2014';
// LRWeb care plan prices in pence (GBP, monthly).
const PRICE = { plan_essential: 2900, plan_plus: 4900, plan_pro: 8900 };

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
  test('plans are the three LRWeb care plans in GBP with the real feature wording and no invented limits', async () => {
    const { billing } = billingWith();
    const plans = await billing.listPlans();
    assert.deepEqual(plans.map((p) => p.id), ['plan_essential', 'plan_plus', 'plan_pro']);
    assert.deepEqual(plans.map((p) => p.name), ['Essential', 'Plus', 'Pro']);
    assert.deepEqual(plans.map((p) => p.priceCents), [2900, 4900, 8900]);
    assert.deepEqual(plans.filter((p) => p.popular).map((p) => p.id), ['plan_plus']);
    assert.ok(plans.every((p) => p.currency === 'GBP' && p.interval === 'month'));
    assert.ok(plans.every((p) => !('limits' in p)), 'care plans have no hosting limits');
    assert.deepEqual(plans[0].features, [
      'Managed UK-focused hosting', 'Core, theme and plugin updates', 'Daily off-site backups',
      'Uptime and security monitoring', 'SSL certificate included', 'Email support',
    ]);
    assert.deepEqual(plans[1].features, [
      'Everything in Essential', 'Monthly content edits included', 'Performance optimisation',
      'Priority support', 'Quarterly site health review',
    ]);
    assert.deepEqual(plans[2].features, [
      'Everything in Plus', 'E-commerce and booking support', 'More included edit time',
      'Same-day response target', 'Monthly performance report',
    ]);
    assert.ok(plans.every((p) => p.features.every((f) => !f.includes(EM_DASH))));
  });

  test('currency defaults to GBP and LRWEB_CURRENCY still overrides it', async () => {
    assert.equal(loadConfig({}).billing.currency, 'GBP');
    const { billing } = billingWith({ env: { LRWEB_CURRENCY: 'eur' } });
    assert.ok((await billing.listPlans()).every((p) => p.currency === 'EUR'));
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
    assert.ok(a.length > 30);
    assert.deepEqual(a, b);
    assert.equal(new Set(a.map((s) => s.split('|')[0])).size, a.length, 'invoice numbers are unique');
  });

  test('bills are care plan invoices with a month in the description', async () => {
    const { billing } = billingWith();
    const invoices = await billing.listInvoices({ clientId: 'cli_petal', limit: 100 });
    assert.ok(invoices.length >= 5);
    assert.ok(invoices.every((i) => i.amountCents === 4900 && i.currency === 'GBP'));
    assert.match(invoices[0].description, /^Plus care plan, [A-Z][a-z]+ 20\d\d$/);
  });

  test('summary: GBP, 12 revenue buckets and MRR from the active clients plan prices', async () => {
    const { store, billing } = billingWith();
    const s = await billing.summary();
    assert.equal(s.currency, 'GBP');
    assert.equal(s.revenue.length, 12);
    assert.equal(s.revenue[0].month, '2025-11');
    assert.equal(s.revenue[11].month, '2026-10');
    assert.ok(s.revenue.every((r) => Number.isInteger(r.cents) && r.cents >= 0));
    assert.ok(s.revenue[11].cents > 0, 'Petal & Stem paid its October bill');

    const paid = await billing.listInvoices({ status: 'paid', limit: 500 });
    assert.equal(s.revenue.reduce((sum, r) => sum + r.cents, 0), paid.reduce((sum, i) => sum + i.amountCents, 0));

    // Five active clients: 2900 + 2900 + 4900 + 4900 + 8900. The suspended and trial clients add nothing.
    const active = store.all('clients').filter((c) => c.status === 'active');
    const mrr = active.reduce((sum, c) => sum + PRICE[c.planId], 0);
    assert.equal(mrr, 24500);
    assert.equal(s.mrrCents, mrr);
    assert.equal(s.arrCents, mrr * 12);
    assert.equal(s.activeSubscriptions, active.length);
  });

  test('the suspended client has two unpaid bills, one overdue; two other clients have recent open bills', async () => {
    const { billing } = billingWith();
    const s = await billing.summary();
    assert.equal(s.overdueCents, 2900);
    assert.equal(s.outstandingCents, 13600);
    assert.equal(s.paidThisMonthCents, 4900);

    const north = await billing.listInvoices({ clientId: 'cli_north', limit: 100 });
    assert.deepEqual(north.filter((i) => i.status !== 'paid').map((i) => i.status), ['open', 'overdue']);

    const overdue = await billing.listInvoices({ status: 'overdue', limit: 500 });
    assert.deepEqual(overdue.map((i) => i.clientId), ['cli_north']);
    assert.equal(overdue.reduce((sum, i) => sum + i.amountCents, 0), s.overdueCents);

    const open = await billing.listInvoices({ status: 'open', limit: 500 });
    assert.deepEqual([...new Set(open.map((i) => i.clientId))].sort(), ['cli_north', 'cli_smith', 'cli_volt']);
    assert.ok(open.every((i) => Date.parse(i.issuedAt) >= NOW - 7 * DAY), 'open bills are recent');
  });

  test('trial clients get a trialing subscription and no invoices', async () => {
    const { store, billing } = billingWith();
    // History is seeded lazily on the first billing call, so make one before inspecting the store.
    assert.deepEqual(await billing.listInvoices({ clientId: 'cli_form' }), []);
    assert.equal(store.find('subscriptions', (x) => x.status === 'trialing').length, 1);
    assert.equal(store.find('subscriptions', (x) => x.status === 'active').length, 5);
    assert.equal(store.find('subscriptions', (x) => x.status === 'past_due').length, 1);
  });

  test('createCustomer -> subscribe -> send -> markPaid flow', async () => {
    const { store, billing } = billingWith();
    store.insert('clients', {
      id: 'cli_new', name: 'Ada Lovelace', company: 'Analytical Co', email: 'ada@analytical.example',
      phone: '', planId: 'plan_essential', status: 'pending', billingCustomerId: '', createdAt: iso(NOW),
    });
    const { customerId } = await billing.createCustomer({ name: 'Ada Lovelace', email: 'ada@analytical.example', company: 'Analytical Co' });
    assert.match(customerId, /^cus_[0-9a-f]{8}$/);
    store.update('clients', 'cli_new', { billingCustomerId: customerId });

    const { subscriptionId, invoice } = await billing.subscribe({ customerId, planId: 'plan_plus' });
    assert.ok(subscriptionId);
    assert.equal(invoice.status, 'open');
    assert.equal(invoice.amountCents, 4900);
    assert.equal(invoice.description, 'Plus care plan, October 2026');
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
    firstname: 'Dave', lastname: 'Smith', companyname: 'Smith & Sons', ...over,
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

  test('listPlans maps GetProducts to whmcs_<pid> plans, strips tags from features and never invents limits', async () => {
    const fetch = fakeFetch(() => ({
      body: {
        result: 'success',
        products: {
          product: [
            { pid: 7, name: 'Care plan', description: 'Managed hosting<br>Daily <b>backups</b>\nEmail support', pricing: { GBP: { monthly: '29.00' } } },
            { pid: 8, name: 'Free', description: '', pricing: { GBP: { monthly: '0.00' } } },
          ],
        },
      },
    }));
    const { billing } = billingWith({ env: ENV, fetch });
    const plans = await billing.listPlans();
    assert.equal(plans.length, 1);
    assert.equal(plans[0].id, 'whmcs_7');
    assert.equal(plans[0].priceCents, 2900);
    assert.equal(plans[0].currency, 'GBP');
    assert.deepEqual(plans[0].features, ['Managed hosting', 'Daily backups', 'Email support']);
    assert.ok(!('limits' in plans[0]));
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
    const out = await billing.createCustomer({ name: 'Dave Smith Jones', email: 'dave@smithandsons.example', company: 'Smith & Sons' });
    assert.deepEqual(out, { customerId: '42' });
    const f = fetch.calls[0].form;
    assert.equal(fetch.calls[0].action, 'AddClient');
    assert.equal(f.get('firstname'), 'Dave');
    assert.equal(f.get('lastname'), 'Smith Jones');
    assert.equal(f.get('email'), 'dave@smithandsons.example');
    assert.equal(f.get('companyname'), 'Smith & Sons');
    assert.equal(f.get('skipvalidation'), 'true');
    assert.match(f.get('password2'), /^[A-Za-z0-9]{22}$/);

    await billing.createCustomer({ name: 'Jo', email: 'jo@smithandsons.example', company: '' });
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
    await assert.rejects(billing.subscribe({ customerId: '42', planId: 'plan_essential' }), { status: 404, code: 'plan_not_found' });
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
    store.update('clients', 'cli_smith', { billingCustomerId: '42' });
    const { billing } = billingWith({ env: ENV, store, fetch });

    // 601 is past due, so it is overdue and drops out of an 'open' filter even though WHMCS returned it.
    const open = await billing.listInvoices({ clientId: 'cli_smith', status: 'open', limit: 10 });
    assert.deepEqual(open.map((i) => i.id), ['602']);
    assert.equal(open[0].clientId, 'cli_smith');
    assert.equal(open[0].clientName, 'Smith & Sons');
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

  test('listPlans queries active recurring prices in the configured currency; limits only from complete metadata', async () => {
    const fetch = fakeFetch(() => ({
      body: {
        data: [
          {
            id: 'price_essential', unit_amount: 2900, currency: 'gbp', recurring: { interval: 'month' },
            product: { id: 'prod_1', name: 'Essential', marketing_features: [{ name: 'Managed UK-focused hosting' }, { name: 'Email support' }], metadata: { sites: '1', disk_gb: '10', bandwidth_gb: '100' } },
          },
          { id: 'price_plus', unit_amount: 4900, currency: 'gbp', recurring: { interval: 'month' }, product: { name: 'Plus', marketing_features: [], metadata: { sites: '5' } } },
          { id: 'price_free', unit_amount: null, currency: 'gbp', recurring: { interval: 'month' }, product: { name: 'Free' } },
          { id: 'price_usd', unit_amount: 999, currency: 'usd', recurring: { interval: 'month' }, product: { name: 'Other' } },
        ],
      },
    }));
    const { billing } = billingWith({ env: ENV, fetch });
    const plans = await billing.listPlans();
    assert.deepEqual(plans, [
      {
        id: 'price_essential', name: 'Essential', priceCents: 2900, interval: 'month', currency: 'GBP',
        features: ['Managed UK-focused hosting', 'Email support'], limits: { sites: 1, diskGb: 10, bandwidthGb: 100 },
      },
      { id: 'price_plus', name: 'Plus', priceCents: 4900, interval: 'month', currency: 'GBP', features: [] },
    ]);
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
    const out = await billing.createCustomer({ name: 'Dave Smith', email: 'dave@smithandsons.example', company: 'Smith & Sons' });
    assert.deepEqual(out, { customerId: 'cus_123' });
    const call = fetch.calls[0];
    assert.equal(call.method, 'POST');
    assert.equal(call.url.href, `${BASE}/v1/customers`);
    assert.equal(call.headers.get('content-type'), 'application/x-www-form-urlencoded');
    assert.equal(call.form.get('name'), 'Dave Smith');
    assert.equal(call.form.get('email'), 'dave@smithandsons.example');
    assert.equal(call.form.get('metadata[company]'), 'Smith & Sons');
    assert.match(call.headers.get('idempotency-key'), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test('subscribe posts send_invoice with days_until_due and returns the expanded invoice', async () => {
    const fetch = fakeFetch(() => ({
      body: {
        id: 'sub_1', object: 'subscription',
        latest_invoice: { id: 'in_1', object: 'invoice', number: null, customer: 'cus_123', created: sec(NOW), due_date: sec(NOW + 7 * DAY), amount_due: 2900, total: 2900, status: 'open' },
      },
    }));
    const { billing } = billingWith({ env: ENV, fetch });
    const out = await billing.subscribe({ customerId: 'cus_123', planId: 'price_essential' });
    assert.equal(out.subscriptionId, 'sub_1');
    assert.equal(out.invoice.id, 'in_1');
    assert.equal(out.invoice.number, 'in_1');
    assert.equal(out.invoice.amountCents, 2900);
    assert.equal(out.invoice.status, 'open');
    assert.equal(out.invoice.issuedAt, iso(NOW));
    assert.equal(out.invoice.dueAt, iso(NOW + 7 * DAY));
    const call = fetch.calls[0];
    assert.equal(call.url.href, `${BASE}/v1/subscriptions`);
    assert.equal(call.form.get('customer'), 'cus_123');
    assert.equal(call.form.get('items[0][price]'), 'price_essential');
    assert.equal(call.form.get('collection_method'), 'send_invoice');
    assert.equal(call.form.get('days_until_due'), '7');
    assert.equal(call.form.get('expand[]'), 'latest_invoice');
  });

  test('listInvoices maps Stripe statuses, amounts and paid_at, filtered by customer', async () => {
    const fetch = fakeFetch(() => ({
      body: {
        object: 'list',
        data: [
          { id: 'in_paid', number: 'LR-2026-0002', customer: { id: 'cus_123' }, created: sec(Date.UTC(2026, 8, 1)), due_date: sec(Date.UTC(2026, 8, 8)), amount_due: 0, total: 4900, status: 'paid', status_transitions: { paid_at: sec(Date.UTC(2026, 8, 2, 9)) } },
          { id: 'in_due', number: null, customer: 'cus_123', created: sec(Date.UTC(2026, 7, 1)), due_date: sec(Date.UTC(2026, 7, 8)), amount_due: 2000, total: 2000, status: 'open' },
          { id: 'in_bad', number: null, customer: 'cus_123', created: sec(Date.UTC(2026, 7, 1)), due_date: null, amount_due: 500, total: 500, status: 'uncollectible' },
        ],
      },
    }));
    const store = seededStore();
    store.update('clients', 'cli_smith', { billingCustomerId: 'cus_123' });
    const { billing } = billingWith({ env: ENV, store, fetch });
    const invoices = await billing.listInvoices({ clientId: 'cli_smith', limit: 50 });

    const call = fetch.calls[0];
    assert.equal(call.url.pathname, '/v1/invoices');
    assert.equal(call.url.searchParams.get('customer'), 'cus_123');
    assert.equal(call.url.searchParams.get('limit'), '50');

    const byId = Object.fromEntries(invoices.map((i) => [i.id, i]));
    assert.equal(byId.in_paid.status, 'paid');
    assert.equal(byId.in_paid.amountCents, 4900);
    assert.equal(byId.in_paid.paidAt, iso(Date.UTC(2026, 8, 2, 9)));
    assert.equal(byId.in_paid.number, 'LR-2026-0002');
    assert.equal(byId.in_paid.clientId, 'cli_smith');
    assert.equal(byId.in_paid.clientName, 'Smith & Sons');
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
    const err = await billing.createCustomer({ name: 'Dave Smith', email: 'dave@smithandsons.example', company: '' }).catch((e) => e);
    assert.equal(err.status, 502);
    assert.equal(err.code, 'billing_upstream');
    assert.ok(!err.message.includes(KEY));
    assert.match(err.message, /\[redacted\]/);
  });
});
