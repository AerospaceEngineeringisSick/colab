// LRChat (#/chat): vault setup, the lock screen, and the two-pane chat.
// Built on the client from js/chat/instance.js. Names, previews and message bodies only ever go in as text
// (h() children or textContent): never HTML, never links.
import { h, ensureCss, uid } from '../core/dom.js';
import { api } from '../core/api.js';
import { prefs, state } from '../core/store.js';
import { toast } from '../core/toast.js';
import { date } from '../core/fmt.js';
import { icon } from '../ui/icons.js';
import { Term } from '../ui/glossary.js';
import {
  PageHeader, Card, Button, Empty, Field, Input, Textarea, Modal, Confirm, Switch, Select,
  Avatar, Skeleton, setLoading,
} from '../ui/components.js';
import { getChat } from '../chat/instance.js';
import { checkPassphrase } from '../chat/crypto.js';

const MAX_CHARS = 4000;
const NEAR_CHARS = 3600;
const BOTTOM_PX = 80;
const WIDE = '(min-width: 761px)';
const DEFAULT_LOCK_MS = 5 * 60_000;
const AUTO_LOCK = [1, 5, 15, 30].map((m) => ({ value: String(m * 60_000), label: m === 1 ? '1 minute' : `${m} minutes` }));
const TTL = [
  { value: '0', label: 'Off' },
  { value: '3600', label: '1 hour' },
  { value: '86400', label: '1 day' },
  { value: '604800', label: '7 days' },
];
const TRUST = {
  verified: 'Verified',
  pending: 'Not yet verified',
  changed: 'Identity changed',
  none: 'Has not set up secure chat yet',
};
const ERRORS = {
  network: 'We could not reach the server. Check your connection and try again.',
  rate_limited: 'You are sending too fast. Wait a moment and try again.',
  identity_changed: 'A contact\'s identity has changed. Review it before sending.',
  bad_signature: 'A message failed its security check and was ignored.',
  bad_decrypt: 'One message could not be opened on this device.',
};

