// Site migration wizard (#/migrate, optional ?siteId=): Site -> New server -> Options -> Check and go.
import { h, uid, debounce, ensureCss } from '../core/dom.js';
import { api, pollJob } from '../core/api.js';
import { bytes } from '../core/fmt.js';
import { toast } from '../core/toast.js';
import { state } from '../core/store.js';
import { icon } from '../ui/icons.js';
import { Term } from '../ui/glossary.js';
import {
  PageHeader, Card, Button, Badge, StatusBadge, Meter, Stat, Field, Input, Switch, Stepper, JobProgress,
  CopyBlock, Skeleton, Empty, Confirm, loadInto, setLoading,
} from '../ui/components.js';

const SITE = 0;
const SERVER = 1;
const OPTIONS = 2;
const GO = 3;
const STEPS = [
  { key: 'site', label: 'Site' },
  { key: 'server', label: 'New server' },
  { key: 'options', label: 'Options' },
  { key: 'go', label: 'Check and go' },
];
const TYPE_LABEL = { php: 'PHP', nodejs: 'Node.js', static: 'Static', python: 'Python', 'reverse-proxy': 'Proxy' };
const RISK = { low: ['ok', 'Low risk'], medium: ['warn', 'Medium risk'], high: ['bad', 'High risk'] };
const READY = new Set(['online', 'degraded']);
const NOT_READY = {
  pending: 'Not ready yet: finish setting this server up',
  offline: 'Not ready yet: it is not answering. Check it on the Servers page.',
};
const SECRET_LABELS = { siteUserPassword: 'Site user password', dbUser: 'Database user', dbPassword: 'Database password' };
const MB = 1048576;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const isMovable = (s) => s.status === 'active' && !s.migratedFrom;
const hasDatabase = (s) => Boolean(s?.database);
const freshChoice = (siteId = '') => ({ siteId, toServerId: '', copyFiles: true, copyDatabase: true, issueCertificate: true });
const errorText = (e) => e?.message || 'Something went wrong. Try again.';
const typeLabel = (s) => {
  const base = TYPE_LABEL[s.type] || s.type;
  return s.runtime && s.type !== 'static' && s.type !== 'reverse-proxy' ? `${base} ${s.runtime}` : base;
};
const secretLabel = (k) => SECRET_LABELS[k] || k.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, (c) => c.toUpperCase());
const downtimeText = (sec = 0) => {
  if (sec < 60) return 'Under a minute';
  const m = Math.round(sec / 60);
  return `About ${m} minute${m === 1 ? '' : 's'}`;
};
/** Server text is plain except for a few jargon words, which get a Term tip. */
const TERM_WORDS = { DNS: 'dns', SSL: 'ssl' };
const withTerms = (text) => String(text ?? '').split(/\b(DNS|SSL)\b/).map((part) => (TERM_WORDS[part] ? Term(TERM_WORDS[part], part) : part));
const failureText = (job) => job.error || job.steps?.find((s) => s.status === 'failed')?.detail || 'The move did not finish.';

/* ---------- small pieces ---------- */

const sub = (text) => h('h3', { class: 'mig-sub' }, text);

/** callout('warn' | 'bad' | '', iconName, ...children) */
const callout = (tone, iconName, ...children) => h('div', { class: ['callout', tone && `callout--${tone}`] },
  icon(iconName, { size: 18 }), h('div', { class: 'mig-callout__body' }, ...children));

function inlineError(message, retry, label = 'Try again') {
  return h('div', { class: 'callout callout--bad', role: 'alert' }, icon('alert', { size: 18 }),
    h('div', { class: 'mig-callout__body' },
      h('p', {}, message),
      retry && Button({ size: 'sm', variant: 'glass', icon: 'refresh', onclick: retry }, label)));
}

function secretsBlock(secrets) {
  const entries = Object.entries(secrets || {});
  if (!entries.length) return null;
  return h('div', { class: 'stack mig-block' },
    callout('warn', 'shield', h('p', {}, 'Save these passwords now. They are shown only once.')),
    entries.map(([k, v]) => CopyBlock({ text: String(v), label: secretLabel(k), maxHeight: 120 })));
}

