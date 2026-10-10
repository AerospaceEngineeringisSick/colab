// Shared UI components. Every function returns a real DOM node built with h().
import { h, uid, clear } from '../core/dom.js';
import { icon } from './icons.js';
import { initials } from '../core/fmt.js';
import { toast } from '../core/toast.js';

/* ---------- layout ---------- */

/** PageHeader({ title, subtitle?, actions?: Node|Node[] }) */
export function PageHeader({ title, subtitle, actions } = {}) {
  return h('header', { class: 'page-head' },
    h('div', { class: 'page-head__text' }, h('h1', {}, title), subtitle && h('p', { class: 'muted' }, subtitle)),
    actions && h('div', { class: 'page-head__actions' }, actions));
}

/** Card({ title?, subtitle?, actions?, class?, flush?, interactive?, tint? }, ...children) -> <section class="glass card"> */
export function Card({ title, subtitle, actions, class: cls, flush, interactive, tint } = {}, ...children) {
  return h('section', { class: ['glass card', flush && 'card--flush', interactive && 'glass--interactive', tint && 'glass--tint', cls] },
    (title || actions) && h('header', { class: 'card__head' },
      h('div', {}, title && h('h2', { class: 'card__title' }, title), subtitle && h('p', { class: 'card__sub muted' }, subtitle)),
      actions && h('div', { class: 'card__actions' }, actions)),
    ...children);
}

/* ---------- buttons & badges ---------- */

/** Button({ variant: 'primary'|'glass'|'ghost'|'danger', size: 'sm'|'md'|'lg', icon?, iconRight?, loading?, ...attrs/handlers }, ...label) */
export function Button({ variant = 'glass', size = 'md', icon: ic, iconRight, loading, type = 'button', class: cls, ...rest } = {}, ...label) {
  return h('button', { type, class: ['btn', `btn--${variant}`, `btn--${size}`, loading && 'is-loading', cls], ...rest },
    ic && icon(ic, { size: size === 'sm' ? 16 : 18 }),
    label.length ? h('span', { class: 'btn__label' }, ...label) : null,
    iconRight && icon(iconRight, { size: size === 'sm' ? 16 : 18 }));
}
/** Toggle a button's busy state (disables it and shows a spinner). */
export function setLoading(btn, on) {
  btn.classList.toggle('is-loading', on);
  btn.disabled = on;
}

/** Badge({ kind: 'ok'|'warn'|'bad'|'info'|'neutral', dot? }, ...children) */
export function Badge({ kind = 'neutral', dot = true } = {}, ...children) {
  return h('span', { class: ['badge', `badge--${kind}`] }, dot && h('i', { class: 'badge__dot' }), ...children);
}

const STATUS_KIND = {
  online: 'ok', active: 'ok', paid: 'ok', done: 'ok',
  degraded: 'warn', open: 'warn', trial: 'info', pending: 'info', provisioning: 'info', draft: 'neutral', running: 'info', queued: 'info',
  offline: 'bad', suspended: 'bad', overdue: 'bad', failed: 'bad', void: 'neutral',
};
/** StatusBadge('online') -> coloured badge using the status word as label. */
export const StatusBadge = (status, label) => Badge({ kind: STATUS_KIND[status] || 'neutral' }, label ?? status);

export function Avatar({ name, size = 36 } = {}) {
  let hash = 0;
  for (const ch of name || '') hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return h('span', { class: 'avatar', style: { '--size': `${size}px`, '--hue': hash }, 'aria-hidden': 'true' }, initials(name));
}

/* ---------- data display ---------- */

/** Sparkline({ values: number[], width?, height?, class? }) -> tiny inline area chart using currentColor */
export function Sparkline({ values = [], width = 96, height = 32, class: cls } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', `0 0 ${width} ${height}`);
  s.setAttribute('width', width);
  s.setAttribute('height', height);
  s.setAttribute('class', `spark ${cls || ''}`.trim());
  s.setAttribute('aria-hidden', 'true');
  if (values.length < 2) return s;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * width, height - 3 - ((v - min) / span) * (height - 6)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const id = uid('sp');
  s.innerHTML = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".35"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>` +
    `<path d="${line}L${width},${height}L0,${height}Z" fill="url(#${id})"/><path d="${line}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>`;
  return s;
}