const friendly = (e) => ERRORS[e?.code] || 'Something went wrong with secure chat. Please try again.';
const meId = () => state.get('me')?.id;
const wide = () => window.matchMedia(WIDE).matches;
const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`; };
const hhmm = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : clock.format(d); };
const listTime = (iso) => (dayKey(iso) === dayKey(new Date()) ? hhmm(iso) : date(iso, { day: 'numeric', month: 'short' }));
const byTime = (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : (a.n || 0) - (b.n || 0));
const trustOf = (r) => (!r.hasChat ? 'none' : r.identityChanged ? 'changed' : r.verified ? 'verified' : 'pending');
const ttlPref = (peer) => Number(prefs.get(`chatTtl:${peer}`, '0')) || 0;
const lockPref = () => Number(prefs.get('chatAutoLock', '')) || DEFAULT_LOCK_MS;

function dayLabel(iso) {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (dayKey(iso) === dayKey(today)) return 'Today';
  if (dayKey(iso) === dayKey(yesterday)) return 'Yesterday';
  return date(iso, { weekday: 'long', day: 'numeric', month: 'long' });
}

function shield(kind) {
  return h('span', { class: ['chat-shield', `chat-shield--${kind}`], title: TRUST[kind], role: 'img', 'aria-label': TRUST[kind] },
    icon('shield', { size: 18 }));
}

function downloadText(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- mount ---------- */

export default async function mount(root, ctx) {
  await ensureCss('css/view-chat.css');
  root.append(PageHeader({ title: 'Secure chat', subtitle: 'Private messages between team members, scrambled on your device.' }));
  const chat = getChat();
  if (!chat) {
    root.append(Card({}, Empty({
      icon: 'lock', title: 'Secure chat needs your own sign-in',
      message: 'Chat keys belong to a personal account, so sign in as yourself to use it.',
      action: Button({ variant: 'primary', icon: 'users', onclick: () => ctx.navigate('/team') }, 'Go to Team'),
    })));
    return undefined;
  }

  const screen = h('div', { class: 'chat-screen' }, Skeleton({ lines: 5 }));
  const live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  root.append(screen, live);

  try {
    await chat.init();
  } catch {
    screen.replaceChildren(Card({}, Empty({
      icon: 'alert', title: 'Secure chat could not start',
      message: 'Reload the page to try again. If this keeps happening, sign out and back in.',
      action: Button({ variant: 'glass', icon: 'refresh', onclick: () => ctx.navigate('/chat') }, 'Try again'),
    })));
    return undefined;
  }

  const V = {
    chat, root, screen, live, ui: null, last: null, modal: null, polling: false,
    rows: [], active: null, mode: 'list', query: '', stick: true, sending: false,
    tabHidden: document.visibilityState === 'hidden',
    listSeq: 0, threadSeq: 0, refreshTimer: 0, toastAt: 0, prevUnread: -1, lastMsgId: null,
    gaps: new Set(), drafts: new Map(), subs: [],
  };
  const handlers = {
    blur: () => setTabHidden(V, true),
    focus: () => setTabHidden(V, false),
    vis: () => setTabHidden(V, document.visibilityState === 'hidden'),
    pointer: (e) => { if (V.ui?.more && !V.ui.more.contains(e.target)) closeMenu(V); },
  };
  window.addEventListener('blur', handlers.blur);
  window.addEventListener('focus', handlers.focus);
  document.addEventListener('visibilitychange', handlers.vis);
  document.addEventListener('pointerdown', handlers.pointer);
  V.subs = [
    chat.on('status', () => paint(V)),
    chat.on('message', () => scheduleRefresh(V)),
    chat.on('conversations', () => scheduleRefresh(V)),
    chat.on('identity-changed', () => scheduleRefresh(V)),
    chat.on('gap', (info) => noteGap(V, info)),
    chat.on('error', (e) => noteError(V, e)),
  ];
  try { chat.setAutoLock(lockPref()); } catch { /* keep the client default */ }

  paint(V);
  return () => teardown(V, handlers);
}

function teardown(V, handlers) {
  V.subs.forEach((off) => off?.());
  window.removeEventListener('blur', handlers.blur);
  window.removeEventListener('focus', handlers.focus);
  document.removeEventListener('visibilitychange', handlers.vis);
  document.removeEventListener('pointerdown', handlers.pointer);
  clearTimeout(V.refreshTimer);
  V.modal?.close();
  V.modal = null;
  if (V.polling) { V.chat.stopPolling(); V.polling = false; }
}

/* ---------- screen switching ---------- */

function paint(V) {
  const status = V.chat.status;
  if (status === V.last) {
    if (status === 'unlocked') refreshAll(V);
    return;
  }
  V.last = status;
  V.modal?.close();
  V.modal = null;
  V.ui = null;
  if (status === 'uninitialized') V.screen.replaceChildren(setupView(V));
  else if (status === 'locked') V.screen.replaceChildren(lockedView(V));
  else V.screen.replaceChildren(unlockedView(V));
  syncPolling(V);
  applyBlur(V);
  if (status === 'unlocked') refreshAll(V);
}

function syncPolling(V) {
  const want = V.chat.status === 'unlocked';
  try {
    if (want && !V.polling) { V.chat.startPolling(); V.polling = true; }
    else if (!want && V.polling) { V.chat.stopPolling(); V.polling = false; }
  } catch {
    noteError(V, { code: 'network' });
  }
}

function setTabHidden(V, hidden) {
  V.tabHidden = hidden;
  applyBlur(V);
  if (!hidden) markActiveRead(V);
}

function applyBlur(V) {
  const on = prefs.get('chatBlur', '1') === '1';
  V.root.classList.toggle('chat-blur', on && V.tabHidden);
}

/* ---------- setup (no vault yet) ---------- */

function setupView(V) {
  const pass = Input({ id: uid('vp'), type: 'password', autocomplete: 'new-password' });
  const again = Input({ id: uid('vc'), type: 'password', autocomplete: 'new-password' });
  const passField = Field({ label: 'Passphrase', required: true }, pass);
  const againField = Field({ label: 'Type it again', required: true }, again);
  const bar = h('i');
  const meter = h('div', { class: 'chat-strength', 'aria-hidden': 'true' }, bar);
  const hint = h('p', { class: 'chat-hint', 'aria-live': 'polite' });
  const rate = () => {
    const v = pass.value;
    const r = v ? checkPassphrase(v) : null;
    const level = !r ? 0 : !r.ok ? 1 : v.length < 16 ? 2 : 3;
    meter.dataset.level = String(level);
    bar.style.width = ['0%', '33%', '66%', '100%'][level];
    hint.textContent = !r ? 'Use at least 12 characters. A few random words works well.'
      : !r.ok ? r.reason
        : level === 2 ? 'Good. A longer passphrase is safer.'
          : 'Strong enough.';
  };
  pass.addEventListener('input', rate);
  rate();

  const agree = h('input', { type: 'checkbox', id: uid('vk') });
  const agreeErr = h('p', { class: 'chat-error', role: 'alert' });
  const btn = Button({ variant: 'primary', size: 'lg', icon: 'shield', type: 'submit' }, 'Create my vault');

  const create = async () => {
    passField.setError('');
    againField.setError('');
    agreeErr.textContent = '';
    const v = pass.value;
    const r = checkPassphrase(v);
    if (!r.ok) { passField.setError(r.reason); pass.focus(); return; }
    if (v !== again.value) { againField.setError('The two passphrases do not match.'); again.focus(); return; }
    if (!agree.checked) { agreeErr.textContent = 'Tick the box to show you understand before you continue.'; agree.focus(); return; }
    setLoading(btn, true);
    try {
      await V.chat.setup(v);
      toast({ title: 'Your private vault is ready', message: 'Keep your passphrase somewhere safe.', kind: 'ok' });
    } catch (e) {
      setLoading(btn, false);
      toast({ title: 'Your vault could not be created', message: friendly(e), kind: 'bad' });
    }
  };

  requestAnimationFrame(() => pass.focus({ preventScroll: true }));
  return Card({ class: 'chat-gate' },
    h('div', { class: 'chat-stack-tight chat-center' },
      h('span', { class: 'chat-lock-mark' }, icon('shield', { size: 28 })),
      h('h2', { class: 'card__title' }, 'Set up your private vault')),
    h('ul', { class: 'chat-gate__list' },
      h('li', {}, icon('lock', { size: 18 }), h('span', {},
        'Your messages are scrambled on your device, so only you and the other person can read them. This is ',
        Term('end-to-end encryption'), '.')),
      h('li', {}, icon('server', { size: 18 }), h('span', {},
        'This server only ever sees scrambled text. It can still see who talks to whom, and when.')),
      h('li', {}, icon('key', { size: 18 }), h('span', {},
        'You choose a secret ', Term('passphrase'), ' that never leaves this device. It cannot be reset.'))),
    h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); create(); } },
      passField, meter, hint, againField,
      h('label', { class: 'chat-check', for: agree.id }, agree,
        h('span', {}, 'I understand that if I forget my passphrase I lose my chat history.')),
      agreeErr,
      btn));
}

/* ---------- locked ---------- */

function lockedView(V) {
  const pass = Input({ id: uid('lp'), type: 'password', autocomplete: 'current-password' });
  const field = Field({ label: 'Passphrase', required: true }, pass);
  const btn = Button({ variant: 'primary', size: 'lg', icon: 'lock', type: 'submit' }, 'Unlock');

  const unlock = async () => {
    field.setError('');
    if (!pass.value) { field.setError('Enter your passphrase.'); pass.focus(); return; }
    setLoading(btn, true);
    try {
      await V.chat.unlock(pass.value);
    } catch (e) {
      setLoading(btn, false);
      if (e?.code === 'bad_decrypt') {
        field.setError('That passphrase did not work. Nothing was unlocked.');
        pass.select();
      } else {
        toast({ title: 'Could not unlock', message: friendly(e), kind: 'bad' });
      }
    }
  };

  requestAnimationFrame(() => pass.focus({ preventScroll: true }));
  return Card({ class: 'chat-gate' },
    h('div', { class: 'chat-stack-tight chat-center' },
      h('span', { class: 'chat-lock-mark' }, icon('lock', { size: 28 })),
      h('h2', { class: 'card__title' }, 'Your chat is locked'),
      h('p', { class: 'muted' }, 'Enter your passphrase to unlock it on this device.')),
    h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); unlock(); } }, field, btn),
    h('div', { class: 'chat-center' },
      h('button', { type: 'button', class: 'chat-link', onclick: () => openImport(V) }, 'Restore from a backup')));
}

function openImport(V) {
  V.modal?.close();
  const file = h('input', { type: 'file', id: uid('bf'), accept: '.json,application/json' });
  const fileField = Field({ label: 'Backup file', hint: 'The file you downloaded from Security details.' }, file);
  const backPass = Input({ id: uid('bp'), type: 'password', autocomplete: 'off' });
  const backField = Field({ label: 'Backup passphrase' }, backPass);
  const newPass = Input({ id: uid('np'), type: 'password', autocomplete: 'new-password' });
  const newField = Field({ label: 'New passphrase for this device', hint: 'Choose a passphrase for this device.' }, newPass);
  const go = Button({ variant: 'primary', icon: 'key' }, 'Restore backup');
  const cancel = Button({ variant: 'ghost', onclick: () => m.close() }, 'Cancel');
  const m = Modal({
    title: 'Restore from a backup', subtitle: 'Only use a backup file you made yourself.', size: 'sm',
    content: h('div', { class: 'stack' }, fileField, backField, newField),
    actions: [cancel, go],
  });
  V.modal = m;

  go.addEventListener('click', async () => {
    fileField.setError('');
    backField.setError('');
    newField.setError('');
    const f = file.files?.[0];
    if (!f) { fileField.setError('Choose the backup file first.'); return; }
    if (f.size > 2_000_000) { fileField.setError('That file is too large to be a chat backup.'); return; }
    if (!backPass.value) { backField.setError('Enter the passphrase you used when you made the backup.'); return; }
    const r = checkPassphrase(newPass.value);
    if (!r.ok) { newField.setError(r.reason); return; }
    setLoading(go, true);
    try {
      const text = await f.text();
      await V.chat.importBackup(text, backPass.value, newPass.value);
      m.close();
      toast({ title: 'Backup restored', message: 'Your chat keys are back on this device.', kind: 'ok' });
    } catch (e) {
      setLoading(go, false);
      if (e?.code === 'bad_decrypt') backField.setError('That backup passphrase did not work. Nothing was changed.');
      else if (e instanceof SyntaxError || ['bad_backup', 'bad_envelope', 'bad_base64'].includes(e?.code)) fileField.setError('That file is not an LRChat backup.');
      else toast({ title: 'Could not restore the backup', message: friendly(e), kind: 'bad' });
    }
  });
  requestAnimationFrame(() => file.focus({ preventScroll: true }));
  return m;
}

/* ---------- unlocked: two panes ---------- */

function unlockedView(V) {
  const search = Input({ id: uid('cq'), type: 'search', placeholder: 'Search people', 'aria-label': 'Search people', value: V.query, autocomplete: 'off' });
  search.addEventListener('input', () => { V.query = search.value.trim().toLowerCase(); renderList(V); });
  const listBody = h('ul', { class: 'chat-contacts' });
  const lockBtn = Button({ variant: 'glass', size: 'sm', icon: 'lock', onclick: () => V.chat.lock() }, 'Lock now');
  const listPane = h('aside', { class: 'glass chat-pane chat-list', 'aria-label': 'People' },
    h('header', { class: 'chat-pane__head' }, h('h2', { class: 'chat-pane__title' }, 'People'), lockBtn),
    h('div', { class: 'chat-search' }, search),
    h('div', { class: 'chat-pane__body' }, listBody));

  // Thread header
  const back = h('button', { type: 'button', class: 'icon-btn chat-back', 'aria-label': 'Back to people', onclick: () => showList(V) },
    icon('chevron-left', { size: 20 }));
  const avatarSlot = h('span', { class: 'chat-thread__avatar' });
  const nameEl = h('span', { class: 'chat-thread__name' });
  const statusEl = h('span', { class: 'chat-thread__status' });
  const verifyBtn = Button({ variant: 'glass', size: 'sm', icon: 'shield', onclick: () => openVerify(V) }, 'Verify');
  const ttlSel = Select({ options: TTL, value: '0', 'aria-label': 'Disappearing messages for messages you send', onchange: (e) => setTtl(V, e.target.value) });
  const ttlWrap = h('label', { class: 'chat-ttl' }, h('span', { class: 'chat-hint', 'aria-hidden': 'true' }, 'Disappearing'), ttlSel);
  const menu = h('div', { class: 'glass glass--thick chat-menu', role: 'menu', hidden: true },
    h('button', { type: 'button', role: 'menuitem', class: 'chat-menu__item', onclick: () => { closeMenu(V); openSecurity(V); } },
      icon('shield', { size: 16 }), 'Security details'));
  const moreBtn = Button({
    variant: 'ghost', size: 'sm', icon: 'settings', 'aria-haspopup': 'true', 'aria-expanded': 'false',
    onclick: (e) => { e.stopPropagation(); toggleMenu(V); },
  }, 'More');
  const more = h('div', { class: 'chat-more', onkeydown: (e) => { if (e.key === 'Escape') { closeMenu(V); moreBtn.focus(); } } }, moreBtn, menu);
  const head = h('header', { class: 'chat-pane__head chat-thread__head' },
    back, avatarSlot,
    h('div', { class: 'chat-thread__who' }, nameEl, statusEl),
    h('div', { class: 'chat-thread__tools' }, verifyBtn, ttlWrap, more));

  // Messages
  const banner = h('div', { class: 'chat-banner-slot' });
  const messages = h('div', { class: 'chat-messages', 'aria-label': 'Messages' });
  const scroller = h('div', { class: 'chat-pane__body chat-scroller', onscroll: () => onScroll(V) }, messages);
  const jump = Button({ variant: 'glass', size: 'sm', class: 'chat-jump', icon: 'arrow-right', hidden: true, onclick: () => toBottom(V) }, 'New messages');

  // Composer
  const input = Textarea({ rows: 1, id: uid('cm'), 'aria-label': 'Write a message', placeholder: 'Write a message' });
  const send = Button({ variant: 'primary', icon: 'arrow-right', type: 'submit' }, 'Send');
  const reason = h('span', { class: 'chat-composer__reason', role: 'status' });
  const counter = h('span', { class: 'chat-composer__count', 'aria-live': 'off' });
  const composer = h('form', { class: 'chat-composer', novalidate: true, onsubmit: (e) => { e.preventDefault(); sendNow(V); } },
    h('div', { class: 'chat-composer__row' }, input, send),
    h('div', { class: 'chat-composer__meta' }, reason, counter));
  input.addEventListener('input', () => { autosize(input); updateComposer(V); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendNow(V); }
  });

  const emptyThread = h('div', { class: 'chat-empty-thread' },
    Empty({ icon: 'users', title: 'Choose someone to chat with', message: 'Pick a name on the left. Messages are scrambled on this device before they leave it.' }));
  const realThread = h('div', { class: 'chat-real' }, head, banner, scroller, jump, composer);
  const threadPane = h('section', { class: 'glass chat-pane chat-thread', 'aria-label': 'Conversation' }, emptyThread, realThread);
  const shell = h('div', { class: 'chat-shell', 'data-mode': V.mode }, listPane, threadPane);

  V.ui = {
    shell, listBody, search, head, back, avatarSlot, nameEl, statusEl, verifyBtn, ttlSel,
    more, moreBtn, menu, banner, scroller, messages, jump, input, send, reason, counter, composer,
    emptyThread, realThread,
  };
  syncShell(V);
  updateComposer(V);
  return shell;
}

function syncShell(V) {
  const ui = V.ui;
  if (!ui) return;
  ui.shell.dataset.mode = V.mode;
  const has = Boolean(V.active);
  ui.emptyThread.hidden = has;
  ui.realThread.hidden = !has;
}

function showList(V) {
  V.mode = 'list';
  syncShell(V);
  (V.ui?.listBody.querySelector('[aria-current="true"]') || V.ui?.search)?.focus({ preventScroll: true });
}

function openThread(V, peerId) {
  if (!V.ui) return;
  if (V.active && V.active !== peerId) V.drafts.set(V.active, V.ui.input.value);
  V.active = peerId;
  V.mode = 'thread';
  V.stick = true;
  V.lastMsgId = null;
  V.ui.input.value = V.drafts.get(peerId) || '';
  autosize(V.ui.input);
  syncShell(V);
  renderList(V);
  refreshThread(V, { jump: true });
  if (wide()) V.ui.input.focus({ preventScroll: true });
}

/* ---------- data: people and conversations ---------- */

function buildRows(contacts, convs, me) {
  const byPeer = new Map();
  for (const c of convs) {
    const others = (c.peerIds || []).filter((id) => id !== me);
    if (others.length === 1) byPeer.set(others[0], c);
  }
  const rows = contacts
    .filter((c) => c.userId !== me)
    .map((c) => ({
      peerId: c.userId,
      name: c.name || c.username || 'Team member',
      username: c.username || '',
      hasChat: Boolean(c.hasChat),
      verified: Boolean(c.verified),
      identityChanged: Boolean(c.identityChanged),
      conv: byPeer.get(c.userId) || null,
      gone: false,
    }));
  for (const [peerId, conv] of byPeer) {
    if (!rows.some((r) => r.peerId === peerId)) {
      rows.push({ peerId, name: conv.title || 'Former team member', username: '', hasChat: false, verified: false, identityChanged: false, conv, gone: true });
    }
  }
  const stamp = (r) => (r.conv?.lastMessage?.ts || '');
  return rows.sort((a, b) => (stamp(a) < stamp(b) ? 1 : stamp(a) > stamp(b) ? -1 : a.name.localeCompare(b.name)));
}

const activeRow = (V) => V.rows.find((r) => r.peerId === V.active) || null;

async function refreshList(V) {
  const mine = ++V.listSeq;
  let contacts;
  let convs;
  try {
    [contacts, convs] = await Promise.all([V.chat.contacts(), V.chat.conversations()]);
  } catch (e) {
    if (mine === V.listSeq) noteError(V, e);
    return;
  }
  if (mine !== V.listSeq || !V.ui || V.chat.status !== 'unlocked') return;
  V.rows = buildRows(contacts || [], convs || [], meId());
  const unread = V.rows.reduce((n, r) => n + (r.conv?.unread || 0), 0);
  if (V.prevUnread >= 0 && unread > V.prevUnread) {
    announce(V, unread === 1 ? 'You have 1 unread message.' : `You have ${unread} unread messages.`);
  }
  V.prevUnread = unread;
  renderList(V);
  if (V.active) {
    syncThreadHeader(V);
    if (!activeRow(V)) { V.active = null; syncShell(V); }
  }
}

function renderList(V) {
  const ui = V.ui;
  if (!ui) return;
  const q = V.query;
  const rows = V.rows.filter((r) => !q || r.name.toLowerCase().includes(q) || r.username.toLowerCase().includes(q));
  const items = rows.map((r) => contactItem(V, r));
  if (!rows.length) {
    items.push(h('li', { class: 'chat-empty-list' }, V.rows.length ? 'No one matches that search.' : 'No one else is on the team yet.'));
  }
  ui.listBody.replaceChildren(...items);
}

function contactItem(V, r) {
  const kind = trustOf(r);
  const last = r.conv?.lastMessage;
  const unread = r.conv?.unread || 0;
  const mine = last && last.from === meId();
  const preview = !r.hasChat && !r.gone ? TRUST.none
    : r.gone ? 'No longer on the team'
      : last ? `${mine ? 'You: ' : ''}${last.preview || 'Message'}`
        : 'No messages yet';
  const active = V.active === r.peerId;
  return h('li', {},
    h('button', {
      type: 'button', class: 'chat-contact', 'aria-current': active ? 'true' : null,
      onclick: () => openThread(V, r.peerId),
    },
    Avatar({ name: r.name, size: 40 }),
    h('span', { class: 'chat-contact__main' },
      h('span', { class: 'chat-contact__name' }, shield(kind), h('span', {}, r.name)),
      h('span', { class: 'chat-contact__preview' }, preview)),
    h('span', { class: 'chat-contact__meta' },
      last ? h('span', { class: 'chat-contact__time' }, listTime(last.ts)) : null,
      unread ? h('span', { class: 'chat-unread', 'aria-label': `${unread} unread` }, unread > 99 ? '99+' : String(unread)) : null)));
}

function scheduleRefresh(V) {
  clearTimeout(V.refreshTimer);
  V.refreshTimer = setTimeout(() => {
    if (V.chat.status === 'unlocked' && V.ui) refreshAll(V);
  }, 120);
}

function refreshAll(V) {
  return refreshList(V).then(() => refreshThread(V));
}

/* ---------- data: the open thread ---------- */

async function refreshThread(V, { jump = false } = {}) {
  if (!V.ui) return;
  if (!V.active) { syncShell(V); return; }
  const peer = V.active;
  const mine = ++V.threadSeq;
  const row = activeRow(V);
  if (!row) { syncShell(V); return; }
  let msgs = [];
  if (row.conv) {
    try {
      msgs = await V.chat.messages(row.conv.convId, { limit: 200 });
    } catch (e) {
      if (mine === V.threadSeq) noteError(V, e);
      return;
    }
  }
  if (mine !== V.threadSeq || V.active !== peer || !V.ui) return;
  syncShell(V);
  syncThreadHeader(V, row);
  renderMessages(V, row, msgs, jump);
  markActiveRead(V);
}

function syncThreadHeader(V, row = activeRow(V)) {
  const ui = V.ui;
  if (!ui || !row) return;
  const kind = trustOf(row);
  ui.avatarSlot.replaceChildren(Avatar({ name: row.name, size: 38 }));
  ui.nameEl.textContent = row.name;
  ui.statusEl.replaceChildren(shield(kind), h('span', {}, row.gone ? 'No longer on the team' : TRUST[kind]));
  ui.verifyBtn.disabled = !row.hasChat;
  ui.ttlSel.value = String(ttlPref(row.peerId));
  renderBanner(V, row);
  updateComposer(V);
}

function renderBanner(V, row) {
  const slot = V.ui.banner;
  if (!row.identityChanged) { slot.replaceChildren(); return; }
  slot.replaceChildren(h('div', { class: 'callout callout--bad chat-banner' },
    icon('alert', { size: 18 }),
    h('div', {},
      h('strong', {}, `${row.name}'s secure identity has changed`),
      h('p', {}, 'This can happen when they sign in on a new device. It can also mean someone is interfering. Check the safety number with them before you trust new messages.'),
      h('div', { class: 'row chat-banner__actions' },
        Button({ variant: 'glass', size: 'sm', icon: 'shield', onclick: () => openVerify(V, row) }, 'Review safety number'),
        Button({ variant: 'primary', size: 'sm', icon: 'check', onclick: () => acceptChange(V, row) }, 'Accept the new key')))));
}

