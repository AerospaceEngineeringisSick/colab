// Team (#/team): personal sign-ins, roles, and the account activity log.
import { h, ensureCss, uid } from '../core/dom.js';
import { api, setToken } from '../core/api.js';
import { state } from '../core/store.js';
import { ago, date } from '../core/fmt.js';
import { toast } from '../core/toast.js';
import { Term } from '../ui/glossary.js';
import { PageHeader, Card, Button, Badge, Avatar, Field, Input, Select, Table, Empty, ErrorState, Skeleton, CopyBlock, Confirm, Modal, setLoading } from '../ui/components.js';
import { icon } from '../ui/icons.js';

const USERNAME_RE = /^[a-z][a-z0-9._-]{2,31}$/;
const USERNAME_HINT = '3 to 32 lower-case letters, numbers, dots, dashes or underscores. Start with a letter.';
const MIN_PW = 12;
const MAX_PW = 128;
const NAME_MAX = 80;
const WHEN = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };

const ROLES = {
  owner: { label: 'Owner', kind: 'ok', text: 'Everything, including adding admins.' },
  admin: { label: 'Admin', kind: 'info', text: 'Manages servers, sites, clients and billing, and people.' },
  member: { label: 'Member', kind: 'neutral', text: 'Can look around and use secure chat, but not change anything.' },
};

// Audit actions, in plain English. Targets and actors are usernames.
const EVENTS = {
  'owner.setup': 'Created the first sign-in',
  'login.success': 'Signed in',
  'login.failed': 'Failed to sign in',
  'login.locked': 'Locked out after too many wrong passwords',
  logout: 'Signed out',
  'user.created': 'Added a person',
  'user.removed': 'Removed a person',
  'password.changed': 'Changed their password',
  'password.failed': 'Entered the wrong current password',
  'password.reset': 'Reset a password',
};
const SYSTEM_ACTORS = {
  'admin-token': 'Admin token',
  local: 'Local operator',
  system: 'The system',
  unknown: 'Unknown',
};

const isAbort = (e) => e?.name === 'AbortError';
const canManage = (role) => role === 'owner' || role === 'admin';
const roleOf = (role) => ROLES[role] || ROLES.member;
const roleBadge = (role) => Badge({ kind: roleOf(role).kind }, roleOf(role).label);
const when = (iso) => h('time', { datetime: iso, title: date(iso, WHEN) }, ago(iso));
const iconAction = (name, label, onclick, danger = false) =>
  h('button', { type: 'button', class: ['icon-btn', danger && 'icon-btn--danger'], 'aria-label': label, title: label, onclick },
    icon(name, { size: 18 }));

export default async function mount(root, ctx) {
  await ensureCss('css/view-team.css');
  const body = h('div', { class: 'stack team' });
  root.append(body);
  await fill(body, () => start(ctx), (s) => (s.accounts ? accountsPage(s, ctx) : setupPage(ctx)));
}

async function start(ctx) {
  const health = await api.get('/api/health', { signal: ctx.signal });
  if (!health.accounts?.enabled) return { accounts: false };
  const cached = state.get('me');
  if (cached) return { accounts: true, me: cached };
  const { user, mode } = await api.get('/api/auth/me', { signal: ctx.signal });
  return { accounts: true, me: { ...(user || {}), mode } };
}

/* ---------- loading and errors ---------- */

/** Fills el with render(await load()). Sign-in and permission problems get plain-English empty states. */
async function fill(el, load, render) {
  el.replaceChildren(Skeleton({ lines: 3 }));
  try {
    el.replaceChildren(...[].concat(render(await load())).filter(Boolean));
  } catch (e) {
    if (!isAbort(e)) el.replaceChildren(failure(e, () => fill(el, load, render)));
  }
}

function failure(e, retry) {
  if (e?.code === 'password_change_required') {
    return Empty({ icon: 'lock', title: 'Choose your own password first', message: 'The team list appears here once your password is set.' });
  }
  if (e?.status === 401) {
    return Empty({ icon: 'lock', title: 'You need to sign in again', message: 'Your session has ended. Sign in again to carry on.' });
  }
  if (e?.status === 403) {
    return Empty({ icon: 'shield', title: 'Only owners and admins can do this', message: 'Ask an owner or admin if you need a change made.' });
  }
  return ErrorState(e, retry);
}

/* ---------- form helpers ---------- */

