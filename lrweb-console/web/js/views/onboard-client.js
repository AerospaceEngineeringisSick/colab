// Client onboarding wizard (#/onboard): client -> care plan -> website -> review.
// Creating a client POSTs /api/onboard/client, then follows the returned job until it finishes.
import { h, ensureCss, uid } from '../core/dom.js';
import { api, pollJob } from '../core/api.js';
import { money } from '../core/fmt.js';
import { toast } from '../core/toast.js';
import { PageHeader, Card, Button, Badge, Avatar, Field, Input, Switch, Stepper, Skeleton, Empty, ErrorState, JobProgress, CopyBlock, setLoading } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { SiteForm } from '../ui/site-form.js';
import { Term } from '../ui/glossary.js';

const CURRENCY = 'GBP'; // LRWeb's currency, used only if a plan has none
const STEPS = [
  { key: 'client', label: 'Client' },
  { key: 'plan', label: 'Care plan' },
  { key: 'hosting', label: 'Website' },
  { key: 'launch', label: 'Review' },
];
// A title can be a function when it holds a glossary Term, so every render gets fresh nodes.
const HEADINGS = [
  { title: 'Who is the new client?', subtitle: 'Their name and email are needed. The rest is optional.' },
  { title: () => ['Choose a ', Term('care plan')], subtitle: 'Your care plan sets the monthly price and what is included.' },
  { title: 'Set up a website', subtitle: 'Optional. Set up their first website now.' },
  { title: 'Check the details', subtitle: 'Look over everything below, then create the client.' },
];
const LABELS = { name: 'Full name', email: 'Email', company: 'Company', phone: 'Phone' };
const CLIENT_KEYS = Object.keys(LABELS);
const SITE_TYPES = { php: 'PHP', nodejs: 'Node.js', static: 'Static', python: 'Python', 'reverse-proxy': 'Reverse proxy' };
const SECRET_LABELS = {
  siteUser: 'Website login', siteUserPassword: 'Website login password',
  dbName: 'Database name', dbUser: 'Database login', dbPassword: 'Database password',
};
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

// SiteForm offers online and degraded servers, so both count as usable here.
const usable = (s) => s.status === 'online' || s.status === 'degraded';
const perLabel = (p) => (p.interval === 'year' ? 'a year' : 'a month');
const priceLine = (p) => `${money(p.priceCents, p.currency || CURRENCY)} ${perLabel(p)}`;
const includes = (plan) => (plan?.features?.length
  ? h('ul', { class: 'ob-feat' }, plan.features.map((f) => h('li', {}, f)))
  : 'Not set');
const pairs = (rows) => rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]);
const block = (title, rows) => h('section', { class: 'glass glass--thin ob-block' },
  h('h3', { class: 'ob-block__title' }, title), h('dl', { class: 'kv' }, pairs(rows)));