function renderMessages(V, row, msgs, jump) {
  const ui = V.ui;
  const me = meId();
  const sc = ui.scroller;
  const wasNear = nearBottom(sc);
  const sorted = msgs.slice().sort(byTime);
  const nodes = [];
  let day = '';
  for (const m of sorted) {
    const dk = dayKey(m.ts);
    if (dk !== day) { nodes.push(h('div', { class: 'chat-day' }, dayLabel(m.ts))); day = dk; }
    nodes.push(bubble(m, me));
  }
  if (!sorted.length) nodes.push(h('p', { class: 'chat-empty-list' }, `No messages yet. Say hello to ${row.name}.`));
  if (row.conv && gapOpen(V, row.conv)) nodes.push(gapNotice(V, row.conv));
  ui.messages.replaceChildren(...nodes);

  const last = sorted[sorted.length - 1];
  const newIncoming = Boolean(last) && V.lastMsgId !== null && last.id !== V.lastMsgId && last.from !== me;
  if (newIncoming) announce(V, `New message from ${row.name}`);
  V.lastMsgId = last ? last.id : null;

  const sentByMe = Boolean(last) && last.from === me;
  if (jump || V.stick || wasNear || sentByMe) toBottom(V);
  else if (newIncoming) ui.jump.hidden = false;
}

