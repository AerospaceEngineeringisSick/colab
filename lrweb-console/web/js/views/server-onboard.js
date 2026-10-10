// Linux server onboarding wizard (#/servers/new): Details -> Prepare -> Connect -> Done.
import { h, debounce } from '../core/dom.js';
import { api, pollJob } from '../core/api.js';
import { toast } from '../core/toast.js';
import {
  PageHeader, Card, Button, Field, Input, Select, Switch, Stepper, JobProgress, CopyBlock, Skeleton, ErrorState,
} from '../ui/components.js';
import { icon } from '../ui/icons.js';

const DETAILS = 0;
const PREPARE = 1;
const CONNECT = 2;
const DONE = 3;
const STEPS = [
  { key: 'details', label: 'Details' },
  { key: 'prepare', label: 'Prepare' },
  { key: 'connect', label: 'Connect' },
  { key: 'done', label: 'Done' },
];
const DETAIL_KEYS = ['name', 'host', 'sshPort', 'sshUser', 'provider', 'region'];
const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const LINUX_USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
// Notes about root access, keys or risk get the warning styling.
const SECURITY_NOTE_RE = /secur|protect|verif|sudo|root|key|restrict|bots|warn|placeholder|hash|fresh/i;
const CHECK_STEPS = [
  { key: 'ssh', label: 'SSH login' },
  { key: 'clpctl', label: 'clpctl available' },
  { key: 'panel', label: 'CloudPanel answering' },
  { key: 'os', label: 'Supported OS' },
];
const FRIENDLY = {
  ssh: (port) => `Knocking on port ${port}…`,
  clpctl: () => 'Looking for clpctl on the server…',
  panel: () => 'Checking that the CloudPanel login answers…',
  os: () => 'Reading the operating system…',
};
const FIELD_RULES = {
  name: (v) => (!v ? 'Give the server a name, for example web-ams-01' : v.length > 60 ? 'Keep the name under 60 characters' : ''),
  host: (v) => (!v ? 'Enter a hostname or IP address' : (HOSTNAME_RE.test(v) || IPV4_RE.test(v)) ? '' : 'Use a hostname like web1.example.com or an IPv4 address'),
  sshPort: (v) => (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 65535 ? '' : 'SSH port must be a number from 1 to 65535'),
  sshUser: (v) => (LINUX_USER_RE.test(v) ? '' : 'Use a Linux username such as lrweb'),
  provider: (v) => (v.length > 40 ? 'Keep it under 40 characters' : ''),
  region: (v) => (v.length > 40 ? 'Keep it under 40 characters' : ''),
};
const TROUBLESHOOT = [
  'The firewall allows the SSH port (TCP {port}) from this LRWeb host.',
  'The LRWeb public key is in ~lrweb/.ssh/authorized_keys.',
  'The sudoers rule for clpctl exists (/etc/sudoers.d/lrweb) and lets lrweb run it without a password.',
];
const bulletStyle = { paddingLeft: '1.25em', listStyle: 'disc', display: 'grid', gap: '6px' };