function runbookBlock(text) {
  if (!text) return null;
  return h('div', { class: 'stack mig-block' }, sub('Commands for the server work'),
    CopyBlock({ text, label: 'Run in order', maxHeight: 320 }));
}

function stepItem(st) {
  const [kind, label] = RISK[st.risk] || ['neutral', st.risk || 'Unknown'];
  return h('li', { class: 'mig-step' },
    h('div', { class: 'mig-step__top' }, h('strong', {}, withTerms(st.label ?? st.key)), Badge({ kind }, label)),
    st.detail ? h('p', { class: 'mig-step__detail muted' }, withTerms(st.detail)) : null);
}

/** One switch with a plain-English hint wired to it through aria-describedby. */
function optionRow({ label, hint, checked, disabled = false, onchange }) {
  const hintId = uid('mig-hint');
  const sw = Switch({ checked, label, onchange: (e) => onchange(e.target.checked) });
  const input = sw.querySelector('input');
  input.disabled = disabled;
  input.setAttribute('aria-describedby', hintId);
  return h('div', { class: ['mig-switch', disabled && 'is-disabled'] }, sw,
    h('p', { id: hintId, class: 'mig-switch__hint muted' }, hint));
}

/** A real radio hidden inside a label: keyboard and screen readers get a radio group, the card looks like a choice. */
function siteRow(s, group, where, selected, onPick) {
  return h('label', { class: 'mig-option' },
    h('input', { type: 'radio', class: 'mig-radio', name: group, value: s.id, checked: selected, onchange: () => onPick(s) }),
    h('span', { class: 'mig-option__mark', 'aria-hidden': 'true' }),
    h('span', { class: 'mig-option__body' },
      h('span', { class: 'mig-site__top' },
        h('span', { class: 'mig-site__domain' }, s.domain),
        h('span', { class: 'chip' }, typeLabel(s))),
      h('span', { class: 'mig-meta' }, s.clientName || 'Internal'),
      h('span', { class: 'mig-meta' }, 'Currently on ', h('b', {}, where))));
}

function serverOption(s, group, selected, onPick) {
  const ok = READY.has(s.status);
  const why = s.status === 'degraded'
    ? 'Working, but it is reporting problems. Check it first.'
    : ok ? '' : (NOT_READY[s.status] || 'Not ready yet: check it on the Servers page.');
  const noteId = uid('mig-why');
  const input = h('input', {
    type: 'radio', class: 'mig-radio', name: group, value: s.id, checked: selected, disabled: !ok,
    'aria-describedby': why ? noteId : null,
    onchange: () => onPick(s),
  });
  return h('label', { class: 'mig-option' }, input,
    h('span', { class: 'mig-option__mark', 'aria-hidden': 'true' }),
    h('span', { class: 'mig-option__body' },
      h('span', { class: 'mig-server__top' }, h('span', { class: 'mig-server__name' }, s.name), StatusBadge(s.status)),
      h('span', { class: 'mig-meta' }, `${s.region || 'No region set'} · ${plural(s.siteCount ?? 0, 'site')}`),
      s.metrics && h('span', { class: 'mig-server__meters' },
        Meter({ value: s.metrics.cpu, label: 'CPU' }),
        Meter({ value: s.metrics.disk, label: 'Disk' })),
      why && h('span', { id: noteId, class: 'mig-server__note' }, why)));
}

/* ---------- view ---------- */