function bubble(m, me) {
  const mine = m.from === me;
  const side = mine ? 'chat-bubble--mine' : 'chat-bubble--theirs';
  const time = h('time', { class: 'chat-bubble__time', datetime: m.ts }, hhmm(m.ts));
  if (m.status === 'expired') {
    return h('div', { class: ['chat-bubble', side, 'chat-bubble--expired'] },
      h('span', { class: 'chat-bubble__text' }, 'This message has disappeared'), time);
  }
  return h('div', { class: ['chat-bubble', side] }, h('span', { class: 'chat-bubble__text' }, m.body), time);
}

function gapOpen(V, conv) {
  return V.gaps.has('*') || V.gaps.has(conv.convId);
}

function gapNotice(V, conv) {
  return h('div', { class: 'chat-notice', role: 'status' }, 'One or more messages may be missing. ',
    h('button', {
      type: 'button', class: 'chat-link',
      onclick: () => { V.gaps.delete(conv.convId); V.gaps.delete('*'); refreshThread(V); },
    }, 'Dismiss'));
}

function noteGap(V, info) {
  V.gaps.add(info?.convId || '*');
  if (V.active) refreshThread(V);
}

function nearBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_PX;
}

function onScroll(V) {
  const sc = V.ui?.scroller;
  if (!sc) return;
  V.stick = nearBottom(sc);
  if (V.stick && V.ui.jump) V.ui.jump.hidden = true;
}