/** Stat({ label, value, delta?: string, deltaKind?: 'up'|'down'|'flat', icon?, spark?: number[], hint?, accent? }) */
export function Stat({ label, value, delta, deltaKind = 'flat', icon: ic, spark, hint, accent = 'accent' } = {}) {
  return h('div', { class: 'glass stat', style: { '--stat-accent': `var(--${accent})` } },
    h('div', { class: 'stat__top' },
      h('span', { class: 'stat__label' }, label),
      ic && h('span', { class: 'stat__icon' }, icon(ic, { size: 18 }))),
    h('div', { class: 'stat__value num' }, value),
    h('div', { class: 'stat__foot' },
      delta ? h('span', { class: ['delta', `delta--${deltaKind}`] }, delta) : null,
      hint && h('span', { class: 'muted stat__hint' }, hint),
      spark?.length > 1 ? Sparkline({ values: spark, class: 'stat__spark' }) : null));
}

/** Meter({ value: 0-100, label?, kind?: 'auto'|'ok'|'warn'|'bad' }) -> labelled linear bar; 'auto' colours by threshold (70/90) */
export function Meter({ value = 0, label, kind = 'auto' } = {}) {
  const v = Math.max(0, Math.min(100, value));
  const k = kind === 'auto' ? (v >= 90 ? 'bad' : v >= 70 ? 'warn' : 'ok') : kind;
  return h('div', { class: ['meter', `meter--${k}`], role: 'meter', 'aria-valuenow': Math.round(v), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': label },
    label && h('div', { class: 'meter__head' }, h('span', {}, label), h('span', { class: 'num' }, `${Math.round(v)}%`)),
    h('div', { class: 'meter__track' }, h('i', { style: { width: `${v}%` } })));
}

/** Ring({ value: 0-100, size?, label?, sub? }) -> radial gauge */
export function Ring({ value = 0, size = 96, label, sub } = {}) {
  const v = Math.max(0, Math.min(100, value));
  const r = 42;
  const c = 2 * Math.PI * r;
  const k = v >= 90 ? 'bad' : v >= 70 ? 'warn' : 'ok';
  const wrap = h('div', { class: ['ring', `ring--${k}`], style: { width: `${size}px`, height: `${size}px` } });
  wrap.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="ring__bg" cx="50" cy="50" r="${r}"/><circle class="ring__fg" cx="50" cy="50" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - v / 100)).toFixed(1)}"/></svg>`;
  wrap.append(h('div', { class: 'ring__text' }, h('strong', { class: 'num' }, label ?? `${Math.round(v)}%`), sub && h('small', {}, sub)));
  return wrap;
}

/** Table({ columns: [{ key, label, align?, width?, render?(row) }], rows, empty?: Node, onRowClick?(row), rowKey? }) */
export function Table({ columns, rows, empty, onRowClick, rowKey = 'id' } = {}) {
  if (!rows?.length) return empty ?? Empty({ icon: 'info', title: 'Nothing here yet' });
  const body = rows.map((row) => {
    const tr = h('tr', {
      'data-key': row[rowKey],
      class: onRowClick && 'is-clickable',
      tabindex: onRowClick ? 0 : null,
      onclick: onRowClick && ((e) => { if (!e.target.closest('a,button,input,select')) onRowClick(row); }),
      onkeydown: onRowClick && ((e) => { if (e.key === 'Enter' && e.target === tr) onRowClick(row); }),
    }, columns.map((c) => h('td', { class: [c.align && `ta-${c.align}`, c.class], 'data-label': c.label }, c.render ? c.render(row) : (row[c.key] ?? ''))));
    return tr;
  });
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, columns.map((c) => h('th', { scope: 'col', class: c.align && `ta-${c.align}`, style: c.width ? { width: c.width } : null }, c.label)))),
      h('tbody', {}, body)));
}