export default async function mount(root, ctx) {
  const inputs = {};
  const fields = {};
  const prep = { install: true, dbEngine: '' };
  let meta = null;
  let server = null;      // the registered (or resumed) Server; its id is the only handle for later calls
  let serverId = null;
  let registering = null; // in-flight POST /api/servers, so repeated clicks cannot register twice
  let locked = false;     // no update route exists, so the details freeze once the server exists
  let step = DETAILS;
  let ui = null;          // DOM refs and controllers of the step on screen; stale async work checks identity
  let script = null;      // last bootstrap script, keyed by the params that produced it
  let scriptToken = 0;

  const stepper = Stepper({ steps: STEPS, current: DETAILS });
  const stage = h('div', { class: 'stack' });
  const scheduleScript = debounce(() => loadScript(), 250);

  root.append(
    PageHeader({
      title: 'Add a Linux server',
      subtitle: 'Bootstrap CloudPanel and connect it to LRWeb',
      actions: Button({ variant: 'ghost', icon: 'chevron-left', onclick: () => ctx.navigate('/servers') }, 'Back to servers'),
    }),
    stepper,
    stage,
  );
  ctx.signal.addEventListener('abort', leave, { once: true });
  boot();
  return () => { leave(); ui = null; };

  /* ---------- lifecycle ---------- */

  async function boot() {
    stage.replaceChildren(Card({}, Skeleton({ lines: 6 })));
    const resumeId = ctx.query?.serverId;
    try {
      const [m, existing] = await Promise.all([
        meta ?? api.get('/api/meta', { signal: ctx.signal }),
        resumeId ? api.get(`/api/servers/${encodeURIComponent(resumeId)}`, { signal: ctx.signal }) : null,
      ]);
      meta = m;
      buildFields();
      if (existing) prefill(existing);
      goTo(existing ? PREPARE : DETAILS);
    } catch (e) {
      if (e?.name === 'AbortError') return;
      stage.replaceChildren(Card({}, ErrorState(e, boot)));
    }
  }

  /** Stops in-flight requests and timers of the step on screen. */
  function leave() {
    if (!ui) return;
    clearTimeout(ui.timer);
    ui.run.abort();
  }

  function goTo(n, { focus = false } = {}) {
    leave();
    step = n;
    stepper.set(n);
    ui = { run: new AbortController(), timer: 0, next: null, slot: null };
    const card = [detailsCard, prepareCard, connectCard, doneCard][n]();
    stage.replaceChildren(card);
    if (focus) {
      const title = stage.querySelector('.card__title');
      title?.setAttribute('tabindex', '-1');
      title?.focus({ preventScroll: true });
    }
  }

  function next() {
    if (step === DETAILS) {
      if (locked || validateDetails()) goTo(PREPARE, { focus: true });
    } else if (!ui.next.disabled) {
      goTo(step + 1, { focus: true });
    }
  }

  /* ---------- details ---------- */

  function buildFields() {
    if (inputs.name) return;
    inputs.name = Input({ placeholder: 'web-ams-01', maxlength: 60, required: true });
    inputs.host = Input({ placeholder: 'web1.example.com or 203.0.113.10', required: true });
    inputs.sshPort = Input({ value: '22', inputmode: 'numeric', maxlength: 5 });
    inputs.sshUser = Input({ value: 'lrweb' });
    inputs.os = Select({ options: meta.osOptions, value: meta.osOptions[0]?.value });
    inputs.provider = Input({ placeholder: 'Hetzner, OVH…', maxlength: 40 });
    inputs.region = Input({ placeholder: 'Amsterdam', maxlength: 40 });
    fields.name = Field({ label: 'Name', required: true, hint: 'Shown in LRWeb and in the script.' }, inputs.name);
    fields.host = Field({ label: 'Host', required: true, hint: 'Hostname or IPv4 address. LRWeb connects here.' }, inputs.host);
    fields.sshPort = Field({ label: 'SSH port' }, inputs.sshPort);
    fields.sshUser = Field({ label: 'SSH user', hint: 'Created by the bootstrap script.' }, inputs.sshUser);
    fields.os = Field({ label: 'Operating system', required: true }, inputs.os);
    fields.provider = Field({ label: 'Provider', hint: 'Optional.' }, inputs.provider);
    fields.region = Field({ label: 'Region', hint: 'Optional.' }, inputs.region);
    prep.dbEngine = meta.dbEngines[0]?.value ?? '';
    for (const k of DETAIL_KEYS) {
      inputs[k].addEventListener('input', () => { if (fields[k].classList.contains('has-error')) validateField(k); });
    }
  }

  function prefill(s) {
    if (![...inputs.os.options].some((o) => o.value === s.os)) inputs.os.append(h('option', { value: s.os }, s.os));
    inputs.name.value = s.name ?? '';
    inputs.host.value = s.host ?? '';
    inputs.sshPort.value = String(s.sshPort ?? 22);
    inputs.sshUser.value = s.sshUser || 'lrweb';
    inputs.os.value = s.os ?? '';
    inputs.provider.value = s.provider ?? '';
    inputs.region.value = s.region ?? '';
    server = s;
    serverId = s.id;
    locked = true;
  }

  function validateField(k) {
    const msg = FIELD_RULES[k](inputs[k].value.trim());
    fields[k].setError(msg);
    return msg;
  }

  function validateDetails() {
    const bad = DETAIL_KEYS.filter((k) => validateField(k));
    if (bad.length) inputs[bad[0]].focus();
    return !bad.length;
  }

  function registerBody() {
    return {
      name: inputs.name.value.trim(),
      host: inputs.host.value.trim(),
      sshPort: Number(inputs.sshPort.value.trim()),
      sshUser: inputs.sshUser.value.trim(),
      os: inputs.os.value,
      provider: inputs.provider.value.trim(),
      region: inputs.region.value.trim(),
    };
  }

  function detailsCard() {
    for (const c of Object.values(inputs)) c.disabled = locked;
    const form = h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); next(); } },
      locked && h('div', { class: 'callout' }, icon('lock', { size: 18 }),
        h('p', {}, `Registered as ${server.name}. Details are locked so the bootstrap script matches the server.`)),
      h('div', { class: 'form-grid' },
        fields.name, fields.host, fields.sshPort, fields.sshUser, fields.os, fields.provider, fields.region),
      h('div', { class: 'spread' }, h('span'),
        Button({ variant: 'primary', type: 'submit', iconRight: 'arrow-right' }, 'Continue')));
    return Card({ title: 'Server details', subtitle: 'Where LRWeb can reach the server over SSH.' }, form);
  }

  /* ---------- prepare ---------- */

  function prepareCard() {
    const mine = ui;
    const slot = h('div', { class: 'stack' });
    const dbWrap = h('div', { style: { maxWidth: '360px', width: '100%' } });
    const renderDb = () => dbWrap.replaceChildren(...(prep.install ? [Field({ label: 'Database engine', hint: 'Used by the CloudPanel installer.' }, Select({
      options: meta.dbEngines,
      value: prep.dbEngine,
      onchange: (e) => { prep.dbEngine = e.target.value; scheduleScript(); },
    }))] : []));
    renderDb();
    const install = Switch({
      checked: prep.install,
      label: 'Install CloudPanel for me',
      onchange: (e) => { prep.install = e.target.checked; renderDb(); scheduleScript(); },
    });
    const cont = Button({ variant: 'primary', type: 'submit', iconRight: 'arrow-right', disabled: true }, 'Continue');
    mine.next = cont;
    mine.slot = slot;
    const form = h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); next(); } },
      h('ol', { style: { paddingLeft: '1.4em', listStyle: 'decimal' } },
        h('li', { style: { marginBottom: '6px' } }, 'SSH in to the server as root: ', h('code', { class: 'mono' }, `ssh root@${inputs.host.value.trim()}`)),
        h('li', { style: { marginBottom: '6px' } }, 'Paste and run the script below.'),
        h('li', {}, 'Come back here and press Continue.')),
      h('div', { class: 'stack', style: { gap: '12px' } }, h('div', {}, install), dbWrap),
      slot,
      h('div', { class: 'spread' },
        Button({ variant: 'glass', icon: 'chevron-left', onclick: () => goTo(DETAILS, { focus: true }) }, 'Back'),
        cont));
    loadScript();
    return Card({ title: 'Prepare the server', subtitle: 'Run one script as root on a fresh server.' }, form);
  }

  function loadScript() {
    const mine = ui;
    if (step !== PREPARE || !mine?.slot) return;
    const token = ++scriptToken;
    const params = {
      os: inputs.os.value,
      dbEngine: prep.dbEngine,
      name: inputs.name.value.trim(),
      sshPort: inputs.sshPort.value.trim(),
      installCloudpanel: prep.install ? 1 : 0,
    };
    const key = JSON.stringify(params);
    if (script?.key === key) return renderScript(mine, script.data);
    mine.next.disabled = true;
    mine.slot.replaceChildren(Skeleton({ lines: 6 }));
    api.get('/api/servers/bootstrap-script', { params, signal: mine.run.signal })
      .then((data) => {
        if (ui !== mine || token !== scriptToken) return;
        script = { key, data };
        renderScript(mine, data);
      })
      .catch((e) => {
        if (e?.name === 'AbortError' || ui !== mine || token !== scriptToken) return;
        mine.slot.replaceChildren(h('div', { class: 'callout callout--bad', role: 'alert' }, icon('alert', { size: 18 }),
          h('div', { class: 'stack', style: { gap: '10px', minWidth: 0 } },
            h('p', {}, e.message || 'Could not build the script.'),
            Button({ size: 'sm', variant: 'glass', icon: 'refresh', onclick: () => loadScript() }, 'Try again'))));
      });
  }

  function renderScript(mine, data) {
    const notes = data.notes ?? [];
    const security = notes.filter((n) => SECURITY_NOTE_RE.test(n));
    const general = notes.filter((n) => !SECURITY_NOTE_RE.test(n));
    const noteBox = (items, warn) => h('div', { class: ['callout', warn && 'callout--warn'] },
      icon(warn ? 'shield' : 'info', { size: 18 }),
      h('ul', { style: bulletStyle }, items.map((n) => h('li', {}, n))));
    mine.slot.replaceChildren(...[
      CopyBlock({ text: data.script, label: 'bootstrap.sh', maxHeight: 360 }),
      h('p', { class: 'muted' }, 'Save it as bootstrap.sh, then run ', h('code', { class: 'mono' }, 'sudo bash bootstrap.sh'), ' on the server.'),
      security.length && noteBox(security, true),
      general.length && noteBox(general, false),
      CopyBlock({ text: data.publicKey, label: 'LRWeb public key (already embedded in the script)', maxHeight: 120 }),
    ].filter(Boolean));
    mine.next.disabled = false;
  }

  /* ---------- connect ---------- */

  function ensureRegistered() {
    if (serverId) return Promise.resolve(server);
    registering ??= api.post('/api/servers', registerBody(), { signal: ctx.signal })
      .then((s) => { server = s; serverId = s.id; locked = true; return s; })
      .finally(() => { registering = null; });
    return registering;
  }

  function connectCard() {
    const mine = ui;
    const port = () => server?.sshPort ?? inputs.sshPort.value.trim();
    const freshSteps = () => CHECK_STEPS.map((s) => ({ ...s, status: 'pending' }));
    const progress = JobProgress({ status: 'queued', steps: freshSteps() });
    const headline = h('p', { role: 'status' }, 'Getting ready…');
    const failBox = h('div');
    const actions = h('div', { class: 'row' });
    const cont = Button({ variant: 'primary', type: 'submit', iconRight: 'arrow-right', disabled: true }, 'Continue');
    mine.next = cont;

    const paint = (job) => {
      progress.update(job);
      const running = job.steps?.find((s) => s.status === 'running');
      if (running) headline.textContent = FRIENDLY[running.key]?.(port()) ?? 'Working…';
    };

    function showError(title, body, { troubleshoot = false, retryLabel = 'Try again' } = {}) {
      failBox.replaceChildren(h('div', { class: 'callout callout--bad', role: 'alert' }, icon('alert', { size: 18 }),
        h('div', { class: 'stack', style: { gap: '10px', minWidth: 0 } },
          h('p', {}, h('strong', {}, title), ' ', body),
          troubleshoot && h('div', { class: 'stack', style: { gap: '6px' } },
            h('p', {}, 'Check these first:'),
            h('ul', { style: bulletStyle }, TROUBLESHOOT.map((t) => h('li', {}, t.replace('{port}', port()))))))));
      actions.replaceChildren(Button({ variant: 'primary', icon: 'refresh', onclick: () => run() }, retryLabel));
      headline.textContent = title.replace(/[.:]$/, '');
    }

    function backToDetails(e) {
      goTo(DETAILS);
      fields[e.field].setError(e.message);
      inputs[e.field].focus();
    }

    async function run() {
      if (ui !== mine) return;
      const signal = mine.run.signal;
      failBox.replaceChildren();
      cont.disabled = true;
      actions.replaceChildren(cont);
      headline.textContent = 'Getting ready…';
      progress.update({ status: 'queued', steps: freshSteps() });

      if (!serverId) {
        try {
          await ensureRegistered();
        } catch (e) {
          if (e?.name === 'AbortError' || ui !== mine) return;
          if (e.field && fields[e.field]) return backToDetails(e);
          return showError("Couldn't register the server", e.message);
        }
        if (ui !== mine) return;
      }

      let job;
      try {
        job = await api.post(`/api/servers/${serverId}/check`, {}, { signal });
      } catch (e) {
        if (e?.name === 'AbortError' || ui !== mine) return;
        return showError("Couldn't start the check", e.message, { retryLabel: 'Retry check' });
      }
      if (ui !== mine) return;
      paint(job);

      let final;
      try {
        final = await pollJob(job.id, (j) => { if (ui === mine) paint(j); }, { signal });
      } catch (e) {
        if (e?.name === 'AbortError' || ui !== mine) return;
        return showError('Lost contact with LRWeb', e.message, { retryLabel: 'Retry check' });
      }
      if (ui !== mine) return;
      paint(final);

      if (final.status === 'done') {
        headline.textContent = 'Connected. Opening the summary…';
        cont.disabled = false;
        actions.replaceChildren(cont);
        toast({ title: 'Server connected', message: server.name, kind: 'ok' });
        mine.timer = setTimeout(() => { if (ui === mine) goTo(DONE, { focus: true }); }, 900);
      } else {
        const failed = final.steps?.find((s) => s.status === 'failed');
        showError(`${failed?.label ?? 'Connection check'} failed.`,
          failed?.detail || final.error || 'The check did not finish.',
          { troubleshoot: true, retryLabel: 'Retry check' });
      }
    }

    const form = h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); next(); } },
      headline, progress, failBox,
      h('div', { class: 'spread' },
        Button({ variant: 'glass', icon: 'chevron-left', onclick: () => goTo(PREPARE, { focus: true }) }, 'Back'),
        actions));
    run();
    return Card({ title: 'Connect', subtitle: 'LRWeb logs in over SSH and checks CloudPanel.' }, form);
  }

  /* ---------- done ---------- */

  function doneCard() {
    const panel = server.panelUrl ?? '';
    const osLabel = meta.osOptions.find((o) => o.value === server.os)?.label ?? server.os;
    const hero = h('div', { style: { display: 'grid', justifyItems: 'center', gap: '10px', textAlign: 'center', padding: '8px 0' } },
      h('span', {
        class: 'empty__icon',
        style: {
          width: '76px', height: '76px', color: 'var(--ok)',
          background: 'color-mix(in oklab, var(--ok) 18%, transparent)',
          boxShadow: 'inset 0 0 0 1px color-mix(in oklab, var(--ok) 40%, transparent)',
        },
      }, icon('check', { size: 36 })),
      h('h2', { class: 'card__title' }, 'Server connected'),
      h('p', { class: 'muted' }, `${server.name} answers over SSH and CloudPanel is ready for sites.`));
    const rows = [
      ['Name', server.name],
      ['Host', h('span', { class: 'mono' }, server.host)],
      ['OS', osLabel],
      ['CloudPanel', /^https:\/\//.test(panel)
        ? h('a', { class: 'link mono', href: panel, target: '_blank', rel: 'noopener noreferrer' }, panel)
        : panel || '—'],
    ];
    const summary = h('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
    const actions = h('div', { class: 'row' },
      Button({ variant: 'primary', iconRight: 'arrow-right', onclick: () => ctx.navigate(`/servers/${encodeURIComponent(server.id)}`) }, 'View server'),
      Button({ variant: 'glass', icon: 'globe', onclick: () => ctx.navigate(`/sites?serverId=${encodeURIComponent(server.id)}`) }, 'Add a site'),
      Button({ variant: 'ghost', icon: 'plus', onclick: () => ctx.navigate('/servers/new') }, 'Add another server'));
    return Card({}, hero, summary, actions);
  }
}