function toBottom(V) {
  const sc = V.ui?.scroller;
  if (!sc) return;
  sc.scrollTop = sc.scrollHeight;
  if (V.ui.jump) V.ui.jump.hidden = true;
  V.stick = true;
}

function announce(V, text) {
  V.live.textContent = '';
  requestAnimationFrame(() => { V.live.textContent = text; });
}

function markActiveRead(V) {
  const row = activeRow(V);
  if (!row?.conv?.unread || V.tabHidden || !V.ui) return;
  if (V.mode !== 'thread' && !wide()) return;
  V.chat.markRead(row.conv.convId).then(() => refreshList(V)).catch(() => { /* the next poll retries */ });
}

/* ---------- errors and notices ---------- */

function noteError(V, e) {
  const now = Date.now();
  if (now - V.toastAt < 4000) return;
  V.toastAt = now;
  toast({ title: 'Secure chat', message: friendly(e), kind: 'warn' });
}

/* ---------- composer ---------- */

function blockReason(row) {
  if (!row) return 'Choose someone to chat with first.';
  if (row.gone) return 'This person is no longer on the team, so you cannot send them messages.';
  if (!row.hasChat) return `${row.name} has not set up secure chat yet, so you cannot send them messages yet.`;
  if (row.identityChanged) return `${row.name}'s identity has changed. Review it and accept the new key before you send.`;
  return '';
}