export default async function mount(root, ctx) {
  await ensureCss('css/view-onboard.css');

  const stepper = Stepper({ steps: STEPS });
  const split = h('div', { class: 'split onboard' });
  const summaryBody = h('div', { class: 'stack' });
  const summary = Card({ title: 'Summary', subtitle: 'Updates as you type', class: 'onboard__summary' }, summaryBody);
  root.append(PageHeader({ title: 'Add a new client', subtitle: 'From sign-up to a live website, in one go' }), stepper, split);

  let catalog = null; // { plans, servers, meta }
  let W = null; // wizard state: survives Back/Next, rebuilt by "Add another client"
  let form = null; // <form> inside the main card
  let busy = false;

  /* ---------- data ---------- */

  async function load() {
    split.replaceChildren(Card({ class: 'onboard__main' }, Skeleton({ lines: 6 })), summary);
    summaryBody.replaceChildren(Skeleton({ lines: 4 }));
    try {
      const [plans, servers, meta] = await Promise.all([
        api.get('/api/billing/plans', { signal: ctx.signal }),
        api.get('/api/servers', { signal: ctx.signal }),
        api.get('/api/meta', { signal: ctx.signal }),
      ]);
      catalog = { plans, servers, meta };
      W = newWizard();
      show(0, { focus: false });
    } catch (e) {
      if (e?.name === 'AbortError') return;
      split.replaceChildren(Card({ class: 'onboard__main' }, ErrorState(e, load)), summary);
      summaryBody.replaceChildren(h('p', { class: 'muted' }, 'The summary appears once the form data loads.'));
    }
  }

  /* ---------- wizard state: controls are created once, so typed values survive Back/Next ---------- */

  function newWizard() {
    const { plans, servers, meta } = catalog;
    const popular = plans.find((p) => p.popular) || plans[0];
    const w = {
      step: 0,
      planId: popular?.id || '',
      hosting: servers.some(usable),
      inputs: {},
      fields: {},
      planErr: h('p', { class: 'field__error', role: 'alert' }),
      slot: null,
      nextBtn: null,
    };

    const make = {
      name: () => Input({ placeholder: 'Maya Fernandez', maxlength: 120, autocomplete: 'name' }),
      email: () => Input({ type: 'email', placeholder: 'maya@acme.example', maxlength: 320, autocomplete: 'email', inputmode: 'email', autocapitalize: 'none' }),
      company: () => Input({ placeholder: 'Acme Roasters', maxlength: 120, autocomplete: 'organization' }),
      phone: () => Input({ type: 'tel', placeholder: '+44 7700 900123', maxlength: 40, autocomplete: 'tel' }),
    };
    for (const k of CLIENT_KEYS) {
      const control = make[k]();
      w.inputs[k] = control;
      w.fields[k] = Field({ label: LABELS[k], required: k === 'name' || k === 'email' }, control);
      control.addEventListener('input', () => { w.fields[k].setError(''); renderSummary(); });
    }

    w.hostToggle = Switch({
      label: 'Set up a website now',
      checked: w.hosting,
      onchange: (e) => { W.hosting = e.target.checked; syncSite(); renderSummary(); },
    });

    w.site = SiteForm({ meta, servers, showClient: false });
    w.site.el.addEventListener('input', renderSummary);
    w.site.el.addEventListener('change', renderSummary);
    return w;
  }

  function collect() {
    const client = Object.fromEntries(CLIENT_KEYS.map((k) => [k, W.inputs[k].value.trim()]));
    return {
      client,
      plan: catalog.plans.find((p) => p.id === W.planId) || null,
      site: W.hosting ? W.site.value() : null,
    };
  }

  /* ---------- rendering ---------- */

  function renderSummary() {
    if (!W || !catalog) return;
    const { client, plan, site } = collect();
    const server = site ? catalog.servers.find((s) => s.id === site.serverId) : null;

    const rows = [
      ['Email', client.email || 'Not set'],
      ['Care plan', plan ? `${plan.name} · ${priceLine(plan)}` : 'Not set'],
    ];
    if (site) rows.push(['Domain', site.domain || 'Not set'], ['Type', SITE_TYPES[site.type] || 'Not set'], ['Server', server?.name || 'Not set']);
    else rows.push(['Website', 'Not set up now']);

    const ticks = [
      `Client record for ${client.name || 'the new client'}`,
      plan && `Billing account on the ${plan.name} care plan`,
      site && `Website${site.domain ? ` ${site.domain}` : ''}${server ? ` on ${server.name}` : ''}`,
      site?.createDatabase && 'A database and its login',
      site?.issueCertificate && h('span', {}, Term('ssl', 'Padlock (SSL)'), " certificate from Let's Encrypt"),
    ].filter(Boolean);

    summaryBody.replaceChildren(
      h('div', { class: 'ob-sum__who' },
        Avatar({ name: client.name || '?', size: 44 }),
        h('div', { class: 'grow' },
          h('strong', {}, client.name || 'New client'),
          h('small', { class: 'muted' }, client.company || client.email || 'Details appear as you type'))),
      h('dl', { class: 'kv' }, pairs(rows)),
      h('h3', { class: 'ob-sum__label' }, 'Will create'),
      h('ul', { class: 'ob-ticks' }, ticks.map((t) =>
        h('li', { class: 'ob-tick' }, h('span', { class: 'ob-tick__mark' }, icon('check', { size: 14 })), h('span', {}, t)))));
  }

  // Shows or hides the site form to match the hosting switch.
  function syncSite() {
    W.slot?.replaceChildren(...(W.hosting ? [W.site.el] : []));
  }

  function setMain(card, { focus = true } = {}) {
    split.replaceChildren(card, summary);
    const heading = card.querySelector('h2');
    if (!heading) return;
    heading.tabIndex = -1;
    if (focus) heading.focus();
  }

  function show(step, { focus = true } = {}) {
    W.step = step;
    stepper.set(step);
    const { title, subtitle } = HEADINGS[step];
    const back = step > 0 ? Button({ variant: 'glass', icon: 'chevron-left', onclick: prev }, 'Back') : null;
    W.nextBtn = step === 3
      ? Button({ type: 'submit', variant: 'primary', size: 'lg', icon: 'rocket' }, 'Create client')
      : Button({ type: 'submit', variant: 'primary', iconRight: 'arrow-right' }, 'Next');
    form = h('form', { class: 'stack onboard__form', novalidate: true, onsubmit: (e) => { e.preventDefault(); next(); } },
      STEP_BODY[step](),
      h('div', { class: 'spread onboard__foot' }, back, W.nextBtn));
    setMain(Card({ title: typeof title === 'function' ? title() : title, subtitle, class: 'onboard__main' }, form), { focus });
    renderSummary();
  }

  const STEP_BODY = [
    () => h('div', { class: 'form-grid' }, CLIENT_KEYS.map((k) => W.fields[k])),
    () => planStep(),
    () => hostingStep(),
    () => reviewStep(),
  ];

  function planStep() {
    if (!catalog.plans.length) {
      return Empty({ icon: 'receipt', title: 'No care plans yet', message: 'There are no care plans to choose from, so a client cannot be added yet.' });
    }
    const group = uid('plan');
    return h('div', { class: 'stack' },
      h('div', { class: 'plan-grid', role: 'radiogroup', 'aria-label': 'Care plan' }, catalog.plans.map((p) => planTile(p, group))),
      W.planErr);
  }

  function planTile(p, group) {
    const nameId = uid('pn');
    const selected = p.id === W.planId;
    const input = h('input', { type: 'radio', name: group, value: p.id, class: 'sr-only', checked: selected, 'aria-labelledby': nameId });
    input.addEventListener('change', () => {
      W.planId = p.id;
      W.planErr.textContent = '';
      input.closest('.plan-grid')?.querySelectorAll('.plan').forEach((t) => t.classList.toggle('is-selected', t.dataset.id === p.id));
      renderSummary();
    });
    return h('label', { class: ['glass glass--thin plan', selected && 'is-selected'], dataset: { id: p.id } },
      input,
      h('span', { class: 'plan__name', id: nameId }, p.name),
      // a fixed-height tag row keeps prices and features aligned across tiles
      h('span', { class: 'plan__tag' }, p.popular ? Badge({ kind: 'info', dot: false }, 'Most popular') : null),
      h('span', { class: 'plan__mark', 'aria-hidden': 'true' }, icon('check', { size: 14 })),
      h('span', { class: 'plan__price num' }, money(p.priceCents, p.currency || CURRENCY), h('small', { class: 'muted' }, ` ${perLabel(p)}`)),
      h('span', { class: 'plan__features' },
        (p.features || []).map((f) => h('span', { class: 'plan__feature' }, icon('check', { size: 16 }), h('span', {}, f)))));
  }

  function hostingStep() {
    W.slot = h('div', { class: 'stack' });
    syncSite();
    const hasServers = catalog.servers.some(usable);
    return h('div', { class: 'stack' },
      h('p', { class: 'muted' }, 'You can skip this and add a website later from Sites.'),
      W.hostToggle,
      hasServers ? null : h('div', { class: 'callout callout--warn' }, icon('alert', { size: 18 }),
        h('p', {}, 'No servers are online yet, so a website cannot be set up now. ',
          h('a', { class: 'link', href: '#/servers/new' }, 'Add a server'), ' or carry on without a website.')),
      W.slot);
  }

  function reviewStep() {
    const { client, plan, site } = collect();
    const server = site ? catalog.servers.find((s) => s.id === site.serverId) : null;
    return h('div', { class: 'stack' },
      h('div', { class: 'ob-review__pair' },
        block('Client', [
          ['Name', client.name || 'Not set'],
          ['Email', client.email || 'Not set'],
          ['Company', client.company || 'Not set'],
          ['Phone', client.phone || 'Not set'],
        ]),
        block('Care plan', [
          ['Plan', plan?.name || 'Not set'],
          ['Price', plan ? priceLine(plan) : 'Not set'],
          ['Includes', includes(plan)],
        ])),
      site
        ? block('Website', [
          ['Domain', site.domain || 'Not set'],
          ['Type', SITE_TYPES[site.type] || 'Not set'],
          ['Server', server?.name || 'Not set'],
          ['Database', site.createDatabase ? 'Yes' : 'No'],
          [Term('ssl', 'Padlock (SSL)'), site.issueCertificate ? "Yes, from Let's Encrypt" : 'No'],
        ])
        : block('Website', [['Status', 'Not set up now. Add one later from Sites.']]));
  }

  /* ---------- navigation & validation ---------- */

  function prev() {
    if (!busy && W.step > 0) show(W.step - 1);
  }

  function next() {
    if (busy) return;
    const s = W.step;
    if (s === 0 && !validateClient()) return focusInvalid();
    if (s === 1 && !W.planId) {
      W.planErr.textContent = 'Choose a care plan to continue.';
      return form.querySelector('input[type="radio"]')?.focus();
    }
    if (s === 2 && W.hosting && !W.site.validate()) return focusInvalid();
    if (s === 3) return launch();
    show(s + 1);
  }

  function validateClient() {
    const { inputs, fields } = W;
    const checks = {
      name: [inputs.name.value.trim() !== '', "Enter the client's name"],
      email: [EMAIL_RE.test(inputs.email.value.trim()), 'Enter a valid email address'],
    };
    let ok = true;
    for (const [k, [valid, msg]] of Object.entries(checks)) {
      fields[k].setError(valid ? '' : msg);
      if (!valid) ok = false;
    }
    return ok;
  }

  function focusInvalid() {
    form?.querySelector('.field.has-error input, .field.has-error select, .field.has-error textarea')?.focus();
  }

  /* ---------- create the client ---------- */

  async function launch() {
    const sent = collect();
    busy = true;
    setLoading(W.nextBtn, true);
    let job;
    try {
      job = await api.post('/api/onboard/client', {
        client: sent.client,
        planId: W.planId,
        ...(sent.site && { site: sent.site }),
      }, { signal: ctx.signal });
    } catch (e) {
      if (e?.name === 'AbortError') return;
      busy = false;
      return routeError(e);
    }
    return track(job, sent);
  }

  // A field-level API error goes back to the step that owns the field; anything else is only toasted.
  function routeError(e) {
    const msg = e?.message || 'Something went wrong';
    const key = String(e?.field || '').replace(/^(client|site)\./, '');
    let step = null;
    if (CLIENT_KEYS.includes(key)) { W.fields[key].setError(msg); step = 0; }
    else if (key === 'planId') { W.planErr.textContent = msg; step = 1; }
    else if (key && W.hosting) { W.site.setError(key, msg); step = 2; }
    toast({ title: step === null ? 'The client was not added' : 'Check the highlighted field', message: msg, kind: 'bad' });
    show(step ?? 3, { focus: false });
    if (step === 1) form.querySelector('input[type="radio"]')?.focus();
    else if (step === null) W.nextBtn.focus();
    else focusInvalid();
  }

  async function track(job, sent) {
    const progress = JobProgress(job);
    setMain(Card({ title: 'Adding the client', subtitle: 'Live progress, step by step.', class: 'onboard__main' }, progress));

    // secrets arrive on one poll only and are then dropped by the server, so keep the first copy.
    let secrets = null;
    let final;
    try {
      final = await pollJob(job.id, (j) => {
        if (j.secrets) secrets = j.secrets;
        progress.update(j);
      }, { signal: ctx.signal });
    } catch (e) {
      if (e?.name === 'AbortError') return;
      busy = false;
      toast({ title: 'Lost contact with the server', message: e.message, kind: 'bad' });
      setMain(Card({ title: 'Check the status', subtitle: 'We lost track of progress. Check Clients before trying again, so the client is not added twice.', class: 'onboard__main' },
        h('div', { class: 'row' }, Button({ variant: 'glass', icon: 'users', onclick: () => ctx.navigate('/clients') }, 'Open clients'))));
      return;
    }
    busy = false;
    if (final.status === 'done') return showSuccess(final, secrets ?? {}, sent);
    return showFailure(final, progress);
  }

  function showFailure(job, progress) {
    const message = job.error || 'Something went wrong.';
    toast({ title: 'Could not add the client', message, kind: 'bad' });
    // the callout below carries the error, so hide the progress footer that repeats it
    const foot = progress.querySelector('.job__foot');
    if (foot) foot.hidden = true;
    setMain(Card({ title: 'Could not add the client', subtitle: 'It stopped at the step marked above.', class: 'onboard__main' },
      progress,
      h('div', { class: 'callout callout--bad' }, icon('alert', { size: 18 }), h('p', {}, message)),
      h('div', { class: 'row' }, Button({ variant: 'primary', icon: 'refresh', onclick: () => show(3) }, 'Try again'))));
  }

  function showSuccess(job, secrets, sent) {
    const r = job.result || {};
    const entries = Object.entries(secrets);
    const planName = sent.plan?.name;
    setMain(Card({ class: 'onboard__main' },
      h('div', { class: 'stack ob-done' },
        h('span', { class: 'ob-done__icon' }, icon('check', { size: 40 })),
        h('div', {},
          h('h2', {}, 'Client added'),
          h('p', { class: 'muted' }, `${sent.client.name}${planName ? ` is on the ${planName} care plan` : ''}.`),
          r.siteId && sent.site ? h('p', { class: 'muted' }, `${sent.site.domain} is set up.`) : null),
        entries.length ? h('div', { class: 'ob-secrets' },
          h('div', { class: 'callout callout--warn' }, icon('alert', { size: 18 }), h('p', {}, 'These logins are shown only once. Copy them now.')),
          entries.map(([key, text]) => CopyBlock({ label: SECRET_LABELS[key] || key, text: String(text) }))) : null,
        h('div', { class: 'row ob-done__actions' },
          r.clientId ? Button({ variant: 'primary', iconRight: 'arrow-right', onclick: () => ctx.navigate(`/clients/${encodeURIComponent(r.clientId)}`) }, 'View client') : null,
          Button({ variant: 'glass', icon: 'plus', onclick: restart }, 'Add another client'),
          r.siteId ? h('a', { class: 'link', href: '#/sites' }, 'View sites') : null))));
    toast({ title: 'Client added', message: sent.client.name, kind: 'ok' });
  }

  function restart() {
    busy = false;
    W = newWizard();
    show(0);
  }

  load();
}