// Adds aria wiring to a Field so screen readers hear the inline error on the input itself.
function bindField(el, input) {
  const setError = el.setError;
  el.setError = (msg) => {
    setError(msg);
    input.setAttribute('aria-invalid', String(Boolean(msg)));
    if (msg) input.setAttribute('aria-describedby', `${input.id}-err`);
    else input.removeAttribute('aria-describedby');
  };
  // Typing clears the old complaint, so a corrected field stops looking wrong.
  input.addEventListener('input', () => { if (el.classList.contains('has-error')) el.setError(''); });
  return { el, input };
}

function textField({ label, hint, ...props }) {
  const input = Input({ id: uid('team'), required: true, ...props });
  return bindField(Field({ label, hint, for: input.id, required: true }, input), input);
}

function passwordField({ label, hint, autocomplete, onInput }) {
  const input = h('input', {
    class: 'input', type: 'password', id: uid('pw'), autocomplete, required: true, maxlength: MAX_PW,
    spellcheck: 'false', autocapitalize: 'none', oninput: () => onInput?.(input.value),
  });
  const toggle = h('button', {
    type: 'button', class: 'btn btn--ghost btn--sm pw__toggle', 'aria-controls': input.id, 'aria-label': 'Show password',
    onclick: () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'Hide' : 'Show';
      toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    },
  }, 'Show');
  const wrap = h('div', { class: 'pw' }, input, toggle);
  return bindField(Field({ label, hint, for: input.id, required: true }, wrap), input);
}

function FormNote() {
  const text = h('p', {});
  const el = h('div', { class: 'callout callout--bad', role: 'alert', hidden: true }, icon('alert', { size: 18 }), text);
  return {
    el,
    show(msg) { text.textContent = msg; el.hidden = false; },
    clear() { text.textContent = ''; el.hidden = true; },
  };
}

/** Shows each { el, input, msg } problem inline and focuses the first. True when every check passes. */
function check(rules) {
  let first = null;
  for (const { el, input, msg } of rules) {
    el.setError(msg);
    if (msg && !first) first = input;
  }
  first?.focus();
  return !first;
}

/** Puts a server error on its field when it names one, otherwise in the form note. Always toasts. */
function showError(err, fields, note, title = 'Not saved') {
  const field = fields[err?.field];
  if (field) field.setError(err.message);
  else note?.show(err?.message || 'Something went wrong. Try again.');
  toast({ title, message: err?.message || '', kind: 'bad' });
}

// Says which part of the username rule is broken. The field hint already states the full rule.
function usernameProblem(u) {
  if (!u) return 'Enter a username.';
  if (u.length < 3) return 'Use at least 3 characters.';
  if (u.length > 32) return 'Use 32 characters or fewer.';
  if (!USERNAME_RE.test(u)) return 'Start with a letter, then use lower-case letters, numbers, dots, dashes or underscores.';
  return '';
}

const newProblem = (pw) => {
  if (pw.length < MIN_PW) return `Use ${MIN_PW} or more characters.`;
  if (pw.length > MAX_PW) return `Use ${MAX_PW} characters or fewer.`;
  return '';
};

// Advisory only: the server enforces the length rule. Level runs from 1 (weak) to 4 (strong).
function strengthOf(pw) {
  if (!pw) return null;
  if (pw.length < MIN_PW) return { level: 1, text: 'Too short. Needs 12 or more characters.' };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  const level = Math.min(4, 1 + (pw.length >= 16 ? 1 : 0) + (classes >= 2 ? 1 : 0) + (classes >= 3 || pw.length >= 20 ? 1 : 0));
  return { level, text: `Strength: ${['Weak', 'Fair', 'Good', 'Strong'][level - 1]}` };
}

function StrengthMeter() {
  const bars = [0, 1, 2, 3].map(() => h('i'));
  const text = h('p', { class: 'pw-meter__text', 'aria-live': 'polite' });
  const el = h('div', { class: 'pw-meter' }, h('div', { class: 'pw-meter__bars', 'aria-hidden': 'true' }, bars), text);
  el.update = (pw) => {
    const s = strengthOf(pw);
    el.dataset.level = s ? String(s.level) : '';
    bars.forEach((b, i) => b.classList.toggle('is-on', Boolean(s) && i < s.level));
    text.textContent = s ? s.text : '';
  };
  return el;
}

/* ---------- one-time passwords ---------- */