function autosize(el) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

function updateComposer(V) {
  const ui = V.ui;
  if (!ui) return;
  const row = activeRow(V);
  const len = ui.input.value.length;
  const block = blockReason(row);
  const over = len > MAX_CHARS;
  const near = len >= NEAR_CHARS && !over;
  ui.counter.textContent = len >= NEAR_CHARS ? `${len} of ${MAX_CHARS}` : '';
  ui.counter.classList.toggle('is-near', near);
  ui.counter.classList.toggle('is-over', over);
  ui.reason.textContent = block || (over ? `Too long. Shorten it to ${MAX_CHARS} characters.` : '');
  ui.send.disabled = Boolean(block) || over || V.sending || !ui.input.value.trim();
}

async function sendNow(V) {
  const ui = V.ui;
  const row = activeRow(V);
  if (!ui || !row || V.sending) return;
  const text = ui.input.value.trim();
  if (!text || blockReason(row) || text.length > MAX_CHARS) { updateComposer(V); return; }
  V.sending = true;
  setLoading(ui.send, true);
  try {
    await V.chat.send([row.peerId], text, { ttl: ttlPref(row.peerId) });
    V.drafts.delete(row.peerId);
    if (V.ui === ui) { ui.input.value = ''; autosize(ui.input); }
    V.stick = true;
    await refreshList(V);
    await refreshThread(V, { jump: true });
  } catch (e) {
    toast({ title: 'Message not sent', message: friendly(e), kind: 'bad' });
  } finally {
    V.sending = false;
    if (V.ui === ui) { setLoading(ui.send, false); updateComposer(V); }
  }
}

function setTtl(V, value) {
  const row = activeRow(V);
  if (!row) return;
  prefs.set(`chatTtl:${row.peerId}`, value);
}