/** Tabs({ tabs: [{ id, label, icon? }], value, onchange(id) }) -> tablist; call el.set(id) to change programmatically */
export function Tabs({ tabs, value, onchange } = {}) {
  const el = h('div', { class: 'tabs', role: 'tablist' }, tabs.map((t) =>
    h('button', {
      type: 'button', role: 'tab', 'data-id': t.id, 'aria-selected': String(t.id === value), class: ['tab', t.id === value && 'is-active'],
      onclick: () => el.set(t.id, true),
    }, t.icon && icon(t.icon, { size: 16 }), t.label)));
  el.set = (id, emit) => {
    el.querySelectorAll('.tab').forEach((b) => {
      const on = b.dataset.id === id;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    if (emit) onchange?.(id);
  };
  return el;
}

/* ---------- forms ---------- */

/** Field({ label, hint?, error?, for?, required? }, control) -> labelled wrapper. el.setError(msg) shows/clears an error. */
export function Field({ label, hint, error, for: forId, required } = {}, control) {
  const id = forId || control?.id || (control && (control.id = uid('f')));
  const err = h('p', { class: 'field__error', id: `${id}-err`, role: 'alert' }, error || '');
  const el = h('div', { class: ['field', error && 'has-error'] },
    h('label', { class: 'field__label', for: id }, label, required && h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')),
    control,
    hint && h('p', { class: 'field__hint muted' }, hint),
    err);
  el.setError = (msg) => {
    err.textContent = msg || '';
    el.classList.toggle('has-error', Boolean(msg));
    control?.setAttribute?.('aria-invalid', msg ? 'true' : 'false');
    if (msg) control?.setAttribute?.('aria-describedby', err.id);
  };
  return el;
}
export const Input = (props = {}) => h('input', { class: 'input', type: 'text', autocomplete: 'off', spellcheck: 'false', ...props });
export const Textarea = (props = {}) => h('textarea', { class: 'input textarea', rows: 4, ...props });
/** Select({ options: [{ value, label }] | string[], value, ...attrs }) */
export function Select({ options = [], value, ...rest } = {}) {
  return h('select', { class: 'input select', value, ...rest },
    options.map((o) => { const opt = typeof o === 'string' ? { value: o, label: o } : o; return h('option', { value: opt.value, selected: opt.value === value }, opt.label); }));
}
/** Switch({ checked, label, onchange }) */
export function Switch({ checked = false, label, onchange, id } = {}) {
  const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch__input', id: id || uid('sw'), checked, onchange });
  return h('label', { class: 'switch' }, input, h('span', { class: 'switch__track' }, h('i')), label && h('span', { class: 'switch__label' }, label));
}
/** Segmented({ options: [{ value, label, icon? }], value, onchange(value), name? }) -> radio group; el.value reads current */
export function Segmented({ options, value, onchange, name = uid('seg'), label } = {}) {
  const el = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label },
    options.map((o) => h('label', { class: 'segmented__opt' },
      h('input', { type: 'radio', name, value: o.value, checked: o.value === value, onchange: () => { el.value = o.value; onchange?.(o.value); } }),
      h('span', {}, o.icon && icon(o.icon, { size: 16 }), o.label))));
  el.value = value;
  return el;
}

/* ---------- feedback ---------- */

export function Skeleton({ lines = 3, height } = {}) {
  return h('div', { class: 'skeleton', 'aria-busy': 'true', 'aria-label': 'Loading' },
    Array.from({ length: lines }, (_, i) => h('i', { style: { height: height ? `${height}px` : null, width: `${100 - (i % 3) * 14}%` } })));
}

/** Empty({ icon?, title, message?, action?: Node }) */
export function Empty({ icon: ic = 'sparkle', title, message, action } = {}) {
  return h('div', { class: 'empty' },
    h('span', { class: 'empty__icon' }, icon(ic, { size: 26 })),
    h('h3', {}, title), message && h('p', { class: 'muted' }, message), action);
}
/** ErrorState(err, retry?) */
export function ErrorState(err, retry) {
  return Empty({ icon: 'alert', title: 'Something went wrong', message: err?.message || String(err),
    action: retry && Button({ variant: 'glass', icon: 'refresh', onclick: retry }, 'Try again') });
}

/**
 * Async section helper: shows a skeleton, awaits loader(), replaces content with render(data) (Node | Node[]);
 * shows ErrorState with a retry button on failure. Aborted requests are ignored.
 */
export async function loadInto(el, loader, render, { skeleton } = {}) {
  el.replaceChildren(skeleton ?? Skeleton({ lines: 4 }));
  try {
    const data = await loader();
    el.replaceChildren(...[].concat(render(data)).filter(Boolean));
  } catch (e) {
    if (e?.name === 'AbortError') return;
    el.replaceChildren(ErrorState(e, () => loadInto(el, loader, render, { skeleton })));
  }
}

/* ---------- overlays ---------- */

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Modal({ title, subtitle?, content: Node, actions?: Node[], size?: 'sm'|'md'|'lg', dismissible?, onClose? })
 * -> { close(), el, body }. Esc / scrim click closes; focus is trapped and restored.
 */
export function Modal({ title, subtitle, content, actions, size = 'md', dismissible = true, onClose } = {}) {
  const root = document.getElementById('overlay-root');
  const prev = document.activeElement;
  const titleId = uid('mt');
  const body = h('div', { class: 'modal__body' }, content);
  const dlg = h('div', { class: ['glass glass--thick glass--liquid modal', `modal--${size}`], role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: -1 },
    h('header', { class: 'modal__head' },
      h('div', {}, h('h2', { id: titleId }, title), subtitle && h('p', { class: 'muted' }, subtitle)),
      dismissible && h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => close() }, icon('x', { size: 18 }))),
    body,
    actions?.length ? h('footer', { class: 'modal__foot' }, actions) : null);
  const scrim = h('div', { class: 'scrim', onmousedown: (e) => { if (e.target === scrim && dismissible) close(); } }, dlg);
  let closed = false;

  function onKey(e) {
    if (e.key === 'Escape' && dismissible) { e.stopPropagation(); close(); }
    if (e.key !== 'Tab') return;
    const f = [...dlg.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    scrim.classList.remove('is-open');
    setTimeout(() => scrim.remove(), 200);
    prev?.focus?.({ preventScroll: true });
    onClose?.();
  }
  document.addEventListener('keydown', onKey, true);
  root.append(scrim);
  requestAnimationFrame(() => {
    scrim.classList.add('is-open');
    (dlg.querySelector('[autofocus],input,select,textarea') || dlg).focus({ preventScroll: true });
  });
  return { close, el: dlg, body };
}