// The password is shown once. It is never stored, logged or put in a toast.
function oneTimeModal({ title, lead, password, extra, onClose }) {
  const modal = Modal({
    title,
    size: 'sm',
    onClose,
    content: h('div', { class: 'stack team-otp' },
      lead && h('p', {}, lead),
      CopyBlock({ text: password, label: Term('one-time password') }),
      h('div', { class: 'callout callout--warn' }, icon('alert', { size: 18 }),
        h('p', {}, 'Shown once. Give it to them privately. They must choose their own at first sign-in.')),
      extra),
    actions: [Button({ variant: 'primary', icon: 'check', onclick: () => modal.close() }, 'Done')],
  });
  return modal;
}

/* ---------- setup (no personal accounts yet) ---------- */

function setupPage(ctx) {
  const name = textField({ label: 'Your name', placeholder: 'Maya Fernandez', maxlength: NAME_MAX, autocomplete: 'name' });
  const username = textField({
    label: 'Username', hint: USERNAME_HINT, placeholder: 'maya', maxlength: 32, autocomplete: 'username', autocapitalize: 'none',
  });
  const meter = StrengthMeter();
  const password = passwordField({
    label: 'Password', hint: `${MIN_PW} or more characters.`, autocomplete: 'new-password', onInput: (v) => meter.update(v),
  });
  const confirm = passwordField({ label: 'Confirm password', autocomplete: 'new-password' });
  const note = FormNote();
  const submit = Button({ type: 'submit', variant: 'primary', icon: 'key' }, 'Create my sign-in');
  const form = h('form', { class: 'stack team-form', novalidate: true },
    h('div', { class: 'form-grid' }, name.el, username.el),
    password.el,
    meter,
    confirm.el,
    note.el,
    h('div', { class: 'team-form__actions' }, submit));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    note.clear();
    const data = {
      name: name.input.value.trim(),
      username: username.input.value.trim().toLowerCase(),
      password: password.input.value,
    };
    if (!check([
      { el: name.el, input: name.input, msg: data.name ? '' : 'Enter your name.' },
      { el: username.el, input: username.input, msg: usernameProblem(data.username) },
      { el: password.el, input: password.input, msg: newProblem(data.password) },
      { el: confirm.el, input: confirm.input, msg: confirm.input.value === data.password ? '' : 'The two passwords do not match.' },
    ])) return;

    setLoading(submit, true);
    try {
      const { session } = await api.post('/api/auth/setup', data, { signal: ctx.signal });
      setToken(session.token);
      toast({ title: `Welcome, ${data.name}`, message: 'Your sign-in is ready.', kind: 'ok' });
      setTimeout(() => location.reload(), 900);
    } catch (err) {
      setLoading(submit, false);
      if (!isAbort(err)) showError(err, { name: name.el, username: username.el, password: password.el }, note, 'Could not create your sign-in');
    }
  });

  return [
    PageHeader({ title: 'Team', subtitle: 'Set up sign-ins for everyone on the team' }),
    Card({ title: 'Create your own sign-in' },
      h('div', { class: 'stack team-intro' },
        h('p', {}, 'Right now there are no personal sign-ins. Creating yours gives you a private login, and lets each person on the team have their own.'),
        h('p', {}, 'Secure chat and the activity log both need personal sign-ins. Once you create yours, everyone must sign in to use the console.')),
      form),
  ];
}

/* ---------- password form (used by the banner and Your account) ---------- */

function passwordForm(ctx, { currentLabel = 'Current password', onDone } = {}) {
  const current = passwordField({ label: currentLabel, autocomplete: 'current-password' });
  const meter = StrengthMeter();
  const next = passwordField({
    label: 'New password', hint: `${MIN_PW} or more characters. A few random words works well.`,
    autocomplete: 'new-password', onInput: (v) => meter.update(v),
  });
  const confirm = passwordField({ label: 'Confirm new password', autocomplete: 'new-password' });
  const note = FormNote();
  const submit = Button({ type: 'submit', variant: 'primary', icon: 'check' }, 'Change password');
  const form = h('form', { class: 'stack team-form', novalidate: true },
    current.el, next.el, meter, confirm.el, note.el,
    h('div', { class: 'team-form__actions' }, submit));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    note.clear();
    const old = current.input.value;
    const fresh = next.input.value;
    if (!check([
      { el: current.el, input: current.input, msg: old ? '' : 'Enter your current password.' },
      { el: next.el, input: next.input, msg: newProblem(fresh) || (fresh === old ? 'Choose a password that is different from the current one.' : '') },
      { el: confirm.el, input: confirm.input, msg: confirm.input.value === fresh ? '' : 'The two passwords do not match.' },
    ])) return;

    setLoading(submit, true);
    try {
      await api.post('/api/auth/password', { current: old, next: fresh }, { signal: ctx.signal });
      setLoading(submit, false);
      form.reset();
      meter.update('');
      toast({ title: 'Password changed', message: 'Use the new one next time you sign in.', kind: 'ok' });
      onDone?.();
    } catch (err) {
      setLoading(submit, false);
      if (!isAbort(err)) {
        showError(err, { current: current.el, next: next.el, confirm: confirm.el }, note, 'Password not changed');
      }
    }
  });
  return form;
}