function toggleMenu(V) {
  const ui = V.ui;
  if (!ui) return;
  const open = ui.menu.hidden;
  ui.menu.hidden = !open;
  ui.moreBtn.setAttribute('aria-expanded', String(open));
}

function closeMenu(V) {
  if (!V.ui) return;
  V.ui.menu.hidden = true;
  V.ui.moreBtn.setAttribute('aria-expanded', 'false');
}

/* ---------- security dialogs ---------- */

async function openVerify(V, row = activeRow(V)) {
  if (!row || !row.hasChat) return;
  closeMenu(V);
  V.modal?.close();
  const body = h('div', { class: 'stack' }, Skeleton({ lines: 3 }));
  const go = Button({ variant: 'primary', icon: 'check', disabled: true }, 'They match');
  const m = Modal({
    title: `Verify ${row.name}`, subtitle: 'Check that you are both looking at the same numbers.', size: 'md', content: body,
    actions: [Button({ variant: 'glass', onclick: () => m.close() }, 'Not now'), go],
  });
  V.modal = m;

  go.addEventListener('click', async () => {
    setLoading(go, true);
    try {
      await V.chat.verify(row.peerId);
      m.close();
      toast({ title: 'Verified', message: `${row.name} is verified.`, kind: 'ok' });
      refreshAll(V);
    } catch (e) {
      setLoading(go, false);
      toast({ title: 'Could not save that', message: friendly(e), kind: 'bad' });
    }
  });

  try {
    const s = await V.chat.safety(row.peerId);
    if (V.modal !== m) return;
    const groups = String(s.number || '').trim().split(/\s+/).filter(Boolean);
    if (groups.length !== 12) throw new Error('unexpected safety number');
    body.replaceChildren(
      h('p', {}, 'Call or meet ', row.name, ' and read the numbers out loud. If they match, nobody is listening in.'),
      h('p', { class: 'muted' }, 'These numbers are your ', Term('safety number'),
        '. Both of your keys go into them, so they only match when you are both looking at the same keys.'),
      h('ol', { class: 'chat-numbers', 'aria-label': `Safety number for ${row.name}` }, groups.map((g) => h('li', {}, g))),
      s.verified ? h('p', { class: 'muted' }, 'You have already confirmed this number.') : null);
    go.disabled = false;
  } catch {
    if (V.modal === m) body.replaceChildren(h('p', { class: 'chat-error' }, 'The safety number could not be loaded. Close this and try again.'));
  }
}

async function acceptChange(V, row) {
  const yes = await Confirm({
    title: `Accept ${row.name}'s new key?`,
    message: 'Only accept this after you have checked the new safety number with them by phone or in person. Future messages will then be trusted with the new key.',
    confirmLabel: 'Accept the new key',
  });
  if (!yes) return;
  try {
    await V.chat.acceptIdentityChange(row.peerId);
    toast({ title: 'New key accepted', message: row.name, kind: 'ok' });
    refreshAll(V);
  } catch (e) {
    toast({ title: 'Could not accept the new key', message: friendly(e), kind: 'bad' });
  }
}

function currentLockMs() { return lockPref(); }