/** Confirm({ title, message, confirmLabel?, danger? }) -> Promise<boolean> */
export function Confirm({ title, message, confirmLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); m.close(); } };
    const m = Modal({
      title, size: 'sm', content: h('p', { class: 'muted' }, message), onClose: () => done(false),
      actions: [Button({ variant: 'ghost', onclick: () => done(false) }, 'Cancel'), Button({ variant: danger ? 'danger' : 'primary', onclick: () => done(true) }, confirmLabel)],
    });
  });
}

/* ---------- wizard / jobs ---------- */

/** Stepper({ steps: [{ key, label }], current: index }) -> el.set(index) to move */
export function Stepper({ steps, current = 0 } = {}) {
  const el = h('ol', { class: 'stepper', 'aria-label': 'Progress' }, steps.map((s, i) =>
    h('li', { 'data-i': i }, h('span', { class: 'stepper__dot' }, h('b', {}, i + 1), icon('check', { size: 14 })), h('span', { class: 'stepper__label' }, s.label))));
  el.set = (idx) => el.querySelectorAll('li').forEach((li, i) => {
    li.classList.toggle('is-done', i < idx);
    li.classList.toggle('is-current', i === idx);
    if (i === idx) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
  el.set(current);
  return el;
}

/** JobProgress(job) -> live step list; call el.update(job) with each poll result. */
export function JobProgress(job) {
  const list = h('ol', { class: 'job' });
  const foot = h('p', { class: 'job__foot', role: 'status' });
  const el = h('div', { class: 'job-wrap' }, list, foot);
  el.update = (j) => {
    clear(list);
    for (const s of j.steps || []) {
      const mark = s.status === 'done' ? icon('check', { size: 14 }) : s.status === 'failed' ? icon('x', { size: 14 }) : s.status === 'running' ? h('i', { class: 'spinner' }) : s.status === 'skipped' ? h('b', {}, '–') : h('b', {}, '');
      list.append(h('li', { class: `job__step job__step--${s.status}` }, h('span', { class: 'job__mark' }, mark),
        h('span', { class: 'job__label' }, s.label, s.detail && h('small', { class: 'muted' }, s.detail))));
    }
    foot.textContent = j.status === 'failed' ? (j.error || 'The job failed.') : j.status === 'done' ? 'Completed.' : 'Working…';
    foot.className = `job__foot job__foot--${j.status}`;
  };
  el.update(job);
  return el;
}

/** CopyBlock({ text, label?, maxHeight? }) -> code block with a copy button */
export function CopyBlock({ text, label, maxHeight = 320 } = {}) {
  const btn = Button({ size: 'sm', variant: 'glass', icon: 'copy', onclick: async () => {
    try {
      await navigator.clipboard.writeText(text);
      btn.querySelector('.btn__label').textContent = 'Copied';
      setTimeout(() => { btn.querySelector('.btn__label').textContent = 'Copy'; }, 1600);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      toast({ title: 'Press Ctrl/Cmd+C to copy', kind: 'info' });
    }
  } }, 'Copy');
  const code = h('code', {}, text);
  return h('div', { class: 'copyblock' },
    h('div', { class: 'copyblock__bar' }, h('span', { class: 'muted' }, label || ''), btn),
    h('pre', { tabindex: 0, style: { maxHeight: `${maxHeight}px` } }, code));
}