export default async function mount(root, ctx) {
  await ensureCss('css/view-migrate.css');

  let sites = [];
  let servers = [];
  let serverById = new Map();
  let presetNote = '';
  let choice = freshChoice();   // kept across Back; only "Move another site" clears it
  let step = SITE;
  let ui = null;                // controller of the step on screen; stale async work checks identity

  const stepper = Stepper({ steps: STEPS, current: SITE });
  const stage = h('div', { class: 'stack mig-stage' });
  root.append(
    PageHeader({
      title: 'Move a website',
      subtitle: "Copy a client's site to another server, check it, then switch visitors over",
      actions: Button({ variant: 'ghost', icon: 'chevron-left', onclick: () => ctx.navigate('/sites') }, 'Back to sites'),
    }),
    stepper,
    stage,
  );
  ctx.signal.addEventListener('abort', leave, { once: true });
  const CARDS = [siteCard, serverCard, optionsCard, goCard];
  loadInto(stage, loadAll, () => show(step), { skeleton: Card({}, Skeleton({ lines: 6 })) });
  return () => { leave(); ui = null; };

  /* ---------- data ---------- */

  async function loadAll() {
    try {
      const [allSites, allServers] = await Promise.all([
        api.get('/api/sites', { signal: ctx.signal }),
        api.get('/api/servers', { signal: ctx.signal }),
      ]);
      sites = allSites ?? [];
      servers = allServers ?? [];
    } catch (e) {
      if (e?.name !== 'AbortError') toast({ title: "Couldn't load the websites", message: errorText(e), kind: 'bad' });
      throw e;
    }
    serverById = new Map(servers.map((s) => [s.id, s]));
    preselect(ctx.query?.siteId);
  }

  function preselect(id) {
    if (!id) return;
    const s = sites.find((x) => x.id === id);
    if (!s) presetNote = 'That website was not found. Pick one from the list.';
    else if (!isMovable(s)) {
      presetNote = s.migratedFrom
        ? `${s.domain} is a copy made by an earlier move, so it cannot be moved again.`
        : `Only active websites can be moved. ${s.domain} is ${s.status} right now.`;
    } else choice.siteId = s.id;
  }

  /* ---------- steps ---------- */

  function currentSite() {
    return sites.find((s) => s.id === choice.siteId) || null;
  }

  function serverName(id, fallback) {
    return serverById.get(id)?.name || fallback || 'Unknown server';
  }

  function show(n) {
    leave();
    step = n >= SERVER && !currentSite() ? SITE : n;
    stepper.set(step);
    ui = { run: new AbortController() };
    return CARDS[step]();
  }

  function goTo(n) {
    stage.replaceChildren(show(n));
    focusTitle();
  }

  function leave() {
    ui?.run.abort();
  }

  /** Moves focus to the new step's heading for screen readers; no ring, since it is not a control. */
  function focusTitle() {
    const t = stage.querySelector('.card__title');
    if (!t) return;
    t.setAttribute('tabindex', '-1');
    t.style.outline = 'none';
    t.focus({ preventScroll: true });
    // On phones the list above can be long, so bring the heading into view only when it is off screen.
    const r = t.getBoundingClientRect();
    if (r.top < 96 || r.bottom > innerHeight) t.scrollIntoView({ block: 'start' });
  }

  /* ---------- 1. site ---------- */

  function siteCard() {
    const list = sites.filter(isMovable).sort((a, b) => a.domain.localeCompare(b.domain));
    const group = uid('mig-site');
    const listId = uid('mig-sites');
    const preset = note(presetNote);
    const cont = Button({ variant: 'primary', iconRight: 'arrow-right', disabled: !currentSite(), onclick: () => goTo(SERVER) }, 'Continue');
    const pick = (s) => {
      choice.siteId = s.id;
      if (choice.toServerId === s.serverId || !serverById.has(choice.toServerId)) choice.toServerId = '';
      preset.hidden = true;
      cont.disabled = false;
    };
    const rows = list.map((s) => {
      const where = serverName(s.serverId, s.serverName);
      return { s, text: `${s.domain} ${s.clientName || ''} ${where}`.toLowerCase(), el: siteRow(s, group, where, choice.siteId === s.id, pick) };
    });

    const search = Input({ type: 'search', placeholder: 'Type a domain or client name', 'aria-controls': listId, oninput: debounce(() => applyFilter(), 120) });
    const noMatch = Empty({
      icon: 'search', title: 'No websites match', message: 'Try another domain or client name.',
      action: Button({ variant: 'glass', size: 'sm', onclick: () => { search.value = ''; applyFilter(); search.focus(); } }, 'Clear search'),
    });
    noMatch.hidden = true;
    const listEl = h('div', { class: 'mig-options', id: listId, role: 'radiogroup', 'aria-label': 'Websites' }, rows.map((r) => r.el));

    function applyFilter() {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      for (const r of rows) {
        r.el.hidden = Boolean(q) && !r.text.includes(q);
        if (!r.el.hidden) shown++;
      }
      noMatch.hidden = shown > 0;
    }

    const body = list.length
      ? [Field({ label: 'Find a website' }, search), listEl, noMatch]
      : Empty({
        icon: 'globe', title: 'No websites to move',
        message: 'Only active websites can be moved. A copy made by an earlier move is not listed.',
        action: Button({ variant: 'glass', icon: 'globe', onclick: () => ctx.navigate('/sites') }, 'Go to sites'),
      });

    return Card({ title: 'Choose the website', subtitle: 'Pick the website you want to copy to another server.' },
      preset, body,
      h('div', { class: 'spread' }, h('span'), cont));
  }

  /** A warning note that is hidden when there is nothing to say. */
  function note(text) {
    const el = callout('warn', 'alert', h('p', {}, text));
    el.hidden = !text;
    return el;
  }

  /* ---------- 2. new server ---------- */

  function serverCard() {
    const site = currentSite();
    const others = servers.filter((s) => s.id !== site.serverId);
    const group = uid('mig-server');
    const readyTarget = (id) => others.some((s) => s.id === id && READY.has(s.status));
    const cont = Button({ variant: 'primary', iconRight: 'arrow-right', disabled: !readyTarget(choice.toServerId), onclick: () => goTo(OPTIONS) }, 'Continue');
    const onPick = (s) => {
      choice.toServerId = s.id;
      cont.disabled = false;
    };
    const body = others.length
      ? h('div', { class: 'mig-options mig-options--cards', role: 'radiogroup', 'aria-label': 'New servers' },
        others.map((s) => serverOption(s, group, choice.toServerId === s.id, onPick)))
      : Empty({
        icon: 'server', title: 'No other servers yet',
        message: 'The copy needs a second server to go to. Add one first.',
        action: Button({ variant: 'glass', icon: 'plus', onclick: () => ctx.navigate('/servers/new') }, 'Add a Linux server'),
      });
    return Card({
      title: 'Choose the new server',
      subtitle: `${site.domain} is on ${serverName(site.serverId, site.serverName)} now. Pick where the copy should go.`,
    },
      body,
      h('div', { class: 'spread' },
        Button({ variant: 'glass', icon: 'chevron-left', onclick: () => goTo(SITE) }, 'Back'),
        cont));
  }

  /* ---------- 3. options ---------- */

  function optionsCard() {
    const site = currentSite();
    const dbOn = hasDatabase(site);
    return Card({ title: 'Choose what to copy', subtitle: 'The copy is built on the new server. The old site stays as it is.' },
      h('div', { class: 'stack' },
        optionRow({
          label: 'Copy the website files',
          hint: 'Copies everything in the website folder, so the new copy matches the old one.',
          checked: choice.copyFiles,
          onchange: (v) => { choice.copyFiles = v; },
        }),
        optionRow({
          label: 'Copy the database',
          hint: dbOn
            ? 'Copies the database, so the content and settings stored in it come across.'
            : 'This website has no database, so there is nothing to copy.',
          checked: dbOn && choice.copyDatabase,
          disabled: !dbOn,
          onchange: (v) => { choice.copyDatabase = v; },
        }),
        optionRow({
          label: h('span', {}, 'Set up the padlock (', Term('ssl', 'SSL'), ') on the new server'),
          hint: 'Gets a certificate for the new copy, so the padlock shows in the browser.',
          checked: choice.issueCertificate,
          onchange: (v) => { choice.issueCertificate = v; },
        })),
      callout('', 'shield', h('p', {}, 'Visitors keep seeing the old site until you switch them over. The old site is never deleted.')),
      h('div', { class: 'spread' },
        Button({ variant: 'glass', icon: 'chevron-left', onclick: () => goTo(SERVER) }, 'Back'),
        Button({ variant: 'primary', iconRight: 'arrow-right', onclick: () => goTo(GO) }, 'Continue')));
  }

  /* ---------- 4. check and go ---------- */

  function goCard() {
    const mine = ui;
    const site = currentSite();
    const target = serverById.get(choice.toServerId);
    const targetName = target?.name || 'the new server';
    const body = h('div', { class: 'stack' });
    const errBox = h('div', { class: 'mig-errbox' });
    const startBtn = Button({ variant: 'primary', icon: 'play', disabled: true, onclick: () => confirmStart() }, 'Start the move');
    let plan = null;

    const requestBody = () => ({
      toServerId: choice.toServerId,
      copyFiles: choice.copyFiles,
      copyDatabase: hasDatabase(site) && choice.copyDatabase,
      issueCertificate: choice.issueCertificate,
    });
    const setPanel = (node) => {
      if (ui !== mine) return;
      stage.replaceChildren(node);
      focusTitle();
    };
    const startFailedInline = (e) => {
      setLoading(startBtn, false);
      errBox.replaceChildren(inlineError(errorText(e)));
    };

    async function loadPlan() {
      startBtn.disabled = true;
      body.replaceChildren(Skeleton({ lines: 6 }));
      try {
        plan = await api.post(`/api/sites/${encodeURIComponent(site.id)}/migrate/plan`, requestBody(), { signal: mine.run.signal });
      } catch (e) {
        if (e?.name === 'AbortError' || ui !== mine) return;
        toast({ title: "Couldn't check the plan", message: errorText(e), kind: 'bad' });
        body.replaceChildren(inlineError(errorText(e), loadPlan));
        return;
      }
      if (ui !== mine) return;
      renderPlan();
    }

    function renderPlan() {
      const est = plan.estimate || {};
      const dbOn = hasDatabase(site) && choice.copyDatabase;
      // replaceChildren takes Nodes only, so arrays and nulls are flattened and dropped first.
      const parts = [
        h('dl', { class: 'kv' }, [
          ['Website', site.domain],
          ['Moving from', serverName(site.serverId, site.serverName)],
          ['Moving to', targetName],
          ['Website files', choice.copyFiles ? 'Copied' : 'Not copied'],
          ['Database', !hasDatabase(site) ? 'None on this website' : dbOn ? 'Copied' : 'Not copied'],
          ['Padlock (SSL)', choice.issueCertificate ? 'Set up on the new server' : 'Not set up'],
        ].flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
        h('div', { class: 'mig-stats' },
          Stat({ label: 'Website size', value: choice.copyFiles ? bytes((est.filesMb || 0) * MB) : 'Not copied', icon: 'disk', hint: 'Estimate' }),
          Stat({ label: 'Database size', value: dbOn ? bytes((est.dbMb || 0) * MB) : 'Not copied', icon: 'database', hint: 'Estimate' }),
          Stat({ label: 'Expected downtime', value: downtimeText(est.downtimeSec), icon: 'clock', hint: 'Estimate' })),
        (plan.warnings || []).map((w) => callout('warn', 'alert', h('p', {}, withTerms(w)))),
        sub('What will happen'),
        h('ol', { class: 'mig-steps' }, (plan.steps || []).map(stepItem)),
        plan.runbook
          ? h('details', { class: 'mig-details' },
            h('summary', {}, 'Step-by-step commands (for whoever does the server work)'),
            CopyBlock({ text: plan.runbook, label: 'Run in order', maxHeight: 320 }))
          : null,
      ];
      body.replaceChildren(...parts.flat().filter(Boolean));
      startBtn.disabled = false;
    }

    async function confirmStart() {
      const ok = await Confirm({
        title: 'Start the move?',
        message: `LRWeb will build a new copy of ${site.domain} on ${targetName}. The old site is not changed or deleted, and visitors keep seeing it until you switch them over.`,
        confirmLabel: 'Start the move',
      });
      if (ok) startJob(startFailedInline);
    }

    /** Starts the move. onError shows a failed start where the caller is standing. */
    async function startJob(onError) {
      if (ui !== mine) return;
      errBox.replaceChildren();
      setLoading(startBtn, true);
      let job;
      try {
        job = await api.post(`/api/sites/${encodeURIComponent(site.id)}/migrate`, requestBody(), { signal: mine.run.signal });
      } catch (e) {
        if (e?.name === 'AbortError' || ui !== mine) return;
        toast({ title: "Couldn't start the move", message: errorText(e), kind: 'bad' });
        onError(e);
        return;
      }
      if (ui !== mine) return;
      track(job);
    }

    /** Polls a job to the end. Secrets are sent only once, so the copy from the first poll that has them is kept. */
    async function track(first, carry = {}) {
      let latest = first;
      let secrets = first.secrets ?? carry.secrets ?? null;
      let result = first.result ?? carry.result ?? null;
      const progress = JobProgress(first);
      setPanel(Card({ title: `Moving ${site.domain}`, subtitle: 'Keep this page open to see progress. The old site is not changed.' }, progress));
      let final;
      try {
        final = await pollJob(first.id, (j) => {
          latest = j;
          secrets = j.secrets ?? secrets;
          result = j.result ?? result;
          if (ui === mine) progress.update(j);
        }, { signal: mine.run.signal });
      } catch (e) {
        if (e?.name === 'AbortError' || ui !== mine) return;
        toast({ title: 'Lost contact with LRWeb', message: errorText(e), kind: 'bad' });
        setPanel(Card({ title: 'Lost contact with LRWeb', subtitle: 'The move may still be running.' },
          inlineError(`${errorText(e)} Check again before you start another move.`,
            () => track(latest, { secrets, result }), 'Check again')));
        return;
      }
      if (ui !== mine) return;
      if (final.status === 'done') setPanel(readyCard(final, secrets, result));
      else setPanel(failedCard(final, secrets, failureText(final)));
    }

    function readyCard(job, secrets, result) {
      const mode = state.get('health')?.integrations?.cloudpanel?.mode;
      const explain = mode === 'mock'
        ? ['This is ', Term('simulated', 'practice mode'), ': the file and database copy is pretended, so nothing was copied to a real server.']
        : mode === 'ssh'
          ? 'In the live setup, the website files and database are copied with the step-by-step commands below. Run them in order, then switch visitors over.'
          : ['In the live setup, the file and database copy is done with the commands below. In practice mode (', Term('simulated', 'practice mode'), ') that copy is only pretended.'];
      return Card({},
        h('div', { class: 'mig-done' },
          h('span', { class: 'mig-done__icon' }, icon('check', { size: 34 })),
          h('h2', { class: 'card__title' }, 'Ready to switch'),
          h('p', { class: 'muted' }, `${site.domain} is set up on ${targetName}. Visitors still see the old site until you switch them over.`)),
        h('p', {}, explain),
        secretsBlock(secrets),
        runbookBlock(result?.runbook),
        h('div', { class: 'mig-actions' },
          Button({ variant: 'primary', iconRight: 'arrow-right', onclick: () => ctx.navigate('/traffic') }, 'Switch visitors now'),
          Button({ variant: 'glass', icon: 'globe', onclick: () => ctx.navigate('/sites') }, 'View the new site'),
          Button({ variant: 'ghost', icon: 'plus', onclick: () => { choice = freshChoice(); goTo(SITE); } }, 'Move another site')));
    }

    function failedCard(job, secrets, message) {
      const progress = JobProgress(job);
      progress.querySelector('.job__foot').hidden = true; // the callout carries the message instead
      return Card({ title: 'The move did not finish', subtitle: 'The old site was not changed.' },
        progress,
        inlineError(message, () => startJob((e) => setPanel(failedCard(job, secrets, errorText(e)))), 'Try again'),
        secretsBlock(secrets),
        h('div', { class: 'mig-actions' },
          Button({ variant: 'glass', icon: 'chevron-left', onclick: () => goTo(OPTIONS) }, 'Change the choices')));
    }

    loadPlan();
    return Card({ title: 'Check the plan', subtitle: 'Read this first. Nothing changes until you press Start the move.' },
      body,
      errBox,
      h('div', { class: 'spread' },
        Button({ variant: 'glass', icon: 'chevron-left', onclick: () => goTo(OPTIONS) }, 'Back'),
        startBtn));
  }
}