function openSecurity(V) {
  V.modal?.close();
  const row = activeRow(V) || V.rows.find((r) => r.hasChat && !r.gone) || null;
  let fingerprint = '';
  const fpSlot = h('div', { class: 'chat-fp', 'aria-live': 'polite' },
    row ? 'Loading your fingerprint...' : 'Set up chat with someone on the team to see your fingerprint.');
  const copy = Button({ variant: 'glass', size: 'sm', icon: 'copy', disabled: true }, 'Copy');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(fingerprint);
      copy.querySelector('.btn__label').textContent = 'Copied';
      setTimeout(() => { copy.querySelector('.btn__label').textContent = 'Copy'; }, 1600);
    } catch {
      toast({ title: 'Could not copy', message: 'Select the text and copy it yourself.', kind: 'info' });
    }
  });

  const lockSel = Select({
    options: AUTO_LOCK, value: String(currentLockMs()), 'aria-label': 'Lock automatically after',
    onchange: (e) => {
      const ms = Number(e.target.value);
      prefs.set('chatAutoLock', String(ms));
      try { V.chat.setAutoLock(ms); } catch { /* the client keeps its previous timer */ }
    },
  });
  const blur = Switch({
    checked: prefs.get('chatBlur', '1') === '1', label: 'Blur messages when this tab is not focused',
    onchange: (e) => { prefs.set('chatBlur', e.target.checked ? '1' : '0'); applyBlur(V); },
  });

  const backupBtn = Button({ variant: 'glass', icon: 'database', onclick: () => { m.close(); openBackup(V); } }, 'Download encrypted backup');
  const deleteBtn = Button({ variant: 'danger', icon: 'trash', onclick: () => { m.close(); wipeFlow(V); } }, 'Delete my chat data on this device');

  const content = h('div', { class: 'stack' },
    h('section', { class: 'chat-section' },
      h('h3', {}, 'What is protected'),
      h('ul', { class: 'chat-gate__list' },
        h('li', {}, icon('check', { size: 18 }), h('span', {}, 'Message text is scrambled on this device. Only you and the person you chat with can read it.')),
        h('li', {}, icon('shield', { size: 18 }), h('span', {}, 'This server cannot read your messages. It only stores scrambled text.')),
        h('li', {}, icon('info', { size: 18 }), h('span', {}, 'The server can still see who talks to whom, and when. It can also see when keys are replaced.')),
        h('li', {}, icon('key', { size: 18 }), h('span', {}, 'Your passphrase never leaves this device and cannot be reset.')),
        h('li', {}, icon('clock', { size: 18 }), h('span', {}, 'Disappearing messages stop showing after the time you choose. A copy someone already saved or photographed is not affected.')),
        h('li', {}, icon('alert', { size: 18 }), h('span', {}, 'This does not help if someone can run code in your unlocked browser, or if this device is compromised. Lock the chat when you step away.')))),
    h('section', { class: 'chat-section' },
      h('h3', {}, 'Your fingerprint'),
      h('p', { class: 'muted' }, 'This identifies your keys. It is not secret, but you do not need to share it unless someone asks.'),
      fpSlot,
      h('div', { class: 'row' }, copy)),
    h('section', { class: 'chat-section' },
      h('h3', {}, 'Keys'),
      h('p', { class: 'muted' }, 'Your ', Term('key rotation'), ' happens automatically about every 3 days, and the old keys are then deleted.')),
    h('section', { class: 'chat-section' },
      h('h3', {}, 'Locking'),
      Field({ label: 'Lock automatically after', hint: 'The chat locks when you have not used it for this long.' }, lockSel),
      blur),
    h('section', { class: 'chat-section' },
      h('h3', {}, 'Back up your keys'),
      h('p', { class: 'muted' }, 'Make an encrypted backup and store the file offline. You will need its passphrase to use it.'),
      h('div', { class: 'row' }, backupBtn)),
    h('section', { class: 'chat-section' },
      h('h3', { class: 'chat-danger' }, 'Delete chat data'),
      h('p', { class: 'muted' }, 'This removes your keys and chat history from this browser. It cannot be undone.'),
      h('div', { class: 'row' }, deleteBtn)));

  const m = Modal({
    title: 'Security details', subtitle: 'How your chat is protected, and what you can change.', size: 'lg',
    content, actions: [Button({ variant: 'glass', onclick: () => m.close() }, 'Done')],
  });
  V.modal = m;

  if (row) {
    V.chat.safety(row.peerId).then((s) => {
      if (V.modal !== m) return;
      fingerprint = String(s.yourFingerprint || '');
      fpSlot.textContent = fingerprint ? (fingerprint.match(/.{1,8}/g) || []).join(' ') : 'Not available yet.';
      copy.disabled = !fingerprint;
    }).catch(() => {
      if (V.modal === m) fpSlot.textContent = 'Your fingerprint could not be loaded. Try again later.';
    });
  }
}

function openBackup(V) {
  V.modal?.close();
  const p1 = Input({ id: uid('k1'), type: 'password', autocomplete: 'new-password' });
  const p2 = Input({ id: uid('k2'), type: 'password', autocomplete: 'new-password' });
  const f1 = Field({ label: 'Backup passphrase', hint: 'Choose a passphrase for this file. You will need it to restore.' }, p1);
  const f2 = Field({ label: 'Type the backup passphrase again' }, p2);
  const go = Button({ variant: 'primary', icon: 'database', type: 'submit' }, 'Download backup');
  const cancel = Button({ variant: 'ghost', onclick: () => m.close() }, 'Cancel');
  const m = Modal({
    title: 'Download encrypted backup', subtitle: 'The file is scrambled with this passphrase. Keep both somewhere safe.', size: 'sm',
    content: h('form', { class: 'stack', novalidate: true, onsubmit: (e) => { e.preventDefault(); go.click(); } },
      f1, f2,
      h('p', { class: 'muted' }, 'Store the file offline. Anyone with the file and this passphrase can restore your chat keys.')),
    actions: [cancel, go],
  });
  V.modal = m;

  go.addEventListener('click', async () => {
    f1.setError('');
    f2.setError('');
    const r = checkPassphrase(p1.value);
    if (!r.ok) { f1.setError(r.reason); return; }
    if (p1.value !== p2.value) { f2.setError('The two passphrases do not match.'); return; }
    setLoading(go, true);
    try {
      const text = await V.chat.exportBackup(p1.value);
      downloadText('lrweb-chat-backup.json', text);
      m.close();
      toast({ title: 'Backup downloaded', message: 'Store the file somewhere safe, offline.', kind: 'ok' });
    } catch (e) {
      setLoading(go, false);
      toast({ title: 'Backup failed', message: friendly(e), kind: 'bad' });
    }
  });
  requestAnimationFrame(() => p1.focus({ preventScroll: true }));
}

async function wipeFlow(V) {
  const yes = await Confirm({
    title: 'Delete my chat data on this device?',
    message: 'This removes your keys and all chat history stored in this browser. This cannot be undone.',
    confirmLabel: 'Delete on this device', danger: true,
  });
  if (!yes) return;
  try {
    await V.chat.wipe();
  } catch (e) {
    toast({ title: 'Could not delete chat data', message: friendly(e), kind: 'bad' });
    return;
  }

  const alsoServer = await Confirm({
    title: 'Also delete copies on the server?',
    message: 'This also removes messages on the server that have not reached this device yet, and your public key from the team directory. Copies on other people\'s devices are not changed.',
    confirmLabel: 'Also delete from server', danger: true,
  });
  if (alsoServer) {
    try {
      await api.del('/api/chat/me');
      toast({ title: 'Deleted from this device and the server', kind: 'ok' });
    } catch (e) {
      toast({ title: 'Deleted from this device only', message: 'The server copy could not be removed. Try again later.', kind: 'warn' });
    }
  } else {
    toast({ title: 'Chat data deleted on this device', kind: 'ok' });
  }
  V.last = null;
  paint(V);
}
