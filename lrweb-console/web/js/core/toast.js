import { h } from './dom.js';
import { icon } from '../ui/icons.js';

const ICONS = { ok: 'check', warn: 'alert', bad: 'alert', info: 'info' };

export function toast({ title, message = '', kind = 'info', timeout = 4800 } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = h('div', { class: ['toast glass glass--thick', `toast--${kind}`], role: kind === 'bad' ? 'alert' : 'status' },
    h('span', { class: 'toast__icon' }, icon(ICONS[kind] || 'info', { size: 18 })),
    h('div', { class: 'toast__body' }, h('strong', {}, title), message && h('p', {}, message)),
    h('button', { class: 'icon-btn', 'aria-label': 'Dismiss', onclick: () => dismiss() }, icon('x', { size: 16 })));
  let timer;
  function dismiss() {
    clearTimeout(timer);
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 220);
  }
  host.append(el);
  while (host.children.length > 4) host.firstChild.remove();
  if (timeout) timer = setTimeout(dismiss, timeout);
  return dismiss;
}