/* ---------- signed in ---------- */

function accountsPage({ me: first }, ctx) {
  let me = first;
  const head = (actions) => PageHeader({ title: 'Team', subtitle: 'Who can sign in, and what each person can do', actions });

  if (!me.id) {
    return [head(), Card({ title: 'Sign in with your own account' },
      Empty({ icon: 'user', title: 'This is not a personal sign-in', message: 'Sign in with your own username to see the team and change your password.' }))];
  }

  const manager = canManage(me.role);
  let people = [];
  const fetchTeam = () => api.get('/api/team', { signal: ctx.signal }).then((list) => { people = list; return list; });
  const readAudit = () => api.get('/api/audit', { signal: ctx.signal });

  const peopleBody = h('div');
  const auditBody = h('div');
  const pwSlot = h('div');

  // Names for the activity log: audit rows carry usernames, not ids.
  const nameOf = (ref) => {
    const p = people.find((x) => x.username === ref);
    if (p) return p.name;
    if (SYSTEM_ACTORS[ref]) return SYSTEM_ACTORS[ref];
    return ref ? `@${ref}` : SYSTEM_ACTORS.unknown;
  };

  function teamTable() {
    const owners = people.filter((p) => p.role === 'owner').length;
    const rowActions = (p) => {
      const adminOnOwner = me.role === 'admin' && p.role === 'owner';
      const reset = manager && p.id !== me.id && !adminOnOwner;
      const remove = manager && !adminOnOwner && !(p.role === 'owner' && owners <= 1);
      if (!reset && !remove) return null;
      return h('div', { class: 'team-actions' },
        reset && iconAction('key', `Reset password for ${p.name}`, (e) => resetPassword(p, e.currentTarget)),
        remove && iconAction('trash', `Remove ${p.name}`, (e) => removePerson(p, e.currentTarget), true));
    };
    const columns = [
      {
        label: 'Person', class: 'team-main',
        render: (p) => h('div', { class: 'cell-user' }, Avatar({ name: p.name }),
          h('div', { class: 'team-person' },
            h('span', { class: 'team-person__name' }, h('strong', {}, p.name), p.id === me.id && h('span', { class: 'chip team-you' }, 'You')),
            h('small', {}, `@${p.username}`))),
      },
      { label: 'Role', render: (p) => roleBadge(p.role) },
      { label: 'Last sign-in', render: (p) => (p.lastLoginAt ? when(p.lastLoginAt) : h('span', { class: 'muted' }, 'Not yet')) },
    ];
    if (manager) columns.push({ label: 'Actions', align: 'right', render: rowActions });
    return Table({ columns, rows: people, empty: Empty({ icon: 'users', title: 'No one yet', message: 'Add people from this page.' }) });
  }

  function auditTable(events) {
    const rows = [...events].slice(0, 50);
    return Table({
      rows,
      columns: [
        { label: 'When', render: (ev) => h('time', { datetime: ev.ts }, date(ev.ts, WHEN)) },
        { label: 'Who', render: (ev) => nameOf(ev.actor) },
        {
          label: 'What happened',
          render: (ev) => h('div', { class: 'team-event' },
            h('span', {}, EVENTS[ev.action] || 'Made a change'),
            ev.target && h('small', { class: 'muted' }, nameOf(ev.target))),
        },
      ],
      empty: Empty({ icon: 'clock', title: 'Nothing recorded yet', message: 'Sign-ins and changes to people will show up here.' }),
    });
  }

  async function refreshPeople() {
    try {
      await fetchTeam();
      peopleBody.replaceChildren(teamTable());
    } catch (e) {
      if (!isAbort(e)) toast({ title: 'Could not refresh the list', message: e.message, kind: 'bad' });
    }
  }
  const loadAudit = () => fill(auditBody, readAudit, auditTable);

  // The server refuses the team list and the log until a temporary password has been replaced, so load them after that.
  function loadData() {
    const teamP = fetchTeam();
    teamP.catch(() => {}); // each card reports its own failure
    fill(peopleBody, () => teamP, () => teamTable());
    if (manager) fill(auditBody, async () => { await teamP.catch(() => {}); return readAudit(); }, auditTable);
  }
  const waitingForPassword = () => Empty({
    icon: 'lock', title: 'Choose your own password first', message: 'The team list appears here once your password is set.',
  });

  async function signOut(btn) {
    setLoading(btn, true);
    try {
      await api.post('/api/auth/logout', {}, { signal: ctx.signal });
    } catch (e) {
      if (isAbort(e)) return;
      if (e.status !== 401) {
        setLoading(btn, false);
        toast({ title: 'Could not sign out', message: e.message, kind: 'bad' });
        return;
      }
    }
    setToken('');
    location.reload();
  }

  async function resetPassword(p, btn) {
    const ok = await Confirm({
      title: `Reset ${p.name}'s password?`,
      message: `${p.name} will be signed out everywhere. They get a new temporary password, and the old one stops working straight away.`,
      confirmLabel: 'Reset password',
    });
    if (!ok) return;
    setLoading(btn, true);
    try {
      const { oneTimePassword } = await api.post(`/api/team/${encodeURIComponent(p.id)}/reset-password`, {}, { signal: ctx.signal });
      setLoading(btn, false);
      toast({ title: 'New password ready', message: `Give it to ${p.name} privately.`, kind: 'ok' });
      oneTimeModal({ title: `New temporary password for ${p.name}`, lead: 'Their old password has stopped working.', password: oneTimePassword });
      loadAudit();
    } catch (err) {
      setLoading(btn, false);
      if (!isAbort(err)) toast({ title: 'Could not reset the password', message: err.message, kind: 'bad' });
    }
  }

  async function removePerson(p, btn) {
    const self = p.id === me.id;
    const ok = await Confirm({
      title: self ? 'Remove your own sign-in?' : `Remove ${p.name}?`,
      message: self
        ? 'You will be signed out straight away and will not be able to sign in again. Another owner or admin would need to add you back.'
        : `${p.name} will be signed out and will not be able to sign in until you add them back.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    setLoading(btn, true);
    try {
      await api.del(`/api/team/${encodeURIComponent(p.id)}`, { signal: ctx.signal });
    } catch (err) {
      setLoading(btn, false);
      if (!isAbort(err)) toast({ title: `Could not remove ${p.name}`, message: err.message, kind: 'bad' });
      return;
    }
    toast({ title: `Removed ${p.name}`, kind: 'ok' });
    if (self) {
      setToken('');
      setTimeout(() => location.reload(), 900);
      return;
    }
    refreshPeople();
    loadAudit();
  }

  function addPerson() {
    const name = textField({ label: 'Name', placeholder: 'Maya Fernandez', maxlength: NAME_MAX, autocomplete: 'off' });
    const username = textField({
      label: 'Username', hint: USERNAME_HINT, placeholder: 'maya', maxlength: 32, autocomplete: 'off', autocapitalize: 'none',
    });
    const roleId = uid('role');
    const roleSelect = Select({
      id: roleId,
      options: [
        { value: 'member', label: 'Member' },
        { value: 'admin', label: 'Admin' },
        ...(me.role === 'owner' ? [{ value: 'owner', label: 'Owner' }] : []),
      ],
      value: 'member',
    });
    const roleField = Field({ label: 'Role', hint: ROLES.member.text, for: roleId }, roleSelect);
    roleSelect.addEventListener('change', () => {
      roleField.querySelector('.field__hint').textContent = roleOf(roleSelect.value).text;
    });
    const note = FormNote();
    const formEl = h('form', { class: 'stack team-form', id: uid('add'), novalidate: true },
      h('div', { class: 'form-grid' }, name.el, username.el),
      roleField,
      note.el);
    const submit = Button({ type: 'submit', variant: 'primary', icon: 'plus', form: formEl.id }, 'Add person');
    const modal = Modal({
      title: 'Add a person',
      subtitle: 'They get their own sign-in and a temporary password.',
      content: formEl,
      actions: [Button({ variant: 'ghost', onclick: () => modal.close() }, 'Cancel'), submit],
    });

    formEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      note.clear();
      const data = {
        name: name.input.value.trim(),
        username: username.input.value.trim().toLowerCase(),
        role: roleSelect.value,
      };
      if (!check([
        { el: name.el, input: name.input, msg: data.name ? '' : 'Enter their name.' },
        { el: username.el, input: username.input, msg: usernameProblem(data.username) },
      ])) return;

      setLoading(submit, true);
      try {
        const { oneTimePassword } = await api.post('/api/team', data, { signal: ctx.signal });
        modal.close();
        toast({ title: `Added ${data.name}`, kind: 'ok' });
        oneTimeModal({
          title: `${data.name} can now sign in`,
          lead: `Give ${data.name} their username (@${data.username}) and this temporary password.`,
          password: oneTimePassword,
          extra: h('p', { class: 'team-intro' }, 'To use secure chat, they open Chat and set their own ',
            Term('passphrase', 'vault passphrase'), '.'),
          onClose: () => refreshPeople(),
        });
        loadAudit();
      } catch (err) {
        setLoading(submit, false);
        if (!isAbort(err)) showError(err, { name: name.el, username: username.el, role: roleField }, note, 'Could not add them');
      }
    });
  }

  function showPasswordForm() {
    pwSlot.replaceChildren(me.mustChangePassword
      ? h('p', { class: 'muted' }, 'Choose your new password in the box at the top of this page.')
      : passwordForm(ctx));
  }

  function mustChangeBanner() {
    const titleId = uid('banner');
    const banner = h('section', { class: 'callout callout--warn team-banner', 'aria-labelledby': titleId },
      icon('lock', { size: 22 }),
      h('div', { class: 'team-banner__body' },
        h('h2', { id: titleId }, 'Choose your own password'),
        h('p', {}, 'You signed in with a temporary password. Choose one that only you know, so your account stays private.'),
        passwordForm(ctx, {
          currentLabel: 'Temporary password',
          onDone: () => {
            banner.remove();
            me = { ...me, mustChangePassword: false };
            state.set('me', me);
            showPasswordForm();
            loadData();
          },
        })));
    return banner;
  }

  const addButton = manager ? Button({ variant: 'primary', icon: 'plus', onclick: addPerson }, 'Add a person') : null;
  const peopleCard = Card({
    title: 'People who can sign in', subtitle: 'Each person signs in with their own username and password.', flush: true,
  }, peopleBody);
  const legend = Card({ title: 'What each role can do' },
    h('ul', { class: 'list' }, Object.keys(ROLES).map((k) =>
      h('li', { class: 'list__item team-role' }, roleBadge(k), h('p', {}, roleOf(k).text)))));

  const accountBody = h('div', { class: 'stack' },
    h('dl', { class: 'kv' },
      h('dt', {}, 'Name'), h('dd', {}, me.name),
      h('dt', {}, 'Username'), h('dd', { class: 'mono' }, `@${me.username}`),
      h('dt', {}, 'Role'), h('dd', {}, roleBadge(me.role))),
    h('hr', { class: 'divider' }),
    h('h3', { class: 'team-sub' }, 'Change password'),
    pwSlot,
    h('hr', { class: 'divider' }),
    h('div', { class: 'row' }, Button({ variant: 'glass', icon: 'lock', onclick: (e) => signOut(e.currentTarget) }, 'Sign out')));
  const accountCard = Card({ title: 'Your account' }, accountBody);
  showPasswordForm();

  const nodes = [head(addButton)];
  if (me.mustChangePassword) nodes.push(mustChangeBanner());
  nodes.push(peopleCard, legend, accountCard);

  if (manager) {
    const activityCard = Card({
      title: 'Recent activity on accounts',
      subtitle: 'Sign-ins, people added or removed, and password changes. Newest first.',
      flush: true,
      actions: Button({ variant: 'glass', size: 'sm', icon: 'refresh', onclick: () => loadAudit() }, 'Refresh'),
    }, auditBody);
    nodes.push(activityCard);
  }

  if (me.mustChangePassword) {
    peopleBody.replaceChildren(waitingForPassword());
    auditBody.replaceChildren(waitingForPassword());
  } else {
    loadData();
  }
  return nodes;
}
